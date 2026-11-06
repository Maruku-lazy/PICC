import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, CheckCircle2, ClipboardCheck, FileText, Info, MessageSquareText } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useDemo } from '../context/DemoContext';
import { statusDescription, statusLabel, type ApplicationStatus } from '../types';
import { getDocumentRequirements, ID_PHOTO_REQUIREMENT } from '../data/documentRequirements';
import './DocumentUploads.css';
import './EnrollmentWorkflow.css';
import DocumentPreview from '../components/DocumentPreview';
import DocumentAuditPanel from '../components/DocumentAuditPanel';
import RegistrarSubjectAssignment from '../components/RegistrarSubjectAssignment';
import RegistrarEnrollmentConfirmation from '../components/RegistrarEnrollmentConfirmation';
import { useCallback } from 'react';
import { listApplicationDocuments, type ApplicationDocument } from '../services/documentService';

function formatPeso(value?: string) {
  if (!value?.trim()) return undefined;
  const amount = Number(value);
  return Number.isFinite(amount)
    ? amount.toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })
    : value;
}

function Detail({ label, value }: { label: string; value?: string }) {
  return <div className="detail"><small>{label}</small><strong>{value || '—'}</strong></div>;
}

export default function RegistrarApplication() {
  const { id, step } = useParams<{ id: string; step?: string }>();
  const activeStep = ['documents', 'subjects', 'confirmation'].includes(step ?? '') ? step! : 'form';
  const steps = [
    { id: 'form', label: 'Enrollment form', description: 'Review applicant information' },
    { id: 'documents', label: 'Documentary requirements', description: 'AI findings and final verdicts' },
    { id: 'subjects', label: 'Subjects and sections', description: 'Assign classes and schedules' },
    { id: 'confirmation', label: 'Enrollment confirmation', description: 'Assessment, payment and COR' },
  ] as const;
  const stepIndex = steps.findIndex(item => item.id === activeStep);
  const stepPath = (name: string) => `/registrar/applications/${id}${name === 'form' ? '' : `/${name}`}`;
  const navigate = useNavigate();
  const { applications, changeStatus, dataLoading, isSupabase } = useDemo();
  const app = applications.find((application) => application.id === id && application.status !== 'draft');
  const [note, setNote] = useState(app?.reviewerNote || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadedDocuments, setUploadedDocuments] = useState<ApplicationDocument[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState('');

  const refreshDocuments = useCallback(async (silent = false) => {
    if (!isSupabase || !id) return;
    if (!silent) setDocumentsLoading(true);
    setDocumentsError('');
    try {
      const documents = await listApplicationDocuments(id);
      setUploadedDocuments(documents);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not load documents.';
      setDocumentsError(message);
      throw cause;
    } finally {
      if (!silent) setDocumentsLoading(false);
    }
  }, [isSupabase, id]);

  useEffect(() => { window.scrollTo(0, 0); }, [activeStep, id]);

  useEffect(() => {
    if (!isSupabase || !id) { setUploadedDocuments([]); return; }
    // The callback reports errors in the existing page message.
    void refreshDocuments().catch(() => {});
  }, [isSupabase, id, refreshDocuments]);


  if (dataLoading) return <div className="soft-panel" role="status">Loading application…</div>;
  if (!app) {
    return <section className="surface-card form-card">
      <h2>Application not found</h2>
      <p className="muted">This application could not be found or you do not have access.</p>
      <Link to="/registrar/dashboard" className="button button-primary">Back to applications</Link>
    </section>;
  }

  async function transition(status: ApplicationStatus) {
    if (saving) return;
    if (status === 'needs_correction' && !note.trim()) {
      setError('Enter a note explaining what the student needs to correct.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await changeStatus(app!.id, status, note.trim());
      // Keep the Registrar in the four-step workflow after starting or completing form review.
      // Correction requests return to the queue, since the student must act next.
      if (status === 'needs_correction') navigate('/registrar/dashboard');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not update application.');
    } finally { setSaving(false); }
  }

  function correctionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void transition('needs_correction');
  }

  const documentRequirements = getDocumentRequirements(app.studentType, app.civilStatus.toLowerCase() === 'married');
  const selectedDocumentCount = documentRequirements.filter((doc) => !doc.physicalOnly && (isSupabase
    ? uploadedDocuments.some((entry) => entry.requirement_type === doc.name)
    : Boolean(app.documentUploads?.[doc.name]))).length;
  const canStart = app.status === 'submitted';
  const canComplete = app.status === 'under_review';

  return <>
    <div className="page-header">
      <div>
        <Link className="back-link" to="/registrar/dashboard"><ArrowLeft size={16} /> Back to application queue</Link>
        <div className="eyebrow">APPLICATION REVIEW</div>
        <h1>{app.fullName || 'Unnamed applicant'}</h1>
        <p className="muted">Created {new Date(app.createdAt).toLocaleDateString()} · Development data</p>
      </div>
      <span className="page-icon"><ClipboardCheck size={28} /></span>
    </div>

    <nav className="workflow-registrar-tabs" aria-label="Registrar application review steps">
      {steps.map((item, index) => (
        <Link key={item.id} to={stepPath(item.id)} aria-current={activeStep === item.id ? 'step' : undefined}
          className={`workflow-registrar-tab ${activeStep === item.id ? 'active' : ''}`}>
          <span className="workflow-tab-number">{index + 1}</span>
          <span className="workflow-tab-label"><strong>{item.label}</strong><small>{item.description}</small></span>
          {index < stepIndex && <CheckCircle2 size={16} aria-hidden="true" />}
        </Link>
      ))}
    </nav>

    {activeStep === 'form' && <div className="review-layout workflow-review-form">
      <div className="form-main">
        <section className="surface-card form-card">
          <div className="section-heading">
            <div><div className="eyebrow">ENROLLMENT INFORMATION</div><h2>Application details</h2></div>
            <span className={`status-pill status-${app.status}`}>{statusLabel[app.status]}</span>
          </div>
          <div className="detail-grid">
            <Detail label="Student classification" value={app.studentType} />
            <Detail label="Academic year" value={app.academicYear} />
            <Detail label="Semester" value={app.semester} />
            <Detail label="Program" value={app.program} />
            <Detail label="Year level" value={app.yearLevel} />
          </div>
        </section>

        <section className="surface-card form-card">
          <div className="section-heading"><h2>Personal information</h2></div>
          <div className="detail-grid">
            <Detail label="Full name" value={app.fullName} />
            <Detail label="Birthdate" value={app.birthDate} />
            <Detail label="Sex" value={app.sex} />
            <Detail label="Civil status" value={app.civilStatus} />
            <Detail label="Religion" value={app.religion} />
            <Detail label="Nationality" value={app.nationality} />
            <Detail label="Ethnicity" value={app.ethnicity} />
            <Detail label="Email" value={app.email} />
            <Detail label="Contact number" value={app.contactNumber} />
            <Detail label="Permanent address" value={app.permanentAddress} />
            <Detail label="Temporary address" value={app.temporaryAddress} />
          </div>
        </section>

        <section className="surface-card form-card">
          <div className="section-heading"><h2>Family and emergency contact</h2></div>
          <div className="detail-grid">
            <Detail label="Father" value={app.fatherName} />
            <Detail label="Father's occupation" value={app.fatherOccupation} />
            <Detail label="Father's phone" value={app.fatherContact} />
            <Detail label="Mother" value={app.motherName} />
            <Detail label="Mother's occupation" value={app.motherOccupation} />
            <Detail label="Mother's phone" value={app.motherContact} />
            <Detail label="Annual family income" value={formatPeso(app.annualFamilyIncome)} />
            <Detail label="4Ps member" value={app.fourPsMember === 'yes' ? 'Yes' : app.fourPsMember === 'no' ? 'No' : undefined} />
            <Detail label="Emergency contact" value={app.emergencyContact} />
            <Detail label="Relationship" value={app.emergencyRelationship} />
            <Detail label="Emergency phone" value={app.emergencyPhone} />
            <Detail label="Emergency address" value={app.emergencyAddress} />
          </div>
        </section>

        <section className="surface-card form-card">
          <div className="section-heading"><h2>Previous academic record</h2></div>
          <div className="detail-grid">
            <Detail label="Last school attended" value={app.previousSchool} />
            <Detail label="Date graduated" value={app.graduationDate} />
            <Detail label="Awards received" value={app.awardsReceived} />
          </div>
        </section>

      </div>
      <aside className="form-side">
        <section className="surface-card help-card">
          <div className="form-section-heading compact">
            <span className="form-heading-icon"><MessageSquareText size={19} /></span>
            <div><h2>Review actions</h2><p>{statusDescription[app.status]}</p></div>
          </div>
          {error && <div className="notice-error" role="alert">{error}</div>}
          <form onSubmit={correctionSubmit} className="review-actions">
            <label className="form-field"><span>Registrar note</span>
              <textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)}
                disabled={app.status === 'documents_verified'}
                placeholder="Explain corrections or review notes" />
            </label>
            {canStart && <button type="button" disabled={saving} className="button button-secondary full-button" onClick={() => void transition('under_review')}>Mark under review</button>}
            {(app.status === 'submitted' || canComplete) && <button disabled={saving} className="button button-outline-warning full-button" type="submit">Request corrections</button>}
            {canComplete && <button type="button" disabled={saving} className="button button-primary full-button" onClick={() => void transition('documents_verified')}>Complete form review (no document verification)</button>}
            {app.status === 'documents_verified' && <div className="notice-success"><ClipboardCheck size={18} /> Form review marked complete. Uploaded documents are not verified.</div>}
          </form>
        </section>
      </aside>
    </div>}

    {activeStep === 'documents' && <div className="workflow-document-page">
      <div className="workflow-step-intro"><h2>Documentary requirements and AI screening</h2>
        <p>Check the actual scan and compare preliminary AI findings before recording each independent Registrar verdict.</p></div>
        <section className="surface-card form-card">
          <div className="form-section-heading">
            <span className="form-heading-icon"><FileText size={19} /></span>
            <div><h2>Document selection record</h2><p>{isSupabase ? 'Private scanned documents uploaded by the applicant.' : 'Filenames from the student application (demo only).'}</p></div>
          </div>
          {documentsLoading && <div className="soft-panel" role="status">Loading scanned documents…</div>}
          {documentsError && <div className="notice-error" role="alert">{documentsError}</div>}
          {documentRequirements.length > 0 ? (
            <>
              <div className="document-progress">
                <span>Scanned documents selected</span>
                <strong>{selectedDocumentCount} / {documentRequirements.filter((doc) => !doc.physicalOnly).length}</strong>
              </div>
              <ul className="document-upload-list">
                {documentRequirements.map((doc) => {
                  const record = isSupabase ? uploadedDocuments.find((entry) => entry.requirement_type === doc.name) : undefined;
                  const filename = isSupabase ? record?.original_filename : app.documentUploads?.[doc.name];
                  return (
                    <li key={doc.name} className="document-upload-row">
                      <div className="document-upload-description">
                        <FileText size={18} aria-hidden="true" />
                        <div>
                          <strong>{doc.name}</strong>
                          {doc.physicalOnly ? (
                            <small>Physical submission required</small>
                          ) : (
                            <small className={filename ? 'document-selected' : ''}>
                              {filename ? `${isSupabase ? 'Uploaded filename' : 'Selected filename'}: ${filename}` : 'No file uploaded'}
                            </small>
                          )}
                        </div>
                      </div>
                      {!doc.physicalOnly && (
                        <div className="document-upload-actions">
                          {record && <DocumentPreview path={record.storage_path} filename={record.original_filename} contentType={record.content_type} enableOcr={doc.name !== ID_PHOTO_REQUIREMENT} requirementType={doc.name} applicant={app} applicationId={app.id} documentId={record.id} />}
                          <span className={`document-record-badge${filename ? ' selected' : ''}`}>
                            {filename ? isSupabase ? 'Uploaded' : 'Filename listed' : 'Missing'}
                          </span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <div className="soft-panel"><Info size={19} /><span>
              Returning-student requirements have not yet been confirmed with the Registrar.
            </span></div>
          )}
          <div className="soft-panel"><Info size={19} /><span>
            {isSupabase ? 'In-app file previews are time-limited and permitted only for authorized accounts. JPG/PNG uploads trigger preliminary OCR in the student browser. The screening overview below shows saved findings and lets the Registrar record a separate Pass/Fail/Follow-up verdict after manual inspection. Enrollment status is independent.' : 'This is a filename-only demo. Actual scanned files are NOT stored, and no AI verification has occurred.'}
          </span></div>
        </section>
      {isSupabase && id && documentRequirements.length > 0 && (
        <div className="surface-card workflow-audit-card">
          <div className="workflow-step-intro"><h2>Document completeness and final decisions</h2>
            <p>Full-width review: expand AI findings, preview scans, and choose Pass, Fail, or Needs follow-up for each file.</p></div>
          <DocumentAuditPanel
            key={id}
            applicationId={id}
            applicant={app}
            reviewable={['submitted', 'under_review', 'documents_verified'].includes(app.status)}
            requirements={documentRequirements}
            documents={uploadedDocuments}
            documentsLoading={documentsLoading}
            documentsError={documentsError}
            refreshDocuments={refreshDocuments}
          />
        </div>
      )}
    </div>}

    {activeStep === 'subjects' && <div className="workflow-feature-page">
      <div className="workflow-step-intro"><h2>Subject and section assignment</h2>
        <p>Assign eligible offerings, confirm section capacity, and check that class times do not overlap.</p></div>
      {isSupabase ? <RegistrarSubjectAssignment key={app.id} application={app} /> : <div className="soft-panel">Academic assignments are available in Supabase mode.</div>}
    </div>}

    {activeStep === 'confirmation' && <div className="workflow-feature-page">
      <div className="workflow-step-intro"><h2>Assessment and final enrollment confirmation</h2>
        <p>After form, document, and subject checks, record external payment verification and confirm enrollment.</p></div>
      {isSupabase ? <RegistrarEnrollmentConfirmation key={`enrollment-${app.id}`} application={app} /> : <div className="soft-panel">Enrollment confirmation is available in Supabase mode.</div>}
    </div>}

    <div className="workflow-step-footer">
      {stepIndex > 0 ? <Link className="button button-secondary" to={stepPath(steps[stepIndex - 1].id)}><ArrowLeft size={17}/> Previous step</Link> : <span />}
      {stepIndex < steps.length - 1 ? <Link className="button button-primary" to={stepPath(steps[stepIndex + 1].id)}>Next: {steps[stepIndex + 1].label} <ArrowRight size={17}/></Link> : <Link className="button button-secondary" to="/registrar/dashboard">Return to application queue</Link>}
    </div>
  </>
}
