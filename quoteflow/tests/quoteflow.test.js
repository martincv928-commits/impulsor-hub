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

/* ---------- descripciones limpias: las instrucciones no quedan en el concepto ---------- */
const CONTROL = /cotiza|cotizaci[oó]n|\biva\b|vigencia|v[aá]lid|descuento|pesos|cada un[oa]|agr[eé]ga|por favor|\boye\b/i;
const descs = (r) => r.quote.items.map((x) => x.desc);
const assertClean = (r) => descs(r).forEach((d) => assert.ok(!CONTROL.test(d), `descripción con instrucciones: "${d}"`));

test('limpieza 1: más IVA + vigencia', () => {
  const r = parse('Cotiza a Juan 10 focos a 80 pesos más IVA vigencia 15 días.');
  assert.equal(r.quote.client, 'Juan');
  assert.deepEqual(descs(r), ['Focos']);
  assert.deepEqual([it(r, 0).qtyMilli, it(r, 0).priceCents], [10000, 8000]);
  assert.deepEqual([r.quote.ivaMode, r.quote.ivaRateBp, r.quote.validityDays], ['mas', 1600, 15]);
  assertClean(r);
});

test('limpieza 2: servicio conserva su nombre completo', () => {
  const r = parse('Cotiza a Pedro instalación de cámaras por 3500 más IVA.');
  assert.equal(r.quote.client, 'Pedro');
  assert.deepEqual(descs(r), ['Instalación de cámaras']);
  assert.deepEqual([it(r, 0).qtyMilli, it(r, 0).priceCents, r.quote.ivaMode], [1000, 350000, 'mas']);
  assertClean(r);
});

test('limpieza 3: cotización para + cada una + descuento', () => {
  const r = parse('Haz una cotización para Constructora López de 5 cámaras a 1850 cada una con 5% de descuento.');
  assert.equal(r.quote.client, 'Constructora López');
  assert.deepEqual(descs(r), ['Cámaras']);
  assert.deepEqual([it(r, 0).qtyMilli, it(r, 0).priceCents], [5000, 185000]);
  assert.deepEqual(r.quote.discount, { type: 'pct', value: 500 });
  assertClean(r);
});

test('limpieza 4: dos productos sin cliente', () => {
  const r = parse('Cotiza 20 litros de jabón Ariel a 14 pesos y 10 litros de suavizante a 18 pesos.');
  assert.deepEqual(descs(r), ['Jabón Ariel', 'Suavizante']);
  assert.deepEqual([it(r, 1).qtyMilli, it(r, 1).unit, it(r, 1).priceCents], [10000, 'litro', 1800]);
  assertClean(r);
});

test('limpieza: variantes habladas (agrégale, por favor, oye, cada uno, válida por)', () => {
  const cases = [
    'Cotiza a Juan 10 focos a 80 pesos, agrégale IVA y vigencia de 15 días.',
    'cotiza a juan 10 focos a 80 pesos agrégale iva y vigencia de 15 días',
    'Oye, cotiza a Juan por favor 10 focos de 80 pesos más el IVA',
    'Cotiza a Juan 10 focos cada uno a 80 pesos válida por 15 días',
  ];
  for (const c of cases) {
    const r = parse(c);
    assert.equal(r.quote.client, 'Juan', c);
    assert.deepEqual(descs(r), ['Focos'], c);
    assert.deepEqual([it(r, 0).qtyMilli, it(r, 0).priceCents], [10000, 8000], c);
    assertClean(r);
  }
  assert.equal(parse(cases[0]).quote.ivaMode, 'mas');
  assert.equal(parse(cases[3]).quote.validityDays, 15);
});

test('limpieza: no borra palabras reales del producto', () => {
  assert.deepEqual(descs(parse('Cotiza a Pedro 2 cables calibre 12 a 30 pesos y dale 5% de descuento')), ['Cables calibre 12']);
  assert.deepEqual(descs(parse('Cotiza a Pedro instalación de cámaras.')), ['Instalación de cámaras']);
});

test('voz: resultados acumulados de Android no se duplican', () => {
  let inst;
  globalThis.webkitSpeechRecognition = class { constructor() { inst = this; } start() {} stop() {} abort() {} };
  delete require.cache[require.resolve('../src/voice.js')];
  require('../src/voice.js');
  let shown = '', final = '';
  globalThis.QF.voice.start({ onText: (t) => (shown = t), onEnd: (t) => (final = t) });
  const res = (list) => { const r = list.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f })); return { resultIndex: 0, results: r }; };
  const acc = ['puedes', 'puedes cotizarme', 'puedes cotizarme 20', 'puedes cotizarme 20 l de Ariel', 'puedes cotizarme 20 l de Ariel a $12 el litro'];
  inst.onresult(res(acc.map((t) => [t, true])));
  inst.onend();
  assert.equal(final, 'puedes cotizarme 20 l de Ariel a $12 el litro');
  assert.equal(shown, final);
  // resultados normales (no acumulados) se concatenan
  inst.onresult(res([['cotiza a Pedro', true], ['10 focos a 80', true]]));
  inst.onend();
  assert.equal(final, 'cotiza a Pedro 10 focos a 80');
  delete globalThis.webkitSpeechRecognition;
});

test('dictado: "puedes cotizarme", "cotízame", cliente al final', () => {
  let r = parse('puedes cotizarme 20 l de Ariel Downey a $12 el litro para Juan Pérez');
  assert.equal(r.quote.client, 'Juan Pérez');
  assert.deepEqual(descs(r), ['Ariel Downey']);
  assert.deepEqual([it(r, 0).qtyMilli, it(r, 0).unit, it(r, 0).priceCents], [20000, 'litro', 1200]);
  r = parse('Cotízame 20 litros de Ariel a 12 pesos el litro para Pedro más IVA');
  assert.equal(r.quote.client, 'Pedro');
  assert.deepEqual(descs(r), ['Ariel']);
  r = parse('Me puedes hacer una cotización para Pedro de 20 litros de Ariel a 12 pesos');
  assert.equal(r.quote.client, 'Pedro');
  assert.deepEqual(descs(r), ['Ariel']);
});

test('voz: texto real duplicado del celular se reduce a la frase completa', () => {
  globalThis.webkitSpeechRecognition = globalThis.webkitSpeechRecognition || class {};
  delete require.cache[require.resolve('../src/voice.js')];
  const { clean } = (require('../src/voice.js'), globalThis.QF.voice);
  const shot = 'Hazme hazme una hazme una cotización hazme una cotización para hazme una cotización para Jennifer hazme una cotización para Jennifer Natalia hazme una cotización para Jennifer Natalia de hazme una cotización para Jennifer Natalia de 20 hazme una cotización para Jennifer Natalia de 20 l hazme una cotización para Jennifer Natalia de 20 l de Ariel Dani a $12 hazme una cotización para Jennifer Natalia de 20 l de Ariel Dani';
  const text = clean(shot);
  assert.equal(text, 'hazme una cotización para Jennifer Natalia de 20 l de Ariel Dani a $12');
  const r = parse(text);
  assert.equal(r.quote.client, 'Jennifer Natalia');
  assert.deepEqual([it(r, 0).desc, it(r, 0).qtyMilli, it(r, 0).unit, it(r, 0).priceCents], ['Ariel Dani', 20000, 'litro', 1200]);
  // texto normal no se toca
  for (const t of ['dos litros de cloro a 20 y dos litros de jabón a 30', 'Cotiza a Pedro 20 litros de jabón a 14 pesos y 10 litros de suavizante a 18 pesos más IVA']) assert.equal(clean(t), t);
});

test('separa conceptos seguidos sin conector explícito (habla corrida/dictado)', () => {
  const r = parse('Cotízame para Telulada 3 litros de cloro a 4 pesos el litro 3 litros de fabuloso a 7 pesos el litro y 3 litros de jabón a 12 pesos el litro');
  assert.equal(r.quote.client, 'Telulada');
  assert.equal(r.quote.items.length, 3);
  assert.deepEqual(descs(r), ['Cloro', 'Fabuloso', 'Jabón']);
  assert.deepEqual([it(r, 0).qtyMilli, it(r, 0).unit, it(r, 0).priceCents], [3000, 'litro', 400]);
  assert.deepEqual([it(r, 1).qtyMilli, it(r, 1).unit, it(r, 1).priceCents], [3000, 'litro', 700]);
  assert.deepEqual([it(r, 2).qtyMilli, it(r, 2).unit, it(r, 2).priceCents], [3000, 'litro', 1200]);
  assertClean(r);
});

/* ---------- respaldo / restauración ---------- */
function fakeStorage() {
  const store = {};
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
}

function freshStorage() {
  delete require.cache[require.resolve('../src/storage.js')];
  globalThis.localStorage = fakeStorage();
  delete globalThis.QF.storage;
  require('../src/storage.js');
  return globalThis.QF.storage;
}

test('respaldo: exporta y restaura sin perder la estructura', () => {
  const DB1 = freshStorage();
  DB1.saveSettings(Object.assign({}, DB1.getSettings(), { businessName: 'Limpieza Express', ivaRateBp: 1600 }));
  let catalog = CAT.upsert([], { desc: 'Jabón Ariel', unit: 'litro', priceCents: 1400 }, 1);
  DB1.saveCatalog(catalog);
  const folio = DB1.nextFolio();
  DB1.saveQuote({ id: 'q1', folio, client: 'Pedro', items: [{ id: 'i1', desc: 'Jabón Ariel', qtyMilli: 20000, unit: 'litro', priceCents: 1400 }], discount: { type: 'pct', value: 0 }, ivaMode: 'mas', ivaRateBp: 1600, validityDays: 15, notes: '', status: 'GENERADA', updatedAt: 1 });
  const backup = DB1.exportBackup();
  assert.equal(backup.app, 'QuoteFlow');
  assert.equal(backup.quotes.length, 1);

  // "otro dispositivo": storage vacío, se restaura ahí
  const DB2 = freshStorage();
  assert.equal(DB2.getQuotes().length, 0);
  const err = DB2.validateBackup(backup);
  assert.equal(err, null);
  DB2.restoreBackup(backup);
  assert.equal(DB2.getSettings().businessName, 'Limpieza Express');
  assert.equal(DB2.getCatalog().length, 1);
  const restored = DB2.getQuotes();
  assert.equal(restored.length, 1);
  assert.deepEqual(restored[0].items, backup.quotes[0].items);
  assert.equal(DB2.nextFolio(), 'COT-0002'); // el folio siguiente continúa donde iba, no se reinicia
});

test('respaldo: rechaza archivos que no son de QuoteFlow o están incompletos', () => {
  const DB1 = freshStorage();
  assert.match(DB1.validateBackup(null), /válido/);
  assert.match(DB1.validateBackup({ foo: 1 }), /no es un respaldo/);
  assert.match(DB1.validateBackup({ app: 'QuoteFlow', backupVersion: 1, settings: {}, catalog: [] }), /cotizaciones/);
  assert.match(DB1.validateBackup({ app: 'QuoteFlow', backupVersion: 1, settings: {}, catalog: [], quotes: [{ id: 'x' }] }), /incompleta/);
  assert.match(DB1.validateBackup({ app: 'QuoteFlow', backupVersion: 99, settings: {}, catalog: [], quotes: [] }), /más nueva/);
});

/* ---------- V0.3: mapeo de datos hacia/desde Supabase (sin red) ---------- */
const CLOUD = require('../src/cloud.js');

test('cloud: una cotización local sobrevive el viaje a fila de Supabase y de vuelta', () => {
  const local = {
    id: 'qlocal123', folio: 'COT-0007', client: 'Pedro',
    items: [
      { id: 'i1', desc: 'Jabón Ariel', qtyMilli: 20000, unit: 'litro', priceCents: 1400, priceSource: 'dicho', catalogName: null },
      { id: 'i2', desc: 'Suavizante', qtyMilli: 10000, unit: 'litro', priceCents: 1800, priceSource: 'catalogo', catalogName: 'Suavizante' },
    ],
    discount: { type: 'pct', value: 500 }, ivaMode: 'mas', ivaRateBp: 1600, validityDays: 15,
    notes: 'Entrega en 3 días', conditions: 'Ver condiciones', sourceText: 'cotiza a Pedro...',
    status: 'GENERADA', updatedAt: 1700000000000, generatedAt: 1700000000000,
  };
  const row = CLOUD._quoteRow('biz-1', local);
  assert.equal(row.business_id, 'biz-1');
  assert.equal(row.client_name, 'Pedro');
  assert.equal(row.id, undefined); // id local ("qlocal123") no es uuid: se deja que la nube genere uno

  // simula lo que Supabase regresaría: la fila guardada + sus conceptos
  const fakeRow = Object.assign({}, row, {
    id: '11111111-1111-1111-1111-111111111111',
    created_at: '2023-11-14T00:00:00.000Z',
    quote_items: local.items.map((it, i) => ({
      id: 'item-' + i, sort_order: i, description: it.desc, qty_milli: it.qtyMilli, unit: it.unit,
      price_cents: it.priceCents, price_source: it.priceSource, catalog_name: it.catalogName,
    })),
  });
  const back = CLOUD._quoteFromRow(fakeRow);
  assert.equal(back.id, fakeRow.id);
  assert.equal(back.client, 'Pedro');
  assert.equal(back.folio, 'COT-0007');
  assert.deepEqual(back.discount, { type: 'pct', value: 500 });
  assert.equal(back.items.length, 2);
  assert.deepEqual([back.items[0].desc, back.items[0].qtyMilli, back.items[0].unit, back.items[0].priceCents], ['Jabón Ariel', 20000, 'litro', 1400]);
  assert.equal(back.items[1].catalogName, 'Suavizante');

  // una cotización YA sincronizada antes (id ya es uuid) se actualiza, no se duplica
  const already = Object.assign({}, local, { id: fakeRow.id });
  const row2 = CLOUD._quoteRow('biz-1', already);
  assert.equal(row2.id, fakeRow.id);
});

test('cloud: el catálogo local y el de Supabase se traducen sin perder datos', () => {
  const entry = { key: 'jabon ariel', name: 'Jabón Ariel', unit: 'litro', priceCents: 1400, uses: 3, updatedAt: 1700000000000 };
  const row = CLOUD._productRow('biz-1', entry);
  assert.deepEqual(row, { business_id: 'biz-1', key: 'jabon ariel', name: 'Jabón Ariel', unit: 'litro', price_cents: 1400, uses: 3, updated_at: new Date(1700000000000).toISOString() });
  const back = CLOUD._catalogFromRows([Object.assign({}, row, { updated_at: row.updated_at })]);
  assert.equal(back[0].priceCents, 1400);
  assert.equal(back[0].name, 'Jabón Ariel');
});

test('cloud: sin configurar, la app se comporta como V0.2 (deshabilitada)', () => {
  assert.equal(CLOUD.enabled(), false);
});

/* ---------- V0.4: seguimiento de pagos ---------- */
test('cloud: un pago local sobrevive el viaje a fila de Supabase y de vuelta', () => {
  const payment = { id: 'pLocal1', amountCents: 5000, method: 'transferencia', note: 'Anticipo', paidAt: 1700000000000 };
  const row = CLOUD._paymentRow('11111111-1111-1111-1111-111111111111', payment);
  assert.deepEqual(row, {
    quote_id: '11111111-1111-1111-1111-111111111111',
    amount_cents: 5000, method: 'transferencia', note: 'Anticipo',
    paid_at: new Date(1700000000000).toISOString(),
  });
  const back = CLOUD._paymentsFromRows([Object.assign({}, row, { id: 'pay-uuid-1' })]);
  assert.deepEqual(back, [{ id: 'pay-uuid-1', amountCents: 5000, method: 'transferencia', note: 'Anticipo', paidAt: 1700000000000 }]);
});

test('cloud: una cotización con pagos parciales conserva el saldo al ir y volver de Supabase', () => {
  const local = {
    id: 'qlocal9', folio: 'COT-0009', client: 'Ana',
    items: [{ id: 'i1', desc: 'Servicio', qtyMilli: 1000, unit: 'servicio', priceCents: 100000, priceSource: 'dicho', catalogName: null }],
    discount: { type: 'pct', value: 0 }, ivaMode: 'sin', ivaRateBp: 1600, validityDays: 15,
    notes: '', conditions: '', sourceText: '', status: 'GENERADA', updatedAt: 1700000000000, generatedAt: 1700000000000,
    payments: [{ id: 'pLocal1', amountCents: 40000, method: 'efectivo', note: '', paidAt: 1700000001000 }],
  };
  const row = CLOUD._quoteRow('biz-1', local);
  const fakeRow = Object.assign({}, row, {
    id: '22222222-2222-2222-2222-222222222222',
    created_at: '2023-11-14T00:00:00.000Z',
    quote_items: [],
    quote_payments: local.payments.map((p) => CLOUD._paymentRow('22222222-2222-2222-2222-222222222222', p)).map((r, i) => Object.assign({ id: 'pay-' + i }, r)),
  });
  const back = CLOUD._quoteFromRow(fakeRow);
  assert.equal(back.payments.length, 1);
  assert.equal(back.payments[0].amountCents, 40000);
  assert.equal(back.payments[0].method, 'efectivo');
});

test('voz: el dictado corrige una palabra a medio camino ("litros" -> "L") y aun así se limpia', () => {
  globalThis.webkitSpeechRecognition = globalThis.webkitSpeechRecognition || class {};
  delete require.cache[require.resolve('../src/voice.js')];
  const { clean } = (require('../src/voice.js'), globalThis.QF.voice);
  const shot = 'cotízame cotízame cotízame para cotízame para Salamanca cotízame para Salamanca cotízame para Salamanca cotízame para Salamanca 5 cotízame para Salamanca 5 litros de cotízame para Salamanca 5 litros de cotízame para Salamanca 5 cotízame para Salamanca 5 cotízame para Salamanca 5 cotízame para Salamanca 5 L de cloro cotízame para Salamanca 5 L de cloro a cotízame para Salamanca 5 L de cloro a cotízame para Salamanca 5 L de cloro a $4 cotízame para Salamanca 5 L de cloro a $4 cotízame para Salamanca 5 L de cloro a $4 cotízame para Salamanca 5 L de cloro a $4 el cotízame para Salamanca 5 L de cloro a $4 el litro';
  const text = clean(shot);
  assert.equal(text, 'cotízame para Salamanca 5 L de cloro a $4 el litro');
  const r = parse(text);
  assert.equal(r.quote.client, 'Salamanca');
  assert.deepEqual([it(r, 0).desc, it(r, 0).qtyMilli, it(r, 0).unit, it(r, 0).priceCents], ['Cloro', 5000, 'litro', 400]);
});

test('parser: "$4 de litro" se entiende igual que "$4 el litro"', () => {
  const r = parse('cotízame para el cliente Salamanca 4 L de jabón foca a $12 el litro 5 L de cloro a $4 de litro y 3 l de fabuloso cítricos a $7 el litro sin iva');
  assert.equal(r.quote.client, 'Salamanca');
  assert.equal(r.quote.ivaMode, 'sin');
  assert.deepEqual(descs(r), ['Jabón foca', 'Cloro', 'Fabuloso cítricos']);
  assert.deepEqual([it(r, 1).qtyMilli, it(r, 1).unit, it(r, 1).priceCents], [5000, 'litro', 400]);
  assertClean(r);
});
