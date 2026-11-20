// Edge Function única: chat (Gerente/Cliente), configuración del ERP y conocimiento.
// Secreto requerido: ANTHROPIC_API_KEY. Opcional: ERP_ENC_KEY (32 bytes base64; si falta se deriva de la service key). SUPABASE_* los inyecta Supabase.
import { createClient } from '@supabase/supabase-js';
import { runAgent } from '../_shared/agent.ts';
import { decryptSecret, deriveKeyB64, encryptSecret } from '../_shared/crypto.ts';
import { chunkText, fetchPageText } from '../_shared/knowledge.ts';
import { AnthropicClient, DEFAULT_MODEL, type LlmMessage } from '../_shared/llm.ts';
import { assertSafeUrl } from '../_shared/net.ts';
import { buildConnector, SOURCE_TYPES } from '../_shared/source.ts';
import { GenericRestConnector, validateGenericConfig } from '../_shared/generic.ts';
import { DATASETS, DATASET_KEYS, sanitizeMapping, type DatasetKey } from '../_shared/mapping.ts';
import { MAX_FILE_BYTES, normalizeRows, parseDatasetFile, suggestMapping, type DatasetLoader } from '../_shared/files.ts';
import type { ErpConnector } from '../_shared/erp.ts';
import { buildSystemPrompt, findForbidden, REFUSAL, type Settings } from '../_shared/prompt.ts';
import { buildReport } from '../_shared/reports.ts';
import { WIDGET_JS } from '../_shared/widget.ts';
import { WhatsAppClient, parseWebhook, phonesMatch, splitMessage, timingSafeEqual, verifyAccess, verifySignature } from '../_shared/whatsapp.ts';
import { toolsForMode, type Mode, type ToolCtx } from '../_shared/tools.ts';
import { isOverLimit, limitMessage } from '../_shared/usage.ts';
import type { Attachment } from '../_shared/reports.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const cors = (origin: string | null) => ({
  'access-control-allow-origin': origin ?? '*', 'vary': 'origin',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
});
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }
/** URL escrita por el usuario: si es insegura/inválida se responde 400 con el motivo (no 500). */
const safeUrl = (raw: unknown): URL => { try { return assertSafeUrl(String(raw ?? '').trim()); } catch (e) { throw new HttpError(400, e instanceof Error ? e.message : 'URL inválida'); } };

const encKey = async () => env('ERP_ENC_KEY') || deriveKeyB64(env('SUPABASE_SERVICE_ROLE_KEY'));
const LIMITS = { gerenteMsg: 4000, clienteMsg: 1000, clienteConv: 30, clienteHour: 300 };

async function userFrom(req: Request): Promise<string> {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) throw new HttpError(401, 'Inicia sesión');
  const { data, error } = await sb.auth.getUser(jwt);
  if (error || !data.user) throw new HttpError(401, 'Sesión inválida');
  return data.user.id;
}
async function roleOf(tenant: string, user: string): Promise<string | null> {
  const { data } = await sb.from('members').select('role').eq('tenant_id', tenant).eq('user_id', user).maybeSingle();
  return data?.role ?? null;
}
async function requireAdmin(req: Request, tenant: unknown): Promise<{ tenant: string; user: string }> {
  if (typeof tenant !== 'string') throw new HttpError(400, 'Falta tenant_id');
  const user = await userFrom(req);
  if ((await roleOf(tenant, user)) !== 'admin') throw new HttpError(403, 'Sólo el administrador');
  return { tenant, user };
}
async function audit(tenant: string, actor: string | null, action: string, detail: Record<string, unknown> = {}) {
  await sb.from('audit_events').insert({ tenant_id: tenant, actor, action, detail });
}

/** Carga las filas ya validadas del archivo activo de un conjunto de datos de la empresa. */
const loaderFor = (tenant: string): DatasetLoader => async (ds) => {
  const { data: v } = await sb.from('dataset_versions').select('id, filename, uploaded_at').eq('tenant_id', tenant).eq('dataset', ds).eq('active', true).maybeSingle();
  if (!v) return null;
  const rows: Record<string, string>[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data } = await sb.from('dataset_rows').select('data').eq('version_id', v.id).order('id').range(from, from + 999);
    if (!data?.length) break;
    rows.push(...data.map((r: any) => r.data));
    if (data.length < 1000) break;
  }
  return { rows, meta: { filename: v.filename, uploaded_at: v.uploaded_at } };
};

async function connectorFor(tenant: string): Promise<ErpConnector | null> {
  const { data } = await sb.from('erp_sources').select('type, config, secret_enc').eq('tenant_id', tenant).maybeSingle();
  if (!data) return null;
  const secret = data.secret_enc ? await decryptSecret(data.secret_enc, await encKey(), tenant) : null;
  return buildConnector({ type: data.type, config: data.config ?? {}, secret }, { loadDataset: loaderFor(tenant) });
}

interface Turn { tenant: string; mode: Mode; channel: 'app' | 'web' | 'whatsapp'; user: string | null; text: string; convId: string | null; reuseHours?: number }

/** Una vuelta de conversación (compartida por la app, el widget web y WhatsApp). */
async function converse(a: Turn) {
  const { tenant, mode, channel, user, text } = a;
  const [{ data: s }, { data: tx }] = await Promise.all([
    sb.from('tenant_settings').select('*').eq('tenant_id', tenant).single(),
    sb.from('tools_exposed').select('tool, is_public').eq('tenant_id', tenant),
  ]);
  const settings = s as Settings;
  const flags = Object.fromEntries((tx ?? []).map((t: any) => [t.tool, t.is_public]));

  let convId: string | null = a.convId;
  if (!convId && a.reuseHours && user) {
    const since = new Date(Date.now() - a.reuseHours * 3600_000).toISOString();
    const { data: last } = await sb.from('conversations').select('id').eq('tenant_id', tenant).eq('user_id', user).eq('channel', channel).gte('created_at', since).order('created_at', { ascending: false }).limit(1).maybeSingle();
    convId = last?.id ?? null;
  }
  let history: LlmMessage[] = [];
  if (convId) {
    const { data: c } = await sb.from('conversations').select('id, mode, user_id, tenant_id').eq('id', convId).maybeSingle();
    if (!c || c.tenant_id !== tenant || c.mode !== mode || (mode === 'gerente' && c.user_id !== user)) throw new HttpError(404, 'Conversación no encontrada');
    const { data: ms } = await sb.from('messages').select('role, content').eq('conversation_id', convId).order('id', { ascending: false }).limit(20);
    history = (ms ?? []).reverse() as LlmMessage[];
    if (mode === 'cliente' && history.filter((m) => m.role === 'user').length >= LIMITS.clienteConv) throw new HttpError(429, 'Conversación demasiado larga; inicia una nueva');
  } else {
    const { data: c, error } = await sb.from('conversations').insert({ tenant_id: tenant, mode, channel, user_id: user }).select('id').single();
    if (error) throw new HttpError(500, 'No se pudo crear la conversación');
    convId = c.id;
  }
  await sb.from('messages').insert({ conversation_id: convId, tenant_id: tenant, role: 'user', content: text });

  const today = new Date().toISOString().slice(0, 10);
  let reply: string; const attachments: Attachment[] = []; let traces: any[] = [];
  const forbidden = mode === 'cliente' ? findForbidden(text, settings.forbidden_topics) : null;
  let over = false; let usageRec: { input_tokens: number; output_tokens: number; calls: number } | null = null;
  const model = env('ANTHROPIC_MODEL') || DEFAULT_MODEL;
  if (!forbidden) {
    const { data: uc } = await sb.rpc('usage_check', { p_tenant: tenant, p_mode: mode });
    const q: any = Array.isArray(uc) ? uc[0] : uc;
    over = !!q && isOverLimit(Number(q.used), Number(q.token_limit));
  }
  if (forbidden) {
    reply = REFUSAL(settings.human_contact);
  } else if (over) {
    reply = limitMessage(mode, settings.human_contact); // tope mensual alcanzado: no se llama al modelo
  } else {
    const ctx: ToolCtx = {
      erp: mode === 'gerente' || flags['catalogo_productos'] ? await connectorFor(tenant) : null,
      today, companyName: settings.company_name || 'Empresa', attachments, buildReport,
      searchKnowledge: async (q) => { const { data } = await sb.rpc('search_knowledge', { p_tenant: tenant, p_query: q, p_limit: 5 }); return (data ?? []) as { content: string }[]; },
    };
    try {
      const r = await runAgent({
        llm: new AnthropicClient(env('ANTHROPIC_API_KEY'), model),
        system: buildSystemPrompt(mode, settings, today), history, userText: text, tools: toolsForMode(mode, flags), ctx,
      });
      reply = r.text || 'No tengo una respuesta para eso.'; traces = r.traces; usageRec = r.usage;
    } catch (e) {
      console.error('agent error', e instanceof Error ? e.message : e);
      reply = 'En este momento no puedo responder. Intenta de nuevo en unos minutos.';
    }
    if (mode === 'cliente' && findForbidden(reply, settings.forbidden_topics)) reply = REFUSAL(settings.human_contact);
  }
  if (usageRec && usageRec.calls > 0) await sb.from('usage_events').insert({ tenant_id: tenant, conversation_id: convId, mode, channel, model, input_tokens: usageRec.input_tokens, output_tokens: usageRec.output_tokens });
  await sb.from('messages').insert({ conversation_id: convId, tenant_id: tenant, role: 'assistant', content: reply });
  if (traces.length) await sb.from('tool_calls').insert(traces.map((t) => ({ tenant_id: tenant, conversation_id: convId, tool: t.tool, params: t.params, ok: t.ok, summary: t.summary })));
  return { conversation_id: convId as string, reply, attachments: mode === 'gerente' ? attachments : [] };
}

async function chat(req: Request, body: any, origin: string | null) {
  const text = typeof body.message === 'string' ? body.message.trim() : '';
  if (!text) throw new HttpError(400, 'Mensaje vacío');
  if (!env('ANTHROPIC_API_KEY')) throw new HttpError(503, 'El asistente aún no está configurado (falta la clave del modelo de IA).');
  const convId: string | null = typeof body.conversation_id === 'string' ? body.conversation_id : null;

  if (typeof body.channel_token === 'string') {
    const { data: ch } = await sb.from('channels').select('tenant_id, enabled, allowed_origins').eq('public_token', body.channel_token).eq('kind', 'web').maybeSingle();
    if (!ch || !ch.enabled) throw new HttpError(403, 'Canal no disponible');
    const allowed: string[] = ch.allowed_origins ?? [];
    if (!origin || !allowed.includes(origin)) throw new HttpError(403, 'Este sitio no está autorizado para usar el asistente');
    if (text.length > LIMITS.clienteMsg) throw new HttpError(400, 'Mensaje demasiado largo');
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await sb.from('messages').select('id, conversations!inner(channel)', { count: 'exact', head: true })
      .eq('tenant_id', ch.tenant_id).eq('role', 'user').eq('conversations.channel', 'web').gte('created_at', since);
    if ((count ?? 0) >= LIMITS.clienteHour) throw new HttpError(429, 'Demasiadas consultas; intenta más tarde');
    return converse({ tenant: ch.tenant_id, mode: 'cliente', channel: 'web', user: null, text, convId });
  }
  const user = await userFrom(req);
  if (typeof body.tenant_id !== 'string') throw new HttpError(400, 'Falta tenant_id');
  const role = await roleOf(body.tenant_id, user);
  if (role !== 'admin' && role !== 'gerente') throw new HttpError(403, 'Sin permiso para el modo Gerente');
  if (text.length > LIMITS.gerenteMsg) throw new HttpError(400, 'Mensaje demasiado largo');
  return converse({ tenant: body.tenant_id, mode: 'gerente', channel: 'app', user, text, convId });
}

// ---- WhatsApp (Cloud API de Meta): modo Gerente para números autorizados. NO PROBADO contra Meta real. ----
async function whatsappWebhook(req: Request): Promise<Response> {
  if (req.method === 'GET') {
    const u = new URL(req.url);
    const ok = u.searchParams.get('hub.mode') === 'subscribe' && !!env('WHATSAPP_VERIFY_TOKEN') && timingSafeEqual(u.searchParams.get('hub.verify_token') ?? '', env('WHATSAPP_VERIFY_TOKEN'));
    return ok ? new Response(u.searchParams.get('hub.challenge') ?? '', { status: 200 }) : new Response('forbidden', { status: 403 });
  }
  const raw = await req.text();
  if (!(await verifySignature(raw, req.headers.get('x-hub-signature-256'), env('WHATSAPP_APP_SECRET')))) return new Response('bad signature', { status: 401 });
  let payload: unknown; try { payload = JSON.parse(raw); } catch { return new Response('bad json', { status: 400 }); }
  const work = (async () => {
    for (const m of parseWebhook(payload)) {
      try { await handleWhatsApp(m); } catch (e) { console.error('whatsapp error', e instanceof Error ? e.message : e); }
    }
  })();
  // Responder 200 de inmediato (Meta reintenta si tarda) y terminar el trabajo en segundo plano.
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(work); else await work;
  return new Response('ok', { status: 200 }); // siempre 200: Meta reintenta si no
}

async function handleWhatsApp(m: { wamid: string; from: string; phoneNumberId: string; type: string; text: string }) {
  const { data: acc } = await sb.from('whatsapp_accounts').select('tenant_id, token_enc, enabled').eq('phone_number_id', m.phoneNumberId).maybeSingle();
  if (!acc || !acc.enabled) return;
  const { data: nums } = await sb.from('whatsapp_numbers').select('phone, user_id').eq('tenant_id', acc.tenant_id);
  const who = (nums ?? []).find((n: any) => phonesMatch(n.phone, m.from));
  if (!who) { console.log('whatsapp: número no autorizado'); return; } // sin respuesta: no se confirma nada a desconocidos
  const role = await roleOf(acc.tenant_id, who.user_id);
  if (role !== 'admin' && role !== 'gerente') return;
  const { error: dup } = await sb.from('whatsapp_processed').insert({ wamid: m.wamid });
  if (dup) { if (dup.code === '23505') return; throw new Error('dedupe: ' + dup.message); } // 23505 = ya procesado (reintento de Meta)
  try {
    const wa = new WhatsAppClient(await decryptSecret(acc.token_enc, await encKey(), acc.tenant_id), m.phoneNumberId, env('WHATSAPP_GRAPH_VERSION') || 'v23.0');
    if (m.type !== 'text' || !m.text.trim()) { await wa.sendText(m.from, 'Por ahora sólo puedo leer mensajes de texto.'); return; }
    if (!env('ANTHROPIC_API_KEY')) { await wa.sendText(m.from, 'El asistente aún no está configurado.'); return; }
    const r = await converse({ tenant: acc.tenant_id, mode: 'gerente', channel: 'whatsapp', user: who.user_id, text: m.text.trim().slice(0, LIMITS.gerenteMsg), convId: null, reuseHours: 12 });
    for (const part of splitMessage(r.reply)) await wa.sendText(m.from, part);
    for (const att of r.attachments) await wa.sendDocument(m.from, att);
  } catch (e) {
    await sb.from('whatsapp_processed').delete().eq('wamid', m.wamid); // permite que el reintento de Meta vuelva a intentarlo
    throw e;
  }
}

async function erpTest(tenant: string, actor: string) {
  const c = await connectorFor(tenant);
  if (!c) throw new HttpError(404, 'No hay ERP configurado');
  try {
    const r = await c.ping();
    await sb.from('erp_sources').update({ status: 'ok', last_checked_at: new Date().toISOString(), last_error: null }).eq('tenant_id', tenant);
    await audit(tenant, actor, 'erp_test', { ok: true });
    return { ok: true, detail: r.detail };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    await sb.from('erp_sources').update({ status: 'error', last_checked_at: new Date().toISOString(), last_error: msg.slice(0, 300) }).eq('tenant_id', tenant);
    await audit(tenant, actor, 'erp_test', { ok: false });
    return { ok: false, detail: msg };
  }
}

async function route(req: Request, origin: string | null) {
  const body = await req.json().catch(() => ({}));
  switch (body.action) {
    case 'chat': return chat(req, body, origin);
    case 'erp_save': {
      const { tenant, user } = await requireAdmin(req, body.tenant_id);
      const url = safeUrl(body.url).origin;
      for (const k of ['db', 'username', 'api_key']) if (typeof body[k] !== 'string' || !body[k].trim()) throw new HttpError(400, `Falta ${k}`);
      const secret_enc = await encryptSecret(body.api_key.trim(), await encKey(), tenant);
      const { error } = await sb.from('erp_sources').upsert({ tenant_id: tenant, type: 'odoo', config: { url, db: body.db.trim(), username: body.username.trim() }, secret_enc, status: 'sin_probar', last_error: null, updated_at: new Date().toISOString() });
      if (error) throw new HttpError(500, 'No se pudo guardar');
      await audit(tenant, user, 'erp_saved', { url });
      return erpTest(tenant, user);
    }
    case 'wa_save': {
      const { tenant, user } = await requireAdmin(req, body.tenant_id);
      const pid = String(body.phone_number_id ?? '').trim(); const token = String(body.access_token ?? '').trim();
      if (!/^[0-9]{5,25}$/.test(pid) || !token) throw new HttpError(400, 'Falta el ID del número o el token');
      if (!(await verifyAccess(token, pid, env('WHATSAPP_GRAPH_VERSION') || 'v23.0'))) throw new HttpError(400, 'Meta no confirmó ese ID con ese token. Revisa que el token tenga acceso al número.');
      const { error } = await sb.from('whatsapp_accounts').upsert({ tenant_id: tenant, phone_number_id: pid, token_enc: await encryptSecret(token, await encKey(), tenant), enabled: true });
      if (error) throw new HttpError(error.code === '23505' ? 409 : 500, error.code === '23505' ? 'Ese número ya está registrado en otra empresa' : 'No se pudo guardar');
      await audit(tenant, user, 'wa_saved', { phone_number_id: pid });
      return { ok: true };
    }
    case 'source_save': {
      const { tenant, user } = await requireAdmin(req, body.tenant_id);
      const type = body.type;
      if (!SOURCE_TYPES.includes(type)) throw new HttpError(400, 'Tipo de fuente inválido');
      const { data: cur } = await sb.from('erp_sources').select('type, secret_enc').eq('tenant_id', tenant).maybeSingle();
      const fresh = typeof body.secret === 'string' && body.secret.trim() ? body.secret.trim() : null;
      let config: Record<string, unknown> = {}; let secret_enc: string | null = null;
      if (type === 'odoo') {
        const c = body.config ?? {}; const url = safeUrl(c.url).origin;
        for (const k of ['db', 'username']) if (typeof c[k] !== 'string' || !c[k].trim()) throw new HttpError(400, `Falta ${k}`);
        config = { url, db: c.db.trim(), username: c.username.trim() };
        secret_enc = fresh ? await encryptSecret(fresh, await encKey(), tenant) : cur?.type === 'odoo' ? cur.secret_enc : null;
        if (!secret_enc) throw new HttpError(400, 'Falta la API key');
      } else if (type === 'generic_rest') {
        let cfg; try { cfg = validateGenericConfig(body.config); } catch (e) { throw new HttpError(400, e instanceof Error ? e.message : 'Configuración inválida'); }
        config = cfg as unknown as Record<string, unknown>;
        if (cfg.auth.type !== 'none') {
          secret_enc = fresh ? await encryptSecret(fresh, await encKey(), tenant) : cur?.type === 'generic_rest' ? cur.secret_enc : null;
          if (!secret_enc) throw new HttpError(400, 'Falta la llave, token o contraseña de la API');
        }
      }
      const { error } = await sb.from('erp_sources').upsert({ tenant_id: tenant, type, config, secret_enc, status: 'sin_probar', last_error: null, last_checked_at: null, updated_at: new Date().toISOString() });
      if (error) throw new HttpError(500, 'No se pudo guardar');
      await audit(tenant, user, 'source_saved', { type });
      if (type === 'files') return { ok: true, detail: 'Listo. Ahora carga tus archivos.' };
      return erpTest(tenant, user);
    }
    case 'generic_preview': {
      const { tenant } = await requireAdmin(req, body.tenant_id);
      const ds = body.dataset as DatasetKey; if (!DATASET_KEYS.includes(ds)) throw new HttpError(400, 'Conjunto de datos inválido');
      let cfg; try { cfg = validateGenericConfig(body.config); } catch (e) { return { ok: false, detail: e instanceof Error ? e.message : 'Configuración inválida' }; }
      let secret = typeof body.secret === 'string' ? body.secret.trim() : '';
      if (!secret && cfg.auth.type !== 'none') {
        const { data: cur } = await sb.from('erp_sources').select('type, secret_enc').eq('tenant_id', tenant).maybeSingle();
        if (cur?.type === 'generic_rest' && cur.secret_enc) secret = await decryptSecret(cur.secret_enc, await encKey(), tenant);
        else return { ok: false, detail: 'Escribe la llave o contraseña de la API para probar.' };
      }
      try {
        const dp = cfg.queries.ventas?.date_params; const now = Date.now();
        const extra = ds === 'ventas' && dp ? { [dp.from]: new Date(now - 30 * 86400000).toISOString().slice(0, 10), [dp.to]: new Date(now).toISOString().slice(0, 10) } : {};
        const rows = await new GenericRestConnector(cfg, secret).sample(ds, extra);
        return { ok: true, rows, detail: rows.length ? `Se leyeron y validaron ${rows.length} registro(s) de muestra.` : 'La API respondió, pero no devolvió registros.' };
      } catch (e) { return { ok: false, detail: e instanceof Error ? e.message : 'No se pudo probar' }; }
    }
    case 'dataset_preview': case 'dataset_commit': {
      const { tenant, user } = await requireAdmin(req, body.tenant_id);
      const ds = body.dataset as DatasetKey; if (!DATASET_KEYS.includes(ds)) throw new HttpError(400, 'Conjunto de datos inválido');
      const filename = String(body.filename ?? 'archivo').replace(/[\u0000-\u001f]/g, '').slice(0, 255) || 'archivo';
      if (typeof body.base64 !== 'string' || !body.base64 || body.base64.length > Math.ceil(MAX_FILE_BYTES * 1.4)) throw new HttpError(400, 'Archivo vacío o demasiado grande (máximo 5 MB)');
      let bytes: Uint8Array; try { bytes = Uint8Array.from(atob(body.base64), (c) => c.charCodeAt(0)); } catch { throw new HttpError(400, 'Archivo corrupto'); }
      let parsed; try { parsed = await parseDatasetFile(filename, bytes); } catch (e) { return { ok: false, detail: e instanceof Error ? e.message : 'No se pudo leer el archivo' }; }
      if (body.action === 'dataset_preview') {
        const show = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '')).slice(0, 80);
        return { ok: true, headers: parsed.headers, row_count: parsed.rows.length, sample: parsed.rows.slice(0, 5).map((r) => Object.fromEntries(parsed.headers.map((h) => [h, show(r[h])]))), suggested: suggestMapping(ds, parsed.headers) };
      }
      const { data: cur } = await sb.from('erp_sources').select('type').eq('tenant_id', tenant).maybeSingle();
      if (cur?.type !== 'files') throw new HttpError(400, 'Primero elige "Archivos" como fuente de datos.');
      let mapping; try { mapping = sanitizeMapping(ds, body.mapping); } catch (e) { throw new HttpError(400, e instanceof Error ? e.message : 'Mapeo inválido'); }
      const opts = { decimal: body.decimal === ',' ? ',' as const : '.' as const, date_format: (['iso', 'dmy', 'mdy'].includes(body.date_format) ? body.date_format : 'iso') as 'iso' | 'dmy' | 'mdy' };
      const n = normalizeRows(ds, parsed, mapping, opts);
      if (n.errors.length) return { ok: false, detail: 'El archivo tiene errores; no se cargó nada. Corrígelo y vuelve a subirlo.', errors: n.errors.slice(0, 20) };
      const { data: old } = await sb.from('dataset_versions').select('id').eq('tenant_id', tenant).eq('dataset', ds).eq('active', true).maybeSingle();
      const { data: ver, error: e1 } = await sb.from('dataset_versions').insert({ tenant_id: tenant, dataset: ds, filename, row_count: n.rows.length, uploaded_by: user, active: false }).select('id').single();
      if (e1) throw new HttpError(500, 'No se pudo guardar el archivo');
      try {
        for (let i = 0; i < n.rows.length; i += 500) {
          const { error } = await sb.from('dataset_rows').insert(n.rows.slice(i, i + 500).map((data) => ({ version_id: ver.id, tenant_id: tenant, data })));
          if (error) throw new Error('No se pudieron guardar las filas');
        }
      } catch (e) { await sb.from('dataset_versions').delete().eq('id', ver.id); throw new HttpError(500, e instanceof Error ? e.message : 'Error al guardar'); }
      if (old) await sb.from('dataset_versions').update({ active: false }).eq('id', old.id);
      const { error: e2 } = await sb.from('dataset_versions').update({ active: true }).eq('id', ver.id);
      if (e2) { await sb.from('dataset_versions').delete().eq('id', ver.id); if (old) await sb.from('dataset_versions').update({ active: true }).eq('id', old.id); throw new HttpError(500, 'No se pudo activar el archivo'); }
      if (old) await sb.from('dataset_versions').delete().eq('id', old.id);
      await sb.from('erp_sources').update({ status: 'ok', last_checked_at: new Date().toISOString(), last_error: null }).eq('tenant_id', tenant);
      await audit(tenant, user, 'dataset_loaded', { dataset: ds, filename, rows: n.rows.length });
      return { ok: true, rows: n.rows.length, detail: `Se cargaron ${n.rows.length.toLocaleString('es-MX')} filas de ${DATASETS[ds].label}.` };
    }
    case 'dataset_remove': {
      const { tenant, user } = await requireAdmin(req, body.tenant_id);
      const ds = body.dataset as DatasetKey; if (!DATASET_KEYS.includes(ds)) throw new HttpError(400, 'Conjunto de datos inválido');
      await sb.from('dataset_versions').delete().eq('tenant_id', tenant).eq('dataset', ds).eq('active', true);
      const { count } = await sb.from('dataset_versions').select('id', { count: 'exact', head: true }).eq('tenant_id', tenant).eq('active', true);
      if (!count) await sb.from('erp_sources').update({ status: 'sin_probar', last_error: null }).eq('tenant_id', tenant).eq('type', 'files');
      await audit(tenant, user, 'dataset_removed', { dataset: ds });
      return { ok: true };
    }
    case 'erp_test': { const { tenant, user } = await requireAdmin(req, body.tenant_id); return erpTest(tenant, user); }
    case 'knowledge_add': {
      const { tenant, user } = await requireAdmin(req, body.tenant_id);
      const kind = body.kind === 'url' ? 'url' : 'text';
      let content: string, title = String(body.title ?? '').slice(0, 200), url: string | null = null;
      if (kind === 'url') { url = safeUrl(body.url).toString(); title ||= url; }
      else { content = String(body.text ?? ''); if (!content.trim()) throw new HttpError(400, 'Texto vacío'); title ||= 'Texto'; }
      const { data: src, error } = await sb.from('knowledge_sources').insert({ tenant_id: tenant, kind, title, url }).select('id').single();
      if (error) throw new HttpError(500, 'No se pudo guardar');
      try {
        if (kind === 'url') content = await fetchPageText(url!);
        const chunks = chunkText(content!.slice(0, 200_000));
        if (!chunks.length) throw new Error('No se encontró texto en la fuente');
        const { error: e2 } = await sb.from('knowledge_chunks').insert(chunks.map((c) => ({ tenant_id: tenant, source_id: src.id, content: c })));
        if (e2) throw new Error('No se pudo indexar');
        await audit(tenant, user, 'knowledge_added', { kind, url, chunks: chunks.length });
        return { ok: true, chunks: chunks.length };
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Error';
        await sb.from('knowledge_sources').update({ status: 'error', error: msg.slice(0, 300) }).eq('id', src.id);
        return { ok: false, detail: msg };
      }
    }
    default: throw new HttpError(400, 'Acción desconocida');
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  const path = new URL(req.url).pathname;
  if (path.endsWith('/widget.js') && req.method === 'GET') {
    return new Response(WIDGET_JS, { headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' } });
  }
  if (path.endsWith('/whatsapp')) return whatsappWebhook(req);
  try {
    const out = await route(req, origin);
    return Response.json(out, { headers: cors(origin) });
  } catch (e) {
    if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status, headers: cors(origin) });
    console.error('unhandled', e instanceof Error ? e.message : e);
    return Response.json({ error: 'Error interno' }, { status: 500, headers: cors(origin) });
  }
});
