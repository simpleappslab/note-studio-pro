'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../dist/pdf-studio-core.js');
test('ranges preserve explicit order and duplicate pages',()=>{
 assert.deepEqual(core.pageRange('3,1-2,3',3),[2,0,1,2]);
});
test('invalid and oversized ranges are rejected',()=>{
 for(const s of ['','0','3-1','1-9','1,,2','1.5','1e2','-1'])assert.throws(()=>core.pageRange(s,4));
 assert.throws(()=>core.pageRange('1-1000,1',1000));
});
test('PDF signature and filename validation',()=>{
 assert.equal(core.validateBytes(Uint8Array.from(Buffer.from('%PDF-1.7'))).length,8);
 assert.throws(()=>core.validateBytes(Uint8Array.from(Buffer.from('not pdf'))));
 assert.equal(core.safeFilename('../a.pdf'),'.._a.pdf');
});
test('missing library fails closed',()=>assert.throws(()=>core.engine(null)));
