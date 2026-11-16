-- Bucket privado para evidencias. Ruta obligatoria: {org_id}/{entidad}/{uuid}.{ext}
-- Sin política UPDATE/DELETE: las evidencias no se sobrescriben ni se borran desde el cliente.
insert into storage.buckets (id, name, public) values ('evidence', 'evidence', false)
on conflict (id) do update set public = false;

create policy evidence_select on storage.objects for select to authenticated
  using (bucket_id = 'evidence' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy evidence_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'evidence' and public.is_member(((storage.foldername(name))[1])::uuid));
