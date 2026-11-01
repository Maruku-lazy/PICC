/* Pure overview regression tests. No network or real student documents. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = path.resolve(__dirname, '../src/services/documentAuditService.ts');
const compiledCode = ts.transpileModule(fs.readFileSync(filename,'utf8'), {
  compilerOptions: { module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 },
}).outputText;
const mod = new Module(filename,module);
mod.filename=filename; mod.paths=module.paths;
const baseRequire=mod.require.bind(mod);
mod.require = name => name==='../data/documentRequirements'
  ? {ID_PHOTO_REQUIREMENT:'2×2 ID photo (white background)'} : baseRequire(name);
mod._compile(compiledCode,filename);
const {assessDocuments}=mod.exports;
const PHOTO='2×2 ID photo (white background)', PSA='PSA Birth Certificate';
const req=[{name:PSA},{name:PHOTO}];
const document=(type=PSA,status='complete', id='doc-a',storage_path='owner/app/scan.jpg',mime='image/jpeg')=>({
  id,requirement_type:type,auto_screen_status:status,storage_path,content_type:mime,
});
const screen=(docId='doc-a',path='owner/app/scan.jpg',id='s1')=>({
  id,document_id:docId,storage_path_snapshot:path,requirement_type:PSA,
  matched_count:2,mismatch_count:1,needs_review_count:0,created_at:'2026-11-01T08:00:00Z',
});
const verdict=(decision='passed',docId='doc-a',path='owner/app/scan.jpg')=>({
  id:'v1',document_id:docId,requirement_type:PSA,storage_path_snapshot:path,
  decision,created_at:'2026-11-01T10:00:00Z',superseded_at:null,note:'',
});
test('missing requirements remain missing',()=>{
  const a=assessDocuments(req,[],[],[]);
  assert.equal(a.missing,2);assert.equal(a.attention,2);
});
test('newly uploaded JPG is pending automatic OCR',()=>{
  assert.equal(assessDocuments([{name:PSA}],[document(PSA,'pending')],[],[]).items[0].state,'pending_auto');
});
test('failed automatic OCR is visible to Registrar',()=>{
  assert.equal(assessDocuments([{name:PSA}],[document(PSA,'failed')],[],[]).items[0].state,'failed_auto');
});
test('current saved OCR shows awaiting Registrar verdict and count',()=>{
  const a=assessDocuments([{name:PSA}],[document()],[screen()],[]);
  assert.equal(a.items[0].state,'awaiting_registrar');assert.equal(a.currentScreenings,1);
});
test('OCR match alone never counts as final pass',()=>{
  const a=assessDocuments([{name:PSA}],[document()],[screen()],[]);
  assert.equal(a.reviewsRecorded,0);assert.equal(a.attention,1);
});
test('Registrar pass is reflected independently of AI results',()=>{
  const a=assessDocuments([{name:PSA}],[document(PSA,'failed')],[],[],[verdict('passed')]);
  assert.equal(a.items[0].state,'passed');assert.equal(a.reviewsRecorded,1);assert.equal(a.attention,0);
});
test('Registrar fail and followup remain distinct',()=>{
  for(const [decision,state] of [['failed','failed'],['needs_followup','needs_followup']]){
    const a=assessDocuments([{name:PSA}],[document()],[screen()],[],[verdict(decision)]);
    assert.equal(a.items[0].state,state);assert.equal(a.attention,1);
  }
});
test('replaced document does not inherit old screening or verdict',()=>{
  const a=assessDocuments([{name:PSA}],[document(PSA,'pending','doc-b','owner/app/new.jpg')],
    [screen()],[],[verdict('passed')]);
  assert.equal(a.items[0].state,'pending_auto');assert.equal(a.reviewsRecorded,0);
});
test('same ID but replaced storage path invalidates earlier verdict',()=>{
  const a=assessDocuments([{name:PSA}],[document(PSA,'pending','doc-a','owner/app/new.jpg')],
    [screen()],[],[verdict('passed')]);
  assert.equal(a.items[0].state,'pending_auto');assert.equal(a.reviewsRecorded,0);
});
test('superseded verdict after edited form does not count',()=>{
  const v={...verdict(),superseded_at:'2026-11-01T12:00:00Z'};
  const a=assessDocuments([{name:PSA}],[document()],[screen()],[],[v]);
  assert.equal(a.items[0].state,'awaiting_registrar');assert.equal(a.reviewsRecorded,0);
});
test('photo and PDF are manual-check items',()=>{
  const docs=[document(PHOTO,'manual','p1','owner/app/p.jpg'),document(PSA,'manual','pdf','owner/app/doc.pdf','application/pdf')];
  const a=assessDocuments(req,docs,[],[]);
  assert.deepEqual(a.items.map(x=>x.state),['manual_check','manual_check']);
});
test('manually inspected ID photo can receive a final verdict',()=>{
  const doc=document(PHOTO,'manual','p1','owner/app/photo.jpg');
  const v={...verdict('passed','p1','owner/app/photo.jpg'),requirement_type:PHOTO};
  const a=assessDocuments([{name:PHOTO}],[doc],[],[],[v]);
  assert.equal(a.items[0].state,'passed');assert.equal(a.reviewsRecorded,1);
});
test('returning student unconfirmed checklist cannot be inferred complete',()=>{
  assert.equal(assessDocuments([],[],[],[]).items.length,0);
});
test('OCR quality warning is visible in Registrar overview without counting as a final verdict',()=>{
  const lowQualityScreen={...screen(), result:{ocrQuality:{status:'review_required',reasons:['Low OCR engine confidence']}}};
  const a=assessDocuments([{name:PSA}],[document()],[lowQualityScreen],[]);
  assert.equal(a.items[0].label,'OCR unclear · Decide');
  assert.match(a.items[0].detail,/Low OCR engine confidence/);
  assert.equal(a.reviewsRecorded,0);
});
