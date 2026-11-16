// Edge Function única: chat (Gerente/Cliente), configuración del ERP y conocimiento.
// Secretos requeridos: ANTHROPIC_API_KEY, ERP_ENC_KEY (32 bytes base64). SUPABASE_* los inyecta Supabase.
import { createClient } from '@supabase/supabase-js';
import { runAgent } from '../_shared/agent.ts';
import { decryptSecret, encryptSecret } from '../_shared/crypto.ts';
import { chunkText, fetchPageText } from '../_shared/knowledge.ts';
import { AnthropicClient, type LlmMessage } from '../_shared/llm.ts';
import { assertSafeUrl } from '../_shared/net.ts';
import { OdooConnector } from '../_shared/odoo.ts';
import { buildSystemPrompt, findForbidden, REFUSAL, type Settings } from '../_shared/prompt.ts';
import { buildReport } from '../_shared/reports.ts';
import { toolsForMode, type Mode, type ToolCtx } from '../_shared/tools.ts';
import type { Attachment } from '../_shared/reports.ts';

const env = (k: string) => Deno.env.get(k) ?? '';
const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const cors = (origin: string | null) => ({
  'access-control-allow-origin': origin ?? '*', 'vary': 'origin',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
  'access-control-allow-methods': 'POST, OPTIONS',
});
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

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

async function connectorFor(tenant: string): Promise<OdooConnector | null> {
  const { data } = await sb.from('erp_connections').select('*').eq('tenant_id', tenant).maybeSingle();
  if (!data) return null;
  const apiKey = await decryptSecret(data.secret_enc, env('ERP_ENC_KEY'), tenant);
  return new OdooConnector({ url: data.url, db: data.db, username: data.username, apiKey });
}

async function chat(req: Request, body: any, origin: string | null) {
  const text = typeof body.message === 'string' ? body.message.trim() : '';
  if (!text) throw new HttpError(400, 'Mensaje vacío');
  if (!env('ANTHROPIC_API_KEY')) throw new HttpError(503, 'El asistente aún no está configurado (falta la clave del modelo de IA).');

  let mode: Mode, tenant: string, user: string | null = null, channel: 'app' | 'web';
  if (typeof body.channel_token === 'string') {
    mode = 'cliente'; channel = 'web';
    const { data: ch } = await sb.from('channels').select('tenant_id, enabled, allowed_origins').eq('public_token', body.channel_token).maybeSingle();
    if (!ch || !ch.enabled) throw new HttpError(403, 'Canal no disponible');
    const allowed: string[] = ch.allowed_origins ?? [];
    if (!origin || !allowed.includes(origin)) throw new HttpError(403, 'Este sitio no está autorizado para usar el asistente');
    tenant = ch.tenant_id;
    if (text.length > LIMITS.clienteMsg) throw new HttpError(400, 'Mensaje demasiado largo');
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await sb.from('messages').select('id, conversations!inner(channel)', { count: 'exact', head: true })
      .eq('tenant_id', tenant).eq('role', 'user').eq('conversations.channel', 'web').gte('created_at', since);
    if ((count ?? 0) >= LIMITS.clienteHour) throw new HttpError(429, 'Demasiadas consultas; intenta más tarde');
  } else {
    mode = 'gerente'; channel = 'app'; user = await userFrom(req);
    if (typeof body.tenant_id !== 'string') throw new HttpError(400, 'Falta tenant_id');
    tenant = body.tenant_id;
    const role = await roleOf(tenant, user);
    if (role !== 'admin' && role !== 'gerente') throw new HttpError(403, 'Sin permiso para el modo Gerente');
    if (text.length > LIMITS.gerenteMsg) throw new HttpError(400, 'Mensaje demasiado largo');
  }

  const [{ data: s }, { data: tx }] = await Promise.all([
    sb.from('tenant_settings').select('*').eq('tenant_id', tenant).single(),
    sb.from('tools_exposed').select('tool, is_public').eq('tenant_id', tenant),
  ]);
  const settings = s as Settings;
  const flags = Object.fromEntries((tx ?? []).map((t: any) => [t.tool, t.is_public]));

  // Conversación
  let convId: string | null = typeof body.conversation_id === 'string' ? body.conversation_id : null;
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
  if (forbidden) {
    reply = REFUSAL(settings.human_contact);
  } else {
    const ctx: ToolCtx = {
      erp: mode === 'gerente' || flags['catalogo_productos'] ? await connectorFor(tenant) : null,
      today, companyName: settings.company_name || 'Empresa', attachments, buildReport,
      searchKnowledge: async (q) => { const { data } = await sb.rpc('search_knowledge', { p_tenant: tenant, p_query: q, p_limit: 5 }); return (data ?? []) as { content: string }[]; },
    };
    try {
      const r = await runAgent({
        llm: new AnthropicClient(env('ANTHROPIC_API_KEY'), env('ANTHROPIC_MODEL') || 'claude-sonnet-5-5'),
        system: buildSystemPrompt(mode, settings, today), history, userText: text, tools: toolsForMode(mode, flags), ctx,
      });
      reply = r.text || 'No tengo una respuesta para eso.'; traces = r.traces;
    } catch (e) {
      console.error('agent error', e instanceof Error ? e.message : e);
      reply = 'En este momento no puedo responder. Intenta de nuevo en unos minutos.';
    }
    if (mode === 'cliente' && findForbidden(reply, settings.forbidden_topics)) reply = REFUSAL(settings.human_contact);
  }
  await sb.from('messages').insert({ conversation_id: convId, tenant_id: tenant, role: 'assistant', content: reply });
  if (traces.length) await sb.from('tool_calls').insert(traces.map((t) => ({ tenant_id: tenant, conversation_id: convId, tool: t.tool, params: t.params, ok: t.ok, summary: t.summary })));
  return { conversation_id: convId, reply, attachments: mode === 'gerente' ? attachments : [] };
}

async function erpTest(tenant: string, actor: string) {
  const c = await connectorFor(tenant);
  if (!c) throw new HttpError(404, 'No hay ERP configurado');
  try {
    const r = await c.ping();
    await sb.from('erp_connections').update({ status: 'ok', last_checked_at: new Date().toISOString(), last_error: null }).eq('tenant_id', tenant);
    await audit(tenant, actor, 'erp_test', { ok: true });
    return { ok: true, detail: r.detail };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    await sb.from('erp_connections').update({ status: 'error', last_checked_at: new Date().toISOString(), last_error: msg.slice(0, 300) }).eq('tenant_id', tenant);
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
      const url = assertSafeUrl(String(body.url ?? '')).origin;
      for (const k of ['db', 'username', 'api_key']) if (typeof body[k] !== 'string' || !body[k].trim()) throw new HttpError(400, `Falta ${k}`);
      const secret_enc = await encryptSecret(body.api_key.trim(), env('ERP_ENC_KEY'), tenant);
      const { error } = await sb.from('erp_connections').upsert({ tenant_id: tenant, type: 'odoo', url, db: body.db.trim(), username: body.username.trim(), secret_enc, status: 'sin_probar', last_error: null });
      if (error) throw new HttpError(500, 'No se pudo guardar');
      await audit(tenant, user, 'erp_saved', { url });
      return erpTest(tenant, user);
    }
    case 'erp_test': { const { tenant, user } = await requireAdmin(req, body.tenant_id); return erpTest(tenant, user); }
    case 'knowledge_add': {
      const { tenant, user } = await requireAdmin(req, body.tenant_id);
      const kind = body.kind === 'url' ? 'url' : 'text';
      let content: string, title = String(body.title ?? '').slice(0, 200), url: string | null = null;
      if (kind === 'url') { url = assertSafeUrl(String(body.url ?? '')).toString(); title ||= url; }
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
  try {
    const out = await route(req, origin);
    return Response.json(out, { headers: cors(origin) });
  } catch (e) {
    if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status, headers: cors(origin) });
    console.error('unhandled', e instanceof Error ? e.message : e);
    return Response.json({ error: 'Error interno' }, { status: 500, headers: cors(origin) });
  }
});
