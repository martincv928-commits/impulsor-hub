// Despacha la cola webhook_deliveries. Debe invocarse periódicamente (pg_cron/pg_net o scheduler externo)
// con la cabecera x-dispatch-secret. Firma: X-Handoff-Signature: t=<unix>,v1=HMAC_SHA256(secret, `${t}.${body}`)
import { createClient } from 'npm:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

async function hmacHex(secret: string, msg: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  const expected = Deno.env.get('DISPATCH_SECRET');
  if (!expected || req.headers.get('x-dispatch-secret') !== expected) return new Response('unauthorized', { status: 401 });
  const { data, error } = await db.rpc('claim_webhook_deliveries', { p_limit: 20 });
  if (error) return new Response(error.message, { status: 500 });
  let ok = 0, failed = 0;
  for (const d of data ?? []) {
    const body = JSON.stringify(d.payload);
    const t = Math.floor(Date.now() / 1000);
    try {
      const res = await fetch(d.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-handoff-event': d.event_type,
          'x-handoff-delivery': d.event_key,
          'x-handoff-signature': `t=${t},v1=${await hmacHex(d.secret, `${t}.${body}`)}`,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      await db.rpc('finish_webhook_delivery', { p_id: d.id, p_ok: res.ok, p_code: res.status, p_error: res.ok ? null : `HTTP ${res.status}` });
      res.ok ? ok++ : failed++;
    } catch (e) {
      await db.rpc('finish_webhook_delivery', { p_id: d.id, p_ok: false, p_code: null, p_error: String(e) });
      failed++;
    }
  }
  return new Response(JSON.stringify({ ok, failed }), { headers: { 'content-type': 'application/json' } });
});
