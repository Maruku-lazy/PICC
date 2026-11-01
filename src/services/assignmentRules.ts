import type { AcademicCatalog, Meeting, Offering, Section } from './academicService';
import type { CurriculumItem, CurriculumPrerequisite } from './curriculumService';

export type AssignmentView = {
  id: string; plan_id: string; application_id: string; term_id: string;
  offering_id: string; section_id: string; course_id: string;
  prerequisite_note: string; assigned_at: string;
};
export type TermPlan = {
  id: string; application_id: string; term_id: string;
  curriculum_id: string; created_at: string;
};

export function getMatchingTerm(catalog: AcademicCatalog, year: string, semester: string) {
  return catalog.terms.find((term) => term.academic_year === year && term.semester === semester);
}

export function eligibleOfferings(catalog: AcademicCatalog, items: CurriculumItem[], curriculumId: string,
  programId: string, yearLevel: number, termId: string, semester: string): Offering[] {
  const validCourses = new Set(items.filter((item) => item.curriculum_id === curriculumId &&
    item.program_id === programId && item.year_level === yearLevel && item.semester === semester)
    .map((item) => item.course_id));
  const validSections = new Set(catalog.sections.filter((section) => section.term_id === termId &&
    section.program_id === programId && section.year_level === yearLevel && section.active)
    .map((section) => section.id));
  return catalog.offerings.filter((offering) => offering.active && offering.program_id === programId &&
    validCourses.has(offering.course_id) && validSections.has(offering.section_id) &&
    catalog.courses.some((course) => course.id === offering.course_id && course.active));
}

export function prerequisitesForCourse(items: CurriculumItem[], prereqs: CurriculumPrerequisite[],
  curriculumId: string, courseId: string) {
  const item = items.find((entry) => entry.curriculum_id === curriculumId && entry.course_id === courseId);
  return item ? prereqs.filter((entry) => entry.curriculum_id === curriculumId && entry.curriculum_item_id === item.id)
    .map((entry) => items.find((part) => part.id === entry.prerequisite_item_id)?.course_id).filter((id): id is string => Boolean(id)) : [];
}

export function overlappingMeetings(left: Meeting[], right: Meeting[]) {
  return left.some((a) => right.some((b) => a.active && b.active && a.weekday === b.weekday &&
    a.start_time < b.end_time && b.start_time < a.end_time));
}

export function sectionHasRoom(section: Section, assigned: AssignmentView[], applicationId: string) {
  const unique = new Set(assigned.filter((entry) => entry.section_id === section.id).map((entry) => entry.application_id));
  return unique.has(applicationId) || unique.size < section.capacity;
}

export function meetingLabel(day: number, start: string, end: string, room: string) {
  const names = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const time = (value: string) => value.slice(0, 5);
  return `${names[day - 1] || 'Day ?'} ${time(start)}–${time(end)}${room.trim() ? ` · ${room.trim()}` : ''}`;
}
