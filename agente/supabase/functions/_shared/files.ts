// Carga de archivos (CSV / Excel .xlsx): lectura, sugerencia de columnas y validación ESTRICTA (un error = no se carga nada).
import ExcelJS from 'exceljs';
import { carteraFromRows, catalogoFromRows, clientesFromRows, ErpUnsupported, inventarioFromRows, ventasFromRows, type CarteraResult, type ClienteRow, type DateRange, type ErpConnector, type InventarioResult, type VentasResult } from './erp.ts';
import { DATASETS, DATASET_KEYS, mapRow, MapError, type DatasetKey, type Mapping, type ParseOpts } from './mapping.ts';

export const MAX_FILE_BYTES = 5_000_000, MAX_ROWS = 20000, MAX_COLS = 60;

export interface ParsedFile { headers: string[]; rows: Record<string, unknown>[]; rowNumbers: number[] }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function decodeText(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, ''); }
  catch { return new TextDecoder('windows-1252').decode(bytes); }
}

/** Tabla de nombres de columna únicos y no vacíos. */
function cleanHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    let name = (h ?? '').toString().trim() || `Columna ${i + 1}`;
    const n = seen.get(name) ?? 0; seen.set(name, n + 1);
    if (n > 0) name = `${name} (${n + 1})`;
    return name;
  });
}

export function parseCsv(text: string): ParsedFile {
  const first = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  const delim = [',', ';', '\t', '|'].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const table: string[][] = []; const nums: number[] = [];
  let row: string[] = [], cell = '', q = false, line = 1, rowLine = 1;
  const endRow = () => { row.push(cell); cell = ''; if (row.some((c) => c.trim() !== '')) { table.push(row); nums.push(rowLine); } row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else { if (c === '\n') line++; cell += c; } }
    else if (c === '"' && cell === '') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n') { endRow(); line++; rowLine = line; }
    else if (c === '\r') { /* se ignora */ }
    else cell += c;
    if (table.length > MAX_ROWS + 1) throw new Error(`El archivo tiene más de ${MAX_ROWS.toLocaleString('es-MX')} filas.`);
  }
  if (q) throw new Error('El archivo tiene comillas sin cerrar.');
  if (cell !== '' || row.length) endRow();
  if (table.length < 1) throw new Error('El archivo está vacío.');
  const headers = cleanHeaders(table[0]);
  if (headers.length > MAX_COLS) throw new Error(`El archivo tiene más de ${MAX_COLS} columnas.`);
  const rows = table.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])));
  return { headers, rows, rowNumbers: nums.slice(1) };
}

function cellValue(v: any): unknown {
  if (v == null) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((t: any) => t.text).join('');
    if ('text' in v) return String(v.text);
    if ('error' in v) return '';
    return '';
  }
  return v;
}

export async function parseXlsx(bytes: Uint8Array): Promise<ParsedFile> {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(bytes as any); } catch { throw new Error('No se pudo leer el Excel. Guárdalo de nuevo como .xlsx o expórtalo a .csv.'); }
  const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
  if (!ws) throw new Error('El Excel no tiene datos.');
  const lines: { n: number; vals: unknown[] }[] = [];
  ws.eachRow({ includeEmpty: false }, (r, n) => {
    const vals: unknown[] = []; for (let c = 1; c <= Math.min(r.cellCount, MAX_COLS + 1); c++) vals.push(cellValue(r.getCell(c).value));
    if (vals.some((v) => String(v instanceof Date ? 'd' : v).trim() !== '')) lines.push({ n, vals });
  });
  if (lines.length > MAX_ROWS + 1) throw new Error(`El archivo tiene más de ${MAX_ROWS.toLocaleString('es-MX')} filas.`);
  if (!lines.length) throw new Error('El Excel no tiene datos.');
  const headers = cleanHeaders(lines[0].vals.map((v) => String(v)));
  if (headers.length > MAX_COLS) throw new Error(`El archivo tiene más de ${MAX_COLS} columnas.`);
  return { headers, rows: lines.slice(1).map((l) => Object.fromEntries(headers.map((h, i) => [h, l.vals[i] ?? '']))), rowNumbers: lines.slice(1).map((l) => l.n) };
}

export async function parseDatasetFile(filename: string, bytes: Uint8Array): Promise<ParsedFile> {
  if (bytes.length > MAX_FILE_BYTES) throw new Error('El archivo es demasiado grande (máximo 5 MB).');
  if (!bytes.length) throw new Error('El archivo está vacío.');
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'xls') throw new Error('Los .xls antiguos no se admiten. Guárdalo como .xlsx o .csv.');
  if (isZip || ext === 'xlsx') return parseXlsx(bytes);
  if (!['csv', 'txt', 'tsv'].includes(ext)) throw new Error('Formato no admitido. Usa .csv o .xlsx.');
  return parseCsv(decodeText(bytes));
}

/** Sugiere qué columna corresponde a cada campo (por nombre; sin duplicar columnas). */
export function suggestMapping(ds: DatasetKey, headers: string[]): Record<string, string | null> {
  const used = new Set<string>(); const out: Record<string, string | null> = {};
  const nh = headers.map((h) => [h, norm(h)] as const);
  for (const pass of ['exact', 'contains'] as const) {
    for (const fld of DATASETS[ds].fields) {
      if (out[fld.key]) continue;
      const syn = fld.synonyms.map(norm);
      const hit = nh.find(([h, n]) => !used.has(h) && (pass === 'exact' ? syn.includes(n) : syn.some((s) => s.length >= 4 && n.includes(s))));
      if (hit) { out[fld.key] = hit[0]; used.add(hit[0]); }
    }
  }
  for (const fld of DATASETS[ds].fields) out[fld.key] ??= null;
  return out;
}

export interface RowError { row: number; message: string }
/** Valida TODAS las filas. Si hay errores no devuelve filas (no se carga nada a medias). */
export function normalizeRows(ds: DatasetKey, parsed: ParsedFile, mapping: Mapping, opts: ParseOpts): { rows: Record<string, string>[]; errors: RowError[] } {
  const spec = DATASETS[ds]; const errors: RowError[] = []; const rows: Record<string, string>[] = [];
  for (const fld of spec.fields) {
    const ref = mapping[fld.key];
    if (fld.required && (ref == null || ref === '')) errors.push({ row: 0, message: `Falta indicar la columna de "${fld.label}".` });
    else if (typeof ref === 'string' && ref && !parsed.headers.includes(ref)) errors.push({ row: 0, message: `La columna "${ref}" no existe en el archivo.` });
  }
  if (errors.length) return { rows: [], errors };
  if (!parsed.rows.length) return { rows: [], errors: [{ row: 0, message: 'El archivo no tiene filas de datos.' }] };
  parsed.rows.forEach((raw, i) => {
    if (errors.length >= 50) return;
    try { rows.push(mapRow(raw, mapping, spec, opts, (r, ref) => (r as any)[ref])); }
    catch (e) { errors.push({ row: parsed.rowNumbers[i] ?? i + 2, message: e instanceof MapError ? e.message : 'dato inválido' }); }
  });
  return errors.length ? { rows: [], errors } : { rows, errors: [] };
}

export interface DatasetMeta { filename: string; uploaded_at: string }
export type DatasetLoader = (ds: DatasetKey) => Promise<{ rows: Record<string, string>[]; meta: DatasetMeta } | null>;

/** Conector sobre archivos ya cargados: mismos cálculos que Odoo/API, con la fuente y la fecha de carga a la vista. */
export class FilesConnector implements ErpConnector {
  constructor(private load: DatasetLoader) {}
  private src(m: DatasetMeta) { return `Archivo "${m.filename}" (cargado el ${m.uploaded_at.slice(0, 10)}; no es en vivo)`; }
  private async need(ds: DatasetKey) {
    const d = await this.load(ds);
    if (!d) throw new ErpUnsupported(`No hay un archivo cargado de ${DATASETS[ds].label}. Cárgalo en Configuración → Datos.`);
    return d;
  }
  async ping() {
    const have: string[] = [];
    for (const ds of DATASET_KEYS) { const d = await this.load(ds); if (d) have.push(`${DATASETS[ds].label} (${d.rows.length})`); }
    if (!have.length) throw new Error('Aún no hay archivos cargados.');
    return { ok: true as const, detail: `Archivos cargados: ${have.join(', ')}.` };
  }
  async ventas(r: DateRange): Promise<VentasResult> {
    const d = await this.need('ventas');
    return ventasFromRows(d.rows as any, r, { source: this.src(d.meta), truncated: false, note: 'Datos de un archivo cargado por la empresa; reflejan la fecha de carga, no el momento actual.' });
  }
  private async cartera(ds: 'cartera_cobrar' | 'cartera_pagar', asOf: string): Promise<CarteraResult> { const d = await this.need(ds); return carteraFromRows(d.rows as any, asOf, { source: this.src(d.meta), truncated: false }); }
  cuentasPorCobrar(asOf: string) { return this.cartera('cartera_cobrar', asOf); }
  cuentasPorPagar(asOf: string) { return this.cartera('cartera_pagar', asOf); }
  async inventario(q?: string): Promise<InventarioResult> { const d = await this.need('inventario'); return inventarioFromRows(d.rows as any, q, { source: this.src(d.meta), truncated: false }); }
  async clientes(q?: string): Promise<ClienteRow[]> { return clientesFromRows((await this.need('clientes')).rows as any, q); }
  async catalogoPublico(q?: string) { return catalogoFromRows((await this.need('catalogo')).rows as any, q); }
}
