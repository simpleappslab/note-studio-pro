'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parse}=require('../dist/json-preview-core.js');
test('objects, arrays and scalar roots retain values',()=>{
 for(const value of [{a:[1,true,null,'hello'],empty:{}},[],{},'text',false,0,null]){
  const result=parse(JSON.stringify(value));assert.deepEqual(JSON.parse(result.formatted),value);
 }
});
test('large numbers, exponent spelling and duplicate keys are lossless',()=>{
 const result=parse('{"id":9007199254740993123456789,"a":1e999,"a":-0,"decimal":1.2300}');
 assert.equal(result.tree.children.length,4);
 assert.ok(result.formatted.includes('9007199254740993123456789'));
 assert.ok(result.formatted.includes('1e999'));
 assert.ok(result.formatted.includes('-0'));
 assert.ok(result.formatted.includes('1.2300'));
 assert.deepEqual(result.tree.children.map(x=>x.key),['id','a','a','decimal']);
});
test('escaped keys and strings, Unicode and HTML remain plain data',()=>{
 const result=parse('{"__proto__":"<img src=x onerror=alert(1)>","a/b~c":"नमस्ते 😀","quote\\\"":"line\\nnext"}');
 assert.equal(result.tree.children[0].key,'__proto__');
 assert.equal(result.tree.children[1].key,'a/b~c');
 assert.equal(JSON.parse(result.formatted)['quote"'],'line\nnext');
});
test('invalid JSON is rejected',()=>{
 for(const text of ['', 'undefined','{"a":}', '{"a":1,}', '[1,]', '"bad\\x"', '{"a":1}false']){
  assert.throws(()=>parse(text));
 }
});
test('limits reject excessive depth, size and nodes',()=>{
 assert.throws(()=>parse('['.repeat(130)+'0'+']'.repeat(130)),/nesting/);
 assert.throws(()=>parse(' '.repeat(5*1024*1024+1)),/5 MB/);
 assert.throws(()=>parse('['+'0,'.repeat(50000)+'0]'),/50,000/);
});
test('large arrays are complete and counted',()=>{
 const result=parse(JSON.stringify(Array.from({length:10000},(_,i)=>i)));
 assert.equal(result.count,10001);
 assert.equal(result.tree.children.length,10000);
 assert.equal(JSON.parse(result.formatted)[9999],9999);
});
