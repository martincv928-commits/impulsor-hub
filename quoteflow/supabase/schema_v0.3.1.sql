-- QuoteFlow V0.3.1 — administración de la plataforma (SaaS admin).
-- Se ejecuta DESPUÉS de supabase/schema.sql, en el mismo SQL Editor.
-- Es aditivo: no borra ni toca datos existentes. Seguro de volver a ejecutar.
--
-- Diseño de seguridad (para que sea imposible de saltarse desde el navegador):
-- 1. Toda acción administrativa sensible es una función de Postgres
--    (SECURITY DEFINER) que primero verifica is_platform_admin(auth.uid()).
--    Nadie puede "ser admin" cambiando el código de la app: se verifica
--    siempre dentro de la base de datos.
-- 2. platform_admins no tiene ninguna política de escritura: la única forma
--    de agregar un admin es tú mismo, desde el SQL Editor de Supabase.
-- 3. Un negocio ya no puede cambiar su propio "status"/"plan"/vencimiento
--    aunque manipule las peticiones: se le quitan esas columnas por permisos
--    de Postgres (GRANT/REVOKE), no solo por RLS.

-- ---------- administradores de la plataforma ----------
create table if not exists platform_admins (
  id uuid primary key references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function is_platform_admin(uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from platform_admins where id = uid);
$$;

alter table platform_admins enable row level security;
drop policy if exists "un admin ve la lista de admins" on platform_admins;
create policy "un admin ve la lista de admins" on platform_admins for select using (is_platform_admin(auth.uid()));
-- Sin política de insert/update/delete: agregar un admin se hace a mano en el SQL Editor.

-- ---------- estado comercial del negocio ----------
alter table businesses add column if not exists status text not null default 'TRIAL'
  check (status in ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED'));
alter table businesses add column if not exists plan text not null default 'FREE'
  check (plan in ('FREE', 'BASIC', 'PRO'));
alter table businesses add column if not exists plan_started_at timestamptz not null default now();
alter table businesses add column if not exists plan_renews_at timestamptz;

alter table business_members add column if not exists status text not null default 'ACTIVE'
  check (status in ('ACTIVE', 'DISABLED'));

create table if not exists plan_limits (
  plan text primary key check (plan in ('FREE', 'BASIC', 'PRO')),
  max_users int,
  max_quotes_per_month int,
  max_storage_mb int,
  features jsonb not null default '{}'::jsonb
);
insert into plan_limits (plan, max_users, max_quotes_per_month, max_storage_mb) values
  ('FREE', 1, 30, 50), ('BASIC', 3, 200, 500), ('PRO', 10, 2000, 5000)
on conflict (plan) do nothing;
alter table plan_limits enable row level security;
drop policy if exists "planes visibles para quien tenga sesión" on plan_limits;
create policy "planes visibles para quien tenga sesión" on plan_limits for select using (auth.uid() is not null);

create table if not exists business_plan_history (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  plan text,
  status text,
  renews_at timestamptz,
  reason text,
  changed_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
alter table business_plan_history enable row level security;
drop policy if exists "historial visible al negocio y al admin" on business_plan_history;
create policy "historial visible al negocio y al admin" on business_plan_history
  for select using (is_member(business_id) or is_platform_admin(auth.uid()));
-- Sin política de insert: solo lo llenan las funciones admin_* de abajo.

-- ---------- auditoría administrativa ----------
create table if not exists admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references profiles(id),
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
alter table admin_audit_log enable row level security;
drop policy if exists "solo admins ven la auditoría" on admin_audit_log;
create policy "solo admins ven la auditoría" on admin_audit_log for select using (is_platform_admin(auth.uid()));

create or replace function admin_log(p_action text, p_entity text, p_entity_id text, p_before jsonb, p_after jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into admin_audit_log (admin_id, action, entity, entity_id, before, after)
  values (auth.uid(), p_action, p_entity, p_entity_id, p_before, p_after);
end;
$$;

-- ---------- una membresía/negocio suspendido no puede seguir cotizando ----------
-- (las lecturas se quedan como estaban con is_member: no se borra ni se oculta nada;
-- solo se bloquea CREAR/EDITAR/BORRAR cuando el negocio o la persona están inactivos)
create or replace function is_active_member(target_business_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from business_members m
    join businesses b on b.id = m.business_id
    where m.business_id = target_business_id and m.user_id = auth.uid()
      and m.status = 'ACTIVE' and b.status not in ('SUSPENDED', 'CANCELLED')
  );
$$;

drop policy if exists "clientes del negocio" on customers;
drop policy if exists "clientes del negocio - ver" on customers;
create policy "clientes del negocio - ver" on customers for select using (is_member(business_id));
drop policy if exists "clientes del negocio - crear" on customers;
create policy "clientes del negocio - crear" on customers for insert with check (is_active_member(business_id));
drop policy if exists "clientes del negocio - editar" on customers;
create policy "clientes del negocio - editar" on customers for update using (is_active_member(business_id)) with check (is_active_member(business_id));
drop policy if exists "clientes del negocio - borrar" on customers;
create policy "clientes del negocio - borrar" on customers for delete using (is_active_member(business_id));

drop policy if exists "catálogo del negocio" on products;
drop policy if exists "catálogo del negocio - ver" on products;
create policy "catálogo del negocio - ver" on products for select using (is_member(business_id));
drop policy if exists "catálogo del negocio - crear" on products;
create policy "catálogo del negocio - crear" on products for insert with check (is_active_member(business_id));
drop policy if exists "catálogo del negocio - editar" on products;
create policy "catálogo del negocio - editar" on products for update using (is_active_member(business_id)) with check (is_active_member(business_id));
drop policy if exists "catálogo del negocio - borrar" on products;
create policy "catálogo del negocio - borrar" on products for delete using (is_active_member(business_id));

drop policy if exists "cotizaciones del negocio" on quotes;
drop policy if exists "cotizaciones del negocio - ver" on quotes;
create policy "cotizaciones del negocio - ver" on quotes for select using (is_member(business_id));
drop policy if exists "cotizaciones del negocio - crear" on quotes;
create policy "cotizaciones del negocio - crear" on quotes for insert with check (is_active_member(business_id));
drop policy if exists "cotizaciones del negocio - editar" on quotes;
create policy "cotizaciones del negocio - editar" on quotes for update using (is_active_member(business_id)) with check (is_active_member(business_id));
drop policy if exists "cotizaciones del negocio - borrar" on quotes;
create policy "cotizaciones del negocio - borrar" on quotes for delete using (is_active_member(business_id));

drop policy if exists "conceptos del negocio" on quote_items;
drop policy if exists "conceptos del negocio - ver" on quote_items;
create policy "conceptos del negocio - ver" on quote_items for select
  using (is_member((select business_id from quotes where quotes.id = quote_id)));
drop policy if exists "conceptos del negocio - crear" on quote_items;
create policy "conceptos del negocio - crear" on quote_items for insert
  with check (is_active_member((select business_id from quotes where quotes.id = quote_id)));
drop policy if exists "conceptos del negocio - editar" on quote_items;
create policy "conceptos del negocio - editar" on quote_items for update
  using (is_active_member((select business_id from quotes where quotes.id = quote_id)))
  with check (is_active_member((select business_id from quotes where quotes.id = quote_id)));
drop policy if exists "conceptos del negocio - borrar" on quote_items;
create policy "conceptos del negocio - borrar" on quote_items for delete
  using (is_active_member((select business_id from quotes where quotes.id = quote_id)));

-- ---------- un admin puede VER (no modificar libremente) todos los negocios y membresías ----------
drop policy if exists "ver negocios propios" on businesses;
create policy "ver negocios propios o admin" on businesses for select using (is_member(id) or is_platform_admin(auth.uid()));

drop policy if exists "ver mis membresías" on business_members;
create policy "ver mis membresías o admin" on business_members for select using (is_member(business_id) or is_platform_admin(auth.uid()));

-- Un negocio ya no puede tocar su propio status/plan/vencimiento ni por error ni a propósito:
-- se le quitan esas columnas al rol "authenticated" a nivel de Postgres (no solo RLS).
revoke update on businesses from authenticated;
grant update (name, rfc, phone, email, address, currency, iva_rate_bp, iva_mode, validity_days, conditions, logo, updated_at)
  on businesses to authenticated;

-- business_members solo se escribe desde funciones del servidor (create_business, admin_set_member_status).
revoke insert, update, delete on business_members from authenticated;

-- ---------- acciones administrativas (todas verifican is_platform_admin por dentro) ----------
create or replace function admin_set_business_status(p_business_id uuid, p_status text, p_reason text default null)
returns businesses language plpgsql security definer set search_path = public as $$
declare biz businesses; before_status text;
begin
  if not is_platform_admin(auth.uid()) then raise exception 'No autorizado'; end if;
  if p_status not in ('TRIAL', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED') then raise exception 'Estado inválido'; end if;
  select status into before_status from businesses where id = p_business_id;
  update businesses set status = p_status, updated_at = now() where id = p_business_id returning * into biz;
  insert into business_plan_history (business_id, plan, status, renews_at, reason, changed_by)
    values (p_business_id, biz.plan, p_status, biz.plan_renews_at, p_reason, auth.uid());
  perform admin_log('set_business_status', 'business', p_business_id::text,
    jsonb_build_object('status', before_status), jsonb_build_object('status', p_status, 'reason', p_reason));
  return biz;
end;
$$;

create or replace function admin_set_business_plan(p_business_id uuid, p_plan text, p_reason text default null)
returns businesses language plpgsql security definer set search_path = public as $$
declare biz businesses; before_plan text;
begin
  if not is_platform_admin(auth.uid()) then raise exception 'No autorizado'; end if;
  if p_plan not in ('FREE', 'BASIC', 'PRO') then raise exception 'Plan inválido'; end if;
  select plan into before_plan from businesses where id = p_business_id;
  update businesses set plan = p_plan, updated_at = now() where id = p_business_id returning * into biz;
  insert into business_plan_history (business_id, plan, status, renews_at, reason, changed_by)
    values (p_business_id, p_plan, biz.status, biz.plan_renews_at, p_reason, auth.uid());
  perform admin_log('set_business_plan', 'business', p_business_id::text,
    jsonb_build_object('plan', before_plan), jsonb_build_object('plan', p_plan, 'reason', p_reason));
  return biz;
end;
$$;

create or replace function admin_set_business_renewal(p_business_id uuid, p_renews_at timestamptz, p_reason text default null)
returns businesses language plpgsql security definer set search_path = public as $$
declare biz businesses; before_val timestamptz;
begin
  if not is_platform_admin(auth.uid()) then raise exception 'No autorizado'; end if;
  select plan_renews_at into before_val from businesses where id = p_business_id;
  update businesses set plan_renews_at = p_renews_at, updated_at = now() where id = p_business_id returning * into biz;
  insert into business_plan_history (business_id, plan, status, renews_at, reason, changed_by)
    values (p_business_id, biz.plan, biz.status, p_renews_at, p_reason, auth.uid());
  perform admin_log('set_business_renewal', 'business', p_business_id::text,
    jsonb_build_object('plan_renews_at', before_val), jsonb_build_object('plan_renews_at', p_renews_at, 'reason', p_reason));
  return biz;
end;
$$;

create or replace function admin_add_courtesy_days(p_business_id uuid, p_days int, p_reason text default null)
returns businesses language plpgsql security definer set search_path = public as $$
declare biz businesses; base timestamptz;
begin
  if not is_platform_admin(auth.uid()) then raise exception 'No autorizado'; end if;
  select coalesce(plan_renews_at, now()) into base from businesses where id = p_business_id;
  update businesses set plan_renews_at = base + make_interval(days => p_days), updated_at = now()
    where id = p_business_id returning * into biz;
  insert into business_plan_history (business_id, plan, status, renews_at, reason, changed_by)
    values (p_business_id, biz.plan, biz.status, biz.plan_renews_at, coalesce(p_reason, p_days || ' días de cortesía'), auth.uid());
  perform admin_log('add_courtesy_days', 'business', p_business_id::text,
    jsonb_build_object('plan_renews_at', base), jsonb_build_object('plan_renews_at', biz.plan_renews_at, 'days', p_days));
  return biz;
end;
$$;

create or replace function admin_set_member_status(p_member_id uuid, p_status text, p_reason text default null)
returns business_members language plpgsql security definer set search_path = public as $$
declare mem business_members; before_status text;
begin
  if not is_platform_admin(auth.uid()) then raise exception 'No autorizado'; end if;
  if p_status not in ('ACTIVE', 'DISABLED') then raise exception 'Estado inválido'; end if;
  select status into before_status from business_members where id = p_member_id;
  update business_members set status = p_status where id = p_member_id returning * into mem;
  perform admin_log('set_member_status', 'business_member', p_member_id::text,
    jsonb_build_object('status', before_status), jsonb_build_object('status', p_status, 'reason', p_reason));
  return mem;
end;
$$;

-- ---------- consultas de solo lectura para el panel admin ----------
create or replace function admin_dashboard_stats()
returns json language plpgsql security definer stable set search_path = public as $$
declare result json;
begin
  if not is_platform_admin(auth.uid()) then raise exception 'No autorizado'; end if;
  select json_build_object(
    'businesses_total', (select count(*) from businesses),
    'businesses_active', (select count(*) from businesses where status = 'ACTIVE'),
    'businesses_trial', (select count(*) from businesses where status = 'TRIAL'),
    'businesses_suspended', (select count(*) from businesses where status = 'SUSPENDED'),
    'businesses_cancelled', (select count(*) from businesses where status = 'CANCELLED'),
    'users_total', (select count(*) from profiles),
    'quotes_total', (select count(*) from quotes),
    'tickets_open', (select count(*) from support_tickets where status in ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER')),
    'recent_businesses', (select coalesce(json_agg(row_to_json(r)), '[]'::json) from
      (select id, name, status, plan, created_at from businesses order by created_at desc limit 5) r),
    'recent_actions', (select coalesce(json_agg(row_to_json(r)), '[]'::json) from
      (select action, entity, entity_id, created_at from admin_audit_log order by created_at desc limit 8) r)
  ) into result;
  return result;
end;
$$;

create or replace function admin_list_businesses(p_search text default null)
returns table (
  id uuid, name text, status text, plan text, plan_renews_at timestamptz, created_at timestamptz,
  owner_email text, members_count bigint, quotes_count bigint
) language plpgsql security definer stable set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'No autorizado'; end if;
  return query
    select b.id, b.name, b.status, b.plan, b.plan_renews_at, b.created_at, p.email as owner_email,
      (select count(*) from business_members m where m.business_id = b.id) as members_count,
      (select count(*) from quotes q where q.business_id = b.id) as quotes_count
    from businesses b
    left join profiles p on p.id = b.created_by
    where p_search is null or p_search = '' or b.name ilike '%' || p_search || '%' or p.email ilike '%' || p_search || '%'
    order by b.created_at desc;
end;
$$;

create or replace function admin_list_members(p_business_id uuid)
returns table (id uuid, user_id uuid, email text, role text, status text, created_at timestamptz)
language plpgsql security definer stable set search_path = public as $$
begin
  if not is_platform_admin(auth.uid()) then raise exception 'No autorizado'; end if;
  return query
    select m.id, m.user_id, p.email, m.role, m.status, m.created_at
    from business_members m join profiles p on p.id = m.user_id
    where m.business_id = p_business_id order by m.created_at asc;
end;
$$;

-- ---------- soporte ----------
create table if not exists support_tickets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references profiles(id),
  subject text not null,
  description text not null default '',
  status text not null default 'OPEN' check (status in ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'RESOLVED', 'CLOSED')),
  priority text not null default 'NORMAL' check (priority in ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets(id) on delete cascade,
  author_id uuid not null references profiles(id),
  author_role text not null check (author_role in ('customer', 'admin')),
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists support_access_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references profiles(id),
  business_id uuid not null references businesses(id),
  ticket_id uuid references support_tickets(id),
  action text not null,
  resource text,
  created_at timestamptz not null default now()
);

alter table support_tickets enable row level security;
alter table support_ticket_messages enable row level security;
alter table support_access_log enable row level security;

drop policy if exists "tickets del negocio o admin - ver" on support_tickets;
create policy "tickets del negocio o admin - ver" on support_tickets for select
  using (is_member(business_id) or is_platform_admin(auth.uid()));
drop policy if exists "tickets del negocio - crear" on support_tickets;
create policy "tickets del negocio - crear" on support_tickets for insert
  with check (is_active_member(business_id) and user_id = auth.uid());
drop policy if exists "tickets - solo admin actualiza estado" on support_tickets;
create policy "tickets - solo admin actualiza estado" on support_tickets for update
  using (is_platform_admin(auth.uid())) with check (is_platform_admin(auth.uid()));

drop policy if exists "mensajes de ticket - ver" on support_ticket_messages;
create policy "mensajes de ticket - ver" on support_ticket_messages for select
  using (is_platform_admin(auth.uid()) or exists (select 1 from support_tickets t where t.id = ticket_id and is_member(t.business_id)));
drop policy if exists "mensajes de ticket - crear" on support_ticket_messages;
create policy "mensajes de ticket - crear" on support_ticket_messages for insert
  with check (
    author_id = auth.uid() and (
      (author_role = 'admin' and is_platform_admin(auth.uid())) or
      (author_role = 'customer' and exists (select 1 from support_tickets t where t.id = ticket_id and is_active_member(t.business_id)))
    )
  );

drop policy if exists "solo admins ven el log de accesos de soporte" on support_access_log;
create policy "solo admins ven el log de accesos de soporte" on support_access_log for select using (is_platform_admin(auth.uid()));

-- Único camino para que un admin vea datos operativos de un negocio: ligado a
-- un ticket concreto y siempre queda registrado en support_access_log.
-- Devuelve un resumen (no las cotizaciones completas con todos sus conceptos).
create or replace function admin_support_access(p_ticket_id uuid, p_action text default 'view_overview')
returns json language plpgsql security definer set search_path = public as $$
declare found_biz uuid; result json;
begin
  if not is_platform_admin(auth.uid()) then raise exception 'No autorizado'; end if;
  select business_id into found_biz from support_tickets where id = p_ticket_id;
  if found_biz is null then raise exception 'Ticket no encontrado'; end if;
  insert into support_access_log (admin_id, business_id, ticket_id, action, resource)
    values (auth.uid(), found_biz, p_ticket_id, p_action, 'business_overview');
  select json_build_object(
    'business', (select row_to_json(b) from (select id, name, email, phone, status, plan, created_at from businesses where id = found_biz) b),
    'members', (select coalesce(json_agg(row_to_json(m)), '[]'::json) from
      (select p.email, bm.role, bm.status from business_members bm join profiles p on p.id = bm.user_id where bm.business_id = found_biz) m),
    'recent_quotes', (select coalesce(json_agg(row_to_json(q)), '[]'::json) from
      (select folio, client_name, status, updated_at from quotes where business_id = found_biz order by updated_at desc limit 10) q)
  ) into result;
  return result;
end;
$$;
