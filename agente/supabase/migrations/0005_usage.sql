-- Medición y topes de uso del modelo de IA por empresa (tokens, no dinero: el precio depende del proveedor).
-- Dos topes mensuales independientes: app gerencial y chat público (que un abuso del sitio no deje sin servicio al gerente).
-- Los topes los fija la plataforma (service_role); las empresas sólo ven su consumo.
create table usage_events (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  mode text not null check (mode in ('gerente','cliente')),
  channel text not null check (channel in ('app','web','whatsapp')),
  model text not null,
  input_tokens int not null check (input_tokens >= 0),
  output_tokens int not null check (output_tokens >= 0),
  created_at timestamptz not null default now()
);
create index usage_events_tenant_idx on usage_events(tenant_id, created_at desc);

create table tenant_limits (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  gerente_monthly_tokens bigint check (gerente_monthly_tokens > 0),
  cliente_monthly_tokens bigint check (cliente_monthly_tokens > 0),
  updated_at timestamptz not null default now()
);

alter table usage_events enable row level security;
alter table tenant_limits enable row level security;

-- Consumo del mes en curso (UTC) y tope vigente (valores por defecto si la plataforma no fijó uno).
create function usage_check(p_tenant uuid, p_mode text) returns table (used bigint, token_limit bigint)
language sql stable security definer set search_path = public as $$
  select
    coalesce((select sum(e.input_tokens + e.output_tokens) from usage_events e
              where e.tenant_id = p_tenant and e.mode = p_mode
                and e.created_at >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc')), 0)::bigint,
    (case when p_mode = 'gerente'
          then coalesce((select l.gerente_monthly_tokens from tenant_limits l where l.tenant_id = p_tenant), 3000000)
          else coalesce((select l.cliente_monthly_tokens from tenant_limits l where l.tenant_id = p_tenant), 1000000) end)::bigint $$;

-- Resumen del mes por modo (sólo admin de la empresa).
create function tenant_usage_summary(p_tenant uuid) returns table (mode text, used bigint, token_limit bigint, requests bigint)
language sql stable security definer set search_path = public as $$
  select m.mode, c.used, c.token_limit,
    (select count(*) from usage_events e where e.tenant_id = p_tenant and e.mode = m.mode
       and e.created_at >= (date_trunc('month', now() at time zone 'utc') at time zone 'utc'))::bigint
  from (values ('gerente'), ('cliente')) as m(mode)
  cross join lateral usage_check(p_tenant, m.mode) c
  where has_role(p_tenant, array['admin']) $$;

-- Consumo por día de los últimos N días (sólo admin).
create function tenant_usage_daily(p_tenant uuid, p_days int default 14) returns table (day date, mode text, tokens bigint, requests bigint)
language sql stable security definer set search_path = public as $$
  select (e.created_at at time zone 'utc')::date, e.mode, sum(e.input_tokens + e.output_tokens)::bigint, count(*)::bigint
  from usage_events e
  where e.tenant_id = p_tenant and has_role(p_tenant, array['admin'])
    and e.created_at >= now() - make_interval(days => least(greatest(p_days, 1), 90))
  group by 1, 2 order by 1 desc, 2 $$;

revoke all on usage_events, tenant_limits from anon, authenticated;
revoke all on function usage_check(uuid, text), tenant_usage_summary(uuid), tenant_usage_daily(uuid, int) from public, anon, authenticated;
grant execute on function tenant_usage_summary(uuid), tenant_usage_daily(uuid, int) to authenticated;
grant all on usage_events, tenant_limits to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on function usage_check(uuid, text), tenant_usage_summary(uuid), tenant_usage_daily(uuid, int) to service_role;
