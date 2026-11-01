import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, FileImage, FileText, LoaderCircle, X } from 'lucide-react';
import { createDocumentPreviewUrl } from '../services/documentService';

type DocumentPreviewProps = {
  path: string;
  filename?: string;
  contentType?: string;
};

/** Private, short-lived document preview rendered inside the PiCC application. */
export default function DocumentPreview({ path, filename, contentType }: DocumentPreviewProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [signedUrl, setSignedUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const isPdf = contentType === 'application/pdf' || /\.pdf$/i.test(path);
  const isImage = ['image/jpeg', 'image/png'].includes(contentType ?? '') || /\.(jpe?g|png)$/i.test(path);
  const displayName = filename || 'Scanned document';

  useEffect(() => {
    if (!isOpen) return;

    let active = true;
    // Each time the user opens the dialog, request a fresh signed URL.
    setSignedUrl('');
    setError('');
    setLoading(true);

    void createDocumentPreviewUrl(path).then((url) => {
      if (active) setSignedUrl(url);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load document preview.');
    }).finally(() => {
      if (active) setLoading(false);
    });

    return () => { active = false; };
  }, [isOpen, path]);

  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), iframe'
      );
      if (!focusables?.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener('keydown', onKeyDown);
      triggerRef.current?.focus();
    };
  }, [isOpen]);

  return (
    <span className="document-preview-actions">
      <button
        ref={triggerRef}
        type="button"
        className="document-remove-control"
        onClick={() => setIsOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={`Preview ${displayName}`}
      >
        <Eye size={15} aria-hidden="true" /> Preview
      </button>

      {isOpen && createPortal(
        <div
          className="document-preview-overlay"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setIsOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            className="document-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="picc-document-preview-title"
            aria-describedby="picc-document-preview-description"
          >
            <header className="document-preview-header">
              <div className="document-preview-heading">
                {isPdf ? <FileText size={21} aria-hidden="true" /> : <FileImage size={21} aria-hidden="true" />}
                <div>
                  <h2 id="picc-document-preview-title">Document preview</h2>
                  <p id="picc-document-preview-description">{displayName}</p>
                </div>
              </div>
              <button
                ref={closeButtonRef}
                className="document-preview-close"
                type="button"
                aria-label="Close document preview"
                onClick={() => setIsOpen(false)}
              >
                <X size={21} aria-hidden="true" />
              </button>
            </header>

            <div className="document-preview-body">
              {loading && (
                <div className="document-preview-message" role="status">
                  <LoaderCircle className="document-preview-spinner" size={26} aria-hidden="true" />
                  Loading private document…
                </div>
              )}
              {error && <div className="document-preview-message error" role="alert">{error}</div>}
              {!loading && !error && signedUrl && (
                isPdf ? (
                  <iframe
                    className="document-preview-pdf"
                    src={signedUrl}
                    title={`PDF preview: ${displayName}`}
                    referrerPolicy="no-referrer"
                  />
                ) : isImage ? (
                  <img
                    className="document-preview-image"
                    src={signedUrl}
                    alt={`Scanned document: ${displayName}`}
                    onError={() => setError('Could not display this image. Check the uploaded file format.')}
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="document-preview-message" role="status">
                    This file type cannot be previewed inside the app.
                  </div>
                )
              )}
            </div>
            <footer className="document-preview-footer">
              Private preview • Access expires after 60 seconds. Close and reopen to refresh.
            </footer>
          </div>
        </div>, document.body
      )}
    </span>
  );
}
