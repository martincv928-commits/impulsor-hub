// WhatsApp Cloud API (Meta): verificación de firma, lectura de webhooks y envío. NO PROBADO contra Meta real.
import type { Attachment } from './reports.ts';

const hex = (u: Uint8Array) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Verifica X-Hub-Signature-256 ("sha256=<hmac hex>") sobre el cuerpo crudo, en tiempo constante. */
export async function verifySignature(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header || !appSecret || !header.startsWith('sha256=')) return false;
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = hex(new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(rawBody))));
  const given = header.slice(7).toLowerCase();
  if (given.length !== mac.length) return false;
  let diff = 0;
  for (let i = 0; i < mac.length; i++) diff |= mac.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

export interface Incoming { wamid: string; from: string; phoneNumberId: string; type: string; text: string }

/** Extrae mensajes entrantes; ignora estados de entrega y cualquier otra cosa. */
export function parseWebhook(p: any): Incoming[] {
  const out: Incoming[] = [];
  if (p?.object !== 'whatsapp_business_account' || !Array.isArray(p.entry)) return out;
  for (const e of p.entry) for (const ch of e?.changes ?? []) {
    const v = ch?.value; const pid = v?.metadata?.phone_number_id;
    if (typeof pid !== 'string' || !Array.isArray(v?.messages)) continue;
    for (const m of v.messages) {
      if (typeof m?.id !== 'string' || typeof m?.from !== 'string') continue;
      out.push({ wamid: m.id, from: m.from.replace(/\D/g, ''), phoneNumberId: pid, type: String(m.type ?? ''), text: m.type === 'text' ? String(m.text?.body ?? '') : '' });
    }
  }
  return out;
}

/** Mismo número, tolerando prefijos de país distintos (p. ej. México 52 / 521): mismos dígitos o mismos últimos 10. */
export function phonesMatch(a: string, b: string): boolean {
  const x = a.replace(/\D/g, ''), y = b.replace(/\D/g, '');
  if (!x || !y) return false;
  if (x === y) return true;
  return x.length >= 10 && y.length >= 10 && x.slice(-10) === y.slice(-10);
}

export function splitMessage(text: string, max = 4000): string[] {
  const out: string[] = []; let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max); if (cut < max / 2) cut = rest.lastIndexOf(' ', max); if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export class WhatsAppClient {
  constructor(private token: string, private phoneNumberId: string, private graphVersion = 'v23.0', private fetcher: typeof fetch = fetch) {}
  private url(path: string) { return `https://graph.facebook.com/${this.graphVersion}/${path}`; }
  private async call(path: string, init: RequestInit) {
    const res = await this.fetcher(this.url(path), { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`WhatsApp HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json() as Promise<any>;
  }
  sendText(to: string, body: string) {
    return this.call(`${this.phoneNumberId}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body } }) });
  }
  async sendDocument(to: string, att: Attachment) {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp'); form.append('type', att.mime);
    form.append('file', new Blob([unb64(att.base64)], { type: att.mime }), att.filename);
    const up = await this.call(`${this.phoneNumberId}/media`, { method: 'POST', body: form });
    if (!up?.id) throw new Error('WhatsApp no devolvió id de archivo');
    return this.call(`${this.phoneNumberId}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'document', document: { id: up.id, filename: att.filename } }) });
  }
}
