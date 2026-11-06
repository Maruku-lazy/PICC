const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const filename = join(__dirname, '../src/services/fileValidation.ts');
const code = ts.transpileModule(readFileSync(filename,'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
const m = new Module(filename, module); m.filename=filename;m.paths=module.paths;m._compile(code,filename);
const {validateDocumentBytes} = m.exports;
function file(name,type,bytes){
  const blob = new Blob([Uint8Array.from(bytes)],{type});
  return {name, type, size:blob.size, slice:(...args)=>blob.slice(...args)};
}
test('allows a valid PNG scan header',async()=>{
  await validateDocumentBytes(file('test.png','image/png',[137,80,78,71,13,10,26,10]));
});
test('rejects renamed text masquerading as JPEG',async()=>{
  await assert.rejects(validateDocumentBytes(file('fake.jpg','image/jpeg',[72,69,76,76,79])),/valid JPG/);
});
test('rejects PDF with JPG extension',async()=>{
  await assert.rejects(validateDocumentBytes(file('fake.jpg','application/pdf',[37,80,68,70,45])),/extension and file type/);
});
test('allows a valid PDF header',async()=>{
  await validateDocumentBytes(file('form.pdf','application/pdf',[37,80,68,70,45,49,46,55]));
});
