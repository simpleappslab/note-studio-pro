/* PDF Studio: library-independent document operations. No network or persistence. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.AllNotePDFCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const MAX_BYTES=50*1024*1024, MAX_PAGES=1000;
  function pageRange(value,count){
    if(!Number.isSafeInteger(count)||count<1||count>MAX_PAGES)throw Error('Unsupported page count.');
    if(typeof value!=='string'||!value.trim()||value.length>12000)throw Error('Enter a page range.');
    const result=[];
    for(const part of value.split(',')){
      const match=/^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
      if(!match)throw Error('Use page numbers or ranges, e.g. 1,3-5.');
      const a=Number(match[1]),b=Number(match[2]||match[1]);
      if(a<1||b<a||b>count||result.length+b-a+1>MAX_PAGES)throw Error('Page range is outside document limits.');
      for(let i=a;i<=b;i++)result.push(i-1);
    }
    return result;
  }
  function validateBytes(bytes){
    if(!(bytes instanceof Uint8Array)||bytes.length<5||bytes.length>MAX_BYTES)throw Error('PDF must be between 5 bytes and 50 MiB.');
    // PDF header must occur in the first 1024 bytes.
    const header=String.fromCharCode(...bytes.subarray(0,1024));
    if(!header.includes('%PDF-'))throw Error('File does not have a PDF header.');
    return bytes;
  }
  function safeFilename(name){
    return (String(name||'document').replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g,'_').replace(/\.pdf$/i,'').slice(0,120).trim()||'document')+'.pdf';
  }
  function engine(lib){
    if(!lib||!lib.PDFDocument)throw Error('Local PDF library is unavailable.');
    async function open(bytes){
      const doc=await lib.PDFDocument.load(validateBytes(bytes),{updateMetadata:false});
      const count=doc.getPageCount();
      if(count<1||count>MAX_PAGES)throw Error('Unsupported page count.');
      return doc;
    }
    async function exportPages(doc,indices){
      if(!Array.isArray(indices)||!indices.length||indices.length>MAX_PAGES||indices.some(i=>!Number.isInteger(i)||i<0||i>=doc.getPageCount()))throw Error('Invalid page selection.');
      const out=await lib.PDFDocument.create();
      for(const page of await out.copyPages(doc,indices))out.addPage(page);
      return out.save();
    }
    async function merge(files){
      if(!Array.isArray(files)||!files.length||files.length>50||files.reduce((n,b)=>n+b.length,0)>MAX_BYTES)throw Error('Merge input exceeds limits.');
      const out=await lib.PDFDocument.create();
      for(const bytes of files){
        const doc=await open(bytes);
        if(out.getPageCount()+doc.getPageCount()>MAX_PAGES)throw Error('Combined page limit exceeded.');
        for(const page of await out.copyPages(doc,doc.getPageIndices()))out.addPage(page);
      }
      return out.save();
    }
    async function extract(bytes,range){const doc=await open(bytes);return exportPages(doc,pageRange(range,doc.getPageCount()));}
    async function rotate(bytes,range,angle){
      if(![90,180,270].includes(angle))throw Error('Invalid rotation.');
      const doc=await open(bytes);
      for(const i of new Set(pageRange(range,doc.getPageCount()))){
        const p=doc.getPage(i);p.setRotation(lib.degrees((p.getRotation().angle+angle)%360));
      }
      return doc.save();
    }
    async function remove(bytes,range){
      const doc=await open(bytes),removed=new Set(pageRange(range,doc.getPageCount()));
      const keep=doc.getPageIndices().filter(i=>!removed.has(i));
      return exportPages(doc,keep);
    }
    async function addText(bytes,pageNumber,text,x,y,size){
      const doc=await open(bytes);
      if(!Number.isInteger(pageNumber)||pageNumber<1||pageNumber>doc.getPageCount()||typeof text!=='string'||!text.trim()||text.length>2000||![x,y,size].every(Number.isFinite)||size<6||size>144)throw Error('Invalid text annotation.');
      const p=doc.getPage(pageNumber-1), font=await doc.embedFont(lib.StandardFonts.Helvetica);
      if(x<0||y<0||x>=p.getWidth()||y>=p.getHeight())throw Error('Annotation position outside page.');
      p.drawText(text,{x,y,size,font,color:lib.rgb(0,0,0)});
      return doc.save();
    }
    return Object.freeze({open,merge,extract,rotate,remove,addText});
  }
  return Object.freeze({pageRange,validateBytes,safeFilename,engine,MAX_BYTES,MAX_PAGES});
});
