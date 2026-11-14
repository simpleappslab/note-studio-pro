/* Check reconstruction, bounds, whitespace and unified patches with synthetic text only. */
const assert = require('node:assert/strict');
const {performance} = require('node:perf_hooks');
const {execFileSync} = require('node:child_process');
const {mkdtempSync,writeFileSync,readFileSync,rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {compare,patch} = require('../dist/diff-core.js');
const tokens = text => text ? text.match(/[^\n]*\n|[^\n]+$/g) || [] : [];
function check(a,b,ignore=false) {
  const result = compare(a,b,ignore), left=tokens(a), right=tokens(b);
  let x=0,y=0,actualA='',actualB='';
  for(const op of result.ops) {
    assert.equal(op.leftStart,x); assert.equal(op.rightStart,y);
    const sa=left.slice(op.leftStart,op.leftEnd).join(''),sb=right.slice(op.rightStart,op.rightEnd).join('');
    if(op.type==='equal') assert.equal(ignore?sa.replace(/[^\S\n]/g,''):sa,ignore?sb.replace(/[^\S\n]/g,''):sb);
    else if(op.type==='insert') assert.equal(sa,'');
    else assert.equal(sb,'');
    actualA+=sa;actualB+=sb;x=op.leftEnd;y=op.rightEnd;
  }
  assert.equal(actualA,a);assert.equal(actualB,b);
  assert.equal(result.added,result.ops.filter(op=>op.type==='insert').reduce((n,op)=>n+op.rightEnd-op.rightStart,0));
  assert.equal(result.removed,result.ops.filter(op=>op.type==='delete').reduce((n,op)=>n+op.leftEnd-op.leftStart,0));
  return result;
}
const examples=[['',''],['','one\n'],['one\n',''],['one','one\n'],['\n',''],['a\nb\nc\n','a\nx\nc\nd\n'],['a\na\nb\na\n','a\nb\na\na\n'],['<script> & 😀\n','<script> & 🍀\n'],['a\n\n\nb\n','a\n\nb\n'],['a\nb','a\nx\nb'],['a\nx\nb\n','a\nb\n'],['a\nb\nc','x\nb\ny']];
for(const [a,b] of examples) check(a,b);
assert.equal(compare('x = 1;\n',' x=1;\t\n',true).chunks.length,0);
assert.notEqual(compare('x = 1;\n',' x=1;\t\n').chunks.length,0);
assert.equal(compare('one','one\n',true).chunks.length,1);
let seed=17;const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
for(let test=0;test<800;test++) {
  const a=Array.from({length:random(30)},()=>['a','b','c',' ','😀'][random(5)]+'\n').join('');
  const b=Array.from({length:random(30)},()=>['a','b','c',' ','😀'][random(5)]+'\n').join('');
  check(a,b); if(test<60)examples.push([a,b]);
}
const directory=mkdtempSync(join(tmpdir(),'notepad-diff-'));
try {
  for(const [a,b] of examples) {
    const output=patch(a,b); if(a===b){assert.equal(output,'');continue;}
    writeFileSync(join(directory,'original.txt'),a);
    execFileSync('patch',['--silent','--batch','--output',join(directory,'modified.txt'),join(directory,'original.txt')],{input:output});
    assert.equal(readFileSync(join(directory,'modified.txt'),'utf8'),b);
  }
}finally{rmSync(directory,{recursive:true,force:true});}
const large=Array.from({length:50000},(_,i)=>`line ${i}\n`).join('');
const started=performance.now();const big=check(large,large.replace('line 25000\n','changed middle\n'));
assert.equal(big.chunks.length,1);assert.equal(big.added,1);assert.equal(big.removed,1);
const bounded=check('same\n'.repeat(3000),'other\n'.repeat(3000));assert.equal(bounded.simplified,true);
console.log(JSON.stringify({syntheticCases:examples.length+800,patchRoundTrips:examples.length-1,largeLines:50000,largeMilliseconds:Math.round(performance.now()-started),boundedFallback:true}));
