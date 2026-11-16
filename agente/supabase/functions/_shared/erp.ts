// Contrato común de conectores ERP. SÓLO LECTURA: no existe ningún método de escritura.
import Decimal from 'decimal.js';

export interface DateRange { from: string; to: string } // YYYY-MM-DD, inclusivos
export interface CurrencyTotal { currency: string; total: string; count: number }

export interface VentasResult {
  from: string; to: string; orderCount: number;
  totals: CurrencyTotal[];
  topClientes: { cliente: string; currency: string; total: string }[];
  pedidos: { folio: string; cliente: string; fecha: string; currency: string; total: string }[];
  truncated: boolean; note: string;
}
export type AgingBucket = 'al_corriente' | '1-30' | '31-60' | '61-90' | '90+';
export interface CarteraResult {
  asOf: string; totals: CurrencyTotal[];
  aging: { bucket: AgingBucket; currency: string; total: string }[];
  documentos: { folio: string; tercero: string; vence: string; diasVencido: number; currency: string; saldo: string }[];
  truncated: boolean;
}
export interface InventarioResult {
  filas: { codigo: string; producto: string; existencia: string; proyectado: string; udm: string }[];
  truncated: boolean;
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
