'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {transpose}=require('../dist/transpose-core.js');
const {parse}=require('../dist/json-preview-core.js');
const {render}=require('../dist/markdown-core.js');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
test('spreadsheet formulas and whitespace bypasses are neutralized in CSV and TSV',()=>{
 for(const format of ['csv','tsv']){
  for(const value of ['=1+1','+SUM(A1:A2)','-1+2','@SUM(1)',' \t=HYPERLINK("https://invalid.test","x")','\r=1','\n=1','\u0000=1','-123']){
   const result=transpose(JSON.stringify([[value]]),'json',format);
   assert.equal(result.protectedCells,1);
   assert.equal(result.preview[0][0],"'"+value);
   // Parse the serialized export again to confirm quoting cannot bypass the prefix.
   assert.equal(JSON.parse(transpose(result.text,format,'json').text)[0][0],"'"+value);
  }
 }
});
test('JSON output preserves formula text exactly without executing it',()=>{
 const input=[['=1+1','-123','@SUM(1)']];
 assert.deepEqual(JSON.parse(transpose(JSON.stringify(input),'json','json').text),input[0].map(x=>[x]));
});
test('ordinary content is not changed by spreadsheet protection',()=>{
 const r=transpose('[["001","hello","https://example.test","1+1"]]', 'json','csv');
 assert.equal(r.protectedCells,0);
 assert.equal(r.text,'001\nhello\nhttps://example.test\n1+1');
});
test('prototype keys remain data in JSON previews and transpose',()=>{
 const text='[{"__proto__":"bad","constructor":"bad","prototype":"bad"}]';
 parse(text);transpose(text);
 assert.equal(Object.prototype.bad,undefined);
 assert.equal({}.polluted,undefined);
});
test('JSON UI renders user values as text, not HTML or evaluated code',()=>{
 for(const file of ['dist/json-preview.js','dist/transpose.js']){
  const code=read(file);
  assert.doesNotMatch(code,/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\s*\(|new Function/);
  assert.match(code,/\.textContent/);
 }
});
test('new tools have no network, clipboard-read, or persistence calls',()=>{
 for(const file of ['transpose.js','transpose-core.js','json-preview.js','json-preview-core.js']){
  assert.doesNotMatch(read('dist/'+file),/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|clipboard\.read|localStorage|sessionStorage/);
 }
});
test('web CSP blocks foreign scripts, objects, frames and form submissions',()=>{
 const html=read('dist/index.html'),policy=html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
 for(const directive of ["script-src 'self'","connect-src 'self'","object-src 'none'","base-uri 'none'","form-action 'none'","frame-src 'none'"])assert.ok(policy.includes(directive));
 assert.doesNotMatch(policy,/unsafe-eval|script-src[^;]*unsafe-inline/);
 assert.ok(html.indexOf('Content-Security-Policy')<html.indexOf('<script'));
});
test('Markdown malicious HTML and URL schemes are not executed or rendered as active images',()=>{
 const html=render('<img src=x onerror=alert(1)>\n<script>alert(1)</script>\n[x](javascript:alert(1))\n![x](https://invalid.test/tracker.png)').html;
 assert.doesNotMatch(html,/<script\b|<img\b|href="javascript:/i);
 assert.match(html,/&lt;script&gt;/);
});
