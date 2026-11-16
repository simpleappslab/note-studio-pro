'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const app=fs.readFileSync(require('node:path').join(__dirname,'../dist/app.js'),'utf8');
const handler=app.slice(app.indexOf('  function transformJSONString('),app.indexOf('  function formatCode('));
function harness(text,{selected=false,readOnly=false}={}){
  const state={text,notices:[],writes:0,boundaries:0,focused:false};
  const ed={
    somethingSelected:()=>selected,getSelection:()=>state.text,getValue:()=>state.text,
    getDoc:()=>({changeGeneration:()=>state.boundaries++}),
    firstLine:()=>0,lastLine:()=>state.text.split('\n').length-1,
    getLine:i=>state.text.split('\n')[i],
    replaceSelection:(value,select,origin)=>{assert.equal(select,'around');assert.equal(origin,'json-string-transform');state.text=value;state.writes++;state.selectionUsed=true;},
    replaceRange:(value,from,to,origin)=>{assert.equal(from.line,0);assert.equal(to.line,ed.lastLine());assert.equal(to.ch,ed.getLine(ed.lastLine()).length);assert.equal(origin,'json-string-transform');state.text=value;state.writes++;},
    focus:()=>{state.focused=true;}
  };
  const context={MAX_FILE:5*1024*1024,canEdit:()=>!readOnly,editorForAction:()=>ed,notify:(message,error)=>state.notices.push({message,error})};
  vm.createContext(context);vm.runInContext(handler,context);
  return {state,run:decode=>context.transformJSONString(decode)};
}
test('exact round trips including formatting, escapes, Unicode and large integers',()=>{
  for(const input of ['', '{"id":900719925474099312345}', ' {\n  "name": "Note"\n}\n', 'quote " slash \\ tab\t return\r\n', 'नमस्ते 😀', '\u0000\b\f', '"already quoted"']){
    const h=harness(input);h.run(false);assert.equal(h.state.text,JSON.stringify(input));
    h.run(true);assert.equal(h.state.text,input);assert.equal(h.state.boundaries,4);
  }
});
test('destringify removes exactly one layer',()=>{
  const input=JSON.stringify(JSON.stringify('hello'));
  const h=harness(input);h.run(true);assert.equal(h.state.text,JSON.stringify('hello'));
});
test('invalid or non-string JSON never changes the document',()=>{
  for(const input of ['','hello','"bad\\q"','"unterminated','{}','[]','null','true','123']){
    const h=harness(input);h.run(true);assert.equal(h.state.text,input);assert.equal(h.state.writes,0);assert.equal(h.state.notices[0].error,true);
  }
});
test('selection uses focused editor selection replacement',()=>{
  const h=harness('{"ok":true}',{selected:true});h.run(false);
  assert.equal(h.state.selectionUsed,true);assert.equal(h.state.focused,true);assert.equal(h.state.boundaries,2);
});
test('read-only blocks both transformations',()=>{
  for(const decode of [true,false]){
    const h=harness('"hello"',{readOnly:true});h.run(decode);assert.equal(h.state.writes,0);assert.equal(h.state.boundaries,0);
  }
});
test('both actions are reachable through quick tools, menu and dispatch',()=>{
  const html=fs.readFileSync(require('node:path').join(__dirname,'../dist/index.html'),'utf8');
  for(const action of ['stringify-json','destringify-json']){
    assert.ok(html.includes('data-action="'+action+'"'));
    assert.ok(app.includes("case '"+action+"':transformJSONString("));
    assert.ok(app.includes("['"+action+"',"));
  }
  assert.ok(app.includes("'minify-json','stringify-json','destringify-json','-'"));
});
