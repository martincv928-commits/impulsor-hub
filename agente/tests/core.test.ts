import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { OdooConnector, ODOO_READ_METHODS } from '../supabase/functions/_shared/odoo.ts';
import { agingBucket, daysBetween, isValidDate, sumByCurrency } from '../supabase/functions/_shared/erp.ts';
import { TOOLS, toolsForMode, type ToolCtx } from '../supabase/functions/_shared/tools.ts';
import { runAgent } from '../supabase/functions/_shared/agent.ts';
import { DEFAULT_MODEL, type LlmClient, type LlmResponse } from '../supabase/functions/_shared/llm.ts';
import { isOverLimit, limitMessage } from '../supabase/functions/_shared/usage.ts';
import { buildSystemPrompt, findForbidden } from '../supabase/functions/_shared/prompt.ts';
import { chunkText, fetchPageText, htmlToText } from '../supabase/functions/_shared/knowledge.ts';
import { assertSafeUrl } from '../supabase/functions/_shared/net.ts';
import { decryptSecret, deriveKeyB64, encryptSecret } from '../supabase/functions/_shared/crypto.ts';
import { buildReport } from '../supabase/functions/_shared/reports.ts';

// ---- Odoo simulado (fixtures sintéticos; NO es una conexión real) ----
function fakeOdoo(data: Record<string, any[]>) {
  const calls: { model?: string; method: string; order?: string }[] = [];
  const fetcher = (async (_url: string, init: any) => {
    const { params } = JSON.parse(init.body);
    if (params.service === 'common' && params.method === 'authenticate') return Response.json({ result: params.args[2] === 'KEY' ? 7 : false });
    if (params.service === 'common' && params.method === 'version') return Response.json({ result: { server_version: '17.0' } });
    const [, , , model, method] = params.args;
    calls.push({ model, method, order: params.args[6]?.order });
    if (data[model + ':error']) return Response.json({ error: { data: { message: 'campo inválido' } } });
    return Response.json({ result: data[model] ?? [] });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}
const cfg = { url: 'https://odoo.example.com', db: 'd', username: 'u', apiKey: 'KEY' };

describe('conector Odoo: sólo lectura', () => {
  it('la lista blanca no contiene métodos de escritura', () => {
    for (const m of ['create', 'write', 'unlink', 'copy', 'action_confirm', 'button_confirm', 'execute']) expect(ODOO_READ_METHODS.has(m)).toBe(false);
  });
  it('read() rechaza métodos de escritura sin llamar a Odoo', async () => {
    const { fetcher, calls } = fakeOdoo({});
    const o = new OdooConnector(cfg, fetcher);
    for (const m of ['create', 'write', 'unlink']) await expect(o.read('sale.order', m, [[]])).rejects.toThrow(/sólo lectura/);
    expect(calls).toHaveLength(0);
  });
  it('todas las consultas del conector usan sólo métodos de lectura', async () => {
    const { fetcher, calls } = fakeOdoo({});
    const o = new OdooConnector(cfg, fetcher);
    await o.ping(); await o.ventas({ from: '2026-01-01', to: '2026-01-31' }); await o.cuentasPorCobrar('2026-02-01');
    await o.cuentasPorPagar('2026-02-01'); await o.inventario('x'); await o.clientes('x'); await o.catalogoPublico('x');
    expect(calls.length).toBeGreaterThan(5);
    for (const c of calls) expect(ODOO_READ_METHODS.has(c.method)).toBe(true);
  });
  it('REGRESIÓN (Odoo 18 real): no se ordena por campos no almacenados como display_name', async () => {
    const { fetcher, calls } = fakeOdoo({});
    await new OdooConnector(cfg, fetcher).inventario();
    for (const c of calls.filter((x) => x.order)) expect(c.order).not.toMatch(/display_name/);
  });
  it('credenciales inválidas → error claro', async () => {
    const { fetcher } = fakeOdoo({});
    await expect(new OdooConnector({ ...cfg, apiKey: 'MAL' }, fetcher).ping()).rejects.toThrow(/Credenciales/);
  });
  it('REGRESIÓN: un fallo de red no filtra texto técnico y el mensaje va en español', async () => {
    const f = (async () => { throw new TypeError('error sending request: dns error: failed to lookup address information'); }) as unknown as typeof fetch;
    await expect(new OdooConnector(cfg, f).ping()).rejects.toThrow(/No se pudo conectar con Odoo/);
    await expect(new OdooConnector(cfg, f).ping()).rejects.not.toThrow(/dns|lookup/i);
    const html = (async () => new Response('<html>no es json</html>')) as unknown as typeof fetch;
    await expect(new OdooConnector(cfg, html).ping()).rejects.toThrow(/inesperado/);
  });
  it('rechaza URLs inseguras (http, localhost, IP privada)', () => {
    for (const url of ['http://odoo.example.com', 'https://localhost', 'https://127.0.0.1', 'https://10.0.0.5', 'https://192.168.1.2', 'https://169.254.169.254', 'https://intranet'])
      expect(() => new OdooConnector({ ...cfg, url }, fetch)).toThrow();
  });
  it('ventas: suma con Decimal por moneda, sin mezclar y sin errores de float', async () => {
    const { fetcher } = fakeOdoo({ 'sale.order': [
      { name: 'S1', partner_id: [1, 'Cliente A'], date_order: '2026-01-05 10:00:00', amount_total: 0.1, currency_id: [1, 'MXN'] },
      { name: 'S2', partner_id: [1, 'Cliente A'], date_order: '2026-01-06 10:00:00', amount_total: 0.2, currency_id: [1, 'MXN'] },
      { name: 'S3', partner_id: [2, 'Cliente B'], date_order: '2026-01-07 10:00:00', amount_total: 100.5, currency_id: [2, 'USD'] },
    ] });
    const r = await new OdooConnector(cfg, fetcher).ventas({ from: '2026-01-01', to: '2026-01-31' });
    expect(r.totals).toEqual([{ currency: 'MXN', total: '0.30', count: 2 }, { currency: 'USD', total: '100.50', count: 1 }]);
    expect(r.orderCount).toBe(3); expect(r.truncated).toBe(false);
    expect(r.topClientes).toEqual([{ cliente: 'Cliente A', currency: 'MXN', total: '0.30' }, { cliente: 'Cliente B', currency: 'USD', total: '100.50' }]);
  });
  it('cartera: antigüedad por cubetas y totales', async () => {
    const { fetcher } = fakeOdoo({ 'account.move': [
      { name: 'F1', partner_id: [1, 'A'], invoice_date_due: '2026-02-10', amount_residual: 100, currency_id: [1, 'MXN'] }, // por vencer
      { name: 'F2', partner_id: [1, 'A'], invoice_date_due: '2026-01-20', amount_residual: 50.25, currency_id: [1, 'MXN'] }, // 12 días
      { name: 'F3', partner_id: [2, 'B'], invoice_date_due: '2025-10-01', amount_residual: 10, currency_id: [1, 'MXN'] }, // 90+
    ] });
    const r = await new OdooConnector(cfg, fetcher).cuentasPorCobrar('2026-02-01');
    expect(r.totals).toEqual([{ currency: 'MXN', total: '160.25', count: 3 }]);
    const g = (b: string) => r.aging.find((a) => a.bucket === b)?.total;
    expect(g('al_corriente')).toBe('100.00'); expect(g('1-30')).toBe('50.25'); expect(g('90+')).toBe('10.00');
  });
  it('catálogo público: sin el módulo web da un error explícito (no filtra nada)', async () => {
    const { fetcher } = fakeOdoo({ 'product.template:error': [1] });
    await expect(new OdooConnector(cfg, fetcher).catalogoPublico()).rejects.toThrow(/Sitio web/);
  });
  it('catálogo público: la consulta exige website_published', async () => {
    let body = '';
    const f = (async (_u: string, init: any) => { const p = JSON.parse(init.body).params; if (p.service === 'object') body = JSON.stringify(p.args); return Response.json({ result: p.method === 'authenticate' ? 1 : [] }); }) as unknown as typeof fetch;
    await new OdooConnector(cfg, f).catalogoPublico();
    expect(body).toContain('website_published');
  });
});

describe('utilidades de dinero y fechas', () => {
  it('cubetas de antigüedad', () => {
    expect([-5, 0, 1, 30, 31, 60, 61, 90, 91].map(agingBucket)).toEqual(['al_corriente', 'al_corriente', '1-30', '1-30', '31-60', '31-60', '61-90', '61-90', '90+']);
  });
  it('daysBetween y fechas válidas', () => {
    expect(daysBetween('2026-01-01', '2026-03-01')).toBe(59);
    expect(isValidDate('2026-02-30')).toBe(false); expect(isValidDate('2026-02-28')).toBe(true); expect(isValidDate('26-1-1')).toBe(false);
  });
  it('sumByCurrency nunca mezcla monedas', () => {
    expect(sumByCurrency([{ currency: 'MXN', amount: '1.10' }, { currency: 'USD', amount: 2 }, { currency: 'MXN', amount: '2.20' }]))
      .toEqual([{ currency: 'MXN', total: '3.30', count: 2 }, { currency: 'USD', total: '2.00', count: 1 }]);
  });
});

// ---- Modos y herramientas ----
const ctxFor = (erp: any = null): ToolCtx => ({ erp, today: '2026-02-01', companyName: 'Acme', searchKnowledge: async () => [{ content: 'Horario 9 a 18' }], buildReport: buildReport as any, attachments: [] });
const scripted = (responses: LlmResponse[]): LlmClient => { let i = 0; return { complete: async () => responses[Math.min(i++, responses.length - 1)] }; };

describe('separación de modos (Gerente vs Cliente)', () => {
  it('Cliente: sin flags públicos no tiene ninguna herramienta', () => expect(toolsForMode('cliente', {})).toEqual([]));
  it('Cliente: sólo herramientas elegibles y marcadas públicas', () => {
    const t = toolsForMode('cliente', { buscar_conocimiento: true, catalogo_productos: false }).map((x) => x.name);
    expect(t).toEqual(['buscar_conocimiento']);
  });
  it('Cliente: aunque la BD marcara públicas las privadas, el código las excluye', () => {
    const all = Object.fromEntries(TOOLS.map((t) => [t.name, true]));
    const names = toolsForMode('cliente', all).map((t) => t.name).sort();
    expect(names).toEqual(['buscar_conocimiento', 'catalogo_productos']);
    for (const n of ['ventas', 'cuentas_por_cobrar', 'cuentas_por_pagar', 'inventario', 'clientes', 'generar_reporte']) expect(names).not.toContain(n);
  });
  it('Gerente tiene todas las herramientas', () => expect(toolsForMode('gerente', {}).length).toBe(TOOLS.length));
  it('Cliente: si el LLM pide una herramienta privada, NO se ejecuta', async () => {
    let called = false;
    const erp: any = new Proxy({}, { get: () => () => { called = true; return {}; } });
    const llm = scripted([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'ventas', input: { desde: '2026-01-01', hasta: '2026-01-31' } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'No puedo ayudarte con eso.' }] },
    ]);
    const r = await runAgent({ llm, system: 's', history: [], userText: 'dame las ventas', tools: toolsForMode('cliente', { buscar_conocimiento: true }), ctx: ctxFor(erp) });
    expect(called).toBe(false);
    expect(r.traces).toEqual([expect.objectContaining({ tool: 'ventas', ok: false })]);
  });
  it('Gerente: ejecuta la herramienta y registra la traza', async () => {
    const { fetcher } = fakeOdoo({ 'sale.order': [{ name: 'S1', partner_id: [1, 'A'], date_order: '2026-01-05 10:00:00', amount_total: 10, currency_id: [1, 'MXN'] }] });
    const llm = scripted([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'ventas', input: { desde: '2026-01-01', hasta: '2026-01-31' } }] },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Vendiste 10.00 MXN' }] },
    ]);
    const r = await runAgent({ llm, system: 's', history: [], userText: 'ventas de enero', tools: toolsForMode('gerente', {}), ctx: ctxFor(new OdooConnector(cfg, fetcher)) });
    expect(r.text).toBe('Vendiste 10.00 MXN'); expect(r.traces[0]).toMatchObject({ tool: 'ventas', ok: true, params: { desde: '2026-01-01', hasta: '2026-01-31' } });
  });
  it('errores de herramienta vuelven al LLM como error (fechas inválidas, sin ERP)', async () => {
    const t = TOOLS.find((x) => x.name === 'ventas')!;
    await expect(t.run(ctxFor(null), { desde: '2026-13-01', hasta: '2026-01-31' })).rejects.toThrow(/Fechas/);
    await expect(t.run(ctxFor(null), { desde: '2026-01-01', hasta: '2026-01-31' })).rejects.toThrow(/ERP/);
    await expect(t.run(ctxFor({}), { desde: '2026-02-01', hasta: '2026-01-31' })).rejects.toThrow(/posterior/);
  });
  it('generar_reporte adjunta el archivo y el LLM no recibe su contenido', async () => {
    const { fetcher } = fakeOdoo({ 'sale.order': [{ name: 'S1', partner_id: [1, 'A'], date_order: '2026-01-05 10:00:00', amount_total: 10, currency_id: [1, 'MXN'] }] });
    const ctx = ctxFor(new OdooConnector(cfg, fetcher));
    const out: any = await TOOLS.find((t) => t.name === 'generar_reporte')!.run(ctx, { reporte: 'ventas', formato: 'xlsx', desde: '2026-01-01', hasta: '2026-01-31' });
    expect(ctx.attachments).toHaveLength(1); expect(JSON.stringify(out)).not.toContain('base64');
  });
});

describe('prompt y filtros determinísticos', () => {
  const s = { company_name: 'Acme', company_profile: 'Vendemos tornillos', rules: 'Nunca des descuentos', forbidden_topics: ['política', 'Competencia X'], tone: 'formal', website_url: 'https://acme.mx', human_contact: 'ventas@acme.mx' };
  it('incluye reglas, tema prohibido y contacto; modo cliente prohíbe datos internos', () => {
    const c = buildSystemPrompt('cliente', s, '2026-02-01');
    for (const x of ['Nunca des descuentos', 'política', 'ventas@acme.mx', 'ÚNICAMENTE', 'sólo consulta']) expect(c.toLowerCase()).toContain(x.toLowerCase());
    expect(buildSystemPrompt('gerente', s, '2026-02-01')).not.toContain('MODO CLIENTE');
  });
  it('findForbidden ignora acentos y mayúsculas', () => {
    expect(findForbidden('¿Qué opinas de la POLITICA?', ['política'])).toBe('política');
    expect(findForbidden('hola', ['política'])).toBeNull(); expect(findForbidden('x', ['', ' '])).toBeNull();
  });
});

describe('conocimiento y red', () => {
  it('htmlToText quita scripts/estilos', () => {
    const t = htmlToText('<html><head><title>x</title></head><body><script>alert(1)</script><p>Hola&nbsp;mundo</p><style>a{}</style><p>Adiós</p></body></html>');
    expect(t).toBe('Hola mundo\nAdiós');
  });
  it('chunkText respeta tamaño y no pierde contenido', () => {
    const text = Array.from({ length: 200 }, (_, i) => 'palabra' + i).join(' ');
    const ch = chunkText(text, 300, 50);
    expect(ch.length).toBeGreaterThan(3); for (const c of ch) expect(c.length).toBeLessThanOrEqual(300);
    expect(ch.join(' ')).toContain('palabra0'); expect(ch.join(' ')).toContain('palabra199'); expect(chunkText('  ')).toEqual([]);
  });
  it('REGRESIÓN: descargar una página con error de red da un mensaje claro', async () => {
    const f = (async () => { throw new TypeError('dns error'); }) as unknown as typeof fetch;
    await expect(fetchPageText('https://www.ejemplo.mx/faq', f)).rejects.toThrow(/No se pudo descargar la página/);
  });
  it('assertSafeUrl bloquea SSRF', () => {
    for (const u of ['http://a.com', 'https://localhost/x', 'https://127.0.0.1', 'https://10.1.1.1', 'https://172.16.0.1', 'https://169.254.169.254/latest', 'https://[::1]/', 'https://u:p@a.com', 'ftp://a.com', 'nope', 'https://2130706433', 'https://metadata.internal'])
      expect(() => assertSafeUrl(u), u).toThrow();
    expect(assertSafeUrl('https://www.acme.mx/contacto').hostname).toBe('www.acme.mx');
  });
  it('cifrado: ida y vuelta, ligado a la empresa, y falla con otra clave o empresa', async () => {
    const key = Buffer.alloc(32, 7).toString('base64'); const other = Buffer.alloc(32, 9).toString('base64');
    const enc = await encryptSecret('mi-api-key', key, 'tenant-1');
    expect(enc.startsWith('v1.')).toBe(true); expect(enc).not.toContain('mi-api-key');
    expect(await decryptSecret(enc, key, 'tenant-1')).toBe('mi-api-key');
    await expect(decryptSecret(enc, key, 'tenant-2')).rejects.toThrow();
    await expect(decryptSecret(enc, other, 'tenant-1')).rejects.toThrow();
  });
});

describe('clave derivada', () => {
  it('es estable, de 32 bytes y distinta por semilla', async () => {
    const a = await deriveKeyB64('x'); expect(Buffer.from(a, 'base64')).toHaveLength(32);
    expect(await deriveKeyB64('x')).toBe(a); expect(await deriveKeyB64('y')).not.toBe(a);
    expect(await decryptSecret(await encryptSecret('k', a, 't'), a, 't')).toBe('k');
  });
});

describe('reportes', () => {
  const ventas: any = { from: '2026-01-01', to: '2026-01-31', orderCount: 1, totals: [{ currency: 'MXN', total: '10.00', count: 1 }], topClientes: [], pedidos: [{ folio: 'S1', cliente: 'Ñandú', fecha: '2026-01-05', currency: 'MXN', total: '10.00' }], truncated: true, note: 'nota' };
  it('xlsx: valores numéricos, totales, fuente y aviso de datos parciales', async () => {
    const a = await buildReport('ventas', 'xlsx', ventas, { company: 'Acme', periodo: '2026-01-01 a 2026-01-31' }, new Date('2026-02-01T10:00:00Z'));
    expect(a.filename).toBe('ventas_acme_2026-02-01.xlsx');
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(a.base64, 'base64') as any); const ws = wb.worksheets[0];
    const cells = JSON.stringify(ws.getSheetValues());
    expect(cells).toContain('Fuente: ERP'); expect(cells).toContain('Total MXN: 10.00'); expect(cells).toContain('datos parciales'); expect(ws.getRow(5).getCell(5).value).toBe(10);
  });
  it('pdf: archivo válido con acentos/eñes y caracteres no latinos', async () => {
    const a = await buildReport('ventas', 'pdf', { ...ventas, pedidos: [{ ...ventas.pedidos[0], cliente: 'Ñandú 日本' }] }, { company: 'Acme', periodo: 'x' });
    expect(Buffer.from(a.base64, 'base64').subarray(0, 5).toString()).toBe('%PDF-');
  });
  it('pdf de cartera e inventario se generan', async () => {
    const car: any = { asOf: '2026-02-01', totals: [], aging: [], documentos: [], truncated: false };
    for (const k of ['cuentas_por_cobrar', 'cuentas_por_pagar'] as const) expect((await buildReport(k, 'pdf', car, { company: 'A', periodo: 'x' })).mime).toBe('application/pdf');
    expect((await buildReport('inventario', 'xlsx', { filas: [], truncated: false }, { company: 'A', periodo: 'x' })).filename).toMatch(/\.xlsx$/);
  });
});

describe('modelo y consumo de tokens', () => {
  it('el modelo por defecto es Haiku 5.5', () => expect(DEFAULT_MODEL).toBe('claude-haiku-5-5'));
  it('runAgent suma los tokens de todas las llamadas al modelo', async () => {
    const llm = scripted([
      { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'buscar_conocimiento', input: { consulta: 'x' } }], usage: { input_tokens: 100, output_tokens: 20 } },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 150, output_tokens: 30 } },
    ]);
    const r = await runAgent({ llm, system: 's', history: [], userText: 'hola', tools: toolsForMode('cliente', { buscar_conocimiento: true }), ctx: ctxFor(null) });
    expect(r.usage).toEqual({ input_tokens: 250, output_tokens: 50, calls: 2 });
  });
  it('sin datos de uso del proveedor cuenta llamadas pero 0 tokens (no revienta)', async () => {
    const r = await runAgent({ llm: scripted([{ stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }]), system: 's', history: [], userText: 'hola', tools: [], ctx: ctxFor(null) });
    expect(r.usage).toEqual({ input_tokens: 0, output_tokens: 0, calls: 1 });
  });
  it('isOverLimit: al llegar al tope bloquea; con datos inválidos no bloquea por error', () => {
    expect(isOverLimit(99, 100)).toBe(false); expect(isOverLimit(100, 100)).toBe(true); expect(isOverLimit(101, 100)).toBe(true);
    expect(isOverLimit(NaN, 100)).toBe(false); expect(isOverLimit(5, 0)).toBe(false); expect(isOverLimit(5, NaN)).toBe(false);
  });
  it('limitMessage: el modo cliente nunca menciona planes ni consumo; deriva a contacto humano', () => {
    expect(limitMessage('cliente', 'ventas@x.mx')).toContain('ventas@x.mx');
    expect(limitMessage('cliente', '')).not.toMatch(/plan|límite|token/i);
    expect(limitMessage('gerente', '')).toMatch(/límite mensual/);
  });
});

describe('herramientas: búsqueda por texto', () => {
  it('REGRESIÓN: la herramienta inventario manda el término en singular al conector', async () => {
    let got: string | undefined; const erp: any = { inventario: async (q?: string) => { got = q; return { filas: [], truncated: false }; } };
    await TOOLS.find((t) => t.name === 'inventario')!.run(ctxFor(erp), { buscar: 'Tornillos grandes' });
    expect(got).toBe('Tornillo grande');
  });
});

import { isAuthError, keyHint, looksLikeAnthropicKey } from '../supabase/functions/_shared/llm.ts';
describe('clave de IA propia: validación', () => {
  it('reconoce el formato y oculta la clave', () => {
    expect(looksLikeAnthropicKey('sk-ant-api03-' + 'a'.repeat(40))).toBe(true);
    for (const k of ['', 'sk-123', 'sk-ant-corta', 'sk-ant-api03-' + 'a'.repeat(40) + ' x', 'Bearer sk-ant-' + 'a'.repeat(40)]) expect(looksLikeAnthropicKey(k)).toBe(false);
    expect(keyHint('sk-ant-api03-' + 'a'.repeat(36) + 'WXYZ')).toBe('…WXYZ');
  });
  it('detecta rechazo de credenciales sólo en 401/403', () => {
    expect(isAuthError(new Error('LLM HTTP 401: x'))).toBe(true);
    expect(isAuthError(new Error('LLM HTTP 403: x'))).toBe(true);
    expect(isAuthError(new Error('LLM HTTP 429: x'))).toBe(false);
    expect(isAuthError('LLM HTTP 401')).toBe(false);
  });
});
