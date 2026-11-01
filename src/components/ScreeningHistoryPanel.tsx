import { useEffect, useState } from 'react';
import { History, Save } from 'lucide-react';
import ScreeningComparison from './ScreeningComparison';
import { getScreeningHistory, saveScreening, reviewDecisionLabels,
  type ScreeningHistory } from '../services/screeningHistoryService';
import type { ScreeningResult } from '../services/screeningService';

type Props = {applicationId:string;documentId:string;requirementType:string;storagePath:string;currentResult:ScreeningResult|null};
const empty:ScreeningHistory = {screenings:[],reviews:[]};
export default function ScreeningHistoryPanel({applicationId,documentId,requirementType,storagePath,currentResult}:Props){
  const [history,setHistory]=useState<ScreeningHistory>(empty);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [expanded,setExpanded]=useState<string|null>(null);
  useEffect(()=>{
    let mounted=true;setLoading(true);setError('');
    void getScreeningHistory(applicationId,requirementType)
      .then(data=>{if(mounted)setHistory(data)})
      .catch(cause=>{if(mounted)setError(cause instanceof Error?cause.message:'Could not load screening history.')})
      .finally(()=>{if(mounted)setLoading(false)});
    return ()=>{mounted=false};
  },[applicationId,requirementType]);
  async function save(){
    if(!currentResult||busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      const id=await saveScreening(documentId,storagePath,currentResult);
      setHistory(await getScreeningHistory(applicationId,requirementType));
      setExpanded(id);setNotice('Optional manual OCR findings saved. Set final Pass/Fail in the Screening Overview sidebar.');
    }catch(cause){setError(cause instanceof Error?cause.message:'Unable to save findings.');}
    finally{setBusy(false)}
  }
  return <section className="screening-history" aria-label="Saved document screening history">
    <div className="screening-history-title"><History size={17}/><h4>Saved AI screening history</h4></div>
    <p className="screening-history-intro">Automatic results come from the student browser. Manual OCR may be saved here as an optional recheck. For the final document Pass/Fail/Follow-up decision, use the Screening Overview on the Registrar page.</p>
    {currentResult&&<button className="document-ocr-run" type="button" disabled={busy} onClick={()=>void save()}>
      <Save size={15}/>{busy?'Saving…':'Save optional manual OCR result'}</button>}
    {loading&&<p role="status">Loading history…</p>}
    {error&&<p className="document-ocr-error" role="alert">{error}</p>}
    {notice&&<p className="screening-history-notice" role="status">{notice}</p>}
    {!loading&&!history.screenings.length&&<p className="document-ocr-note">No saved OCR comparisons for this document.</p>}
    {history.screenings.map(s=>{
      const current=s.document_id===documentId&&s.storage_path_snapshot===storagePath;
      const open=expanded===s.id;
      return <article className="screening-history-entry" key={s.id}>
        <button className="screening-history-entry-toggle" type="button" aria-expanded={open} onClick={()=>setExpanded(open?null:s.id)}>
          <span><strong>{new Date(s.created_at).toLocaleString('en-PH')}</strong>
            <small>{s.engine} · {s.matched_count} matched · {s.mismatch_count} possible mismatch · {s.needs_review_count} unclear</small></span>
          <span className={current?'screening-current':'screening-stale'}>{current?'Current scan':'Old scan'}</span>
        </button>
        {open&&<div className="screening-history-entry-body">
          <ScreeningComparison result={s.result}/>
          {history.reviews.filter(r=>r.screening_id===s.id).map(r=><div className="screening-review-record" key={r.id}>
            <strong>{reviewDecisionLabels[r.decision]}</strong><small>{new Date(r.created_at).toLocaleString('en-PH')}</small>
            {r.note&&<p>{r.note}</p>}
          </div>)}
        </div>}
      </article>;
    })}
  </section>;
}
