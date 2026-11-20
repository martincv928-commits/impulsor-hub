// Conector Odoo (JSON-RPC). SÓLO LECTURA: lista blanca de métodos; cualquier otro lanza error.
import Decimal from 'decimal.js';
import { carteraFromRows, inventarioFromRows, ventasFromRows, type CarteraResult, type CatalogoRow, type ClienteRow, type DateRange, type ErpConnector, type InventarioResult, type VentasResult } from './erp.ts';
import { assertSafeUrl } from './net.ts';

export const ODOO_READ_METHODS = new Set(['search_read', 'search_count', 'read_group', 'fields_get']);
const LIMIT = 5000;
const SOURCE = 'Odoo (consulta en vivo)';

export interface OdooConfig { url: string; db: string; username: string; apiKey: string }
export class OdooError extends Error {}

type Row = Record<string, any>;
const m2o = (v: unknown): string => (Array.isArray(v) ? String(v[1] ?? '') : '');
const str = (v: unknown): string => (v === false || v == null ? '' : String(v));
const money = (v: unknown): string => new Decimal(String(v ?? 0)).toFixed(2);

export class OdooConnector implements ErpConnector {
  private uid: number | null = null;
  private base: string;
  constructor(private cfg: OdooConfig, private fetcher: typeof fetch = fetch) {
    this.base = assertSafeUrl(cfg.url).origin + assertSafeUrl(cfg.url).pathname.replace(/\/+$/, '');
  }

  private async rpc(service: 'common' | 'object', method: string, args: unknown[]): Promise<any> {
    let res: Response;
    try {
      res = await this.fetcher(this.base + '/jsonrpc', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { service, method, args }, id: 1 }),
        redirect: 'error', signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new OdooError('No se pudo conectar con Odoo. Revisa que la URL sea correcta y accesible desde internet.');
    }
    if (!res.ok) throw new OdooError(`Odoo respondió HTTP ${res.status}`);
    const j: any = await res.json().catch(() => { throw new OdooError('Odoo respondió algo inesperado. ¿La URL es la de tu Odoo?'); });
    if (j.error) throw new OdooError(String(j.error?.data?.message ?? j.error?.message ?? 'Error de Odoo').slice(0, 300));
    return j.result;
  }

  private async auth(): Promise<number> {
    if (this.uid != null) return this.uid;
    const uid = await this.rpc('common', 'authenticate', [this.cfg.db, this.cfg.username, this.cfg.apiKey, {}]);
    if (!uid || typeof uid !== 'number') throw new OdooError('Credenciales de Odoo inválidas (base, usuario o API key)');
    return (this.uid = uid);
  }

  /** Único punto de salida hacia execute_kw: aplica la lista blanca de sólo lectura. */
  async read(model: string, method: string, args: unknown[], kwargs: Row = {}): Promise<any> {
    if (!ODOO_READ_METHODS.has(method)) throw new OdooError(`Método no permitido (sólo lectura): ${method}`);
    const uid = await this.auth();
    return this.rpc('object', 'execute_kw', [this.cfg.db, uid, this.cfg.apiKey, model, method, args, kwargs]);
  }

  async ping() {
    const uid = await this.auth();
    const v = await this.rpc('common', 'version', []);
    return { ok: true as const, detail: `Odoo ${v?.server_version ?? '?'} · uid ${uid}` };
  }

  async ventas(r: DateRange): Promise<VentasResult> {
    const rows: Row[] = await this.read('sale.order', 'search_read',
      [[['state', 'in', ['sale', 'done']], ['date_order', '>=', `${r.from} 00:00:00`], ['date_order', '<=', `${r.to} 23:59:59`]]],
      { fields: ['name', 'partner_id', 'date_order', 'amount_total', 'currency_id'], limit: LIMIT, order: 'date_order asc' });
    return ventasFromRows(
      rows.map((o) => ({ folio: str(o.name), cliente: m2o(o.partner_id), fecha: str(o.date_order).slice(0, 10), currency: m2o(o.currency_id), total: money(o.amount_total) })), r,
      { source: SOURCE, truncated: rows.length >= LIMIT,
        note: 'Pedidos confirmados (estado venta/hecho), importe total con impuestos. Rango en hora UTC del servidor Odoo; en los bordes puede diferir de la hora local.' });
  }

  private async cartera(moveType: 'out_invoice' | 'in_invoice', asOf: string): Promise<CarteraResult> {
    const rows: Row[] = await this.read('account.move', 'search_read',
      [[['move_type', '=', moveType], ['state', '=', 'posted'], ['payment_state', 'in', ['not_paid', 'partial']], ['amount_residual', '>', 0]]],
      { fields: ['name', 'partner_id', 'invoice_date_due', 'amount_residual', 'currency_id'], limit: LIMIT, order: 'invoice_date_due asc' });
    return carteraFromRows(
      rows.map((d) => ({ folio: str(d.name), tercero: m2o(d.partner_id), vence: str(d.invoice_date_due), currency: m2o(d.currency_id), saldo: money(d.amount_residual) })), asOf,
      { source: SOURCE, truncated: rows.length >= LIMIT });
  }
  cuentasPorCobrar(asOf: string) { return this.cartera('out_invoice', asOf); }
  cuentasPorPagar(asOf: string) { return this.cartera('in_invoice', asOf); }

  async inventario(q?: string): Promise<InventarioResult> {
    const filt: unknown[] = q ? ['|', ['name', 'ilike', q], ['default_code', 'ilike', q]] : [];
    const kw = { fields: ['default_code', 'display_name', 'qty_available', 'virtual_available', 'uom_id'], limit: 500, order: 'display_name asc' };
    let rows: Row[];
    try { rows = await this.read('product.product', 'search_read', [[['is_storable', '=', true], ...filt]], kw); } // Odoo 18+
    catch { rows = await this.read('product.product', 'search_read', [[['type', '=', 'product'], ...filt]], kw); } // Odoo ≤17
    return inventarioFromRows(
      rows.map((p) => ({ codigo: str(p.default_code), producto: str(p.display_name), existencia: String(p.qty_available ?? 0), proyectado: String(p.virtual_available ?? 0), udm: m2o(p.uom_id) })), undefined,
      { source: SOURCE, truncated: rows.length >= 500 });
  }

  async clientes(q?: string): Promise<ClienteRow[]> {
    const domain: unknown[] = [['customer_rank', '>', 0]];
    if (q) domain.push(['name', 'ilike', q]);
    const rows: Row[] = await this.read('res.partner', 'search_read', [domain], { fields: ['name', 'email', 'phone', 'city'], limit: 50, order: 'name asc' });
    return rows.map((c) => ({ nombre: str(c.name), correo: str(c.email), telefono: str(c.phone), ciudad: str(c.city) }));
  }

  async catalogoPublico(q?: string) {
    const domain: unknown[] = [['sale_ok', '=', true], ['website_published', '=', true]];
    if (q) domain.push(['name', 'ilike', q]);
    let rows: Row[];
    try {
      rows = await this.read('product.template', 'search_read', [domain], { fields: ['name', 'list_price', 'description_sale', 'currency_id'], limit: 30, order: 'name asc' });
    } catch (e) {
      throw new OdooError('El catálogo público requiere el módulo Sitio web / eCommerce de Odoo (campo website_published).');
    }
    const filas: CatalogoRow[] = rows.map((p) => ({ nombre: str(p.name), precio: money(p.list_price), moneda: m2o(p.currency_id), descripcion: str(p.description_sale).slice(0, 300) }));
    return { filas, truncated: rows.length >= 30 };
  }
}
