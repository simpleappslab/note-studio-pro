const test=require('node:test'),assert=require('node:assert/strict');
const {transpose:t}=require('../dist/transpose-core.js');
test('CSV swaps rows and columns including header',()=>{
 assert.equal(t('Name,Age\nRam,30\nSam,25').text,'Name,Ram,Sam\nAge,30,25');
});
test('tab-separated Excel text, CRLF and trailing record separator',()=>{
 const r=t('Name\tAge\r\nRam\t30\r\nSam\t25\r\n');
 assert.equal(r.inputFormat,'tsv');assert.equal(r.text,'Name\tRam\tSam\nAge\t30\t25');
});
test('quoted separators, escaped quotes, multiline and empty cells',()=>{
 const input='"a,b","say ""yes"""\r\n"line\nnext",\r\n';
 const r=t(input,'csv','json');
 assert.deepEqual(JSON.parse(r.text),[['a,b','line\nnext'],['say "yes"','']]);
});
test('CSV matrix double transpose round trip',()=>{
 for(const input of ['a,b\nc,d','"a,b","say ""yes"""\n"line\nnext",','""','a,\nb,','a\n\n','"a\tb",c']){
  const once=t(input,'csv'),twice=t(once.text,'csv');
  assert.equal(t(twice.text,'csv','json').text,t(input,'csv','json').text);
 }
});
test('ragged CSV pads blank cells and preserves numeric-looking text',()=>{
 const r=t('001,2\n3','csv','json');
 assert.equal(r.ragged,true);assert.deepEqual(JSON.parse(r.text),[['001','3'],['2','']]);
});
test('JSON preserves numbers and scalar types',()=>{
 const r=t('[[900719925474099312345,true,null],[-0,false,"x"]]','json');
 assert.ok(r.text.includes('900719925474099312345'));assert.ok(r.text.includes('-0'));
 assert.deepEqual(JSON.parse(r.text).slice(1),[[true,false],[null,'x']]);
});
test('object rows union keys in order, missing cells are null',()=>{
 const r=t('[{"Name":"Ram","Age":30},{"Name":"Sam","City":"Pune"}]');
 assert.deepEqual(JSON.parse(r.text),[['Name','Ram','Sam'],['Age',30,null],['City',null,'Pune']]);
});
test('JSON ragged arrays and empty arrays',()=>{
 assert.deepEqual(JSON.parse(t('[[1,2],[3]]').text),[[1,3],[2,null]]);
 assert.deepEqual(JSON.parse(t('[]').text),[]);
});
test('cross-format quoting and BOM',()=>{
 assert.equal(t('\ufeffa,b\nc,d','csv','tsv').text,'a\tc\nb\td');
 assert.equal(t('[["a,b"],["c"]]', 'json','csv').text,'"a,b",c');
});
test('malformed or unsupported input is rejected',()=>{
 for(const s of ['"bad','a"b,c','"ok"x,c'])assert.throws(()=>t(s,'csv'));
 for(const s of ['[1,2]','[{},[]]','[[{}]]','[{"x":1,"x":2}]'])assert.throws(()=>t(s,'json'));
 assert.throws(()=>t(''));assert.throws(()=>t('x','invalid'));assert.throws(()=>t('x','csv','invalid'));
});
test('input and rectangular expansion limits',()=>{
 assert.throws(()=>t('x'.repeat(5*1024*1024+1)),/5 MB/);
 assert.throws(()=>t('x,'.repeat(999)+'x\n'+'z\n'.repeat(101),'csv'),/100,000/);
});
test('HTML and special keys remain literal cell data',()=>{
 const r=t('[{"__proto__":"<script>alert(1)</script>","constructor":"ok"}]');
 assert.deepEqual(JSON.parse(r.text),[['__proto__','<script>alert(1)</script>'],['constructor','ok']]);
});
