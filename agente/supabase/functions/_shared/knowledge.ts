// Ingesta de conocimiento: HTML→texto, troceo y descarga segura de páginas.
import { assertSafeUrl } from './net.ts';

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t\f\r]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function chunkText(text: string, size = 800, overlap = 100): string[] {
  const clean = text.replace(/\s+\n/g, '\n').trim();
  if (!clean) return [];
  const out: string[] = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + size, clean.length);
    if (end < clean.length) { const cut = clean.lastIndexOf('\n', end); const sp = clean.lastIndexOf(' ', end); const b = Math.max(cut, sp); if (b > i + size / 2) end = b; }
    const piece = clean.slice(i, end).trim();
    if (piece) out.push(piece);
    if (end >= clean.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return out;
}

export async function fetchPageText(raw: string, fetcher: typeof fetch = fetch): Promise<string> {
  let url = assertSafeUrl(raw).toString();
  for (let hop = 0; hop < 4; hop++) {
    let res: Response;
    try { res = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { 'user-agent': 'AtalayaBot/0.1', accept: 'text/html,text/plain' } }); }
    catch { throw new Error('No se pudo descargar la página. Revisa la dirección y que sea pública.'); }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location'); if (!loc) throw new Error('Redirección inválida');
      url = assertSafeUrl(new URL(loc, url).toString()).toString(); continue;
    }
    if (!res.ok) throw new Error(`La página respondió HTTP ${res.status}`);
    const ct = res.headers.get('content-type') ?? '';
    if (!/text\/(html|plain)/i.test(ct)) throw new Error('Sólo se admiten páginas HTML o texto');
    const buf = await res.text();
    if (buf.length > 1_500_000) throw new Error('La página es demasiado grande');
    return /html/i.test(ct) ? htmlToText(buf) : buf;
  }
  throw new Error('Demasiadas redirecciones');
}
