-- AGENTE V0.1 · esquema multiempresa. Toda tabla con tenant_id + RLS.
-- Escrituras de conversaciones/trazas/credenciales: sólo service_role (Edge Function).

create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  created_at timestamptz not null default now()
);

create table members (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','gerente','lector')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index members_user_idx on members(user_id);

create function is_member(t uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where tenant_id = t and user_id = auth.uid()) $$;
create function has_role(t uuid, roles text[]) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where tenant_id = t and user_id = auth.uid() and role = any(roles)) $$;

create table tenant_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  company_name text not null default '' check (length(company_name) <= 200),
  company_profile text not null default '' check (length(company_profile) <= 8000),
  rules text not null default '' check (length(rules) <= 8000),
  forbidden_topics text[] not null default '{}' check (cardinality(forbidden_topics) <= 50),
  tone text not null default 'profesional y cercano' check (length(tone) <= 200),
  website_url text not null default '' check (length(website_url) <= 500),
  human_contact text not null default '' check (length(human_contact) <= 500),
  updated_at timestamptz not null default now()
);

-- Credenciales del ERP: cifradas por la Edge Function; ningún cliente las lee (sin policies, sin grants).
create table erp_connections (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  type text not null check (type in ('odoo')),
  url text not null,
  db text not null,
  username text not null,
  secret_enc text not null,
  status text not null default 'sin_probar' check (status in ('sin_probar','ok','error')),
  last_checked_at timestamptz,
  last_error text
);

-- Herramientas visibles al público (modo Cliente). Sólo las elegibles pueden ser públicas (defensa en profundidad).
create table tools_exposed (
  tenant_id uuid not null references tenants(id) on delete cascade,
  tool text not null,
  is_public boolean not null default false,
  primary key (tenant_id, tool),
  check (not is_public or tool in ('catalogo_productos','buscar_conocimiento'))
);

create table knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null check (kind in ('url','text')),
  title text not null default '',
  url text,
  status text not null default 'listo' check (status in ('listo','error')),
  error text,
  created_at timestamptz not null default now()
);
create table knowledge_chunks (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  source_id uuid not null references knowledge_sources(id) on delete cascade,
  content text not null,
  tsv tsvector generated always as (to_tsvector('spanish', content)) stored
);
create index knowledge_chunks_tsv_idx on knowledge_chunks using gin (tsv);
create index knowledge_chunks_tenant_idx on knowledge_chunks(tenant_id);

create table channels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null default 'web' check (kind in ('web')),
  public_token text not null unique default (replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','')),
  allowed_origins text[] not null default '{}' check (cardinality(allowed_origins) <= 20),
  enabled boolean not null default true,
  unique (tenant_id, kind)
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  mode text not null check (mode in ('gerente','cliente')),
  channel text not null check (channel in ('app','web')),
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index conversations_tenant_idx on conversations(tenant_id, created_at desc);

create table messages (
  id bigserial primary key,
  conversation_id uuid not null references conversations(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz not null default now()
);
create index messages_conv_idx on messages(conversation_id, id);

-- Traza de datos: qué herramienta, con qué parámetros, cuándo.
create table tool_calls (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  tool text not null,
  params jsonb not null default '{}',
  ok boolean not null,
  summary text not null default '',
  created_at timestamptz not null default now()
);

create table audit_events (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  actor uuid,
  action text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create function audit_append_only() returns trigger language plpgsql set search_path = public as $$
begin raise exception 'audit_events es append-only'; end $$;
create trigger audit_no_update before update or delete on audit_events for each row execute function audit_append_only();

-- Búsqueda de conocimiento (sólo Edge Function / service_role).
create function search_knowledge(p_tenant uuid, p_query text, p_limit int default 5)
returns table (source_id uuid, content text, rank real) language sql stable security definer set search_path = public as $$
  select c.source_id, c.content, ts_rank(c.tsv, q) as rank
  from knowledge_chunks c, websearch_to_tsquery('spanish', p_query) q
  where c.tenant_id = p_tenant and c.tsv @@ q
  order by rank desc limit least(greatest(p_limit,1),10) $$;

-- Alta de empresa: quien la crea es admin.
create function create_tenant(p_name text) returns uuid language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  if auth.uid() is null then raise exception 'no autenticado'; end if;
  insert into tenants(name) values (trim(p_name)) returning id into t;
  insert into members(tenant_id, user_id, role) values (t, auth.uid(), 'admin');
  insert into tenant_settings(tenant_id, company_name) values (t, trim(p_name));
  insert into channels(tenant_id) values (t);
  insert into tools_exposed(tenant_id, tool, is_public) values (t, 'buscar_conocimiento', true), (t, 'catalogo_productos', false);
  insert into audit_events(tenant_id, actor, action) values (t, auth.uid(), 'tenant_created');
  return t;
end $$;

create function add_member_by_email(p_tenant uuid, p_email text, p_role text) returns void language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if not has_role(p_tenant, array['admin']) then raise exception 'sólo admin'; end if;
  if p_role not in ('admin','gerente','lector') then raise exception 'rol inválido'; end if;
  select id into u from auth.users where lower(email) = lower(trim(p_email));
  if u is null then raise exception 'ese correo aún no tiene cuenta'; end if;
  insert into members(tenant_id, user_id, role) values (p_tenant, u, p_role)
    on conflict (tenant_id, user_id) do update set role = excluded.role;
  insert into audit_events(tenant_id, actor, action, detail) values (p_tenant, auth.uid(), 'member_set', jsonb_build_object('user', u, 'role', p_role));
end $$;

create function list_members(p_tenant uuid) returns table (user_id uuid, email text, role text) language sql stable security definer set search_path = public as $$
  select m.user_id, u.email::text, m.role from members m join auth.users u on u.id = m.user_id
  where m.tenant_id = p_tenant and has_role(p_tenant, array['admin']) $$;

-- Estado del ERP sin secretos (sólo admin).
create function erp_connection_public(p_tenant uuid) returns table (type text, url text, db text, username text, status text, last_checked_at timestamptz, last_error text)
language sql stable security definer set search_path = public as $$
  select type, url, db, username, status, last_checked_at, last_error from erp_connections
  where tenant_id = p_tenant and has_role(p_tenant, array['admin']) $$;

-- RLS
alter table tenants enable row level security;
alter table members enable row level security;
alter table tenant_settings enable row level security;
alter table erp_connections enable row level security;
alter table tools_exposed enable row level security;
alter table knowledge_sources enable row level security;
alter table knowledge_chunks enable row level security;
alter table channels enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table tool_calls enable row level security;
alter table audit_events enable row level security;

create policy tenants_sel on tenants for select to authenticated using (is_member(id));
create policy members_sel on members for select to authenticated using (user_id = auth.uid() or has_role(tenant_id, array['admin']));
create policy settings_sel on tenant_settings for select to authenticated using (is_member(tenant_id));
create policy settings_upd on tenant_settings for update to authenticated using (has_role(tenant_id, array['admin'])) with check (has_role(tenant_id, array['admin']));
create policy tools_sel on tools_exposed for select to authenticated using (has_role(tenant_id, array['admin']));
create policy tools_ins on tools_exposed for insert to authenticated with check (has_role(tenant_id, array['admin']));
create policy tools_upd on tools_exposed for update to authenticated using (has_role(tenant_id, array['admin'])) with check (has_role(tenant_id, array['admin']));
create policy ksrc_sel on knowledge_sources for select to authenticated using (has_role(tenant_id, array['admin']));
create policy ksrc_del on knowledge_sources for delete to authenticated using (has_role(tenant_id, array['admin']));
create policy chan_sel on channels for select to authenticated using (has_role(tenant_id, array['admin']));
create policy chan_upd on channels for update to authenticated using (has_role(tenant_id, array['admin'])) with check (has_role(tenant_id, array['admin']));
create policy conv_sel on conversations for select to authenticated using (has_role(tenant_id, array['admin','gerente']));
create policy msg_sel on messages for select to authenticated using (has_role(tenant_id, array['admin','gerente']));
create policy tc_sel on tool_calls for select to authenticated using (has_role(tenant_id, array['admin','gerente']));
create policy audit_sel on audit_events for select to authenticated using (has_role(tenant_id, array['admin']));

-- Privilegios: nada por defecto; sólo lo explícito.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant select on tenants, members, tenant_settings, tools_exposed, knowledge_sources, channels, conversations, messages, tool_calls, audit_events to authenticated;
grant update on tenant_settings, channels to authenticated;
grant insert, update on tools_exposed to authenticated;
grant delete on knowledge_sources to authenticated;
grant execute on function is_member(uuid), has_role(uuid, text[]), create_tenant(text), add_member_by_email(uuid, text, text),
  list_members(uuid), erp_connection_public(uuid) to authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
