/* Read-only snapshot of the active document, with a lazy, accessible disclosure tree. */
(function(){
  'use strict';
  window.createNotepadJSONPreview=function({getActiveFile,copyText}){
    const $=id=>document.getElementById(id),dialog=$('json-preview-dialog');
    let editor=null,data=null,opener=null,rendered=0;
    const maxRendered=5000;
    function status(message){$('json-preview-status').textContent=message;}
    function row(value,key,path,root=false){
      rendered++;
      const branch=!!value.children;
      const element=document.createElement(branch?'details':'div');
      element.className='json-tree-node';
      const label=document.createElement(branch?'summary':'div');
      label.className='json-tree-label';
      const name=document.createElement('span');name.className='json-tree-key';
      name.textContent=root?'$':JSON.stringify(key);
      const info=document.createElement('span');info.className='json-tree-value json-type-'+value.type;
      info.textContent=branch?value.type+' · '+value.children.length+' '+(value.type==='array'?'items':'properties'):value.raw;
      label.append(name,document.createTextNode(': '),info);
      label.title='JSON Pointer: '+(path||'(root)');
      element.append(label);
      if(branch){
        const body=document.createElement('div');body.className='json-tree-children';element.append(body);
        let offset=0;
        const more=document.createElement('button');more.type='button';more.className='button json-tree-more';
        function load(){
          more.remove();
          const end=Math.min(offset+100,value.children.length);
          while(offset<end&&rendered<maxRendered){
            const child=value.children[offset++];
            body.append(row(child.node,child.key,path+'/'+child.key.replace(/~/g,'~0').replace(/\//g,'~1')));
          }
          if(offset<value.children.length){
            more.textContent=rendered>=maxRendered?'Display limit reached':'Show next '+Math.min(100,value.children.length-offset);
            more.disabled=rendered>=maxRendered;body.append(more);
          }
          if(rendered>=maxRendered)status('Tree display limited to 5,000 values. Collapse all to reset; Preview contains the complete JSON.');
        }
        more.addEventListener('click',load);
        element.addEventListener('toggle',()=>{if(element.open&&offset===0)load();});
        if(root){element.open=true;load();}
      }
      return element;
    }
    function renderTree(){
      rendered=0;$('json-preview-tree').replaceChildren();
      if(data)$('json-preview-tree').append(row(data.tree,'','',true));
    }
    function view(tree){
      $('json-preview-tree').hidden=!tree;$('json-preview-code').hidden=tree;
      $('json-view-tree').setAttribute('aria-pressed',String(tree));
      $('json-view-code').setAttribute('aria-pressed',String(!tree));
      $('json-collapse').disabled=!data||!tree;
      if(!tree)requestAnimationFrame(()=>editor?.refresh());
    }
    function refresh(){
      data=null;
      $('json-preview-error').hidden=true;$('json-preview-error').textContent='';
      $('json-preview-tree').replaceChildren();editor.setValue('');
      $('json-preview-copy').disabled=true;$('json-collapse').disabled=true;
      const file=getActiveFile();$('json-preview-source').textContent=file.name+' · read-only snapshot';
      try{
        data=NotepadJSONPreview.parse(file.content);
        editor.setValue(data.formatted);renderTree();
        $('json-preview-copy').disabled=false;
        $('json-collapse').disabled=$('json-preview-tree').hidden;
        status(data.count.toLocaleString()+' values · source document is unchanged');
      }catch(error){
        $('json-preview-error').textContent='Cannot preview JSON: '+error.message;
        $('json-preview-error').hidden=false;
        status('Correct the JSON in the editor, then reopen the preview.');
      }
    }
    function open(){
      opener=document.activeElement;
      if(!dialog.open)dialog.showModal();
      if(!editor)editor=CodeMirror($('json-preview-code'),{value:'',mode:{name:'javascript',json:true},readOnly:true,lineNumbers:true,lineWrapping:true,viewportMargin:10,screenReaderLabel:'Formatted JSON preview'});
      refresh();view(true);
    }
    $('json-view-tree').addEventListener('click',()=>view(true));
    $('json-view-code').addEventListener('click',()=>view(false));
    $('json-collapse').addEventListener('click',()=>{
      renderTree();const root=$('json-preview-tree').querySelector('details');if(root)root.open=false;
      if(data)status(data.count.toLocaleString()+' values · source document is unchanged');
    });
    $('json-preview-refresh').addEventListener('click',refresh);
    $('json-preview-close').addEventListener('click',()=>dialog.close());
    $('json-preview-copy').addEventListener('click',async()=>{
      if(!data)return;
      try{await copyText(data.formatted,dialog);status('Formatted JSON copied.');}
      catch{status('Clipboard unavailable. Select text in Preview and use Copy.');}
    });
    dialog.addEventListener('close',()=>{if(opener?.isConnected)opener.focus();});
    return {open};
  };
})();
