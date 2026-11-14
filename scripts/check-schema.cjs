const assert=require('node:assert/strict');
const {generate,targets,toYAML}=require('../dist/schema-core.js');
const run=(value,options={})=>generate(JSON.stringify(value),options);
const fixtures=[];
const samples=[
  {id:17,price:24.5,active:true,name:'Example',empty:{},nothing:null},
  [{id:1,name:'First',detail:{a:true}},{id:2,detail:{b:2},optional:'present'}],
  [1,2.5,'text',false,null,{id:1},[true,null]],
  {empty:[],arrays:[[1,'a'],[],[false]],values:[null,'value']},
  {date:'2024-02-29',timestamp:'2026-11-09T09:30:00Z',email:'a@example.com',url:'https://example.com/a?b=1',uuid:'123e4567-e89b-12d3-a456-426614174000'},
  {invalidDate:'2025-02-29',invalidTime:'2026-01-01T24:00:00Z',invalidURI:'https://example.com/a b'},
  JSON.parse('{"__proto__":{"polluted":true},"constructor":1,"yes":"yes","on":"on","null":"null","a/b~c":"line\\nnext"}'),
  {'unicode\u0085key':'hello\u0085world\u2028next\u2029end','quoted: key':'"quote" \\ slash\t\nनमस्ते 👋'},
  {},[],null,'hello',true,12.5
];
for(const [target,info] of Object.entries(targets))for(const value of samples){
  for(const config of [{},{enums:true,examples:true,additional:false},{required:false,formats:false}]){
    for(const document of info.version?[false,true]:[false]){
      const options={target,...config,document};
      const result=run(value,options),yaml=run(value,{...options,format:'yaml'});
      assert.deepEqual(JSON.parse(result.text),JSON.parse(JSON.stringify(result.document)));
      assert.equal(yaml.text,toYAML(result.document));
      assert.match(result.filename,/\.(schema|openapi)\.json$/);
      fixtures.push({target,options,samples:[value],document:result.document,yaml:yaml.text});
    }
  }
  if(Array.isArray(value)){
    const result=run(value,{target,multiple:true,additional:false,enums:true,examples:true});
    fixtures.push({target,options:{multiple:true},samples:value,document:result.document,yaml:toYAML(result.document)});
  }
}
const merged=run([{id:1,onlyHere:true,detail:{a:1}},{id:2,detail:{b:'b'}}],{multiple:true,additional:false}).document;
assert.deepEqual(merged.required,['id','detail']);
assert.equal(merged.additionalProperties,false);
assert.deepEqual(merged.properties.detail.required,undefined);
assert.deepEqual(Object.keys(merged.properties.detail.properties),['a','b']);
assert.equal(run([{x:1},{x:1.5}],{multiple:true}).document.properties.x.type,'number');
assert.equal(run([1,'a',null]).document.items.anyOf.length,3);
assert.equal(run({x:1},{required:false}).document.required,undefined);
assert.equal(run({email:'a@example.com'},{formats:false}).document.properties.email.format,undefined);
assert.equal(run('2026-01-01T24:00:00Z').document.format,undefined);
assert.equal(run('https://example.com/a b').document.format,undefined);
assert.equal(run('https://é.example').document.format,undefined);
assert.deepEqual(run([]).document.items,{});
assert.ok(run([]).notes.some(x=>x.includes('no examples')));
assert.equal(run([],{multiple:true}).stats.samples,0);
assert.deepEqual(run([null,'a'],{multiple:true,target:'openapi-3.0',enums:true}).document.enum,['a',null]);
assert.equal(run([null,'a'],{multiple:true,target:'openapi-3.0'}).document.nullable,true);
assert.equal(run(null,{target:'openapi-3.0'}).document.enum[0],null);
assert.ok(run([1,'a'],{multiple:true,target:'swagger-2.0'}).notes.some(x=>x.includes('unconstrained')));
assert.equal(run({id:1},{target:'draft-04',examples:true}).document.properties.id.examples,undefined);
assert.equal(run({id:1},{target:'openapi-3.0',examples:true}).document.properties.id.example,1);
const malicious=run(JSON.parse('{"__proto__":{"polluted":true},"constructor":1}')).document;
assert.ok(Object.hasOwn(malicious.properties,'__proto__'));
assert.equal({}.polluted,undefined);
assert.ok(generate('\uFEFF{"x":1}').document.properties.x);
assert.ok(generate('{"n":9007199254740993}',{enums:true,examples:true}).notes.some(x=>x.includes('rounded')));
assert.equal(generate('{"n":9007199254740993}',{enums:true}).document.properties.n.enum,undefined);
assert.throws(()=>generate(''),/Paste a JSON/);
assert.throws(()=>generate('{x:1}'),/Invalid JSON/);
assert.throws(()=>generate('{"n":1e999}'),/numeric range/);
assert.throws(()=>run({}, {multiple:true}),/top-level JSON array/);
assert.throws(()=>run({}, {name:'a/b'}),/Schema name/);
assert.throws(()=>run({}, {target:'constructor'}),/supported schema/);
assert.throws(()=>generate(' '.repeat(5*1024*1024)+'{}'),/5 MB/);
assert.throws(()=>run(Array(200000).fill(1)),/200,000 values/);
assert.throws(()=>generate('['.repeat(66)+'0'+']'.repeat(66)),/64 levels/);
const large=Array(149999).fill(1);large.push(1.5);
assert.equal(run(large).document.items.type,'number');
if(process.argv.includes('--fixtures'))process.stdout.write(JSON.stringify(fixtures));
else console.log(`Schema inference checks passed; ${fixtures.length} cross-standard fixtures generated.`);
