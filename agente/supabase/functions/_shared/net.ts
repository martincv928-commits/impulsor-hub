// Validación de URLs salientes (anti-SSRF básico) y utilidades de red.
const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];

export function assertSafeUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error('URL inválida'); }
  if (u.protocol !== 'https:') throw new Error('Sólo se permiten URLs https');
  if (u.username || u.password) throw new Error('La URL no debe incluir usuario/contraseña');
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')) throw new Error('Host no permitido');
  if (h.startsWith('[') || h.includes(':')) throw new Error('No se permiten direcciones IPv6');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) && PRIVATE_V4.some((r) => r.test(h))) throw new Error('No se permiten direcciones privadas');
  if (/^\d+$/.test(h.replace(/\./g, ''))) { if (!/^\d+\.\d+\.\d+\.\d+$/.test(h) || PRIVATE_V4.some((r) => r.test(h))) throw new Error('Host no permitido'); }
  return u;
}
