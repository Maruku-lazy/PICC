/** Derived Registrar-side overview. OCR is advisory; final per-file verdicts are human authored. */
import { ID_PHOTO_REQUIREMENT, type DocumentRequirement } from '../data/documentRequirements';
import type { ApplicationDocument } from './documentService';
import type { ScreeningResult } from './screeningService';
import type { ReviewDecision } from './screeningHistoryService';

export type AuditScreening = {
  id: string; requirement_type: string; document_id: string | null;
  storage_path_snapshot: string; matched_count: number; mismatch_count: number;
  needs_review_count: number; created_at: string;
  origin?: string; result?: ScreeningResult;
};
export type AuditReview = { screening_id: string; decision: ReviewDecision; created_at: string };
export type DocumentVerdict = {
  id: string; document_id: string | null; requirement_type: string;
  storage_path_snapshot: string; decision: 'passed' | 'failed' | 'needs_followup';
  note: string; created_at: string; superseded_at?: string | null;
};
export type AuditState =
  | 'missing' | 'manual_check' | 'pending_auto' | 'failed_auto' | 're_screen'
  | 'awaiting_registrar' | 'passed' | 'failed' | 'needs_followup';
export type AuditItem = {
  name: string; state: AuditState; label: string; detail: string;
  uploaded: boolean; hasCurrentScreening: boolean; hasReview: boolean;
  document: ApplicationDocument | null; screening: AuditScreening | null; verdict: DocumentVerdict | null;
};
export type DocumentAudit = {
  items: AuditItem[]; required: number; uploaded: number; missing: number;
  currentScreenings: number; reviewsRecorded: number; attention: number;
};
const newest = (a: {created_at:string},b:{created_at:string}) => b.created_at.localeCompare(a.created_at);

export function assessDocuments(
  requirements: DocumentRequirement[], documents: ApplicationDocument[],
  screenings: AuditScreening[], _legacyReviews: AuditReview[], verdicts: DocumentVerdict[] = [],
): DocumentAudit {
  const latestScreenings = [...screenings].sort(newest);
  const latestVerdicts = verdicts.filter(v => !v.superseded_at).sort(newest);
  const items: AuditItem[] = requirements.filter(r => !r.physicalOnly).map(r => {
    const document = documents.find(d => d.requirement_type === r.name) ?? null;
    const historical = latestScreenings.filter(s => s.requirement_type === r.name);
    const current = document && document.auto_screen_status === 'complete' && historical.find(s =>
      s.document_id === document.id && s.storage_path_snapshot === document.storage_path) || null;
    const verdict = document && latestVerdicts.find(v =>
      v.document_id === document.id && v.storage_path_snapshot === document.storage_path) || null;
    const base = { name: r.name, document, screening: current, verdict,
      uploaded: !!document, hasCurrentScreening: !!current, hasReview: !!verdict };
    if (!document) return { ...base, state:'missing' as const, label:'Missing', detail:'No scan uploaded.' };
    if (verdict) {
      const config = verdict.decision === 'passed'
        ? {state:'passed' as const,label:'Passed by Registrar', detail:'Registrar inspected and accepted this document.'}
        : verdict.decision === 'failed'
        ? {state:'failed' as const,label:'Failed by Registrar',detail:'Registrar found an issue. See review note.'}
        : {state:'needs_followup' as const,label:'Follow-up required',detail:'Registrar requested manual follow-up.'};
      return {...base,...config};
    }
    if (r.name === ID_PHOTO_REQUIREMENT || !['image/jpeg','image/png'].includes(document.content_type)) {
      return {...base,state:'manual_check' as const,label:'Manual check',detail: 'ID photos and PDFs are not text-scanned; Registrar must inspect the file.'};
    }
    if (document.auto_screen_status === 'failed') {
      return {...base,state:'failed_auto' as const,label:'AI scan failed',detail:'Automatic OCR did not finish. Student can retry; Registrar may inspect the scan.'};
    }
    if (document.auto_screen_status === 'pending') {
      return {...base,state:'pending_auto' as const,label:'AI pending',detail: current
        ? 'Form fields changed; the previous AI result may be out of date. Student should retry.'
        : 'Automatic OCR is pending; student should keep the upload page open or retry.'};
    }
    if (!current) {
      return {...base,state:'re_screen' as const,label:'Re-screen needed',detail: historical.length
        ? 'Results belong to an older scan.' : 'No saved result for this scan yet.'};
    }
    const lowQuality = current.result?.ocrQuality?.status === 'review_required';
    return {...base,state:'awaiting_registrar' as const,
      label: lowQuality ? 'OCR unclear · Decide' : 'AI ready · Decide',
      detail: lowQuality
        ? `OCR quality warning: ${current.result?.ocrQuality?.reasons.join(' ')} Inspect the original image before deciding.`
        : `Preliminary AI: ${current.matched_count} match, ${current.mismatch_count} possible mismatch, ${current.needs_review_count} need review. Inspect scan before deciding.`};
  });
  return { items, required:items.length, uploaded:items.filter(x=>x.uploaded).length,
    missing:items.filter(x=>!x.uploaded).length,
    currentScreenings:items.filter(x=>x.hasCurrentScreening).length,
    reviewsRecorded:items.filter(x=>x.hasReview).length,
    attention:items.filter(x=>x.state!=='passed').length };
}

/** Active Registrar RLS governs these table reads. */
export async function fetchAuditHistory(applicationId:string):Promise<{
  screenings:AuditScreening[]; reviews:AuditReview[]; verdicts:DocumentVerdict[];
}> {
  const supabase=(await import('../lib/supabase')).supabase;
  const [screeningsQuery,verdictQuery] = await Promise.all([
    supabase.from('document_screenings')
      .select('id,requirement_type,document_id,storage_path_snapshot,matched_count,mismatch_count,needs_review_count,created_at,origin,result')
      .eq('application_id', applicationId).order('created_at',{ascending:false}).limit(500),
    supabase.from('document_verdicts')
      .select('id,document_id,requirement_type,storage_path_snapshot,decision,note,created_at,superseded_at')
      .eq('application_id',applicationId).order('created_at',{ascending:false}).limit(500),
  ]);
  if(screeningsQuery.error) throw screeningsQuery.error;
  if(verdictQuery.error) throw verdictQuery.error;
  if((screeningsQuery.data??[]).length===500 || (verdictQuery.data??[]).length===500)
    throw new Error('Screening/verdict history exceeds display limit; ask an administrator to archive records.');
  return { screenings:(screeningsQuery.data??[]) as AuditScreening[],
    reviews:[], verdicts:(verdictQuery.data??[]) as DocumentVerdict[] };
}

export async function recordDocumentVerdict(
  documentId:string, storagePath:string, decision:DocumentVerdict['decision'], note:string,
): Promise<void> {
  const supabase=(await import('../lib/supabase')).supabase;
  const {error}=await supabase.rpc('record_picc_document_verdict', {
    p_document_id:documentId,p_storage_path:storagePath,p_decision:decision,p_note:note,
  });
  if(error) throw error;
}
