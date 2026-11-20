import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const BOOT = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
`;
export type Db = PGlite;
export async function makeDb(): Promise<Db> {
  const db = new PGlite();
  await db.exec(BOOT);
  await db.exec(readFileSync('supabase/migrations/0001_agente_v01.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/0002_whatsapp.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/0003_search_knowledge_or.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/0004_whatsapp_channels.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/0005_usage.sql', 'utf8'));
  return db;
}
export async function newUser(db: Db, email: string): Promise<string> {
  const id = randomUUID();
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
  return id;
}
export async function as<T = any>(db: Db, uid: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
  await db.exec('set role authenticated');
  try { return (await db.query<T>(sql, params)).rows; } finally { await db.exec('reset role'); }
}
export async function asRole<T = any>(db: Db, role: 'anon' | 'service_role', sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await db.exec(`set role ${role}`);
  try { return (await db.query<T>(sql, params)).rows; } finally { await db.exec('reset role'); }
}
