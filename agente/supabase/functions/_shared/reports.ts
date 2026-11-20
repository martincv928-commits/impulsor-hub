// Reportes determinísticos (PDF / Excel) a partir de datos de herramientas. Sin LLM.
import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { CarteraResult, InventarioResult, VentasResult } from './erp.ts';

export type ReportKind = 'ventas' | 'cuentas_por_cobrar' | 'cuentas_por_pagar' | 'inventario';
export interface Attachment { filename: string; mime: string; base64: string }
interface Table { title: string; columns: string[]; rows: string[][]; summary: string[]; notes: string[]; source: string }

const TITLES: Record<ReportKind, string> = { ventas: 'Reporte de ventas', cuentas_por_cobrar: 'Cuentas por cobrar', cuentas_por_pagar: 'Cuentas por pagar', inventario: 'Inventario' };

export function toTable(kind: ReportKind, data: any): Table {
  if (kind === 'ventas') {
    const d = data as VentasResult;
    return { title: TITLES[kind], columns: ['Folio', 'Cliente', 'Fecha', 'Moneda', 'Total'],
      rows: d.pedidos.map((p) => [p.folio, p.cliente, p.fecha, p.currency, p.total]),
      summary: d.totals.map((t) => `Total ${t.currency}: ${t.total} (${t.count} pedidos)`),
      notes: [d.note, ...(d.truncated ? ['AVISO: datos parciales (se alcanzó el límite de registros).'] : [])], source: d.source ?? 'ERP' };
  }
  if (kind === 'cuentas_por_cobrar' || kind === 'cuentas_por_pagar') {
    const d = data as CarteraResult;
    return { title: TITLES[kind], columns: ['Folio', kind === 'cuentas_por_cobrar' ? 'Cliente' : 'Proveedor', 'Vence', 'Días vencido', 'Moneda', 'Saldo'],
      rows: d.documentos.map((x) => [x.folio, x.tercero, x.vence, String(Math.max(x.diasVencido, 0)), x.currency, x.saldo]),
      summary: [...d.totals.map((t) => `Saldo total ${t.currency}: ${t.total} (${t.count} documentos)`), ...d.aging.map((a) => `Antigüedad ${a.bucket} ${a.currency}: ${a.total}`)],
      notes: [`Corte al ${d.asOf}. Facturas publicadas con saldo pendiente.`, ...(d.truncated ? ['AVISO: datos parciales (se alcanzó el límite de registros).'] : [])], source: d.source ?? 'ERP' };
  }
  const d = data as InventarioResult;
  return { title: TITLES.inventario, columns: ['Código', 'Producto', 'Existencia', 'Proyectado', 'UdM'],
    rows: d.filas.map((f) => [f.codigo, f.producto, f.existencia, f.proyectado, f.udm]), summary: [`${d.filas.length} productos`],
    notes: d.truncated ? ['AVISO: datos parciales (límite de 500 productos).'] : [], source: d.source ?? 'ERP' };
}

const b64 = (u: Uint8Array) => { let s = ''; const CH = 0x8000; for (let i = 0; i < u.length; i += CH) s += String.fromCharCode(...u.subarray(i, i + CH)); return btoa(s); };
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase().slice(0, 40) || 'empresa';
const latin1 = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
const trace = (company: string, periodo: string, ts: string, source: string) => `${company} · Periodo: ${periodo} · Fuente: ${source} · Sólo lectura · Generado: ${ts}`;

export async function buildReport(kind: ReportKind, fmt: 'pdf' | 'xlsx', data: unknown, meta: { company: string; periodo: string }, now = new Date()): Promise<Attachment> {
  const t = toTable(kind, data); const ts = now.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const base = `${kind}_${slug(meta.company)}_${now.toISOString().slice(0, 10)}`;
  const head = trace(meta.company, meta.periodo, ts, t.source);
  if (fmt === 'xlsx') {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet(t.title.slice(0, 31));
    ws.addRow([t.title]).font = { bold: true, size: 14 }; ws.addRow([head]); ws.addRow([]);
    const h = ws.addRow(t.columns); h.font = { bold: true };
    const numCols = new Set(t.columns.map((c, i) => (['Total', 'Saldo', 'Existencia', 'Proyectado', 'Días vencido'].includes(c) ? i : -1)).filter((i) => i >= 0));
    for (const r of t.rows) ws.addRow(r.map((v, i) => (numCols.has(i) && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v)));
    ws.addRow([]); for (const s of t.summary) ws.addRow([s]).font = { bold: true }; for (const n of t.notes) ws.addRow([n]);
    t.columns.forEach((_, i) => { ws.getColumn(i + 1).width = 22; });
    const buf = new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer);
    return { filename: base + '.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', base64: b64(buf) };
  }
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 612, H = 792, M = 40, rowH = 14, colW = (W - 2 * M) / t.columns.length;
  let page = pdf.addPage([W, H]); let y = H - M;
  const text = (s: string, x: number, yy: number, f = font, size = 8) => page.drawText(latin1(s), { x, y: yy, size, font: f, color: rgb(0.1, 0.1, 0.1) });
  const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const newPage = () => { page = pdf.addPage([W, H]); y = H - M; };
  text(t.title, M, y, bold, 16); y -= 18;
  for (const line of head.match(/.{1,110}(\s|$)/g) ?? [head]) { text(line.trim(), M, y, font, 8); y -= 11; }
  y -= 6;
  const drawHeader = () => { t.columns.forEach((c, i) => text(c, M + i * colW, y, bold)); y -= rowH; };
  drawHeader();
  const maxChars = Math.max(8, Math.floor(colW / 4.2));
  for (const r of t.rows) { if (y < M + 40) { newPage(); drawHeader(); } r.forEach((v, i) => text(clip(v, maxChars), M + i * colW, y)); y -= rowH; }
  y -= 8;
  for (const s of [...t.summary, ...t.notes]) { for (const line of s.match(/.{1,120}(\s|$)/g) ?? [s]) { if (y < M) newPage(); text(line.trim(), M, y, s === t.summary[0] ? bold : font); y -= 11; } }
  return { filename: base + '.pdf', mime: 'application/pdf', base64: b64(await pdf.save()) };
}
