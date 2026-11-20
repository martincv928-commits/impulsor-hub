import { createClient } from '@supabase/supabase-js';
// Valores públicos por diseño (URL y publishable key); nunca service_role.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://lsbayfiblnylafyuxbeh.supabase.co';
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'sb_publishable_c-jJs9sYWC3d1O3t1643tQ_HU9ZyE2n';
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
export const API_URL = `${SUPABASE_URL}/functions/v1/api`;

export async function api<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY, authorization: `Bearer ${data.session?.access_token ?? SUPABASE_KEY}` },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error ?? `Error ${res.status}`);
  return j as T;
}

/** Mensajes de error de Supabase Auth en español. */
export function esError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('invalid login')) return 'Correo o contraseña incorrectos.';
  if (m.includes('email not confirmed')) return 'Falta confirmar tu correo. Revisa tu bandeja y el enlace que te enviamos.';
  if (m.includes('already registered') || m.includes('already been registered')) return 'Ese correo ya tiene cuenta. Inicia sesión.';
  if (m.includes('password should be') || m.includes('weak')) return 'La contraseña es muy débil (mínimo 8 caracteres).';
  if (m.includes('rate limit') || m.includes('too many')) return 'Demasiados intentos. Espera unos minutos.';
  if (m.includes('failed to fetch') || m.includes('network')) return 'Sin conexión con el servidor. Revisa tu internet.';
  return msg;
}
