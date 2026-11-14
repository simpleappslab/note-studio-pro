'use strict';
importScripts('schema-core.js');
self.onmessage=({data})=>{
  try{const {document,...result}=NotepadSchema.generate(data.text,data.options);self.postMessage({id:data.id,result});}
  catch(error){self.postMessage({id:data.id,error:error.message});}
};
