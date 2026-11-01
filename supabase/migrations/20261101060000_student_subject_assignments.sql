-- PiCC Phase 4.3: Registrar-managed, provisional course/section assignments.
-- Run AFTER Phase 4.2 in the EXISTING DEVELOPMENT project.
-- No approval, billing, grades, or final COR is produced here.
BEGIN;

CREATE TABLE IF NOT EXISTS public.picc_student_term_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.enrollment_applications(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES public.picc_academic_terms(id) ON DELETE RESTRICT,
  curriculum_id uuid NOT NULL REFERENCES public.picc_curriculum_versions(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, term_id)
);
CREATE INDEX IF NOT EXISTS picc_student_plans_application_idx ON public.picc_student_term_plans(application_id);

CREATE TABLE IF NOT EXISTS public.picc_student_course_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES public.picc_student_term_plans(id) ON DELETE RESTRICT,
  application_id uuid NOT NULL REFERENCES public.enrollment_applications(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES public.picc_academic_terms(id) ON DELETE RESTRICT,
  offering_id uuid NOT NULL REFERENCES public.picc_course_offerings(id) ON DELETE RESTRICT,
  section_id uuid NOT NULL REFERENCES public.picc_class_sections(id) ON DELETE RESTRICT,
  course_id uuid NOT NULL REFERENCES public.picc_academic_courses(id) ON DELETE RESTRICT,
  assigned_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  prerequisite_note text NOT NULL DEFAULT '' CHECK (length(prerequisite_note) <= 500),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, term_id, course_id),
  UNIQUE (application_id, offering_id)
);
CREATE INDEX IF NOT EXISTS picc_student_assignments_plan_idx ON public.picc_student_course_assignments(plan_id);
CREATE INDEX IF NOT EXISTS picc_student_assignments_section_idx ON public.picc_student_course_assignments(section_id);
CREATE INDEX IF NOT EXISTS picc_student_assignments_application_idx ON public.picc_student_course_assignments(application_id);

-- Retained history of assignments and removals; even removals keep an audit record.
CREATE TABLE IF NOT EXISTS public.picc_student_assignment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.enrollment_applications(id) ON DELETE CASCADE,
  term_id uuid NOT NULL REFERENCES public.picc_academic_terms(id) ON DELETE RESTRICT,
  course_id uuid NOT NULL REFERENCES public.picc_academic_courses(id) ON DELETE RESTRICT,
  offering_id uuid NOT NULL REFERENCES public.picc_course_offerings(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('assigned', 'removed')),
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  note text NOT NULL DEFAULT '',
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS picc_assignment_history_application_idx ON public.picc_student_assignment_history(application_id,occurred_at DESC);

-- Read-only RLS for students (own application) and registrars (all applications).
-- Direct client writes are intentionally denied: RPC checks and locks protect capacity.
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'picc_student_term_plans','picc_student_course_assignments','picc_student_assignment_history'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated',t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
    EXECUTE format('DROP POLICY IF EXISTS "PiCC student own plan / Registrar all" ON public.%I',t);
    EXECUTE format(
      'CREATE POLICY "PiCC student own plan / Registrar all" ON public.%I FOR SELECT TO authenticated USING (public.is_active_picc_registrar() OR (public.is_active_picc_student() AND EXISTS (SELECT 1 FROM public.enrollment_applications a WHERE a.id=application_id AND a.student_id=(SELECT auth.uid()))))',t
    );
  END LOOP;
END $$;

-- Everything important is checked again inside the database (never trust React).
CREATE OR REPLACE FUNCTION public.picc_assign_student_offering(
  p_application_id uuid, p_term_id uuid, p_curriculum_id uuid,
  p_offering_id uuid, p_prerequisite_note text DEFAULT ''
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_app public.enrollment_applications%ROWTYPE;
  v_term public.picc_academic_terms%ROWTYPE;
  v_offering public.picc_course_offerings%ROWTYPE;
  v_section public.picc_class_sections%ROWTYPE;
  v_curriculum public.picc_curriculum_versions%ROWTYPE;
  v_course_item public.picc_curriculum_items%ROWTYPE;
  v_plan uuid;
  v_id uuid;
  v_has_prerequisites boolean;
  v_existing_in_section boolean;
  v_students_in_section integer;
BEGIN
  IF NOT public.is_active_picc_registrar() THEN
    RAISE EXCEPTION 'Active Registrar account required' USING ERRCODE='42501';
  END IF;
  -- Protect edits for the same application from interleaving.
  SELECT * INTO v_app FROM public.enrollment_applications WHERE id=p_application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found'; END IF;
  IF v_app.status NOT IN ('submitted','under_review','documents_verified') THEN
    RAISE EXCEPTION 'Student application must be submitted and available for Registrar review';
  END IF;
  SELECT * INTO v_term FROM public.picc_academic_terms WHERE id=p_term_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Academic term does not exist'; END IF;
  IF v_app.form_data->>'academicYear' IS DISTINCT FROM v_term.academic_year OR
     v_app.form_data->>'semester' IS DISTINCT FROM v_term.semester THEN
    RAISE EXCEPTION 'Selected academic term does not match the student application';
  END IF;
  SELECT * INTO v_curriculum FROM public.picc_curriculum_versions WHERE id=p_curriculum_id;
  IF NOT FOUND OR v_curriculum.status <> 'published' THEN
    RAISE EXCEPTION 'Select a published curriculum';
  END IF;
  SELECT * INTO v_offering FROM public.picc_course_offerings WHERE id=p_offering_id;
  IF NOT FOUND OR NOT v_offering.active THEN RAISE EXCEPTION 'Course offering is unavailable'; END IF;
  SELECT * INTO v_section FROM public.picc_class_sections WHERE id=v_offering.section_id;
  IF NOT FOUND OR NOT v_section.active OR v_section.term_id <> p_term_id THEN
    RAISE EXCEPTION 'Section is inactive or belongs to another academic term';
  END IF;
  IF v_curriculum.effective_academic_year > v_term.academic_year THEN
    RAISE EXCEPTION 'Curriculum version takes effect after the selected academic term';
  END IF;
  IF v_section.year_level::text IS DISTINCT FROM (v_app.form_data->>'yearLevel') THEN
    RAISE EXCEPTION 'Selected section does not match the student year level';
  END IF;
  IF v_curriculum.program_id <> v_section.program_id OR
     v_offering.program_id <> v_section.program_id OR
     v_app.form_data->>'program' IS DISTINCT FROM (
       SELECT name FROM public.picc_academic_programs WHERE id=v_section.program_id AND active
     ) THEN
    RAISE EXCEPTION 'Student program, curriculum and offering must match';
  END IF;
  -- Do not assign unpublished subjects or a mismatched year/semester.
  SELECT * INTO v_course_item FROM public.picc_curriculum_items
  WHERE curriculum_id=p_curriculum_id AND course_id=v_offering.course_id
    AND year_level::text=coalesce(v_app.form_data->>'yearLevel','')
    AND semester=v_term.semester;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Offering does not match the student year/semester in the published curriculum';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.picc_academic_courses WHERE id=v_offering.course_id AND active) THEN
    RAISE EXCEPTION 'Archived course cannot be assigned';
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.picc_curriculum_prerequisites
    WHERE curriculum_item_id=v_course_item.id) INTO v_has_prerequisites;
  IF v_has_prerequisites AND length(btrim(coalesce(p_prerequisite_note,''))) < 10 THEN
    RAISE EXCEPTION 'Prerequisites require a Registrar eligibility-check note (at least 10 characters)';
  END IF;
  IF length(coalesce(p_prerequisite_note,'')) > 500 THEN
    RAISE EXCEPTION 'Prerequisite note is too long';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.picc_class_meetings WHERE offering_id=p_offering_id AND active) THEN
    RAISE EXCEPTION 'Add a class schedule before assigning this offering';
  END IF;
  -- Serialize all assignments to a section to prevent concurrent overbooking.
  PERFORM pg_advisory_xact_lock(hashtext('picc-section-' || v_section.id::text));
  IF EXISTS (SELECT 1 FROM public.picc_student_course_assignments
    WHERE application_id=p_application_id AND term_id=p_term_id AND course_id=v_offering.course_id) THEN
    RAISE EXCEPTION 'Student already has this course for the selected term';
  END IF;
  -- Different courses can be scheduled in different sections, but times may not clash.
  IF EXISTS (
    SELECT 1 FROM public.picc_student_course_assignments a
    JOIN public.picc_class_meetings old_m ON old_m.offering_id=a.offering_id AND old_m.active
    JOIN public.picc_class_meetings new_m ON new_m.offering_id=p_offering_id AND new_m.active
    WHERE a.application_id=p_application_id AND a.term_id=p_term_id
      AND old_m.weekday=new_m.weekday
      AND old_m.start_time < new_m.end_time AND new_m.start_time < old_m.end_time
  ) THEN RAISE EXCEPTION 'Schedule conflict with an already assigned subject'; END IF;
  SELECT EXISTS(SELECT 1 FROM public.picc_student_course_assignments
    WHERE application_id=p_application_id AND section_id=v_section.id)
    INTO v_existing_in_section;
  SELECT count(DISTINCT application_id) INTO v_students_in_section
    FROM public.picc_student_course_assignments WHERE section_id=v_section.id;
  IF NOT v_existing_in_section AND v_students_in_section >= v_section.capacity THEN
    RAISE EXCEPTION 'Section capacity has been reached';
  END IF;
  SELECT id INTO v_plan FROM public.picc_student_term_plans
  WHERE application_id=p_application_id AND term_id=p_term_id;
  IF FOUND THEN
    IF (SELECT curriculum_id FROM public.picc_student_term_plans WHERE id=v_plan) <> p_curriculum_id THEN
      RAISE EXCEPTION 'This term already uses a different curriculum. Remove assignments and clear the plan first';
    END IF;
  ELSE
    INSERT INTO public.picc_student_term_plans(application_id,term_id,curriculum_id,created_by)
    VALUES (p_application_id,p_term_id,p_curriculum_id,auth.uid()) RETURNING id INTO v_plan;
  END IF;
  INSERT INTO public.picc_student_course_assignments (
    plan_id,application_id,term_id,offering_id,section_id,course_id,assigned_by,prerequisite_note
  ) VALUES (
    v_plan,p_application_id,p_term_id,p_offering_id,v_section.id,v_offering.course_id,auth.uid(),
    btrim(coalesce(p_prerequisite_note,''))
  ) RETURNING id INTO v_id;
  INSERT INTO public.picc_student_assignment_history(application_id,term_id,course_id,offering_id,action,actor_id,note)
  VALUES (p_application_id,p_term_id,v_offering.course_id,p_offering_id,'assigned',auth.uid(),btrim(coalesce(p_prerequisite_note,'')));
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.picc_remove_student_offering(p_assignment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_record public.picc_student_course_assignments%ROWTYPE;
BEGIN
  IF NOT public.is_active_picc_registrar() THEN
    RAISE EXCEPTION 'Active Registrar account required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_record FROM public.picc_student_course_assignments WHERE id=p_assignment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assigned subject was not found'; END IF;
  PERFORM 1 FROM public.enrollment_applications WHERE id=v_record.application_id FOR UPDATE;
  PERFORM pg_advisory_xact_lock(hashtext('picc-section-' || v_record.section_id::text));
  DELETE FROM public.picc_student_course_assignments WHERE id=p_assignment_id;
  INSERT INTO public.picc_student_assignment_history(application_id,term_id,course_id,offering_id,action,actor_id,note)
  VALUES (v_record.application_id,v_record.term_id,v_record.course_id,v_record.offering_id,'removed',auth.uid(),'Removed by Registrar');
END $$;

-- Only an empty term plan can be cleared to select another published curriculum.
CREATE OR REPLACE FUNCTION public.picc_clear_student_term_plan(p_plan_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_plan public.picc_student_term_plans%ROWTYPE;
BEGIN
  IF NOT public.is_active_picc_registrar() THEN
    RAISE EXCEPTION 'Active Registrar account required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_plan FROM public.picc_student_term_plans WHERE id=p_plan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Plan not found'; END IF;
  PERFORM 1 FROM public.enrollment_applications WHERE id=v_plan.application_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.picc_student_course_assignments WHERE plan_id=p_plan_id) THEN
    RAISE EXCEPTION 'Remove assigned subjects before clearing the term plan';
  END IF;
  DELETE FROM public.picc_student_term_plans WHERE id=p_plan_id;
END $$;

-- Guard capacity reduction, deactivating a section, or reassigning an in-use offering.
CREATE OR REPLACE FUNCTION public.picc_guard_assigned_section()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_count integer;
BEGIN
  IF new.capacity IS DISTINCT FROM old.capacity OR (old.active AND NOT new.active) THEN
    PERFORM pg_advisory_xact_lock(hashtext('picc-section-' || new.id::text));
    SELECT count(DISTINCT application_id) INTO v_count
      FROM public.picc_student_course_assignments WHERE section_id=new.id;
    IF v_count > new.capacity OR (v_count > 0 AND NOT new.active) THEN
      RAISE EXCEPTION 'Section has assigned students; capacity cannot be reduced below enrollment or section archived';
    END IF;
  END IF;
  IF (new.term_id,new.program_id) IS DISTINCT FROM (old.term_id,old.program_id) AND
     EXISTS(SELECT 1 FROM public.picc_student_course_assignments WHERE section_id=new.id) THEN
    RAISE EXCEPTION 'Section term/program cannot change while students are assigned';
  END IF;
  RETURN new;
END $$;
DROP TRIGGER IF EXISTS picc_guard_assigned_section_trigger ON public.picc_class_sections;
CREATE TRIGGER picc_guard_assigned_section_trigger BEFORE UPDATE ON public.picc_class_sections
FOR EACH ROW EXECUTE FUNCTION public.picc_guard_assigned_section();

CREATE OR REPLACE FUNCTION public.picc_guard_assigned_offering()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.picc_student_course_assignments WHERE offering_id=new.id) AND
     (new.section_id IS DISTINCT FROM old.section_id OR new.course_id IS DISTINCT FROM old.course_id OR
      new.program_id IS DISTINCT FROM old.program_id OR (old.active AND NOT new.active)) THEN
    RAISE EXCEPTION 'Offering has assigned students; remove assignments before moving or archiving';
  END IF;
  RETURN new;
END $$;
DROP TRIGGER IF EXISTS picc_guard_assigned_offering_trigger ON public.picc_course_offerings;
CREATE TRIGGER picc_guard_assigned_offering_trigger BEFORE UPDATE ON public.picc_course_offerings
FOR EACH ROW EXECUTE FUNCTION public.picc_guard_assigned_offering();

-- Class schedule edits must not introduce overlaps for already assigned students.
CREATE OR REPLACE FUNCTION public.picc_guard_assigned_meeting()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF tg_op='UPDATE' AND old.active AND NOT new.active AND EXISTS (
    SELECT 1 FROM public.picc_student_course_assignments WHERE offering_id=new.offering_id
  ) THEN RAISE EXCEPTION 'Cannot deactivate a meeting while students are assigned'; END IF;
  IF new.active AND EXISTS (
    SELECT 1 FROM public.picc_student_course_assignments a
    JOIN public.picc_student_course_assignments other_a
      ON other_a.application_id=a.application_id AND other_a.term_id=a.term_id AND other_a.offering_id<>a.offering_id
    JOIN public.picc_class_meetings other_m ON other_m.offering_id=other_a.offering_id AND other_m.active
    WHERE a.offering_id=new.offering_id AND other_m.weekday=new.weekday
      AND other_m.start_time<new.end_time AND new.start_time<other_m.end_time
  ) THEN RAISE EXCEPTION 'This schedule would conflict for assigned students'; END IF;
  RETURN new;
END $$;
DROP TRIGGER IF EXISTS picc_guard_assigned_meeting_trigger ON public.picc_class_meetings;
CREATE TRIGGER picc_guard_assigned_meeting_trigger BEFORE INSERT OR UPDATE ON public.picc_class_meetings
FOR EACH ROW EXECUTE FUNCTION public.picc_guard_assigned_meeting();


-- Prevent stale assignments when a student edits key academic fields after placement.
-- Other student fields (address, spelling, etc.) remain editable under existing workflow.
CREATE OR REPLACE FUNCTION public.picc_guard_assigned_application_academics()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.picc_student_course_assignments a WHERE a.application_id=new.id)
    AND (new.form_data->>'academicYear' IS DISTINCT FROM old.form_data->>'academicYear'
      OR new.form_data->>'semester' IS DISTINCT FROM old.form_data->>'semester'
      OR new.form_data->>'yearLevel' IS DISTINCT FROM old.form_data->>'yearLevel'
      OR new.form_data->>'program' IS DISTINCT FROM old.form_data->>'program') THEN
    RAISE EXCEPTION 'Ask the Registrar to remove subject assignments before changing program, term or year level';
  END IF;
  RETURN new;
END $$;
DROP TRIGGER IF EXISTS picc_guard_assigned_application_academics_trigger ON public.enrollment_applications;
CREATE TRIGGER picc_guard_assigned_application_academics_trigger BEFORE UPDATE OF form_data ON public.enrollment_applications
FOR EACH ROW EXECUTE FUNCTION public.picc_guard_assigned_application_academics();

REVOKE ALL ON FUNCTION public.picc_assign_student_offering(uuid,uuid,uuid,uuid,text) FROM public,anon;
REVOKE ALL ON FUNCTION public.picc_remove_student_offering(uuid) FROM public,anon;
REVOKE ALL ON FUNCTION public.picc_clear_student_term_plan(uuid) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.picc_assign_student_offering(uuid,uuid,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.picc_remove_student_offering(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.picc_clear_student_term_plan(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.picc_guard_assigned_section() FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.picc_guard_assigned_offering() FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.picc_guard_assigned_meeting() FROM public,anon,authenticated;
REVOKE ALL ON FUNCTION public.picc_guard_assigned_application_academics() FROM public,anon,authenticated;
COMMIT;
