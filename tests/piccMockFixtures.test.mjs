import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMockStudents, isOurSeededAuthUser, makeMockStudent, MOCK_BATCH, assertMockApplication } from '../scripts/piccMockFixtures.mjs';

const students = buildMockStudents();
test('generates exactly 50 unique fictional accounts', () => {
  assert.equal(students.length, 50);
  assert.equal(new Set(students.map(s => s.email)).size, 50);
  assert.ok(students.every(s => /^picc\.mock\.student\d{3}@example\.com$/.test(s.email)));
});
test('all 50 are submitted and appear in Registrar queue', () => {
  assert.ok(students.every(s => s.status === 'submitted'));
});
test('all records meet Phase 1 submit fields and contain no filenames-as-evidence', () => {
  for (const record of students) {
    const f = record.form_data;
    assert.ok(f.firstName && f.lastName && f.program && f.academicYear);
    assert.equal(f.declarationConfirmed, true);
    assert.equal(f._picc_mock_seed, MOCK_BATCH);
    assert.equal(f.email, record.email);
    assert.ok(!Object.hasOwn(f, 'documentUploads'));
    assert.ok(!Object.hasOwn(f, 'payment_status'));
  }
});
test('uses all four PiCC programs and both freshman/transferee classes', () => {
  assert.equal(new Set(students.map(s => s.form_data.program)).size, 4);
  assert.deepEqual(new Set(students.map(s => s.form_data.studentType)), new Set(['freshman','transferee']));
});
test('all phone numbers and addresses are deliberately fictional placeholders', () => {
  assert.ok(students.every(s => /^000000\d{5}$/.test(s.form_data.contactNumber)));
  assert.ok(students.every(s => s.form_data.permanentAddress.startsWith('MOCK ADDRESS')));
});
test('only exact, tagged Auth accounts are eligible for cleanup', () => {
  const user = { email: 'picc.mock.student001@example.com', user_metadata: { picc_mock_seed: MOCK_BATCH, picc_mock_kind: 'student' } };
  assert.equal(isOurSeededAuthUser(user), true);
  assert.equal(isOurSeededAuthUser({ ...user, email: 'registrar@example.com' }), false);
  assert.equal(isOurSeededAuthUser({ ...user, user_metadata: {} }), false);
  assert.equal(isOurSeededAuthUser({ ...user, email: 'picc.mock.student001@gmail.com' }), false);
});
test('only matching tagged application record is eligible for cleanup', () => {
  const record = { form_data: students[0].form_data };
  assert.equal(assertMockApplication(record, students[0].email), true);
  assert.equal(assertMockApplication(record, students[1].email), false);
  assert.equal(assertMockApplication({ form_data: { ...students[0].form_data, _picc_mock_seed: null } }, students[0].email), false);
});
test('throws outside the 50 allocated fixture positions', () => {
  assert.throws(() => makeMockStudent(51));
  assert.throws(() => makeMockStudent(0));
  assert.throws(() => makeMockStudent(0.5));
});
