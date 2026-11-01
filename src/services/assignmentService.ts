import { supabase } from '../lib/supabase';
import type { AssignmentView, TermPlan } from './assignmentRules';
export { eligibleOfferings, getMatchingTerm, prerequisitesForCourse, overlappingMeetings, sectionHasRoom, meetingLabel } from './assignmentRules';
export type { AssignmentView, TermPlan } from './assignmentRules';

export type AssignmentHistory = {
  id: string; application_id: string; term_id: string; course_id: string;
  offering_id: string; action: 'assigned' | 'removed'; note: string; occurred_at: string;
};
export async function loadStudentAssignments(applicationId: string) {
  const [plans, assigned] = await Promise.all([
    supabase.from('picc_student_term_plans').select('*').eq('application_id', applicationId),
    supabase.from('picc_student_course_assignments').select('*').eq('application_id', applicationId).order('assigned_at'),
  ]);
  if (plans.error) throw new Error(`Term plans: ${plans.error.message}`);
  if (assigned.error) throw new Error(`Assignments: ${assigned.error.message}`);
  return { plans: (plans.data || []) as TermPlan[], assignments: (assigned.data || []) as AssignmentView[] };
}
export async function loadAssignmentHistory(applicationId: string): Promise<AssignmentHistory[]> {
  const { data, error } = await supabase.from('picc_student_assignment_history')
    .select('*').eq('application_id', applicationId).order('occurred_at', { ascending: false }).limit(30);
  if (error) throw new Error(error.message);
  return (data || []) as AssignmentHistory[];
}
export async function loadSectionAssignments(termId: string): Promise<AssignmentView[]> {
  // Registrar-only assignment selector; RLS blocks other students' records.
  const { data, error } = await supabase.from('picc_student_course_assignments').select('*').eq('term_id', termId);
  if (error) throw new Error(error.message);
  return (data || []) as AssignmentView[];
}
export async function assignStudentCourse(input: { applicationId: string; termId: string;
  curriculumId: string; offeringId: string; prerequisiteNote: string }) {
  const { error } = await supabase.rpc('picc_assign_student_offering', {
    p_application_id: input.applicationId,
    p_term_id: input.termId,
    p_curriculum_id: input.curriculumId,
    p_offering_id: input.offeringId,
    p_prerequisite_note: input.prerequisiteNote,
  });
  if (error) throw new Error(error.message);
}
export async function removeStudentCourse(id: string) {
  const { error } = await supabase.rpc('picc_remove_student_offering', { p_assignment_id: id });
  if (error) throw new Error(error.message);
}
export async function clearStudentTermPlan(id: string) {
  const { error } = await supabase.rpc('picc_clear_student_term_plan', { p_plan_id: id });
  if (error) throw new Error(error.message);
}
