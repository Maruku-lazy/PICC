import { useEffect, useState } from 'react';
import { CheckCircle2, Clock3, Info } from 'lucide-react';
import { useDemo } from '../context/DemoContext';
import { fetchEnrollmentOutcome, peso, type EnrollmentAssessment, type EnrollmentConfirmation } from '../services/enrollmentConfirmationService';
import RegistrationCertificate from './RegistrationCertificate';
import './EnrollmentConfirmation.css';

export default function StudentEnrollmentConfirmation({ applicationId }: { applicationId: string }) {
  const { isSupabase } = useDemo();
  const [assessment, setAssessment] = useState<EnrollmentAssessment | null>(null);
  const [confirmation, setConfirmation] = useState<EnrollmentConfirmation | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!isSupabase) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    fetchEnrollmentOutcome(applicationId)
      .then((data) => { if (active) {setAssessment(data.assessment);setConfirmation(data.confirmation);setError('');} })
      .catch((cause: unknown) => {if(active)setError(cause instanceof Error ? cause.message : 'Enrollment status could not be loaded.');})
      .finally(() => {if(active)setLoading(false);});
    return () => { active = false; };
  }, [applicationId,isSupabase]);
  if (!isSupabase) return null;
  return <section className="surface-card ec-panel" aria-label="Final enrollment status">
    <div className="section-heading"><div><div className="eyebrow">ENROLLMENT CONFIRMATION</div><h2>{confirmation ? <CheckCircle2 size={20}/> : <Clock3 size={20}/>} {confirmation ? 'Enrollment confirmed' : 'Assessment and confirmation'}</h2></div></div>
    {loading && <p role="status" className="muted">Loading enrollment status…</p>}
    {error && <div className="notice-error" role="alert">{error}</div>}
    {!loading && !error && <>
      {!confirmation && <div className="ec-info"><Info size={17}/><span>Final enrollment is pending Registrar confirmation. Subject assignment and document review do not by themselves confirm enrollment.</span></div>}
      {assessment && <div className="ec-summary"><span>Assessed amount: <strong>{peso(assessment.assessed_amount)}</strong></span>
        <span>External payment status: <strong>{assessment.payment_status === 'verified' ? 'Verified by Registrar' : assessment.payment_status === 'waived' ? 'Approved waiver recorded' : 'Pending'}</strong></span>
      </div>}
      {confirmation && <RegistrationCertificate confirmation={confirmation}/>}
    </>}
  </section>;
}
