import { useEffect, useRef, useState } from 'react';
import { Check, ClipboardCopy, LoaderCircle, ScanText } from 'lucide-react';
import { extractPrivateDocumentText, type OcrProgress } from '../services/ocrService';
import { compareDocumentText, type ScreeningApplicant, type ScreeningResult } from '../services/screeningService';
import ScreeningComparison from './ScreeningComparison';
import ScreeningHistoryPanel from './ScreeningHistoryPanel';

type Props = { path: string; isImage: boolean; requirementType?: string; applicant?: ScreeningApplicant; applicationId?: string; documentId?: string };

/** Optional Registrar-side OCR re-check. Student uploads trigger preliminary OCR automatically. */
export default function DocumentOcrPanel({ path, isImage, requirementType, applicant, applicationId, documentId }: Props) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [comparison, setComparison] = useState<ScreeningResult | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const activeRef = useRef(true);
  const busyRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      controllerRef.current?.abort();
    };
  }, []);

  async function runOcr() {
    if (busyRef.current || !isImage) return;
    busyRef.current = true;
    setRunning(true);
    setError('');
    setText(null);
    setComparison(null);
    setProgress(null);
    setCopied(false);
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const result = await extractPrivateDocumentText(path, (next) => {
        if (activeRef.current) setProgress(next);
      }, controller.signal);
      if (activeRef.current) {
        setText(result.text);
        if (requirementType && applicant) {
          setComparison(compareDocumentText(requirementType, result.text, applicant, {
            confidence: result.confidence,
            recognitionMs: result.recognitionMs,
          }));
        }
      }
    } catch (cause) {
      if (activeRef.current) {
        setError(cause instanceof Error ? cause.message : 'OCR could not recognize this document.');
      }
    } finally {
      controllerRef.current = null;
      busyRef.current = false;
      if (activeRef.current) setRunning(false);
    }
  }

  async function copyText() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      if (activeRef.current) setCopied(true);
    } catch {
      setError('Could not copy the text. You can select it manually.');
    }
  }

  return (
    <aside className="document-ocr-panel" aria-label="OCR text extraction">
      <div className="document-ocr-heading">
        <ScanText size={21} aria-hidden="true" />
        <div>
          <h3>Optional OCR re-check</h3>
          <p>Experimental · Tesseract.js (English)</p>
        </div>
      </div>

      {!isImage ? (
        <p className="document-ocr-note">OCR currently supports JPG and PNG only. PDF preview is still available on the left.</p>
      ) : (
        <>
          <button className="document-ocr-run" type="button" disabled={running} onClick={() => void runOcr()}>
            {running ? <LoaderCircle className="document-preview-spinner" size={16} /> : <ScanText size={16} />}
            {running ? 'Extracting text…' : text !== null ? 'Run optional OCR again' : 'Optional OCR re-check'}
          </button>
          {running && (
            <div role="status" className="document-ocr-progress">
              <span>{progress?.label ?? 'Starting OCR'}{progress?.percent != null ? ` · ${progress.percent}%` : ''}</span>
              {progress?.percent != null && <progress value={progress.percent} max={100} aria-label="OCR progress" />}
            </div>
          )}
          {error && <p className="document-ocr-error" role="alert">{error}</p>}
          {text !== null && (
            <div className="document-ocr-output">
              <div className="document-ocr-output-heading">
                <strong>Recognized text</strong>
                {text && <button type="button" onClick={() => void copyText()}>
                  {copied ? <Check size={14} /> : <ClipboardCopy size={14} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>}
              </div>
              {text ? <pre>{text}</pre> : <p>No readable text was detected. Inspect the original scan manually.</p>}
            </div>
          )}
          {comparison && <ScreeningComparison result={comparison} />}
          {applicationId && documentId && requirementType && (
            <ScreeningHistoryPanel applicationId={applicationId} documentId={documentId}
              requirementType={requirementType} storagePath={path} currentResult={comparison} />
          )}
          {text === null && !running && <p className="document-ocr-placeholder">Student uploads automatically create preliminary findings where supported. Use the Screening Overview for saved results and final document decisions; this optional button re-checks the text.</p>}
        </>
      )}
      <p className="document-ocr-disclaimer">OCR may misread names, dates, and document labels. Automatic and optional OCR results are preliminary suggestions, not proof of document authenticity. Final Pass/Fail/Follow-up is recorded separately by the Registrar in the Screening Overview.</p>
    </aside>
  );
}
