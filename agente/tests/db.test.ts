import { beforeAll, describe, expect, it } from 'vitest';
import { as, asRole, makeDb, newUser, type Db } from './helpers';

let db: Db;
const u: Record<string, string> = {};
let tA: string, tB: string, convA: string;

beforeAll(async () => {
  db = await makeDb();
  for (const n of ['admA', 'gerA', 'lecA', 'admB', 'ext']) u[n] = await newUser(db, n + '@test.mx');
  tA = (await as(db, u.admA, "select create_tenant('Empresa A') t"))[0].t;
  tB = (await as(db, u.admB, "select create_tenant('Empresa B') t"))[0].t;
  await as(db, u.admA, "select add_member_by_email($1,'gerA@test.mx','gerente')", [tA]);
  await as(db, u.admA, "select add_member_by_email($1,'lecA@test.mx','lector')", [tA]);
  convA = (await asRole(db, 'service_role', "insert into conversations(tenant_id,mode,channel) values ($1,'cliente','web') returning id", [tA]))[0].id;
  await asRole(db, 'service_role', "insert into messages(conversation_id,tenant_id,role,content) values ($1,$2,'user','hola secreto A')", [convA, tA]);
  await asRole(db, 'service_role', "insert into erp_sources(tenant_id,type,config,secret_enc) values ($1,'odoo','{\"url\":\"https://x.example.com\",\"db\":\"d\",\"username\":\"u\"}','v1.xxx')", [tA]);
});

describe('aislamiento entre empresas (RLS)', () => {
  it('cada admin sólo ve su empresa y su configuración', async () => {
    expect((await as(db, u.admA, 'select id from tenants')).map((r) => r.id)).toEqual([tA]);
    expect((await as(db, u.admB, 'select tenant_id from tenant_settings')).map((r) => r.tenant_id)).toEqual([tB]);
    expect(await as(db, u.ext, 'select * from tenants')).toHaveLength(0);
  });
  it('B no lee conversaciones, mensajes ni canal (token) de A', async () => {
    expect(await as(db, u.admB, 'select * from messages')).toHaveLength(0);
    expect(await as(db, u.admB, 'select * from conversations')).toHaveLength(0);
    expect((await as(db, u.admB, 'select tenant_id from channels')).map((r) => r.tenant_id)).toEqual([tB]);
  });
  it('B no puede modificar la configuración de A', async () => {
    await as(db, u.admB, "update tenant_settings set rules='hackeado' where tenant_id=$1", [tA]);
    expect((await asRole(db, 'service_role', 'select rules from tenant_settings where tenant_id=$1', [tA]))[0].rules).toBe('');
  });
  it('B no puede agregarse como miembro de A', async () => {
    await expect(as(db, u.admB, "select add_member_by_email($1,'admB@test.mx','admin')", [tA])).rejects.toThrow();
    await expect(as(db, u.admB, "insert into members(tenant_id,user_id,role) values ($1,$2,'admin')", [tA, u.admB])).rejects.toThrow();
  });
});

describe('roles dentro de la empresa', () => {
  it('gerente lee conversaciones; lector no', async () => {
    expect((await as(db, u.gerA, 'select * from messages')).length).toBe(1);
    expect(await as(db, u.lecA, 'select * from messages')).toHaveLength(0);
  });
  it('sólo admin edita configuración; gerente y lector no', async () => {
    await as(db, u.gerA, "update tenant_settings set rules='x' where tenant_id=$1", [tA]);
    await as(db, u.lecA, "update tenant_settings set rules='y' where tenant_id=$1", [tA]);
    expect((await asRole(db, 'service_role', 'select rules from tenant_settings where tenant_id=$1', [tA]))[0].rules).toBe('');
    await as(db, u.admA, "update tenant_settings set rules='z' where tenant_id=$1", [tA]);
    expect((await asRole(db, 'service_role', 'select rules from tenant_settings where tenant_id=$1', [tA]))[0].rules).toBe('z');
  });
  it('gerente no ve audit_events ni puede cambiar herramientas públicas', async () => {
    expect(await as(db, u.gerA, 'select * from audit_events')).toHaveLength(0);
    expect((await as(db, u.admA, 'select * from audit_events')).length).toBeGreaterThan(0);
    await as(db, u.gerA, "update tools_exposed set is_public=true where tenant_id=$1 and tool='catalogo_productos'", [tA]);
    expect((await asRole(db, 'service_role', "select is_public from tools_exposed where tenant_id=$1 and tool='catalogo_productos'", [tA]))[0].is_public).toBe(false);
  });
});

describe('seguridad de datos sensibles', () => {
  it('ningún cliente puede leer erp_connections (credenciales)', async () => {
    await expect(as(db, u.admA, 'select * from erp_connections')).rejects.toThrow();
    await expect(asRole(db, 'anon', 'select * from erp_connections')).rejects.toThrow();
  });
  it('el estado del ERP sin secretos sólo lo ve el admin', async () => {
    const r = await as(db, u.admA, 'select * from erp_connection_public($1)', [tA]);
    expect(r).toHaveLength(1); expect(JSON.stringify(r)).not.toContain('v1.xxx');
    expect(await as(db, u.gerA, 'select * from erp_connection_public($1)', [tA])).toHaveLength(0);
    expect(await as(db, u.admB, 'select * from erp_connection_public($1)', [tA])).toHaveLength(0);
  });
  it('una herramienta privada no puede marcarse pública (constraint)', async () => {
    await expect(as(db, u.admA, "insert into tools_exposed(tenant_id,tool,is_public) values ($1,'ventas',true)", [tA])).rejects.toThrow();
    await expect(as(db, u.admA, "insert into tools_exposed(tenant_id,tool,is_public) values ($1,'inventario',true)", [tA])).rejects.toThrow();
  });
  it('anon y authenticated no pueden ejecutar search_knowledge; service_role sí', async () => {
    await expect(asRole(db, 'anon', "select * from search_knowledge($1,'x')", [tA])).rejects.toThrow();
    await expect(as(db, u.admA, "select * from search_knowledge($1,'x')", [tA])).rejects.toThrow();
    await asRole(db, 'service_role', "select * from search_knowledge($1,'x')", [tA]);
  });
  it('search_knowledge sólo devuelve fragmentos de la empresa pedida', async () => {
    const sA = (await asRole(db, 'service_role', "insert into knowledge_sources(tenant_id,kind,title) values ($1,'text','a') returning id", [tA]))[0].id;
    const sB = (await asRole(db, 'service_role', "insert into knowledge_sources(tenant_id,kind,title) values ($1,'text','b') returning id", [tB]))[0].id;
    await asRole(db, 'service_role', "insert into knowledge_chunks(tenant_id,source_id,content) values ($1,$2,'Nuestro horario es de lunes a viernes de 9 a 18 horas')", [tA, sA]);
    await asRole(db, 'service_role', "insert into knowledge_chunks(tenant_id,source_id,content) values ($1,$2,'Horario secreto de la empresa B')", [tB, sB]);
    const r = await asRole(db, 'service_role', "select content from search_knowledge($1,'horarios')", [tA]);
    expect(r).toHaveLength(1); expect(r[0].content).toContain('lunes');
  });
  it('REGRESIÓN: una pregunta larga con palabras que no están en el texto igual encuentra el fragmento', async () => {
    const r = await asRole(db, 'service_role', "select content from search_knowledge($1,'¿A qué hora abren los viernes y qué formas de pago aceptan en la tienda?')", [tA]);
    expect(r.length).toBe(1); expect(r[0].content).toContain('lunes');
    expect(await asRole(db, 'service_role', "select * from search_knowledge($1,'zzzz qqqq')", [tA])).toHaveLength(0);
    expect(await asRole(db, 'service_role', "select * from search_knowledge($1,'')", [tA])).toHaveLength(0);
    expect(await asRole(db, 'service_role', "select * from search_knowledge($1,'''; drop table x; -- \" :* & |')", [tA])).toHaveLength(0); // sintaxis hostil no rompe la consulta
  });
  it('audit_events es append-only', async () => {
    await expect(asRole(db, 'service_role', "update audit_events set action='x'")).rejects.toThrow(/append-only/);
    await expect(asRole(db, 'service_role', 'delete from audit_events')).rejects.toThrow(/append-only/);
  });
  it('add_member_by_email rechaza correos sin cuenta y roles inválidos', async () => {
    await expect(as(db, u.admA, "select add_member_by_email($1,'nadie@test.mx','gerente')", [tA])).rejects.toThrow(/cuenta/);
    await expect(as(db, u.admA, "select add_member_by_email($1,'ext@test.mx','dios')", [tA])).rejects.toThrow(/rol/);
  });
});

describe('whatsapp (BD)', () => {
  it('sólo admin autoriza números, y sólo para admin/gerente de su empresa', async () => {
    await as(db, u.admA, "select add_whatsapp_number($1,'gerA@test.mx','+52 1 55 1234 5678')", [tA]);
    expect((await as(db, u.admA, 'select phone, email from list_whatsapp_numbers($1)', [tA]))).toEqual([{ phone: '5215512345678', email: 'gerA@test.mx' }]);
    await expect(as(db, u.gerA, "select add_whatsapp_number($1,'gerA@test.mx','5215500000000')", [tA])).rejects.toThrow(/admin/);
    await expect(as(db, u.admA, "select add_whatsapp_number($1,'lecA@test.mx','5215500000000')", [tA])).rejects.toThrow(/gerente/); // lector no
    await expect(as(db, u.admA, "select add_whatsapp_number($1,'admB@test.mx','5215500000000')", [tA])).rejects.toThrow(/gerente/); // otra empresa
    await expect(as(db, u.admA, "select add_whatsapp_number($1,'gerA@test.mx','abc')", [tA])).rejects.toThrow(/inválido/);
  });
  it('otra empresa no ve ni borra los números; sólo admin quita, y queda auditado', async () => {
    expect(await as(db, u.admB, 'select * from list_whatsapp_numbers($1)', [tA])).toHaveLength(0);
    expect(await as(db, u.admB, 'select * from whatsapp_numbers')).toHaveLength(0);
    await as(db, u.admB, "delete from whatsapp_numbers where tenant_id=$1", [tA]); // RLS: no afecta filas ajenas
    await as(db, u.gerA, "delete from whatsapp_numbers where tenant_id=$1", [tA]); // gerente tampoco
    expect(await as(db, u.admA, 'select * from list_whatsapp_numbers($1)', [tA])).toHaveLength(1);
    await as(db, u.admA, "delete from whatsapp_numbers where tenant_id=$1 and phone='5215512345678'", [tA]);
    expect(await as(db, u.admA, 'select * from list_whatsapp_numbers($1)', [tA])).toHaveLength(0);
    expect((await as(db, u.admA, "select count(*)::int n from audit_events where tenant_id=$1 and action='wa_number_removed'", [tA]))[0].n).toBe(1);
  });
  it('el token de WhatsApp y los mensajes procesados no son legibles por clientes', async () => {
    await asRole(db, 'service_role', "insert into whatsapp_accounts(tenant_id,phone_number_id,token_enc) values ($1,'123456','v1.zzz')", [tA]);
    await expect(as(db, u.admA, 'select * from whatsapp_accounts')).rejects.toThrow();
    await expect(asRole(db, 'anon', 'select * from whatsapp_accounts')).rejects.toThrow();
    await expect(as(db, u.admA, 'select * from whatsapp_processed')).rejects.toThrow();
    const r = await as(db, u.admA, 'select * from whatsapp_account_public($1)', [tA]);
    expect(r).toEqual([{ phone_number_id: '123456', enabled: true }]);
    expect(await as(db, u.admB, 'select * from whatsapp_account_public($1)', [tA])).toHaveLength(0);
  });
  it('un número de teléfono de Meta no puede registrarse en dos empresas', async () => {
    await expect(asRole(db, 'service_role', "insert into whatsapp_accounts(tenant_id,phone_number_id,token_enc) values ($1,'123456','v1.yyy')", [tB])).rejects.toThrow();
  });
  it('dedupe de mensajes: el mismo wamid no se inserta dos veces', async () => {
    await asRole(db, 'service_role', "insert into whatsapp_processed(wamid) values ('wamid.A')");
    await expect(asRole(db, 'service_role', "insert into whatsapp_processed(wamid) values ('wamid.A')")).rejects.toThrow();
  });
  it('las conversaciones por whatsapp son válidas', async () => {
    await asRole(db, 'service_role', "insert into conversations(tenant_id,mode,channel,user_id) values ($1,'gerente','whatsapp',$2)", [tA, u.gerA]);
  });
});

describe('uso y topes por empresa (BD)', () => {
  const ev = (t: string, mode: string, i: number, o: number, when = 'now()') =>
    asRole(db, 'service_role', `insert into usage_events(tenant_id,mode,channel,model,input_tokens,output_tokens,created_at) values ($1,$2,'app','claude-haiku-5-5',$3,$4,${when})`, [t, mode, i, o]);
  it('usage_check: suma el mes en curso por modo y usa los topes por defecto', async () => {
    await ev(tA, 'gerente', 1000, 200); await ev(tA, 'gerente', 300, 100); await ev(tA, 'cliente', 50, 50);
    const g = (await asRole(db, 'service_role', "select * from usage_check($1,'gerente')", [tA]))[0];
    expect(Number(g.used)).toBe(1600); expect(Number(g.token_limit)).toBe(3000000);
    const c = (await asRole(db, 'service_role', "select * from usage_check($1,'cliente')", [tA]))[0];
    expect(Number(c.used)).toBe(100); expect(Number(c.token_limit)).toBe(1000000);
  });
  it('REGRESIÓN: el consumo de meses anteriores y de otras empresas no cuenta', async () => {
    await ev(tA, 'gerente', 999999, 0, "now() - interval '40 days'");
    await ev(tB, 'gerente', 777, 0);
    expect(Number((await asRole(db, 'service_role', "select used from usage_check($1,'gerente')", [tA]))[0].used)).toBe(1600);
    expect(Number((await asRole(db, 'service_role', "select used from usage_check($1,'gerente')", [tB]))[0].used)).toBe(777);
  });
  it('el tope por empresa se puede ajustar (sólo service_role) y no afecta a las demás', async () => {
    await asRole(db, 'service_role', "insert into tenant_limits(tenant_id,gerente_monthly_tokens) values ($1,1500)", [tA]);
    expect(Number((await asRole(db, 'service_role', "select token_limit from usage_check($1,'gerente')", [tA]))[0].token_limit)).toBe(1500);
    expect(Number((await asRole(db, 'service_role', "select token_limit from usage_check($1,'cliente')", [tA]))[0].token_limit)).toBe(1000000);
    expect(Number((await asRole(db, 'service_role', "select token_limit from usage_check($1,'gerente')", [tB]))[0].token_limit)).toBe(3000000);
    await expect(asRole(db, 'service_role', "insert into tenant_limits(tenant_id,gerente_monthly_tokens) values ($1,0)", [tB])).rejects.toThrow();
  });
  it('ningún cliente puede leer ni escribir usage_events ni tenant_limits (ni subirse el tope)', async () => {
    for (const q of ['select * from usage_events', 'select * from tenant_limits', "insert into tenant_limits(tenant_id,gerente_monthly_tokens) values ('" + tA + "', 999999999)", "update tenant_limits set gerente_monthly_tokens = 999999999"])
      await expect(as(db, u.admA, q)).rejects.toThrow();
    await expect(asRole(db, 'anon', 'select * from usage_events')).rejects.toThrow();
  });
  it('usage_check sólo lo ejecuta service_role', async () => {
    await expect(as(db, u.admA, "select * from usage_check($1,'gerente')", [tA])).rejects.toThrow();
    await expect(asRole(db, 'anon', "select * from usage_check($1,'gerente')", [tA])).rejects.toThrow();
  });
  it('resumen y detalle diario: sólo el admin de esa empresa los ve', async () => {
    const s = await as(db, u.admA, 'select * from tenant_usage_summary($1)', [tA]);
    expect(s.map((r) => r.mode).sort()).toEqual(['cliente', 'gerente']);
    expect(Number(s.find((r) => r.mode === 'gerente').used)).toBe(1600); expect(Number(s.find((r) => r.mode === 'gerente').token_limit)).toBe(1500);
    expect(Number(s.find((r) => r.mode === 'gerente').requests)).toBe(2);
    expect(await as(db, u.gerA, 'select * from tenant_usage_summary($1)', [tA])).toHaveLength(0);
    expect(await as(db, u.lecA, 'select * from tenant_usage_summary($1)', [tA])).toHaveLength(0);
    expect(await as(db, u.admB, 'select * from tenant_usage_summary($1)', [tA])).toHaveLength(0);
    const d = await as(db, u.admA, 'select * from tenant_usage_daily($1, 14)', [tA]);
    expect(d.length).toBeGreaterThan(0); expect(d.every((r) => Number(r.tokens) > 0)).toBe(true);
    expect(await as(db, u.admB, 'select * from tenant_usage_daily($1, 14)', [tA])).toHaveLength(0);
  });
});

describe('fuentes de datos y archivos (BD)', () => {
  it('erp_sources: ningún cliente la lee ni escribe; el estado público sólo lo ve el admin de la empresa y sin secretos', async () => {
    await expect(as(db, u.admA, 'select * from erp_sources')).rejects.toThrow();
    await expect(asRole(db, 'anon', 'select * from erp_sources')).rejects.toThrow();
    await expect(as(db, u.admA, "insert into erp_sources(tenant_id,type) values ('" + tB + "','files')")).rejects.toThrow();
    const r = await as(db, u.admA, 'select * from erp_source_public($1)', [tA]);
    expect(r).toHaveLength(1); expect(r[0].type).toBe('odoo'); expect(JSON.stringify(r)).not.toContain('v1.xxx');
    expect(await as(db, u.gerA, 'select * from erp_source_public($1)', [tA])).toHaveLength(0);
    expect(await as(db, u.admB, 'select * from erp_source_public($1)', [tA])).toHaveLength(0);
  });
  it('compatibilidad: erp_connection_public sólo devuelve fuentes Odoo', async () => {
    expect(await as(db, u.admA, 'select * from erp_connection_public($1)', [tA])).toHaveLength(1);
    await asRole(db, 'service_role', "update erp_sources set type='generic_rest' where tenant_id=$1", [tA]);
    expect(await as(db, u.admA, 'select * from erp_connection_public($1)', [tA])).toHaveLength(0);
    expect((await as(db, u.admA, 'select type from erp_source_public($1)', [tA]))[0].type).toBe('generic_rest');
    await asRole(db, 'service_role', "update erp_sources set type='odoo' where tenant_id=$1", [tA]);
  });
  it('el tipo de fuente sólo admite odoo, generic_rest o files', async () => {
    await expect(asRole(db, 'service_role', "insert into erp_sources(tenant_id,type) values ($1,'sap')", [tB])).rejects.toThrow();
    await asRole(db, 'service_role', "insert into erp_sources(tenant_id,type) values ($1,'files')", [tB]);
  });
  it('MIGRACIÓN: las conexiones Odoo existentes pasan a erp_sources y siguen visibles para las apps ya instaladas', async () => {
    const { PGlite } = await import('@electric-sql/pglite'); const { readFileSync } = await import('node:fs');
    const d = new PGlite();
    await d.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema auth; create table auth.users (id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to anon, authenticated, service_role; grant usage on schema public to anon, authenticated, service_role;`);
    for (const f of ['0001_agente_v01', '0002_whatsapp', '0003_search_knowledge_or', '0004_whatsapp_channels', '0005_usage']) await d.exec(readFileSync(`supabase/migrations/${f}.sql`, 'utf8'));
    await d.exec("insert into auth.users values ('00000000-0000-0000-0000-0000000000aa','a@x.mx')");
    await d.exec("select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000aa', false); set role authenticated;");
    const t = (await d.query<any>("select create_tenant('Vieja') t")).rows[0].t; await d.exec('reset role');
    await d.query("insert into erp_connections(tenant_id,type,url,db,username,secret_enc,status) values ($1,'odoo','https://o.example.com','db1','u@x.mx','v1.abc','ok')", [t]);
    await d.exec(readFileSync('supabase/migrations/0006_sources.sql', 'utf8'));
    const s = (await d.query<any>('select type, config, secret_enc, status from erp_sources where tenant_id=$1', [t])).rows;
    expect(s).toEqual([{ type: 'odoo', config: { url: 'https://o.example.com', db: 'db1', username: 'u@x.mx' }, secret_enc: 'v1.abc', status: 'ok' }]);
    await d.exec("select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000aa', false); set role authenticated;");
    const c = (await d.query<any>('select * from erp_connection_public($1)', [t])).rows;
    expect(c).toEqual([expect.objectContaining({ type: 'odoo', url: 'https://o.example.com', db: 'db1', username: 'u@x.mx', status: 'ok' })]);
  });
  it('dataset_versions: sólo una versión activa por empresa y conjunto; otra empresa no la ve; las filas no son legibles por clientes', async () => {
    const v1 = (await asRole(db, 'service_role', "insert into dataset_versions(tenant_id,dataset,filename,row_count) values ($1,'ventas','a.csv',1) returning id", [tA]))[0].id;
    await asRole(db, 'service_role', "insert into dataset_rows(version_id,tenant_id,data) values ($1,$2,'{\"folio\":\"A1\"}')", [v1, tA]);
    await expect(asRole(db, 'service_role', "insert into dataset_versions(tenant_id,dataset,filename,row_count) values ($1,'ventas','b.csv',1)", [tA])).rejects.toThrow();
    await asRole(db, 'service_role', "insert into dataset_versions(tenant_id,dataset,filename,row_count) values ($1,'inventario','i.csv',1)", [tA]); // otro dataset: sí
    await asRole(db, 'service_role', "insert into dataset_versions(tenant_id,dataset,filename,row_count) values ($1,'ventas','b.csv',1)", [tB]); // otra empresa: sí
    expect((await as(db, u.admA, 'select filename from dataset_versions order by filename')).map((r) => r.filename)).toEqual(['a.csv', 'i.csv']);
    expect((await as(db, u.admB, 'select filename from dataset_versions')).map((r) => r.filename)).toEqual(['b.csv']);
    expect(await as(db, u.gerA, 'select * from dataset_versions')).toHaveLength(0);
    await expect(as(db, u.admA, 'select * from dataset_rows')).rejects.toThrow();
    await expect(as(db, u.admA, "insert into dataset_versions(tenant_id,dataset,filename,row_count) values ('" + tA + "','clientes','x.csv',1)")).rejects.toThrow();
    await expect(asRole(db, 'service_role', "insert into dataset_versions(tenant_id,dataset,filename,row_count) values ($1,'nomina','x.csv',1)", [tA])).rejects.toThrow();
  });
  it('al reemplazar un archivo la versión nueva queda activa y al borrar la vieja se van sus filas', async () => {
    await asRole(db, 'service_role', "update dataset_versions set active=false where tenant_id=$1 and dataset='ventas' and active", [tA]);
    const v2 = (await asRole(db, 'service_role', "insert into dataset_versions(tenant_id,dataset,filename,row_count) values ($1,'ventas','nuevo.csv',2) returning id", [tA]))[0].id;
    await asRole(db, 'service_role', "insert into dataset_rows(version_id,tenant_id,data) values ($1,$2,'{}')", [v2, tA]);
    await asRole(db, 'service_role', "select 1 from dataset_versions where tenant_id=$1 and not active and dataset='ventas'", [tA]);
    const before = Number((await asRole(db, 'service_role', 'select count(*)::int n from dataset_rows where tenant_id=$1', [tA]))[0].n);
    await asRole(db, 'service_role', "delete from dataset_versions where tenant_id=$1 and dataset='ventas' and not active", [tA]);
    const after = Number((await asRole(db, 'service_role', 'select count(*)::int n from dataset_rows where tenant_id=$1', [tA]))[0].n);
    expect(after).toBe(before - 1);
  });
});
