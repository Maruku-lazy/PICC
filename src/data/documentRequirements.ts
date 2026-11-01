/**
 * PiCC F2-inspired document checklist. Must be confirmed against the
 * Registrar's latest approved enrollment requirements before production use.
 * `physicalOnly` items have no scanned-file upload field.
 */
export type DocumentRequirement = {
  name: string;
  physicalOnly?: boolean;
};

export const ID_PHOTO_REQUIREMENT = '2×2 ID photo (white background)';

const FRESHMAN_DOCUMENTS: DocumentRequirement[] = [
  { name: 'PiCCAT Result Clearance' },
  { name: 'Original SF9 / High School Report Card' },
  { name: 'Original Certificate of Good Moral Character' },
  { name: 'PSA Birth Certificate' },
  { name: ID_PHOTO_REQUIREMENT },
];

const TRANSFEREE_DOCUMENTS: DocumentRequirement[] = [
  { name: 'PiCCAT Result Clearance' },
  { name: 'Honorable Dismissal / Transfer Credentials' },
  { name: 'Certificate of Grades' },
  { name: 'Subject / Course Descriptions from previous school' },
  { name: 'Original Certificate of Good Moral Character' },
  { name: 'PSA Birth Certificate' },
  { name: ID_PHOTO_REQUIREMENT },
];

export function getDocumentRequirements(
  studentType: 'freshman' | 'transferee' | 'returning',
  married: boolean,
): DocumentRequirement[] {
  if (studentType === 'returning') return [];
  const base = studentType === 'freshman' ? FRESHMAN_DOCUMENTS : TRANSFEREE_DOCUMENTS;
  return married
    ? [...base, { name: 'Marriage Certificate (original and copies)' }]
    : [...base];
}
