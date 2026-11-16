// HANDOFF API v1 — Edge Function (Deno). Autenticación: Authorization: Bearer hf_...
// Opera con service_role pero SIEMPRE acotada a la empresa de la clave (org_id de lookup_api_key).
import { createClient } from 'npm:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function sha256hex(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function pgError(e: { message?: string; details?: string }) {
  const m = e.message ?? 'error';
  const status = /forbidden/.test(m) ? 403 : /not_found/.test(m) ? 404 : 422;
  return json({ error: m, detail: e.details ?? null }, status);
}

const HANDOFF_COLS = 'id,status,site_id,area_id,shift_id,template_id,shift_date,from_user,to_user,submitted_at,snapshot_hash';
const ISSUE_COLS = 'id,site_id,area_id,title,description,category,priority,status,assignee,due_date,external_ref,created_by,origin_handoff_id,created_at,resolved_by,resolved_at,resolution_note';

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/^.*\/api-v1/, '').replace(/\/+$/, '');
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token.startsWith('hf_')) return json({ error: 'unauthorized' }, 401);
  const { data: keys } = await db.rpc('lookup_api_key', { p_hash: await sha256hex(token) });
  const key = keys?.[0];
  if (!key) return json({ error: 'unauthorized' }, 401);
  const org: string = key.org_id;
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 100);

  if (req.method === 'GET' && route === '/v1/handoffs') {
    let q = db.from('handoffs').select(HANDOFF_COLS).eq('org_id', org).neq('status', 'draft')
      .order('submitted_at', { ascending: false }).limit(limit);
    const st = url.searchParams.get('status');
    if (st) q = q.eq('status', st);
    const { data, error } = await q;
    return error ? pgError(error) : json({ data });
  }
  const one = route.match(/^\/v1\/handoffs\/([0-9a-f-]{36})$/);
  if (req.method === 'GET' && one) {
    const { data, error } = await db.from('handoffs').select(`${HANDOFF_COLS},snapshot,handoff_receipts(decision,notes,received_by,received_at)`)
      .eq('org_id', org).neq('status', 'draft').eq('id', one[1]).maybeSingle();
    if (error) return pgError(error);
    return data ? json({ data }) : json({ error: 'not_found' }, 404);
  }
  if (req.method === 'GET' && route === '/v1/issues') {
    let q = db.from('issues').select(ISSUE_COLS).eq('org_id', org).order('created_at', { ascending: false }).limit(limit);
    const st = url.searchParams.get('status');
    if (st) q = q.eq('status', st);
    const { data, error } = await q;
    return error ? pgError(error) : json({ data });
  }
  if (req.method === 'POST' && route === '/v1/issues') {
    const b = await req.json().catch(() => null);
    if (!b) return json({ error: 'invalid_json' }, 400);
    const { data, error } = await db.rpc('core_create_issue', {
      p_actor: key.actor, p_org: org, p_site: b.site_id, p_area: b.area_id, p_title: b.title,
      p_description: b.description ?? null, p_category: b.category ?? 'pendiente', p_priority: b.priority ?? 'medium',
      p_due: b.due_date ?? null, p_external_ref: b.external_ref ?? null, p_handoff: b.handoff_id ?? null,
      p_assignee: b.assignee ?? null, p_id: b.id ?? req.headers.get('idempotency-key') ?? null,
    });
    return error ? pgError(error) : json({ data }, 201);
  }
  if (req.method === 'POST' && route === '/v1/handoffs') {
    const b = await req.json().catch(() => null);
    if (!b) return json({ error: 'invalid_json' }, 400);
    const hid = b.id ?? req.headers.get('idempotency-key') ?? crypto.randomUUID();
    const saved = await db.rpc('core_save_draft', {
      p_actor: key.actor, p_id: hid, p_org: org, p_site: b.site_id, p_area: b.area_id, p_shift: b.shift_id,
      p_template: b.template_id, p_date: b.shift_date, p_to_user: b.to_user ?? null, p_responses: b.responses ?? null,
    });
    if (saved.error) return pgError(saved.error);
    if (b.submit) {
      const sent = await db.rpc('core_submit_handoff', { p_actor: key.actor, p_id: hid, p_to_user: b.to_user ?? null });
      return sent.error ? pgError(sent.error) : json({ data: sent.data }, 201);
    }
    return json({ data: saved.data }, 201);
  }
  return json({ error: 'not_found' }, 404);
});
