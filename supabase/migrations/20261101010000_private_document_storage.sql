-- Phase 2: apply ONLY AFTER 20261101000000_initial_development.sql.
-- Existing tables and student application data are preserved.
-- This bucket stores development-only fictional scanned documents.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'picc-enrollment-documents', 'picc-enrollment-documents', false, 10485760,
  array['image/jpeg', 'image/png', 'application/pdf']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- All stored paths use <student-uid>/<application-uuid>/<random-uuid>.<extension>.
-- Storage RLS is enforced by PostgreSQL; do not make the bucket public.
create policy "PiCC students upload scans to their editable applications"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'picc-enrollment-documents'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and pg_catalog.array_length(storage.foldername(name), 1) = 2
  and storage.extension(name) in ('jpg', 'jpeg', 'png', 'pdf')
  and public.is_active_picc_student()
  and exists (
    select 1 from public.enrollment_applications a
    where a.id::text = (storage.foldername(name))[2]
      and a.student_id = (select auth.uid())
      and a.status in ('draft','needs_correction')
  )
);

create policy "PiCC owner or registrar reads eligible scans"
on storage.objects for select to authenticated
using (
  bucket_id = 'picc-enrollment-documents'
  and pg_catalog.array_length(storage.foldername(name), 1) = 2
  and exists (
    select 1 from public.enrollment_applications a
    where a.id::text = (storage.foldername(name))[2]
      and a.student_id::text = (storage.foldername(name))[1]
      and (
        (a.student_id = (select auth.uid()) and public.is_active_picc_student())
        or (a.status <> 'draft' and public.is_active_picc_registrar())
      )
  )
);

create policy "PiCC owner removes scans from editable applications"
on storage.objects for delete to authenticated
using (
  bucket_id = 'picc-enrollment-documents'
  and owner_id = (select auth.uid())::text
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and pg_catalog.array_length(storage.foldername(name), 1) = 2
  and public.is_active_picc_student()
  and exists (
    select 1 from public.enrollment_applications a
    where a.id::text = (storage.foldername(name))[2]
      and a.student_id = (select auth.uid())
      and a.status in ('draft','needs_correction')
  )
);

-- Do not allow browser overwrite/upsert. Each uploaded file gets a fresh UUID path.
-- The metadata RPC below verifies that the uploaded Storage object really exists
-- and belongs to the signed-in student. Clients cannot directly write the table.

create or replace function public.record_my_picc_document(
  p_application_id uuid,
  p_requirement_type text,
  p_storage_path text,
  p_original_filename text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_app public.enrollment_applications%rowtype;
  v_file storage.objects%rowtype;
  v_doc_id uuid;
  v_size bigint;
  v_mime text;
begin
  if not public.is_active_picc_student() then
    raise exception 'Active student account required' using errcode = '42501';
  end if;
  select * into v_app from public.enrollment_applications
   where id = p_application_id and student_id = auth.uid() for update;
  if not found or v_app.status not in ('draft','needs_correction') then
    raise exception 'Only your editable application can receive documents' using errcode = '42501';
  end if;
  if nullif(pg_catalog.btrim(coalesce(p_requirement_type,'')),'') is null
      or pg_catalog.length(p_requirement_type) > 200
      or nullif(pg_catalog.btrim(coalesce(p_original_filename,'')),'') is null
      or pg_catalog.length(p_original_filename) > 250 then
    raise exception 'Invalid document name or requirement';
  end if;
  if p_storage_path not like (auth.uid()::text || '/' || p_application_id::text || '/%')
      or pg_catalog.array_length(storage.foldername(p_storage_path), 1) <> 2
      or storage.extension(p_storage_path) not in ('jpg','jpeg','png','pdf') then
    raise exception 'Invalid document path' using errcode = '42501';
  end if;
  select * into v_file from storage.objects
    where bucket_id = 'picc-enrollment-documents' and name = p_storage_path;
  if not found or v_file.owner_id is distinct from auth.uid()::text then
    raise exception 'Uploaded scan not found or not owned by your account' using errcode = '42501';
  end if;
  v_size := coalesce((v_file.metadata->>'size')::bigint, 0);
  v_mime := coalesce(v_file.metadata->>'mimetype', '');
  if v_size < 1 or v_size > 10485760
    or v_mime not in ('image/jpeg','image/png','application/pdf') then
    raise exception 'Unsupported document type or size';
  end if;
  insert into public.application_documents (
    application_id, requirement_type, storage_path, original_filename, content_type, file_size
  ) values (
    p_application_id, p_requirement_type, p_storage_path, p_original_filename, v_mime, v_size
  )
  on conflict (application_id, requirement_type) do update set
    storage_path = excluded.storage_path,
    original_filename = excluded.original_filename,
    content_type = excluded.content_type,
    file_size = excluded.file_size,
    created_at = now()
  returning id into v_doc_id;
  return v_doc_id;
end;
$$;

create or replace function public.forget_my_picc_document(
  p_application_id uuid, p_requirement_type text
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_status text;
  v_path text;
begin
  if not public.is_active_picc_student() then
    raise exception 'Active student account required' using errcode = '42501';
  end if;
  select status into v_status from public.enrollment_applications
    where id = p_application_id and student_id = auth.uid() for update;
  if not found or v_status not in ('draft','needs_correction') then
    raise exception 'Application is not editable' using errcode = '42501';
  end if;
  delete from public.application_documents
    where application_id = p_application_id
      and requirement_type = p_requirement_type
    returning storage_path into v_path;
  return v_path;
end;
$$;

revoke all on function public.record_my_picc_document(uuid,text,text,text) from public, anon;
revoke all on function public.forget_my_picc_document(uuid,text) from public, anon;
grant execute on function public.record_my_picc_document(uuid,text,text,text),
  public.forget_my_picc_document(uuid,text) to authenticated;
