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
};

export async function listApplicationDocuments(applicationId: string): Promise<ApplicationDocument[]> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.from('application_documents')
    .select('id,application_id,requirement_type,original_filename,storage_path,content_type,file_size,created_at')
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

  // Replacing a scan creates a new private path; clean up the previous object.
  // Even if cleanup fails, the old object is no longer linked to the application.
  if (previous?.storage_path && previous.storage_path !== path) {
    const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([previous.storage_path]);
    if (cleanupError) console.warn('Old scan could not be removed; administrator cleanup may be required.', cleanupError);
  }
}

export async function removeApplicationDocument(document: ApplicationDocument): Promise<void> {
  const supabase = await getSupabase();
  // Delete the actual object first. If metadata removal fails, retrying is possible.
  const { error: fileError } = await supabase.storage.from(BUCKET).remove([document.storage_path]);
  if (fileError) throw fileError;
  const { error } = await supabase.rpc('forget_my_picc_document', {
    p_application_id: document.application_id,
    p_requirement_type: document.requirement_type,
  });
  if (error) throw error;
}

export async function createDocumentPreviewUrl(storagePath: string): Promise<string> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60);
  if (error) throw error;
  return data.signedUrl;
}
