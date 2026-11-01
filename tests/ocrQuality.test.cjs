/* Phase 3.6: synthetic, non-identifying OCR diagnostic and comparison regression tests. */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function loadTs(file, injected = {}) {
  const filename = path.resolve(__dirname, file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText;
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = module.paths;
  const requireOriginal = mod.require.bind(mod);
  mod.require = id => Object.prototype.hasOwnProperty.call(injected, id) ? injected[id] : requireOriginal(id);
  mod._compile(code, filename);
  return mod.exports;
}

const quality = loadTs('../src/services/ocrQualityService.ts');
const {compareDocumentText} = loadTs('../src/services/screeningService.ts', {
  './ocrQualityService': quality,
});
const applicant = {firstName:'Juan',middleName:'Santos',lastName:'Dela Cruz',suffix:'',birthDate:'2007-03-15',sex:'Male'};
const sample = 'Name: Juan Santos Dela Cruz\nDate of Birth: March 15, 2007\nSex: Male';

test('readable sample captures numerical engine diagnostics without implying verified accuracy', () => {
  const d = quality.evaluateOcrQuality(sample, {confidence: 91.7, recognitionMs: 1276.8});
  assert.equal(d.engineConfidence, 92);
  assert.equal(d.recognitionMs, 1277);
  assert.equal(d.status, 'readable');
  assert.equal(d.reasons.length, 0);
});
test('OCR confidence just below provisional threshold requests review', () => {
  const d = quality.evaluateOcrQuality(sample, {confidence: 59.99, recognitionMs: 800});
  assert.equal(d.status, 'review_required');
  assert.match(d.reasons.join(' '), /below/);
});
test('exact 60 score does not trigger the confidence warning by itself', () => {
  const d = quality.evaluateOcrQuality(sample, {confidence: 60, recognitionMs: 800});
  assert.equal(d.status, 'readable');
});
test('blank scan requests review even if OCR returns a high confidence', () => {
  const d = quality.evaluateOcrQuality('  \n ', {confidence: 95, recognitionMs: 40});
  assert.equal(d.status, 'review_required');
  assert.equal(d.charactersRecognized, 0);
});
test('missing or nonfinite confidence is treated as unknown, not perfect', () => {
  for (const confidence of [null, NaN, Infinity]) {
    const d = quality.evaluateOcrQuality(sample, {confidence, recognitionMs: 100});
    assert.equal(d.engineConfidence, null);
    assert.equal(d.status, 'review_required');
  }
});
test('out-of-bounds metrics are normalized', () => {
  const d = quality.evaluateOcrQuality(sample, {confidence: 120, recognitionMs: -5});
  assert.equal(d.engineConfidence, 100);
  assert.equal(d.recognitionMs, 0);
});
test('good-quality PSA text retains original matched comparisons', () => {
  const r = compareDocumentText('PSA Birth Certificate', sample, applicant, {confidence: 93, recognitionMs: 900});
  assert.equal(r.matchedCount, 3);
  assert.equal(r.needsReviewCount, 0);
  assert.equal(r.ocrQuality.status, 'readable');
});
test('low-quality PSA text downgrades matches to needs review while preserving extracted values', () => {
  const r = compareDocumentText('PSA Birth Certificate', sample, applicant, {confidence: 35, recognitionMs: 900});
  assert.equal(r.matchedCount, 0);
  assert.equal(r.mismatchCount, 0);
  assert.equal(r.needsReviewCount, 3);
  assert.equal(r.findings.find(x=>x.field==='birthDate').extracted, 'March 15, 2007');
});
test('low-quality mismatched birthdate stays visible without claiming certain discrepancy', () => {
  const text = sample.replace('March 15', 'March 16');
  const r = compareDocumentText('PSA Birth Certificate', text, applicant, {confidence: 41, recognitionMs: 900});
  assert.equal(r.findings.find(x=>x.field==='birthDate').status, 'needs_review');
  assert.match(r.findings.find(x=>x.field==='birthDate').extracted, /March 16/);
});
test('legacy comparison calls without diagnostics retain existing behavior', () => {
  const r = compareDocumentText('PSA Birth Certificate', sample, applicant);
  assert.equal(r.matchedCount, 3);
  assert.equal('ocrQuality' in r, false);
});
