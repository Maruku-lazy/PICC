import type { SemesterKey } from './academicService';

export function termSortIndex(year: number, semester: SemesterKey) {
  return year * 10 + (semester === '1st' ? 1 : semester === '2nd' ? 2 : 3);
}

export type PrerequisiteEdge = { curriculum_item_id: string; prerequisite_item_id: string };
// Preview validation only. PostgreSQL rejects cycles independently.
export function wouldCreateCycle(
  prerequisites: PrerequisiteEdge[],
  subjectId: string,
  prerequisiteId: string,
): boolean {
  if (!subjectId || !prerequisiteId || subjectId === prerequisiteId) return true;
  const graph = new Map<string, string[]>();
  for (const link of prerequisites) {
    graph.set(link.curriculum_item_id, [...(graph.get(link.curriculum_item_id) ?? []), link.prerequisite_item_id]);
  }
  const stack = [prerequisiteId];
  const visited = new Set<string>();
  while (stack.length) {
    const current = stack.pop()!;
    if (current === subjectId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    stack.push(...(graph.get(current) ?? []));
  }
  return false;
}
