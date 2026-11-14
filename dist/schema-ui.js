(function(){
  'use strict';
  window.createNotepadSchemaGenerator=function({getFiles,getActiveFile,getSettings,copyText,download,openDocument}){
    const $=id=>document.getElementById(id),dialog=$('schema-dialog');
    let input,output,worker,timer,result,requestId=0,loading=false,opener;
    const example={quoteId:'Q-1001',createdAt:'2026-11-09T09:30:00Z',account:{name:'Example Company',email:'contact@example.com'},products:[{sku:'IC.CC',quantity:2,location:'DX1',attributes:{bandwidth:1000}},{sku:'IC.EIA',quantity:1,location:'DX1',notes:null}],tags:['new','priority'],active:true};
    for(const [value,target] of Object.entries(NotepadSchema.targets))$('schema-target').add(new Option(target.label,value));
    function ensure(){
      if(input)return;
      input=CodeMirror($('schema-input'),{mode:{name:'javascript',json:true},lineNumbers:true,lineWrapping:false,screenReaderLabel:'JSON input',dragDrop:false,tabSize:2,indentUnit:2,viewportMargin:10,extraKeys:{'Ctrl-Enter':generate,'Cmd-Enter':generate}});
      output=CodeMirror($('schema-output'),{mode:{name:'javascript',json:true},lineNumbers:true,lineWrapping:false,readOnly:true,screenReaderLabel:'Generated schema',dragDrop:false,viewportMargin:10});
      input.on('change',()=>{if(loading)return;$('schema-source').value='';schedule();});
    }
    function sources(){
      const select=$('schema-source'),old=select.value;
      select.replaceChildren(new Option('Custom / pasted JSON',''));
      for(const file of getFiles())select.add(new Option(file.name,file.id));
      select.value=getFiles().some(f=>f.id===old)?old:'';
    }
    function buttons(enabled){for(const id of ['schema-copy','schema-download','schema-tab'])$(id).disabled=!enabled;}
    function options(){return {target:$('schema-target').value,format:$('schema-format').value,name:$('schema-name').value.trim(),document:$('schema-scope').value==='document',required:$('schema-required').checked,additional:$('schema-additional').checked,formats:$('schema-formats').checked,enums:$('schema-enums').checked,examples:$('schema-examples').checked,multiple:$('schema-multiple').checked};}
    function syncOptions(){
      const api=!!NotepadSchema.targets[$('schema-target').value]?.version;
      $('schema-scope').disabled=!api;if(!api)$('schema-scope').value='schema';
      if(output)output.setOption('mode',$('schema-format').value==='yaml'?'yaml':{name:'javascript',json:true});
    }
    function load(text,source=''){
      loading=true;input.setValue(text.replace(/^\uFEFF/,''));input.clearHistory();loading=false;
      $('schema-source').value=source;schedule();
    }
    function schedule(){
      clearTimeout(timer);requestId++;worker?.terminate();worker=null;result=null;buttons(false);
      $('schema-status').textContent='Generating schema…';$('schema-error').hidden=true;
      timer=setTimeout(generate,350);
    }
    function failure(message){
      clearTimeout(timer);requestId++;worker?.terminate();worker=null;
      result=null;buttons(false);$('schema-error').textContent=message;$('schema-error').hidden=false;
      $('schema-status').textContent='Check the JSON input or generation options.';$('schema-notes').replaceChildren();
      output.setValue('');
    }
    function success(value){
      worker?.terminate();worker=null;
      result=value;output.setValue(value.text);output.clearHistory();buttons(true);$('schema-error').hidden=true;
      $('schema-output-title').textContent=value.label+' · '+$('schema-format').value.toUpperCase();
      $('schema-status').textContent=`${value.stats.fields.toLocaleString()} fields · ${value.stats.samples.toLocaleString()} ${value.stats.samples===1?'sample':'samples'} · ${value.text.length.toLocaleString()} output characters`;
      $('schema-notes').replaceChildren();
      for(const text of value.notes){const item=document.createElement('li');item.textContent=text;$('schema-notes').append(item);}
    }
    function generate(){
      if(!input||!dialog.open)return;
      clearTimeout(timer);worker?.terminate();worker=null;syncOptions();
      const id=++requestId,text=input.getValue(),config=options();result=null;buttons(false);
      $('schema-status').textContent='Generating schema…';$('schema-error').hidden=true;
      const fallback=()=>{
        worker?.terminate();worker=null;
        setTimeout(()=>{if(id!==requestId||!dialog.open)return;try{const {document,...value}=NotepadSchema.generate(text,config);success(value);}catch(error){failure(error.message);}},0);
      };
      try{
        worker=new Worker(new URL('schema-worker.js',document.baseURI));
        worker.onmessage=({data})=>{if(data.id!==requestId||!dialog.open)return;if(data.error)failure(data.error);else success(data.result);};
        worker.onerror=fallback;worker.postMessage({id,text,options:config});
      }catch{fallback();}
    }
    async function readFile(file){
      if(file.size>5*1024*1024){failure('Choose a JSON file up to 5 MB.');return;}
      try{load(await file.text());}catch{failure('Could not read '+file.name+'.');}
    }
    function open(){
      opener=document.activeElement;
      if(!dialog.open)dialog.showModal();
      const first=!input;ensure();sources();syncOptions();
      for(const ed of [input,output])ed.getWrapperElement().style.fontSize=getSettings().fontSize+'px';
      if(first){const file=getActiveFile();load(file.content,file.id);}
      requestAnimationFrame(()=>{input.refresh();output.refresh();generate();});
    }
    $('schema-source').addEventListener('change',event=>{const file=getFiles().find(f=>f.id===event.target.value);if(file)load(file.content,file.id);else input.focus();});
    for(const id of ['schema-target','schema-scope','schema-format','schema-required','schema-additional','schema-formats','schema-enums','schema-examples','schema-multiple'])$(id).addEventListener('change',()=>{syncOptions();schedule();});
    $('schema-name').addEventListener('input',schedule);
    $('schema-file').addEventListener('change',event=>{const file=event.target.files[0];event.target.value='';if(file)readFile(file);});
    dialog.addEventListener('click',async event=>{
      const button=event.target.closest('[data-schema]');if(!button)return;
      switch(button.dataset.schema){
        case 'close':dialog.close();break;
        case 'generate':generate();break;
        case 'file':$('schema-file').click();break;
        case 'example':load(JSON.stringify(example,null,2)+'\n');break;
        case 'active':{const file=getActiveFile();load(file.content,file.id);break;}
        case 'copy':
          if(!result)return;
          try{await copyText(result.text,dialog);$('schema-status').textContent='Complete schema copied to clipboard.';}catch{$('schema-status').textContent='Clipboard access is unavailable. Select the output and use Copy.';}
          break;
        case 'download':
          if(result){download(new Blob([result.text],{type:$('schema-format').value==='yaml'?'application/yaml;charset=utf-8':'application/json;charset=utf-8'}),result.filename);$('schema-status').textContent='Download started: '+result.filename;}
          break;
        case 'tab':
          if(result&&openDocument(result.text,result.filename,$('schema-format').value==='yaml'?'yaml':'json'))dialog.close();
          break;
      }
    });
    dialog.addEventListener('keydown',event=>{
      if(event.key==='Escape'){event.preventDefault();dialog.close();}
      else if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();generate();}
    });
    dialog.addEventListener('close',()=>{clearTimeout(timer);requestId++;worker?.terminate();worker=null;if(opener?.isConnected)opener.focus();});
    for(const type of ['dragenter','dragover','dragleave'])dialog.addEventListener(type,event=>{if(event.dataTransfer?.types.includes('Files')){event.preventDefault();event.stopPropagation();}});
    dialog.addEventListener('drop',event=>{if(event.dataTransfer?.files.length){event.preventDefault();event.stopPropagation();readFile(event.dataTransfer.files[0]);}});
    return {open};
  };
})();
