-- Clave de IA propia por empresa (opcional). Si existe, el consumo va a la cuenta de la empresa y no cuenta contra el tope de la plataforma.
create table tenant_llm (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  key_enc text not null,
  key_hint text not null,
  updated_at timestamptz not null default now()
);
alter table tenant_llm enable row level security;
revoke all on tenant_llm from anon, authenticated;
grant all on tenant_llm to service_role;

alter table usage_events add column own_key boolean not null default false;

-- El tope de la plataforma sólo cuenta el consumo hecho con la clave de la plataforma.
create or replace function usage_check(p_tenant uuid, p_mode text) returns table (used bigint, token_limit bigint)
language sql stable security definer set search_path = public as $$
  select
    coalesce((select sum(e.input_tokens + e.output_tokens) from usage_events e
              where e.tenant_id = p_tenant and e.mode = p_mode and not e.own_key
                and e.created_at >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc')), 0)::bigint,
    (case when p_mode = 'gerente'
          then coalesce((select l.gerente_monthly_tokens from tenant_limits l where l.tenant_id = p_tenant), 3000000)
          else coalesce((select l.cliente_monthly_tokens from tenant_limits l where l.tenant_id = p_tenant), 1000000) end)::bigint $$;

-- Estado de la clave propia (sólo admin; nunca devuelve la clave).
create function tenant_llm_public(p_tenant uuid) returns table (key_hint text, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select l.key_hint, l.updated_at from tenant_llm l where l.tenant_id = p_tenant and has_role(p_tenant, array['admin']) $$;
revoke all on function tenant_llm_public(uuid) from public, anon, authenticated;
grant execute on function tenant_llm_public(uuid) to authenticated, service_role;
