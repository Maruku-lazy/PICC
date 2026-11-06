import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ClipboardList, RefreshCw } from 'lucide-react';
import type { DocumentRequirement } from '../data/documentRequirements';
import { ID_PHOTO_REQUIREMENT } from '../data/documentRequirements';
import type { ApplicationDocument } from '../services/documentService';
import type { ScreeningApplicant } from '../services/screeningService';
import ScreeningComparison from './ScreeningComparison';
import DocumentPreview from './DocumentPreview';
import { fetchEnrollmentOutcome } from '../services/enrollmentConfirmationService';
import {
  assessDocuments, fetchAuditHistory, recordDocumentVerdict,
  type AuditItem, type AuditReview, type AuditScreening, type DocumentVerdict,
} from '../services/documentAuditService';

type Props = {
  applicationId: string; applicant: ScreeningApplicant;
  requirements: DocumentRequirement[]; documents: ApplicationDocument[];
  documentsLoading: boolean; documentsError: string;
  refreshDocuments: (silent?:boolean) => Promise<void>;
  reviewable: boolean;
};

function VerdictActions({item, applicationId, applicant, reviewable, onSaved}:{
  item:AuditItem; applicationId:string; applicant:ScreeningApplicant;
  reviewable:boolean; onSaved:()=>Promise<void>;
}) {
  const [choice,setChoice] = useState<DocumentVerdict['decision'] | ''>('');
  const [inspected, setInspected] = useState(false);
  const [note,setNote] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [success,setSuccess] = useState('');
  const doc=item.document;
  if(!doc) return null;
  async function decide() {
    if(!doc || busy) return;
    setError(''); setSuccess('');
    if(!choice) { setError('Select Pass, Fail, or Needs follow-up.'); return; }
    if(!inspected) { setError('Open and manually inspect the actual scan before saving a decision.'); return; }
    if(choice!=='passed' && !note.trim()) {
      setError('Explain why the document failed or needs follow-up.'); return;
    }
    setBusy(true);
    try {
      await recordDocumentVerdict(doc.id,doc.storage_path,choice,note.trim());
      await onSaved();
      setChoice(''); setInspected(false); setNote('');setSuccess('Registrar decision saved.');
    } catch(cause) {
      setError(cause instanceof Error ? cause.message:'Could not record verdict.');
    } finally { setBusy(false); }
  }
  return <div className="picc-verdict-actions">
    <div className="picc-verdict-preview">
      <DocumentPreview path={doc.storage_path} filename={doc.original_filename}
        contentType={doc.content_type} enableOcr={item.name !== ID_PHOTO_REQUIREMENT}
        requirementType={item.name} applicant={applicant} applicationId={applicationId}
        documentId={doc.id}/>
    </div>
    {item.screening?.result && <details className="picc-ai-findings">
      <summary>View preliminary AI findings ({item.screening.matched_count} match, {item.screening.mismatch_count} mismatch, {item.screening.needs_review_count} unsure)</summary>
      <p className="document-audit-note">{item.screening.origin === 'student_browser_auto' ? 'Generated automatically in the student browser.' : 'Saved during an optional Registrar-side OCR check.'} Treat this as an unverified suggestion; inspect the actual document.</p>
      <ScreeningComparison result={item.screening.result}/>
    </details>}
    {item.verdict && <p className="picc-verdict-previous">
      Latest Registrar verdict: <strong>{item.verdict.decision === 'passed' ? 'Passed' : item.verdict.decision === 'failed' ? 'Failed' : 'Needs follow-up'}</strong>
      {item.verdict.note ? ` — ${item.verdict.note}` : ''}
    </p>}
    {reviewable && <div className="picc-verdict-fields">
      <label className="form-field"><span>Final document decision</span>
        <select value={choice} disabled={busy} onChange={e=>setChoice(e.target.value as DocumentVerdict['decision'])}>
          <option value="">Select a decision…</option>
          <option value="passed">Pass — manually inspected</option>
          <option value="failed">Fail — issue confirmed</option>
          <option value="needs_followup">Needs follow-up</option>
        </select>
      </label>
      <label className="form-field"><span>Registrar note {choice!=='passed'?'(required)':'(optional)'}</span>
        <textarea rows={2} maxLength={2000} value={note} disabled={busy}
          onChange={e=>setNote(e.target.value)} placeholder="Record what you saw in the uploaded document"/>
      </label>
      <label className="form-field"><span><input type="checkbox" checked={inspected} disabled={busy}
          onChange={e => setInspected(e.target.checked)} /> I inspected the uploaded file, not just the AI result.</span></label>
      <button type="button" className="button button-primary picc-verdict-save" disabled={busy || !choice || !inspected}
        onClick={()=>void decide()}>{busy?'Saving…':'Save final document decision'}</button>
    </div>}
    {error && <p className="document-ocr-error" role="alert">{error}</p>}
    {success && <p className="screening-history-notice" role="status">{success}</p>}
  </div>;
}

export default function DocumentAuditPanel({
  applicationId,applicant,requirements,documents,documentsLoading,documentsError,refreshDocuments,reviewable,
}:Props) {
  const [screenings,setScreenings]=useState<AuditScreening[]>([]);
  const [reviews,setReviews]=useState<AuditReview[]>([]);
  const [verdicts,setVerdicts]=useState<DocumentVerdict[]>([]);
  const [loading,setLoading]=useState(true);
  const [finalized,setFinalized]=useState(false);
  const [refreshing,setRefreshing]=useState(false);
  const [error,setError]=useState('');
  const refreshAudit=useCallback(async()=>{
    const [next,outcome]=await Promise.all([
      fetchAuditHistory(applicationId), fetchEnrollmentOutcome(applicationId),
    ]);
    setScreenings(next.screenings);setReviews(next.reviews);setVerdicts(next.verdicts);
    setFinalized(!!outcome.confirmation);
  },[applicationId]);
  const refresh=useCallback(async(silent=false)=>{
    await Promise.all([refreshDocuments(silent),refreshAudit()]);
  },[refreshDocuments,refreshAudit]);
  useEffect(()=>{
    let active=true;
    setLoading(true);setError('');
    void Promise.all([fetchAuditHistory(applicationId),fetchEnrollmentOutcome(applicationId)]).then(([data,outcome])=>{
      if(active){setScreenings(data.screenings);setReviews(data.reviews);setVerdicts(data.verdicts);setFinalized(!!outcome.confirmation);}
    }).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'Cannot load AI summary.');})
      .finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false};
  },[applicationId]);
  // Near-live updates without relying on Postgres replication being enabled.
  useEffect(()=>{
    const timer=window.setInterval(()=>{
      if(document.visibilityState==='visible') void refresh(true).catch(()=>undefined);
    },12000);
    return ()=>window.clearInterval(timer);
  },[refresh]);
  const audit=useMemo(()=>assessDocuments(requirements,documents,screenings,reviews,verdicts),
    [requirements,documents,screenings,reviews,verdicts]);
  async function manualRefresh(){
    if(refreshing)return;
    setRefreshing(true);setError('');
    try{await refresh()}catch(cause){setError(cause instanceof Error?cause.message:'Unable to refresh overview.');}
    finally{setRefreshing(false)}
  }
  const pending=loading||documentsLoading||refreshing;
  return <section className="document-audit" aria-label="Document completeness and AI screening overview">
    <div className="document-audit-header">
      <div className="document-audit-heading"><ClipboardList size={19}/>
        <div><h3>Document completeness &amp; AI screening</h3>
          <p>Automatic preliminary findings; Registrar makes the final decision for each file.</p>
        </div>
      </div>
      <button type="button" className="document-audit-refresh" disabled={pending}
        onClick={()=>void manualRefresh()}><RefreshCw size={14}/> Refresh</button>
    </div>
    {pending&&<p className="document-audit-note" role="status">Updating document screening results…</p>}
    {finalized && <p className="document-audit-note">Final enrollment is confirmed. Document decisions are locked.</p>}
    {(error||documentsError)&&<p className="document-ocr-error" role="alert">{error||documentsError}</p>}
    {!pending&&!error&&!documentsError&&<>
      <div className="document-audit-stats" aria-label="Document summary">
        <div><strong>{audit.uploaded} / {audit.required}</strong><span>Files uploaded</span></div>
        <div><strong>{audit.currentScreenings}</strong><span>OCR results saved</span></div>
        <div><strong>{audit.reviewsRecorded}</strong><span>Final document decisions</span></div>
        <div><strong>{audit.attention}</strong><span>Items needing attention</span></div>
      </div>
      <p className="document-audit-note">Overview updates approximately every 12 seconds while visible. AI matches are unverified suggestions.</p>
      <ul className="document-audit-items">{audit.items.map(item=><li key={item.name}>
        <div className="document-audit-row-head"><strong>{item.name}</strong>
          <span className={`document-audit-badge document-audit-${item.state}`}>{item.label}</span>
        </div>
        <small>{item.detail}</small>
        {item.document&&<VerdictActions key={`${item.document.id}:${item.document.storage_path}`}
          item={item} applicationId={applicationId} applicant={applicant} reviewable={reviewable && !finalized}
          onSaved={refreshAudit}/>}
      </li>)}</ul>
      <p className="document-audit-footnote"><AlertCircle size={14}/>
        Client-side OCR can be wrong or manipulated. A Registrar must inspect the original scan and record an independent final document decision. Enrollment approval is a separate action.</p>
    </>}
  </section>;
}
