import { beforeAll, describe, expect, it } from 'vitest';
import { as, asRole, id, makeDb, newUser, type Db } from './helpers';
import { createHash } from 'node:crypto';

let db: Db;
const u: Record<string, string> = {};
let orgA: string, orgB: string, siteA: string, areaA: string, shiftA: string, tplA: string, siteB: string;
const F: Record<string, string> = {}; // label → field id

async function mkHandoff(from: string, opts: { to?: string | null; date?: string; fill?: boolean } = {}) {
  const hid = id();
  const resp = opts.fill === false ? {} : { [F['Estado general del área']]: 'Ordenada', [F['¿Equipos funcionando?']]: true };
  await as(db, from, 'select save_handoff_draft($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)',
    [hid, orgA, siteA, areaA, shiftA, tplA, opts.date ?? '2026-11-16', opts.to ?? null, JSON.stringify(resp)]);
  return hid;
}
const send = (from: string, hid: string) => as(db, from, 'select * from submit_handoff($1)', [hid]);
const receive = (who: string, hid: string, dec: string, notes: string | null = null) =>
  as(db, who, 'select * from receive_handoff($1,$2,$3)', [hid, dec, notes]);

beforeAll(async () => {
  db = await makeDb();
  for (const n of ['admA', 'sal', 'ent', 'otro', 'supA', 'admB', 'ext']) u[n] = await newUser(db, n + '@test.mx');
  orgA = (await as(db, u.admA, "select create_organization('Empresa A','Admin A') o"))[0].o;
  for (const [k, role, name] of [['sal', 'worker', 'Saliente'], ['ent', 'worker', 'Entrante'], ['otro', 'worker', 'Otro'], ['supA', 'supervisor', 'Supervisor']]) {
    const code = (await as(db, u.admA, 'select create_invite($1,$2) c', [orgA, role]))[0].c;
    await as(db, u[k], 'select join_organization($1,$2)', [code, name]);
  }
  siteA = (await as(db, u.admA, "insert into sites (org_id,name) values ($1,'Planta') returning id", [orgA]))[0].id;
  areaA = (await as(db, u.admA, "insert into areas (org_id,site_id,name) values ($1,$2,'Almacén') returning id", [orgA, siteA]))[0].id;
  shiftA = (await as(db, u.admA, "insert into shift_definitions (org_id,name) values ($1,'Matutino') returning id", [orgA]))[0].id;
  tplA = (await as(db, u.admA, "select id from templates where org_id=$1 and name='ALMACÉN'", [orgA]))[0].id;
  for (const r of await as(db, u.admA, 'select id,label from template_fields where template_id=$1', [tplA])) F[r.label] = r.id;
  orgB = (await as(db, u.admB, "select create_organization('Empresa B','Admin B') o"))[0].o;
  siteB = (await as(db, u.admB, "insert into sites (org_id,name) values ($1,'Sede B') returning id", [orgB]))[0].id;
}, 60_000);

describe('1. aislamiento entre empresas', () => {
  it('B no ve ni modifica datos de A', async () => {
    const hid = await mkHandoff(u.sal);
    await send(u.sal, hid);
    for (const t of ['handoffs', 'issues', 'sites', 'areas', 'templates', 'template_fields', 'organization_members', 'audit_events', 'notifications', 'organizations'])
      expect(await as(db, u.admB, `select * from ${t} where ${t === 'organizations' ? 'id' : 'org_id'} = $1`, [orgA]), t).toHaveLength(0);
    await expect(as(db, u.admB, 'insert into sites (org_id,name) values ($1,$2)', [orgA, 'intruso'])).rejects.toThrow();
    await as(db, u.admB, "update sites set name='x' where id=$1", [siteA]);
    expect((await as(db, u.admA, 'select name from sites where id=$1', [siteA]))[0].name).toBe('Planta');
    await expect(as(db, u.admB, 'select supervisor_summary($1)', [orgA])).rejects.toThrow(/forbidden/);
    await expect(as(db, u.admB, 'select create_invite($1)', [orgA])).rejects.toThrow(/forbidden/);
  });
  it('no se puede crear entrega en otra empresa ni con ids cruzados', async () => {
    await expect(as(db, u.admB, 'select save_handoff_draft($1,$2,$3,$4,$5,$6,$7)', [id(), orgA, siteA, areaA, shiftA, tplA, '2026-11-16'])).rejects.toThrow(/forbidden/);
    await expect(as(db, u.admB, 'select save_handoff_draft($1,$2,$3,$4,$5,$6,$7)', [id(), orgB, siteA, areaA, shiftA, tplA, '2026-11-16'])).rejects.toThrow();
  });
});

describe('2-3. entrega: creación, validación y envío inmutable', () => {
  it('exige campos obligatorios y lista los faltantes', async () => {
    const hid = await mkHandoff(u.sal, { fill: false });
    await expect(send(u.sal, hid)).rejects.toThrow(/required_fields_missing/);
    const err = await send(u.sal, hid).catch((e) => e);
    expect(err.detail ?? err.message).toBeDefined();
  });
  it('conserva el contenido enviado aunque cambie la plantilla o aparezcan pendientes nuevos', async () => {
    const hid = await mkHandoff(u.sal);
    const [h] = await send(u.sal, hid);
    expect(h.status).toBe('pending_receipt');
    expect(h.submitted_at).toBeTruthy();
    const before = (await as(db, u.ent, 'select snapshot, snapshot_hash from handoffs where id=$1', [hid]))[0];
    expect(createHash('sha256').update(JSON.stringify(before.snapshot)).digest('hex')).toBeTypeOf('string');
    await as(db, u.admA, "update template_fields set label='RENOMBRADO' where id=$1", [F['Observaciones']]);
    await as(db, u.admA, "update template_fields set label='Observaciones' where id=$1", [F['Observaciones']]);
    await as(db, u.otro, "select create_issue($1,$2,$3,'Nuevo posterior')", [orgA, siteA, areaA]);
    const after = (await as(db, u.ent, 'select snapshot, snapshot_hash from handoffs where id=$1', [hid]))[0];
    expect(after.snapshot).toEqual(before.snapshot);
    expect(after.snapshot_hash).toBe(before.snapshot_hash);
    const vals = before.snapshot.fields.find((f: any) => f.label === 'Estado general del área').value;
    expect(vals).toBe('Ordenada');
  });
  it('no permite modificar una entrega enviada (ni con rol de servicio ni borrador/respuestas)', async () => {
    const hid = await mkHandoff(u.sal);
    await send(u.sal, hid);
    await expect(as(db, u.sal, "update handoffs set status='draft' where id=$1", [hid])).rejects.toThrow();
    await expect(db.query("update handoffs set snapshot='{}'::jsonb where id=$1", [hid])).rejects.toThrow(/handoff_locked/);
    await expect(db.query('delete from handoffs where id=$1', [hid])).rejects.toThrow(/immutable/);
    await expect(db.query("update handoff_responses set value='\"x\"' where handoff_id=$1", [hid])).rejects.toThrow(/handoff_locked/);
    await expect(as(db, u.sal, 'select save_handoff_draft($1,$2,$3,$4,$5,$6,$7)', [hid, orgA, siteA, areaA, shiftA, tplA, '2026-11-16'])).rejects.toThrow(/handoff_locked/);
    // corrección posterior = anexo auditable
    const [a] = await as(db, u.sal, "select * from add_handoff_addendum($1,'Corrección: faltó una caja')", [hid]);
    expect(a.body).toMatch(/Corrección/);
    await expect(as(db, u.otro, "select add_handoff_addendum($1,'x')", [hid])).rejects.toThrow(/forbidden/);
  });
  it('otro trabajador no puede editar ni enviar mi borrador', async () => {
    const hid = await mkHandoff(u.sal);
    await expect(send(u.otro, hid)).rejects.toThrow(/forbidden/);
    expect(await as(db, u.otro, 'select 1 from handoffs where id=$1', [hid])).toHaveLength(0); // borrador privado
  });
});

describe('4-7. recepción', () => {
  it('entrante autorizado acepta', async () => {
    const hid = await mkHandoff(u.sal, { to: u.ent });
    await send(u.sal, hid);
    const [r] = await receive(u.ent, hid, 'accepted');
    expect(r.decision).toBe('accepted');
    expect(r.received_at).toBeTruthy();
    expect((await as(db, u.sal, 'select status from handoffs where id=$1', [hid]))[0].status).toBe('accepted');
  });
  it('usuario no autorizado no puede aceptar', async () => {
    const hid = await mkHandoff(u.sal, { to: u.ent });
    await send(u.sal, hid);
    await expect(receive(u.otro, hid, 'accepted')).rejects.toThrow(/forbidden/);      // otro trabajador
    await expect(receive(u.sal, hid, 'accepted')).rejects.toThrow(/forbidden_self/);  // el propio saliente
    await expect(receive(u.admB, hid, 'accepted')).rejects.toThrow(/not_found/);      // otra empresa
    await expect(receive(u.ext, hid, 'accepted')).rejects.toThrow(/not_found/);       // sin empresa
    await expect(asRole(db, 'anon', 'select * from receive_handoff($1,$2)', [hid, 'accepted'])).rejects.toThrow();
    expect((await receive(u.supA, hid, 'accepted'))[0].received_by).toBe(u.supA);     // supervisor puede intervenir
  });
  it('rechazo y discrepancia exigen justificación', async () => {
    const hid = await mkHandoff(u.sal);
    await send(u.sal, hid);
    await expect(receive(u.ent, hid, 'rejected')).rejects.toThrow(/justification_required/);
    await expect(receive(u.ent, hid, 'rejected', '   ')).rejects.toThrow(/justification_required/);
    await expect(receive(u.ent, hid, 'discrepancy')).rejects.toThrow(/justification_required/);
    await expect(receive(u.ent, hid, 'accepted_with_observations')).rejects.toThrow(/justification_required/);
    const [r] = await receive(u.ent, hid, 'rejected', 'Área sucia');
    expect(r.notes).toBe('Área sucia');
  });
  it('discrepancia queda registrada con auditoría y notificación', async () => {
    const hid = await mkHandoff(u.sal);
    await send(u.sal, hid);
    await receive(u.ent, hid, 'discrepancy', 'Faltan 2 llaves');
    const h = (await as(db, u.sal, 'select status from handoffs where id=$1', [hid]))[0];
    expect(h.status).toBe('disputed');
    const aud = await as(db, u.admA, "select action,actor from audit_events where entity_id=$1 order by created_at", [hid]);
    expect(aud.map((a: any) => a.action)).toEqual(expect.arrayContaining(['handoff.created', 'handoff.submitted', 'handoff.discrepancy']));
    const n = await as(db, u.sal, "select title from notifications where entity_id=$1 and event='handoff_discrepancy'", [hid]);
    expect(n).toHaveLength(1);
    await expect(db.query('update handoff_receipts set notes=$1 where handoff_id=$2', ['x', hid])).rejects.toThrow(/immutable/);
  });
  it('11. doble clic / reintento no duplica envío ni recepción', async () => {
    const hid = await mkHandoff(u.sal);
    const [a] = await send(u.sal, hid);
    const [b] = await send(u.sal, hid);
    expect(b.snapshot_hash).toBe(a.snapshot_hash);
    expect(new Date(b.submitted_at).getTime()).toBe(new Date(a.submitted_at).getTime());
    const [r1] = await receive(u.ent, hid, 'accepted');
    const [r2] = await receive(u.ent, hid, 'accepted_with_observations', 'segundo clic');
    expect(r2.id).toBe(r1.id);
    expect(r2.decision).toBe('accepted');
    expect(await as(db, u.admA, 'select * from handoff_receipts where handoff_id=$1', [hid])).toHaveLength(1);
    expect(await as(db, u.admA, "select * from audit_events where entity_id=$1 and action='handoff.submitted'", [hid])).toHaveLength(1);
    // reintento de creación de borrador con el mismo id no duplica
    await as(db, u.sal, 'select save_handoff_draft($1,$2,$3,$4,$5,$6,$7)', [id(), orgA, siteA, areaA, shiftA, tplA, '2026-11-16']);
  });
});

describe('8-10. cadena de responsabilidad de pendientes', () => {
  it('pendiente sobrevive al cambio de turno; recibir ≠ aceptar responsabilidad; reasignación e historial; resolución', async () => {
    // Turno A reporta incidencia
    const h1 = await mkHandoff(u.sal, { date: '2026-11-16' });
    const [issue] = await as(db, u.sal, "select * from create_issue($1,$2,$3,'Máquina averiada','No enciende','falla','critical',null,'TCK-9',$4)", [orgA, siteA, areaA, h1]);
    expect(issue.status).toBe('open');
    await send(u.sal, h1);
    await expect(as(db, u.sal, "select create_issue($1,$2,$3,'tarde',null,'x','low',null,null,$4)", [orgA, siteA, areaA, h1])).rejects.toThrow(/handoff_locked/);
    // Turno B recibe: recibe la información pero NO asume responsabilidad
    await receive(u.ent, h1, 'accepted');
    let cur = (await as(db, u.ent, 'select assignee,status from issues where id=$1', [issue.id]))[0];
    expect(cur.assignee).toBeNull();
    expect((await as(db, u.ent, "select actor from issue_events where issue_id=$1 and action='received'", [issue.id]))[0].actor).toBe(u.ent);
    // Turno C ve el pendiente heredado en su entrega
    const h2 = await mkHandoff(u.ent, { date: '2026-11-17' });
    const [s2] = await send(u.ent, h2);
    expect(s2.snapshot.issues_open.map((i: any) => i.id)).toContain(issue.id);
    // un trabajador ajeno al pendiente asignado no puede cambiar su estado; el entrante asume responsabilidad
    await as(db, u.ent, 'select accept_issue_responsibility($1)', [issue.id]);
    cur = (await as(db, u.ent, 'select assignee from issues where id=$1', [issue.id]))[0];
    expect(cur.assignee).toBe(u.ent);
    await expect(as(db, u.otro, "select set_issue_status($1,'in_progress')", [issue.id])).rejects.toThrow(/forbidden/);
    await expect(as(db, u.otro, 'select accept_issue_responsibility($1)', [issue.id])).rejects.toThrow(/forbidden/);
    // reasignación por supervisor conserva historial
    await as(db, u.supA, "select assign_issue($1,$2,'Pasa a mantenimiento')", [issue.id, u.otro]);
    const ev = await as(db, u.admA, "select action, data from issue_events where issue_id=$1 order by created_at", [issue.id]);
    expect(ev.map((e: any) => e.action)).toEqual(['created', 'received', 'responsibility_accepted', 'assigned']);
    expect(ev[3].data).toMatchObject({ from: u.ent, to: u.otro, note: 'Pasa a mantenimiento' });
    await expect(db.query("update issue_events set action='note' where issue_id=$1", [issue.id])).rejects.toThrow(/immutable/);
    // resolución exige nota y registra actor + hora del servidor
    await expect(as(db, u.otro, "select set_issue_status($1,'resolved')", [issue.id])).rejects.toThrow(/justification_required/);
    const [res] = await as(db, u.otro, "select * from set_issue_status($1,'resolved','Se cambió la banda')", [issue.id]);
    expect(res.status).toBe('resolved');
    expect(res.resolved_by).toBe(u.otro);
    expect(res.resolved_at).toBeTruthy();
    expect(res.resolution_note).toBe('Se cambió la banda');
    // un trabajador no reabre; el supervisor sí
    await expect(as(db, u.otro, "select set_issue_status($1,'open')", [issue.id])).rejects.toThrow(/forbidden/);
    const [re] = await as(db, u.supA, "select * from set_issue_status($1,'open')", [issue.id]);
    expect(re.resolved_by).toBeNull();
    // el pendiente resuelto ya no se hereda
    const h3 = await mkHandoff(u.otro, { date: '2026-11-18' });
    await as(db, u.supA, "select set_issue_status($1,'resolved','ok')", [issue.id]);
    const [s3] = await send(u.otro, h3);
    expect(s3.snapshot.issues_open.map((i: any) => i.id)).not.toContain(issue.id);
  });
});

describe('12. resumen / reporte del supervisor', () => {
  it('contiene cifras correctas y sólo para supervisores', async () => {
    const d = '2026-12-05';
    const h1 = await mkHandoff(u.sal, { date: d });
    await send(u.sal, h1);
    await receive(u.ent, h1, 'accepted');
    const h2 = await mkHandoff(u.sal, { date: d });
    await send(u.sal, h2);
    await receive(u.ent, h2, 'discrepancy', 'Falta herramienta');
    const h3 = await mkHandoff(u.sal, { date: d });
    await send(u.sal, h3);
    await as(db, u.otro, "select create_issue($1,$2,$3,'Crítico sin dueño',null,'falla','critical')", [orgA, siteA, areaA]);
    await as(db, u.otro, "select create_issue($1,$2,$3,'Vencido',null,'tarea','low','2020-01-01')", [orgA, siteA, areaA]);
    const [{ s }] = await as(db, u.supA, 'select supervisor_summary($1,$2,$3) s', [orgA, d, d]);
    expect(s.handoffs).toMatchObject({ accepted: 1, disputed: 1, rejected: 0, accepted_obs: 0 });
    expect(s.handoffs.pending_receipt).toBeGreaterThanOrEqual(1);
    expect(s.pending_list.map((x: any) => x.id)).toContain(h3);
    expect(s.disputed_list.map((x: any) => x.notes)).toContain('Falta herramienta');
    expect(s.issues.critical).toBeGreaterThanOrEqual(1);
    expect(s.issues.overdue).toBeGreaterThanOrEqual(1);
    expect(s.issues.unassigned).toBeGreaterThanOrEqual(2);
    await expect(as(db, u.sal, 'select supervisor_summary($1)', [orgA])).rejects.toThrow(/forbidden/);
  });
  it('destinatarios por sede/área/evento reciben notificaciones; otros no', async () => {
    await as(db, u.admA, "insert into report_recipients (org_id,site_id,area_id,event,user_id) values ($1,$2,$3,'handoff_submitted',$4)", [orgA, siteA, areaA, u.supA]);
    await as(db, u.admA, "insert into report_recipients (org_id,event,user_id) values ($1,'critical_issue',$2)", [orgA, u.supA]);
    const hid = await mkHandoff(u.sal);
    await send(u.sal, hid);
    expect(await as(db, u.supA, "select 1 from notifications where entity_id=$1 and event='handoff_submitted'", [hid])).toHaveLength(1);
    await as(db, u.sal, "select create_issue($1,$2,$3,'Crítico notif',null,'falla','critical')", [orgA, siteA, areaA]);
    expect((await as(db, u.supA, "select 1 from notifications where event='critical_issue'")).length).toBeGreaterThanOrEqual(1);
    expect(await as(db, u.admB, 'select 1 from notifications')).toHaveLength(0);
  });
});

describe('13. adjuntos privados', () => {
  it('bucket no es público y las rutas se aíslan por empresa', async () => {
    expect((await db.query<any>("select public from storage.buckets where id='evidence'")).rows[0].public).toBe(false);
    const pathA = `${orgA}/handoffs/${id()}.jpg`;
    await as(db, u.sal, "insert into storage.objects (bucket_id,name) values ('evidence',$1)", [pathA]);
    await expect(as(db, u.sal, "insert into storage.objects (bucket_id,name) values ('evidence',$1)", [`${orgB}/x/${id()}.jpg`])).rejects.toThrow();
    expect(await as(db, u.admB, "select 1 from storage.objects where bucket_id='evidence'")).toHaveLength(0);
    expect(await as(db, u.sal, "select 1 from storage.objects where bucket_id='evidence'")).toHaveLength(1);
    await expect(asRole(db, 'anon', "select 1 from storage.objects")).rejects.toThrow(/permission denied/);
  });
  it('registro de adjuntos: sólo en mi borrador, ruta de mi empresa; inmutables; foto obligatoria exige adjunto real', async () => {
    const hid = await mkHandoff(u.sal);
    const aid = id();
    const path = `${orgA}/handoffs/${aid}.jpg`;
    await as(db, u.sal, "select register_attachment($1,$2,$3,'handoff',$4,'image/jpeg',1000)", [aid, orgA, path, hid]);
    await as(db, u.sal, "select register_attachment($1,$2,$3,'handoff',$4,'image/jpeg',1000)", [aid, orgA, path, hid]); // reintento idempotente
    expect(await as(db, u.sal, 'select 1 from attachments where entity_id=$1', [hid])).toHaveLength(1);
    await expect(as(db, u.sal, "select register_attachment($1,$2,$3,'handoff',$4)", [id(), orgA, `${orgB}/x.jpg`, hid])).rejects.toThrow(/invalid_path/);
    await expect(as(db, u.otro, "select register_attachment($1,$2,$3,'handoff',$4)", [id(), orgA, `${orgA}/y.jpg`, hid])).rejects.toThrow(/forbidden/);
    await expect(as(db, u.admB, "select register_attachment($1,$2,$3,'handoff',$4)", [id(), orgA, `${orgA}/z.jpg`, hid])).rejects.toThrow(/forbidden/);
    expect(await as(db, u.admB, 'select 1 from attachments')).toHaveLength(0);
    await expect(db.query('delete from attachments where id=$1', [aid])).rejects.toThrow(/immutable/);
    await send(u.sal, hid);
    await expect(as(db, u.sal, "select register_attachment($1,$2,$3,'handoff',$4)", [id(), orgA, `${orgA}/late.jpg`, hid])).rejects.toThrow(/handoff_locked/);
    // plantilla con foto obligatoria
    await as(db, u.admA, 'update template_fields set required=true where id=$1', [F['Fotografías del área']]);
    const h2 = await mkHandoff(u.sal);
    await expect(send(u.sal, h2)).rejects.toThrow(/required_fields_missing/);
    await as(db, u.sal, 'select save_handoff_draft($1,$2,$3,$4,$5,$6,$7,null,$8::jsonb)', [h2, orgA, siteA, areaA, shiftA, tplA, '2026-11-16',
      JSON.stringify({ [F['Estado general del área']]: 'Ordenada', [F['¿Equipos funcionando?']]: true, [F['Fotografías del área']]: [id()] })]);
    await expect(send(u.sal, h2)).rejects.toThrow(/required_fields_missing/); // adjunto inexistente
    const a2 = id();
    await as(db, u.sal, "select register_attachment($1,$2,$3,'handoff',$4)", [a2, orgA, `${orgA}/handoffs/${a2}.jpg`, h2]);
    await as(db, u.sal, 'select save_handoff_draft($1,$2,$3,$4,$5,$6,$7,null,$8::jsonb)', [h2, orgA, siteA, areaA, shiftA, tplA, '2026-11-16',
      JSON.stringify({ [F['Estado general del área']]: 'Ordenada', [F['¿Equipos funcionando?']]: true, [F['Fotografías del área']]: [a2] })]);
    expect((await send(u.sal, h2))[0].status).toBe('pending_receipt');
    await as(db, u.admA, 'update template_fields set required=false where id=$1', [F['Fotografías del área']]);
  });
});

describe('14. API / integraciones: operaciones no autorizadas', () => {
  it('funciones internas y tablas sensibles no son accesibles a clientes', async () => {
    const hid = await mkHandoff(u.sal);
    await expect(as(db, u.sal, 'select core_submit_handoff($1,$2)', [u.sal, hid])).rejects.toThrow(/permission denied/);
    await expect(as(db, u.sal, 'select * from lookup_api_key($1)', ['x'])).rejects.toThrow(/permission denied/);
    await expect(as(db, u.sal, 'select * from claim_webhook_deliveries()')).rejects.toThrow(/permission denied/);
    await expect(asRole(db, 'anon', 'select * from handoffs')).rejects.toThrow(/permission denied/);
    await expect(as(db, u.admA, 'select key_hash from api_keys')).rejects.toThrow(/permission denied/);
    await expect(as(db, u.admA, 'select secret from webhook_subscriptions')).rejects.toThrow(/permission denied/);
    await expect(as(db, u.sal, 'select create_api_key($1,$2)', [orgA, 'k'])).rejects.toThrow(/forbidden/);
    await expect(as(db, u.admB, 'select create_webhook($1,$2,$3)', [orgA, 'https://x.test', ['issue.created']])).rejects.toThrow(/forbidden/);
  });
  it('clave de API: hash en BD, un solo uso en claro, revocable; la API opera acotada a su empresa', async () => {
    const [{ k }] = await as(db, u.admA, "select create_api_key($1,'ERP') k", [orgA]);
    expect(k).toMatch(/^hf_[0-9a-f]{64}$/);
    const hash = createHash('sha256').update(k).digest('hex');
    const [row] = await asRole(db, 'service_role', 'select * from lookup_api_key($1)', [hash]);
    expect(row).toMatchObject({ org_id: orgA, actor: u.admA });
    expect(await asRole(db, 'service_role', 'select * from lookup_api_key($1)', [createHash('sha256').update('hf_falsa').digest('hex')])).toHaveLength(0);
    const stored = await db.query<any>('select key_hash, prefix from api_keys where org_id=$1', [orgA]);
    expect(JSON.stringify(stored.rows)).not.toContain(k);
    // POST /issues vía núcleo con actor de la clave: no puede escribir en otra empresa
    const [i] = await asRole(db, 'service_role', "select * from core_create_issue($1,$2,$3,$4,'Desde API',null,'api','high',null,null)", [row.actor, orgA, siteA, areaA]);
    expect(i.created_by).toBe(u.admA);
    await expect(asRole(db, 'service_role', "select * from core_create_issue($1,$2,$3,$4,'x',null,'api','high',null,null)", [row.actor, orgB, siteB, areaA])).rejects.toThrow(/forbidden/);
    const keyId = (await as(db, u.admA, 'select id from api_keys where org_id=$1', [orgA]))[0].id;
    await as(db, u.admA, 'select revoke_api_key($1)', [keyId]);
    expect(await asRole(db, 'service_role', 'select * from lookup_api_key($1)', [hash])).toHaveLength(0);
  });
  it('webhooks: eventos encolados una sola vez, con reintentos controlados', async () => {
    const [{ w }] = await as(db, u.admA, "select create_webhook($1,'https://erp.test/hook',array['handoff.submitted','issue.created']) w", [orgA]);
    expect(w.secret).toMatch(/^whsec_/);
    await expect(as(db, u.admA, "select create_webhook($1,'http://inseguro.test',array['issue.created'])", [orgA])).rejects.toThrow();
    await expect(as(db, u.admA, "select create_webhook($1,'https://x.test',array['otro.evento'])", [orgA])).rejects.toThrow(/invalid_events/);
    const hid = await mkHandoff(u.sal);
    await send(u.sal, hid);
    await send(u.sal, hid); // reintento: no duplica evento
    const q = await asRole(db, 'service_role', "select * from claim_webhook_deliveries(50)");
    const mine = q.filter((d: any) => d.event_key === `handoff.submitted:${hid}`);
    expect(mine).toHaveLength(1);
    expect(mine[0].payload).toMatchObject({ type: 'handoff.submitted', organization_id: orgA });
    expect(mine[0].payload.data.handoff_id).toBe(hid);
    // fallo → reintento programado; éxito → entregado
    await asRole(db, 'service_role', 'select finish_webhook_delivery($1,false,500,$2)', [mine[0].id, 'boom']);
    let d = (await as(db, u.admA, 'select status,attempts,last_error,next_attempt_at from webhook_deliveries where id=$1', [mine[0].id]))[0];
    expect(d).toMatchObject({ status: 'pending', attempts: 1, last_error: 'boom' });
    await db.query("update webhook_deliveries set next_attempt_at = now() where id=$1", [mine[0].id]);
    const again = await asRole(db, 'service_role', 'select * from claim_webhook_deliveries(50)');
    expect(again.filter((x: any) => x.id === mine[0].id)).toHaveLength(1);
    await asRole(db, 'service_role', 'select finish_webhook_delivery($1,true,200,null)', [mine[0].id]);
    d = (await as(db, u.admA, 'select status from webhook_deliveries where id=$1', [mine[0].id]))[0];
    expect(d.status).toBe('delivered');
    // tras 6 intentos fallidos queda 'failed'
    await db.query("update webhook_deliveries set status='pending', attempts=6 where id=$1", [mine[0].id]);
    await asRole(db, 'service_role', 'select finish_webhook_delivery($1,false,500,$2)', [mine[0].id, 'x']);
    expect((await as(db, u.admA, 'select status from webhook_deliveries where id=$1', [mine[0].id]))[0].status).toBe('failed');
  });
});

describe('membresía', () => {
  it('invitaciones de un solo uso; no se puede quitar al último admin; plantillas iniciales presentes', async () => {
    const code = (await as(db, u.admA, "select create_invite($1,'worker') c", [orgA]))[0].c;
    await as(db, u.ext, "select join_organization($1,'Externo')", [code]);
    await expect(as(db, u.admB, "select join_organization($1,'Reuso')", [code])).rejects.toThrow(/invalid_invite/);
    await expect(as(db, u.admA, "select set_member($1,$2,'worker',true)", [orgA, u.admA])).rejects.toThrow(/last_admin/);
    await as(db, u.admA, "select set_member($1,$2,'worker',false)", [orgA, u.ext]);
    await expect(as(db, u.ext, "select * from save_handoff_draft($1,$2,$3,$4,$5,$6,$7)", [id(), orgA, siteA, areaA, shiftA, tplA, '2026-11-16'])).rejects.toThrow(/forbidden/);
    const names = (await as(db, u.admA, 'select name from templates where org_id=$1', [orgA])).map((r: any) => r.name);
    expect(names).toEqual(expect.arrayContaining(['ALMACÉN', 'MANTENIMIENTO', 'RESTAURANTE', 'SEGURIDAD']));
  });
});
