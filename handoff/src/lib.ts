import { jsPDF } from 'jspdf';
import { Capacitor } from '@capacitor/core';
import { supabase } from './supabase';
import type { Row } from './report';

const MSG: Record<string, string> = {
  not_authenticated: 'Inicia sesión.', forbidden: 'No tienes permiso para esta acción.',
  forbidden_self: 'No puedes recibir tu propia entrega.', not_found: 'No encontrado.',
  justification_required: 'Escribe una justificación / nota.', required_fields_missing: 'Faltan campos obligatorios',
  handoff_locked: 'La entrega ya fue enviada y no puede modificarse. Usa un anexo.', invalid_invite: 'Código inválido, usado o vencido.',
  already_member: 'Ya perteneces a esa empresa.', last_admin: 'Debe quedar al menos un administrador.',
  issue_closed: 'El pendiente está cerrado.', invalid_area: 'El área no pertenece a la sede.', invalid_receiver: 'Receptor no válido.',
  not_submitted: 'La entrega aún no fue enviada.', invalid_events: 'Eventos no válidos.',
};
export function errText(e: any): string {
  const m: string = e?.message ?? String(e);
  const key = Object.keys(MSG).find((k) => m.includes(k));
  if (key === 'required_fields_missing') {
    let faltan = '';
    try { faltan = JSON.parse(e.details ?? '[]').join(', '); } catch { /* sin detalle */ }
    return `${MSG[key]}${faltan ? ': ' + faltan : ''}.`;
  }
  if (key) return MSG[key];
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Sin conexión con el servidor. No se confirmó la operación; reintenta.';
  return m;
}

export async function rpc<T = any>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data as T;
}
export async function sel<T = Row[]>(q: PromiseLike<{ data: any; error: any }>): Promise<T> {
  const { data, error } = await q;
  if (error) throw error;
  return data as T;
}

export const uuid = () => crypto.randomUUID();
export const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local

/** Reduce la foto en el dispositivo y la sube al bucket privado; luego la registra (idempotente por id). */
export async function uploadPhoto(file: File, org: string, entityType: 'handoff' | 'issue', entityId: string): Promise<string> {
  const blob = await shrink(file);
  const id = uuid();
  const path = `${org}/${entityType}/${id}.jpg`;
  const up = await supabase.storage.from('evidence').upload(path, blob, { contentType: 'image/jpeg' });
  if (up.error) throw up.error;
  await rpc('register_attachment', { p_id: id, p_org: org, p_path: path, p_entity_type: entityType, p_entity_id: entityId, p_mime: 'image/jpeg', p_size: blob.size });
  return id;
}
async function shrink(file: File, max = 1600): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('img'))), 'image/jpeg', 0.8));
  } catch { return file; }
}
export async function signedUrl(path: string): Promise<string | null> {
  const { data } = await supabase.storage.from('evidence').createSignedUrl(path, 120);
  return data?.signedUrl ?? null;
}

export function pdfFromLines(lines: string[]): Blob {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  let y = 48;
  for (const raw of lines) {
    const head = raw === raw.toUpperCase() && raw.length > 3 && !raw.startsWith('-');
    doc.setFont('helvetica', head ? 'bold' : 'normal').setFontSize(head ? 12 : 10);
    for (const part of doc.splitTextToSize(raw, 500)) {
      if (y > 790) { doc.addPage(); y = 48; }
      doc.text(part, 48, y); y += head ? 18 : 14;
    }
  }
  return doc.output('blob');
}
/** Comparte el PDF con las funciones del dispositivo (WhatsApp, correo…); si no hay soporte, lo descarga. */
export async function sharePdf(blob: Blob, name: string, title: string): Promise<string> {
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
    const saved = await Filesystem.writeFile({ path: name, data, directory: Directory.Cache });
    await Share.share({ title, files: [saved.uri] });
    return '';
  }
  const file = new File([blob], name, { type: 'application/pdf' });
  const nav = navigator as any;
  if (nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title }); return 'Compartido.'; } catch (e: any) { if (e?.name === 'AbortError') return ''; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  return 'Tu navegador no permite compartir archivos: se descargó el PDF.';
}

/** Fecha y hora cortas para la interfaz: «16 nov, 8:42 p.m.» */
export const fdt = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
