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
  await asRole(db, 'service_role', "insert into erp_connections(tenant_id,type,url,db,username,secret_enc) values ($1,'odoo','https://x.example.com','d','u','v1.xxx')", [tA]);
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
  it('otra empresa no ve los números; quitar requiere admin', async () => {
    expect(await as(db, u.admB, 'select * from list_whatsapp_numbers($1)', [tA])).toHaveLength(0);
    await expect(as(db, u.gerA, "select remove_whatsapp_number($1,'5215512345678')", [tA])).rejects.toThrow(/admin/);
    await as(db, u.admA, "select remove_whatsapp_number($1,'5215512345678')", [tA]);
    expect(await as(db, u.admA, 'select * from list_whatsapp_numbers($1)', [tA])).toHaveLength(0);
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
