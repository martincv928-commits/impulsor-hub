import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { ErpUnsupported, clientesFromRows, inventarioFromRows, singularize } from '../supabase/functions/_shared/erp.ts';
import { FilesConnector, decodeText, normalizeRows, parseCsv, parseDatasetFile, parseXlsx, suggestMapping } from '../supabase/functions/_shared/files.ts';
import { GenericRestConnector, validateGenericConfig, type GenericConfig } from '../supabase/functions/_shared/generic.ts';
import { DATASETS, getPath, mapRow, parseDate, parseMoney, sanitizeMapping } from '../supabase/functions/_shared/mapping.ts';
import { buildConnector } from '../supabase/functions/_shared/source.ts';

// ───────── mapping: importes y fechas estrictos ─────────
describe('parseMoney', () => {
  it('acepta formatos comunes y respeta el separador decimal', () => {
    expect(parseMoney('1,234.50').toFixed()).toBe('1234.5'); expect(parseMoney('$1,234.50').toFixed()).toBe('1234.5');
    expect(parseMoney('(1,234.50)').toFixed()).toBe('-1234.5'); expect(parseMoney('-5').toFixed()).toBe('-5'); expect(parseMoney('5-').toFixed()).toBe('-5');
    expect(parseMoney('1.234,50', ',').toFixed()).toBe('1234.5'); expect(parseMoney('MXN 99.99').toFixed()).toBe('99.99'); expect(parseMoney(0.1).toFixed()).toBe('0.1');
  });
  it('rechaza lo ambiguo o inválido en lugar de adivinar', () => {
    for (const v of ['', '  ', '1,2,3', '12.5.3', 'abc', '1.234,50', '--5', null, undefined, {}, NaN, Infinity]) expect(() => parseMoney(v as any)).toThrow();
    expect(() => parseMoney('1,234.50', ',')).toThrow(); // con coma decimal, "1,234.50" no es válido
  });
  it('no pierde precisión (Decimal, no float)', () => { expect(parseMoney('0.1').plus(parseMoney('0.2')).toFixed()).toBe('0.3'); });
});
describe('parseDate', () => {
  it('ISO, DD/MM/AAAA, MM/DD/AAAA y Date', () => {
    expect(parseDate('2026-03-05')).toBe('2026-03-05'); expect(parseDate('2026-03-05T10:00:00Z')).toBe('2026-03-05');
    expect(parseDate('05/03/2026', 'dmy')).toBe('2026-03-05'); expect(parseDate('03/05/2026', 'mdy')).toBe('2026-03-05'); expect(parseDate('5-3-2026', 'dmy')).toBe('2026-03-05');
    expect(parseDate(new Date('2026-03-05T00:00:00Z'))).toBe('2026-03-05');
  });
  it('rechaza fechas imposibles o en otro formato', () => {
    for (const v of ['31/02/2026', '2026-02-30', '2026/03/05', 'ayer', '', '13/13/2026']) expect(() => parseDate(v, 'dmy')).toThrow();
    expect(() => parseDate('05/03/2026')).toThrow(); expect(() => parseDate(new Date('x'))).toThrow(); expect(() => parseDate(20260305 as any)).toThrow();
  });
});
describe('getPath y mapRow', () => {
  it('lee rutas anidadas y bloquea prototipos', () => {
    const o = { a: { b: [{ c: 7 }] }, 'x': 1 };
    expect(getPath(o, 'a.b[0].c')).toBe(7); expect(getPath(o, 'a.z.q')).toBeUndefined(); expect(getPath(o, '__proto__.polluted')).toBeUndefined(); expect(getPath(o, 'constructor.name')).toBeUndefined();
  });
  const get = (r: any, ref: string) => getPath(r, ref);
  const V = DATASETS.ventas;
  it('mapea con valor fijo de moneda y valida moneda de 3 letras', () => {
    const m = { folio: 'n', cliente: 'c.name', fecha: 'd', total: 't', currency: { const: 'mxn' } };
    expect(mapRow({ n: 'A1', c: { name: 'Ana' }, d: '2026-01-02', t: '10.5' }, m, V, { decimal: '.', date_format: 'iso' }, get)).toEqual({ folio: 'A1', cliente: 'Ana', fecha: '2026-01-02', total: '10.5', currency: 'MXN' });
    expect(() => mapRow({ n: 'A1', c: { name: 'Ana' }, d: '2026-01-02', t: '1' }, { ...m, currency: { const: 'PESOS' } }, V, { decimal: '.', date_format: 'iso' }, get)).toThrow(/moneda/);
  });
  it('un campo obligatorio vacío o con dato malo es error con el nombre del campo', () => {
    const m = { folio: 'n', cliente: 'c', fecha: 'd', total: 't', currency: { const: 'MXN' } };
    expect(() => mapRow({ n: '', c: 'x', d: '2026-01-02', t: '1' }, m, V, { decimal: '.', date_format: 'iso' }, get)).toThrow(/Folio/);
    expect(() => mapRow({ n: '1', c: 'x', d: '2026-01-02', t: 'mucho' }, m, V, { decimal: '.', date_format: 'iso' }, get)).toThrow(/Total/);
    expect(() => mapRow({ n: '1', c: 'x', d: '02/01/2026', t: '1' }, m, V, { decimal: '.', date_format: 'iso' }, get)).toThrow(/Fecha/);
  });
});

describe('sanitizeMapping', () => {
  it('acepta columnas y valores fijos sólo en campos de texto/moneda', () => {
    expect(sanitizeMapping('ventas', { folio: 'A', cliente: { const: 'Mostrador' }, fecha: 'B', total: 'C', currency: { const: ' mxn ' } })).toMatchObject({ cliente: { const: 'Mostrador' }, currency: { const: 'mxn' } });
  });
  it('rechaza campos desconocidos, valores fijos en importes/fechas, objetos raros y tamaños excesivos', () => {
    for (const bad of [{ extra: 'x' }, { total: { const: '5' } }, { fecha: { const: '2026-01-01' } }, { folio: 5 }, { folio: { x: 1 } }, { folio: 'a'.repeat(201) }, { currency: { const: '' } }, null, [], 'x'])
      expect(() => sanitizeMapping('ventas', bad as any)).toThrow();
  });
});

// ───────── API genérica ─────────
const baseCfg = (over: Partial<GenericConfig> = {}): any => ({
  base_url: 'https://api.miempresa.mx/v1', auth: { type: 'bearer' }, decimal: '.', date_format: 'iso',
  queries: {
    ventas: { path: '/ventas', items_path: 'data', date_params: { from: 'desde', to: 'hasta' }, pagination: { type: 'none' }, fields: { folio: 'num', cliente: 'cliente.nombre', fecha: 'fecha', total: 'total', currency: 'moneda' } },
    cartera_cobrar: { path: '/cxc', items_path: 'items', fields: { folio: 'folio', tercero: 'cliente', vence: 'vence', saldo: 'saldo', currency: { const: 'MXN' } } },
    inventario: { path: '/inv', fields: { codigo: 'sku', producto: 'nombre', existencia: 'stock' } },
    clientes: { path: '/clientes', items_path: 'data', fields: { nombre: 'nombre', correo: 'email' } },
  }, ...over,
});
type Call = { url: string; init: any };
const api = (handler: (u: URL, init: any) => { status?: number; body?: unknown; raw?: string } | Promise<any>) => {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: any) => {
    calls.push({ url, init });
    const r: any = await handler(new URL(url), init);
    return new Response(r.raw ?? JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
};

describe('validateGenericConfig', () => {
  it('acepta una configuración válida y normaliza la URL', () => {
    const c = validateGenericConfig(baseCfg({ base_url: 'https://api.miempresa.mx/v1/' } as any));
    expect(c.base_url).toBe('https://api.miempresa.mx/v1'); expect(Object.keys(c.queries)).toEqual(['ventas', 'cartera_cobrar', 'inventario', 'clientes']);
  });
  const bad: [string, (c: any) => void][] = [
    ['http', (c) => { c.base_url = 'http://api.x.mx'; }], ['localhost', (c) => { c.base_url = 'https://localhost'; }], ['ip privada', (c) => { c.base_url = 'https://10.0.0.5'; }],
    ['auth inválida', (c) => { c.auth = { type: 'magia' }; }], ['header prohibido', (c) => { c.auth = { type: 'header', name: 'Host' }; }], ['sin nombre de header', (c) => { c.auth = { type: 'header' }; }],
    ['headers extra con Authorization', (c) => { c.headers = { Authorization: 'x' }; }], ['headers con salto de línea', (c) => { c.headers = { 'X-A': 'a\nb' }; }],
    ['ruta con ?', (c) => { c.queries.ventas.path = '/v?x=1'; }], ['ruta con ..', (c) => { c.queries.ventas.path = '/../etc'; }], ['ruta sin /', (c) => { c.queries.ventas.path = 'ventas'; }],
    ['ruta a otro host', (c) => { c.queries.ventas.path = '//evil.com/x'; }], ['ruta con url', (c) => { c.queries.ventas.path = '/a://b'; }],
    ['consulta desconocida', (c) => { c.queries.nomina = { path: '/n', fields: {} }; }], ['sin consultas', (c) => { c.queries = {}; }],
    ['falta campo obligatorio', (c) => { delete c.queries.ventas.fields.total; }], ['campo desconocido', (c) => { c.queries.ventas.fields.extra = 'x'; }],
    ['valor fijo en importe', (c) => { c.queries.ventas.fields.total = { const: '5' }; }], ['ruta de campo inválida', (c) => { c.queries.ventas.fields.folio = 'a b;c'; }],
    ['date_params en otro dataset', (c) => { c.queries.inventario.date_params = { from: 'a', to: 'b' }; }], ['paginación inválida', (c) => { c.queries.ventas.pagination = { type: 'x' }; }],
    ['page sin parámetro', (c) => { c.queries.ventas.pagination = { type: 'page' }; }], ['tamaño fuera de rango', (c) => { c.queries.ventas.pagination = { type: 'offset', offset_param: 'o', limit_param: 'l', size: 99999 }; }],
    ['decimal inválido', (c) => { c.decimal = ';'; }], ['formato de fecha inválido', (c) => { c.date_format = 'xx'; }],
  ];
  for (const [name, mut] of bad) it('rechaza: ' + name, () => { const c = baseCfg(); mut(c); expect(() => validateGenericConfig(c)).toThrow(); });
});

describe('GenericRestConnector', () => {
  const mk = (cfg: any, h: Parameters<typeof api>[0], secret = 'TOKEN') => { const a = api(h); return { ...a, c: new GenericRestConnector(validateGenericConfig(cfg), secret, a.fetcher, () => new Date('2026-02-01T12:00:00Z')) }; };
  const ventasRows = [
    { num: 'V1', cliente: { nombre: 'Ana' }, fecha: '2026-01-05', total: '1,000.10', moneda: 'MXN' },
    { num: 'V2', cliente: { nombre: 'Ana' }, fecha: '2026-01-20', total: 0.2, moneda: 'MXN' },
    { num: 'V3', cliente: { nombre: 'Beto' }, fecha: '2026-01-21', total: 50, moneda: 'USD' },
    { num: 'V4', cliente: { nombre: 'Fuera' }, fecha: '2025-12-31', total: 999, moneda: 'MXN' },
  ];
  it('SÓLO hace GET, con token, y manda el rango como parámetros', async () => {
    const { c, calls } = mk(baseCfg(), () => ({ body: { data: ventasRows } }));
    const r = await c.ventas({ from: '2026-01-01', to: '2026-01-31' });
    expect(calls).toHaveLength(1); expect(calls[0].init.method).toBe('GET'); expect(calls[0].init.body).toBeUndefined();
    expect(calls[0].init.headers.authorization).toBe('Bearer TOKEN'); expect(calls[0].init.redirect).toBe('error');
    const u = new URL(calls[0].url); expect(u.pathname).toBe('/v1/ventas'); expect(u.searchParams.get('desde')).toBe('2026-01-01'); expect(u.searchParams.get('hasta')).toBe('2026-01-31');
    expect(r.totals).toEqual([{ currency: 'MXN', total: '1000.30', count: 2 }, { currency: 'USD', total: '50.00', count: 1 }]); // V4 fuera de rango se descarta aunque la API lo mande
    expect(r.source).toContain('api.miempresa.mx');
    expect(r.topClientes).toEqual([{ cliente: 'Ana', currency: 'MXN', total: '1000.30' }, { cliente: 'Beto', currency: 'USD', total: '50.00' }]);
  });
  it('autenticación: header, basic y query', async () => {
    let r = mk(baseCfg({ auth: { type: 'header', name: 'X-Api-Key' } } as any), () => ({ body: { data: [] } })); await r.c.ventas({ from: '2026-01-01', to: '2026-01-02' });
    expect(r.calls[0].init.headers['X-Api-Key']).toBe('TOKEN'); expect(r.calls[0].init.headers.authorization).toBeUndefined();
    r = mk(baseCfg({ auth: { type: 'basic', user: 'ana' } } as any), () => ({ body: { data: [] } }), 'p@ss'); await r.c.ventas({ from: '2026-01-01', to: '2026-01-02' });
    expect(r.calls[0].init.headers.authorization).toBe('Basic ' + Buffer.from('ana:p@ss').toString('base64'));
    r = mk(baseCfg({ auth: { type: 'query', name: 'api_key' } } as any), () => ({ body: { data: [] } })); await r.c.ventas({ from: '2026-01-01', to: '2026-01-02' });
    expect(new URL(r.calls[0].url).searchParams.get('api_key')).toBe('TOKEN');
  });
  it('REGRESIÓN: un importe inválido en una fila falla con el número de registro (no se suma a ciegas)', async () => {
    const rows = [ventasRows[0], { ...ventasRows[1], total: 'N/A' }];
    const { c } = mk(baseCfg(), () => ({ body: { data: rows } }));
    await expect(c.ventas({ from: '2026-01-01', to: '2026-01-31' })).rejects.toThrow(/registro 2.*Total/s);
  });
  it('mensajes claros para 401, 404, 429, 500, JSON inválido, red caída y lista inexistente', async () => {
    const ex = async (h: any, re: RegExp) => { const { c } = mk(baseCfg(), h); await expect(c.ventas({ from: '2026-01-01', to: '2026-01-02' })).rejects.toThrow(re); };
    await ex(() => ({ status: 401 }), /rechazó las credenciales/); await ex(() => ({ status: 404 }), /no encontró la ruta \/v1\/ventas/); await ex(() => ({ status: 429 }), /limitó/); await ex(() => ({ status: 500 }), /error 500/);
    await ex(() => ({ raw: '<html>' }), /JSON válido/); await ex(() => { throw new TypeError('dns'); }, /No se pudo conectar/); await ex(() => ({ body: { otra: [] } }), /lista en "data"/);
  });
  it('una API que redirige se bloquea (redirect: error) y no filtra el token', async () => {
    const { c } = mk(baseCfg(), () => { throw new TypeError('redirect'); });
    await expect(c.ventas({ from: '2026-01-01', to: '2026-01-02' })).rejects.toThrow(/No se pudo conectar/);
  });
  it('paginación por página, offset, cursor y enlace', async () => {
    const item = (i: number) => ({ nombre: 'C' + i, email: `c${i}@x.mx` });
    // page
    let r = mk(baseCfg({ queries: { clientes: { path: '/clientes', items_path: 'data', pagination: { type: 'page', page_param: 'page', size_param: 'size', size: 2 }, fields: { nombre: 'nombre' } } } } as any),
      (u) => ({ body: { data: { 1: [item(1), item(2)], 2: [item(3), item(4)], 3: [item(5)] }[u.searchParams.get('page') as string] ?? [] } }));
    expect((await r.c.clientes()).map((x) => x.nombre)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5']); expect(r.calls.length).toBe(3); expect(new URL(r.calls[0].url).searchParams.get('size')).toBe('2');
    // offset
    r = mk(baseCfg({ queries: { clientes: { path: '/clientes', items_path: 'data', pagination: { type: 'offset', offset_param: 'offset', limit_param: 'limit', size: 2 }, fields: { nombre: 'nombre' } } } } as any),
      (u) => { const o = Number(u.searchParams.get('offset')); return { body: { data: [item(o + 1), item(o + 2)].slice(0, o >= 4 ? 0 : 2) } }; });
    expect((await r.c.clientes()).length).toBe(4);
    // cursor
    r = mk(baseCfg({ queries: { clientes: { path: '/clientes', items_path: 'data', pagination: { type: 'cursor', cursor_param: 'cursor', next_path: 'meta.next' }, fields: { nombre: 'nombre' } } } } as any),
      (u) => { const cu = u.searchParams.get('cursor'); return { body: cu === null ? { data: [item(1)], meta: { next: 'B' } } : cu === 'B' ? { data: [item(2)], meta: { next: 'C' } } : { data: [item(3)], meta: {} } }; });
    expect((await r.c.clientes()).map((x) => x.nombre)).toEqual(['C1', 'C2', 'C3']);
    // enlace siguiente (mismo servidor)
    r = mk(baseCfg({ queries: { clientes: { path: '/clientes', items_path: 'data', pagination: { type: 'link', next_path: 'links.next' }, fields: { nombre: 'nombre' } } } } as any),
      (u) => (u.searchParams.get('p') === '2' ? { body: { data: [item(2)], links: {} } } : { body: { data: [item(1)], links: { next: '/v1/clientes?p=2' } } }));
    expect((await r.c.clientes()).map((x) => x.nombre)).toEqual(['C1', 'C2']);
  });
  it('SEGURIDAD: un enlace "siguiente" hacia otro servidor se bloquea (nunca se le manda el token)', async () => {
    const r = mk(baseCfg({ queries: { clientes: { path: '/clientes', items_path: 'data', pagination: { type: 'link', next_path: 'links.next' }, fields: { nombre: 'nombre' } } } } as any),
      () => ({ body: { data: [{ nombre: 'A' }], links: { next: 'https://evil.example.com/steal' } } }));
    await expect(r.c.clientes()).rejects.toThrow(/otro servidor/);
    expect(r.calls.every((x) => new URL(x.url).hostname === 'api.miempresa.mx')).toBe(true);
  });
  it('un cursor que se repite no genera un bucle infinito', async () => {
    const r = mk(baseCfg({ queries: { clientes: { path: '/clientes', items_path: 'data', pagination: { type: 'cursor', cursor_param: 'c', next_path: 'next' }, fields: { nombre: 'nombre' } } } } as any), () => ({ body: { data: [{ nombre: 'A' }], next: 'SAME' } }));
    await r.c.clientes(); expect(r.calls.length).toBeLessThanOrEqual(3);
  });
  it('tope de 5,000 registros marca datos parciales', async () => {
    const big = Array.from({ length: 1000 }, (_, i) => ({ sku: 'S' + i, nombre: 'P' + i, stock: 1 }));
    const r = mk(baseCfg({ queries: { inventario: { path: '/inv', pagination: { type: 'page', page_param: 'p', size_param: 's', size: 1000 }, fields: { codigo: 'sku', producto: 'nombre', existencia: 'stock' } } } } as any), () => ({ body: big }));
    const inv = await r.c.inventario(); expect(inv.truncated).toBe(true); expect(r.calls.length).toBe(5);
  });
  it('cartera: ignora saldos en cero, calcula antigüedad con la fecha de corte y moneda fija', async () => {
    const { c } = mk(baseCfg(), () => ({ body: { items: [
      { folio: 'F1', cliente: 'A', vence: '2026-02-10', saldo: 100 }, { folio: 'F2', cliente: 'A', vence: '2026-01-20', saldo: '50.25' },
      { folio: 'F3', cliente: 'B', vence: '2025-10-01', saldo: 10 }, { folio: 'F4', cliente: 'C', vence: '2026-01-01', saldo: 0 }] } }));
    const r = await c.cuentasPorCobrar('2026-02-01');
    expect(r.totals).toEqual([{ currency: 'MXN', total: '160.25', count: 3 }]); expect(r.aging.find((a) => a.bucket === '1-30')?.total).toBe('50.25'); expect(r.aging.find((a) => a.bucket === '90+')?.total).toBe('10.00');
  });
  it('inventario y clientes filtran por texto; una consulta no configurada es ErpUnsupported', async () => {
    const { c } = mk(baseCfg(), (u) => ({ body: u.pathname.endsWith('/inv') ? [{ sku: 'T-1', nombre: 'Tornillo', stock: '12' }, { sku: 'M-1', nombre: 'Martillo', stock: 3 }] : { data: [{ nombre: 'Ana' }, { nombre: 'Luis' }] } }));
    expect((await c.inventario('torni')).filas.map((x) => x.producto)).toEqual(['Tornillo']); expect((await c.clientes('lu')).map((x) => x.nombre)).toEqual(['Luis']);
    await expect(c.cuentasPorPagar('2026-02-01')).rejects.toBeInstanceOf(ErpUnsupported); await expect(c.catalogoPublico()).rejects.toThrow(/Catálogo/);
  });
  it('ping con ruta propia, y sin ella valida la primera consulta', async () => {
    let r = mk(baseCfg({ ping_path: '/health' } as any), () => ({ body: { ok: true } })); expect((await r.c.ping()).ok).toBe(true); expect(new URL(r.calls[0].url).pathname).toBe('/v1/health');
    r = mk(baseCfg(), () => ({ body: { data: ventasRows } })); expect((await r.c.ping()).detail).toMatch(/validados/);
    r = mk(baseCfg(), () => ({ body: { data: [{ num: 'X' }] } })); await expect(r.c.ping()).rejects.toThrow(/Cliente|Fecha|Total/);
  });
  it('la muestra de configuración devuelve máx. 5 filas ya normalizadas', async () => {
    const { c } = mk(baseCfg(), () => ({ body: { data: Array.from({ length: 9 }, (_, i) => ({ ...ventasRows[0], num: 'V' + i })) } }));
    const s = await c.sample('ventas'); expect(s).toHaveLength(5); expect(s[0]).toEqual({ folio: 'V0', cliente: 'Ana', fecha: '2026-01-05', total: '1000.1', currency: 'MXN' });
  });
});

// ───────── archivos ─────────
describe('parseCsv', () => {
  it('detecta ; , tab, respeta comillas, saltos de línea internos y BOM', () => {
    const p = parseCsv('\uFEFFFolio;Cliente;Total\r\n"A;1";"Ana ""la jefa""";"1,234.50"\r\n\r\nB2;"Línea1\nLínea2";5\r\n');
    expect(p.headers).toEqual(['Folio', 'Cliente', 'Total']); expect(p.rows).toHaveLength(2);
    expect(p.rows[0]).toEqual({ Folio: 'A;1', Cliente: 'Ana "la jefa"', Total: '1,234.50' }); expect(p.rows[1].Cliente).toBe('Línea1\nLínea2');
    expect(parseCsv('a\tb\n1\t2').rows[0]).toEqual({ a: '1', b: '2' }); expect(parseCsv('a,b\n1,2').headers).toEqual(['a', 'b']);
  });
  it('números de fila reales del archivo (para reportar errores) y encabezados repetidos/vacíos', () => {
    const p = parseCsv('x,x,\n1,2,3\n\n4,5,6'); expect(p.headers).toEqual(['x', 'x (2)', 'Columna 3']); expect(p.rowNumbers).toEqual([2, 4]);
  });
  it('errores: comillas sin cerrar y archivo vacío', () => { expect(() => parseCsv('a,b\n"x,1')).toThrow(/comillas/); expect(() => parseCsv('  \n ')).toThrow(/vacío/); });
  it('decodeText: UTF-8 y Windows-1252 (Excel en español)', () => {
    expect(decodeText(new TextEncoder().encode('Razón'))).toBe('Razón'); expect(decodeText(Uint8Array.from([0x52, 0x61, 0x7a, 0xf3, 0x6e]))).toBe('Razón');
  });
});
describe('parseXlsx / parseDatasetFile', () => {
  async function xlsx(rows: unknown[][], blankFirst = 0) {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Datos'); for (let i = 0; i < blankFirst; i++) ws.addRow([]);
    rows.forEach((r) => ws.addRow(r)); return new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer);
  }
  it('lee fechas, números, fórmulas y encabezado tras filas vacías', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S'); ws.addRow([]); ws.addRow(['Folio', 'Fecha', 'Importe']);
    ws.addRow(['A1', new Date('2026-03-05T00:00:00Z'), 100.5]); ws.addRow(['A2', new Date('2026-03-06T00:00:00Z'), { formula: 'B1*2', result: 7 } as any]);
    const p = await parseXlsx(new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer));
    expect(p.headers).toEqual(['Folio', 'Fecha', 'Importe']); expect(p.rows).toHaveLength(2); expect(p.rowNumbers).toEqual([3, 4]); expect(p.rows[1].Importe).toBe(7);
    const n = normalizeRows('ventas', p, { folio: 'Folio', cliente: { const: 'Mostrador' } as any, fecha: 'Fecha', total: 'Importe', currency: { const: 'MXN' } }, { decimal: '.', date_format: 'iso' });
    expect(n.errors).toEqual([]); expect(n.rows).toEqual([
      { folio: 'A1', cliente: 'Mostrador', fecha: '2026-03-05', total: '100.5', currency: 'MXN' }, { folio: 'A2', cliente: 'Mostrador', fecha: '2026-03-06', total: '7', currency: 'MXN' }]);
  });
  it('parseDatasetFile elige por contenido y rechaza .xls, formatos raros y archivos enormes', async () => {
    const x = await xlsx([['a', 'b'], [1, 2]]); expect((await parseDatasetFile('datos.xlsx', x)).headers).toEqual(['a', 'b']); expect((await parseDatasetFile('sin_extension', x)).rows).toHaveLength(1);
    expect((await parseDatasetFile('d.csv', new TextEncoder().encode('a,b\n1,2'))).rows).toHaveLength(1);
    await expect(parseDatasetFile('viejo.xls', new TextEncoder().encode('x'))).rejects.toThrow(/xlsx/); await expect(parseDatasetFile('a.pdf', new TextEncoder().encode('x'))).rejects.toThrow(/Formato/);
    await expect(parseDatasetFile('a.csv', new Uint8Array(5_000_001))).rejects.toThrow(/grande/); await expect(parseDatasetFile('a.csv', new Uint8Array(0))).rejects.toThrow(/vacío/);
    await expect(parseXlsx(new TextEncoder().encode('no soy zip'))).rejects.toThrow(/No se pudo leer/);
  });
});
describe('suggestMapping y normalizeRows', () => {
  it('sugiere columnas por nombre en español sin repetir columnas', () => {
    const m = suggestMapping('ventas', ['No. Factura', 'Razón Social', 'Fecha', 'Importe Total', 'Divisa', 'Notas']);
    expect(m).toEqual({ folio: 'No. Factura', cliente: 'Razón Social', fecha: 'Fecha', total: 'Importe Total', currency: 'Divisa' });
    expect(Object.values(suggestMapping('cartera_cobrar', ['Folio', 'Cliente', 'Vencimiento', 'Saldo pendiente', 'Moneda'])).every(Boolean)).toBe(true);
    expect(suggestMapping('clientes', ['Algo raro']).nombre).toBeNull();
  });
  const parsed = parseCsv('Folio,Cliente,Fecha,Total,Moneda\nA1,Ana,2026-01-05,"1,000.10",MXN\nA2,Beto,2026-01-06,50,USD');
  const map = { folio: 'Folio', cliente: 'Cliente', fecha: 'Fecha', total: 'Total', currency: 'Moneda' };
  it('normaliza todo cuando es válido', () => {
    const n = normalizeRows('ventas', parsed, map, { decimal: '.', date_format: 'iso' }); expect(n.errors).toEqual([]); expect(n.rows).toEqual([
      { folio: 'A1', cliente: 'Ana', fecha: '2026-01-05', total: '1000.1', currency: 'MXN' }, { folio: 'A2', cliente: 'Beto', fecha: '2026-01-06', total: '50', currency: 'USD' }]);
  });
  it('REGRESIÓN: una sola fila mala invalida la carga completa y reporta fila y motivo (no se descarta en silencio)', () => {
    const bad = parseCsv('Folio,Cliente,Fecha,Total,Moneda\nA1,Ana,2026-01-05,100,MXN\nA2,Beto,2026-13-45,50,USD\nTOTAL,,,150,MXN');
    const n = normalizeRows('ventas', bad, map, { decimal: '.', date_format: 'iso' });
    expect(n.rows).toEqual([]); expect(n.errors.map((e) => e.row)).toEqual([3, 4]); expect(n.errors[0].message).toMatch(/Fecha/); expect(n.errors[1].message).toMatch(/Cliente/);
  });
  it('errores de mapeo: columna faltante o inexistente, archivo sin filas, y tope de 50 errores', () => {
    expect(normalizeRows('ventas', parsed, { ...map, total: null }, { decimal: '.', date_format: 'iso' }).errors[0].message).toMatch(/Total/);
    expect(normalizeRows('ventas', parsed, { ...map, total: 'Nada' }, { decimal: '.', date_format: 'iso' }).errors[0].message).toMatch(/no existe/);
    expect(normalizeRows('ventas', parseCsv('Folio,Cliente,Fecha,Total,Moneda'), map, { decimal: '.', date_format: 'iso' }).errors[0].message).toMatch(/no tiene filas/);
    const many = parseCsv('Folio,Cliente,Fecha,Total,Moneda\n' + Array.from({ length: 200 }, () => 'x,y,mal,1,MXN').join('\n'));
    expect(normalizeRows('ventas', many, map, { decimal: '.', date_format: 'iso' }).errors.length).toBe(50);
  });
  it('coma decimal y fechas DD/MM/AAAA (formato latino)', () => {
    const p = parseCsv('Folio;Cliente;Fecha;Total;Moneda\nA1;Ana;05/01/2026;"1.234,50";MXN');
    expect(normalizeRows('ventas', p, map, { decimal: ',', date_format: 'dmy' }).rows[0]).toMatchObject({ fecha: '2026-01-05', total: '1234.5' });
  });
});
describe('búsqueda por texto', () => {
  const inv = [{ codigo: 'T-14', producto: 'Tornillo 1/4"', existencia: '120', proyectado: '', udm: '' }, { codigo: 'M-01', producto: 'Martillo de uña', existencia: '3', proyectado: '', udm: '' }, { codigo: 'C-05', producto: 'Cámara de cobre', existencia: '0', proyectado: '', udm: '' }];
  const o = { source: 's', truncated: false };
  it('REGRESIÓN: plural/singular, acentos y mayúsculas no impiden encontrar el producto (hallado en prueba real: "Tornillos")', () => {
    for (const q of ['Tornillos', 'tornillo', 'TORNILLOS', 'camara', 'Cámaras', 'martillos de una']) expect(inventarioFromRows(inv, q, o).filas.length, q).toBe(1);
    expect(inventarioFromRows(inv, 'tornillos 1/4', o).filas).toHaveLength(1); expect(inventarioFromRows(inv, 'tornillos de oro', o).filas).toHaveLength(0);
    expect(inventarioFromRows(inv, undefined, o).filas).toHaveLength(3); expect(inventarioFromRows(inv, '   ', o).filas).toHaveLength(3); expect(inventarioFromRows(inv, 'T-14', o).filas).toHaveLength(1);
    expect(clientesFromRows([{ nombre: 'José Pérez', correo: '', telefono: '', ciudad: '' }], 'jose perez')).toHaveLength(1);
  });
  it('singularize sólo toca palabras largas que terminan en una sola s', () => {
    expect(singularize('Tornillos grandes')).toBe('Tornillo grande'); expect(singularize('gas')).toBe('gas'); expect(singularize('pass')).toBe('pass'); expect(singularize('  luces  ')).toBe('luce');
  });
});

describe('ranking de clientes', () => {
  it('REGRESIÓN: el top se calcula por moneda; nunca compara pesos con dólares', async () => {
    const f = new FilesConnector(async () => ({ meta: { filename: 'v.csv', uploaded_at: '2026-02-01T00:00:00Z' }, rows: [
      { folio: '1', cliente: 'Peso', fecha: '2026-01-05', total: '5000', currency: 'MXN' }, { folio: '2', cliente: 'Dolar', fecha: '2026-01-05', total: '90', currency: 'USD' }, { folio: '3', cliente: 'Peso2', fecha: '2026-01-05', total: '10', currency: 'MXN' }] }));
    const r = await f.ventas({ from: '2026-01-01', to: '2026-01-31' });
    expect(r.topClientes.map((x) => `${x.currency}:${x.cliente}`)).toEqual(['MXN:Peso', 'MXN:Peso2', 'USD:Dolar']);
  });
});
describe('FilesConnector', () => {
  const meta = { filename: 'ventas_enero.csv', uploaded_at: '2026-02-01T10:00:00Z' };
  const rows = [{ folio: 'A1', cliente: 'Ana', fecha: '2026-01-05', total: '1000.1', currency: 'MXN' }, { folio: 'A2', cliente: 'Ana', fecha: '2026-01-06', total: '0.2', currency: 'MXN' }, { folio: 'A3', cliente: 'Zed', fecha: '2026-03-01', total: '9', currency: 'MXN' }];
  const c = new FilesConnector(async (ds) => (ds === 'ventas' ? { rows, meta } : null));
  it('calcula con Decimal, filtra por rango y declara que NO es en vivo con nombre y fecha de carga', async () => {
    const r = await c.ventas({ from: '2026-01-01', to: '2026-01-31' });
    expect(r.totals).toEqual([{ currency: 'MXN', total: '1000.30', count: 2 }]); expect(r.source).toContain('ventas_enero.csv'); expect(r.source).toContain('2026-02-01'); expect(r.source).toContain('no es en vivo');
  });
  it('sin archivo cargado: error claro que dice dónde cargarlo', async () => {
    await expect(c.inventario()).rejects.toBeInstanceOf(ErpUnsupported); await expect(c.cuentasPorCobrar('2026-02-01')).rejects.toThrow(/Configuración → Datos/);
  });
  it('ping lista lo cargado y falla si no hay nada', async () => {
    expect((await c.ping()).detail).toContain('Ventas (3)'); await expect(new FilesConnector(async () => null).ping()).rejects.toThrow(/Aún no hay archivos/);
  });
});
describe('buildConnector', () => {
  it('elige el conector por tipo y valida la configuración', async () => {
    const deps = { loadDataset: async () => null };
    expect(buildConnector({ type: 'files', config: {}, secret: null }, deps)).toBeInstanceOf(FilesConnector);
    expect(buildConnector({ type: 'generic_rest', config: baseCfg(), secret: 't' }, deps)).toBeInstanceOf(GenericRestConnector);
    expect(buildConnector({ type: 'odoo', config: { url: 'https://odoo.example.com', db: 'd', username: 'u' }, secret: 'k' }, deps).constructor.name).toBe('OdooConnector');
    expect(() => buildConnector({ type: 'generic_rest', config: { base_url: 'http://x.mx' }, secret: null }, deps)).toThrow();
    expect(() => buildConnector({ type: 'sap' as any, config: {}, secret: null }, deps)).toThrow(/desconocido/);
  });
});
