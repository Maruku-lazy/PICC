/**
 * PiCC F2-inspired document checklist. Must be confirmed against the
 * Registrar's latest approved enrollment requirements before production use.
 * `physicalOnly` items have no scanned-file upload field.
 */
export type DocumentRequirement = {
  name: string;
  physicalOnly?: boolean;
};

const FRESHMAN_DOCUMENTS: DocumentRequirement[] = [
  { name: 'PiCCAT Result Clearance' },
  { name: 'Original SF9 / High School Report Card' },
  { name: 'Original Certificate of Good Moral Character' },
  { name: 'PSA Birth Certificate' },
  { name: 'Two 2×2 and two 1×1 ID photos (white background)' },
  { name: 'One long white folder', physicalOnly: true },
];

const TRANSFEREE_DOCUMENTS: DocumentRequirement[] = [
  { name: 'PiCCAT Result Clearance' },
  { name: 'Honorable Dismissal / Transfer Credentials' },
  { name: 'Certificate of Grades' },
  { name: 'Subject / Course Descriptions from previous school' },
  { name: 'Original Certificate of Good Moral Character' },
  { name: 'PSA Birth Certificate' },
  { name: 'Two 2×2 and two 1×1 ID photos' },
  { name: 'One long white folder', physicalOnly: true },
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
