'use strict';
importScripts('vendor/markdown-it.js','vendor/markdown-task-lists.js','markdown-core.js');
self.onmessage=({data})=>{
  try{self.postMessage({id:data.id,result:NotepadMarkdown.render(data.source)});}
  catch(error){self.postMessage({id:data.id,error:error.message});}
};
