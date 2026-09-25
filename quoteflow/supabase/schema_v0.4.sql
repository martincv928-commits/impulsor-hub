-- QuoteFlow V0.4 — seguimiento de pagos (sin pasarela de cobro en línea y sin
-- facturación/CFDI: eso queda fuera de este alcance).
-- Se ejecuta DESPUÉS de supabase/schema.sql y supabase/schema_v0.3.1.sql, en el
-- mismo SQL Editor. Es aditivo: no borra ni toca datos existentes. Seguro de
-- volver a ejecutar.
--
-- Qué hace: permite registrar abonos/pagos recibidos por una cotización ya
-- generada, para saber cuánto se ha cobrado y cuánto falta. Es un registro
-- manual ("me pagaron $X, en tal fecha, por tal medio"): no cobra nada en
-- línea ni emite comprobante fiscal.

create table if not exists quote_payments (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  method text not null default 'efectivo' check (method in ('efectivo', 'transferencia', 'tarjeta', 'otro')),
  note text not null default '',
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table quote_payments enable row level security;

-- Mismo patrón de seguridad que quote_items: se puede VER si eres miembro del
-- negocio (aunque esté suspendido, para no ocultarte tu propio historial), y
-- solo se puede CREAR/EDITAR/BORRAR si el negocio y tu membresía están activos.
drop policy if exists "pagos del negocio - ver" on quote_payments;
create policy "pagos del negocio - ver" on quote_payments for select
  using (is_member((select business_id from quotes where quotes.id = quote_id)));
drop policy if exists "pagos del negocio - crear" on quote_payments;
create policy "pagos del negocio - crear" on quote_payments for insert
  with check (is_active_member((select business_id from quotes where quotes.id = quote_id)));
drop policy if exists "pagos del negocio - editar" on quote_payments;
create policy "pagos del negocio - editar" on quote_payments for update
  using (is_active_member((select business_id from quotes where quotes.id = quote_id)))
  with check (is_active_member((select business_id from quotes where quotes.id = quote_id)));
drop policy if exists "pagos del negocio - borrar" on quote_payments;
create policy "pagos del negocio - borrar" on quote_payments for delete
  using (is_active_member((select business_id from quotes where quotes.id = quote_id)));
