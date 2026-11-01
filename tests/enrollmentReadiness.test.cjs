const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname,'../src/services/enrollmentReadiness.ts'),'utf8');
const output = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const api = {};
new Function('exports','require',output)(api,require);
const run = (overrides = {}) => api.assessEnrollmentReadiness({
  applicationStatus:'documents_verified',requiredDocuments:5,passedDocuments:5,
  assignedCourses:3,paymentStatus:'verified',...overrides,
});
test('fully verified workflow can be confirmed',()=>assert.equal(run().ready,true));
test('approved waiver counts as a payment-ready exception',()=>assert.equal(run({paymentStatus:'waived'}).ready,true));
test('pending payment blocks final confirmation',()=>assert.equal(run({paymentStatus:'pending'}).ready,false));
test('no assessment blocks confirmation',()=>assert.equal(run({paymentStatus:null}).ready,false));
test('partial document verdicts block confirmation',()=>assert.equal(run({passedDocuments:4}).ready,false));
test('returning student without approved checklist blocks confirmation',()=>assert.equal(run({requiredDocuments:0,passedDocuments:0}).ready,false));
test('no subjects blocks confirmation',()=>assert.equal(run({assignedCourses:0}).ready,false));
test('form still under review blocks confirmation',()=>assert.equal(run({applicationStatus:'under_review'}).ready,false));
test('a failed document blocks confirmation',()=>assert.equal(run({passedDocuments:3}).documentsPassed,false));
