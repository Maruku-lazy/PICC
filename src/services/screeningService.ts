/**
 * PiCC Phase 3.2: conservative, local comparison of OCR text against the
 * enrolled applicant's form. This is decision support, NOT identity proof,
 * document authenticity verification, or an automatic approval mechanism.
 *
 * Exact complete applicant names may be detected with or without a label;
 * names with partial or ambiguous OCR evidence require manual review.
 */

import type { ApplicationInput } from '../types';
import { evaluateOcrQuality, type OcrDiagnosticsInput, type OcrQuality } from './ocrQualityService';

export type ScreeningApplicant = Pick<
  ApplicationInput,
  'firstName' | 'middleName' | 'lastName' | 'suffix' | 'birthDate' | 'sex'
>;
export type ScreeningStatus = 'matched' | 'possible_mismatch' | 'needs_review';
export type ScreeningField = 'fullName' | 'birthDate' | 'sex';

export type ScreeningFinding = {
  field: ScreeningField;
  label: string;
  expected: string;
  extracted: string | null;
  status: ScreeningStatus;
  explanation: string;
};

export type ScreeningResult = {
  requirementType: string;
  findings: ScreeningFinding[];
  matchedCount: number;
  mismatchCount: number;
  needsReviewCount: number;
  notes: string[];
  ocrQuality?: OcrQuality;
  comparisonVersion?: string;
};

// Philippine school and civil registry scans use different name labels. Keep these
// anchored to avoid confusing a parent's/guardian's name for the applicant.
const NAME_LABEL = String.raw`(?:name of (?:the )?(?:child|student|applicant|pupil|learner)|(?:child|student|applicant|pupil|learner)(?:'s)? (?:full |complete )?name|(?:full|complete) name|name)`;
const FULL_NAME = new RegExp(`^${NAME_LABEL}\\s*[:=\\-–]\\s*(.+)$`, 'i');
const NAME_LABEL_ONLY = new RegExp(`^${NAME_LABEL}\\s*[:=]?\\s*$`, 'i');
const FIRST_NAME = /^(?:first|given)\s*(?:name|names?)\s*[:=\-–]\s*(.+)$/i;
const MIDDLE_NAME = /^middle\s*(?:name|names?|initial)\s*[:=\-–]\s*(.+)$/i;
const LAST_NAME = /^(?:last|family|sur|surname)\s*(?:name)?\s*[:=\-–]\s*(.+)$/i;
const FIRST_LABEL_ONLY = /^(?:first|given)\s*name\s*:?$/i;
const MIDDLE_LABEL_ONLY = /^middle\s*(?:name|initial)\s*:?$/i;
const LAST_LABEL_ONLY = /^(?:last|family|sur)\s*name\s*:?$/i;
const SURNAME_LABEL_ONLY = /^surname\s*:?$/i;
const BIRTH_DATE = /^(?:date of (?:live )?birth|birth\s*date|date born|born on|dob)\s*[:\-–]\s*(.+)$/i;
const BIRTH_DATE_ONLY = /^(?:date of (?:live )?birth|birth\s*date|date born|born on|dob)\s*:?$/i;
const SEX = /^(?:sex|gender)\s*[:\-–]\s*(.+)$/i;
const SEX_ONLY = /^(?:sex|gender)\s*:?$/i;

function clean(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function linesOf(text: string): string[] {
  return text.split(/\r?\n/).map(clean).filter(Boolean);
}

function readLabeledValue(lines: string[], inline: RegExp, labelOnly: RegExp): string | null {
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(inline);
    if (match?.[1]) return clean(match[1]);
    if (labelOnly.test(lines[i]) && lines[i + 1]) {
      // Do not consume another field label as the value.
      const next = lines[i + 1];
      if (!/^(name|first name|last name|sex|gender|date of birth|dob)\s*[:\-–]/i.test(next)) {
        return next;
      }
    }
  }
  return null;
}

function extractName(lines: string[]): string | null {
  const named = readLabeledValue(lines, FULL_NAME, NAME_LABEL_ONLY);
  if (named) return named;
  // OCR often puts the label and value on separate rows, or in a table.
  const given = readLabeledValue(lines, FIRST_NAME, FIRST_LABEL_ONLY);
  const family = readLabeledValue(lines, LAST_NAME, LAST_LABEL_ONLY)
    ?? readLabeledValue(lines, LAST_NAME, SURNAME_LABEL_ONLY);
  const middle = readLabeledValue(lines, MIDDLE_NAME, MIDDLE_LABEL_ONLY);
  if (given && family) return clean(`${given} ${middle ?? ''} ${family}`);
  return null;
}

function normalName(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\d ]/gi, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * Look for a COMPLETE exact name, including multi-word surnames, without
 * requiring a perfect OCR label. No fuzzy edit-distance matching: names such
 * as ANN/ANNE or different last names must not become automatic matches.
 * Allow first-middle-last and "LAST, FIRST MIDDLE" layouts. Scan at most
 * three adjacent rows so separate document fields are not merged wholesale.
 */
function fullNameEvidence(lines: string[], applicant: ScreeningApplicant): string | null {
  const first = normalName(applicant.firstName);
  const last = normalName(applicant.lastName);
  const middle = normalName(applicant.middleName);
  const suffix = normalName(applicant.suffix);
  if (!first || !last) return null;
  const variants = [
    [first, middle, last, suffix].filter(Boolean).join(' '),
    [last, first, middle, suffix].filter(Boolean).join(' '),
  ];
  for (let i = 0; i < lines.length; i++) {
    for (let count = 1; count <= 3 && i + count <= lines.length; count++) {
      const section = lines.slice(i, i + count).join(' ');
      const normalized = ` ${normalName(section)} `;
      if (variants.some(variant => normalized.includes(` ${variant} `))) {
        // Only the short piece containing the name is used as comparison
        // evidence. Raw OCR text is not persisted in Supabase.
        return variants.find(variant => normalized.includes(` ${variant} `)) ?? null;
      }
    }
  }
  return null;
}

function isoDate(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

type ParsedDate = { iso: string | null; ambiguous: boolean };
function parseDate(value: string): ParsedDate {
  const cleaned = clean(value).replace(/,/g, '');
  // ISO date: 2007-03-15.
  let match = cleaned.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (match) return { iso: isoDate(+match[1], +match[2], +match[3]), ambiguous: false };

  // "March 15 2007" or "15 March 2007".
  match = cleaned.match(/\b([a-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\s+(\d{4})\b/i);
  if (match && MONTHS[match[1].slice(0, 3).toLowerCase()]) {
    return { iso: isoDate(+match[3], MONTHS[match[1].slice(0, 3).toLowerCase()], +match[2]), ambiguous: false };
  }
  match = cleaned.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\s+(\d{4})\b/i);
  if (match && MONTHS[match[2].slice(0, 3).toLowerCase()]) {
    return { iso: isoDate(+match[3], MONTHS[match[2].slice(0, 3).toLowerCase()], +match[1]), ambiguous: false };
  }

  // Numeric dates are ambiguous if BOTH components are 1-12.
  match = cleaned.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/);
  if (match) {
    const a = +match[1], b = +match[2], y = +match[3];
    if (a <= 12 && b <= 12) return { iso: null, ambiguous: true };
    if (a > 12 && b <= 12) return { iso: isoDate(y, b, a), ambiguous: false };
    if (b > 12 && a <= 12) return { iso: isoDate(y, a, b), ambiguous: false };
  }
  return { iso: null, ambiguous: false };
}

function normalizeSex(text: string): string | null {
  const normalized = clean(text).toLowerCase();
  if (/^(?:female|f)\b/.test(normalized)) return 'female';
  if (/^(?:male|m)\b/.test(normalized)) return 'male';
  return null;
}

function needsReview(field: ScreeningField, label: string, expected: string, extracted: string | null, explanation: string): ScreeningFinding {
  return { field, label, expected, extracted, status: 'needs_review', explanation };
}

function compareName(lines: string[], applicant: ScreeningApplicant): ScreeningFinding {
  const expected = clean([applicant.firstName, applicant.middleName, applicant.lastName, applicant.suffix].filter(Boolean).join(' '));
  const extracted = extractName(lines);
  if (!normalName(applicant.firstName) || !normalName(applicant.lastName)) {
    return needsReview('fullName', 'Applicant name', expected, extracted, 'First and last names are required in the enrollment form for a reliable comparison.');
  }
  const fromLabel = extracted && [
    [applicant.firstName, applicant.middleName, applicant.lastName, applicant.suffix],
    [applicant.lastName, applicant.firstName, applicant.middleName, applicant.suffix],
  ].some(parts => normalName(extracted) === normalName(parts.filter(Boolean).join(' ')));
  const exactEvidence = fullNameEvidence(lines, applicant);
  if (fromLabel || exactEvidence) {
    return {
      field: 'fullName', label: 'Applicant name', expected,
      extracted: fromLabel ? extracted : exactEvidence,
      status: 'matched',
      explanation: fromLabel
        ? 'Exact applicant name recognized in a labeled field. Preliminary OCR match only; inspect the original.'
        : 'The complete applicant name appears in the OCR text, possibly without a readable label or in surname-first order. This is a preliminary text match; confirm that it identifies the student.',
    };
  }
  if (!extracted) {
    return needsReview('fullName', 'Applicant name', expected, null,
      'The complete applicant name was not found in the OCR text. The scan may have split or misread the name; use the Registrar OCR re-check to inspect the recognized text.');
  }
  const actualNorm = normalName(extracted);
  if (!actualNorm || actualNorm.split(' ').length < 2) {
    return needsReview('fullName', 'Applicant name', expected, extracted, 'The recognized name is incomplete.');
  }
  // A name with no reliable exact match is only a *possible* discrepancy.
  // Other names (parents, guardians) can appear on the same document.
  return { field: 'fullName', label: 'Applicant name', expected, extracted, status: 'possible_mismatch', explanation: 'The name found under a document label differs from the entered full name. OCR errors, missing middle names, and surname order may explain this; inspect the original.' };
}

function compareBirthDate(lines: string[], applicant: ScreeningApplicant): ScreeningFinding {
  const expected = applicant.birthDate;
  const extracted = readLabeledValue(lines, BIRTH_DATE, BIRTH_DATE_ONLY);
  if (!expected || !/^\d{4}-\d{2}-\d{2}$/.test(expected)) {
    return needsReview('birthDate', 'Date of birth', expected, extracted, 'Birthdate on the application is missing or not in YYYY-MM-DD format.');
  }
  if (!extracted) return needsReview('birthDate', 'Date of birth', expected, null, 'No clearly labeled birthdate was recognized.');
  const parsed = parseDate(extracted);
  if (parsed.ambiguous) return needsReview('birthDate', 'Date of birth', expected, extracted, 'Ambiguous numeric date (day/month order cannot be determined).');
  if (!parsed.iso) return needsReview('birthDate', 'Date of birth', expected, extracted, 'Recognized birthdate could not be parsed reliably.');
  return {
    field: 'birthDate', label: 'Date of birth', expected, extracted,
    status: parsed.iso === expected ? 'matched' : 'possible_mismatch',
    explanation: parsed.iso === expected ? 'Parsed birthdate matches the application.' : 'Dates differ. Confirm against the original image.',
  };
}

function compareSex(lines: string[], applicant: ScreeningApplicant): ScreeningFinding {
  const expected = applicant.sex;
  const extracted = readLabeledValue(lines, SEX, SEX_ONLY);
  const actual = extracted ? normalizeSex(extracted) : null;
  const entered = normalizeSex(expected);
  if (!entered) return needsReview('sex', 'Sex', expected, extracted, 'Application sex is missing or is not a directly comparable Male/Female value.');
  if (!actual) return needsReview('sex', 'Sex', expected, extracted, 'Sex was not recognized clearly from a labeled field.');
  return {
    field: 'sex', label: 'Sex', expected, extracted,
    status: actual === entered ? 'matched' : 'possible_mismatch',
    explanation: actual === entered ? 'Recognized sex matches the application.' : 'Values differ; verify the image.',
  };
}

/**
 * For now, PSA Birth Certificate is the only document with validated target
 * fields. For other documents, check a clearly labeled applicant name only;
 * documents without a labeled name will request manual review.
 */
export function compareDocumentText(
  requirementType: string,
  ocrText: string,
  applicant: ScreeningApplicant,
  diagnostics?: OcrDiagnosticsInput,
): ScreeningResult {
  const lines = linesOf(ocrText);
  const isBirthCertificate = /PSA Birth Certificate/i.test(requirementType);
  const findings = lines.length ? [compareName(lines, applicant)] : [
    needsReview('fullName', 'Applicant name', clean([applicant.firstName, applicant.middleName, applicant.lastName].join(' ')), null, 'OCR returned no readable text.'),
  ];

  if (isBirthCertificate) {
    findings.push(compareBirthDate(lines, applicant), compareSex(lines, applicant));
  }
  const ocrQuality = diagnostics ? evaluateOcrQuality(ocrText, diagnostics) : undefined;
  // Low *overall* confidence should not erase an exact full-name text match.
  // This is a preliminary text observation, not automatic document approval.
  // Uncertain date/sex findings and possible mismatches remain manual-review.
  if (ocrQuality?.status === 'review_required') {
    findings.forEach((finding) => {
      if (finding.status === 'possible_mismatch' ||
        (finding.status === 'matched' && finding.field !== 'fullName')) {
        finding.status = 'needs_review';
        finding.explanation = `OCR quality needs manual verification. ${finding.explanation}`;
      } else if (finding.status === 'matched') {
        finding.explanation = `${finding.explanation} Overall OCR confidence is low; verify visually.`;
      }
    });
  }
  const notes = [
    'These are preliminary OCR comparisons, not proof of document authenticity.',
    'A missing/unreadable field needs human review; do not treat it as a failed verification.',
  ];
  if (!isBirthCertificate) notes.push('This document type checks name text only, including exact complete names detected without a readable label.');
  if (ocrQuality) notes.push('Tesseract confidence is an internal engine score, NOT measured OCR accuracy or proof of authenticity.');

  return {
    requirementType, findings, notes,
    ...(ocrQuality ? { ocrQuality, comparisonVersion: 'rules-v3-name-evidence' } : {}),
    matchedCount: findings.filter(f => f.status === 'matched').length,
    mismatchCount: findings.filter(f => f.status === 'possible_mismatch').length,
    needsReviewCount: findings.filter(f => f.status === 'needs_review').length,
  };
}
