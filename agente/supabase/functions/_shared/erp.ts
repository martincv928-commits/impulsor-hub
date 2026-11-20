// Contrato común de conectores ERP. SÓLO LECTURA: no existe ningún método de escritura.
import Decimal from 'decimal.js';

export class ErpUnsupported extends Error {}

export interface DateRange { from: string; to: string } // YYYY-MM-DD, inclusivos
export interface CurrencyTotal { currency: string; total: string; count: number }

export interface VentasResult {
  from: string; to: string; orderCount: number;
  totals: CurrencyTotal[];
  topClientes: { cliente: string; currency: string; total: string }[];
  pedidos: { folio: string; cliente: string; fecha: string; currency: string; total: string }[];
  truncated: boolean; note: string; source?: string;
}
export type AgingBucket = 'al_corriente' | '1-30' | '31-60' | '61-90' | '90+';
export interface CarteraResult {
  asOf: string; totals: CurrencyTotal[];
  aging: { bucket: AgingBucket; currency: string; total: string }[];
  documentos: { folio: string; tercero: string; vence: string; diasVencido: number; currency: string; saldo: string }[];
  truncated: boolean; source?: string;
}
export interface InventarioResult {
  filas: { codigo: string; producto: string; existencia: string; proyectado: string; udm: string }[];
  truncated: boolean; source?: string;
}
export interface ClienteRow { nombre: string; correo: string; telefono: string; ciudad: string }
export interface CatalogoRow { nombre: string; precio: string; moneda: string; descripcion: string }

export interface ErpConnector {
  ping(): Promise<{ ok: true; detail: string }>;
  ventas(r: DateRange): Promise<VentasResult>;
  cuentasPorCobrar(asOf: string): Promise<CarteraResult>;
  cuentasPorPagar(asOf: string): Promise<CarteraResult>;
  inventario(q?: string): Promise<InventarioResult>;
  clientes(q?: string): Promise<ClienteRow[]>;
  /** Sólo productos publicados en el sitio web. */
  catalogoPublico(q?: string): Promise<{ filas: CatalogoRow[]; truncated: boolean }>;
}

export function isValidDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso + 'T00:00:00Z') - Date.parse(fromIso + 'T00:00:00Z')) / 86400000);
}

export function agingBucket(daysOverdue: number): AgingBucket {
  if (daysOverdue <= 0) return 'al_corriente';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '90+';
}

/** Suma por moneda con Decimal (nunca mezcla monedas, nunca float). */
export function sumByCurrency(rows: { currency: string; amount: string | number }[]): CurrencyTotal[] {
  const m = new Map<string, { t: Decimal; n: number }>();
  for (const r of rows) {
    const e = m.get(r.currency) ?? { t: new Decimal(0), n: 0 };
    e.t = e.t.plus(new Decimal(String(r.amount)));
    e.n += 1;
    m.set(r.currency, e);
  }
  return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, e]) => ({ currency, total: e.t.toFixed(2), count: e.n }));
}

// ---- Constructores comunes de resultados (los usan Odoo, API genérica y archivos: una sola lógica de sumas y antigüedad) ----
const money2 = (v: unknown): string => new Decimal(String(v ?? 0)).toFixed(2);
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
/** Plural simple en español → singular ("tornillos" → "tornillo"); sirve para búsquedas por texto. */
export const singularize = (q: string): string => q.trim().split(/\s+/).map((w) => (w.length > 3 && /[^s]s$/i.test(w) ? w.slice(0, -1) : w)).join(' ');
/** Coincidencia tolerante: sin acentos ni mayúsculas, plural/singular, y deben aparecer TODAS las palabras. */
const includes = (hay: string, q?: string) => { if (!q || !q.trim()) return true; const h = fold(hay); return fold(singularize(q)).split(' ').filter(Boolean).every((w) => h.includes(w)); };

export interface VentaRow { folio: string; cliente: string; fecha: string; currency: string; total: string }
export function ventasFromRows(rows: VentaRow[], r: DateRange, o: { note: string; source: string; truncated: boolean }): VentasResult {
  const pedidos = rows.filter((x) => x.fecha >= r.from && x.fecha <= r.to)
    .map((x) => ({ folio: x.folio, cliente: x.cliente, fecha: x.fecha, currency: x.currency, total: money2(x.total) }));
  const byClient = new Map<string, Decimal>();
  for (const p of pedidos) { const k = p.cliente + '\u0000' + p.currency; byClient.set(k, (byClient.get(k) ?? new Decimal(0)).plus(p.total)); }
  // Ranking POR MONEDA (comparar pesos con dólares como si fueran la misma unidad daría un orden sin sentido).
  const all = [...byClient.entries()].map(([k, t]) => { const [cliente, currency] = k.split('\u0000'); return { cliente, currency, total: t }; });
  const topClientes = [...new Set(all.map((x) => x.currency))].sort().flatMap((cur) =>
    all.filter((x) => x.currency === cur).sort((a, b) => b.total.comparedTo(a.total)).slice(0, 5).map((x) => ({ ...x, total: x.total.toFixed(2) })));
  return { from: r.from, to: r.to, orderCount: pedidos.length, totals: sumByCurrency(pedidos.map((p) => ({ currency: p.currency, amount: p.total }))), topClientes, pedidos, truncated: o.truncated, note: o.note, source: o.source };
}

export interface CarteraRow { folio: string; tercero: string; vence: string; currency: string; saldo: string }
export function carteraFromRows(rows: CarteraRow[], asOf: string, o: { source: string; truncated: boolean }): CarteraResult {
  const documentos = rows.filter((d) => new Decimal(d.saldo).gt(0)).map((d) => ({
    folio: d.folio, tercero: d.tercero, vence: d.vence, diasVencido: d.vence ? daysBetween(d.vence, asOf) : 0, currency: d.currency, saldo: money2(d.saldo),
  }));
  const ag = new Map<string, Decimal>();
  for (const d of documentos) { const k = agingBucket(d.diasVencido) + '|' + d.currency; ag.set(k, (ag.get(k) ?? new Decimal(0)).plus(d.saldo)); }
  return {
    asOf, totals: sumByCurrency(documentos.map((d) => ({ currency: d.currency, amount: d.saldo }))),
    aging: [...ag.entries()].map(([k, t]) => { const [bucket, currency] = k.split('|'); return { bucket: bucket as AgingBucket, currency, total: t.toFixed(2) }; }),
    documentos, truncated: o.truncated, source: o.source,
  };
}

export interface InventarioRow { codigo: string; producto: string; existencia: string; proyectado: string; udm: string }
export function inventarioFromRows(rows: InventarioRow[], q: string | undefined, o: { source: string; truncated: boolean; limit?: number }): InventarioResult {
  const lim = o.limit ?? 500;
  const f = rows.filter((x) => includes(x.producto + ' ' + x.codigo, q));
  return { filas: f.slice(0, lim), truncated: o.truncated || f.length > lim, source: o.source };
}
export function clientesFromRows(rows: ClienteRow[], q?: string): ClienteRow[] { return rows.filter((x) => includes(x.nombre, q)).slice(0, 50); }
export function catalogoFromRows(rows: { nombre: string; precio: string; moneda: string; descripcion: string }[], q?: string): { filas: CatalogoRow[]; truncated: boolean } {
  const f = rows.filter((x) => includes(x.nombre, q));
  return { filas: f.slice(0, 30).map((x) => ({ nombre: x.nombre, precio: money2(x.precio), moneda: x.moneda, descripcion: x.descripcion.slice(0, 300) })), truncated: f.length > 30 };
}
