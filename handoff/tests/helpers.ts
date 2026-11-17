// Postgres real (PGlite) con un stub mínimo de los esquemas auth/storage de Supabase.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const BOOT = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert on storage.objects to authenticated;
`;

export type Db = PGlite;

export async function makeDb(): Promise<Db> {
  const db = new PGlite();
  await db.exec(BOOT);
  for (const f of readdirSync('supabase/migrations').filter((n) => n.endsWith('.sql')).sort())
    await db.exec(readFileSync('supabase/migrations/' + f, 'utf8'));
  return db;
}

export async function newUser(db: Db, email: string): Promise<string> {
  const id = randomUUID();
  await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
  return id;
}

/** Ejecuta SQL como un usuario autenticado (rol authenticated + JWT sub). */
export async function as<T = any>(db: Db, uid: string, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
  await db.exec('set role authenticated');
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

export async function asRole<T = any>(db: Db, role: 'anon' | 'service_role', sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await db.exec(`set role ${role}`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

export const id = () => randomUUID();
