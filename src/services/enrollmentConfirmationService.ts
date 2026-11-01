import { supabase } from '../lib/supabase';

export type PaymentStatus = 'pending' | 'verified' | 'waived';
export type EnrollmentAssessment = {
  id: string;
  application_id: string;
  assessed_amount: number;
  payment_status: PaymentStatus;
  external_reference: string;
  payment_note: string;
  recorded_by: string;
  updated_at: string;
};
export type RegistrationMeeting = {
  weekday: number;
  start: string;
  end: string;
  room: string;
};
export type RegistrationCourse = {
  courseCode: string;
  title: string;
  units: number;
  section: string;
  instructor: string;
  meetings: RegistrationMeeting[];
};
export type RegistrationSnapshot = {
  studentName: string;
  program: string;
  yearLevel: string;
  academicYear: string;
  semester: string;
  curriculum: string;
  courses: RegistrationCourse[];
  courseCount: number;
  totalUnits: number;
  assessmentAmount: number;
  paymentStatus: PaymentStatus;
};
export type EnrollmentConfirmation = {
  id: string;
  application_id: string;
  registration_reference: string;
  confirmed_at: string;
  confirmed_by: string;
  registration_snapshot: RegistrationSnapshot;
};
export type AssessmentEvent = {
  id: string;
  assessed_amount: number;
  payment_status: PaymentStatus;
  created_at: string;
};

export async function fetchEnrollmentOutcome(applicationId: string): Promise<{
  assessment: EnrollmentAssessment | null;
  confirmation: EnrollmentConfirmation | null;
}> {
  const [assessmentQuery, confirmationQuery] = await Promise.all([
    supabase.from('picc_enrollment_assessments').select('*').eq('application_id', applicationId).maybeSingle(),
    supabase.from('picc_enrollment_confirmations').select('*').eq('application_id', applicationId).maybeSingle(),
  ]);
  if (assessmentQuery.error) throw new Error(`Assessment: ${assessmentQuery.error.message}`);
  if (confirmationQuery.error) throw new Error(`Confirmation: ${confirmationQuery.error.message}`);
  return {
    assessment: (assessmentQuery.data ?? null) as EnrollmentAssessment | null,
    confirmation: (confirmationQuery.data ?? null) as EnrollmentConfirmation | null,
  };
}

export async function fetchAssessmentEvents(applicationId: string): Promise<AssessmentEvent[]> {
  const { data, error } = await supabase.from('picc_assessment_events')
    .select('id,assessed_amount,payment_status,created_at')
    .eq('application_id', applicationId).order('created_at', { ascending: false }).limit(25);
  if (error) throw new Error(error.message);
  return (data ?? []) as AssessmentEvent[];
}

export async function recordEnrollmentAssessment(input: {
  applicationId: string;
  amount: number;
  paymentStatus: PaymentStatus;
  externalReference: string;
  paymentNote: string;
}): Promise<void> {
  const { error } = await supabase.rpc('picc_record_enrollment_assessment', {
    p_application_id: input.applicationId,
    p_amount: input.amount,
    p_payment_status: input.paymentStatus,
    p_external_reference: input.externalReference,
    p_payment_note: input.paymentNote,
  });
  if (error) throw new Error(error.message);
}

export async function confirmFinalEnrollment(applicationId: string): Promise<void> {
  const { error } = await supabase.rpc('picc_confirm_final_enrollment', {
    p_application_id: applicationId,
    p_attested: true,
  });
  if (error) throw new Error(error.message);
}

export function peso(amount: number | string): string {
  const n = Number(amount);
  return Number.isFinite(n)
    ? n.toLocaleString('en-PH', { style: 'currency', currency: 'PHP' })
    : '—';
}
