const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
function read(file) { return fs.readFileSync(path.join(__dirname, '..', file), 'utf8'); }
test('UI permits Registrar verdicts during form review complete', () => {
  const page = read('src/pages/RegistrarApplication.tsx');
  assert.match(page, /reviewable=\{\['submitted', 'under_review', 'documents_verified'\]/);
});
test('Verdict select has no preselected Pass and requires manual inspection', () => {
  const panel = read('src/components/DocumentAuditPanel.tsx');
  assert.match(panel, /useState<DocumentVerdict\['decision'\] \| ''>\(''\)/);
  assert.match(panel, /I inspected the uploaded file/);
});
test('Migration guards finalized enrollment and permits form-review-complete verdicts', () => {
  const sql = read('supabase/migrations/20261101080000_audit_priority_fixes.sql');
  assert.match(sql, /IN \('submitted','under_review','documents_verified'\)/i);
  assert.match(sql, /picc_enrollment_confirmations/);
  assert.match(sql, /for update/i);
});
