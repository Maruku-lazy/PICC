-- PiCC Phase 4.2: versioned curriculum maps and prerequisites.
-- Apply once, AFTER 20261101040000_academic_management.sql on your DEV project.
-- No sample curricula or subject requirements are inserted. PiCC must provide approved maps.
-- Student applications and document screening records are not altered.
begin;

create table if not exists public.picc_curriculum_versions (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.picc_academic_programs(id) on delete restrict,
  version_name text not null check (length(btrim(version_name)) between 3 and 100),
  effective_academic_year text not null check (
    effective_academic_year ~ '^20[0-9]{2}-20[0-9]{2}$'
    and substring(effective_academic_year, 6, 4)::integer = substring(effective_academic_year, 1, 4)::integer + 1
  ),
  status text not null default 'draft' check (status in ('draft','published','retired')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (program_id,version_name),
  unique (id,program_id)
);
-- One current published map per program and effective start year. Retire before replacement.
create unique index if not exists picc_one_published_curriculum_per_year
  on public.picc_curriculum_versions(program_id,effective_academic_year)
  where status = 'published';

create table if not exists public.picc_curriculum_items (
  id uuid primary key default gen_random_uuid(),
  curriculum_id uuid not null,
  program_id uuid not null,
  course_id uuid not null,
  year_level smallint not null check (year_level between 1 and 5),
  semester text not null check (semester in ('1st','2nd','summer')),
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (curriculum_id,program_id)
    references public.picc_curriculum_versions(id,program_id) on delete restrict,
  foreign key (course_id,program_id)
    references public.picc_academic_courses(id,program_id) on delete restrict,
  unique (curriculum_id,course_id),
  unique (id,curriculum_id)
);
create index if not exists picc_curriculum_items_by_version on public.picc_curriculum_items(curriculum_id);

create table if not exists public.picc_curriculum_prerequisites (
  id uuid primary key default gen_random_uuid(),
  curriculum_id uuid not null references public.picc_curriculum_versions(id) on delete restrict,
  curriculum_item_id uuid not null,
  prerequisite_item_id uuid not null,
  created_at timestamptz not null default now(),
  check (curriculum_item_id <> prerequisite_item_id),
  foreign key (curriculum_item_id,curriculum_id)
    references public.picc_curriculum_items(id,curriculum_id) on delete restrict,
  foreign key (prerequisite_item_id,curriculum_id)
    references public.picc_curriculum_items(id,curriculum_id) on delete restrict,
  unique (curriculum_item_id, prerequisite_item_id)
);
create index if not exists picc_curriculum_prereq_by_version on public.picc_curriculum_prerequisites(curriculum_id);

-- Curriculum copies cannot be edited after publication. Student enrollment later
-- references these stable rows, not a mutable list of subjects.
create or replace function public.picc_guard_curriculum_version()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.published_at is not null then
      raise exception 'Curriculum must start as a draft';
    end if;
    return new;
  end if;
  if new.id <> old.id or new.program_id <> old.program_id or new.created_at <> old.created_at then
    raise exception 'Curriculum identity and program cannot be changed';
  end if;
  if old.status <> 'draft' then
    if new.version_name is distinct from old.version_name
      or new.effective_academic_year is distinct from old.effective_academic_year
      or new.published_at is distinct from old.published_at then
      raise exception 'Published or retired curriculum details are immutable';
    end if;
    if not (old.status='published' and new.status='retired') and new.status <> old.status then
      raise exception 'Only a published curriculum may transition to retired';
    end if;
    return new;
  end if;
  if new.status = 'draft' then
    if new.published_at is not null then raise exception 'Draft must not have a publication timestamp'; end if;
    return new;
  end if;
  if new.status = 'retired' then
    if new.published_at is not null then raise exception 'Unpublished draft cannot have a publication timestamp'; end if;
    return new; -- abandon a draft without deleting it
  end if;
  if new.status = 'published' then
    if not exists (select 1 from public.picc_curriculum_items i where i.curriculum_id = new.id) then
      raise exception 'Add approved curriculum subjects before publishing';
    end if;
    if exists (
      select 1 from public.picc_curriculum_items i
      join public.picc_academic_courses c on c.id=i.course_id
      where i.curriculum_id=new.id and not c.active
    ) then
      raise exception 'Published curriculum cannot contain archived courses';
    end if;
    new.published_at := now();
    return new;
  end if;
  raise exception 'Invalid curriculum status transition';
end; $$;
drop trigger if exists picc_guard_curriculum_version_trigger on public.picc_curriculum_versions;
create trigger picc_guard_curriculum_version_trigger before insert or update
  on public.picc_curriculum_versions for each row execute function public.picc_guard_curriculum_version();

create or replace function public.picc_guard_curriculum_item()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_version uuid; v_status text;
begin
  v_version := case when tg_op='DELETE' then old.curriculum_id else new.curriculum_id end;
  select status into v_status from public.picc_curriculum_versions where id=v_version for update;
  if v_status is distinct from 'draft' then raise exception 'Only draft curricula can be edited'; end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and (new.curriculum_id<>old.curriculum_id or new.course_id<>old.course_id or new.program_id<>old.program_id) then
    raise exception 'Remove and re-add a course to change its identity';
  end if;
  if not exists (select 1 from public.picc_academic_courses c where c.id=new.course_id and c.active) then
    raise exception 'Curriculum subjects must be active in the course catalog';
  end if;
  return new;
end; $$;
drop trigger if exists picc_guard_curriculum_item_trigger on public.picc_curriculum_items;
create trigger picc_guard_curriculum_item_trigger before insert or update or delete
  on public.picc_curriculum_items for each row execute function public.picc_guard_curriculum_item();

create or replace function public.picc_guard_curriculum_prerequisite()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  if tg_op = 'UPDATE' then raise exception 'Remove and recreate prerequisites instead'; end if;
  select status into v_status from public.picc_curriculum_versions
    where id = case when tg_op='DELETE' then old.curriculum_id else new.curriculum_id end for update;
  if v_status is distinct from 'draft' then raise exception 'Only draft curricula can be edited'; end if;
  if tg_op = 'DELETE' then return old; end if;
  if not exists (select 1 from public.picc_curriculum_items where id=new.curriculum_item_id and curriculum_id=new.curriculum_id) or
     not exists (select 1 from public.picc_curriculum_items where id=new.prerequisite_item_id and curriculum_id=new.curriculum_id) then
    raise exception 'Both subjects must belong to the selected curriculum';
  end if;
  -- Reject cycles: if prerequisite already depends (transitively) on target,
  -- adding target -> prerequisite would create a cycle.
  if exists (
    with recursive chain(subject_id) as (
      select new.prerequisite_item_id
      union
      select p.prerequisite_item_id from public.picc_curriculum_prerequisites p
      join chain c on p.curriculum_item_id = c.subject_id
      where p.curriculum_id = new.curriculum_id
    )
    select 1 from chain where subject_id = new.curriculum_item_id
  ) then raise exception 'Circular prerequisite chain is not allowed'; end if;
  return new;
end; $$;
drop trigger if exists picc_guard_curriculum_prerequisite_trigger on public.picc_curriculum_prerequisites;
create trigger picc_guard_curriculum_prerequisite_trigger before insert or update or delete
  on public.picc_curriculum_prerequisites for each row execute function public.picc_guard_curriculum_prerequisite();

-- Curriculum read access: active registrars can view drafts; active students
-- can read only published versions and their courses/prerequisites.
alter table public.picc_curriculum_versions enable row level security;
alter table public.picc_curriculum_items enable row level security;
alter table public.picc_curriculum_prerequisites enable row level security;

revoke all on public.picc_curriculum_versions, public.picc_curriculum_items,
  public.picc_curriculum_prerequisites from anon, authenticated;
grant select, insert, update on public.picc_curriculum_versions to authenticated;
grant select, insert, update, delete on public.picc_curriculum_items to authenticated;
grant select, insert, delete on public.picc_curriculum_prerequisites to authenticated;

create policy "Curriculum versions readable by allowed users" on public.picc_curriculum_versions
for select to authenticated using (
  public.is_active_picc_registrar() or
  (public.is_active_picc_student() and status='published')
);
create policy "Registrar creates curriculum versions" on public.picc_curriculum_versions
for insert to authenticated with check (public.is_active_picc_registrar());
create policy "Registrar updates curriculum versions" on public.picc_curriculum_versions
for update to authenticated using (public.is_active_picc_registrar())
with check (public.is_active_picc_registrar());

create policy "Curriculum items readable by allowed users" on public.picc_curriculum_items
for select to authenticated using (
  public.is_active_picc_registrar() or
  (public.is_active_picc_student() and exists (
    select 1 from public.picc_curriculum_versions v where v.id=curriculum_id and v.status='published'
  ))
);
create policy "Registrar adds curriculum items" on public.picc_curriculum_items
for insert to authenticated with check (public.is_active_picc_registrar());
create policy "Registrar edits curriculum items" on public.picc_curriculum_items
for update to authenticated using (public.is_active_picc_registrar())
with check (public.is_active_picc_registrar());
create policy "Registrar removes draft curriculum items" on public.picc_curriculum_items
for delete to authenticated using (public.is_active_picc_registrar());

create policy "Curriculum prerequisites readable by allowed users" on public.picc_curriculum_prerequisites
for select to authenticated using (
  public.is_active_picc_registrar() or
  (public.is_active_picc_student() and exists (
    select 1 from public.picc_curriculum_versions v where v.id=curriculum_id and v.status='published'
  ))
);
create policy "Registrar adds curriculum prerequisites" on public.picc_curriculum_prerequisites
for insert to authenticated with check (public.is_active_picc_registrar());
create policy "Registrar removes draft curriculum prerequisites" on public.picc_curriculum_prerequisites
for delete to authenticated using (public.is_active_picc_registrar());

revoke all on function public.picc_guard_curriculum_version() from public,anon,authenticated;
revoke all on function public.picc_guard_curriculum_item() from public,anon,authenticated;
revoke all on function public.picc_guard_curriculum_prerequisite() from public,anon,authenticated;
commit;
