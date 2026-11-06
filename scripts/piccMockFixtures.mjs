/**
 * PiCC synthetic application fixtures. No personally identifying user data.
 * This file is pure and safe to import in Node tests without credentials.
 */
export const MOCK_BATCH = 'picc-mock-50-v1';
export const MOCK_EMAIL_DOMAIN = 'example.com'; // RFC 2606 reserved for examples.
export const MOCK_EMAIL_PREFIX = 'picc.mock.student';

const FIRST_NAMES = [
  'Alex', 'Bianca', 'Carlo', 'Dani', 'Emilio', 'Faye', 'Gabriel', 'Hannah',
  'Ian', 'Jessa', 'Kian', 'Lara', 'Marco', 'Nina', 'Owen', 'Paula',
  'Rafael', 'Sofia', 'Tomas', 'Uma', 'Victor', 'Wendy', 'Xander', 'Yna', 'Zion',
];
const MIDDLE_NAMES = ['Demo', 'Sample', 'Fiction', 'Training', 'Mock'];
const PROGRAMS = [
  'BS Criminology',
  'BTLEd – Information and Communication Technology',
  'BSESS – Fitness and Sports Management',
  'BSESS – Fitness and Sports Coaching',
];

/** @param {number} number - 1 through 50 */
export function makeMockStudent(number) {
  if (!Number.isInteger(number) || number < 1 || number > 50) {
    throw new RangeError('Mock student number must be an integer from 1 to 50.');
  }
  const sequence = String(number).padStart(3, '0');
  const email = `${MOCK_EMAIL_PREFIX}${sequence}@${MOCK_EMAIL_DOMAIN}`;
  const firstName = FIRST_NAMES[(number - 1) % FIRST_NAMES.length];
  const middleName = MIDDLE_NAMES[(number - 1) % MIDDLE_NAMES.length];
  const lastName = `Mockstudent${sequence}`;
  const fullName = `${firstName} ${middleName} ${lastName}`;
  const studentType = number % 4 === 0 ? 'transferee' : 'freshman';
  const yearLevel = studentType === 'transferee' ? '2' : '1';
  const birthYear = 2004 + (number % 5);
  const birthMonth = String((number % 12) + 1).padStart(2, '0');
  const birthDay = String((number % 27) + 1).padStart(2, '0');
  const program = PROGRAMS[(number - 1) % PROGRAMS.length];
  const fakePhone = `000000${String(number).padStart(5, '0')}`;
  const form_data = {
    studentType, program, yearLevel,
    academicYear: '2026-2027', semester: '1st',
    academicTerm: '1st Semester, AY 2026-2027',
    lastName, firstName, middleName, suffix: '', fullName,
    birthDate: `${birthYear}-${birthMonth}-${birthDay}`,
    sex: number % 2 ? 'Female' : 'Male',
    civilStatus: 'Single', religion: '', nationality: 'Filipino', ethnicity: '',
    permanentAddress: `MOCK ADDRESS ${sequence}, Test Barangay, Fictional City`,
    temporaryAddress: '', contactNumber: fakePhone, email,
    fatherName: `Mock Parent F-${sequence}`, fatherOccupation: 'Not specified',
    fatherContact: fakePhone,
    motherName: `Mock Parent M-${sequence}`, motherOccupation: 'Not specified',
    motherContact: fakePhone,
    annualFamilyIncome: '', fourPsMember: '',
    emergencyContact: `Mock Guardian ${sequence}`,
    emergencyRelationship: 'Guardian', emergencyPhone: fakePhone,
    emergencyAddress: `MOCK ADDRESS ${sequence}, Test Barangay, Fictional City`,
    previousSchool: `Fictional Test School ${sequence}`,
    graduationDate: studentType === 'freshman' ? '2026-05-15' : '2025-05-15',
    awardsReceived: '',
    declarationConfirmed: true, // Synthetic checkbox state, not a real consent/signature.
    _picc_mock_seed: MOCK_BATCH,
  };
  return { sequence, email, fullName, form_data, status: 'submitted' };
}

export function buildMockStudents() {
  return Array.from({ length: 50 }, (_, i) => makeMockStudent(i + 1));
}

export function isOurSeededAuthUser(user) {
  return Boolean(
    user?.email &&
    /^picc\.mock\.student\d{3}@example\.com$/i.test(user.email) &&
    user.user_metadata?.picc_mock_seed === MOCK_BATCH &&
    user.user_metadata?.picc_mock_kind === 'student'
  );
}

export function assertMockApplication(application, expectedEmail) {
  return (
    application?.form_data?._picc_mock_seed === MOCK_BATCH &&
    application?.form_data?.email?.toLowerCase() === expectedEmail.toLowerCase()
  );
}
