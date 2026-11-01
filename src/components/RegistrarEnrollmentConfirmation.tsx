import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CreditCard, Info, RefreshCw, ShieldCheck } from 'lucide-react';
import type { EnrollmentApplication } from '../types';
import { getDocumentRequirements } from '../data/documentRequirements';
import { loadStudentAssignments } from '../services/assignmentService';
import { listApplicationDocuments } from '../services/documentService';
import { assessDocuments, fetchAuditHistory } from '../services/documentAuditService';
import {
  confirmFinalEnrollment, fetchAssessmentEvents, fetchEnrollmentOutcome, peso,
  recordEnrollmentAssessment, type AssessmentEvent, type EnrollmentAssessment,
  type EnrollmentConfirmation, type PaymentStatus,
} from '../services/enrollmentConfirmationService';
import RegistrationCertificate from './RegistrationCertificate';
import { assessEnrollmentReadiness } from '../services/enrollmentReadiness';
import './EnrollmentConfirmation.css';

type Eligibility = { expected: number; passed: number; assignments: number; note: string };

export default function RegistrarEnrollmentConfirmation({ application }: { application: EnrollmentApplication }) {
  const [assessment, setAssessment] = useState<EnrollmentAssessment | null>(null);
  const [confirmation, setConfirmation] = useState<EnrollmentConfirmation | null>(null);
  const [events, setEvents] = useState<AssessmentEvent[]>([]);
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState<PaymentStatus>('pending');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [attested, setAttested] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);

  const reload = useCallback(async (resetForm = false) => {
    setLoading(true);
    try {
      const [outcome, history, docs, audits, allocated] = await Promise.all([
        fetchEnrollmentOutcome(application.id),
        fetchAssessmentEvents(application.id),
        listApplicationDocuments(application.id),
        fetchAuditHistory(application.id),
        loadStudentAssignments(application.id),
      ]);
      const requirements = getDocumentRequirements(application.studentType, application.civilStatus.toLowerCase() === 'married');
      const summary = assessDocuments(requirements, docs, audits.screenings, audits.reviews, audits.verdicts);
      setEligibility({ expected: summary.required, passed: summary.items.filter((d) => d.state === 'passed').length,
        assignments: allocated.assignments.length,
        note: requirements.length ? '' : 'Requirements for returning students still need approval by PiCC.' });
      setAssessment(outcome.assessment);
      setConfirmation(outcome.confirmation);
      setEvents(history);
      if (resetForm) {
        setAmount(outcome.assessment ? String(outcome.assessment.assessed_amount) : '');
        setStatus(outcome.assessment?.payment_status || 'pending');
        setReference(outcome.assessment?.external_reference || '');
        setNote(outcome.assessment?.payment_note || '');
      }
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load assessment details.');
    } finally { setLoading(false); }
  }, [application.id, application.studentType, application.civilStatus]);

  useEffect(() => { void reload(true); }, [reload]);

  async function saveAssessment() {
    if (busy || confirmation) return;
    if (!amount.trim() || !/^\d+(?:\.\d{1,2})?$/.test(amount.trim())) {
      setError('Enter a valid, nonnegative assessment amount in PHP.'); return;
    }
    setBusy(true);setError('');setNotice('');
    try {
      await recordEnrollmentAssessment({applicationId: application.id,amount: Number(amount),paymentStatus:status,
        externalReference:reference.trim(),paymentNote:note.trim()});
      await reload(true);
      setNotice('Assessment recorded. Payment verification is a Registrar declaration, not an online transaction.');
    } catch (cause) {setError(cause instanceof Error ? cause.message : 'Unable to save assessment.');}
    finally {setBusy(false);}
  }

  const readiness = assessEnrollmentReadiness({
    applicationStatus: application.status, requiredDocuments: eligibility?.expected ?? 0,
    passedDocuments: eligibility?.passed ?? 0, assignedCourses: eligibility?.assignments ?? 0,
    paymentStatus: assessment?.payment_status ?? null,
  });
  const canConfirm = !confirmation && !busy && !loading && readiness.ready && attested;

  async function finalize() {
    if (!canConfirm) return;
    if (!window.confirm('Confirm final enrollment for this student? This permanently locks subject assignments and assessment in this development workflow.')) return;
    setBusy(true);setError('');setNotice('');
    try {
      await confirmFinalEnrollment(application.id);
      await reload(true);
      setNotice('Enrollment confirmed and a registration snapshot created.');
      setAttested(false);
    } catch (cause) {setError(cause instanceof Error ? cause.message : 'Final confirmation was rejected.');}
    finally {setBusy(false);}
  }

  return <section className="surface-card ec-panel" aria-label="Registrar assessment and final enrollment">
    <div className="section-heading"><div><div className="eyebrow">ASSESSMENT AND CONFIRMATION</div><h2><CreditCard size={20}/> Registrar enrollment confirmation</h2></div>
      <button type="button" className="ec-refresh" disabled={loading || busy} onClick={() => void reload(true)}><RefreshCw size={15}/> Refresh</button>
    </div>
    <p className="muted">Record the school-approved assessment and verification of an <strong>external payment</strong>. This module does not accept or process payments.</p>
    {loading && <p role="status" className="muted">Loading assessment and current verification records…</p>}
    {error && <div className="notice-error" role="alert">{error}</div>}
    {notice && <div className="notice-success" role="status">{notice}</div>}
    {!loading && <>
      {confirmation ? <><div className="notice-success"><CheckCircle2 size={17}/> Final enrollment is confirmed. Assessment and assignments are locked.</div>
        <RegistrationCertificate confirmation={confirmation}/></> : <>
        <div className="ec-fields">
          <label className="ec-field"><span>Assessed amount (PHP) — use approved assessment only</span>
            <input type="number" min="0" max="9999999999.99" step="0.01" value={amount} disabled={busy}
              onChange={e => setAmount(e.target.value)} placeholder="Enter the assessment amount" /></label>
          <label className="ec-field"><span>External payment verification</span>
            <select value={status} disabled={busy} onChange={e => setStatus(e.target.value as PaymentStatus)}>
              <option value="pending">Pending / not verified</option>
              <option value="verified">Verified externally</option>
              <option value="waived">Documented authorized waiver</option>
            </select></label>
          <label className="ec-field"><span>External reference (receipt / ledger / transaction reference)</span>
            <input value={reference} maxLength={150} disabled={busy} onChange={e=>setReference(e.target.value)} placeholder="Required for verified payment" /></label>
          <label className="ec-field ec-span"><span>Verification evidence or waiver authorization note</span>
            <textarea rows={3} value={note} maxLength={1000} disabled={busy}
              onChange={e=>setNote(e.target.value)} placeholder="Describe where the Registrar checked the payment, or the authorized waiver (10+ characters)." /></label>
        </div>
        <button type="button" className="button button-primary" disabled={busy} onClick={() => void saveAssessment()}>
          {busy ? 'Saving…' : 'Save assessment and payment status'}</button>
        {assessment && <div className="ec-hint">Saved: <strong>{peso(assessment.assessed_amount)}</strong> · {assessment.payment_status} · {new Date(assessment.updated_at).toLocaleString('en-PH')}</div>}
        <div className="ec-divider" />
        <h3>Final enrollment readiness</h3>
        <div className="ec-checks">
          <div><span>{readiness.formReviewed ? '✓' : '○'}</span> Form review completed</div>
          <div><span>{readiness.documentsPassed ? '✓' : '○'}</span> All required current documents passed ({eligibility?.passed ?? '—'} / {eligibility?.expected ?? '—'})</div>
          <div><span>{readiness.subjectsAssigned ? '✓' : '○'}</span> Assigned subjects ({eligibility?.assignments ?? '—'})</div>
          <div><span>{readiness.paymentReady ? '✓' : '○'}</span> External payment verified or waiver recorded</div>
        </div>
        {eligibility?.note && <div className="ec-info"><Info size={17}/>{eligibility.note}</div>}
        <label className="ec-attestation"><input type="checkbox" checked={attested} disabled={busy}
          onChange={e=>setAttested(e.target.checked)} /><span>I personally verified the required documents, academic assignments and external payment/waiver evidence. I authorize final enrollment confirmation.</span></label>
        <button type="button" className="button button-primary" disabled={!canConfirm} onClick={() => void finalize()}>
          <ShieldCheck size={17}/> Confirm final enrollment</button>
        <p className="ec-hint">The database independently rechecks these prerequisites before confirmation. Confirmation is permanent in this development phase; changing a confirmed enrollment requires a future authorized correction workflow.</p>
      </>}
      {events.length > 0 && <div className="ec-event-section">
        <button type="button" className="ec-refresh" onClick={() => setHistoryOpen(v => !v)} aria-expanded={historyOpen}>Assessment history ({events.length})</button>
        {historyOpen && <div className="ec-events">{events.map(e => <div key={e.id}>{new Date(e.created_at).toLocaleString('en-PH')} · {peso(e.assessed_amount)} · {e.payment_status}</div>)}</div>}
      </div>}
    </>}
  </section>;
}
