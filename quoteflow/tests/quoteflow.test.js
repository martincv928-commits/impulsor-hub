const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/money.js');
const CAT = require('../src/catalog.js');
const P = require('../src/parser.js');
const { LocalQuoteInterpreter } = require('../src/interpreter.js');

const parse = (t, catalog = []) => P.parse(t, { catalog, settings: { ivaRateBp: 1600 } });
const it = (r, i) => r.quote.items[i];

test('caso 1: dos productos con litros, más IVA', () => {
  const r = parse('Cotiza a Pedro 20 litros de jabón Ariel a 14 pesos y 10 litros de suavizante a 18 pesos más IVA.');
  assert.equal(r.quote.client, 'Pedro');
  assert.equal(r.quote.ivaMode, 'mas');
  assert.equal(r.quote.items.length, 2);
  assert.deepEqual([it(r, 0).desc, it(r, 0).qtyMilli, it(r, 0).unit, it(r, 0).priceCents], ['Jabón Ariel', 20000, 'litro', 1400]);
  assert.deepEqual([it(r, 1).desc, it(r, 1).qtyMilli, it(r, 1).unit, it(r, 1).priceCents], ['Suavizante', 10000, 'litro', 1800]);
  assert.equal(r.confidence, 'alta');
  const t = M.computeTotals(r.quote);
  assert.deepEqual([t.subtotal, t.iva, t.total], [46000, 7360, 53360]);
});

test('caso 2: cada una, servicio de monto fijo, decimales, vigencia', () => {
  const r = parse('Cotiza a Constructora López 5 cámaras a 1850 cada una, instalación 3500 y 100 metros de cable a 12.50, vigencia 15 días.');
  assert.equal(r.quote.client, 'Constructora López');
  assert.equal(r.quote.validityDays, 15);
  assert.equal(r.quote.items.length, 3);
  assert.deepEqual([it(r, 0).qtyMilli, it(r, 0).priceCents], [5000, 185000]);
  assert.deepEqual([it(r, 1).desc, it(r, 1).qtyMilli, it(r, 1).unit, it(r, 1).priceCents], ['Instalación', 1000, 'servicio', 350000]);
  assert.deepEqual([it(r, 2).desc, it(r, 2).qtyMilli, it(r, 2).unit, it(r, 2).priceCents], ['Cable', 100000, 'metro', 1250]);
  assert.ok(r.doubtful.some((d) => d.field === 'iva'));
  assert.equal(M.computeTotals(r.quote).subtotal, 925000 + 350000 + 125000);
});

test('caso 3: "para Juan de 10 focos" con descuento', () => {
  const r = parse('Haz una cotización para Juan de 10 focos a 80 pesos con 5% de descuento más IVA.');
  assert.equal(r.quote.client, 'Juan');
  assert.deepEqual(r.quote.discount, { type: 'pct', value: 500 });
  assert.deepEqual([it(r, 0).desc, it(r, 0).qtyMilli, it(r, 0).priceCents], ['Focos', 10000, 8000]);
  const t = M.computeTotals(r.quote);
  assert.deepEqual([t.subtotal, t.discount, t.iva, t.total], [80000, 4000, 12160, 88160]);
});

test('caso 4: recupera precio del catálogo', () => {
  const first = parse('Cotiza a Pedro 20 litros de jabón Ariel a 14 pesos más IVA');
  let catalog = [];
  first.quote.items.forEach((x) => (catalog = CAT.upsert(catalog, x, 1)));
  const r = parse('Cotiza 50 litros de Ariel.', catalog);
  assert.equal(r.quote.client, '');
  assert.deepEqual([it(r, 0).qtyMilli, it(r, 0).unit, it(r, 0).priceCents, it(r, 0).priceSource], [50000, 'litro', 1400, 'catalogo']);
  assert.equal(M.computeTotals(r.quote).subtotal, 70000);
});

test('caso 4b: ambigüedad en catálogo pide elegir', () => {
  let catalog = [];
  catalog = CAT.upsert(catalog, { desc: 'Jabón Ariel', unit: 'litro', priceCents: 1400 }, 1);
  catalog = CAT.upsert(catalog, { desc: 'Suavizante Ariel', unit: 'litro', priceCents: 1800 }, 2);
  const r = parse('Cotiza 50 litros de Ariel', catalog);
  assert.equal(it(r, 0).priceCents, null);
  assert.equal(it(r, 0).candidates.length, 2);
});

test('caso 5: no inventa cantidad ni precio', () => {
  const r = parse('Cotiza a Pedro instalación de cámaras.');
  assert.equal(r.quote.client, 'Pedro');
  assert.equal(it(r, 0).desc, 'Instalación de cámaras');
  assert.equal(it(r, 0).qtyMilli, null);
  assert.equal(it(r, 0).priceCents, null);
  assert.equal(r.confidence, 'baja');
});

test('variantes: sin IVA, IVA incluido, descuento del, dale', () => {
  assert.equal(parse('cotiza a Ana 2 cajas a 100 sin IVA').quote.ivaMode, 'sin');
  const inc = parse('cotiza a Ana 1 servicio a 116 pesos IVA incluido');
  assert.equal(inc.quote.ivaMode, 'incluido');
  const t = M.computeTotals(inc.quote);
  assert.deepEqual([t.net, t.iva, t.total], [10000, 1600, 11600]);
  assert.equal(parse('cotiza a Ana 2 cajas a 100, descuento del 10%').quote.discount.value, 1000);
  assert.equal(parse('cotiza a Ana 2 cajas a 100, dale 5% de descuento').quote.discount.value, 500);
});

test('dinero sin errores de punto flotante', () => {
  assert.equal(M.toCents('0.1') + M.toCents('0.2'), 30);
  assert.equal(M.lineAmount({ qtyMilli: M.toMilli('3'), priceCents: M.toCents('33.33') }), 9999);
  assert.equal(M.lineAmount({ qtyMilli: M.toMilli('2.5'), priceCents: M.toCents('12.50') }), 3125);
  assert.equal(M.format(123456789), '$1,234,567.89');
});

test('LocalQuoteInterpreter cumple el contrato', async () => {
  const r = await new LocalQuoteInterpreter().interpret('Cotiza a Pedro 1 pieza a 10', {});
  assert.equal(r.interpreter, 'local');
  assert.ok(Array.isArray(r.doubtful) && r.quote && r.confidence);
});
