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
const qualityFilename = path.join(__dirname, '..', 'src', 'services', 'ocrQualityService.ts');
const qualityCode = ts.transpileModule(fs.readFileSync(qualityFilename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const quality = new Module(qualityFilename, module);
quality.filename = qualityFilename;
quality.paths = module.paths;
quality._compile(qualityCode, qualityFilename);
const compiled = new Module(filename, module);
compiled.filename = filename;
compiled.paths = module.paths;
const originalRequire = compiled.require.bind(compiled);
compiled.require = id => id === './ocrQualityService' ? quality.exports : originalRequire(id);
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

test('Complete unlabeled applicant name is detected, while date and sex still need labels', () => {
  assert.deepEqual(statuses('JUAN MIGUEL DELA CRUZ\nMARCH 15 2007\nMALE'), {
    fullName: 'matched', birthDate: 'needs_review', sex: 'needs_review',
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


// Document templates, punctuation, and lines from synthetic OCR examples.
test('Name found inside unrelated heading text without a reliable field label', () => {
  const result = compareDocumentText('Original Certificate of Good Moral Character',
    'CERTIFICATION: This certifies that JUAN MIGUEL DELA CRUZ is a learner of our institution.', applicant);
  assert.equal(result.matchedCount, 1);
  assert.match(result.findings[0].explanation, /without a readable label/i);
});
test('Surname-first OCR layout is a preliminary text match', () => {
  assert.equal(statuses('NAME OF CHILD: DELA CRUZ, JUAN MIGUEL').fullName, 'matched');
});
test('OCR name broken across rows is detectable', () => {
  assert.equal(statuses('JUAN\nMIGUEL\nDELA CRUZ').fullName, 'matched');
});
test('Name of learner and school-specific labels are recognized', () => {
  assert.equal(statuses('NAME OF LEARNER: Juan Miguel Dela Cruz').fullName, 'matched');
  assert.equal(statuses('STUDENT NAME: Juan Miguel Dela Cruz').fullName, 'matched');
});
test('Separate surname/first/middle labels are joined', () => {
  assert.equal(statuses('SURNAME: Dela Cruz\nFIRST NAME: Juan\nMIDDLE NAME: Miguel').fullName, 'matched');
});
test('Partially recognized first-and-last name is not a full match', () => {
  assert.notEqual(statuses('Name: Juan Dela Cruz').fullName, 'matched');
});
test('A different student name is not a match', () => {
  assert.equal(statuses('NAME OF CHILD: Maria Miguel Dela Cruz').fullName, 'possible_mismatch');
});
test('No name tokens found produces needs review, not a made-up mismatch', () => {
  assert.equal(statuses('This is a school certification for school year 2026.').fullName, 'needs_review');
});
