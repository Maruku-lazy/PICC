import { useState, type FormEvent } from 'react';
import { ArrowLeft, ClipboardCheck, FileText, Info, MessageSquareText } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useDemo } from '../context/DemoContext';
import { statusDescription, statusLabel, type ApplicationStatus } from '../types';
import { getDocumentRequirements } from '../data/documentRequirements';
import './DocumentUploads.css';

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
  const { id } = useParams();
  const navigate = useNavigate();
  const { applications, changeStatus, dataLoading, isSupabase } = useDemo();
  const app = applications.find((application) => application.id === id && application.status !== 'draft');
  const [note, setNote] = useState(app?.reviewerNote || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

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
      navigate('/registrar/dashboard');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not update application.');
    } finally { setSaving(false); }
  }

  function correctionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void transition('needs_correction');
  }

  const documentRequirements = getDocumentRequirements(app.studentType, app.civilStatus.toLowerCase() === 'married');
  const selectedDocumentCount = documentRequirements.filter((doc) => !doc.physicalOnly && !!app.documentUploads?.[doc.name]).length;
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

    <div className="review-layout">
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

        <section className="surface-card form-card">
          <div className="form-section-heading">
            <span className="form-heading-icon"><FileText size={19} /></span>
            <div><h2>Document selection record</h2><p>{isSupabase ? 'Private scanned document uploads are not yet enabled.' : 'Filenames from the student application (demo only).'}</p></div>
          </div>
          {documentRequirements.length > 0 ? (
            <>
              <div className="document-progress">
                <span>Scanned documents selected</span>
                <strong>{selectedDocumentCount} / {documentRequirements.filter((doc) => !doc.physicalOnly).length}</strong>
              </div>
              <ul className="document-upload-list">
                {documentRequirements.map((doc) => {
                  const filename = app.documentUploads?.[doc.name];
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
                              {filename ? `Selected filename: ${filename}` : 'No file selected'}
                            </small>
                          )}
                        </div>
                      </div>
                      {!doc.physicalOnly && (
                        <span className={`document-record-badge${filename ? ' selected' : ''}`}>
                          {filename ? 'Filename listed' : 'Missing'}
                        </span>
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
            {isSupabase ? 'No files are uploaded yet. Actual scanned documents and AI verification are planned for the next phase.' : 'This is a filename-only demo. Actual scanned files are NOT stored or available to open, and no AI or registrar document verification has occurred.'}
          </span></div>
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
    </div>
  </>;
}
