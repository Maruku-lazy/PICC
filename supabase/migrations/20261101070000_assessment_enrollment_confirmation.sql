-- PiCC Phase 5: Registrar-only external payment verification, final enrollment,
-- immutable registration snapshot. Run AFTER Phase 4.3 on the DEVELOPMENT project.
-- No payment processing. No official PiCC billing rates / COR format are assumed.
BEGIN;

CREATE TABLE public.picc_enrollment_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL UNIQUE REFERENCES public.enrollment_applications(id) ON DELETE CASCADE,
  assessed_amount numeric(12,2) NOT NULL CHECK (assessed_amount >= 0),
  payment_status text NOT NULL CHECK (payment_status IN ('pending','verified','waived')) DEFAULT 'pending',
  external_reference text NOT NULL DEFAULT '' CHECK (length(external_reference) <= 150),
  payment_note text NOT NULL DEFAULT '' CHECK (length(payment_note) <= 1000),
  recorded_by uuid NOT NULL REFERENCES public.profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (payment_status = 'pending' OR length(btrim(payment_note)) >= 10),
  CHECK (payment_status <> 'verified' OR length(btrim(external_reference)) >= 3)
);
CREATE TABLE public.picc_assessment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.enrollment_applications(id) ON DELETE CASCADE,
  assessed_amount numeric(12,2) NOT NULL,
  payment_status text NOT NULL,
  external_reference text NOT NULL,
  payment_note text NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX picc_assessment_events_application_idx ON public.picc_assessment_events(application_id,created_at DESC);

CREATE TABLE public.picc_enrollment_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL UNIQUE REFERENCES public.enrollment_applications(id) ON DELETE RESTRICT,
  registration_reference text NOT NULL UNIQUE,
  assessment_id uuid NOT NULL REFERENCES public.picc_enrollment_assessments(id) ON DELETE RESTRICT,
  confirmed_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  registration_snapshot jsonb NOT NULL,
  CONSTRAINT picc_confirmation_snapshot_object CHECK (jsonb_typeof(registration_snapshot) = 'object')
);
CREATE INDEX picc_enrollment_confirmations_application_idx ON public.picc_enrollment_confirmations(application_id);

-- No direct authenticated writes. All mutation through SECURITY DEFINER RPCs.
DO $$ DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['picc_enrollment_assessments','picc_assessment_events','picc_enrollment_confirmations'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  END LOOP;
END $$;
CREATE POLICY "PiCC assessments: student own or Registrar" ON public.picc_enrollment_assessments
  FOR SELECT TO authenticated USING (public.is_active_picc_registrar() OR
    (public.is_active_picc_student() AND EXISTS (
      SELECT 1 FROM public.enrollment_applications a
      WHERE a.id=application_id AND a.student_id=(SELECT auth.uid()))));
CREATE POLICY "PiCC assessment events: Registrar" ON public.picc_assessment_events
  FOR SELECT TO authenticated USING (public.is_active_picc_registrar());
CREATE POLICY "PiCC confirmations: student own or Registrar" ON public.picc_enrollment_confirmations
  FOR SELECT TO authenticated USING (public.is_active_picc_registrar() OR
    (public.is_active_picc_student() AND EXISTS (
      SELECT 1 FROM public.enrollment_applications a
      WHERE a.id=application_id AND a.student_id=(SELECT auth.uid()))));

CREATE FUNCTION public.picc_record_enrollment_assessment(
  p_application_id uuid, p_amount numeric, p_payment_status text,
  p_external_reference text DEFAULT '', p_payment_note text DEFAULT ''
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_app public.enrollment_applications%ROWTYPE; v_assessment uuid;
BEGIN
  IF NOT public.is_active_picc_registrar() THEN
    RAISE EXCEPTION 'Only an active Registrar can record payment verification' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_app FROM public.enrollment_applications WHERE id=p_application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found'; END IF;
  IF v_app.status NOT IN ('submitted','under_review','documents_verified') THEN
    RAISE EXCEPTION 'Submit the student application before assessment';
  END IF;
  IF EXISTS(SELECT 1 FROM public.picc_enrollment_confirmations WHERE application_id=p_application_id) THEN
    RAISE EXCEPTION 'Final enrollment is already confirmed; assessment is locked';
  END IF;
  IF p_amount IS NULL OR p_amount < 0 OR p_amount > 9999999999.99 OR p_amount <> round(p_amount,2) THEN
    RAISE EXCEPTION 'Enter a valid PHP assessment amount with at most two decimal places';
  END IF;
  IF p_payment_status IS NULL OR p_payment_status NOT IN ('pending','verified','waived') THEN
    RAISE EXCEPTION 'Invalid external payment status';
  END IF;
  IF length(coalesce(p_external_reference,'')) > 150 OR length(coalesce(p_payment_note,'')) > 1000 THEN
    RAISE EXCEPTION 'Reference or payment note exceeds the maximum length';
  END IF;
  IF p_payment_status = 'verified' AND length(btrim(coalesce(p_external_reference,''))) < 3 THEN
    RAISE EXCEPTION 'External payment verification requires a reference';
  END IF;
  IF p_payment_status IN ('verified','waived') AND length(btrim(coalesce(p_payment_note,''))) < 10 THEN
    RAISE EXCEPTION 'Describe the evidence or approved waiver (at least 10 characters)';
  END IF;
  INSERT INTO public.picc_enrollment_assessments
    (application_id,assessed_amount,payment_status,external_reference,payment_note,recorded_by)
  VALUES (p_application_id,p_amount,p_payment_status,btrim(coalesce(p_external_reference,'')),btrim(coalesce(p_payment_note,'')),auth.uid())
  ON CONFLICT (application_id) DO UPDATE SET
    assessed_amount=excluded.assessed_amount, payment_status=excluded.payment_status,
    external_reference=excluded.external_reference, payment_note=excluded.payment_note,
    recorded_by=excluded.recorded_by,updated_at=now()
  RETURNING id INTO v_assessment;
  INSERT INTO public.picc_assessment_events
    (application_id,assessed_amount,payment_status,external_reference,payment_note,actor_id)
  VALUES (p_application_id,p_amount,p_payment_status,btrim(coalesce(p_external_reference,'')),btrim(coalesce(p_payment_note,'')),auth.uid());
  RETURN v_assessment;
END $$;

CREATE FUNCTION public.picc_confirm_final_enrollment(p_application_id uuid, p_attested boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_app public.enrollment_applications%ROWTYPE;
  v_assessment public.picc_enrollment_assessments%ROWTYPE;
  v_plan public.picc_student_term_plans%ROWTYPE;
  v_term public.picc_academic_terms%ROWTYPE;
  v_curriculum public.picc_curriculum_versions%ROWTYPE;
  v_expected text[];
  v_requirement text;
  v_bad_requirement text;
  v_courses jsonb;
  v_course_count integer;
  v_units numeric;
  v_snapshot jsonb;
  v_confirmation uuid;
BEGIN
  IF NOT public.is_active_picc_registrar() THEN
    RAISE EXCEPTION 'Only an active Registrar can confirm final enrollment' USING ERRCODE='42501';
  END IF;
  IF p_attested IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Registrar must explicitly attest to final verification';
  END IF;
  SELECT * INTO v_app FROM public.enrollment_applications WHERE id=p_application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Application not found'; END IF;
  IF v_app.status <> 'documents_verified' THEN
    RAISE EXCEPTION 'Complete the application form review before final confirmation';
  END IF;
  IF EXISTS(SELECT 1 FROM public.picc_enrollment_confirmations WHERE application_id=p_application_id) THEN
    RAISE EXCEPTION 'Enrollment is already confirmed';
  END IF;
  SELECT * INTO v_assessment FROM public.picc_enrollment_assessments
    WHERE application_id=p_application_id FOR UPDATE;
  IF NOT FOUND OR v_assessment.payment_status NOT IN ('verified','waived') THEN
    RAISE EXCEPTION 'External payment verification or documented waiver is required';
  END IF;
  IF v_app.form_data->>'studentType' = 'freshman' THEN
    v_expected := ARRAY['PiCCAT Result Clearance','Original SF9 / High School Report Card',
      'Original Certificate of Good Moral Character','PSA Birth Certificate','2×2 ID photo (white background)'];
  ELSIF v_app.form_data->>'studentType' = 'transferee' THEN
    v_expected := ARRAY['PiCCAT Result Clearance','Honorable Dismissal / Transfer Credentials',
      'Certificate of Grades','Subject / Course Descriptions from previous school',
      'Original Certificate of Good Moral Character','PSA Birth Certificate','2×2 ID photo (white background)'];
  ELSE
    RAISE EXCEPTION 'Returning-student document checklist requires institutional approval before confirmation';
  END IF;
  IF lower(coalesce(v_app.form_data->>'civilStatus','')) = 'married' THEN
    v_expected := array_append(v_expected,'Marriage Certificate (original and copies)');
  END IF;
  -- Latest current verdict only; a superseded/failed/latest follow-up cannot be bypassed
  -- by an older passed verdict. The document must still be present at the same path.
  FOREACH v_requirement IN ARRAY v_expected LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.application_documents d
      JOIN LATERAL (
        SELECT decision, superseded_at FROM public.document_verdicts v
        WHERE v.application_id=p_application_id AND v.document_id=d.id
          AND v.storage_path_snapshot=d.storage_path
        ORDER BY v.created_at DESC,v.id DESC LIMIT 1
      ) latest ON latest.decision='passed' AND latest.superseded_at IS NULL
      WHERE d.application_id=p_application_id AND d.requirement_type=v_requirement
    ) THEN
      RAISE EXCEPTION 'Required document missing or not passed by Registrar: %',v_requirement;
    END IF;
  END LOOP;
  SELECT * INTO v_plan FROM public.picc_student_term_plans
    WHERE application_id=p_application_id
      AND term_id IN (SELECT id FROM public.picc_academic_terms
        WHERE academic_year=v_app.form_data->>'academicYear'
          AND semester=v_app.form_data->>'semester') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Matching student term plan is missing'; END IF;
  SELECT * INTO v_term FROM public.picc_academic_terms WHERE id=v_plan.term_id;
  SELECT * INTO v_curriculum FROM public.picc_curriculum_versions WHERE id=v_plan.curriculum_id;
  IF v_curriculum.status <> 'published' THEN
    RAISE EXCEPTION 'Curriculum is not published';
  END IF;
  SELECT count(*),coalesce(sum(c.units),0) INTO v_course_count,v_units
  FROM public.picc_student_course_assignments a
  JOIN public.picc_academic_courses c ON c.id=a.course_id
  WHERE a.plan_id=v_plan.id AND a.application_id=p_application_id;
  IF v_course_count < 1 THEN RAISE EXCEPTION 'Assign at least one subject before final enrollment'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'courseCode',c.course_code, 'title',c.title, 'units',c.units,
      'section',s.section_name, 'instructor',o.instructor_name,
      'meetings',coalesce((SELECT jsonb_agg(jsonb_build_object(
        'weekday',m.weekday,'start',m.start_time,'end',m.end_time,'room',m.room)
        ORDER BY m.weekday,m.start_time) FROM public.picc_class_meetings m
        WHERE m.offering_id=a.offering_id AND m.active),'[]'::jsonb)
    ) ORDER BY c.course_code),'[]'::jsonb) INTO v_courses
  FROM public.picc_student_course_assignments a
  JOIN public.picc_academic_courses c ON c.id=a.course_id
  JOIN public.picc_class_sections s ON s.id=a.section_id
  JOIN public.picc_course_offerings o ON o.id=a.offering_id
  WHERE a.plan_id=v_plan.id AND a.application_id=p_application_id;
  v_snapshot := jsonb_build_object(
    'studentName',btrim(concat_ws(' ',v_app.form_data->>'firstName',v_app.form_data->>'middleName',v_app.form_data->>'lastName',v_app.form_data->>'suffix')),
    'program',v_app.form_data->>'program',
    'yearLevel',v_app.form_data->>'yearLevel',
    'academicYear',v_term.academic_year,'semester',v_term.semester,
    'curriculum',v_curriculum.version_name,
    'courses',v_courses,'courseCount',v_course_count,'totalUnits',v_units,
    'assessmentAmount',v_assessment.assessed_amount,
    'paymentStatus',v_assessment.payment_status
  );
  INSERT INTO public.picc_enrollment_confirmations
    (application_id,registration_reference,assessment_id,confirmed_by,registration_snapshot)
  VALUES (p_application_id,'PICC-DEV-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),
      v_assessment.id,auth.uid(),v_snapshot)
  RETURNING id INTO v_confirmation;
  RETURN v_confirmation;
END $$;

-- Lock finalized students' assignments, plans, and assessments. Existing confirmed
-- registration snapshots are not revised in place; follow-up corrections need a separate workflow.
CREATE FUNCTION public.picc_guard_final_registration() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_application uuid;
BEGIN
  IF tg_table_name = 'picc_student_term_plans' THEN
    v_application := CASE WHEN tg_op='DELETE' THEN old.application_id ELSE new.application_id END;
  ELSIF tg_table_name = 'picc_student_course_assignments' THEN
    v_application := CASE WHEN tg_op='DELETE' THEN old.application_id ELSE new.application_id END;
  ELSIF tg_table_name = 'picc_enrollment_assessments' THEN
    v_application := CASE WHEN tg_op='DELETE' THEN old.application_id ELSE new.application_id END;
  ELSE
    v_application := CASE WHEN tg_op='DELETE' THEN old.id ELSE new.id END;
  END IF;
  IF EXISTS(SELECT 1 FROM public.picc_enrollment_confirmations WHERE application_id=v_application) THEN
    RAISE EXCEPTION 'Final enrollment is confirmed; changes require an authorized correction workflow';
  END IF;
  IF tg_op='DELETE' THEN RETURN old; END IF;
  RETURN new;
END $$;
CREATE TRIGGER picc_guard_final_assignments BEFORE INSERT OR UPDATE OR DELETE
ON public.picc_student_course_assignments FOR EACH ROW EXECUTE FUNCTION public.picc_guard_final_registration();
CREATE TRIGGER picc_guard_final_plans BEFORE INSERT OR UPDATE OR DELETE
ON public.picc_student_term_plans FOR EACH ROW EXECUTE FUNCTION public.picc_guard_final_registration();
CREATE TRIGGER picc_guard_final_assessments BEFORE UPDATE OR DELETE
ON public.picc_enrollment_assessments FOR EACH ROW EXECUTE FUNCTION public.picc_guard_final_registration();
CREATE TRIGGER picc_guard_final_applications BEFORE UPDATE OR DELETE
ON public.enrollment_applications FOR EACH ROW EXECUTE FUNCTION public.picc_guard_final_registration();

REVOKE ALL ON FUNCTION public.picc_record_enrollment_assessment(uuid,numeric,text,text,text),
  public.picc_confirm_final_enrollment(uuid,boolean) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.picc_record_enrollment_assessment(uuid,numeric,text,text,text),
  public.picc_confirm_final_enrollment(uuid,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.picc_guard_final_registration() FROM public,anon,authenticated;
COMMIT;
