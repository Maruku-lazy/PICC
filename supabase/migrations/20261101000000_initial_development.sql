-- PiCC fresh-start DEVELOPMENT schema. Apply ONLY to a NEW/EMPTY dev Supabase project.
-- Do not run this against the previous PiCC 22-table system or a production database.
-- Account creation is controlled by Supabase Auth. Public roles are database-managed.

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role text not null default 'student' check (role in ('student','registrar')),
  account_status text not null default 'active' check (account_status in ('active','suspended')),
  created_at timestamptz not null default now()
);

create table public.enrollment_applications (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null unique references public.profiles(id) on delete cascade,
  form_data jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in ('draft','submitted','under_review','needs_correction','documents_verified')),
  reviewer_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.application_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.enrollment_applications(id) on delete cascade,
  requirement_type text not null,
  storage_path text not null,
  original_filename text not null,
  content_type text not null,
  file_size bigint not null check (file_size > 0),
  created_at timestamptz not null default now(),
  unique(application_id, requirement_type)
);

create table public.application_reviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.enrollment_applications(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id),
  decision text not null check (decision in ('under_review','needs_correction','documents_verified')),
  reviewer_note text not null default '',
  created_at timestamptz not null default now()
);

create table public.application_status_history (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.enrollment_applications(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  previous_status text,
  new_status text not null,
  changed_at timestamptz not null default now()
);

create index on public.enrollment_applications(status);
create index on public.application_documents(application_id);
create index on public.application_reviews(application_id, created_at desc);
create index on public.application_status_history(application_id, changed_at desc);

-- Minimal auto-created student profile. NEVER trust user metadata for staff roles.
create function public.handle_new_picc_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role, account_status)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 150),
    'student',
    'active'
  );
  return new;
end;
$$;

create trigger on_picc_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_picc_user();

-- A definer helper avoids recursive profile SELECT policies.
create function public.is_active_picc_registrar()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role = 'registrar'
      and account_status = 'active'
  );
$$;

create function public.is_active_picc_student()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role = 'student'
      and account_status = 'active'
  );
$$;

alter table public.profiles enable row level security;
alter table public.enrollment_applications enable row level security;
alter table public.application_documents enable row level security;
alter table public.application_reviews enable row level security;
alter table public.application_status_history enable row level security;

revoke all on public.profiles, public.enrollment_applications,
  public.application_documents, public.application_reviews,
  public.application_status_history from anon, authenticated;

grant select on public.profiles to authenticated;
grant select on public.enrollment_applications,
  public.application_documents, public.application_reviews,
  public.application_status_history to authenticated;

create policy "Own profile only" on public.profiles
  for select to authenticated using (id = (select auth.uid()));

create policy "Own application or registrar review" on public.enrollment_applications
  for select to authenticated
  using ((student_id = (select auth.uid()) and public.is_active_picc_student())
      or public.is_active_picc_registrar());

create policy "Own document metadata or registrar" on public.application_documents
  for select to authenticated
  using (exists (
      select 1 from public.enrollment_applications a
      where a.id = application_id and
        ((a.student_id = (select auth.uid()) and public.is_active_picc_student())
        or public.is_active_picc_registrar())
  ));

create policy "Own reviews or registrar" on public.application_reviews
  for select to authenticated
  using (exists (
      select 1 from public.enrollment_applications a
      where a.id = application_id and
        ((a.student_id = (select auth.uid()) and public.is_active_picc_student())
        or public.is_active_picc_registrar())
  ));

create policy "Own history or registrar" on public.application_status_history
  for select to authenticated
  using (exists (
      select 1 from public.enrollment_applications a
      where a.id = application_id and
        ((a.student_id = (select auth.uid()) and public.is_active_picc_student())
        or public.is_active_picc_registrar())
  ));

-- Record all application-status changes, including initial draft/submission.
create function public.log_picc_application_status()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.application_status_history (application_id, actor_id, previous_status, new_status)
    values (new.id, auth.uid(), null, new.status);
  elsif old.status is distinct from new.status then
    insert into public.application_status_history (
      application_id, actor_id, previous_status, new_status
    ) values (
      new.id, auth.uid(), old.status, new.status
    );
  end if;
  return new;
end;
$$;

create trigger picc_application_status_changed
  after insert or update of status on public.enrollment_applications
  for each row execute function public.log_picc_application_status();

-- Only these RPCs can write enrollment records; no direct client UPDATE/INSERT grants.
create function public.save_my_picc_application(p_form jsonb, p_submit boolean)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
  v_payload jsonb;
begin
  if not public.is_active_picc_student() then
    raise exception 'Active student account required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_form) is distinct from 'object'
     or pg_catalog.octet_length(p_form::text) > 65536 then
    raise exception 'Invalid application data';
  end if;
  if p_submit and (
    nullif(pg_catalog.btrim(p_form->>'firstName'), '') is null or
    nullif(pg_catalog.btrim(p_form->>'lastName'), '') is null or
    nullif(pg_catalog.btrim(p_form->>'program'), '') is null or
    nullif(pg_catalog.btrim(p_form->>'academicYear'), '') is null or
    coalesce(p_form->>'declarationConfirmed', 'false') <> 'true'
  ) then
    raise exception 'Required application fields are incomplete';
  end if;

  -- Never store selected filenames as if actual documents had been uploaded.
  v_payload := p_form - 'documentUploads';

  insert into public.enrollment_applications (student_id, form_data, status)
  values (auth.uid(), v_payload, case when p_submit then 'submitted' else 'draft' end)
  on conflict (student_id) do update
    set form_data = excluded.form_data,
        status = excluded.status,
        reviewer_note = '',
        updated_at = now()
    where public.enrollment_applications.status in ('draft','needs_correction')
  returning id into v_id;

  if v_id is null then
    raise exception 'Application is locked during registrar review' using errcode = '42501';
  end if;
  return v_id;
end;
$$;

create function public.registrar_change_picc_status(
  p_application_id uuid, p_status text, p_note text default ''
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_previous text;
begin
  if not public.is_active_picc_registrar() then
    raise exception 'Active registrar account required' using errcode = '42501';
  end if;
  select status into v_previous
    from public.enrollment_applications
    where id = p_application_id
    for update;
  if not found then raise exception 'Application not found'; end if;
  if not (
    (v_previous = 'submitted' and p_status in ('under_review','needs_correction'))
    or (v_previous = 'under_review' and p_status in ('needs_correction','documents_verified'))
  ) then
    raise exception 'Invalid application status transition' using errcode = '42501';
  end if;
  if pg_catalog.length(coalesce(p_note,'')) > 2000 then
    raise exception 'Registrar note too long';
  end if;
  if p_status = 'needs_correction' and nullif(pg_catalog.btrim(p_note),'') is null then
    raise exception 'Correction requests require a reason';
  end if;

  update public.enrollment_applications
    set status = p_status, reviewer_note = coalesce(p_note,''), updated_at = now()
    where id = p_application_id;
  insert into public.application_reviews(application_id,reviewer_id,decision,reviewer_note)
    values (p_application_id, auth.uid(), p_status, coalesce(p_note,''));
end;
$$;

revoke all on function public.handle_new_picc_user() from public;
revoke all on function public.log_picc_application_status() from public;
revoke all on function public.is_active_picc_registrar() from public, anon;
revoke all on function public.is_active_picc_student() from public, anon;
revoke all on function public.save_my_picc_application(jsonb, boolean) from public, anon;
revoke all on function public.registrar_change_picc_status(uuid,text,text) from public, anon;
grant execute on function public.is_active_picc_registrar(), public.is_active_picc_student(),
  public.save_my_picc_application(jsonb, boolean),
  public.registrar_change_picc_status(uuid,text,text) to authenticated;

-- NO UPDATE or INSERT policies for app/documents: frontends cannot bypass RPC checks.
-- Private file bucket and upload policies will be added in Phase 2.
