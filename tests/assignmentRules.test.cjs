// Pure assignment checks; database RPC independently enforces real integrity.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/services/assignmentRules.ts'), 'utf8');
const script = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const api = {};
new Function('exports','require',script)(api, require);
const { getMatchingTerm, eligibleOfferings, prerequisitesForCourse, overlappingMeetings, sectionHasRoom, meetingLabel } = api;
const catalog = {
  terms: [{ id: 'T', academic_year: '2026-2027', semester: '1st' }],
  programs: [{ id: 'P', name: 'BS Criminology', active: true }],
  courses: [{ id: 'C', active: true, program_id: 'P' }, { id:'D',active:true,program_id:'P' }],
  sections: [{ id: 'S', term_id:'T', program_id:'P',year_level:1,capacity:2,active:true }],
  offerings: [{ id: 'O', section_id:'S',program_id:'P',course_id:'C',active:true },{id:'O2',section_id:'S',program_id:'P',course_id:'D',active:true}],
  meetings: [],
};
const items = [
  { id: 'I', curriculum_id: 'V', program_id:'P', course_id:'C',year_level:1,semester:'1st' },
  { id: 'J', curriculum_id: 'V', program_id:'P',course_id:'D',year_level:1,semester:'2nd' },
];
test('term must match academic year and semester', () => {
  assert.equal(getMatchingTerm(catalog,'2026-2027','1st')?.id,'T');
  assert.equal(getMatchingTerm(catalog,'2026-2027','2nd'),undefined);
});
test('eligible offerings limited to published curriculum subject placement', () => {
  assert.deepEqual(eligibleOfferings(catalog,items,'V','P',1,'T','1st').map((x) => x.id),['O']);
});
test('ineligible academic program cannot list offerings', () => {
  assert.deepEqual(eligibleOfferings(catalog,items,'V','OTHER',1,'T','1st'),[]);
});
test('archived section is excluded', () => {
  assert.deepEqual(eligibleOfferings({ ...catalog, sections:[{ ...catalog.sections[0],active:false }] },items,'V','P',1,'T','1st'),[]);
});
test('prerequisite lookup respects curriculum version', () => {
  const p=[{curriculum_id:'V',curriculum_item_id:'I',prerequisite_item_id:'J'}];
  assert.deepEqual(prerequisitesForCourse(items,p,'V','C'),['D']);
  assert.deepEqual(prerequisitesForCourse(items,p,'V','D'),[]);
});
test('overlapping class periods are detected', () => {
  assert.equal(overlappingMeetings([{active:true,weekday:1,start_time:'09:00',end_time:'10:30'}],[{active:true,weekday:1,start_time:'10:00',end_time:'11:00'}]),true);
});
test('adjacent and different day meetings do not overlap', () => {
  assert.equal(overlappingMeetings([{active:true,weekday:1,start_time:'09:00',end_time:'10:00'}],[{active:true,weekday:1,start_time:'10:00',end_time:'11:00'}]),false);
  assert.equal(overlappingMeetings([{active:true,weekday:1,start_time:'09:00',end_time:'10:00'}],[{active:true,weekday:2,start_time:'09:00',end_time:'10:00'}]),false);
});
test('section capacity counts unique applicants, not their distinct courses', () => {
  const assigned=[{section_id:'S',application_id:'A'},{section_id:'S',application_id:'A'},{section_id:'S',application_id:'B'}];
  assert.equal(sectionHasRoom(catalog.sections[0],assigned,'C'),false);
  assert.equal(sectionHasRoom(catalog.sections[0],assigned,'A'),true);
});
test('meeting label includes day, time and room', () => {
  assert.equal(meetingLabel(1,'08:00:00','09:30:00','RM 1'),'Mon 08:00–09:30 · RM 1');
});
