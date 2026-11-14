'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const dist=path.resolve(__dirname,'../dist');
const script=fs.readFileSync(path.join(dist,'sw.js'),'utf8');
function harness(options={}){
 const scope=options.scope||'https://example.test/projects/notes/';
 const handlers=new Map(),storage=new Map();
 const state={offline:false,changedAsset:null,failAsset:null,fetches:[],claimed:0,skipped:0,windows:[{url:scope,postMessage:()=>{}}]};
 const contents=new Map();
 const network=async request=>{
   if(state.offline)throw Error('Offline');
   const url=typeof request==='string'?request:request.url;
   state.fetches.push(url);
   const relative=decodeURI(new URL(url).pathname.slice(new URL(scope).pathname.length));
   if(relative===state.failAsset)return new Response('Unavailable',{status:503});
   const bytes=state.changedAsset===relative?Buffer.from('changed on server'):fs.readFileSync(path.join(dist,relative));
   if(request.integrity&&request.integrity!=='sha256-'+createHash('sha256').update(bytes).digest('base64'))throw Error('Integrity mismatch');
   return new Response(bytes,{status:200});
 };
 const key=value=>typeof value==='string'?value:value.url;
 class Cache{
  constructor(){this.items=new Map();}
  async match(request){const response=this.items.get(key(request));return response?.clone();}
  async put(request,response){this.items.set(key(request),response.clone());}
  async addAll(requests){
   const batch=await Promise.all(requests.map(async request=>{const response=await network(request);if(!response.ok)throw Error('Uncacheable');return[key(request),response];}));
   for(const [url,response]of batch)this.items.set(url,response.clone());
  }
 }
 const caches={
  async open(name){if(!storage.has(name))storage.set(name,new Cache());return storage.get(name);},
  async keys(){return [...storage.keys()];},
  async delete(name){return storage.delete(name);}
 };
 const self={registration:{scope},addEventListener:(type,handler)=>handlers.set(type,handler),skipWaiting:async()=>{state.skipped++;},
  clients:{claim:async()=>{state.claimed++;},matchAll:async()=>state.windows}};
 const context={self,caches,Request,Response,URL,fetch:network};
 vm.runInNewContext(script+'\nself.info={VERSION,ASSETS,CACHE_NAME,PREFIX};',context);
 async function event(type,data={}){
  const waits=[];let response=null;const replies=[];
  handlers.get(type)({...data,waitUntil:promise=>waits.push(promise),respondWith:promise=>{response=promise;},ports:[{postMessage:value=>replies.push(value)}]});
  await Promise.all(waits);
  return {response:response?await response:null,replies};
 }
 const message=async(type,source=scope)=>event('message',{data:{type},source:{url:source}});
 return {scope,storage,state,caches,event,message,info:self.info};
}
test('PWA manifest installs from root and GitHub project subpaths',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(dist,'app.webmanifest'),'utf8'));
 assert.equal(manifest.display,'standalone');
 for(const base of ['https://example.test/','https://example.test/note-studio-pro/']){
  assert.equal(new URL(manifest.scope,base).href,base);
  assert.equal(new URL(manifest.start_url,base).href,base);
  assert.equal(new URL(manifest.id,base).href,base);
 }
 assert.ok(manifest.icons.some(x=>x.sizes==='192x192'));
 assert.ok(manifest.icons.some(x=>x.sizes==='512x512'));
 assert.ok(manifest.icons.some(x=>x.purpose==='maskable'));
});
test('precache contains all public bundled files and verifies actual bytes',()=>{
 const h=harness();
 const entries=new Map(h.info.ASSETS.map(asset=>[asset.url,asset]));
 for(const [name,asset]of entries){
  const bytes=fs.readFileSync(path.join(dist,name));
  if(name==='index.html'){
   assert.equal(asset.integrity,null);
   assert.ok(bytes.toString().includes('<meta name="note-studio-build" content="'+h.info.VERSION+'">'));
  }else assert.equal(asset.integrity,'sha256-'+createHash('sha256').update(bytes).digest('base64'),name);
  assert.ok(!name.startsWith('/')&&!name.includes('..'),name);
 }
 for(const name of ['index.html','pwa.js','pwa.css','app.webmanifest','markdown-worker.js','diff-worker.js','schema-worker.js','vendor/editor.js','vendor/markdown-it.js','assets/pwa-icon-512.png'])assert.ok(entries.has(name),name);
 assert.ok(!entries.has('sw.js')&&!entries.has('.nojekyll'));
});
test('complete installation caches the whole editor and claims only after activation',async()=>{
 const h=harness();await h.event('install');
 assert.equal(h.state.skipped,0);assert.equal(h.state.claimed,0);
 assert.equal((await h.message('GET_STATUS')).replies[0].offlineReady,true);
 await h.event('activate');assert.equal(h.state.claimed,1);
});
test('navigation and background worker resources load with the network unavailable',async()=>{
 const h=harness();await h.event('install');h.state.offline=true;
 for(const name of ['','?source=installed','index.html?from=home','diff-worker.js','schema-worker.js','markdown-worker.js','vendor/markdown-it.js']){
  const request={url:new URL(name,h.scope).href,method:'GET',mode:name.includes('.js')?'same-origin':'navigate'};
  const result=await h.event('fetch',{request});assert.equal(result.response.status,200,name);
  const expected=name.includes('.js')?name:'index.html';
  assert.equal(await result.response.text(),fs.readFileSync(path.join(dist,expected),'utf8'));
 }
});
test('does not intercept document uploads, external links or unknown requests',async()=>{
 const h=harness();await h.event('install');const count=h.state.fetches.length;
 for(const request of [
  {url:h.scope+'private-document.json',method:'POST',mode:'cors'},
  {url:h.scope+'private-document.json',method:'GET',mode:'cors'},
  {url:'https://external.test/index.html',method:'GET',mode:'navigate'}
 ])assert.equal((await h.event('fetch',{request})).response,null);
 assert.equal(h.state.fetches.length,count);
});
test('failed installation preserves previous app caches',async()=>{
 const h=harness();const old=h.info.PREFIX+'old';await h.caches.open(old);h.state.failAsset='schema-worker.js';
 await assert.rejects(h.event('install'));
 assert.ok(h.storage.has(old));assert.ok(!h.storage.has(h.info.CACHE_NAME));
});
test('activation cleans old versions only within this app scope',async()=>{
 const h=harness();const previous=h.info.PREFIX+'old',foreign='note-studio-pro:https://example.test/other/:old';
 await h.caches.open(previous);await h.caches.open(foreign);await h.caches.open('user-content-other-app');
 await h.event('install');await h.event('activate');
 assert.ok(!h.storage.has(previous));assert.ok(h.storage.has(foreign));assert.ok(h.storage.has('user-content-other-app'));assert.ok(h.storage.has(h.info.CACHE_NAME));
});
test('an update waits when another workspace window is open',async()=>{
 const h=harness();h.state.windows.push({url:h.scope+'index.html'});
 assert.equal((await h.message('ACTIVATE_UPDATE')).replies[0].multipleWindows,true);
 assert.equal(h.state.skipped,0);
 h.state.windows.pop();await h.message('ACTIVATE_UPDATE');assert.equal(h.state.skipped,1);
});
test('another app scope cannot activate or rebuild this cache',async()=>{
 const h=harness();
 assert.equal((await h.message('ACTIVATE_UPDATE','https://example.test/projects/other/')).replies.length,0);
 assert.equal(h.state.skipped,0);assert.equal(h.state.fetches.length,0);
});
test('offline cache misses return an honest failure instead of an incomplete page',async()=>{
 const h=harness();h.state.offline=true;
 const result=await h.event('fetch',{request:{url:h.scope+'index.html',method:'GET',mode:'navigate'}});
 assert.equal(result.response.status,503);
});
test('cache refresh rejects changed server files and preserves the last complete version',async()=>{
 const h=harness();await h.event('install');h.state.changedAsset='app.js';
 assert.equal((await h.message('REFRESH_CACHE')).replies[0].offlineReady,false);
 h.state.offline=true;
 const response=(await h.event('fetch',{request:{url:h.scope+'app.js',method:'GET',mode:'same-origin'}})).response;
 assert.equal(await response.text(),fs.readFileSync(path.join(dist,'app.js'),'utf8'));
 assert.equal((await h.message('GET_STATUS')).replies[0].offlineReady,true);
});
