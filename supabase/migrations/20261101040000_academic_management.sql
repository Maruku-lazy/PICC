-- PiCC Phase 4.1: Academic catalog and scheduling. DEV project only.
-- Apply AFTER the prior Phase 1-3.5 migrations; this file does not modify student applications.
-- Row-level security: active students and registrars may read catalog data; only active
-- registrars may create or modify. We intentionally grant NO DELETE (archive via active=false).

begin;

create table if not exists public.picc_academic_terms (
  id uuid primary key default gen_random_uuid(),
  academic_year text not null check (academic_year ~ '^20[0-9]{2}-20[0-9]{2}$'
    and substring(academic_year, 6, 4)::int = substring(academic_year, 1, 4)::int + 1),
  semester text not null check (semester in ('1st','2nd','summer')),
  start_date date,
  end_date date,
  is_current boolean not null default false,
  enrollment_open boolean not null default false,
  created_at timestamptz not null default now(),
  unique (academic_year, semester),
  check (start_date is null or end_date is null or start_date <= end_date)
);
create unique index if not exists picc_one_current_term
  on public.picc_academic_terms(is_current) where is_current = true;

create table if not exists public.picc_academic_programs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (length(btrim(code)) between 2 and 24),
  name text not null unique check (length(btrim(name)) between 4 and 180),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- The four established PiCC form choices; no courses or curricula are invented.
insert into public.picc_academic_programs(code,name) values
  ('BSCrim','BS Criminology'),
  ('BTLEd-ICT','BTLEd – Information and Communication Technology'),
  ('BSESS-FSM','BSESS – Fitness and Sports Management'),
  ('BSESS-FSC','BSESS – Fitness and Sports Coaching')
on conflict (code) do nothing;

create table if not exists public.picc_academic_courses (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.picc_academic_programs(id) on delete restrict,
  course_code text not null check (length(btrim(course_code)) between 2 and 24),
  title text not null check (length(btrim(title)) between 3 and 200),
  units numeric(4,1) not null check (units > 0 and units <= 30),
  recommended_year smallint not null check (recommended_year between 1 and 5),
  recommended_semester text not null check (recommended_semester in ('1st','2nd','summer')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (program_id, course_code),
  unique (id, program_id)
);

create table if not exists public.picc_class_sections (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.picc_academic_terms(id) on delete restrict,
  program_id uuid not null references public.picc_academic_programs(id) on delete restrict,
  year_level smallint not null check (year_level between 1 and 5),
  section_name text not null check (length(btrim(section_name)) between 1 and 40),
  capacity integer not null check (capacity between 1 and 500),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (term_id, program_id, year_level, section_name),
  unique (id, program_id)
);

create table if not exists public.picc_course_offerings (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.picc_class_sections(id) on delete restrict,
  program_id uuid not null references public.picc_academic_programs(id) on delete restrict,
  course_id uuid not null,
  instructor_name text not null default '' check (length(instructor_name) <= 160),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (section_id,program_id) references public.picc_class_sections(id,program_id),
  foreign key (course_id,program_id) references public.picc_academic_courses(id,program_id),
  unique (section_id, course_id)
);

create table if not exists public.picc_class_meetings (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references public.picc_course_offerings(id) on delete restrict,
  weekday smallint not null check (weekday between 1 and 7), -- 1=Mon, 7=Sun
  start_time time not null,
  end_time time not null,
  room text not null default '' check (length(room) <= 90),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (start_time < end_time),
  unique (offering_id,weekday,start_time)
);

create index if not exists picc_courses_by_program on public.picc_academic_courses(program_id);
create index if not exists picc_sections_by_term on public.picc_class_sections(term_id);
create index if not exists picc_offerings_by_section on public.picc_course_offerings(section_id);
create index if not exists picc_meetings_by_offering on public.picc_class_meetings(offering_id);

-- Avoid obvious overlapping meetings within a section, a named room, or a named instructor.
-- This is a first scheduling safeguard; instructor records and complex cross-campus constraints
-- will require a dedicated staff module later.
create or replace function public.picc_check_class_meeting()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_section uuid; v_term uuid; v_instructor text;
begin
  if not new.active then return new; end if;
  select o.section_id, s.term_id, btrim(o.instructor_name)
    into v_section, v_term, v_instructor
    from public.picc_course_offerings o
    join public.picc_class_sections s on s.id = o.section_id
    where o.id = new.offering_id;
  if v_section is null then raise exception 'Offering not found'; end if;
  -- Serialize conflicting edits by term to avoid two overlapping inserts racing.
  perform pg_advisory_xact_lock(hashtext(v_term::text));
  if exists (
    select 1 from public.picc_class_meetings m
    join public.picc_course_offerings o on o.id = m.offering_id
    join public.picc_class_sections s on s.id = o.section_id
    where m.id is distinct from new.id
      and m.active and o.active and s.term_id = v_term
      and m.weekday = new.weekday
      and m.start_time < new.end_time and new.start_time < m.end_time
      and (o.section_id = v_section
        or (btrim(new.room) <> '' and lower(btrim(m.room)) = lower(btrim(new.room)))
        or (v_instructor <> '' and lower(btrim(o.instructor_name)) = lower(v_instructor)))
  ) then
    raise exception 'Schedule conflict: section, room, or instructor is already booked at that time';
  end if;
  return new;
end; $$;
drop trigger if exists picc_meeting_conflict_check on public.picc_class_meetings;
create trigger picc_meeting_conflict_check before insert or update
  on public.picc_class_meetings for each row execute function public.picc_check_class_meeting();

-- If an archived offering or section is reactivated, pre-existing times must be reviewed.
-- Keep archival/history: no destructive DELETE grant is provided.

-- Only a registrar may mark a term current; clear the previous current term atomically.
create or replace function public.picc_set_current_term(p_term_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_active_picc_registrar() then
    raise exception 'Active Registrar account required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('picc-current-term'));
  if not exists (select 1 from public.picc_academic_terms where id=p_term_id) then
    raise exception 'Academic term not found';
  end if;
  update public.picc_academic_terms set is_current=false where is_current=true;
  update public.picc_academic_terms set is_current=true where id=p_term_id;
end; $$;

-- Security: active authenticated users may view academic catalog, only registrars write.
do $$ declare t text;
begin
  foreach t in array array[
    'picc_academic_terms','picc_academic_programs','picc_academic_courses',
    'picc_class_sections','picc_course_offerings','picc_class_meetings'
  ] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant select, insert, update on public.%I to authenticated',t);
    execute format('drop policy if exists "PiCC catalog active reads" on public.%I',t);
    execute format('drop policy if exists "PiCC registrar catalog inserts" on public.%I',t);
    execute format('drop policy if exists "PiCC registrar catalog updates" on public.%I',t);
    execute format('create policy "PiCC catalog active reads" on public.%I for select to authenticated using (public.is_active_picc_student() or public.is_active_picc_registrar())',t);
    execute format('create policy "PiCC registrar catalog inserts" on public.%I for insert to authenticated with check (public.is_active_picc_registrar())',t);
    execute format('create policy "PiCC registrar catalog updates" on public.%I for update to authenticated using (public.is_active_picc_registrar()) with check (public.is_active_picc_registrar())',t);
  end loop;
end $$;

revoke all on function public.picc_check_class_meeting() from public, anon, authenticated;
revoke all on function public.picc_set_current_term(uuid) from public, anon;
grant execute on function public.picc_set_current_term(uuid) to authenticated;
commit;
