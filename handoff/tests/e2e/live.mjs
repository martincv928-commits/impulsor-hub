// Prueba de punta a punta contra el proyecto Supabase REAL (crea datos de prueba con correos hf.e2e.*).
// Uso: node tests/e2e/live.mjs   (en el sandbox: NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt)
// Requiere que la confirmación de correo esté apagada. Limpieza: supabase/e2e-cleanup.sql
import { createClient } from '@supabase/supabase-js';
const URL = process.env.SUPABASE_URL ?? 'https://hppzsirfbvvwgdlhhhvt.supabase.co';
const KEY = process.env.SUPABASE_ANON_KEY ?? 'sb_publishable_BcZnI2fMmbxHWvtGzvyMRg_oNyJHrYy';
const stamp = Date.now();
let fails = 0;
const ok = (n, v, extra = '') => { if (!v) fails++; console.log(v ? '✓' : '✗ FALLO', n, extra); };
const R = async (p) => { const { data, error } = await p; if (error) throw new Error(error.message + (error.details ? ' · ' + error.details : '')); return data; };
const E = async (p) => (await p).error?.message ?? '';
async function user(tag) {
  const c = createClient(URL, KEY, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signUp({ email: `hf.e2e.${stamp}.${tag}@example.com`, password: 'Prueba-12345' });
  if (error) throw new Error(`signUp ${tag}: ${error.message}`);
  if (!data.session) throw new Error(`signUp ${tag}: sin sesión (confirmación de correo activa)`);
  return { c, id: data.user.id };
}
try {
  const A = await user('a'), B = await user('b'), X = await user('x');
  ok('registro de 3 cuentas con sesión inmediata', true);
  const org = await R(A.c.rpc('create_organization', { p_name: 'E2E Empresa', p_display_name: 'Admin E2E' }));
  const site = (await R(A.c.from('sites').insert({ org_id: org, name: 'Planta' }).select()))[0];
  const area = (await R(A.c.from('areas').insert({ org_id: org, site_id: site.id, name: 'Almacén' }).select()))[0];
  const shift = (await R(A.c.from('shift_definitions').insert({ org_id: org, name: 'Matutino' }).select()))[0];
  const tpls = await R(A.c.from('templates').select('id,name').eq('org_id', org));
  ok('4 plantillas iniciales', tpls.length === 4, tpls.map((t) => t.name).join(','));
  const tpl = tpls.find((t) => t.name === 'ALMACÉN');
  const fields = await R(A.c.from('template_fields').select('id,label,type').eq('template_id', tpl.id));
  const f = (l) => fields.find((x) => x.label === l).id;
  const code = await R(A.c.rpc('create_invite', { p_org: org, p_role: 'worker' }));
  await R(B.c.rpc('join_organization', { p_code: code, p_display_name: 'Receptor E2E' }));
  ok('invitación de un solo uso', /invalid_invite/.test(await E(X.c.rpc('join_organization', { p_code: code, p_display_name: 'Intruso' }))));
  const hid = crypto.randomUUID();
  const resp = { [f('Estado general del área')]: 'Ordenada', [f('¿Equipos funcionando?')]: false };
  await R(A.c.rpc('save_handoff_draft', { p_id: hid, p_org: org, p_site: site.id, p_area: area.id, p_shift: shift.id, p_template: tpl.id, p_date: '2026-11-17', p_to_user: B.id, p_responses: resp }));
  // foto real al bucket privado
  const aid = crypto.randomUUID(); const path = `${org}/handoff/${aid}.jpg`;
  const jpg = new Blob([new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 255, 217])], { type: 'image/jpeg' });
  ok('subida de foto a bucket privado', !(await A.c.storage.from('evidence').upload(path, jpg, { contentType: 'image/jpeg' })).error);
  await R(A.c.rpc('register_attachment', { p_id: aid, p_org: org, p_path: path, p_entity_type: 'handoff', p_entity_id: hid, p_mime: 'image/jpeg', p_size: 14 }));
  const iss = await R(A.c.rpc('create_issue', { p_org: org, p_site: site.id, p_area: area.id, p_title: 'Montacargas averiado', p_priority: 'critical', p_handoff: hid }));
  const sent = await R(A.c.rpc('submit_handoff', { p_id: hid }));
  ok('entrega enviada con huella', sent.status === 'pending_receipt' && sent.snapshot_hash?.length === 64);
  ok('reintento de envío idempotente', (await R(A.c.rpc('submit_handoff', { p_id: hid }))).submitted_at === sent.submitted_at);
  ok('otra empresa no ve la entrega', (await R(X.c.from('handoffs').select('id').eq('id', hid))).length === 0);
  ok('otra empresa no puede recibir', /not_found/.test(await E(X.c.rpc('receive_handoff', { p_id: hid, p_decision: 'accepted' }))));
  ok('rechazo sin justificación falla', /justification_required/.test(await E(B.c.rpc('receive_handoff', { p_id: hid, p_decision: 'rejected' }))));
  const r1 = await R(B.c.rpc('receive_handoff', { p_id: hid, p_decision: 'accepted_with_observations', p_notes: 'Revisar montacargas' }));
  const r2 = await R(B.c.rpc('receive_handoff', { p_id: hid, p_decision: 'accepted' }));
  ok('recepción con observaciones; doble envío no duplica', r1.id === r2.id && r2.decision === 'accepted_with_observations');
  ok('recibir no asigna responsable', (await R(B.c.from('issues').select('assignee').eq('id', iss.id)))[0].assignee === null);
  await R(B.c.rpc('accept_issue_responsibility', { p_issue: iss.id }));
  const res = await R(B.c.rpc('set_issue_status', { p_issue: iss.id, p_status: 'resolved', p_note: 'Reparado' }));
  ok('resolución registra actor y hora', res.resolved_by === B.id && !!res.resolved_at);
  const ev = await R(A.c.from('issue_events').select('action').eq('issue_id', iss.id).order('created_at'));
  ok('cadena de responsabilidad', ev.map((e) => e.action).join('>') === 'created>received>responsibility_accepted>resolved', ev.map((e) => e.action).join('>'));
  ok('trabajador no ve el resumen de supervisor', /forbidden/.test(await E(B.c.rpc('supervisor_summary', { p_org: org }))));
  const sum = await R(A.c.rpc('supervisor_summary', { p_org: org, p_from: '2026-11-01', p_to: '2026-11-30' }));
  ok('resumen del supervisor', sum.handoffs.accepted_obs === 1 && sum.issues.critical === 0);
  ok('funciones internas no accesibles', /permission denied|not exist|Could not find/.test(await E(A.c.rpc('core_submit_handoff', { p_actor: A.id, p_id: hid }))));
  ok('otra empresa no sube a mi ruta', !!(await X.c.storage.from('evidence').upload(`${org}/x/${crypto.randomUUID()}.jpg`, new Blob([new Uint8Array([1])]))).error);
  const sgX = await X.c.storage.from('evidence').createSignedUrl(path, 60);
  ok('otra empresa no obtiene URL firmada', !!sgX.error || !sgX.data?.signedUrl);
  const own = await B.c.storage.from('evidence').createSignedUrl(path, 60);
  ok('el receptor sí ve la foto (URL firmada)', !!own.data?.signedUrl && (await fetch(own.data.signedUrl)).ok);
  ok('la URL pública NO sirve el archivo', (await fetch(`${URL}/storage/v1/object/public/evidence/${path}`)).status >= 400);
  // ── Equipo de UNA sola persona: puede recibir su propia entrega; al sumarse otra persona, ya no
  const S = await user('solo');
  const oS = await R(S.c.rpc('create_organization', { p_name: 'E2E Solo', p_display_name: 'Dueño solo' }));
  const sS = (await R(S.c.from('sites').insert({ org_id: oS, name: 'Local' }).select()))[0];
  const aS = (await R(S.c.from('areas').insert({ org_id: oS, site_id: sS.id, name: 'Caja' }).select()))[0];
  const hS = (await R(S.c.from('shift_definitions').insert({ org_id: oS, name: 'Día' }).select()))[0];
  const tS = (await R(S.c.from('templates').select('id').eq('org_id', oS).eq('name', 'SEGURIDAD')))[0];
  const fS = (await R(S.c.from('template_fields').select('id').eq('template_id', tS.id).eq('label', 'Novedades del turno')))[0];
  const mkS = async () => { const id = crypto.randomUUID(); await R(S.c.rpc('save_handoff_draft', { p_id: id, p_org: oS, p_site: sS.id, p_area: aS.id, p_shift: hS.id, p_template: tS.id, p_date: '2026-11-17', p_responses: { [fS.id]: 'Sin novedades' } })); await R(S.c.rpc('submit_handoff', { p_id: id })); return id; };
  const rS = await R(S.c.rpc('receive_handoff', { p_id: await mkS(), p_decision: 'accepted' }));
  ok('una sola persona recibe su propia entrega (marcada)', rS.acknowledged?.self_receipt === true);
  const codeS = await R(S.c.rpc('create_invite', { p_org: oS, p_role: 'worker' }));
  const W = await user('solo2'); await R(W.c.rpc('join_organization', { p_code: codeS, p_display_name: 'Empleada' }));
  ok('con 2 personas ya no puede recibir la propia', /forbidden_self/.test(await E(S.c.rpc('receive_handoff', { p_id: await mkS(), p_decision: 'accepted' }))));
  console.log('ORG', org);
} catch (e) { fails++; console.log('ERROR:', e.message); }
console.log(fails ? `\n${fails} FALLO(S)` : '\nTODO OK');
process.exit(fails ? 1 : 0);
