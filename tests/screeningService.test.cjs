/* Pure comparison-logic tests. No Supabase account or student data required. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.join(__dirname, '..', 'src', 'services', 'screeningService.ts');
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const compiled = new Module(filename, module);
compiled.filename = filename;
compiled.paths = module.paths;
compiled._compile(code, filename);
const { compareDocumentText } = compiled.exports;

const applicant = {
  firstName: 'Juan', middleName: 'Miguel', lastName: 'Dela Cruz', suffix: '',
  birthDate: '2007-03-15', sex: 'Male',
};

function statuses(text, type = 'PSA Birth Certificate') {
  return Object.fromEntries(compareDocumentText(type, text, applicant).findings.map(x => [x.field, x.status]));
}

test('PSA labeled fields match when normalized', () => {
  assert.deepEqual(statuses('NAME OF CHILD: Juan Miguel Dela Cruz\nDATE OF BIRTH: March 15, 2007\nSEX: M'), {
    fullName: 'matched', birthDate: 'matched', sex: 'matched',
  });
});

test('PSA differing birthdate is a possible mismatch', () => {
  assert.equal(statuses('Full Name: Juan Miguel Dela Cruz\nDOB: March 16, 2007\nSex: Male').birthDate, 'possible_mismatch');
});

test('Ambiguous numeric dates require review', () => {
  assert.equal(statuses('Name: Juan Miguel Dela Cruz\nDOB: 03/04/2007\nSex: Male').birthDate, 'needs_review');
});

test('Unlabeled date and names are not guessed', () => {
  assert.deepEqual(statuses('JUAN MIGUEL DELA CRUZ\nMARCH 15 2007\nMALE'), {
    fullName: 'needs_review', birthDate: 'needs_review', sex: 'needs_review',
  });
});

test('Clear birthdates in ISO and unambiguous numeric formats', () => {
  assert.equal(statuses('Name: Juan Miguel Dela Cruz\nDOB: 2007-03-15\nSex: Male').birthDate, 'matched');
  assert.equal(statuses('Name: Juan Miguel Dela Cruz\nDOB: 15/03/2007\nSex: Male').birthDate, 'matched');
  assert.equal(statuses('Name: Juan Miguel Dela Cruz\nDOB: 03/15/2007\nSex: Male').birthDate, 'matched');
});

test('Other document types only compare labeled applicant name', () => {
  const result = compareDocumentText('Original Certificate of Good Moral Character', 'Student Name: Juan Miguel Dela Cruz\nDate of Birth: March 16, 2007', applicant);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].status, 'matched');
});

test('Separate labeled name parts can be joined', () => {
  assert.equal(statuses('First Name: Juan\nMiddle Name: Miguel\nLast Name: Dela Cruz\nDOB: March 15, 2007\nSex: Male').fullName, 'matched');
});

test('Impossible dates are not compared', () => {
  assert.equal(statuses('Name: Juan Miguel Dela Cruz\nDOB: February 30, 2007\nSex: Male').birthDate, 'needs_review');
});

