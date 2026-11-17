// Registro de herramientas del agente. La visibilidad en modo Cliente se decide AQUÍ (código), no en el prompt.
import { isValidDate, type DateRange, type ErpConnector } from './erp.ts';
import type { Attachment, ReportKind } from './reports.ts';

export type Mode = 'gerente' | 'cliente';
export interface ToolCtx {
  erp: ErpConnector | null;
  today: string; // YYYY-MM-DD
  companyName: string;
  searchKnowledge: (q: string) => Promise<{ content: string }[]>;
  buildReport: (kind: ReportKind, fmt: 'pdf' | 'xlsx', data: unknown, meta: { company: string; periodo: string }) => Promise<Attachment>;
  attachments: Attachment[];
}
export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  /** Sólo estas pueden exponerse al público; el resto es privada siempre. */
  publicEligible: boolean;
  run(ctx: ToolCtx, input: Record<string, any>): Promise<unknown>;
}

const NO_ERP = 'Esta empresa aún no tiene un ERP conectado.';
const need = (c: ToolCtx) => { if (!c.erp) throw new Error(NO_ERP); return c.erp; };
const range = (i: Record<string, any>): DateRange => {
  if (!isValidDate(i.desde) || !isValidDate(i.hasta)) throw new Error('Fechas inválidas: usa formato AAAA-MM-DD en desde y hasta.');
  if (i.desde > i.hasta) throw new Error('"desde" no puede ser posterior a "hasta".');
  return { from: i.desde, to: i.hasta };
};
const asOf = (c: ToolCtx, i: Record<string, any>) => { if (i.al == null) return c.today; if (!isValidDate(i.al)) throw new Error('Fecha "al" inválida (AAAA-MM-DD).'); return i.al as string; };
const str = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 100) : undefined) || undefined;
const dates = { desde: { type: 'string', description: 'AAAA-MM-DD' }, hasta: { type: 'string', description: 'AAAA-MM-DD' } };

export const TOOLS: ToolDef[] = [
  { name: 'ventas', publicEligible: false, description: 'Ventas (pedidos confirmados) del ERP entre dos fechas: totales por moneda, mejores clientes y pedidos.',
    input_schema: { type: 'object', properties: dates, required: ['desde', 'hasta'] }, run: async (c, i) => { const r = range(i); return need(c).ventas(r); } },
  { name: 'cuentas_por_cobrar', publicEligible: false, description: 'Cartera de clientes: facturas pendientes de cobro, saldo por moneda y antigüedad (vencido 1-30, 31-60, 61-90, 90+).',
    input_schema: { type: 'object', properties: { al: { type: 'string', description: 'Fecha de corte AAAA-MM-DD (por defecto hoy)' } } }, run: async (c, i) => { const d = asOf(c, i); return need(c).cuentasPorCobrar(d); } },
  { name: 'cuentas_por_pagar', publicEligible: false, description: 'Cuentas por pagar a proveedores: facturas pendientes, saldo por moneda y antigüedad.',
    input_schema: { type: 'object', properties: { al: { type: 'string', description: 'Fecha de corte AAAA-MM-DD (por defecto hoy)' } } }, run: async (c, i) => { const d = asOf(c, i); return need(c).cuentasPorPagar(d); } },
  { name: 'inventario', publicEligible: false, description: 'Existencias de productos almacenables; opcionalmente filtra por nombre o código.',
    input_schema: { type: 'object', properties: { buscar: { type: 'string' } } }, run: (c, i) => need(c).inventario(str(i.buscar)) },
  { name: 'clientes', publicEligible: false, description: 'Busca clientes por nombre y devuelve contacto básico.',
    input_schema: { type: 'object', properties: { buscar: { type: 'string' } } }, run: (c, i) => need(c).clientes(str(i.buscar)) },
  { name: 'catalogo_productos', publicEligible: true, description: 'Productos publicados en el sitio web de la empresa, con precio de lista y descripción.',
    input_schema: { type: 'object', properties: { buscar: { type: 'string' } } }, run: (c, i) => need(c).catalogoPublico(str(i.buscar)) },
  { name: 'buscar_conocimiento', publicEligible: true, description: 'Busca en la información de la empresa y de su sitio web (políticas, horarios, servicios, preguntas frecuentes).',
    input_schema: { type: 'object', properties: { consulta: { type: 'string' } }, required: ['consulta'] },
    run: async (c, i) => { const q = str(i.consulta); if (!q) throw new Error('Falta la consulta.'); const r = await c.searchKnowledge(q); return r.length ? { fragmentos: r.map((x) => x.content) } : { fragmentos: [], aviso: 'Sin información registrada sobre esto.' }; } },
  { name: 'generar_reporte', publicEligible: false, description: 'Genera un reporte descargable (PDF o Excel) a partir de datos del ERP. Tipos: ventas (requiere desde/hasta), cuentas_por_cobrar, cuentas_por_pagar, inventario.',
    input_schema: { type: 'object', properties: { reporte: { type: 'string', enum: ['ventas', 'cuentas_por_cobrar', 'cuentas_por_pagar', 'inventario'] }, formato: { type: 'string', enum: ['pdf', 'xlsx'] }, ...dates, al: { type: 'string' } }, required: ['reporte', 'formato'] },
    run: async (c, i) => {
      const kind = i.reporte as ReportKind; const fmt = i.formato as 'pdf' | 'xlsx';
      if (!['ventas', 'cuentas_por_cobrar', 'cuentas_por_pagar', 'inventario'].includes(kind) || !['pdf', 'xlsx'].includes(fmt)) throw new Error('Reporte o formato no válido.');
      let data: unknown; let periodo: string;
      if (kind === 'ventas') { const r = range(i); data = await need(c).ventas(r); periodo = `${r.from} a ${r.to}`; }
      else if (kind === 'cuentas_por_cobrar') { const d = asOf(c, i); data = await need(c).cuentasPorCobrar(d); periodo = `al ${d}`; }
      else if (kind === 'cuentas_por_pagar') { const d = asOf(c, i); data = await need(c).cuentasPorPagar(d); periodo = `al ${d}`; }
      else { data = await need(c).inventario(); periodo = `al ${c.today}`; }
      const att = await c.buildReport(kind, fmt, data, { company: c.companyName, periodo });
      c.attachments.push(att);
      return { ok: true, archivo: att.filename, nota: 'El archivo se entrega al usuario junto con tu respuesta; no pegues su contenido.' };
    } },
];

/** Herramientas que el modo puede usar. Cliente: sólo elegibles Y marcadas públicas por el admin. */
export function toolsForMode(mode: Mode, publicFlags: Record<string, boolean>): ToolDef[] {
  if (mode === 'gerente') return TOOLS;
  return TOOLS.filter((t) => t.publicEligible && publicFlags[t.name] === true);
}
