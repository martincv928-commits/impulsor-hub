-- QuoteFlow V0.4.2 — vencimiento de pago y plan de parcialidades.
-- Se ejecuta DESPUÉS de supabase/schema.sql, schema_v0.3.1.sql y schema_v0.4.sql,
-- en el mismo SQL Editor. Es aditivo: no borra ni toca datos existentes. Seguro
-- de volver a ejecutar.
--
-- Qué hace: agrega un plazo (en días) para saber cuándo vence el pago completo
-- de una cotización, y permite dividir el total en parcialidades programadas
-- (fecha de vencimiento + monto cada una) para dar seguimiento a si cada abono
-- llegó a tiempo.

alter table quotes add column if not exists payment_term_days int not null default 0;

create table if not exists quote_installments (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  due_at timestamptz not null,
  amount_cents bigint not null check (amount_cents > 0),
  created_at timestamptz not null default now()
);

alter table quote_installments enable row level security;

-- Mismo patrón de seguridad que quote_payments/quote_items.
drop policy if exists "parcialidades del negocio - ver" on quote_installments;
create policy "parcialidades del negocio - ver" on quote_installments for select
  using (is_member((select business_id from quotes where quotes.id = quote_id)));
drop policy if exists "parcialidades del negocio - crear" on quote_installments;
create policy "parcialidades del negocio - crear" on quote_installments for insert
  with check (is_active_member((select business_id from quotes where quotes.id = quote_id)));
drop policy if exists "parcialidades del negocio - editar" on quote_installments;
create policy "parcialidades del negocio - editar" on quote_installments for update
  using (is_active_member((select business_id from quotes where quotes.id = quote_id)))
  with check (is_active_member((select business_id from quotes where quotes.id = quote_id)));
drop policy if exists "parcialidades del negocio - borrar" on quote_installments;
create policy "parcialidades del negocio - borrar" on quote_installments for delete
  using (is_active_member((select business_id from quotes where quotes.id = quote_id)));
