// Test small pure helpers without needing Supabase or a running browser.
// Uses the project's existing TypeScript dev dependency.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/services/curriculumRules.ts'), 'utf8');
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exportsObject = {};
new Function('exports', 'require', javascript)(exportsObject, require);
const { wouldCreateCycle, termSortIndex } = exportsObject;
const edges = [
  { curriculum_item_id: 'B', prerequisite_item_id: 'A' },
  { curriculum_item_id: 'C', prerequisite_item_id: 'B' },
];

test('accepts valid unrelated prerequisite', () => assert.equal(wouldCreateCycle(edges, 'D', 'C'), false));
test('rejects direct self prerequisite', () => assert.equal(wouldCreateCycle([], 'A', 'A'), true));
test('rejects two-way loop', () => assert.equal(wouldCreateCycle([edges[0]], 'A', 'B'), true));
test('rejects a transitive circular chain', () => assert.equal(wouldCreateCycle(edges, 'A', 'C'), true));
test('allows a direct prerequisite that is not circular', () => assert.equal(wouldCreateCycle(edges, 'C', 'A'), false));
test('rejects missing selections', () => assert.equal(wouldCreateCycle([], '', 'B'), true));
test('orders academic years and semesters', () => {
  assert.ok(termSortIndex(1, '1st') < termSortIndex(1, '2nd'));
  assert.ok(termSortIndex(1, '2nd') < termSortIndex(1, 'summer'));
  assert.ok(termSortIndex(1, 'summer') < termSortIndex(2, '1st'));
});
