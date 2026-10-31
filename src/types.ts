export type DemoRole = 'student' | 'registrar';

export type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'needs_correction'
  | 'documents_verified';

export type StudentType = 'freshman' | 'transferee' | 'returning';
export type Semester = '1st' | '2nd' | 'summer';

/**
 * PiCC F2-inspired SAMPLE form. This prototype saves drafts in browser
 * localStorage; use invented information ONLY. Religion, ethnicity and
 * household financial/assistance details must not be collected from real
 * applicants until lawful purpose, access restrictions, secure storage and
 * retention rules are approved and implemented.
 */
export interface ApplicationInput {
  studentType: StudentType;
  program: string;
  yearLevel: string;
  academicYear: string;
  semester: Semester;
  academicTerm: string; // Display compatibility with existing dashboard
  lastName: string;
  firstName: string;
  middleName: string;
  suffix: string;
  fullName: string; // Display compatibility with existing dashboard
  birthDate: string;
  sex: string;
  civilStatus: string;
  religion: string;
  nationality: string;
  ethnicity: string;
  permanentAddress: string;
  temporaryAddress: string;
  contactNumber: string;
  email: string;
  fatherName: string;
  fatherOccupation: string;
  fatherContact: string;
  motherName: string;
  motherOccupation: string;
  motherContact: string;
  annualFamilyIncome: string; // Annual family income, in PHP
  fourPsMember: '' | 'yes' | 'no';
  documentUploads: Record<string, string>; // Selected filenames only; not file contents
  emergencyContact: string;
  emergencyRelationship: string;
  emergencyPhone: string;
  emergencyAddress: string;
  previousSchool: string;
  graduationDate: string;
  awardsReceived: string;
  declarationConfirmed: boolean; // Demo checkbox, not a legal signature
}

export interface EnrollmentApplication extends ApplicationInput {
  id: string;
  studentId: string;
  status: ApplicationStatus;
  createdAt: string;
  updatedAt: string;
  reviewerNote: string;
}

export const PROGRAMS = [
  'BS Criminology',
  'BTLEd – Information and Communication Technology',
  'BSESS – Fitness and Sports Management',
  'BSESS – Fitness and Sports Coaching',
] as const;

export const statusLabel: Record<ApplicationStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  under_review: 'Under review',
  needs_correction: 'Needs correction',
  documents_verified: 'Review completed (demo)',
};

export const statusDescription: Record<ApplicationStatus, string> = {
  draft: 'Your sample application is saved in this browser. Submit it when the required fields are complete.',
  submitted: 'Your sample application is awaiting initial registrar review.',
  under_review: 'The registrar has started reviewing your sample application.',
  needs_correction: 'The registrar requested changes. Review the note and resubmit.',
  documents_verified: 'Sample form review is complete. Documents and final enrollment have NOT been verified.',
};

export const blankApplication: ApplicationInput = {
  studentType: 'freshman', program: '', yearLevel: '1',
  academicYear: '', semester: '1st', academicTerm: '',
  lastName: '', firstName: '', middleName: '', suffix: '', fullName: '',
  birthDate: '', sex: '', civilStatus: '',
  religion: '', nationality: '', ethnicity: '',
  permanentAddress: '', temporaryAddress: '', contactNumber: '', email: '',
  fatherName: '', fatherOccupation: '', fatherContact: '',
  motherName: '', motherOccupation: '', motherContact: '',
  annualFamilyIncome: '', fourPsMember: '',
  documentUploads: {},
  emergencyContact: '', emergencyRelationship: '', emergencyPhone: '',
  emergencyAddress: '', previousSchool: '', graduationDate: '', awardsReceived: '',
  declarationConfirmed: false,
};
