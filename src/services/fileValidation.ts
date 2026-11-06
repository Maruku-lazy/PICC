/** Browser-side file sanity check. NOT a server-side authenticity or malware
 * check. Supabase Storage rules and a future trusted scanner must also apply. */
const MAX_SIZE = 10 * 1024 * 1024;
const MIME_EXTENSIONS: Record<string, string[]> = {
  'image/jpeg': ['jpg','jpeg'],
  'image/png': ['png'],
  'application/pdf': ['pdf'],
};
export async function validateDocumentBytes(file: Pick<File, 'name'|'type'|'size'|'slice'>): Promise<void> {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  if (!MIME_EXTENSIONS[file.type]?.includes(extension)) {
    throw new Error('Filename extension and file type must match (JPG, PNG, PDF).');
  }
  if (file.size < 1 || file.size > MAX_SIZE) {
    throw new Error('Files must be between 1 byte and 10 MB.');
  }
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const starts = (bytes: number[]) => bytes.every((value, i) => header[i] === value);
  const recognized = file.type === 'image/jpeg'
    ? starts([0xff,0xd8,0xff])
    : file.type === 'image/png'
      ? starts([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])
      : starts([0x25,0x50,0x44,0x46,0x2d]);
  if (!recognized) {
    throw new Error('This file does not have a valid JPG, PNG, or PDF header. Please select a genuine scan.');
  }
}
