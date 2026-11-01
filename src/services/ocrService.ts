/**
 * Local OCR shared by automatic student screening and optional Registrar re-check.
 * Downloads a private JPG/PNG using the signed-in user's Storage access;
 * runs Tesseract in the browser. Its confidence is diagnostic only. 
 */

const BUCKET = 'picc-enrollment-documents';
const OCR_MAX_BYTES = 10 * 1024 * 1024;

export type OcrProgress = { label: string; percent: number | null };
export type OcrResult = { text: string; confidence: number | null; recognitionMs: number };

export async function extractPrivateDocumentText(
  storagePath: string,
  onProgress?: (progress: OcrProgress) => void,
  signal?: AbortSignal,
): Promise<OcrResult> {
  if (!storagePath) throw new Error('Missing document storage path.');
  if (signal?.aborted) throw new DOMException('OCR cancelled', 'AbortError');
  onProgress?.({ label: 'Downloading private document', percent: null });

  // The existing Storage RLS policies authorize the current Registrar session.
  // Don't put the Storage URL or service-role secret in this module.
  const { supabase } = await import('../lib/supabase');
  const { data: blob, error } = await supabase.storage.from(BUCKET)
    .download(storagePath, {}, { signal });
  if (error) throw new Error(`Cannot download private scan: ${error.message}`);
  if (!blob) throw new Error('The document download returned an empty result.');

  // Tesseract.js does not OCR PDFs directly. Never silently pass a PDF to it.
  if (!['image/jpeg', 'image/png'].includes(blob.type.toLowerCase())) {
    throw new Error('OCR supports JPG and PNG scans only. PDFs can still be previewed.');
  }
  if (blob.size === 0 || blob.size > OCR_MAX_BYTES) {
    throw new Error('The scanned image must be between 1 byte and 10 MB.');
  }

  onProgress?.({ label: 'Loading OCR model', percent: null });

  // Import lazily so OCR isn't downloaded or initialized at app startup.
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    logger: (message) => {
      if (message.status === 'recognizing text') {
        onProgress?.({
          label: 'Recognizing document text',
          percent: Math.max(0, Math.min(100, Math.round((message.progress ?? 0) * 100))),
        });
      } else if (typeof message.status === 'string') {
        onProgress?.({ label: 'Preparing OCR engine', percent: null });
      }
    },
  });

  const stopWorker = () => { void worker.terminate().catch(() => undefined); };
  signal?.addEventListener('abort', stopWorker, { once: true });

  try {
    if (signal?.aborted) throw new DOMException('OCR cancelled', 'AbortError');
    const recognitionStarted = performance.now();
    const result = await worker.recognize(blob);
    const recognitionMs = Math.max(0, Math.round(performance.now() - recognitionStarted));
    if (signal?.aborted) throw new DOMException('OCR cancelled', 'AbortError');
    return {
      text: result.data.text.trim(),
      confidence: typeof result.data.confidence === 'number' && Number.isFinite(result.data.confidence)
        ? result.data.confidence : null,
      recognitionMs,
    };
  } finally {
    signal?.removeEventListener('abort', stopWorker);
    await worker.terminate().catch(() => undefined);
  }
}
