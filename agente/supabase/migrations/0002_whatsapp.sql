-- AGENTE · WhatsApp (Cloud API de Meta), modo Gerente por números autorizados.
-- Cuenta de WhatsApp Business por empresa. Token cifrado; ningún cliente lo lee (sin policies ni grants).
create table whatsapp_accounts (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  phone_number_id text not null unique check (phone_number_id ~ '^[0-9]{5,25}$'),
  token_enc text not null,
  enabled boolean not null default true
);

-- Números autorizados a usar el modo Gerente por WhatsApp (cada uno ligado a un miembro admin/gerente).
create table whatsapp_numbers (
  tenant_id uuid not null references tenants(id) on delete cascade,
  phone text not null check (phone ~ '^[0-9]{8,15}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tenant_id, phone)
);

-- Mensajes ya procesados (Meta reintenta entregas): evita responder dos veces.
create table whatsapp_processed (
  wamid text primary key,
  created_at timestamptz not null default now()
);

create function add_whatsapp_number(p_tenant uuid, p_email text, p_phone text) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid; ph text := regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g');
begin
  if not has_role(p_tenant, array['admin']) then raise exception 'sólo admin'; end if;
  if ph !~ '^[0-9]{8,15}$' then raise exception 'número inválido (usa código de país y sólo dígitos)'; end if;
  select user_id into u from members m join auth.users a on a.id = m.user_id
    where m.tenant_id = p_tenant and lower(a.email) = lower(trim(p_email)) and m.role in ('admin','gerente');
  if u is null then raise exception 'ese correo no es administrador ni gerente de esta empresa'; end if;
  insert into whatsapp_numbers(tenant_id, phone, user_id) values (p_tenant, ph, u)
    on conflict (tenant_id, phone) do update set user_id = excluded.user_id;
  insert into audit_events(tenant_id, actor, action, detail) values (p_tenant, auth.uid(), 'wa_number_set', jsonb_build_object('user', u));
end $$;

create function list_whatsapp_numbers(p_tenant uuid) returns table (phone text, email text)
language sql stable security definer set search_path = public as $$
  select w.phone, a.email::text from whatsapp_numbers w join auth.users a on a.id = w.user_id
  where w.tenant_id = p_tenant and has_role(p_tenant, array['admin']) $$;

create function whatsapp_account_public(p_tenant uuid) returns table (phone_number_id text, enabled boolean)
language sql stable security definer set search_path = public as $$
  select phone_number_id, enabled from whatsapp_accounts where tenant_id = p_tenant and has_role(p_tenant, array['admin']) $$;

alter table whatsapp_accounts enable row level security;
alter table whatsapp_numbers enable row level security;
alter table whatsapp_processed enable row level security;

revoke all on whatsapp_accounts, whatsapp_numbers, whatsapp_processed from anon, authenticated;
revoke all on function add_whatsapp_number(uuid, text, text), list_whatsapp_numbers(uuid), whatsapp_account_public(uuid) from public, anon, authenticated;
grant execute on function add_whatsapp_number(uuid, text, text), list_whatsapp_numbers(uuid), whatsapp_account_public(uuid) to authenticated;
grant all on whatsapp_accounts, whatsapp_numbers, whatsapp_processed to service_role;
grant execute on function add_whatsapp_number(uuid, text, text), list_whatsapp_numbers(uuid), whatsapp_account_public(uuid) to service_role;

-- Baja de números autorizados: sólo admin de la empresa (RLS), con auditoría automática.
create policy wa_numbers_sel on whatsapp_numbers for select to authenticated using (has_role(tenant_id, array['admin']));
create policy wa_numbers_del on whatsapp_numbers for delete to authenticated using (has_role(tenant_id, array['admin']));
grant select, delete on whatsapp_numbers to authenticated;
create function audit_wa_number_removed() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into audit_events(tenant_id, actor, action) values (old.tenant_id, auth.uid(), 'wa_number_removed');
  return old;
end $$;
revoke all on function audit_wa_number_removed() from public, anon, authenticated;
create trigger wa_number_removed after delete on whatsapp_numbers for each row execute function audit_wa_number_removed();
