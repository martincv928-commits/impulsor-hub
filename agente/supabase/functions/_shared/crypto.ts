// Cifrado de credenciales por empresa (AES-GCM, la clave vive sólo como secreto de la Edge Function).
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function key(keyB64: string) {
  const raw = unb64(keyB64);
  if (raw.length !== 32) throw new Error('ERP_ENC_KEY debe ser de 32 bytes (base64)');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encryptSecret(plain: string, keyB64: string, tenantId: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(tenantId) }, await key(keyB64), new TextEncoder().encode(plain)));
  const out = new Uint8Array(iv.length + ct.length); out.set(iv); out.set(ct, iv.length);
  return 'v1.' + b64(out);
}
export async function decryptSecret(enc: string, keyB64: string, tenantId: string): Promise<string> {
  if (!enc.startsWith('v1.')) throw new Error('formato de secreto desconocido');
  const all = unb64(enc.slice(3));
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.slice(0, 12), additionalData: new TextEncoder().encode(tenantId) }, await key(keyB64), all.slice(12));
  return new TextDecoder().decode(pt);
}

/** Si no hay ERP_ENC_KEY, se deriva una clave estable de un secreto del servidor (p. ej. la service key). */
export async function deriveKeyB64(seed: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('agente-erp-v1:' + seed)));
  return b64(h);
}
