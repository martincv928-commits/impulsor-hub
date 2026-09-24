-- QuoteFlow V0.3 — esquema y seguridad (RLS) para Supabase.
-- Pégalo completo en el SQL Editor de tu proyecto de Supabase y ejecútalo una sola vez.
-- Es seguro volver a ejecutarlo (usa "if not exists" / "or replace" donde aplica),
-- pero no lo ejecutes contra una base que ya tenga datos reales sin revisar antes.

-- ---------- perfiles ----------
-- Un renglón por cada usuario de auth.users. Se llena solo con un trigger.
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email) values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- negocios y membresías ----------
create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  rfc text not null default '',
  phone text not null default '',
  email text not null default '',
  address text not null default '',
  currency text not null default 'MXN',
  iva_rate_bp int not null default 1600,
  iva_mode text not null default 'mas',
  validity_days int not null default 15,
  conditions text not null default '',
  logo text not null default '',
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  unique (business_id, user_id)
);

-- Crea el negocio y su membresía de dueño en un solo paso, sin depender de
-- nada que mande el navegador: el user_id siempre es el de la sesión actual.
create or replace function create_business(
  p_name text, p_rfc text default '', p_phone text default '', p_email text default '',
  p_address text default '', p_currency text default 'MXN', p_iva_rate_bp int default 1600,
  p_iva_mode text default 'mas', p_validity_days int default 15, p_conditions text default ''
) returns businesses language plpgsql security definer set search_path = public as $$
declare
  biz businesses;
begin
  insert into businesses (name, rfc, phone, email, address, currency, iva_rate_bp, iva_mode, validity_days, conditions, created_by)
  values (p_name, p_rfc, p_phone, p_email, p_address, p_currency, p_iva_rate_bp, p_iva_mode, p_validity_days, p_conditions, auth.uid())
  returning * into biz;

  insert into business_members (business_id, user_id, role) values (biz.id, auth.uid(), 'owner');
  return biz;
end;
$$;

-- ---------- datos comerciales, todos ligados a un negocio ----------
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  key text not null,
  name text not null,
  unit text not null default '',
  price_cents bigint not null,
  uses int not null default 1,
  updated_at timestamptz not null default now(),
  unique (business_id, key)
);

create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  folio text not null,
  client_name text not null default '',
  status text not null default 'BORRADOR' check (status in ('BORRADOR', 'GENERADA')),
  discount_type text not null default 'pct',
  discount_value bigint not null default 0,
  iva_mode text not null default 'mas',
  iva_rate_bp int not null default 1600,
  validity_days int not null default 15,
  notes text not null default '',
  conditions text not null default '',
  source_text text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  generated_at timestamptz,
  unique (business_id, folio)
);

create table if not exists quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  sort_order int not null default 0,
  description text not null default '',
  qty_milli bigint,
  unit text not null default '',
  price_cents bigint,
  price_source text,
  catalog_name text
);

-- ---------- seguridad: nadie ve ni toca datos de un negocio donde no es miembro ----------
create or replace function is_member(target_business_id uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from business_members m
    where m.business_id = target_business_id and m.user_id = auth.uid()
  );
$$;

alter table profiles enable row level security;
alter table businesses enable row level security;
alter table business_members enable row level security;
alter table customers enable row level security;
alter table products enable row level security;
alter table quotes enable row level security;
alter table quote_items enable row level security;

drop policy if exists "propio perfil" on profiles;
create policy "propio perfil" on profiles for select using (id = auth.uid());
drop policy if exists "editar propio perfil" on profiles;
create policy "editar propio perfil" on profiles for update using (id = auth.uid());

drop policy if exists "ver negocios propios" on businesses;
create policy "ver negocios propios" on businesses for select using (is_member(id));
drop policy if exists "editar negocios propios" on businesses;
create policy "editar negocios propios" on businesses for update using (is_member(id)) with check (is_member(id));
-- No hay policy de insert directo a "businesses": se crea siempre vía create_business().

drop policy if exists "ver mis membresías" on business_members;
create policy "ver mis membresías" on business_members for select using (is_member(business_id));

drop policy if exists "clientes del negocio" on customers;
create policy "clientes del negocio" on customers for all using (is_member(business_id)) with check (is_member(business_id));

drop policy if exists "catálogo del negocio" on products;
create policy "catálogo del negocio" on products for all using (is_member(business_id)) with check (is_member(business_id));

drop policy if exists "cotizaciones del negocio" on quotes;
create policy "cotizaciones del negocio" on quotes for all using (is_member(business_id)) with check (is_member(business_id));

drop policy if exists "conceptos del negocio" on quote_items;
create policy "conceptos del negocio" on quote_items for all
  using (is_member((select business_id from quotes where quotes.id = quote_id)))
  with check (is_member((select business_id from quotes where quotes.id = quote_id)));
