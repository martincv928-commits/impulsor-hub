// Normalización ESTRICTA de datos externos (API o archivos): sin adivinar. Un dato inválido es un error con fila y campo.
import Decimal from 'decimal.js';
import { isValidDate } from './erp.ts';

export type DatasetKey = 'ventas' | 'cartera_cobrar' | 'cartera_pagar' | 'inventario' | 'clientes' | 'catalogo';
export type FieldKind = 'text' | 'money' | 'qty' | 'date' | 'currency';
export interface FieldSpec { key: string; label: string; kind: FieldKind; required: boolean; synonyms: string[] }
export interface DatasetSpec { label: string; fields: FieldSpec[] }

const f = (key: string, label: string, kind: FieldKind, required: boolean, synonyms: string[]): FieldSpec => ({ key, label, kind, required, synonyms });

export const DATASETS: Record<DatasetKey, DatasetSpec> = {
  ventas: { label: 'Ventas', fields: [
    f('folio', 'Folio', 'text', true, ['folio', 'pedido', 'orden', 'factura', 'numero', 'no', 'documento', 'id']),
    f('cliente', 'Cliente', 'text', true, ['cliente', 'razon social', 'nombre cliente', 'customer', 'receptor']),
    f('fecha', 'Fecha', 'date', true, ['fecha', 'fecha pedido', 'fecha factura', 'date', 'emision']),
    f('total', 'Total', 'money', true, ['total', 'importe', 'monto', 'amount', 'importe total']),
    f('currency', 'Moneda', 'currency', true, ['moneda', 'currency', 'divisa']),
  ] },
  cartera_cobrar: { label: 'Cuentas por cobrar', fields: [
    f('folio', 'Folio', 'text', true, ['folio', 'factura', 'documento', 'numero', 'no', 'id']),
    f('tercero', 'Cliente', 'text', true, ['cliente', 'razon social', 'nombre cliente', 'customer', 'receptor']),
    f('vence', 'Vencimiento', 'date', true, ['vence', 'vencimiento', 'fecha vencimiento', 'fecha de vencimiento', 'due date', 'due']),
    f('saldo', 'Saldo', 'money', true, ['saldo', 'saldo pendiente', 'pendiente', 'adeudo', 'balance', 'por cobrar']),
    f('currency', 'Moneda', 'currency', true, ['moneda', 'currency', 'divisa']),
  ] },
  cartera_pagar: { label: 'Cuentas por pagar', fields: [
    f('folio', 'Folio', 'text', true, ['folio', 'factura', 'documento', 'numero', 'no', 'id']),
    f('tercero', 'Proveedor', 'text', true, ['proveedor', 'razon social', 'nombre proveedor', 'vendor', 'emisor']),
    f('vence', 'Vencimiento', 'date', true, ['vence', 'vencimiento', 'fecha vencimiento', 'fecha de vencimiento', 'due date', 'due']),
    f('saldo', 'Saldo', 'money', true, ['saldo', 'saldo pendiente', 'pendiente', 'adeudo', 'balance', 'por pagar']),
    f('currency', 'Moneda', 'currency', true, ['moneda', 'currency', 'divisa']),
  ] },
  inventario: { label: 'Inventario', fields: [
    f('codigo', 'Código', 'text', false, ['codigo', 'sku', 'clave', 'referencia', 'code']),
    f('producto', 'Producto', 'text', true, ['producto', 'articulo', 'descripcion', 'nombre', 'item', 'product']),
    f('existencia', 'Existencia', 'qty', true, ['existencia', 'stock', 'cantidad', 'disponible', 'qty', 'on hand']),
    f('proyectado', 'Proyectado', 'qty', false, ['proyectado', 'pronostico', 'forecast', 'virtual']),
    f('udm', 'Unidad', 'text', false, ['udm', 'unidad', 'unidad de medida', 'uom']),
  ] },
  clientes: { label: 'Clientes', fields: [
    f('nombre', 'Nombre', 'text', true, ['nombre', 'cliente', 'razon social', 'name']),
    f('correo', 'Correo', 'text', false, ['correo', 'email', 'e mail', 'mail']),
    f('telefono', 'Teléfono', 'text', false, ['telefono', 'tel', 'celular', 'phone']),
    f('ciudad', 'Ciudad', 'text', false, ['ciudad', 'municipio', 'city']),
  ] },
  catalogo: { label: 'Catálogo público de productos', fields: [
    f('nombre', 'Nombre', 'text', true, ['nombre', 'producto', 'articulo', 'name']),
    f('precio', 'Precio', 'money', true, ['precio', 'precio lista', 'price', 'importe']),
    f('moneda', 'Moneda', 'currency', true, ['moneda', 'currency', 'divisa']),
    f('descripcion', 'Descripción', 'text', false, ['descripcion', 'detalle', 'description']),
  ] },
};
export const DATASET_KEYS = Object.keys(DATASETS) as DatasetKey[];

export type FieldRef = string | { const: string };
export type Mapping = Record<string, FieldRef | null | undefined>;
export interface ParseOpts { decimal: '.' | ','; date_format: 'iso' | 'dmy' | 'mdy' }
export const DEFAULT_OPTS: ParseOpts = { decimal: '.', date_format: 'iso' };

export class MapError extends Error {}

/** Lee a.b[0].c de un objeto. Devuelve undefined si no existe. */
export function getPath(obj: unknown, path: string): unknown {
  if (path === '' || path == null) return obj;
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter((p) => p !== '');
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    if (p === '__proto__' || p === 'constructor' || p === 'prototype') return undefined;
    cur = cur[p];
  }
  return cur;
}

export function parseMoney(v: unknown, decimal: '.' | ',' = '.'): Decimal {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new MapError('no es un número válido');
    return new Decimal(String(v));
  }
  if (typeof v !== 'string') throw new MapError('no es un número');
  let s = v.trim();
  if (!s) throw new MapError('está vacío');
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/\b(MXN|USD|EUR|MN|M\.N\.)\b/gi, '').replace(/[\s$€£]/g, '');
  if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
  if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  const thousands = decimal === '.' ? ',' : '.';
  const re = decimal === '.' ? /^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/ : /^(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/;
  if (!re.test(s)) throw new MapError(`"${v}" no es un importe válido (separador decimal esperado: "${decimal}")`);
  s = s.split(thousands).join('');
  if (decimal === ',') s = s.replace(',', '.');
  const d = new Decimal(s);
  return neg ? d.neg() : d;
}

export function parseDate(v: unknown, fmt: ParseOpts['date_format'] = 'iso'): string {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw new MapError('fecha inválida');
    return v.toISOString().slice(0, 10);
  }
  if (typeof v !== 'string') throw new MapError('no es una fecha');
  const s = v.trim();
  if (!s) throw new MapError('está vacía');
  let iso: string | null = null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
  if (fmt === 'iso') { if (m) iso = `${m[1]}-${m[2]}-${m[3]}`; }
  else {
    const d = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
    if (d) { const [a, b] = [d[1].padStart(2, '0'), d[2].padStart(2, '0')]; iso = fmt === 'dmy' ? `${d[3]}-${b}-${a}` : `${d[3]}-${a}-${b}`; }
    else if (m) iso = `${m[1]}-${m[2]}-${m[3]}`; // ISO siempre es inequívoco
  }
  if (!iso || !isValidDate(iso)) throw new MapError(`"${v}" no es una fecha válida (formato esperado: ${fmt === 'iso' ? 'AAAA-MM-DD' : fmt === 'dmy' ? 'DD/MM/AAAA' : 'MM/DD/AAAA'})`);
  return iso;
}

const text = (v: unknown): string => (v == null ? '' : typeof v === 'object' && !(v instanceof Date) ? '' : String(v).trim());

/** Convierte una fila cruda en una fila normalizada (todo texto). `get` define cómo leer una referencia (ruta o columna). */
export function mapRow(raw: unknown, mapping: Mapping, spec: DatasetSpec, opts: ParseOpts, get: (raw: unknown, ref: string) => unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const fld of spec.fields) {
    const ref = mapping[fld.key];
    let v: unknown;
    if (ref == null || ref === '') v = undefined;
    else if (typeof ref === 'object') v = ref.const;
    else v = get(raw, ref);
    const empty = v == null || (typeof v === 'string' && v.trim() === '');
    if (empty) {
      if (fld.required) throw new MapError(`el campo "${fld.label}" está vacío o no existe${typeof ref === 'string' ? ` (${ref})` : ''}`);
      out[fld.key] = '';
      continue;
    }
    try {
      if (fld.kind === 'money') out[fld.key] = parseMoney(v, opts.decimal).toFixed();
      else if (fld.kind === 'qty') out[fld.key] = parseMoney(v, opts.decimal).toFixed();
      else if (fld.kind === 'date') out[fld.key] = parseDate(v, opts.date_format);
      else if (fld.kind === 'currency') {
        const c = text(v).toUpperCase();
        if (!/^[A-Z]{3}$/.test(c)) throw new MapError(`"${text(v)}" no es un código de moneda de 3 letras (p. ej. MXN)`);
        out[fld.key] = c;
      } else out[fld.key] = text(v).slice(0, 500);
    } catch (e) {
      throw new MapError(`campo "${fld.label}": ${e instanceof MapError ? e.message : 'valor inválido'}`);
    }
  }
  return out;
}

/** Valida el mapeo de columnas que llega del cliente (claves conocidas; referencia o valor fijo sólo donde se permite). */
export function sanitizeMapping(ds: DatasetKey, raw: unknown): Mapping {
  const spec = DATASETS[ds];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Mapeo de columnas inválido');
  const out: Mapping = {};
  for (const k of Object.keys(raw as object)) if (!spec.fields.some((x) => x.key === k)) throw new Error(`Campo desconocido en el mapeo: ${k}`);
  for (const fld of spec.fields) {
    const v = (raw as any)[fld.key];
    if (v == null || v === '') { out[fld.key] = null; continue; }
    if (typeof v === 'string') { if (v.length > 200) throw new Error(`Columna demasiado larga para "${fld.label}"`); out[fld.key] = v; }
    else if (typeof v === 'object' && typeof v.const === 'string') {
      if (!['text', 'currency'].includes(fld.kind)) throw new Error(`"${fld.label}" no admite un valor fijo`);
      const c = v.const.trim(); if (!c || c.length > 20) throw new Error(`Valor fijo inválido para "${fld.label}"`);
      out[fld.key] = { const: c };
    } else throw new Error(`Referencia inválida para "${fld.label}"`);
  }
  return out;
}
