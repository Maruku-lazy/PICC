/**
 * Diagnostic triage for Tesseract OCR. These scores are NOT measured accuracy,
 * and must never be interpreted as a probability that an applicant is truthful.
 * Thresholds are conservative prototype heuristics pending local calibration.
 */
export type OcrDiagnosticsInput = {
  confidence: number | null;
  recognitionMs: number;
};

export type OcrQuality = {
  engineConfidence: number | null;
  recognitionMs: number;
  charactersRecognized: number;
  status: 'readable' | 'review_required';
  reasons: string[];
};

export function evaluateOcrQuality(text: string, input: OcrDiagnosticsInput): OcrQuality {
  const charactersRecognized = text.replace(/\s/g, '').length;
  const confidence = input.confidence;
  const engineConfidence = typeof confidence === 'number' && Number.isFinite(confidence)
    ? Math.round(Math.max(0, Math.min(100, confidence))) : null;
  const recognitionMs = Number.isFinite(input.recognitionMs)
    ? Math.max(0, Math.round(input.recognitionMs)) : 0;
  const reasons: string[] = [];

  if (charactersRecognized < 20) {
    reasons.push('Very little readable text was detected; inspect the original scan.');
  }
  if (engineConfidence === null) {
    reasons.push('The OCR engine did not provide a usable confidence score.');
  } else if (typeof confidence === 'number' && confidence < 60) {
    reasons.push('OCR engine confidence is below the provisional 60/100 review threshold.');
  }

  return {
    engineConfidence, recognitionMs, charactersRecognized,
    status: reasons.length ? 'review_required' : 'readable', reasons,
  };
}
