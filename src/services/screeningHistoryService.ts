/**
 * Phase 3.3: PostgreSQL persistence for Registrar-generated OCR comparisons.
 * Only the comparison findings are saved, never the complete OCR text.
 * All write permission is enforced again by PostgreSQL SECURITY DEFINER RPCs.
 */
import type { ScreeningResult } from './screeningService';

type Supabase = typeof import('../lib/supabase').supabase;
async function client(): Promise<Supabase> {
  return (await import('../lib/supabase')).supabase;
}

export type ReviewDecision =
  | 'no_discrepancy_observed'
  | 'discrepancy_confirmed'
  | 'inconclusive';

export const reviewDecisionLabels: Record<ReviewDecision, string> = {
  no_discrepancy_observed: 'No discrepancy observed',
  discrepancy_confirmed: 'Discrepancy confirmed',
  inconclusive: 'Inconclusive — manual follow-up',
};

export type SavedScreening = {
  id: string;
  application_id: string;
  document_id: string | null;
  requirement_type: string;
  storage_path_snapshot: string;
  engine: string;
  result: ScreeningResult;
  created_by: string;
  created_at: string;
  matched_count: number;
  mismatch_count: number;
  needs_review_count: number;
};

export type SavedScreeningReview = {
  id: string;
  screening_id: string;
  reviewer_id: string;
  decision: ReviewDecision;
  note: string;
  created_at: string;
};

export type ScreeningHistory = {
  screenings: SavedScreening[];
  reviews: SavedScreeningReview[];
};

export async function getScreeningHistory(
  applicationId: string,
  requirementType: string,
): Promise<ScreeningHistory> {
  const supabase = await client();
  const { data: screenings, error } = await supabase
    .from('document_screenings')
    .select('id,application_id,document_id,requirement_type,storage_path_snapshot,engine,result,created_by,created_at,matched_count,mismatch_count,needs_review_count')
    .eq('application_id', applicationId)
    .eq('requirement_type', requirementType)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;

  const rows = (screenings ?? []) as SavedScreening[];
  if (!rows.length) return { screenings: [], reviews: [] };

  const { data: reviews, error: reviewError } = await supabase
    .from('document_screening_reviews')
    .select('id,screening_id,reviewer_id,decision,note,created_at')
    .in('screening_id', rows.map(row => row.id))
    .order('created_at', { ascending: false });
  if (reviewError) throw reviewError;

  return { screenings: rows, reviews: (reviews ?? []) as SavedScreeningReview[] };
}

export async function saveScreening(
  documentId: string,
  storagePath: string,
  result: ScreeningResult,
): Promise<string> {
  const supabase = await client();
  const { data, error } = await supabase.rpc('save_picc_document_screening', {
    p_document_id: documentId,
    p_storage_path: storagePath,
    p_result: result,
  });
  if (error) throw error;
  return data as string;
}

export async function recordScreeningReview(
  screeningId: string,
  decision: ReviewDecision,
  note: string,
): Promise<void> {
  const supabase = await client();
  const { error } = await supabase.rpc('review_picc_document_screening', {
    p_screening_id: screeningId,
    p_decision: decision,
    p_note: note,
  });
  if (error) throw error;
}
