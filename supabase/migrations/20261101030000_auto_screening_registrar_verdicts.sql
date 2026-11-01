-- Phase 3.5: student-initiated automatic browser OCR after upload, Registrar per-document verdicts.
-- Run ONCE after Phase 3.3 screening history. Never expose service-role keys to the frontend.
-- Browser OCR results are UNTRUSTED preliminary suggestions, not server-verified OCR.

alter table public.application_documents
  add column if not exists auto_screen_status text not null default 'pending';
alter table public.application_documents
  add column if not exists auto_screen_error text not null default '';

do $$ begin
  alter table public.application_documents add constraint picc_auto_screen_status_check
    check (auto_screen_status in ('pending','complete','failed','manual'));
exception when duplicate_object then null; end $$;

-- Reset a previous screening whenever the underlying image is replaced.
create or replace function public.picc_reset_document_scan()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.storage_path is distinct from old.storage_path then
    new.auto_screen_status := case when new.requirement_type = '2×2 ID photo (white background)'
      or new.content_type not in ('image/jpeg','image/png') then 'manual' else 'pending' end;
    new.auto_screen_error := '';
  end if;
  return new;
end; $$;
drop trigger if exists picc_document_scan_reset on public.application_documents;
create trigger picc_document_scan_reset before insert or update of storage_path
  on public.application_documents for each row execute function public.picc_reset_document_scan();

-- Existing historical uploads haven't undergone automatic student-side screening.
update public.application_documents
  set auto_screen_status = case when requirement_type = '2×2 ID photo (white background)'
    or content_type not in ('image/jpeg','image/png') then 'manual' else 'pending' end,
    auto_screen_error = '';

-- When a student edits comparison-relevant information, prior auto OCR becomes stale.
create or replace function public.picc_invalidate_screening_on_form_edit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (old.form_data->>'firstName', old.form_data->>'middleName', old.form_data->>'lastName',
      old.form_data->>'suffix', old.form_data->>'birthDate', old.form_data->>'sex')
      is distinct from
     (new.form_data->>'firstName', new.form_data->>'middleName', new.form_data->>'lastName',
      new.form_data->>'suffix', new.form_data->>'birthDate', new.form_data->>'sex') then
    update public.application_documents
       set auto_screen_status = 'pending', auto_screen_error = ''
     where application_id = new.id and content_type in ('image/jpeg','image/png')
       and requirement_type <> '2×2 ID photo (white background)';
    -- Preserve historical verdicts, but do not treat them as current after field edits.
    update public.document_verdicts set superseded_at = now()
      where application_id = new.id and superseded_at is null;
  end if;
  return new;
end; $$;
drop trigger if exists picc_form_invalidate_scan on public.enrollment_applications;
create trigger picc_form_invalidate_scan after update of form_data
  on public.enrollment_applications for each row execute function public.picc_invalidate_screening_on_form_edit();

-- Attach provenance to saved screenings. Historical registrar results keep registrar_manual.
alter table public.document_screenings
  add column if not exists origin text not null default 'registrar_manual';
do $$ begin
  alter table public.document_screenings add constraint picc_screening_origin_check
    check (origin in ('registrar_manual','student_browser_auto'));
exception when duplicate_object then null; end $$;

-- Student may submit preliminary comparison ONLY for OWN current editable document.
-- Structure, counts, current path, and status are checked; OCR correctness is NOT attested.
create or replace function public.save_my_picc_auto_screening(
  p_document_id uuid, p_storage_path text, p_result jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_doc public.application_documents%rowtype;
  v_student uuid;
  v_status text;
  v_id uuid;
  v_matched integer;
  v_mismatch integer;
  v_review integer;
begin
  if not public.is_active_picc_student() then
    raise exception 'Only active students may record preliminary auto-screening' using errcode = '42501';
  end if;
  select * into v_doc from public.application_documents where id = p_document_id for update;
  if not found or v_doc.storage_path is distinct from p_storage_path
      or v_doc.auto_screen_status not in ('pending','failed')
      or v_doc.content_type not in ('image/jpeg','image/png') then
    raise exception 'Current image required; reopen the document' using errcode = '42501';
  end if;
  select a.student_id, a.status into v_student, v_status from public.enrollment_applications a
    where a.id = v_doc.application_id;
  if v_student is distinct from auth.uid() or v_status not in ('draft','needs_correction') then
    raise exception 'Only your editable application may be automatically screened' using errcode = '42501';
  end if;
  if p_result is null or pg_catalog.jsonb_typeof(p_result) <> 'object'
      or pg_catalog.octet_length(p_result::text) > 16384
      or pg_catalog.jsonb_typeof(p_result->'findings') <> 'array'
      or pg_catalog.jsonb_typeof(p_result->'notes') <> 'array'
      or p_result->>'requirementType' is distinct from v_doc.requirement_type
      or pg_catalog.jsonb_array_length(p_result->'findings') not between 1 and 3
      or pg_catalog.jsonb_array_length(p_result->'notes') > 8 then
    raise exception 'Malformed automatic screening result';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_result->'findings') as e(value)
    where pg_catalog.jsonb_typeof(e.value) <> 'object'
      or e.value->>'field' not in ('fullName','birthDate','sex')
      or e.value->>'status' not in ('matched','possible_mismatch','needs_review')
      or e.value->>'label' is null or e.value->>'expected' is null
      or e.value->>'explanation' is null
      or pg_catalog.length(coalesce(e.value->>'label','')) > 100
      or pg_catalog.length(coalesce(e.value->>'expected','')) > 300
      or pg_catalog.length(coalesce(e.value->>'extracted','')) > 500
      or pg_catalog.length(coalesce(e.value->>'explanation','')) > 600
  ) then raise exception 'Invalid automatic screening finding'; end if;
  select count(*) filter (where e.value->>'status' = 'matched'),
         count(*) filter (where e.value->>'status' = 'possible_mismatch'),
         count(*) filter (where e.value->>'status' = 'needs_review')
    into v_matched, v_mismatch, v_review
  from pg_catalog.jsonb_array_elements(p_result->'findings') as e(value);
  if v_matched+v_mismatch+v_review <> pg_catalog.jsonb_array_length(p_result->'findings')
    or p_result->>'matchedCount' is distinct from v_matched::text
    or p_result->>'mismatchCount' is distinct from v_mismatch::text
    or p_result->>'needsReviewCount' is distinct from v_review::text
    or (select count(distinct e.value->>'field') from pg_catalog.jsonb_array_elements(p_result->'findings') as e(value))
       <> pg_catalog.jsonb_array_length(p_result->'findings') then
    raise exception 'Invalid automatic screening counts/fields';
  end if;
  insert into public.document_screenings
    (application_id,document_id,requirement_type,storage_path_snapshot,engine,result,
     matched_count,mismatch_count,needs_review_count,created_by,origin)
  values (v_doc.application_id, v_doc.id, v_doc.requirement_type, v_doc.storage_path,
          'tesseract.js + rules-v1 (student browser; preliminary)',p_result,
          v_matched,v_mismatch,v_review,auth.uid(),'student_browser_auto')
  returning id into v_id;
  update public.application_documents set auto_screen_status = 'complete', auto_screen_error = ''
    where id = v_doc.id;
  return v_id;
end; $$;

create or replace function public.fail_my_picc_auto_screening(
  p_document_id uuid, p_storage_path text, p_error text default ''
) returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_active_picc_student() then raise exception 'Student account required' using errcode = '42501'; end if;
  select d.id into v_id from public.application_documents d
    join public.enrollment_applications a on a.id = d.application_id
    where d.id = p_document_id and d.storage_path = p_storage_path
      and a.student_id = auth.uid() and a.status in ('draft','needs_correction')
      and d.auto_screen_status in ('pending','failed')
    for update of d;
  if v_id is null then raise exception 'Document is no longer editable/current' using errcode = '42501'; end if;
  update public.application_documents
    set auto_screen_status='failed', auto_screen_error=left(coalesce(p_error,''),250) where id=v_id;
end; $$;

-- Registrar final PASS/FAIL/MANUAL FOLLOW-UP for each DOCUMENT, not application status.
create table if not exists public.document_verdicts (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.enrollment_applications(id) on delete cascade,
  document_id uuid references public.application_documents(id) on delete set null,
  requirement_type text not null,
  storage_path_snapshot text not null,
  decision text not null check (decision in ('passed','failed','needs_followup')),
  note text not null default '',
  reviewer_id uuid not null references public.profiles(id),
  superseded_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists picc_verdicts_by_app on public.document_verdicts(application_id,created_at desc);
alter table public.document_verdicts enable row level security;
revoke all on public.document_verdicts from anon,authenticated;
grant select on public.document_verdicts to authenticated;
create policy "Active registrar reads document verdicts" on public.document_verdicts
  for select to authenticated using (public.is_active_picc_registrar());

create or replace function public.record_picc_document_verdict(
  p_document_id uuid, p_storage_path text, p_decision text, p_note text default ''
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_doc public.application_documents%rowtype; v_status text; v_id uuid;
begin
  if not public.is_active_picc_registrar() then
    raise exception 'Active Registrar account required' using errcode = '42501';
  end if;
  if p_decision not in ('passed','failed','needs_followup') then
    raise exception 'Invalid document verdict';
  end if;
  if pg_catalog.length(coalesce(p_note,'')) > 2000
     or (p_decision in ('failed','needs_followup') and nullif(pg_catalog.btrim(coalesce(p_note,'')),'') is null) then
    raise exception 'Provide a note explaining failed/needs-follow-up documents (max 2000 characters)';
  end if;
  select * into v_doc from public.application_documents where id=p_document_id for update;
  if not found or v_doc.storage_path is distinct from p_storage_path then
    raise exception 'Uploaded document has changed; refresh overview' using errcode='42501';
  end if;
  select status into v_status from public.enrollment_applications where id=v_doc.application_id;
  if v_status not in ('submitted','under_review') then
    raise exception 'Application must be submitted or under review' using errcode='42501';
  end if;
  insert into public.document_verdicts
    (application_id,document_id,requirement_type,storage_path_snapshot,decision,note,reviewer_id)
  values (v_doc.application_id,v_doc.id,v_doc.requirement_type,v_doc.storage_path,p_decision,
          coalesce(p_note,''),auth.uid()) returning id into v_id;
  return v_id;
end; $$;

revoke all on function public.save_my_picc_auto_screening(uuid,text,jsonb),
  public.fail_my_picc_auto_screening(uuid,text,text),
  public.record_picc_document_verdict(uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function public.save_my_picc_auto_screening(uuid,text,jsonb),
  public.fail_my_picc_auto_screening(uuid,text,text),
  public.record_picc_document_verdict(uuid,text,text,text) to authenticated;

-- The Registrar's existing manual OCR RPC remains unchanged; both sources
-- are suggestions. All final document decisions are recorded in document_verdicts.
