import { AlertTriangle, CheckCircle2, CircleHelp, ShieldAlert } from 'lucide-react';
import type { ScreeningResult, ScreeningStatus } from '../services/screeningService';

type Props = { result: ScreeningResult };

const LABELS: Record<ScreeningStatus, string> = {
  matched: 'Matched',
  possible_mismatch: 'Possible mismatch',
  needs_review: 'Needs review',
};

export default function ScreeningComparison({ result }: Props) {
  return (
    <section className="screening-comparison" aria-label="Preliminary OCR comparison findings">
      <div className="screening-comparison-header">
        <h4>Comparison with enrollment form</h4>
        <span className="screening-review-only"><ShieldAlert size={13} /> Registrar review required</span>
      </div>

      <div className="screening-counts" aria-label="Screening summary">
        <span className="screening-count screening-matched">{result.matchedCount} matched</span>
        <span className="screening-count screening-mismatch">{result.mismatchCount} possible mismatch</span>
        <span className="screening-count screening-review">{result.needsReviewCount} needs review</span>
      </div>

      {result.ocrQuality && (
        <div className={`screening-quality screening-quality-${result.ocrQuality.status}`}>
          <strong>{result.ocrQuality.status === 'review_required'
            ? 'OCR quality warning — manual review needed'
            : 'OCR diagnostics — readable text detected'}</strong>
          <dl>
            <div><dt>Tesseract confidence</dt><dd>{result.ocrQuality.engineConfidence == null
              ? 'Unavailable' : `${result.ocrQuality.engineConfidence}/100`}</dd></div>
            <div><dt>Recognition time</dt><dd>{(result.ocrQuality.recognitionMs / 1000).toFixed(2)} s</dd></div>
            <div><dt>Recognized characters</dt><dd>{result.ocrQuality.charactersRecognized}</dd></div>
          </dl>
          {result.ocrQuality.reasons.map(reason => <p key={reason}>{reason}</p>)}
          <small>Engine confidence is not a measured accuracy rate. A Registrar must inspect the original file.</small>
        </div>
      )}

      <div className="screening-finding-list">
        {result.findings.map(finding => (
          <div key={finding.field} className={`screening-finding screening-${finding.status}`}>
            <div className="screening-finding-title">
              <strong>{finding.label}</strong>
              <span>
                {finding.status === 'matched' && <CheckCircle2 size={15} />}
                {finding.status === 'possible_mismatch' && <AlertTriangle size={15} />}
                {finding.status === 'needs_review' && <CircleHelp size={15} />}
                {LABELS[finding.status]}
              </span>
            </div>
            <dl className="screening-values">
              <div><dt>Enrollment form</dt><dd>{finding.expected || 'Not provided'}</dd></div>
              <div><dt>Recognized from scan</dt><dd>{finding.extracted || 'Not detected'}</dd></div>
            </dl>
            <p>{finding.explanation}</p>
          </div>
        ))}
      </div>
      <div className="screening-disclaimer">
        {result.notes.map(note => <p key={note}>{note}</p>)}
      </div>
    </section>
  );
}
