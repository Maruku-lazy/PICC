import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowLeft, BookOpen, CheckCircle2, ClipboardList, FileText,
  HeartHandshake, Info, Save, Send, ShieldAlert, Users, Upload, X,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useDemo } from '../context/DemoContext';
import {
  blankApplication, PROGRAMS, statusLabel,
  type ApplicationInput, type EnrollmentApplication, type StudentType,
} from '../types';
import { getDocumentRequirements, ID_PHOTO_REQUIREMENT } from '../data/documentRequirements';
import './DocumentUploads.css';
import DocumentPreview from '../components/DocumentPreview';
import { findMyApplicationId, listApplicationDocuments, uploadApplicationDocument, removeApplicationDocument, type ApplicationDocument } from '../services/documentService';

type TextKey = Exclude<keyof ApplicationInput, 'declarationConfirmed' | 'documentUploads'>;

type TextFieldProps = {
  field: TextKey;
  label: string;
  form: ApplicationInput;
  onChange: (field: TextKey, value: string) => void;
  required?: boolean;
  type?: string;
  placeholder?: string;
  full?: boolean;
  hint?: string;
};

function TextField({
  field, label, form, onChange, required, type = 'text',
  placeholder, full, hint,
}: TextFieldProps) {
  return (
    <label className={`form-field${full ? ' full' : ''}`}>
      <span>{label} {required && <b>*</b>}</span>
      <input
        name={field}
        type={type}
        value={String(form[field])}
        onChange={(event) => onChange(field, event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        {...(type === 'number' ? { min: 0, step: '0.01', inputMode: 'decimal' as const } : {})}
      />
      {hint && <small className="field-hint">{hint}</small>}
    </label>
  );
}

function FormSection({
  icon, title, description, children,
}: {
  icon: ReactNode; title: string; description: string; children: ReactNode;
}) {
  return (
    <section className="surface-card form-card">
      <div className="form-section-heading">
        <span className="form-heading-icon">{icon}</span>
        <div><h2>{title}</h2><p>{description}</p></div>
      </div>
      {children}
    </section>
  );
}

function restoreForm(app?: EnrollmentApplication): ApplicationInput {
  if (!app) return { ...blankApplication, documentUploads: {} };
  // Select known fields only: never let saved record metadata overwrite the form.
  const restored = { ...blankApplication, documentUploads: {} };
  for (const key of Object.keys(blankApplication) as (keyof ApplicationInput)[]) {
    const value = app[key];
    if (key === 'declarationConfirmed') {
      restored.declarationConfirmed = value === true;
    } else if (key === 'documentUploads' && value && typeof value === 'object' && !Array.isArray(value)) {
      // Only restore the filenames; no scanned images are kept in localStorage.
      restored.documentUploads = Object.fromEntries(
        Object.entries(value).filter(([name, filename]) =>
          typeof name === 'string' && typeof filename === 'string'
        )
      );
    } else if (typeof value === 'string') {
      Object.assign(restored, { [key]: value });
    }
  }
  return restored;
}

function applicantName(form: ApplicationInput) {
  return [form.firstName, form.middleName, form.lastName, form.suffix]
    .map((part) => part.trim()).filter(Boolean).join(' ');
}

function validate(form: ApplicationInput): string[] {
  const required: Array<[TextKey, string]> = [
    ['academicYear', 'Academic year'], ['program', 'Program'],
    ['yearLevel', 'Year level'], ['firstName', 'First name'],
    ['lastName', 'Last name'], ['birthDate', 'Birthdate'],
    ['sex', 'Sex'], ['civilStatus', 'Civil status'],
    ['permanentAddress', 'Permanent address'],
    ['contactNumber', 'Contact number'], ['email', 'Email address'],
    ['emergencyContact', 'Emergency contact name'],
    ['emergencyRelationship', 'Emergency relationship'],
    ['emergencyPhone', 'Emergency contact number'],
    ['previousSchool', 'Last school attended'],
  ];
  const errors: string[] = [];
  const missing = required.filter(([key]) => !form[key].trim()).map(([, label]) => label);
  if (missing.length) errors.push(`Complete these fields: ${missing.join(', ')}.`);
  if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    errors.push('Enter a valid email address.');
  }
  for (const [value, label] of [
    [form.contactNumber, 'Contact number'],
    [form.emergencyPhone, 'Emergency contact number'],
  ]) {
    if (value && !/^[+\d\s()\-]{7,20}$/.test(value.trim())) {
      errors.push(`${label} must contain 7–20 valid phone characters.`);
    }
  }
  // Income is optional in this frontend prototype; if supplied, it must be
  // non-negative and have at most two decimal places.
  for (const [value, label] of [
    [form.annualFamilyIncome, 'Annual family income'],
  ]) {
    if (value.trim() && !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) {
      errors.push(`${label} must be a non-negative amount with up to two decimal places.`);
    }
  }
  if (form.birthDate && form.birthDate > new Date().toLocaleDateString('en-CA')) {
    errors.push('Birthdate cannot be in the future.');
  }
  if (form.graduationDate && form.graduationDate > new Date().toLocaleDateString('en-CA')) {
    errors.push('Graduation date cannot be in the future.');
  }
  if (form.academicYear && !/^\d{4}\s*[-–]\s*\d{4}$/.test(form.academicYear.trim())) {
    errors.push('Academic year must use a format like 2026-2027.');
  }
  if (!form.declarationConfirmed) errors.push('Check the applicant declaration before submitting.');
  return errors;
}

export default function ApplicationPage() {
  const { applications, saveApplication, userId, isSupabase, dataLoading } = useDemo();
  const navigate = useNavigate();
  const app = applications.find((a) => a.studentId === userId);
  const [form, setForm] = useState<ApplicationInput>(() => restoreForm(app));
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadedDocuments, setUploadedDocuments] = useState<ApplicationDocument[]>([]);
  const [documentApplicationId, setDocumentApplicationId] = useState<string | null>(null);
  const [uploadingRequirement, setUploadingRequirement] = useState<string | null>(null);
  const [documentNotice, setDocumentNotice] = useState('');
  const editable = !app || app.status === 'draft' || app.status === 'needs_correction';

  useEffect(() => {
    if (app) setForm(restoreForm(app));
  }, [app?.id, app?.updatedAt]);

  const applicationId = app?.id ?? documentApplicationId;
  useEffect(() => {
    if (!isSupabase || !applicationId) { setUploadedDocuments([]); return; }
    let cancelled = false;
    void listApplicationDocuments(applicationId).then((documents) => {
      if (!cancelled) setUploadedDocuments(documents);
    }).catch((cause: unknown) => {
      if (!cancelled) setErrors([cause instanceof Error ? cause.message : 'Could not load uploaded scans.']);
    });
    return () => { cancelled = true; };
  }, [isSupabase, applicationId]);

  async function reloadDocuments(id: string) {
    const documents = await listApplicationDocuments(id);
    setUploadedDocuments(documents);
  }


  useEffect(() => {
    if (!saved) return;
    const timeout = window.setTimeout(() => setSaved(false), 3500);
    return () => window.clearTimeout(timeout);
  }, [saved]);

  function update(field: TextKey, value: string) {
    setForm((previous) => ({ ...previous, [field]: value }));
    setSaved(false);
    setErrors([]);
  }

  async function handleDocumentSelection(documentName: string, file: File | undefined) {
    if (!file || uploadingRequirement) return;
    const validExtension = /\.(jpe?g|png|pdf)$/i.test(file.name);
    const acceptedMime = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!validExtension || (isSupabase && !acceptedMime.includes(file.type)) ||
        (!isSupabase && file.type && !acceptedMime.includes(file.type))) {
      setErrors(['Please select a JPG, PNG, or PDF file.']);
      return;
    }
    if (documentName === ID_PHOTO_REQUIREMENT && !['image/jpeg', 'image/png'].includes(file.type)) {
      setErrors(['For the 2×2 ID photo, upload one JPG or PNG image.']);
      return;
    }
    if (file.size < 1 || file.size > 10 * 1024 * 1024) {
      setErrors(['Scanned documents must be between 1 byte and 10 MB.']);
      return;
    }
    if (!isSupabase) {
      setForm((previous) => ({
        ...previous, documentUploads: { ...previous.documentUploads, [documentName]: file.name },
      }));
      setErrors([]); setSaved(false);
      return;
    }

    setUploadingRequirement(documentName);
    setErrors([]); setDocumentNotice('');
    try {
      let id = applicationId;
      if (!id) {
        // A new application must have a database ID before Storage can accept a scan.
        const output: ApplicationInput = {
          ...form,
          fullName: applicantName(form),
          academicTerm: `${form.semester} Semester, AY ${form.academicYear}`,
        };
        await saveApplication(output, false);
        id = await findMyApplicationId();
        setDocumentApplicationId(id);
      }
      const previous = uploadedDocuments.find((document) => document.requirement_type === documentName);
      await uploadApplicationDocument(id, documentName, file, previous);
      await reloadDocuments(id);
      setDocumentNotice(`${documentName} uploaded to private storage.`);
    } catch (cause) {
      setErrors([cause instanceof Error ? cause.message : 'Could not upload the scanned document.']);
    } finally {
      setUploadingRequirement(null);
    }
  }

  async function removeDocumentSelection(documentName: string) {
    if (!isSupabase) {
      setForm((previous) => {
        const documentUploads = { ...previous.documentUploads };
        delete documentUploads[documentName];
        return { ...previous, documentUploads };
      });
      setSaved(false);
      return;
    }
    const document = uploadedDocuments.find((entry) => entry.requirement_type === documentName);
    if (!document || uploadingRequirement) return;
    setUploadingRequirement(documentName);
    setErrors([]); setDocumentNotice('');
    try {
      await removeApplicationDocument(document);
      await reloadDocuments(document.application_id);
      setDocumentNotice(`${documentName} removed.`);
    } catch (cause) {
      setErrors([cause instanceof Error ? cause.message : 'Could not remove the scanned document.']);
    } finally {
      setUploadingRequirement(null);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable || saving) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const submit = submitter?.getAttribute('data-intent') === 'submit';
    const issues = submit ? validate(form) : [];
    if (issues.length) {
      setErrors(issues);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    const output: ApplicationInput = {
      ...form,
      fullName: applicantName(form),
      academicTerm: `${form.semester} Semester, AY ${form.academicYear}`,
    };
    setErrors([]);
    setSaving(true);
    try {
      await saveApplication(output, submit);
      if (submit) navigate('/student/dashboard');
      else setSaved(true);
    } catch (error) {
      setErrors([error instanceof Error ? error.message : 'Could not save application.']);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally { setSaving(false); }
  }

  const needsMarriageCertificate = form.civilStatus.toLowerCase() === 'married';
  const selectedDocs = getDocumentRequirements(form.studentType, needsMarriageCertificate);
  const scannableDocs = selectedDocs.filter((doc) => !doc.physicalOnly);
  const selectedCount = scannableDocs.filter((doc) => isSupabase
    ? uploadedDocuments.some((record) => record.requirement_type === doc.name)
    : Boolean(form.documentUploads[doc.name])).length;

  if (dataLoading) return <div className="soft-panel" role="status">Loading your application…</div>;

  return (
    <>
      <div className="page-header">
        <div>
          <Link to="/student/dashboard" className="back-link"><ArrowLeft size={16} /> Back to dashboard</Link>
          <div className="eyebrow">ENROLLMENT APPLICATION · PiCC F2-INSPIRED</div>
          <h1>{app ? 'My enrollment application' : 'New enrollment application'}</h1>
          <p className="muted">Complete the sections using fictional information for development testing.</p>
        </div>
        <span className="page-icon"><ClipboardList size={28} /></span>
      </div>

      {errors.length > 0 && (
        <div className="notice-error enrollment-errors" role="alert">
          <strong>Please correct the following:</strong>
          <ul>{errors.map((message) => <li key={message}>{message}</li>)}</ul>
        </div>
      )}
      {saved && <div className="notice-success" role="status"><CheckCircle2 size={18} /> {isSupabase ? 'Draft saved in Supabase.' : 'Draft saved in this browser.'}</div>}
      {documentNotice && <div className="notice-success" role="status"><CheckCircle2 size={18} /> {documentNotice}</div>}
      {app?.status === 'needs_correction' && (
        <div className="notice-warning"><strong>Registrar requested a correction</strong><p>{app.reviewerNote}</p></div>
      )}
      {app && !editable && (
        <div className="soft-panel"><Info size={18} />
          <span>Application is <strong>{statusLabel[app.status]}</strong>. Editing is locked during review.</span>
        </div>
      )}

      {isSupabase && <div className="soft-panel"><Info size={18}/><span>Scanned-document upload is not available yet in this backend phase. File selections are disabled until private storage is ready.</span></div>}
      <div className="form-layout">
        <div className="form-main">
          <form id="student-enrollment-form" onSubmit={handleSubmit} noValidate>
            <fieldset className="plain-fieldset" disabled={!editable || saving}>
              <FormSection icon={<BookOpen size={19} />} title="1. Enrollment information" description="Select the academic period and curriculum track.">
                <div className="form-grid">
                  <label className="form-field"><span>Classification <b>*</b></span>
                    <select value={form.studentType} onChange={(e) => {
                      const studentType = e.target.value as StudentType;
                      setForm((prior) => ({ ...prior, studentType, yearLevel: studentType === 'freshman' ? '1' : prior.yearLevel }));
                      setErrors([]);
                    }}>
                      <option value="freshman">Incoming freshman</option>
                      <option value="transferee">Transferee</option>
                      <option value="returning">Returning student</option>
                    </select>
                  </label>
                  <TextField field="academicYear" label="Academic year" required form={form} onChange={update} placeholder="2026-2027" />
                  <label className="form-field"><span>Semester <b>*</b></span>
                    <select value={form.semester} onChange={(e) => update('semester', e.target.value)}>
                      <option value="1st">First semester</option>
                      <option value="2nd">Second semester</option>
                      <option value="summer">Summer</option>
                    </select>
                  </label>
                  <label className="form-field"><span>Year level <b>*</b></span>
                    <select value={form.yearLevel} disabled={form.studentType === 'freshman' || !editable} onChange={(e) => update('yearLevel', e.target.value)}>
                      {['1', '2', '3', '4'].map((year) => <option key={year} value={year}>{year}</option>)}
                    </select>
                  </label>
                  <label className="form-field full"><span>Course / program <b>*</b></span>
                    <select value={form.program} onChange={(e) => update('program', e.target.value)}>
                      <option value="">Select an academic program</option>
                      {PROGRAMS.map((program) => <option key={program} value={program}>{program}</option>)}
                    </select>
                  </label>
                </div>
              </FormSection>

              <FormSection icon={<FileText size={19} />} title="2. Personal data" description="Corresponds to the personal-data section of the PiCC enrollment form.">
                <div className="form-grid">
                  <TextField field="lastName" label="Last name" required form={form} onChange={update} />
                  <TextField field="firstName" label="First name" required form={form} onChange={update} />
                  <TextField field="middleName" label="Middle name" form={form} onChange={update} />
                  <TextField field="suffix" label="Suffix" form={form} onChange={update} placeholder="Jr., III, if any" />
                  <TextField field="birthDate" label="Birthdate" required type="date" form={form} onChange={update} />
                  <label className="form-field"><span>Sex <b>*</b></span>
                    <select value={form.sex} onChange={(e) => update('sex', e.target.value)}>
                      <option value="">Select</option><option value="Female">Female</option>
                      <option value="Male">Male</option><option value="Prefer not to say">Prefer not to say (demo)</option>
                    </select>
                  </label>
                  <label className="form-field"><span>Civil status <b>*</b></span>
                    <select value={form.civilStatus} onChange={(e) => update('civilStatus', e.target.value)}>
                      <option value="">Select</option><option value="Single">Single</option>
                      <option value="Married">Married</option><option value="Other">Other</option>
                    </select>
                  </label>
                  <TextField field="religion" label="Religion" form={form} onChange={update} placeholder="Optional" />
                  <TextField field="nationality" label="Nationality" form={form} onChange={update} placeholder="e.g., Filipino" />
                  <TextField field="ethnicity" label="Ethnicity" form={form} onChange={update} placeholder="Optional" />
                  <TextField field="contactNumber" label="Contact number" required type="tel" form={form} onChange={update} />
                  <TextField field="email" label="Email address" required type="email" form={form} onChange={update} />
                  <TextField field="permanentAddress" label="Permanent address" required full form={form} onChange={update} />
                  <TextField field="temporaryAddress" label="Temporary address" full form={form} onChange={update} hint="Optional if same as permanent address" />
                </div>
              </FormSection>

              <FormSection icon={<Users size={19} />} title="3. Parent information" description="Enter available parent or guardian information.">
                <div className="form-grid">
                  <TextField field="fatherName" label="Father's full name" form={form} onChange={update} />
                  <TextField field="fatherOccupation" label="Father's occupation" form={form} onChange={update} />
                  <TextField field="fatherContact" label="Father's contact number" type="tel" form={form} onChange={update} />
                  <div />
                  <TextField field="motherName" label="Mother's full name" form={form} onChange={update} />
                  <TextField field="motherOccupation" label="Mother's occupation" form={form} onChange={update} />
                  <TextField field="motherContact" label="Mother's contact number" type="tel" form={form} onChange={update} />
                  <div className="income-row-spacer" aria-hidden="true" />
                  <TextField field="annualFamilyIncome" label="Annual family income (PHP)" type="number" form={form} onChange={update} placeholder="e.g., 180000" />
                  <label className="form-field">
                    <span>4Ps member (Pantawid Pamilyang Pilipino Program)</span>
                    <select value={form.fourPsMember} onChange={(e) => update('fourPsMember', e.target.value as ApplicationInput['fourPsMember'])}>
                      <option value="">Select an answer</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </label>
                  <p className="field-hint" style={{ gridColumn: '1 / -1' }}>Use fictional values only. Financial and 4Ps information is optional in development.</p>
                </div>
              </FormSection>

              <FormSection icon={<HeartHandshake size={19} />} title="4. Emergency contact" description="Person to contact in an emergency.">
                <div className="form-grid">
                  <TextField field="emergencyContact" label="Full name" required form={form} onChange={update} />
                  <TextField field="emergencyRelationship" label="Relationship" required form={form} onChange={update} />
                  <TextField field="emergencyPhone" label="Contact number" required type="tel" form={form} onChange={update} />
                  <TextField field="emergencyAddress" label="Address" full form={form} onChange={update} />
                </div>
              </FormSection>

              <FormSection icon={<BookOpen size={19} />} title="5. Academic record" description="Information about your previous school.">
                <div className="form-grid">
                  <TextField field="previousSchool" label="Last school attended" required full form={form} onChange={update} />
                  <TextField field="graduationDate" label="Date graduated" type="date" form={form} onChange={update} />
                  <TextField field="awardsReceived" label="Awards received" full form={form} onChange={update} placeholder="Optional" />
                </div>
              </FormSection>

            </fieldset>

            <fieldset className="plain-fieldset document-preview-fieldset">
              <FormSection icon={<ClipboardList size={19} />} title="6. Documentary requirements" description={isSupabase ? "Upload your sample scanned requirements to private Supabase Storage." : "Choose a scanned image or PDF for each applicable document (demo only)."}>
                {form.studentType === 'returning' ? (
                  <div className="soft-panel"><Info size={18} /><span>
                    PiCC F2 does not list a separate returning-student document checklist.
                    Requirements must be confirmed with the Registrar's Office.
                  </span></div>
                ) : (
                  <>
                    <div className="document-progress" role="status">
                      <span>Scanned documents selected</span>
                      <strong>{selectedCount} / {scannableDocs.length}</strong>
                    </div>
                    <ul className="document-upload-list">
                      {selectedDocs.map((document) => {
                        const storedDocument = isSupabase
                          ? uploadedDocuments.find((entry) => entry.requirement_type === document.name)
                          : undefined;
                        const selectedFilename = isSupabase
                          ? storedDocument?.original_filename : form.documentUploads[document.name];
                        return (
                          <li key={document.name} className="document-upload-row">
                            <div className="document-upload-description">
                              <FileText size={18} aria-hidden="true" />
                              <div>
                                <strong>{document.name}</strong>
                                {document.physicalOnly ? (
                                  <small>Physical requirement: bring to the Registrar's Office.</small>
                                ) : (
                                  <small className={selectedFilename ? 'document-selected' : ''}>
                                    {selectedFilename ? `${isSupabase ? 'Uploaded' : 'Selected'}: ${selectedFilename}` : 'No file uploaded'}
                                  </small>
                                )}
                              </div>
                            </div>
                            {!document.physicalOnly && (editable || Boolean(storedDocument)) && (
                              <div className="document-upload-actions">
                                {editable && (
                                <label className="document-upload-control">
                                  <Upload size={15} aria-hidden="true" />
                                  {uploadingRequirement === document.name ? 'Uploading…' : selectedFilename ? 'Replace scan' : 'Upload scan'}
                                  <input
                                    type="file" disabled={Boolean(uploadingRequirement) || saving}
                                    accept={document.name === ID_PHOTO_REQUIREMENT ? '.jpg,.jpeg,.png' : '.jpg,.jpeg,.png,.pdf'}
                                    aria-label={`Select scan for ${document.name}`}
                                    onChange={(event) => {
                                      void handleDocumentSelection(document.name, event.currentTarget.files?.[0]);
                                      event.currentTarget.value = '';
                                    }}
                                  />
                                </label>
                                )}
                                {storedDocument && <DocumentPreview path={storedDocument.storage_path} filename={storedDocument.original_filename} contentType={storedDocument.content_type} />}
                                {editable && selectedFilename && (
                                  <button
                                    type="button"
                                    disabled={Boolean(uploadingRequirement) || saving}
                                    className="document-remove-control"
                                    onClick={() => void removeDocumentSelection(document.name)}
                                    aria-label={`Remove selected scan for ${document.name}`}
                                  ><X size={15} /> Remove</button>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
                <div className="soft-panel"><Info size={18} /><span>
                  {isSupabase ? 'Development only: actual scans are stored privately and can be previewed by the student and authorized Registrar. Uploading does not mean AI screening or Registrar approval. Use fictional documents only.' : 'Demo mode: only filenames are saved. Document contents are NOT uploaded. Do not select real student documents.'}
                </span></div>
              </FormSection>

            </fieldset>

            <fieldset className="plain-fieldset" disabled={!editable || saving}>
              <FormSection icon={<ShieldAlert size={19} />} title="7. Review and declaration" description="Confirm your entries before sample submission.">
                <label className="declaration-box">
                  <input
                    type="checkbox"
                    checked={form.declarationConfirmed}
                    onChange={(e) => setForm((current) => ({ ...current, declarationConfirmed: e.target.checked }))}
                  />
                  <span>I confirm that this sample application information is accurate to the best of my knowledge. This demo checkbox is not an official signature or privacy consent form.</span>
                </label>
                <p className="field-hint">PiCC's actual data privacy notice, consent purposes, and signature procedure must be approved before processing real applicant information.</p>
              </FormSection>
            </fieldset>
            {editable && (
              <div className="form-actions">
                <button type="submit" disabled={saving || Boolean(uploadingRequirement)} data-intent="save" className="button button-secondary"><Save size={18} /> Save draft</button>
                <button type="submit" disabled={saving || Boolean(uploadingRequirement)} data-intent="submit" className="button button-primary"><Send size={18} /> Submit sample application</button>
              </div>
            )}
          </form>
        </div>
        <aside className="form-side">
          <section className="surface-card help-card">
            <div className="section-heading"><h2>Application guide</h2></div>
            <div className="help-line"><CheckCircle2 size={18} /><span>Fields marked * are required before submission.</span></div>
            <div className="help-line"><CheckCircle2 size={18} /><span>Save a draft at any point without completing the form.</span></div>
            <div className="help-line"><CheckCircle2 size={18} /><span>Registrar staff can review submitted applications.</span></div>
          </section>
          <section className="surface-card next-module-card">
            <div className="next-module-icon"><ShieldAlert size={23} /></div>
            <h3>Development demo only</h3>
            <p>{isSupabase ? 'Application drafts and sample scans are stored in your development Supabase project. Use fictional data only.' : 'Applications are saved in this browser\'s localStorage. Use fictional data only.'}</p>
            <span className="tag-neutral">{isSupabase ? 'Supabase connected · No AI yet' : 'No Supabase or AI yet'}</span>
          </section>
        </aside>
      </div>
    </>
  );
}
