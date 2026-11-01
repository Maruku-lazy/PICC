-- PiCC Phase 3.3: Registrar-only, append-only OCR screening history.
-- Apply AFTER 20261101010000_private_document_storage.sql to the existing
-- PiCC fresh-start DEVELOPMENT project. Does not delete or modify existing data.
-- Important: OCR in this version runs in the Registrar's browser. These are
-- registrar-saved CLIENT-GENERATED suggestions, not trusted server OCR or approvals.

create table if not exists public.document_screenings (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.enrollment_applications(id) on delete cascade,
  -- Preserve the record even if a student replaces/removes the original document.
  document_id uuid references public.application_documents(id) on delete set null,
  requirement_type text not null,
  storage_path_snapshot text not null,
  engine text not null default 'tesseract.js + rules-v1',
  result jsonb not null,
  matched_count integer not null default 0 check (matched_count >= 0),
  mismatch_count integer not null default 0 check (mismatch_count >= 0),
  needs_review_count integer not null default 0 check (needs_review_count >= 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.document_screening_reviews (
  id uuid primary key default gen_random_uuid(),
  screening_id uuid not null references public.document_screenings(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id),
  decision text not null check (decision in (
    'no_discrepancy_observed', 'discrepancy_confirmed', 'inconclusive'
  )),
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists document_screenings_lookup_idx
  on public.document_screenings(application_id, requirement_type, created_at desc);
create index if not exists document_screening_reviews_lookup_idx
  on public.document_screening_reviews(screening_id, created_at desc);

alter table public.document_screenings enable row level security;
alter table public.document_screening_reviews enable row level security;

revoke all on public.document_screenings, public.document_screening_reviews
  from anon, authenticated;
grant select on public.document_screenings, public.document_screening_reviews
  to authenticated;

create policy "Active registrar reads screening history"
  on public.document_screenings for select to authenticated
  using (public.is_active_picc_registrar());

create policy "Active registrar reads review history"
  on public.document_screening_reviews for select to authenticated
  using (public.is_active_picc_registrar());

-- Only a trusted-role RPC may create a screening. Direct browser writes are not granted.
create function public.save_picc_document_screening(
  p_document_id uuid,
  p_storage_path text,
  p_result jsonb
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_application_id uuid;
  v_requirement_type text;
  v_status text;
  v_current_path text;
  v_id uuid;
  v_matched integer;
  v_mismatch integer;
  v_review integer;
begin
  if not public.is_active_picc_registrar() then
    raise exception 'Active Registrar account required' using errcode = '42501';
  end if;
  select d.application_id, d.requirement_type, a.status, d.storage_path
    into v_application_id, v_requirement_type, v_status, v_current_path
    from public.application_documents d
    join public.enrollment_applications a on a.id = d.application_id
    where d.id = p_document_id
    for update of d;
  if not found or v_status not in ('submitted','under_review') then
    raise exception 'A submitted application and current document are required'
      using errcode = '42501';
  end if;
  if p_storage_path is distinct from v_current_path then
    raise exception 'The uploaded document has changed; reopen its preview'
      using errcode = '42501';
  end if;
  if p_result is null or pg_catalog.jsonb_typeof(p_result) <> 'object'
      or pg_catalog.octet_length(p_result::text) > 16384
      or pg_catalog.jsonb_typeof(p_result->'findings') <> 'array'
      or pg_catalog.jsonb_typeof(p_result->'notes') <> 'array'
      or p_result->>'requirementType' is distinct from v_requirement_type then
    raise exception 'Invalid or mismatched screening result';
  end if;
  if pg_catalog.jsonb_array_length(p_result->'findings') not between 1 and 3
      or pg_catalog.jsonb_array_length(p_result->'notes') > 8 then
    raise exception 'Unexpected screening result length';
  end if;
  -- Validate the stored field structure and status vocabulary, without trusting
  -- browser-provided count totals. Names, dates, etc. remain preliminary data.
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_result->'findings') as e(value)
    where pg_catalog.jsonb_typeof(e.value) <> 'object'
      or e.value->>'field' not in ('fullName','birthDate','sex')
      or e.value->>'status' not in ('matched','possible_mismatch','needs_review')
      or e.value->>'label' is null
      or e.value->>'expected' is null
      or e.value->>'explanation' is null
      or pg_catalog.length(coalesce(e.value->>'label','')) > 100
      or pg_catalog.length(coalesce(e.value->>'expected','')) > 300
      or pg_catalog.length(coalesce(e.value->>'extracted','')) > 500
      or pg_catalog.length(coalesce(e.value->>'explanation','')) > 600
  ) then
    raise exception 'Invalid screening finding';
  end if;
  select
    count(*) filter (where e.value->>'status' = 'matched'),
    count(*) filter (where e.value->>'status' = 'possible_mismatch'),
    count(*) filter (where e.value->>'status' = 'needs_review')
    into v_matched, v_mismatch, v_review
    from pg_catalog.jsonb_array_elements(p_result->'findings') as e(value);
  if v_matched + v_mismatch + v_review
       <> pg_catalog.jsonb_array_length(p_result->'findings') then
    raise exception 'Invalid screening statuses';
  end if;
  if p_result->>'matchedCount' is distinct from v_matched::text
      or p_result->>'mismatchCount' is distinct from v_mismatch::text
      or p_result->>'needsReviewCount' is distinct from v_review::text then
    raise exception 'Screening summary does not match the findings';
  end if;
  if (select count(distinct e.value->>'field')
        from pg_catalog.jsonb_array_elements(p_result->'findings') as e(value))
       <> pg_catalog.jsonb_array_length(p_result->'findings') then
    raise exception 'Repeated field in screening result';
  end if;
  -- Use computed counts; the browser cannot determine persisted summary counts.
  insert into public.document_screenings (
    application_id, document_id, requirement_type, storage_path_snapshot,
    engine, result, matched_count, mismatch_count, needs_review_count, created_by
  ) values (
    v_application_id, p_document_id, v_requirement_type, v_current_path,
    'tesseract.js + rules-v1', p_result,
    v_matched, v_mismatch, v_review, auth.uid()
  ) returning id into v_id;
  return v_id;
end;
$$;

-- Each Registrar review is an INSERT (audit record), not an UPDATE.
create function public.review_picc_document_screening(
  p_screening_id uuid,
  p_decision text,
  p_note text default ''
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_path text;
  v_current_path text;
  v_application_status text;
  v_id uuid;
begin
  if not public.is_active_picc_registrar() then
    raise exception 'Active Registrar account required' using errcode = '42501';
  end if;
  if p_decision not in ('no_discrepancy_observed','discrepancy_confirmed','inconclusive') then
    raise exception 'Invalid review decision';
  end if;
  if pg_catalog.length(coalesce(p_note,'')) > 2000 then
    raise exception 'Review note exceeds 2000 characters';
  end if;
  if p_decision = 'discrepancy_confirmed'
      and nullif(pg_catalog.btrim(coalesce(p_note,'')), '') is null then
    raise exception 'Describe the discrepancy in the review note';
  end if;
  select s.storage_path_snapshot, d.storage_path, a.status
    into v_path, v_current_path, v_application_status
    from public.document_screenings s
    join public.enrollment_applications a on a.id = s.application_id
    left join public.application_documents d on d.id = s.document_id
    where s.id = p_screening_id;
  if not found or v_current_path is distinct from v_path
      or v_application_status not in ('submitted','under_review') then
    raise exception 'Screening is no longer current/reviewable'
      using errcode = '42501';
  end if;
  insert into public.document_screening_reviews (screening_id, reviewer_id, decision, note)
    values (p_screening_id, auth.uid(), p_decision, coalesce(p_note,''))
    returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.save_picc_document_screening(uuid,text,jsonb)
  from public, anon, authenticated;
revoke all on function public.review_picc_document_screening(uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.save_picc_document_screening(uuid,text,jsonb),
  public.review_picc_document_screening(uuid,text,text) to authenticated;

-- Do not allow application status changes through these RPCs. Screenings are
-- advisory only; existing registrar_change_picc_status handles app workflow.
-- Do not store raw OCR text: only compact comparisons are persisted.
