-- PiCC audit priority hotfix. Apply AFTER Phase 5 on an existing DEV database.
-- Back up first; do not rerun baseline migrations. This migration does not delete applications.
BEGIN;

-- F-01: allow document verdicts after the independent form review is marked
-- complete, but refuse changes after final enrollment. See locking in function.
create or replace function public.record_picc_document_verdict(
  p_document_id uuid, p_storage_path text, p_decision text, p_note text default ''
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_doc public.application_documents%rowtype; v_status text; v_id uuid; v_app_id uuid;
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
  -- Lock the APPLICATION FIRST, matching final-confirmation lock order.
  -- This serializes a verdict with final confirmation, preventing a late edit.
  select application_id into v_app_id from public.application_documents where id=p_document_id;
  if not found then raise exception 'Uploaded document not found'; end if;
  select status into v_status from public.enrollment_applications where id=v_app_id for update;
  if not found or v_status not in ('submitted','under_review','documents_verified') then
    raise exception 'Application must be in review or form review complete' using errcode='42501';
  end if;
  if exists(select 1 from public.picc_enrollment_confirmations where application_id=v_app_id) then
    raise exception 'Final enrollment is already confirmed; document verdicts are locked' using errcode='42501';
  end if;
  select * into v_doc from public.application_documents where id=p_document_id for update;
  if not found or v_doc.application_id <> v_app_id or v_doc.storage_path is distinct from p_storage_path then
    raise exception 'Uploaded document has changed; refresh overview' using errcode='42501';
  end if;
  update public.document_verdicts set superseded_at = now()
    where application_id=v_app_id and document_id=v_doc.id and superseded_at is null;
  insert into public.document_verdicts
    (application_id,document_id,requirement_type,storage_path_snapshot,decision,note,reviewer_id)
  values (v_doc.application_id,v_doc.id,v_doc.requirement_type,v_doc.storage_path,p_decision,
          coalesce(p_note,''),auth.uid()) returning id into v_id;
  return v_id;
end; $$;


-- F-05: enforce submitted form validation at the database API boundary.
create or replace function public.save_my_picc_application(p_form jsonb, p_submit boolean)
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

  -- Security boundary: validation on the server, not just the React form.
  -- Drafts remain intentionally incomplete; only a submitted form must pass.
  if p_submit is true then
    if p_form->>'studentType' not in ('freshman','transferee') then
      raise exception 'Returning-student intake is not enabled until PiCC approves the requirements';
    end if;
    if p_form->>'semester' not in ('1st','2nd','summer')
       or p_form->>'yearLevel' not in ('1','2','3','4')
       or (p_form->>'studentType' = 'freshman' and p_form->>'yearLevel' <> '1') then
      raise exception 'Invalid enrollment semester, classification or year level';
    end if;
    if p_form->>'sex' not in ('Female','Male','Prefer not to say')
       or p_form->>'civilStatus' not in ('Single','Married','Other') then
      raise exception 'Invalid personal information selection';
    end if;
    if coalesce(p_form->>'academicYear','') !~ '^20[0-9]{2}-20[0-9]{2}$'
       or substring(p_form->>'academicYear' from 6 for 4)::int
          <> substring(p_form->>'academicYear' from 1 for 4)::int + 1 then
      raise exception 'Academic year must be consecutive, for example 2026-2027';
    end if;
    if p_form->>'birthDate' is null or p_form->>'birthDate' !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Valid birthdate is required';
    end if;
    if to_char(to_date(p_form->>'birthDate','YYYY-MM-DD'), 'YYYY-MM-DD')
         <> p_form->>'birthDate' or to_date(p_form->>'birthDate','YYYY-MM-DD') > current_date then
      raise exception 'Birthdate is invalid or in the future';
    end if;
    if nullif(btrim(coalesce(p_form->>'graduationDate','')),'') is not null then
      if p_form->>'graduationDate' !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'Invalid graduation date';
      end if;
      if to_char(to_date(p_form->>'graduationDate','YYYY-MM-DD'), 'YYYY-MM-DD')
        <> p_form->>'graduationDate' or to_date(p_form->>'graduationDate','YYYY-MM-DD') > current_date then
        raise exception 'Graduation date is invalid or in the future';
      end if;
    end if;
    if p_form->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'A valid student email address is required';
    end if;
    if p_form->>'contactNumber' !~ '^[+0-9 ()-]{7,20}$'
       or p_form->>'emergencyPhone' !~ '^[+0-9 ()-]{7,20}$' then
      raise exception 'Invalid student or emergency contact number';
    end if;
    if coalesce(p_form->>'annualFamilyIncome','') <> '' and
       p_form->>'annualFamilyIncome' !~ '^[0-9]+(\.[0-9]{1,2})?$' then
      raise exception 'Invalid annual family income';
    end if;
    if p_form->'declarationConfirmed' is distinct from 'true'::jsonb then
      raise exception 'Applicant declaration is required';
    end if;
    if exists (select 1 from unnest(array[
       'program','academicYear','firstName','lastName','birthDate','sex',
       'civilStatus','permanentAddress','contactNumber','email',
       'emergencyContact','emergencyRelationship','emergencyPhone','previousSchool'
     ]) as required(key)
     where jsonb_typeof(p_form->required.key) <> 'string'
       or nullif(btrim(p_form->>required.key),'') is null
       or length(p_form->>required.key) > 500) then
      raise exception 'Submitted application has incomplete or invalid required fields';
    end if;
    -- Academic term/program membership is not yet enforced here because the
    -- current form uses labels, not IDs. Add it only with the catalog UI migration.
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


REVOKE ALL ON FUNCTION public.record_picc_document_verdict(uuid,text,text,text),
  public.save_my_picc_application(jsonb,boolean) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.record_picc_document_verdict(uuid,text,text,text),
  public.save_my_picc_application(jsonb,boolean) TO authenticated;

-- F-06: durable queue for old paths removed via the metadata RPC or a scan
-- replacement. Do not DELETE storage.objects directly through SQL.
CREATE TABLE IF NOT EXISTS public.picc_storage_cleanup_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  application_id uuid NOT NULL,
  storage_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(owner_id, storage_path)
);
CREATE INDEX IF NOT EXISTS picc_pending_storage_cleanup_idx
  ON public.picc_storage_cleanup_queue(owner_id, created_at) WHERE completed_at IS NULL;
ALTER TABLE public.picc_storage_cleanup_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.picc_storage_cleanup_queue FROM anon,authenticated;
-- Queue writes are triggered from changes already authenticated by existing RPCs.
CREATE OR REPLACE FUNCTION public.picc_queue_old_storage_scan()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_owner uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.storage_path IS NOT DISTINCT FROM OLD.storage_path THEN
    RETURN NEW;
  END IF;
  SELECT a.student_id INTO v_owner FROM public.enrollment_applications a WHERE a.id=OLD.application_id;
  IF v_owner IS NOT NULL AND OLD.storage_path LIKE (v_owner::text || '/%') THEN
    INSERT INTO public.picc_storage_cleanup_queue(owner_id,application_id,storage_path)
      VALUES(v_owner,OLD.application_id,OLD.storage_path)
      ON CONFLICT (owner_id,storage_path) DO UPDATE SET completed_at=NULL;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS picc_queue_old_storage_scan ON public.application_documents;
CREATE TRIGGER picc_queue_old_storage_scan
  AFTER UPDATE OF storage_path OR DELETE ON public.application_documents
  FOR EACH ROW EXECUTE FUNCTION public.picc_queue_old_storage_scan();

-- List pending objects for this student only. No unrestricted table access.
CREATE OR REPLACE FUNCTION public.picc_my_pending_storage_cleanup()
RETURNS TABLE(storage_path text) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT public.is_active_picc_student() THEN
    RAISE EXCEPTION 'Student account required' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT q.storage_path FROM public.picc_storage_cleanup_queue q
    WHERE q.owner_id=auth.uid() AND q.completed_at IS NULL
    ORDER BY q.created_at ASC LIMIT 100;
END; $$;

-- Mark complete only after the Storage object is actually gone.
CREATE OR REPLACE FUNCTION public.picc_finish_storage_cleanup(p_storage_path text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT public.is_active_picc_student() THEN
    RAISE EXCEPTION 'Student account required' USING ERRCODE='42501';
  END IF;
  IF EXISTS(SELECT 1 FROM storage.objects
    WHERE bucket_id='picc-enrollment-documents' AND name=p_storage_path) THEN
    RAISE EXCEPTION 'Storage scan still exists; cleanup cannot be acknowledged';
  END IF;
  UPDATE public.picc_storage_cleanup_queue SET completed_at=now()
   WHERE owner_id=auth.uid() AND storage_path=p_storage_path AND completed_at IS NULL;
END; $$;
REVOKE ALL ON FUNCTION public.picc_my_pending_storage_cleanup(),
  public.picc_finish_storage_cleanup(text) FROM public,anon;
GRANT EXECUTE ON FUNCTION public.picc_my_pending_storage_cleanup(),
  public.picc_finish_storage_cleanup(text) TO authenticated;

COMMIT;
