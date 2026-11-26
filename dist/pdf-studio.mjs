import * as pdfjs from './vendor/pdfjs/pdf.mjs';
pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/pdf.worker.mjs',import.meta.url).href;
const $=id=>document.getElementById(id), core=globalThis.AllNotePDFCore, lib=globalThis.PDFLib, engine=core.engine(lib);
const base=new URL('./vendor/pdfjs/',import.meta.url);
let bytes=null,viewer=null,page=1,name='document.pdf',busy=false,undo=[],redo=[],fileMode='open',imageMode='images';
const status=s=>{$('status').textContent=s;};
const value=id=>$(id).value, num=id=>Number(value(id));
const controls=[...document.querySelectorAll('[data-op],#prev,#next,#find,#zoom')];
function buttons(){for(const el of controls)el.disabled=busy||!bytes;for(const id of ['open','merge','images'])$(id).disabled=busy;document.querySelector('[data-op=undo]').disabled=busy||!undo.length;document.querySelector('[data-op=redo]').disabled=busy||!redo.length;}
async function run(fn){if(busy)return;busy=true;buttons();try{await fn();}catch(e){status(e?.message||'Operation failed.');}finally{busy=false;buttons();}}
async function fileBytes(f){if(!f||f.size>core.MAX_BYTES)throw Error('File exceeds 50 MiB.');return new Uint8Array(await f.arrayBuffer());}
function download(data,filename,type='application/pdf'){const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function stem(){return name.replace(/\.pdf$/i,'');}
async function load(data,{reset=false,filename=name}={}){
 core.validateBytes(data);const task=pdfjs.getDocument({data:data.slice(),isEvalSupported:false,enableXfa:false,useWasm:false,disableFontFace:true,cMapUrl:new URL('cmaps/',base).href,cMapPacked:true,standardFontDataUrl:new URL('standard_fonts/',base).href,maxImageSize:16000000,stopAtErrors:true});
 let next;try{next=await task.promise;if(next.numPages>core.MAX_PAGES)throw Error('Page limit exceeded.');}catch(e){await task.destroy();throw e;}
 if(viewer)await viewer.destroy();viewer=next;bytes=data;name=core.safeFilename(filename);page=reset?1:Math.min(page,viewer.numPages);if(reset){undo=[];redo=[];}
 $('range').value=String(page);await render();status(name+' · '+viewer.numPages+' pages');
}
async function renderCanvas(n,scale,canvas){const p=await viewer.getPage(n),v=p.getViewport({scale});if(v.width*v.height>16000000||v.width>8192||v.height>8192)throw Error('Page exceeds render limit; reduce zoom.');canvas.width=Math.ceil(v.width);canvas.height=Math.ceil(v.height);await p.render({canvas,canvasContext:canvas.getContext('2d'),viewport:v}).promise;return p;}
async function render(){await renderCanvas(page,num('zoom'),$('canvas'));$('canvas').hidden=false;$('empty').hidden=true;$('position').textContent=page+' / '+viewer.numPages;$('pages').replaceChildren();for(let i=1;i<=viewer.numPages;i++){const b=document.createElement('button');b.textContent='Page '+i;b.setAttribute('aria-current',String(i===page));b.addEventListener('click',()=>run(()=>go(i)));$('pages').append(b);}}
async function go(n){page=Math.min(viewer.numPages,Math.max(1,n));$('range').value=String(page);await render();}
async function change(data){const old=bytes;await load(data);undo.push(old);while(undo.length>5||undo.reduce((n,b)=>n+b.length,0)>100*1024*1024)undo.shift();redo=[];}
async function history(from,to){if(!from.length)return;const old=bytes;await load(from[from.length-1]);from.pop();to.push(old);}
async function imageEmbed(doc,f){const b=await fileBytes(f);if(f.type==='image/png')return doc.embedPng(b);if(f.type==='image/jpeg')return doc.embedJpg(b);throw Error('Use PNG or JPEG.');}
async function canvasBlob(c,type,quality){return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error('Image export failed.')),type,quality));}
async function raster(){if(viewer.numPages>100)throw Error('Raster compression supports at most 100 pages per operation.');const doc=await lib.PDFDocument.create(),c=document.createElement('canvas');for(let i=1;i<=viewer.numPages;i++){const p=await renderCanvas(i,1.25,c),v=p.getViewport({scale:1}),blob=await canvasBlob(c,'image/jpeg',num('quality')),im=await doc.embedJpg(await blob.arrayBuffer());doc.addPage([v.width,v.height]).drawImage(im,{x:0,y:0,width:v.width,height:v.height});}return doc.save();}
$('open').onclick=()=>{fileMode='open';$('files').multiple=false;$('files').click();};
$('merge').onclick=()=>{fileMode='merge';$('files').multiple=true;$('files').click();};
$('images').onclick=()=>{imageMode='images';$('image-files').multiple=true;$('image-files').click();};
$('files').onchange=()=>{const list=[...$('files').files];$('files').value='';if(!list.length)return;run(async()=>{if(bytes&&!confirm('Replace the current PDF workspace? Save changes first if needed.'))return;if(list.length>50||list.reduce((n,f)=>n+f.size,0)>core.MAX_BYTES)throw Error('Combined input exceeds limits.');const all=[];for(const f of list)all.push(await fileBytes(f));await load(fileMode==='merge'?await engine.merge(all):all[0],{reset:true,filename:fileMode==='merge'?'merged.pdf':list[0].name});});};
$('image-files').onchange=()=>{const list=[...$('image-files').files];$('image-files').value='';if(!list.length)return;run(async()=>{if(list.length>50||list.reduce((n,f)=>n+f.size,0)>core.MAX_BYTES)throw Error('Image input exceeds limits.');if(imageMode==='images'){if(bytes&&!confirm('Replace current PDF workspace?'))return;const doc=await lib.PDFDocument.create();for(const f of list){const im=await imageEmbed(doc,f),s=Math.min(1,1200/Math.max(im.width,im.height)),w=im.width*s,h=im.height*s;doc.addPage([w,h]).drawImage(im,{x:0,y:0,width:w,height:h});}await load(await doc.save(),{reset:true,filename:'images.pdf'});}else{const doc=await engine.open(bytes),p=doc.getPage(page-1),im=await imageEmbed(doc,list[0]),w=num('size')*5,h=w*im.height/im.width,x=num('x'),y=num('y');if(x<0||y<0||x+w>p.getWidth()||y+h>p.getHeight())throw Error('Image exceeds page bounds.');p.drawImage(im,{x,y,width:w,height:h});await change(await doc.save());}});};
$('prev').onclick=()=>run(()=>go(page-1));$('next').onclick=()=>run(()=>go(page+1));$('zoom').onchange=()=>run(render);
$('theme').onclick=()=>document.body.toggleAttribute('data-dark');
$('find').onclick=()=>run(async()=>{const q=value('search').trim().toLowerCase();if(!q)return;for(let i=1;i<=viewer.numPages;i++){const n=(page-1+i)%viewer.numPages+1,p=await viewer.getPage(n),t=await p.getTextContent();if(t.items.map(x=>x.str||'').join(' ').toLowerCase().includes(q)){await go(n);status('Match on page '+n);return;}}status('No matching text.');});
for(const b of document.querySelectorAll('[data-op]'))b.onclick=()=>{const op=b.dataset.op;if(op==='image'){imageMode='overlay';$('image-files').multiple=false;$('image-files').click();return;}run(async()=>{const range=value('range');switch(op){
case 'extract': await change(await engine.extract(bytes,range));break;
case 'split':{const indices=core.pageRange(range,viewer.numPages);if(indices.length>20)throw Error('Select up to 20 pages per split.');for(const i of indices)download(await engine.extract(bytes,String(i+1)),stem()+'-page-'+(i+1)+'.pdf');status('Split exports requested.');break;}
case 'rotate':await change(await engine.rotate(bytes,range,90));break;
case 'remove':await change(await engine.remove(bytes,range));break;
case 'text':await change(await engine.addText(bytes,page,value('annotation'),num('x'),num('y'),num('size')));break;
case 'watermark':{const doc=await engine.open(bytes),font=await doc.embedFont(lib.StandardFonts.Helvetica),t=value('annotation');if(!t.trim())throw Error('Enter watermark text.');for(const i of new Set(core.pageRange(range,doc.getPageCount()))){const p=doc.getPage(i);p.drawText(t,{x:num('x'),y:num('y'),size:num('size'),font,opacity:.25,rotate:lib.degrees(30),color:lib.rgb(.3,.3,.3)});}await change(await doc.save());break;}
case 'shape':{const doc=await engine.open(bytes),p=doc.getPage(page-1),x=num('x'),y=num('y'),s=num('size');if(x<0||y<0||x+s*5>p.getWidth()||y+s*2>p.getHeight())throw Error('Rectangle exceeds page bounds.');p.drawRectangle({x,y,width:s*5,height:s*2,borderWidth:2,borderColor:lib.rgb(.15,.4,.25)});await change(await doc.save());break;}
case 'png':case 'jpg':{const c=document.createElement('canvas');await renderCanvas(page,1.5,c);const type=op==='png'?'image/png':'image/jpeg';download(await canvasBlob(c,type,.9),stem()+'-'+page+'.'+op,type);break;}
case 'txt':{const chunks=[];for(let i=1;i<=viewer.numPages;i++){const p=await viewer.getPage(i),t=await p.getTextContent();chunks.push(t.items.map(x=>(x.str||'')+(x.hasEOL?'\n':' ')).join(''));}download(chunks.join('\n\n'),stem()+'.txt','text/plain');break;}
case 'compress':if(confirm('Create a raster copy? Searchable text, forms and links will be lost.')){const result=await raster();if(result.length>=bytes.length){status('Raster copy is not smaller; original retained.');return;}await change(result);}break;
case 'undo':await history(undo,redo);break;
case 'redo':await history(redo,undo);break;
case 'save':download(bytes,name);status('Download requested.');break;
}});};
buttons();
