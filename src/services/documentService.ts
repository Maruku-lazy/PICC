import { validateDocumentBytes } from './fileValidation';

// Keep Supabase loading lazy so the separate frontend-only demo mode still runs.
async function getSupabase() {
  return (await import('../lib/supabase')).supabase;
}

const BUCKET = 'picc-enrollment-documents';
const MAX_SIZE = 10 * 1024 * 1024;
const MIME_TO_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

export type ApplicationDocument = {
  id: string;
  application_id: string;
  requirement_type: string;
  original_filename: string;
  storage_path: string;
  content_type: string;
  file_size: number;
  created_at: string;
  auto_screen_status: 'pending' | 'complete' | 'failed' | 'manual';
  auto_screen_error: string;
};

export async function listApplicationDocuments(applicationId: string): Promise<ApplicationDocument[]> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from('application_documents')
    .select('id,application_id,requirement_type,original_filename,storage_path,content_type,file_size,created_at,auto_screen_status,auto_screen_error')
    .eq('application_id', applicationId);
  if (error) throw error;
  return (data ?? []) as ApplicationDocument[];
}

export async function findMyApplicationId(): Promise<string> {
  const supabase = await getSupabase();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error('Sign in as a student to upload scans.');
  const { data, error } = await supabase.from('enrollment_applications')
    .select('id').eq('student_id', auth.user.id).single();
  if (error) throw error;
  return data.id as string;
}

export async function uploadApplicationDocument(
  applicationId: string,
  requirementType: string,
  file: File,
  previous?: ApplicationDocument,
): Promise<void> {
  const supabase = await getSupabase();
  const ext = MIME_TO_EXTENSION[file.type];
  const filenameMatches = /\.(jpe?g|png|pdf)$/i.test(file.name);
  if (!ext || !filenameMatches) throw new Error('Select a JPG, PNG, or PDF scanned document.');
  if (!file.size || file.size > MAX_SIZE) throw new Error('File must be between 1 byte and 10 MB.');
  if (!requirementType.trim()) throw new Error('The document requirement was not specified.');
  await validateDocumentBytes(file);

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error('Your login session has expired. Sign in again.');

  const path = `${auth.user.id}/${applicationId}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false, cacheControl: '0' });
  if (uploadError) throw uploadError;

  const { error: recordError } = await supabase.rpc('record_my_picc_document', {
    p_application_id: applicationId,
    p_requirement_type: requirementType,
    p_storage_path: path,
    p_original_filename: file.name,
  });
  if (recordError) {
    // Avoid leaking an orphaned file when metadata could not be recorded.
    await supabase.storage.from(BUCKET).remove([path]);
    throw recordError;
  }

  // Metadata update queued the old path in PostgreSQL. If Storage cleanup
  // fails, the queue retains the path and another visit can retry safely.
  if (previous?.storage_path && previous.storage_path !== path) {
    try {
      await reconcileMyPiccStorageCleanup();
    } catch (error) {
      console.warn('Old scan cleanup was queued for a later retry:', error);
    }
  }
}

/**
 * Complete cleanup requests recorded by the database after a document
 * is replaced or removed. Keep pending entries until Storage deletion
 * succeeds; never delete a Storage object merely because a client supplied
 * an arbitrary path.
 */
export async function reconcileMyPiccStorageCleanup(): Promise<void> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.rpc('picc_my_pending_storage_cleanup');
  if (error) throw error;
  const pending = (data ?? []) as {storage_path:string}[];
  const failures: string[] = [];
  for (const entry of pending) {
    const path = entry.storage_path;
    const { error: removeError } = await supabase.storage.from(BUCKET).remove([path]);
    if (removeError) { failures.push(removeError.message); continue; }
    const { error: finishError } = await supabase.rpc('picc_finish_storage_cleanup', {
      p_storage_path: path,
    });
    if (finishError) failures.push(finishError.message);
  }
  if (failures.length) {
    throw new Error(`${failures.length} old scan(s) are pending secure cleanup. Reopen the application to retry. ${failures[0]}`);
  }
}

export async function removeApplicationDocument(document: ApplicationDocument): Promise<{ cleanupPending: boolean }> {
  const supabase = await getSupabase();
  // Remove metadata transactionally first. A DB trigger queues the old path;
  // if the RPC fails the object and metadata both remain intact.
  const { data: removedPath, error } = await supabase.rpc('forget_my_picc_document', {
    p_application_id: document.application_id,
    p_requirement_type: document.requirement_type,
  });
  if (error) throw error;
  if (removedPath !== document.storage_path) {
    // Another tab modified it. Metadata was committed, so refresh and do not
    // delete the untrusted/stale path; queue reconciliation is still safe.
    return { cleanupPending: true };
  }
  try {
    await reconcileMyPiccStorageCleanup();
    return { cleanupPending: false };
  } catch (cause) {
    console.warn('Metadata was removed. File cleanup queued for retry:', cause);
    return { cleanupPending: true };
  }
}

export async function createDocumentPreviewUrl(storagePath: string): Promise<string> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60);
  if (error) throw error;
  return data.signedUrl;
}
