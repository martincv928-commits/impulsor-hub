-- HANDOFF V0.1 — esquema, RLS y RPCs. Toda escritura crítica pasa por funciones SECURITY DEFINER.
-- Los clientes (rol authenticated) NO tienen INSERT/UPDATE/DELETE directo salvo en tablas de configuración (admin).

-- ───────────────────────── Tablas ─────────────────────────
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 120),
  plan text not null default 'free' check (plan in ('free','team','business','pro')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table organization_members (
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','supervisor','worker')),
  display_name text not null check (length(btrim(display_name)) >= 1),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index on organization_members (user_id);

create table org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  code text not null unique,
  role text not null check (role in ('admin','supervisor','worker')),
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid references auth.users(id),
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table sites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) >= 1),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, org_id)
);

create table areas (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  site_id uuid not null,
  name text not null check (length(btrim(name)) >= 1),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (site_id, org_id) references sites (id, org_id)
);

create table shift_definitions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) >= 1),
  start_time time,
  end_time time,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, org_id)
);

create table templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) >= 1),
  site_id uuid,
  area_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (site_id, org_id) references sites (id, org_id),
  foreign key (area_id, org_id) references areas (id, org_id)
);

create table template_fields (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  template_id uuid not null,
  label text not null check (length(btrim(label)) >= 1),
  type text not null check (type in ('text','number','boolean','select','checklist','photo','note','signature')),
  position int not null default 0,
  required boolean not null default false,
  options jsonb not null default '[]'::jsonb,
  expected text,
  instructions text,
  active boolean not null default true,
  unique (id, org_id),
  foreign key (template_id, org_id) references templates (id, org_id) on delete cascade
);
create index on template_fields (template_id, position);

create table handoffs (
  id uuid primary key,                      -- generado por el cliente: reintentos idempotentes
  org_id uuid not null references organizations(id) on delete cascade,
  site_id uuid not null,
  area_id uuid not null,
  shift_id uuid not null,
  template_id uuid not null,
  shift_date date not null,
  from_user uuid not null,
  to_user uuid,
  status text not null default 'draft'
    check (status in ('draft','pending_receipt','accepted','accepted_obs','disputed','rejected')),
  snapshot jsonb,
  snapshot_hash text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  foreign key (site_id, org_id) references sites (id, org_id),
  foreign key (area_id, org_id) references areas (id, org_id),
  foreign key (shift_id, org_id) references shift_definitions (id, org_id),
  foreign key (template_id, org_id) references templates (id, org_id),
  foreign key (from_user, org_id) references organization_members (user_id, org_id),
  foreign key (to_user, org_id) references organization_members (user_id, org_id),
  check ((status = 'draft') = (submitted_at is null)),
  check ((status = 'draft') = (snapshot is null))
);
create index on handoffs (org_id, status);
create index on handoffs (org_id, area_id, shift_date);

create table handoff_responses (
  handoff_id uuid not null,
  field_id uuid not null,
  org_id uuid not null,
  value jsonb,
  primary key (handoff_id, field_id),
  foreign key (handoff_id, org_id) references handoffs (id, org_id) on delete cascade,
  foreign key (field_id, org_id) references template_fields (id, org_id)
);

create table handoff_receipts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  handoff_id uuid not null unique,          -- una recepción por entrega: doble clic no duplica
  received_by uuid not null,
  decision text not null check (decision in ('accepted','accepted_with_observations','discrepancy','rejected')),
  notes text,
  acknowledged jsonb not null default '{}'::jsonb,  -- qué reconoció el receptor (no implica aceptar responsabilidad)
  received_at timestamptz not null default clock_timestamp(),
  foreign key (handoff_id, org_id) references handoffs (id, org_id),
  foreign key (received_by, org_id) references organization_members (user_id, org_id),
  check (decision = 'accepted' or length(btrim(coalesce(notes, ''))) > 0)
);

create table handoff_addenda (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  handoff_id uuid not null,
  author uuid not null,
  body text not null check (length(btrim(body)) > 0),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (handoff_id, org_id) references handoffs (id, org_id)
);

create table issues (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  site_id uuid not null,
  area_id uuid not null,
  title text not null check (length(btrim(title)) > 0),
  description text,
  category text not null default 'pendiente',
  priority text not null default 'medium' check (priority in ('low','medium','high','critical')),
  status text not null default 'open' check (status in ('open','in_progress','blocked','resolved','cancelled')),
  assignee uuid,
  due_date date,
  external_ref text,
  created_by uuid not null,
  origin_handoff_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_note text,
  unique (id, org_id),
  foreign key (site_id, org_id) references sites (id, org_id),
  foreign key (area_id, org_id) references areas (id, org_id),
  foreign key (assignee, org_id) references organization_members (user_id, org_id),
  foreign key (created_by, org_id) references organization_members (user_id, org_id),
  foreign key (origin_handoff_id, org_id) references handoffs (id, org_id),
  check ((status = 'resolved') = (resolved_by is not null))
);
create index on issues (org_id, status);
create index on issues (org_id, area_id);
create index on issues (org_id, assignee);

create table issue_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  issue_id uuid not null,
  actor uuid not null,
  action text not null check (action in ('created','received','assigned','responsibility_accepted','status_changed','note','resolved','reopened')),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (issue_id, org_id) references issues (id, org_id)
);
create index on issue_events (issue_id, created_at);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  path text not null unique,
  entity_type text not null check (entity_type in ('handoff','issue')),
  entity_id uuid not null,
  uploaded_by uuid not null,
  mime text,
  size_bytes bigint,
  created_at timestamptz not null default now(),
  check (path like org_id::text || '/%'),
  foreign key (uploaded_by, org_id) references organization_members (user_id, org_id)
);
create index on attachments (entity_type, entity_id);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event text not null,
  title text not null,
  body text,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on notifications (user_id, read_at, created_at desc);

create table report_recipients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  site_id uuid,
  area_id uuid,
  event text not null check (event in ('handoff_submitted','handoff_accepted','handoff_rejected','handoff_discrepancy','critical_issue','handoff_unreceived','shift_summary')),
  user_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (site_id, org_id) references sites (id, org_id),
  foreign key (area_id, org_id) references areas (id, org_id),
  foreign key (user_id, org_id) references organization_members (user_id, org_id) on delete cascade
);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  actor uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index on audit_events (org_id, created_at desc);
create index on audit_events (entity_type, entity_id);

create table api_keys (                      -- integration_credentials
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  prefix text not null,
  key_hash text not null unique,             -- sha256 hex; el valor en claro se muestra una sola vez
  created_by uuid not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key (created_by, org_id) references organization_members (user_id, org_id)
);

create table webhook_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  url text not null check (url ~ '^https://'),
  secret text not null,
  events text[] not null,
  active boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  subscription_id uuid not null references webhook_subscriptions(id) on delete cascade,
  event_type text not null,
  event_key text not null,                   -- idempotencia: un evento lógico por suscripción
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','delivered','failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  response_code int,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (subscription_id, event_key)
);
create index on webhook_deliveries (status, next_attempt_at);

-- ───────────────────────── Helpers de autorización ─────────────────────────
create function member_role(p_org uuid, p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from organization_members where org_id = p_org and user_id = p_user and active
$$;
create function is_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from organization_members where org_id = p_org and user_id = auth.uid() and active)
$$;
create function is_manager(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from organization_members where org_id = p_org and user_id = auth.uid() and active and role in ('admin','supervisor'))
$$;
create function is_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from organization_members where org_id = p_org and user_id = auth.uid() and active and role = 'admin')
$$;
create function auth_uid_or_fail() returns uuid language plpgsql stable as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  return u;
end $$;

-- ───────────────────────── Inmutabilidad / guardas ─────────────────────────
create function forbid_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'immutable_record' using detail = tg_table_name, errcode = '42501';
end $$;
create trigger audit_events_immutable before update or delete on audit_events for each row execute function forbid_mutation();
create trigger issue_events_immutable before update or delete on issue_events for each row execute function forbid_mutation();
create trigger receipts_immutable before update or delete on handoff_receipts for each row execute function forbid_mutation();
create trigger addenda_immutable before update or delete on handoff_addenda for each row execute function forbid_mutation();
create trigger attachments_immutable before update or delete on attachments for each row execute function forbid_mutation();

create function guard_handoffs() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'immutable_record' using detail = 'handoffs', errcode = '42501';
  end if;
  if old.status <> 'draft' then
    if (new.org_id, new.site_id, new.area_id, new.shift_id, new.template_id, new.shift_date, new.from_user,
        new.to_user, new.snapshot, new.snapshot_hash, new.submitted_at, new.created_at)
       is distinct from
       (old.org_id, old.site_id, old.area_id, old.shift_id, old.template_id, old.shift_date, old.from_user,
        old.to_user, old.snapshot, old.snapshot_hash, old.submitted_at, old.created_at) then
      raise exception 'handoff_locked' using errcode = '42501';
    end if;
    if new.status <> old.status and old.status <> 'pending_receipt' then
      raise exception 'handoff_locked' using errcode = '42501';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger handoffs_guard before update or delete on handoffs for each row execute function guard_handoffs();

create function guard_responses() returns trigger language plpgsql security definer set search_path = public as $$
declare st text;
begin
  select status into st from handoffs where id = coalesce(new.handoff_id, old.handoff_id);
  if st is not null and st <> 'draft' then
    raise exception 'handoff_locked' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger responses_guard before insert or update or delete on handoff_responses for each row execute function guard_responses();

-- Auditoría de cambios de configuración (tablas editables por admin)
create function audit_cfg() returns trigger language plpgsql security definer set search_path = public as $$
declare r jsonb := to_jsonb(coalesce(new, old));
begin
  insert into audit_events (org_id, actor, action, entity_type, entity_id, data)
  values ((r->>'org_id')::uuid, auth.uid(), tg_table_name || '.' || lower(tg_op), tg_table_name, (r->>'id')::uuid, r);
  return coalesce(new, old);
end $$;
create trigger audit_sites after insert or update or delete on sites for each row execute function audit_cfg();
create trigger audit_areas after insert or update or delete on areas for each row execute function audit_cfg();
create trigger audit_shifts after insert or update or delete on shift_definitions for each row execute function audit_cfg();
create trigger audit_templates after insert or update or delete on templates for each row execute function audit_cfg();
create trigger audit_template_fields after insert or update or delete on template_fields for each row execute function audit_cfg();
create trigger audit_recipients after insert or update or delete on report_recipients for each row execute function audit_cfg();

-- ───────────────────────── Helpers internos ─────────────────────────
create function _audit(p_org uuid, p_actor uuid, p_action text, p_etype text, p_eid uuid, p_data jsonb default '{}')
returns void language sql security definer set search_path = public as $$
  insert into audit_events (org_id, actor, action, entity_type, entity_id, data) values (p_org, p_actor, p_action, p_etype, p_eid, coalesce(p_data, '{}'::jsonb))
$$;

create function _notify(p_org uuid, p_site uuid, p_area uuid, p_event text, p_title text, p_body text,
                        p_etype text, p_eid uuid, p_extra uuid[] default '{}')
returns void language sql security definer set search_path = public as $$
  insert into notifications (org_id, user_id, event, title, body, entity_type, entity_id)
  select p_org, m.user_id, p_event, p_title, p_body, p_etype, p_eid
  from organization_members m
  where m.org_id = p_org and m.active
    and (m.user_id = any (coalesce(p_extra, '{}'))
         or exists (select 1 from report_recipients rr
                    where rr.org_id = p_org and rr.event = p_event and rr.user_id = m.user_id
                      and (rr.site_id is null or rr.site_id = p_site)
                      and (rr.area_id is null or rr.area_id = p_area)))
$$;

create function _enqueue(p_org uuid, p_type text, p_key text, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s record;
begin
  for s in select id from webhook_subscriptions where org_id = p_org and active and p_type = any (events) loop
    insert into webhook_deliveries (org_id, subscription_id, event_type, event_key, payload)
    values (p_org, s.id, p_type, p_key,
            jsonb_build_object('id', gen_random_uuid(), 'type', p_type, 'created_at', clock_timestamp(),
                               'organization_id', p_org, 'data', p_data))
    on conflict (subscription_id, event_key) do nothing;
  end loop;
end $$;

create function _issue_json(i issues) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', i.id, 'title', i.title, 'description', i.description, 'category', i.category,
    'priority', i.priority, 'status', i.status, 'assignee', i.assignee, 'due_date', i.due_date,
    'external_ref', i.external_ref, 'created_by', i.created_by, 'created_at', i.created_at,
    'origin_handoff_id', i.origin_handoff_id)
$$;

create function _field_ok(f template_fields, v jsonb, p_handoff uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if v is null then return false; end if;
  if f.type = 'photo' then
    return jsonb_typeof(v) = 'array' and jsonb_array_length(v) > 0
      and (select count(*) from attachments a
           where a.entity_type = 'handoff' and a.entity_id = p_handoff
             and a.id::text in (select jsonb_array_elements_text(v))) = jsonb_array_length(v);
  elsif f.type = 'checklist' then
    return jsonb_typeof(v) = 'object'
      and not exists (select 1 from jsonb_array_elements_text(f.options) o where not (v ? o));
  elsif f.type = 'boolean' then return jsonb_typeof(v) = 'boolean';
  elsif f.type = 'number' then return jsonb_typeof(v) = 'number';
  end if;
  return v <> '""'::jsonb and v <> '[]'::jsonb and v <> '{}'::jsonb and v <> 'null'::jsonb
         and not (jsonb_typeof(v) = 'string' and length(btrim(v #>> '{}')) = 0);
end $$;

create function _snapshot(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare h handoffs; res jsonb;
begin
  select * into h from handoffs where id = p_id;
  select jsonb_build_object(
    'version', 1,
    'handoff', jsonb_build_object(
      'id', h.id, 'organization_id', h.org_id, 'shift_date', h.shift_date,
      'from_user', h.from_user,
      'from_name', (select display_name from organization_members where org_id = h.org_id and user_id = h.from_user),
      'to_user', h.to_user,
      'to_name', (select display_name from organization_members where org_id = h.org_id and user_id = h.to_user),
      'site', (select jsonb_build_object('id', s.id, 'name', s.name) from sites s where s.id = h.site_id),
      'area', (select jsonb_build_object('id', a.id, 'name', a.name) from areas a where a.id = h.area_id),
      'shift', (select jsonb_build_object('id', d.id, 'name', d.name) from shift_definitions d where d.id = h.shift_id),
      'template', (select jsonb_build_object('id', t.id, 'name', t.name) from templates t where t.id = h.template_id)),
    'fields', (select coalesce(jsonb_agg(jsonb_build_object('field_id', f.id, 'label', f.label, 'type', f.type,
                 'required', f.required, 'expected', f.expected, 'instructions', f.instructions,
                 'options', f.options, 'value', r.value) order by f.position, f.label), '[]'::jsonb)
               from template_fields f
               left join handoff_responses r on r.handoff_id = h.id and r.field_id = f.id
               where f.template_id = h.template_id and f.active),
    'issues_created', (select coalesce(jsonb_agg(_issue_json(i) order by i.created_at), '[]'::jsonb)
                       from issues i where i.origin_handoff_id = h.id),
    'issues_open', (select coalesce(jsonb_agg(_issue_json(i) order by i.created_at), '[]'::jsonb)
                    from issues i where i.org_id = h.org_id and i.area_id = h.area_id
                      and i.status in ('open','in_progress','blocked')
                      and i.origin_handoff_id is distinct from h.id),
    'attachments', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'path', a.path, 'mime', a.mime) order by a.created_at), '[]'::jsonb)
                    from attachments a where a.entity_type = 'handoff' and a.entity_id = h.id)
  ) into res;
  return res;
end $$;

-- ───────────────────────── Organización y miembros ─────────────────────────
create function _seed_template(p_org uuid, p_name text, p_fields jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid; f jsonb; n int := 0;
begin
  insert into templates (org_id, name) values (p_org, p_name) returning id into t;
  for f in select * from jsonb_array_elements(p_fields) loop
    n := n + 1;
    insert into template_fields (org_id, template_id, label, type, position, required, options)
    values (p_org, t, f->>'l', f->>'t', n, coalesce((f->>'r')::boolean, false), coalesce(f->'o', '[]'::jsonb));
  end loop;
end $$;

create function create_organization(p_name text, p_display_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare u uuid := auth_uid_or_fail(); o uuid;
begin
  insert into organizations (name, created_by) values (btrim(p_name), u) returning id into o;
  insert into organization_members (org_id, user_id, role, display_name) values (o, u, 'admin', btrim(p_display_name));
  -- plantillas iniciales
  perform _seed_template(o, 'ALMACÉN', '[
    {"l":"Estado general del área","t":"select","r":true,"o":["Ordenada","Con observaciones","Desordenada"]},
    {"l":"¿Equipos funcionando?","t":"boolean","r":true},
    {"l":"Pedidos pendientes","t":"note"},
    {"l":"Mercancía recibida / por recibir","t":"note"},
    {"l":"Herramientas y llaves entregadas","t":"note"},
    {"l":"Inventario crítico","t":"note"},
    {"l":"Fotografías del área","t":"photo"},
    {"l":"Observaciones","t":"note"}]'::jsonb);
  perform _seed_template(o, 'MANTENIMIENTO', '[
    {"l":"Estado de equipos críticos","t":"select","r":true,"o":["Operando","Operando con fallas","Detenido"]},
    {"l":"Fallas abiertas","t":"note"},
    {"l":"Trabajos pendientes","t":"note"},
    {"l":"Checklist de seguridad","t":"checklist","r":true,"o":["Área despejada","Herramientas completas","Refacciones registradas"]},
    {"l":"Fotografías","t":"photo"},
    {"l":"Observaciones","t":"note"}]'::jsonb);
  perform _seed_template(o, 'RESTAURANTE', '[
    {"l":"¿Caja cuadrada?","t":"boolean","r":true},
    {"l":"Monto en caja (MXN)","t":"number"},
    {"l":"Limpieza","t":"checklist","r":true,"o":["Cocina","Salón","Baños","Barra"]},
    {"l":"Insumos faltantes","t":"note"},
    {"l":"Estado de equipos","t":"select","o":["Todos funcionan","Con fallas"]},
    {"l":"Pendientes para el siguiente turno","t":"note"},
    {"l":"Fotografías","t":"photo"}]'::jsonb);
  perform _seed_template(o, 'SEGURIDAD', '[
    {"l":"Novedades del turno","t":"note","r":true},
    {"l":"Accesos de visitantes y proveedores","t":"note"},
    {"l":"Llaves entregadas","t":"note"},
    {"l":"Equipo entregado","t":"checklist","o":["Radio","Linterna","Bitácora"]},
    {"l":"Fotografías","t":"photo"},
    {"l":"Firma simple (nombre)","t":"signature"}]'::jsonb);
  perform _audit(o, u, 'organization.created', 'organizations', o, jsonb_build_object('name', btrim(p_name)));
  return o;
end $$;

create function create_invite(p_org uuid, p_role text default 'worker') returns text
language plpgsql security definer set search_path = public as $$
declare u uuid := auth_uid_or_fail(); c text;
begin
  if not is_admin(p_org) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_role not in ('admin','supervisor','worker') then raise exception 'invalid_role'; end if;
  c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into org_invites (org_id, code, role, created_by) values (p_org, c, p_role, u);
  perform _audit(p_org, u, 'invite.created', 'org_invites', null, jsonb_build_object('role', p_role));
  return c;
end $$;

create function join_organization(p_code text, p_display_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare u uuid := auth_uid_or_fail(); inv org_invites;
begin
  select * into inv from org_invites where code = upper(btrim(p_code)) for update;
  if not found or inv.used_at is not null or inv.expires_at < now() then
    raise exception 'invalid_invite';
  end if;
  if exists (select 1 from organization_members where org_id = inv.org_id and user_id = u) then
    raise exception 'already_member';
  end if;
  insert into organization_members (org_id, user_id, role, display_name) values (inv.org_id, u, inv.role, btrim(p_display_name));
  update org_invites set used_by = u, used_at = now() where id = inv.id;
  perform _audit(inv.org_id, u, 'member.joined', 'organization_members', u, jsonb_build_object('role', inv.role));
  return inv.org_id;
end $$;

create function set_member(p_org uuid, p_user uuid, p_role text, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := auth_uid_or_fail();
begin
  if not is_admin(p_org) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_role not in ('admin','supervisor','worker') then raise exception 'invalid_role'; end if;
  update organization_members set role = p_role, active = p_active where org_id = p_org and user_id = p_user;
  if not found then raise exception 'not_found'; end if;
  if not exists (select 1 from organization_members where org_id = p_org and role = 'admin' and active) then
    raise exception 'last_admin';
  end if;
  perform _audit(p_org, u, 'member.updated', 'organization_members', p_user, jsonb_build_object('role', p_role, 'active', p_active));
end $$;

-- ───────────────────────── Entregas ─────────────────────────
create function core_save_draft(p_actor uuid, p_id uuid, p_org uuid, p_site uuid, p_area uuid, p_shift uuid,
                                p_template uuid, p_date date, p_to_user uuid, p_responses jsonb)
returns handoffs language plpgsql security definer set search_path = public as $$
declare h handoffs; created boolean := false;
begin
  if member_role(p_org, p_actor) is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from areas where id = p_area and org_id = p_org and site_id = p_site) then
    raise exception 'invalid_area';
  end if;
  if p_to_user is not null and (p_to_user = p_actor or member_role(p_org, p_to_user) is null) then
    raise exception 'invalid_receiver';
  end if;
  select * into h from handoffs where id = p_id for update;
  if found then
    if h.org_id <> p_org or h.from_user <> p_actor then raise exception 'forbidden' using errcode = '42501'; end if;
    if h.status <> 'draft' then raise exception 'handoff_locked' using errcode = '42501'; end if;
    update handoffs set site_id = p_site, area_id = p_area, shift_id = p_shift, template_id = p_template,
           shift_date = p_date, to_user = p_to_user where id = p_id returning * into h;
  else
    insert into handoffs (id, org_id, site_id, area_id, shift_id, template_id, shift_date, from_user, to_user)
    values (p_id, p_org, p_site, p_area, p_shift, p_template, p_date, p_actor, p_to_user) returning * into h;
    created := true;
    perform _audit(p_org, p_actor, 'handoff.created', 'handoffs', p_id, '{}');
    perform _enqueue(p_org, 'handoff.created', 'handoff.created:' || p_id,
      jsonb_build_object('handoff_id', p_id, 'status', 'draft', 'site_id', p_site, 'area_id', p_area,
                         'shift_id', p_shift, 'shift_date', p_date, 'from_user', p_actor));
  end if;
  if p_responses is not null then
    delete from handoff_responses where handoff_id = p_id;
    insert into handoff_responses (handoff_id, field_id, org_id, value)
    select p_id, f.id, p_org, e.value
    from jsonb_each(p_responses) e
    join template_fields f on f.id = e.key::uuid and f.template_id = p_template and f.org_id = p_org;
  end if;
  if not created and not exists (select 1 from audit_events where entity_type = 'handoffs' and entity_id = p_id
                                 and action = 'handoff.draft_saved' and created_at > now() - interval '5 minutes') then
    perform _audit(p_org, p_actor, 'handoff.draft_saved', 'handoffs', p_id, '{}');
  end if;
  return h;
end $$;

create function core_submit_handoff(p_actor uuid, p_id uuid, p_to_user uuid default null)
returns handoffs language plpgsql security definer set search_path = public as $$
declare h handoffs; v_to uuid; v_missing jsonb; v_snap jsonb; v_hash text; v_extra uuid[];
begin
  select * into h from handoffs where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if h.from_user <> p_actor or member_role(h.org_id, p_actor) is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if h.status <> 'draft' then return h; end if;      -- idempotente: reintento tras fallo de red
  v_to := coalesce(p_to_user, h.to_user);
  if v_to is not null and (v_to = p_actor or member_role(h.org_id, v_to) is null) then raise exception 'invalid_receiver'; end if;

  select coalesce(jsonb_agg(f.label order by f.position), '[]'::jsonb) into v_missing
  from template_fields f
  left join handoff_responses r on r.handoff_id = h.id and r.field_id = f.id
  where f.template_id = h.template_id and f.active and f.required and not _field_ok(f, r.value, h.id);
  if jsonb_array_length(v_missing) > 0 then
    raise exception 'required_fields_missing' using detail = v_missing::text;
  end if;

  update handoffs set to_user = v_to where id = h.id;
  v_snap := _snapshot(h.id);
  v_hash := encode(sha256(convert_to(v_snap::text, 'UTF8')), 'hex');
  update handoffs set status = 'pending_receipt', snapshot = v_snap, snapshot_hash = v_hash,
         submitted_at = clock_timestamp() where id = h.id returning * into h;

  if v_to is not null then v_extra := array[v_to];
  else select coalesce(array_agg(user_id), '{}') into v_extra from organization_members
       where org_id = h.org_id and active and user_id <> p_actor and role = 'worker';
  end if;
  perform _notify(h.org_id, h.site_id, h.area_id, 'handoff_submitted', 'Entrega de turno por recibir',
                  (v_snap->'handoff'->'area'->>'name') || ' · ' || (v_snap->'handoff'->'shift'->>'name') || ' · ' || h.shift_date,
                  'handoffs', h.id, v_extra);
  perform _audit(h.org_id, p_actor, 'handoff.submitted', 'handoffs', h.id, jsonb_build_object('snapshot_hash', v_hash));
  perform _enqueue(h.org_id, 'handoff.submitted', 'handoff.submitted:' || h.id,
    jsonb_build_object('handoff_id', h.id, 'status', h.status, 'site_id', h.site_id, 'area_id', h.area_id,
                       'shift_id', h.shift_id, 'shift_date', h.shift_date, 'from_user', h.from_user,
                       'to_user', h.to_user, 'submitted_at', h.submitted_at, 'snapshot_hash', v_hash));
  return h;
end $$;

create function save_handoff_draft(p_id uuid, p_org uuid, p_site uuid, p_area uuid, p_shift uuid,
                                   p_template uuid, p_date date, p_to_user uuid default null, p_responses jsonb default null)
returns handoffs language plpgsql security definer set search_path = public as $$
begin
  return core_save_draft(auth_uid_or_fail(), p_id, p_org, p_site, p_area, p_shift, p_template, p_date, p_to_user, p_responses);
end $$;

create function submit_handoff(p_id uuid, p_to_user uuid default null) returns handoffs
language plpgsql security definer set search_path = public as $$
begin
  return core_submit_handoff(auth_uid_or_fail(), p_id, p_to_user);
end $$;

create function receive_handoff(p_id uuid, p_decision text, p_notes text default null, p_ack jsonb default '{}')
returns handoff_receipts language plpgsql security definer set search_path = public as $$
declare u uuid := auth_uid_or_fail(); h handoffs; r handoff_receipts; v_role text; v_event text; v_hook text;
begin
  if p_decision not in ('accepted','accepted_with_observations','discrepancy','rejected') then
    raise exception 'invalid_decision';
  end if;
  select * into h from handoffs where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  v_role := member_role(h.org_id, u);
  if v_role is null then raise exception 'not_found'; end if;     -- no revelar existencia a otras empresas
  if h.status = 'draft' then raise exception 'not_submitted'; end if;
  select * into r from handoff_receipts where handoff_id = p_id;
  if found then return r; end if;                                  -- idempotente: doble clic / reintento
  if u = h.from_user then raise exception 'forbidden_self' using errcode = '42501'; end if;
  if h.to_user is not null and u <> h.to_user and v_role not in ('admin','supervisor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_decision <> 'accepted' and length(btrim(coalesce(p_notes, ''))) = 0 then
    raise exception 'justification_required';
  end if;

  insert into handoff_receipts (org_id, handoff_id, received_by, decision, notes, acknowledged)
  values (h.org_id, h.id, u, p_decision, nullif(btrim(coalesce(p_notes, '')), ''), coalesce(p_ack, '{}'))
  returning * into r;
  update handoffs set status = case p_decision when 'accepted' then 'accepted'
      when 'accepted_with_observations' then 'accepted_obs' when 'discrepancy' then 'disputed' else 'rejected' end
  where id = h.id;

  -- RECIBIR información ≠ ACEPTAR responsabilidad: sólo se registra "received"; el responsable no cambia.
  if p_decision <> 'rejected' then
    insert into issue_events (org_id, issue_id, actor, action, data)
    select h.org_id, (i->>'id')::uuid, u, 'received', jsonb_build_object('handoff_id', h.id, 'decision', p_decision)
    from jsonb_array_elements(coalesce(h.snapshot->'issues_created', '[]'::jsonb) || coalesce(h.snapshot->'issues_open', '[]'::jsonb)) i;
  end if;

  v_event := case p_decision when 'rejected' then 'handoff_rejected' when 'discrepancy' then 'handoff_discrepancy' else 'handoff_accepted' end;
  v_hook  := case p_decision when 'rejected' then 'handoff.rejected' when 'discrepancy' then 'handoff.disputed' else 'handoff.accepted' end;
  perform _notify(h.org_id, h.site_id, h.area_id, v_event,
                  case p_decision when 'rejected' then 'Entrega RECHAZADA' when 'discrepancy' then 'Entrega con DISCREPANCIA'
                       when 'accepted_with_observations' then 'Entrega aceptada con observaciones' else 'Entrega aceptada' end,
                  p_notes, 'handoffs', h.id, array[h.from_user]);
  perform _audit(h.org_id, u, 'handoff.' || p_decision, 'handoffs', h.id, jsonb_build_object('notes', p_notes));
  perform _enqueue(h.org_id, v_hook, v_hook || ':' || h.id,
    jsonb_build_object('handoff_id', h.id, 'decision', p_decision, 'received_by', u, 'received_at', r.received_at, 'notes', p_notes));
  return r;
end $$;

create function add_handoff_addendum(p_id uuid, p_body text) returns handoff_addenda
language plpgsql security definer set search_path = public as $$
declare u uuid := auth_uid_or_fail(); h handoffs; a handoff_addenda;
begin
  select * into h from handoffs where id = p_id;
  if not found or member_role(h.org_id, u) is null then raise exception 'not_found'; end if;
  if h.status = 'draft' then raise exception 'not_submitted'; end if;
  if u <> h.from_user and not is_manager(h.org_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into handoff_addenda (org_id, handoff_id, author, body) values (h.org_id, h.id, u, btrim(p_body)) returning * into a;
  perform _audit(h.org_id, u, 'handoff.addendum', 'handoffs', h.id, jsonb_build_object('addendum_id', a.id));
  return a;
end $$;

-- ───────────────────────── Pendientes / incidencias ─────────────────────────
create function core_create_issue(p_actor uuid, p_org uuid, p_site uuid, p_area uuid, p_title text, p_description text,
                                  p_category text, p_priority text, p_due date, p_external_ref text,
                                  p_handoff uuid default null, p_assignee uuid default null, p_id uuid default null)
returns issues language plpgsql security definer set search_path = public as $$
declare i issues; h handoffs; v_id uuid := coalesce(p_id, gen_random_uuid()); v_site uuid := p_site; v_area uuid := p_area;
begin
  if member_role(p_org, p_actor) is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into i from issues where id = v_id;
  if found then
    if i.org_id = p_org and i.created_by = p_actor then return i; end if;   -- reintento idempotente
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_handoff is not null then
    select * into h from handoffs where id = p_handoff and org_id = p_org;
    if not found then raise exception 'not_found'; end if;
    if h.from_user <> p_actor then raise exception 'forbidden' using errcode = '42501'; end if;
    if h.status <> 'draft' then raise exception 'handoff_locked' using errcode = '42501'; end if;
    v_site := h.site_id; v_area := h.area_id;
  end if;
  if not exists (select 1 from areas where id = v_area and org_id = p_org and site_id = v_site) then raise exception 'invalid_area'; end if;
  if p_assignee is not null and member_role(p_org, p_assignee) is null then raise exception 'invalid_assignee'; end if;

  insert into issues (id, org_id, site_id, area_id, title, description, category, priority, due_date, external_ref,
                      created_by, origin_handoff_id, assignee)
  values (v_id, p_org, v_site, v_area, btrim(p_title), p_description, coalesce(nullif(btrim(p_category), ''), 'pendiente'),
          coalesce(p_priority, 'medium'), p_due, p_external_ref, p_actor, p_handoff, p_assignee)
  returning * into i;
  insert into issue_events (org_id, issue_id, actor, action, data)
  values (p_org, i.id, p_actor, 'created', jsonb_build_object('handoff_id', p_handoff, 'priority', i.priority));
  perform _audit(p_org, p_actor, 'issue.created', 'issues', i.id, jsonb_build_object('title', i.title, 'priority', i.priority));
  perform _enqueue(p_org, 'issue.created', 'issue.created:' || i.id, _issue_json(i));
  if p_assignee is not null then
    insert into issue_events (org_id, issue_id, actor, action, data)
    values (p_org, i.id, p_actor, 'assigned', jsonb_build_object('from', null, 'to', p_assignee));
    perform _enqueue(p_org, 'issue.assigned', 'issue.assigned:' || i.id || ':' || p_assignee, _issue_json(i));
  end if;
  if i.priority = 'critical' then
    perform _notify(p_org, v_site, v_area, 'critical_issue', 'Pendiente CRÍTICO', i.title, 'issues', i.id,
                    case when p_assignee is null then '{}' else array[p_assignee] end);
  end if;
  return i;
end $$;

create function create_issue(p_org uuid, p_site uuid, p_area uuid, p_title text, p_description text default null,
                             p_category text default 'pendiente', p_priority text default 'medium', p_due date default null,
                             p_external_ref text default null, p_handoff uuid default null, p_assignee uuid default null,
                             p_id uuid default null)
returns issues language plpgsql security definer set search_path = public as $$
begin
  return core_create_issue(auth_uid_or_fail(), p_org, p_site, p_area, p_title, p_description, p_category, p_priority,
                           p_due, p_external_ref, p_handoff, p_assignee, p_id);
end $$;

create function set_issue_status(p_issue uuid, p_status text, p_note text default null) returns issues
language plpgsql security definer set search_path = public as $$
declare u uuid := auth_uid_or_fail(); i issues; v_role text; v_old text; v_ev uuid;
begin
  if p_status not in ('open','in_progress','blocked','resolved','cancelled') then raise exception 'invalid_status'; end if;
  select * into i from issues where id = p_issue for update;
  if not found then raise exception 'not_found'; end if;
  v_role := member_role(i.org_id, u);
  if v_role is null then raise exception 'not_found'; end if;
  if not (v_role in ('admin','supervisor') or i.assignee = u or i.assignee is null) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_old := i.status;
  if v_old = p_status then return i; end if;
  if v_old in ('resolved','cancelled') and v_role not in ('admin','supervisor') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status in ('resolved','cancelled','blocked') and length(btrim(coalesce(p_note, ''))) = 0 then
    raise exception 'justification_required';
  end if;
  update issues set status = p_status, updated_at = clock_timestamp(),
         resolved_by = case when p_status = 'resolved' then u end,
         resolved_at = case when p_status = 'resolved' then clock_timestamp() end,
         resolution_note = case when p_status = 'resolved' then btrim(p_note) end
  where id = i.id returning * into i;
  insert into issue_events (org_id, issue_id, actor, action, data)
  values (i.org_id, i.id, u,
          case when p_status = 'resolved' then 'resolved' when v_old in ('resolved','cancelled') then 'reopened' else 'status_changed' end,
          jsonb_build_object('from', v_old, 'to', p_status, 'note', p_note))
  returning id into v_ev;
  perform _audit(i.org_id, u, 'issue.' || p_status, 'issues', i.id, jsonb_build_object('from', v_old, 'note', p_note));
  if p_status = 'resolved' then
    perform _enqueue(i.org_id, 'issue.resolved', 'issue.resolved:' || v_ev, _issue_json(i));
  end if;
  return i;
end $$;

create function assign_issue(p_issue uuid, p_user uuid, p_note text default null) returns issues
language plpgsql security definer set search_path = public as $$
declare u uuid := auth_uid_or_fail(); i issues; v_role text; v_old uuid; v_ev uuid;
begin
  select * into i from issues where id = p_issue for update;
  if not found then raise exception 'not_found'; end if;
  v_role := member_role(i.org_id, u);
  if v_role is null then raise exception 'not_found'; end if;
  if not (v_role in ('admin','supervisor') or i.assignee = u) then raise exception 'forbidden' using errcode = '42501'; end if;
  if i.status in ('resolved','cancelled') then raise exception 'issue_closed'; end if;
  if p_user is not null and member_role(i.org_id, p_user) is null then raise exception 'invalid_assignee'; end if;
  v_old := i.assignee;
  if v_old is not distinct from p_user then return i; end if;
  update issues set assignee = p_user, updated_at = clock_timestamp() where id = i.id returning * into i;
  insert into issue_events (org_id, issue_id, actor, action, data)
  values (i.org_id, i.id, u, 'assigned', jsonb_build_object('from', v_old, 'to', p_user, 'note', p_note)) returning id into v_ev;
  perform _audit(i.org_id, u, 'issue.assigned', 'issues', i.id, jsonb_build_object('from', v_old, 'to', p_user, 'note', p_note));
  perform _enqueue(i.org_id, 'issue.assigned', 'issue.assigned:' || v_ev, _issue_json(i));
  if p_user is not null then
    perform _notify(i.org_id, i.site_id, i.area_id, 'issue_assigned', 'Pendiente asignado a ti', i.title, 'issues', i.id, array[p_user]);
  end if;
  return i;
end $$;

create function accept_issue_responsibility(p_issue uuid) returns issues
language plpgsql security definer set search_path = public as $$
declare u uuid := auth_uid_or_fail(); i issues; v_role text; v_old uuid; v_ev uuid;
begin
  select * into i from issues where id = p_issue for update;
  if not found then raise exception 'not_found'; end if;
  v_role := member_role(i.org_id, u);
  if v_role is null then raise exception 'not_found'; end if;
  if i.status in ('resolved','cancelled') then raise exception 'issue_closed'; end if;
  if i.assignee = u then return i; end if;
  if i.assignee is not null and v_role not in ('admin','supervisor') then raise exception 'forbidden' using errcode = '42501'; end if;
  v_old := i.assignee;
  update issues set assignee = u, updated_at = clock_timestamp() where id = i.id returning * into i;
  insert into issue_events (org_id, issue_id, actor, action, data)
  values (i.org_id, i.id, u, 'responsibility_accepted', jsonb_build_object('from', v_old, 'to', u)) returning id into v_ev;
  perform _audit(i.org_id, u, 'issue.responsibility_accepted', 'issues', i.id, jsonb_build_object('from', v_old));
  perform _enqueue(i.org_id, 'issue.assigned', 'issue.assigned:' || v_ev, _issue_json(i));
  return i;
end $$;

create function add_issue_note(p_issue uuid, p_note text) returns issue_events
language plpgsql security definer set search_path = public as $$
declare u uuid := auth_uid_or_fail(); i issues; e issue_events;
begin
  select * into i from issues where id = p_issue;
  if not found or member_role(i.org_id, u) is null then raise exception 'not_found'; end if;
  if length(btrim(coalesce(p_note, ''))) = 0 then raise exception 'justification_required'; end if;
  insert into issue_events (org_id, issue_id, actor, action, data)
  values (i.org_id, i.id, u, 'note', jsonb_build_object('note', btrim(p_note))) returning * into e;
  return e;
end $$;

-- ───────────────────────── Adjuntos ─────────────────────────
create function register_attachment(p_id uuid, p_org uuid, p_path text, p_entity_type text, p_entity_id uuid,
                                    p_mime text default null, p_size bigint default null)
returns attachments language plpgsql security definer set search_path = public as $$
declare u uuid := auth_uid_or_fail(); a attachments; h handoffs;
begin
  if member_role(p_org, u) is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if left(p_path, length(p_org::text) + 1) <> p_org::text || '/' then raise exception 'invalid_path'; end if;
  if p_entity_type = 'handoff' then
    select * into h from handoffs where id = p_entity_id and org_id = p_org;
    if not found then raise exception 'not_found'; end if;
    if h.from_user <> u then raise exception 'forbidden' using errcode = '42501'; end if;
    if h.status <> 'draft' then raise exception 'handoff_locked' using errcode = '42501'; end if;
  elsif p_entity_type = 'issue' then
    if not exists (select 1 from issues where id = p_entity_id and org_id = p_org) then raise exception 'not_found'; end if;
  else raise exception 'invalid_entity';
  end if;
  insert into attachments (id, org_id, path, entity_type, entity_id, uploaded_by, mime, size_bytes)
  values (p_id, p_org, p_path, p_entity_type, p_entity_id, u, p_mime, p_size)
  on conflict (path) do nothing;
  select * into a from attachments where path = p_path;
  if a.org_id <> p_org or a.uploaded_by <> u then raise exception 'forbidden' using errcode = '42501'; end if;
  return a;
end $$;

-- ───────────────────────── Resumen del supervisor ─────────────────────────
create function supervisor_summary(p_org uuid, p_from date default (current_date - 7), p_to date default current_date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_manager(p_org) then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object(
    'generated_at', clock_timestamp(), 'from', p_from, 'to', p_to,
    'handoffs', jsonb_build_object(
      'pending_receipt', (select count(*) from handoffs where org_id = p_org and status = 'pending_receipt'),
      'accepted', (select count(*) from handoffs where org_id = p_org and status = 'accepted' and shift_date between p_from and p_to),
      'accepted_obs', (select count(*) from handoffs where org_id = p_org and status = 'accepted_obs' and shift_date between p_from and p_to),
      'disputed', (select count(*) from handoffs where org_id = p_org and status = 'disputed' and shift_date between p_from and p_to),
      'rejected', (select count(*) from handoffs where org_id = p_org and status = 'rejected' and shift_date between p_from and p_to)),
    'issues', jsonb_build_object(
      'open', (select count(*) from issues where org_id = p_org and status in ('open','in_progress','blocked')),
      'critical', (select count(*) from issues where org_id = p_org and status in ('open','in_progress','blocked') and priority = 'critical'),
      'overdue', (select count(*) from issues where org_id = p_org and status in ('open','in_progress','blocked') and due_date < current_date),
      'unassigned', (select count(*) from issues where org_id = p_org and status in ('open','in_progress','blocked') and assignee is null),
      'blocked', (select count(*) from issues where org_id = p_org and status = 'blocked'),
      'created_in_range', (select count(*) from issues where org_id = p_org and created_at::date between p_from and p_to),
      'resolved_in_range', (select count(*) from issues where org_id = p_org and status = 'resolved' and resolved_at::date between p_from and p_to)),
    'pending_list', (select coalesce(jsonb_agg(x order by x->>'submitted_at'), '[]'::jsonb) from (
        select jsonb_build_object('id', h.id, 'area', a.name, 'site', s.name, 'shift', d.name, 'shift_date', h.shift_date,
               'from_name', m.display_name, 'submitted_at', h.submitted_at,
               'age_minutes', floor(extract(epoch from (clock_timestamp() - h.submitted_at)) / 60)) x
        from handoffs h join areas a on a.id = h.area_id join sites s on s.id = h.site_id
        join shift_definitions d on d.id = h.shift_id
        join organization_members m on m.org_id = h.org_id and m.user_id = h.from_user
        where h.org_id = p_org and h.status = 'pending_receipt' limit 20) q),
    'disputed_list', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('id', h.id, 'area', a.name, 'shift_date', h.shift_date, 'status', h.status, 'notes', r.notes) x
        from handoffs h join areas a on a.id = h.area_id join handoff_receipts r on r.handoff_id = h.id
        where h.org_id = p_org and h.status in ('disputed','rejected') and h.shift_date between p_from and p_to
        order by r.received_at desc limit 20) q),
    'critical_list', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select _issue_json(i) x from issues i where i.org_id = p_org and i.status in ('open','in_progress','blocked')
          and (i.priority = 'critical' or i.due_date < current_date or i.assignee is null)
        order by (i.priority = 'critical') desc, i.created_at limit 20) q),
    'resolved_list', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('id', i.id, 'title', i.title, 'resolved_at', i.resolved_at,
               'resolved_by', (select display_name from organization_members where org_id = i.org_id and user_id = i.resolved_by)) x
        from issues i where i.org_id = p_org and i.status = 'resolved' and i.resolved_at::date between p_from and p_to
        order by i.resolved_at desc limit 10) q),
    'recent_activity', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select jsonb_build_object('action', e.action, 'entity_type', e.entity_type, 'entity_id', e.entity_id,
               'at', e.created_at, 'actor', (select display_name from organization_members where org_id = e.org_id and user_id = e.actor)) x
        from audit_events e where e.org_id = p_org and e.entity_type in ('handoffs','issues')
        order by e.created_at desc limit 10) q)
  );
end $$;

-- ───────────────────────── Integraciones: API keys y webhooks ─────────────────────────
create function create_api_key(p_org uuid, p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare u uuid := auth_uid_or_fail(); k text;
begin
  if not is_admin(p_org) then raise exception 'forbidden' using errcode = '42501'; end if;
  k := 'hf_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into api_keys (org_id, name, prefix, key_hash, created_by)
  values (p_org, btrim(p_name), left(k, 8), encode(sha256(convert_to(k, 'UTF8')), 'hex'), u);
  perform _audit(p_org, u, 'api_key.created', 'api_keys', null, jsonb_build_object('name', p_name));
  return k;                                   -- única vez que se muestra en claro
end $$;

create function revoke_api_key(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare u uuid := auth_uid_or_fail(); k api_keys;
begin
  select * into k from api_keys where id = p_id;
  if not found or not is_admin(k.org_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  update api_keys set revoked_at = now() where id = p_id and revoked_at is null;
  perform _audit(k.org_id, u, 'api_key.revoked', 'api_keys', p_id, '{}');
end $$;

create function create_webhook(p_org uuid, p_url text, p_events text[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare u uuid := auth_uid_or_fail(); s webhook_subscriptions; v_secret text;
begin
  if not is_admin(p_org) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_events is null or cardinality(p_events) = 0 or not (p_events <@ array['handoff.created','handoff.submitted','handoff.accepted','handoff.disputed','handoff.rejected','issue.created','issue.assigned','issue.resolved']) then
    raise exception 'invalid_events';
  end if;
  v_secret := 'whsec_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  insert into webhook_subscriptions (org_id, url, secret, events, created_by) values (p_org, p_url, v_secret, p_events, u) returning * into s;
  perform _audit(p_org, u, 'webhook.created', 'webhook_subscriptions', s.id, jsonb_build_object('url', p_url, 'events', p_events));
  return jsonb_build_object('id', s.id, 'secret', v_secret);   -- el secreto se muestra una sola vez
end $$;

create function set_webhook_active(p_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid := auth_uid_or_fail(); s webhook_subscriptions;
begin
  select * into s from webhook_subscriptions where id = p_id;
  if not found or not is_admin(s.org_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  update webhook_subscriptions set active = p_active where id = p_id;
  perform _audit(s.org_id, u, 'webhook.active', 'webhook_subscriptions', p_id, jsonb_build_object('active', p_active));
end $$;

-- Sólo service_role (Edge Functions): autenticación de API y cola de webhooks
create function lookup_api_key(p_hash text) returns table (org_id uuid, actor uuid)
language sql stable security definer set search_path = public as $$
  select k.org_id, k.created_by from api_keys k
  where k.key_hash = p_hash and k.revoked_at is null and member_role(k.org_id, k.created_by) is not null
$$;

create function claim_webhook_deliveries(p_limit int default 20)
returns table (id uuid, url text, secret text, event_type text, event_key text, payload jsonb, attempts int)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with c as (
    select d.id from webhook_deliveries d where d.status = 'pending' and d.next_attempt_at <= now()
    order by d.next_attempt_at limit p_limit for update skip locked)
  update webhook_deliveries d set attempts = d.attempts + 1, next_attempt_at = now() + interval '2 minutes'  -- lease
  from c, webhook_subscriptions s
  where d.id = c.id and s.id = d.subscription_id and s.active
  returning d.id, s.url, s.secret, d.event_type, d.event_key, d.payload, d.attempts;
end $$;

create function finish_webhook_delivery(p_id uuid, p_ok boolean, p_code int, p_error text) returns void
language plpgsql security definer set search_path = public as $$
declare d webhook_deliveries;
begin
  select * into d from webhook_deliveries where id = p_id for update;
  if not found or d.status <> 'pending' then return; end if;
  if p_ok then
    update webhook_deliveries set status = 'delivered', delivered_at = now(), response_code = p_code, last_error = null where id = p_id;
  elsif d.attempts >= 6 then
    update webhook_deliveries set status = 'failed', response_code = p_code, last_error = left(p_error, 500) where id = p_id;
  else   -- reintento con retroceso exponencial: 1, 2, 4, 8, 16 min
    update webhook_deliveries set response_code = p_code, last_error = left(p_error, 500),
           next_attempt_at = now() + (power(2, d.attempts - 1) || ' minutes')::interval where id = p_id;
  end if;
end $$;

-- ───────────────────────── RLS ─────────────────────────
alter table organizations enable row level security;
alter table organization_members enable row level security;
alter table org_invites enable row level security;
alter table sites enable row level security;
alter table areas enable row level security;
alter table shift_definitions enable row level security;
alter table templates enable row level security;
alter table template_fields enable row level security;
alter table handoffs enable row level security;
alter table handoff_responses enable row level security;
alter table handoff_receipts enable row level security;
alter table handoff_addenda enable row level security;
alter table issues enable row level security;
alter table issue_events enable row level security;
alter table attachments enable row level security;
alter table notifications enable row level security;
alter table report_recipients enable row level security;
alter table audit_events enable row level security;
alter table api_keys enable row level security;
alter table webhook_subscriptions enable row level security;
alter table webhook_deliveries enable row level security;

create policy org_select on organizations for select to authenticated using (is_member(id));

do $$
declare t text;
begin
  foreach t in array array['organization_members','sites','areas','shift_definitions','templates','template_fields',
                           'handoff_receipts','handoff_addenda','issues','issue_events','report_recipients'] loop
    execute format('create policy %I on %I for select to authenticated using (is_member(org_id))', t || '_select', t);
  end loop;
  -- configuración: sólo admin escribe
  foreach t in array array['sites','areas','shift_definitions','templates','template_fields','report_recipients'] loop
    execute format('create policy %I on %I for insert to authenticated with check (is_admin(org_id))', t || '_ins', t);
    execute format('create policy %I on %I for update to authenticated using (is_admin(org_id)) with check (is_admin(org_id))', t || '_upd', t);
    execute format('create policy %I on %I for delete to authenticated using (is_admin(org_id))', t || '_del', t);
  end loop;
end $$;

create policy handoffs_select on handoffs for select to authenticated
  using (is_member(org_id) and (status <> 'draft' or from_user = auth.uid()));
create policy responses_select on handoff_responses for select to authenticated
  using (exists (select 1 from handoffs h where h.id = handoff_id));
create policy attachments_select on attachments for select to authenticated
  using (is_member(org_id) and (entity_type = 'issue' or exists (select 1 from handoffs h where h.id = entity_id)));
create policy notifications_select on notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy audit_select on audit_events for select to authenticated using (is_manager(org_id));
create policy invites_select on org_invites for select to authenticated using (is_admin(org_id));
create policy api_keys_select on api_keys for select to authenticated using (is_admin(org_id));
create policy webhooks_select on webhook_subscriptions for select to authenticated using (is_admin(org_id));
create policy deliveries_select on webhook_deliveries for select to authenticated using (is_admin(org_id));

-- ───────────────────────── Privilegios ─────────────────────────
revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant usage on schema public to authenticated, service_role;

grant select on organizations, organization_members, org_invites, sites, areas, shift_definitions, templates, template_fields,
  handoffs, handoff_responses, handoff_receipts, handoff_addenda, issues, issue_events, attachments, notifications,
  report_recipients, audit_events, webhook_deliveries to authenticated;
grant select (id, org_id, name, prefix, created_by, created_at, revoked_at) on api_keys to authenticated;
grant select (id, org_id, url, events, active, created_by, created_at) on webhook_subscriptions to authenticated;
grant insert, update, delete on sites, areas, shift_definitions, templates, template_fields, report_recipients to authenticated;
grant update (read_at) on notifications to authenticated;

grant execute on function member_role(uuid, uuid), is_member(uuid), is_manager(uuid), is_admin(uuid) to authenticated;
grant execute on function create_organization(text, text), create_invite(uuid, text), join_organization(text, text),
  set_member(uuid, uuid, text, boolean), save_handoff_draft(uuid, uuid, uuid, uuid, uuid, uuid, date, uuid, jsonb),
  submit_handoff(uuid, uuid), receive_handoff(uuid, text, text, jsonb), add_handoff_addendum(uuid, text),
  create_issue(uuid, uuid, uuid, text, text, text, text, date, text, uuid, uuid, uuid),
  set_issue_status(uuid, text, text), assign_issue(uuid, uuid, text), accept_issue_responsibility(uuid),
  add_issue_note(uuid, text), register_attachment(uuid, uuid, text, text, uuid, text, bigint),
  supervisor_summary(uuid, date, date), create_api_key(uuid, text), revoke_api_key(uuid),
  create_webhook(uuid, text, text[]), set_webhook_active(uuid, boolean) to authenticated;
grant execute on function core_save_draft(uuid, uuid, uuid, uuid, uuid, uuid, uuid, date, uuid, jsonb),
  core_submit_handoff(uuid, uuid, uuid),
  core_create_issue(uuid, uuid, uuid, uuid, text, text, text, text, date, text, uuid, uuid, uuid),
  lookup_api_key(text), claim_webhook_deliveries(int), finish_webhook_delivery(uuid, boolean, int, text) to service_role;
