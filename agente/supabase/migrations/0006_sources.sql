-- Fuentes de datos por empresa: Odoo, API REST genérica o archivos cargados (una por empresa).
-- Reemplaza a erp_connections (que quedó fijo en Odoo); esa tabla se conserva sin uso para no perder datos.
create table erp_sources (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  type text not null check (type in ('odoo','generic_rest','files')),
  config jsonb not null default '{}' check (pg_column_size(config) < 65536),   -- configuración SIN secretos
  secret_enc text,                                                            -- llave/contraseña cifrada (sólo la ve la Edge Function)
  status text not null default 'sin_probar' check (status in ('sin_probar','ok','error')),
  last_checked_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

insert into erp_sources(tenant_id, type, config, secret_enc, status, last_checked_at, last_error)
  select tenant_id, 'odoo', jsonb_build_object('url', url, 'db', db, 'username', username), secret_enc, status, last_checked_at, last_error
  from erp_connections;

-- Compatibilidad con las apps ya instaladas: misma firma y columnas, ahora leyendo de erp_sources (sólo Odoo).
create or replace function erp_connection_public(p_tenant uuid) returns table (type text, url text, db text, username text, status text, last_checked_at timestamptz, last_error text)
language sql stable security definer set search_path = public as $$
  select s.type, s.config->>'url', s.config->>'db', s.config->>'username', s.status, s.last_checked_at, s.last_error
  from erp_sources s where s.tenant_id = p_tenant and s.type = 'odoo' and has_role(p_tenant, array['admin']) $$;

-- Estado de la fuente de datos (cualquier tipo) sin secretos; sólo admin.
create function erp_source_public(p_tenant uuid) returns table (type text, config jsonb, status text, last_checked_at timestamptz, last_error text)
language sql stable security definer set search_path = public as $$
  select s.type, s.config, s.status, s.last_checked_at, s.last_error
  from erp_sources s where s.tenant_id = p_tenant and has_role(p_tenant, array['admin']) $$;

-- Archivos cargados: una versión activa por empresa y conjunto de datos; las filas ya validadas y normalizadas.
create table dataset_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  dataset text not null check (dataset in ('ventas','cartera_cobrar','cartera_pagar','inventario','clientes','catalogo')),
  filename text not null check (length(filename) <= 255),
  row_count int not null check (row_count >= 0),
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  active boolean not null default true
);
create unique index dataset_versions_active_idx on dataset_versions(tenant_id, dataset) where active;

create table dataset_rows (
  id bigserial primary key,
  version_id uuid not null references dataset_versions(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  data jsonb not null
);
create index dataset_rows_version_idx on dataset_rows(version_id, id);

alter table erp_sources enable row level security;
alter table dataset_versions enable row level security;
alter table dataset_rows enable row level security;
create policy dataset_versions_sel on dataset_versions for select to authenticated using (has_role(tenant_id, array['admin']));

revoke all on erp_sources, dataset_versions, dataset_rows from anon, authenticated;
revoke all on function erp_source_public(uuid) from public, anon, authenticated;
grant select on dataset_versions to authenticated;
grant execute on function erp_source_public(uuid), erp_connection_public(uuid) to authenticated;
grant all on erp_sources, dataset_versions, dataset_rows to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on function erp_source_public(uuid), erp_connection_public(uuid) to service_role;
