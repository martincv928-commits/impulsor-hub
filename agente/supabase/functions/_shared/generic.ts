// Conector genérico de API REST (SÓLO LECTURA: únicamente peticiones GET). Se configura por empresa: rutas, paginación y campos.
import Decimal from 'decimal.js';
import { carteraFromRows, catalogoFromRows, clientesFromRows, ErpUnsupported, inventarioFromRows, ventasFromRows, type CarteraResult, type ClienteRow, type DateRange, type ErpConnector, type InventarioResult, type VentasResult } from './erp.ts';
import { DATASETS, DATASET_KEYS, DEFAULT_OPTS, getPath, mapRow, MapError, type DatasetKey, type FieldRef, type ParseOpts } from './mapping.ts';
import { assertSafeUrl } from './net.ts';

export interface PaginationCfg { type: 'none' | 'page' | 'offset' | 'cursor' | 'link'; page_param?: string; size_param?: string; size?: number; start?: number; offset_param?: string; limit_param?: string; cursor_param?: string; next_path?: string }
export interface QueryCfg { path: string; params?: Record<string, string>; date_params?: { from: string; to: string }; items_path?: string; pagination?: PaginationCfg; fields: Record<string, FieldRef> }
export interface GenericConfig {
  base_url: string;
  auth: { type: 'none' | 'bearer' | 'header' | 'basic' | 'query'; name?: string; user?: string };
  headers?: Record<string, string>;
  ping_path?: string;
  decimal?: '.' | ','; date_format?: 'iso' | 'dmy' | 'mdy';
  queries: Partial<Record<DatasetKey, QueryCfg>>;
}

const MAX_PAGES = 20, MAX_ITEMS = 5000, MAX_BYTES = 8_000_000;
const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PATHREF_RE = /^[A-Za-z0-9_.\[\]-]{0,200}$/;
const FORBIDDEN_HEADERS = new Set(['host', 'cookie', 'set-cookie', 'content-length', 'transfer-encoding', 'connection', 'authorization', 'proxy-authorization', 'x-forwarded-for', 'x-forwarded-host']);
const obj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);

export function safePath(p: unknown, what = 'La ruta'): string {
  if (typeof p !== 'string' || !p.startsWith('/') || p.startsWith('//') || p.length > 300 || /[\s?#\\]|\.\./.test(p) || p.includes('://')) throw new Error(`${what} debe empezar con "/" y no incluir espacios, "?", "#" ni ".." (ej. /api/ventas)`);
  return p;
}
const small = (v: unknown, n: number, what: string): string => { if (typeof v !== 'string' || !v.trim() || v.length > n || /[\r\n]/.test(v)) throw new Error(`${what} no es válido`); return v; };

function validateQuery(ds: DatasetKey, q: unknown): QueryCfg {
  const label = DATASETS[ds].label;
  if (!obj(q)) throw new Error(`${label}: configuración inválida`);
  const out: QueryCfg = { path: safePath(q.path, `${label}: la ruta`), fields: {} };
  if (q.params != null) {
    if (!obj(q.params) || Object.keys(q.params).length > 10) throw new Error(`${label}: parámetros inválidos (máx. 10)`);
    out.params = {}; for (const [k, v] of Object.entries(q.params)) { if (!NAME_RE.test(k)) throw new Error(`${label}: nombre de parámetro inválido "${k}"`); out.params[k] = small(String(v), 200, `${label}: valor de "${k}"`); }
  }
  if (q.date_params != null) {
    if (ds !== 'ventas') throw new Error(`${label}: los parámetros de fecha sólo aplican a Ventas`);
    if (!obj(q.date_params) || !NAME_RE.test(String(q.date_params.from)) || !NAME_RE.test(String(q.date_params.to))) throw new Error('Ventas: nombres de parámetros de fecha inválidos');
    out.date_params = { from: q.date_params.from, to: q.date_params.to };
  }
  if (q.items_path != null) { if (typeof q.items_path !== 'string' || !PATHREF_RE.test(q.items_path)) throw new Error(`${label}: "ruta de la lista" inválida`); out.items_path = q.items_path; }
  if (q.pagination != null) {
    const p = q.pagination; if (!obj(p) || !['none', 'page', 'offset', 'cursor', 'link'].includes(p.type)) throw new Error(`${label}: paginación inválida`);
    const pg: PaginationCfg = { type: p.type };
    const num = (v: unknown, lo: number, hi: number, w: string) => { if (v == null) return undefined; const n = Number(v); if (!Number.isInteger(n) || n < lo || n > hi) throw new Error(`${label}: ${w} fuera de rango`); return n; };
    const nm = (v: unknown, w: string) => { if (v == null || v === '') return undefined; if (typeof v !== 'string' || !NAME_RE.test(v)) throw new Error(`${label}: ${w} inválido`); return v; };
    if (p.type === 'page') { pg.page_param = nm(p.page_param, 'parámetro de página'); pg.size_param = nm(p.size_param, 'parámetro de tamaño'); pg.size = num(p.size, 1, 1000, 'tamaño'); pg.start = num(p.start, 0, 1, 'página inicial'); if (!pg.page_param) throw new Error(`${label}: falta el parámetro de página`); }
    if (p.type === 'offset') { pg.offset_param = nm(p.offset_param, 'parámetro offset'); pg.limit_param = nm(p.limit_param, 'parámetro límite'); pg.size = num(p.size, 1, 1000, 'tamaño'); if (!pg.offset_param || !pg.limit_param || !pg.size) throw new Error(`${label}: offset requiere parámetro offset, límite y tamaño`); }
    if (p.type === 'cursor') { pg.cursor_param = nm(p.cursor_param, 'parámetro de cursor'); if (typeof p.next_path !== 'string' || !p.next_path || !PATHREF_RE.test(p.next_path)) throw new Error(`${label}: falta la ruta del cursor siguiente`); pg.next_path = p.next_path; if (!pg.cursor_param) throw new Error(`${label}: falta el parámetro de cursor`); }
    if (p.type === 'link') { if (typeof p.next_path !== 'string' || !p.next_path || !PATHREF_RE.test(p.next_path)) throw new Error(`${label}: falta la ruta del enlace siguiente`); pg.next_path = p.next_path; }
    out.pagination = pg;
  }
  if (!obj(q.fields)) throw new Error(`${label}: faltan los campos`);
  const spec = DATASETS[ds];
  for (const k of Object.keys(q.fields)) if (!spec.fields.some((x) => x.key === k)) throw new Error(`${label}: campo desconocido "${k}"`);
  for (const fld of spec.fields) {
    const ref = q.fields[fld.key];
    if (ref == null || ref === '') { if (fld.required) throw new Error(`${label}: falta indicar el campo "${fld.label}"`); continue; }
    if (typeof ref === 'string') { if (!PATHREF_RE.test(ref) || !ref) throw new Error(`${label}: ruta inválida para "${fld.label}"`); out.fields[fld.key] = ref; }
    else if (obj(ref) && typeof ref.const === 'string') {
      if (!['text', 'currency'].includes(fld.kind)) throw new Error(`${label}: "${fld.label}" no admite un valor fijo`);
      if (!ref.const.trim() || ref.const.length > 20) throw new Error(`${label}: valor fijo inválido para "${fld.label}"`);
      out.fields[fld.key] = { const: ref.const.trim() };
    } else throw new Error(`${label}: referencia inválida para "${fld.label}"`);
  }
  return out;
}

/** Valida y normaliza la configuración. Lanza Error con un mensaje en español. */
export function validateGenericConfig(raw: unknown): GenericConfig {
  if (!obj(raw)) throw new Error('Configuración inválida');
  const u = assertSafeUrl(String(raw.base_url ?? '').trim());
  const cfg: GenericConfig = { base_url: u.origin + u.pathname.replace(/\/+$/, ''), auth: { type: 'none' }, queries: {} };
  const a = raw.auth;
  if (!obj(a) || !['none', 'bearer', 'header', 'basic', 'query'].includes(a.type)) throw new Error('Tipo de autenticación inválido');
  cfg.auth = { type: a.type };
  if (a.type === 'header' || a.type === 'query') {
    if (typeof a.name !== 'string' || !NAME_RE.test(a.name)) throw new Error('Falta el nombre del encabezado/parámetro de la llave');
    if (a.type === 'header' && FORBIDDEN_HEADERS.has(a.name.toLowerCase())) throw new Error('Ese nombre de encabezado no está permitido');
    cfg.auth.name = a.name;
  }
  if (a.type === 'basic') cfg.auth.user = small(a.user, 200, 'El usuario');
  if (raw.headers != null) {
    if (!obj(raw.headers) || Object.keys(raw.headers).length > 10) throw new Error('Encabezados inválidos (máx. 10)');
    cfg.headers = {};
    for (const [k, v] of Object.entries(raw.headers)) {
      if (!NAME_RE.test(k) || FORBIDDEN_HEADERS.has(k.toLowerCase())) throw new Error(`Encabezado no permitido: ${k}`);
      cfg.headers[k] = small(String(v), 200, `Valor del encabezado ${k}`);
    }
  }
  if (raw.ping_path != null && raw.ping_path !== '') cfg.ping_path = safePath(raw.ping_path, 'La ruta de prueba');
  if (raw.decimal != null) { if (!['.', ','].includes(raw.decimal)) throw new Error('Separador decimal inválido'); cfg.decimal = raw.decimal; }
  if (raw.date_format != null) { if (!['iso', 'dmy', 'mdy'].includes(raw.date_format)) throw new Error('Formato de fecha inválido'); cfg.date_format = raw.date_format; }
  if (!obj(raw.queries)) throw new Error('Configura al menos una consulta');
  for (const k of Object.keys(raw.queries)) {
    if (!DATASET_KEYS.includes(k as DatasetKey)) throw new Error(`Consulta desconocida: ${k}`);
    if (raw.queries[k] == null) continue;
    cfg.queries[k as DatasetKey] = validateQuery(k as DatasetKey, raw.queries[k]);
  }
  if (!Object.keys(cfg.queries).length) throw new Error('Configura al menos una consulta');
  return cfg;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export class GenericRestConnector implements ErpConnector {
  private base: URL;
  constructor(private cfg: GenericConfig, private secret: string, private fetcher: typeof fetch = fetch, private now: () => Date = () => new Date()) {
    this.base = assertSafeUrl(cfg.base_url);
  }
  private get source() { return `API de ${this.base.hostname} (consulta en vivo)`; }
  private get opts(): ParseOpts { return { decimal: this.cfg.decimal ?? DEFAULT_OPTS.decimal, date_format: this.cfg.date_format ?? DEFAULT_OPTS.date_format }; }

  private buildUrl(path: string, params: Record<string, string>): URL {
    const u = new URL(this.base.origin + this.base.pathname.replace(/\/+$/, '') + path);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    if (this.cfg.auth.type === 'query' && this.cfg.auth.name) u.searchParams.set(this.cfg.auth.name, this.secret);
    return u;
  }
  private headers(): Record<string, string> {
    const h: Record<string, string> = { accept: 'application/json', ...(this.cfg.headers ?? {}) };
    const a = this.cfg.auth;
    if (a.type === 'bearer') h.authorization = `Bearer ${this.secret}`;
    else if (a.type === 'header' && a.name) h[a.name] = this.secret;
    else if (a.type === 'basic') h.authorization = 'Basic ' + btoa(unescape(encodeURIComponent(`${a.user ?? ''}:${this.secret}`)));
    return h;
  }
  /** Única salida de red: GET, sin redirecciones, con límite de tamaño y de tiempo. */
  private async getJson(url: URL): Promise<any> {
    if (url.origin !== this.base.origin) throw new Error('La API intentó llevar la consulta a otro servidor; se bloqueó por seguridad.');
    let res: Response;
    try { res = await this.fetcher(url.toString(), { method: 'GET', headers: this.headers(), redirect: 'error', signal: AbortSignal.timeout(30000) }); }
    catch { throw new Error('No se pudo conectar con la API. Revisa la dirección y que sea accesible desde internet.'); }
    if (res.status === 401 || res.status === 403) throw new Error('La API rechazó las credenciales (401/403). Revisa la llave o el usuario.');
    if (res.status === 404) throw new Error(`La API no encontró la ruta ${url.pathname} (404).`);
    if (res.status === 429) throw new Error('La API limitó las consultas (429). Intenta de nuevo en unos minutos.');
    if (!res.ok) throw new Error(`La API respondió con error ${res.status}.`);
    const txt = await res.text();
    if (txt.length > MAX_BYTES) throw new Error('La respuesta de la API es demasiado grande.');
    try { return JSON.parse(txt); } catch { throw new Error('La API no devolvió JSON válido. ¿La ruta es la correcta?'); }
  }

  private async fetchItems(ds: DatasetKey, extra: Record<string, string> = {}): Promise<{ items: unknown[]; truncated: boolean }> {
    const q = this.cfg.queries[ds];
    if (!q) throw new ErpUnsupported(`Esta conexión no tiene configurada la consulta de ${DATASETS[ds].label}.`);
    const pg: PaginationCfg = q.pagination ?? { type: 'none' };
    const items: unknown[] = []; let truncated = false;
    let page = pg.start ?? 1, offset = 0, cursor: string | undefined, link: string | undefined, prevToken: string | undefined;
    for (let i = 0; i < MAX_PAGES; i++) {
      const params: Record<string, string> = { ...(q.params ?? {}), ...extra };
      if (pg.type === 'page') { params[pg.page_param!] = String(page); if (pg.size_param && pg.size) params[pg.size_param] = String(pg.size); }
      if (pg.type === 'offset') { params[pg.offset_param!] = String(offset); params[pg.limit_param!] = String(pg.size); }
      if (pg.type === 'cursor' && cursor) params[pg.cursor_param!] = cursor;
      const url = pg.type === 'link' && link ? new URL(link, this.base.origin + this.base.pathname + '/') : this.buildUrl(q.path, params);
      if (pg.type === 'link' && link && this.cfg.auth.type === 'query' && this.cfg.auth.name) url.searchParams.set(this.cfg.auth.name, this.secret);
      const body = await this.getJson(url);
      const list = q.items_path ? getPath(body, q.items_path) : body;
      if (!Array.isArray(list)) throw new Error(q.items_path ? `No se encontró una lista en "${q.items_path}" dentro de la respuesta.` : 'La respuesta no es una lista. Indica la "ruta de la lista" (p. ej. data).');
      items.push(...list);
      if (items.length >= MAX_ITEMS) { items.length = MAX_ITEMS; truncated = true; break; }
      if (pg.type === 'none' || list.length === 0) break;
      if (pg.type === 'page') { if (pg.size && list.length < pg.size) break; page += 1; }
      else if (pg.type === 'offset') { offset += list.length; if (list.length < pg.size!) break; }
      else if (pg.type === 'cursor') { const n = getPath(body, pg.next_path!); if (n == null || n === '' || String(n) === prevToken) break; cursor = prevToken = String(n); }
      else if (pg.type === 'link') { const n = getPath(body, pg.next_path!); if (typeof n !== 'string' || !n || n === prevToken) break; link = prevToken = n; }
      if (i === MAX_PAGES - 1) truncated = true;
    }
    return { items, truncated };
  }

  private async rows(ds: DatasetKey, extra: Record<string, string> = {}) {
    const q = this.cfg.queries[ds]!;
    const { items, truncated } = await this.fetchItems(ds, extra);
    const spec = DATASETS[ds];
    const out = items.map((it, i) => {
      try { return mapRow(it, q.fields, spec, this.opts, (r, ref) => getPath(r, ref)); }
      catch (e) { throw new Error(`${spec.label}, registro ${i + 1}: ${e instanceof MapError ? e.message : 'dato inválido'}. Revisa la configuración de campos.`); }
    });
    return { rows: out, truncated };
  }

  async ping() {
    if (this.cfg.ping_path) { await this.getJson(this.buildUrl(this.cfg.ping_path, {})); return { ok: true as const, detail: 'La API responde correctamente.' }; }
    const ds = (Object.keys(this.cfg.queries) as DatasetKey[])[0];
    const extra = ds === 'ventas' && this.cfg.queries.ventas?.date_params ? { [this.cfg.queries.ventas.date_params.from]: iso(new Date(this.now().getTime() - 30 * 86400000)), [this.cfg.queries.ventas.date_params.to]: iso(this.now()) } : {};
    const r = await this.sample(ds, extra);
    return { ok: true as const, detail: `La API responde. Muestra de ${DATASETS[ds].label}: ${r.length} registro(s) leídos y validados.` };
  }
  /** Primera página mapeada (para probar la configuración en la pantalla). */
  async sample(ds: DatasetKey, extra: Record<string, string> = {}): Promise<Record<string, string>[]> {
    const q = this.cfg.queries[ds];
    if (!q) throw new ErpUnsupported(`Esta conexión no tiene configurada la consulta de ${DATASETS[ds].label}.`);
    const one: GenericRestConnector = new GenericRestConnector({ ...this.cfg, queries: { [ds]: { ...q, pagination: { type: 'none' } } } }, this.secret, this.fetcher, this.now);
    return (await one.rows(ds, extra)).rows.slice(0, 5);
  }

  async ventas(r: DateRange): Promise<VentasResult> {
    const dp = this.cfg.queries.ventas?.date_params;
    const { rows, truncated } = await this.rows('ventas', dp ? { [dp.from]: r.from, [dp.to]: r.to } : {});
    return ventasFromRows(rows as any, r, { source: this.source, truncated, note: 'Datos leídos de la API configurada y filtrados por fecha de la consulta. Importe tal como lo entrega la API.' });
  }
  private async cartera(ds: 'cartera_cobrar' | 'cartera_pagar', asOf: string): Promise<CarteraResult> {
    const { rows, truncated } = await this.rows(ds);
    return carteraFromRows(rows as any, asOf, { source: this.source, truncated });
  }
  cuentasPorCobrar(asOf: string) { return this.cartera('cartera_cobrar', asOf); }
  cuentasPorPagar(asOf: string) { return this.cartera('cartera_pagar', asOf); }
  async inventario(q?: string): Promise<InventarioResult> { const { rows, truncated } = await this.rows('inventario'); return inventarioFromRows(rows as any, q, { source: this.source, truncated }); }
  async clientes(q?: string): Promise<ClienteRow[]> { return clientesFromRows((await this.rows('clientes')).rows as any, q); }
  async catalogoPublico(q?: string) { const r = await this.rows('catalogo'); const c = catalogoFromRows(r.rows as any, q); return { filas: c.filas, truncated: c.truncated || r.truncated }; }
}
