/**
 * Automatic OCR runs in the logged-in STUDENT's browser immediately after upload.
 * The database deliberately treats the result as student-client-generated,
 * preliminary evidence; the Registrar must inspect the actual document.
 */
import { extractPrivateDocumentText, type OcrProgress } from './ocrService';
import { compareDocumentText, type ScreeningApplicant, type ScreeningResult } from './screeningService';
import type { ApplicationDocument } from './documentService';

export async function screenUploadedDocument(
  doc: ApplicationDocument,
  applicant: ScreeningApplicant,
  onProgress?: (progress: OcrProgress) => void,
): Promise<ScreeningResult> {
  if (!['image/jpeg','image/png'].includes(doc.content_type)) {
    throw new Error('Only JPG and PNG images support automatic OCR at this stage.');
  }
  const supabase = (await import('../lib/supabase')).supabase;
  try {
    const recognized = await extractPrivateDocumentText(doc.storage_path, onProgress);
    const result = compareDocumentText(doc.requirement_type, recognized.text, applicant, {
      confidence: recognized.confidence,
      recognitionMs: recognized.recognitionMs,
    });
    // This RPC checks the signed-in student, application status, current document
    // path, result structure and calculated counts. It NEVER approves a document.
    const { error } = await supabase.rpc('save_my_picc_auto_screening', {
      p_document_id: doc.id,
      p_storage_path: doc.storage_path,
      p_result: result,
    });
    if (error) throw error;
    return result;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Automatic OCR failed.';
    // Preserve the original error while still attempting to record a failure.
    const { error: statusError } = await supabase.rpc('fail_my_picc_auto_screening', {
      p_document_id: doc.id,
      p_storage_path: doc.storage_path,
      p_error: message.slice(0, 250),
    });
    if (statusError) console.warn('Could not persist auto-scan failure status:', statusError);
    throw cause;
  }
}
