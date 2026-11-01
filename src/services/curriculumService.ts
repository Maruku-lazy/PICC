export { termSortIndex, wouldCreateCycle } from './curriculumRules';
import { supabase } from '../lib/supabase';
import type { SemesterKey } from './academicService';

export type CurriculumStatus = 'draft' | 'published' | 'retired';
export type CurriculumVersion = {
  id: string;
  program_id: string;
  version_name: string;
  effective_academic_year: string;
  status: CurriculumStatus;
  published_at: string | null;
  created_at: string;
};
export type CurriculumItem = {
  id: string;
  curriculum_id: string;
  program_id: string;
  course_id: string;
  year_level: number;
  semester: SemesterKey;
  is_required: boolean;
  created_at: string;
};
export type CurriculumPrerequisite = {
  id: string;
  curriculum_id: string;
  curriculum_item_id: string;
  prerequisite_item_id: string;
};
export type CurriculumData = {
  versions: CurriculumVersion[];
  items: CurriculumItem[];
  prerequisites: CurriculumPrerequisite[];
};

const VERSION_TABLE = 'picc_curriculum_versions';
const ITEM_TABLE = 'picc_curriculum_items';
const PREREQ_TABLE = 'picc_curriculum_prerequisites';

export async function loadCurriculumData(): Promise<CurriculumData> {
  const [versions, items, prerequisites] = await Promise.all([
    supabase.from(VERSION_TABLE).select('*').order('created_at', { ascending: false }),
    supabase.from(ITEM_TABLE).select('*').order('created_at', { ascending: true }),
    supabase.from(PREREQ_TABLE).select('*').order('created_at', { ascending: true }),
  ]);
  if (versions.error) throw new Error(`Curriculum versions: ${versions.error.message}`);
  if (items.error) throw new Error(`Curriculum subjects: ${items.error.message}`);
  if (prerequisites.error) throw new Error(`Curriculum prerequisites: ${prerequisites.error.message}`);
  return {
    versions: (versions.data ?? []) as CurriculumVersion[],
    items: (items.data ?? []) as CurriculumItem[],
    prerequisites: (prerequisites.data ?? []) as CurriculumPrerequisite[],
  };
}

export async function createCurriculumVersion(input: {
  program_id: string;
  version_name: string;
  effective_academic_year: string;
}): Promise<string> {
  const { data, error } = await supabase.from(VERSION_TABLE).insert(input).select('id').single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function changeCurriculumStatus(id: string, status: 'published' | 'retired') {
  const { data, error } = await supabase.from(VERSION_TABLE).update({ status }).eq('id', id).select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('No change was made. Check your Registrar permissions.');
}

export async function addCurriculumItem(input: {
  curriculum_id: string;
  program_id: string;
  course_id: string;
  year_level: number;
  semester: SemesterKey;
  is_required: boolean;
}) {
  const { error } = await supabase.from(ITEM_TABLE).insert(input);
  if (error) throw new Error(error.message);
}

export async function removeCurriculumItem(id: string) {
  const { data, error } = await supabase.from(ITEM_TABLE).delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('The item was not removed. It may be locked or inaccessible.');
}

export async function addPrerequisite(input: {
  curriculum_id: string;
  curriculum_item_id: string;
  prerequisite_item_id: string;
}) {
  const { error } = await supabase.from(PREREQ_TABLE).insert(input);
  if (error) throw new Error(error.message);
}

export async function removePrerequisite(id: string) {
  const { data, error } = await supabase.from(PREREQ_TABLE).delete().eq('id', id).select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('The prerequisite was not removed.');
}

