-- Borra los datos de prueba creados por tests/e2e/live.mjs (usuarios hf.e2e.* y sus empresas).
-- Los registros de historial son inmutables; esta limpieza desactiva los triggers sólo dentro de la transacción.
do $$
declare t text;
begin
  foreach t in array array['issue_events','audit_events','handoff_receipts','handoff_addenda','attachments','handoffs'] loop
    execute format('alter table public.%I disable trigger user', t);
  end loop;
  alter table public.handoff_responses disable trigger user;
  -- Nota: Supabase no permite borrar storage.objects por SQL; los archivos de prueba (14 bytes c/u) quedan huérfanos.
  delete from public.organizations where created_by in (select id from auth.users where email like 'hf.e2e.%');
  delete from auth.users where email like 'hf.e2e.%';
  foreach t in array array['issue_events','audit_events','handoff_receipts','handoff_addenda','attachments','handoffs'] loop
    execute format('alter table public.%I enable trigger user', t);
  end loop;
  alter table public.handoff_responses enable trigger user;
end $$;
