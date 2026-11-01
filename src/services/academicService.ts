import { supabase } from '../lib/supabase';

export type SemesterKey = '1st' | '2nd' | 'summer';
export type Term = {
  id: string; academic_year: string; semester: SemesterKey; start_date: string | null;
  end_date: string | null; is_current: boolean; enrollment_open: boolean;
};
export type Program = { id: string; code: string; name: string; active: boolean };
export type Course = {
  id: string; program_id: string; course_code: string; title: string; units: number;
  recommended_year: number; recommended_semester: SemesterKey; active: boolean;
};
export type Section = {
  id: string; term_id: string; program_id: string; year_level: number;
  section_name: string; capacity: number; active: boolean;
};
export type Offering = {
  id: string; section_id: string; program_id: string; course_id: string;
  instructor_name: string; active: boolean;
};
export type Meeting = {
  id: string; offering_id: string; weekday: number; start_time: string;
  end_time: string; room: string; active: boolean;
};
export type AcademicCatalog = {
  terms: Term[]; programs: Program[]; courses: Course[];
  sections: Section[]; offerings: Offering[]; meetings: Meeting[];
};

const TABLES = {
  terms: 'picc_academic_terms',
  programs: 'picc_academic_programs',
  courses: 'picc_academic_courses',
  sections: 'picc_class_sections',
  offerings: 'picc_course_offerings',
  meetings: 'picc_class_meetings',
} as const;
export type AcademicEntity = keyof typeof TABLES;

export async function getAcademicCatalog(): Promise<AcademicCatalog> {
  const [terms, programs, courses, sections, offerings, meetings] = await Promise.all(
    (Object.keys(TABLES) as AcademicEntity[]).map(async (key) => {
      const { data, error } = await supabase.from(TABLES[key]).select('*').order('created_at', { ascending: false });
      if (error) throw new Error(`${key}: ${error.message}`);
      return data ?? [];
    }),
  );
  return {
    terms: terms as Term[], programs: programs as Program[], courses: courses as Course[],
    sections: sections as Section[], offerings: offerings as Offering[], meetings: meetings as Meeting[],
  };
}

// The database enforces staff-only writes, input constraints, and relationships.
export async function createAcademicRecord(entity: AcademicEntity, payload: Record<string, unknown>) {
  const { error } = await supabase.from(TABLES[entity]).insert(payload);
  if (error) throw new Error(error.message);
}

export async function updateAcademicRecord(entity: AcademicEntity, id: string, patch: Record<string, unknown>) {
  const { data, error } = await supabase.from(TABLES[entity]).update(patch).eq('id', id).select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('Nothing changed. Check Registrar permissions and the current record.');
}

export async function setCurrentAcademicTerm(id: string) {
  const { error } = await supabase.rpc('picc_set_current_term', { p_term_id: id });
  if (error) throw new Error(error.message);
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function yearLooksValid(year: string) {
  const m = /^(20\d{2})-(20\d{2})$/.exec(year);
  return !!m && Number(m[2]) === Number(m[1]) + 1;
}

export function formatAcademicTerm(t: Term) {
  return `${t.academic_year} · ${t.semester === '1st' ? '1st semester' : t.semester === '2nd' ? '2nd semester' : 'Summer'}`;
}
