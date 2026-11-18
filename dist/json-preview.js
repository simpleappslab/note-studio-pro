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
    function renderGrid(){
      const host=$('json-preview-grid');host.replaceChildren();
      if(!data)return;
      function table(node){
        const items=node.type==='array'?node.children:[{key:'0',node}];
        const records=items.length>0&&items.every(x=>x.node.type==='object');
        const keys=records?[...new Set(items.flatMap(x=>x.node.children.map(c=>c.key)))]:['Value'];
        const columns=keys.slice(0,100);
        const note=document.createElement('p');
        note.textContent=items.length+' rows · '+keys.length+' columns. Showing up to 100 rows and 100 columns per page.';
        host.append(note);
        let page=0;
        const table=document.createElement('table');table.setAttribute('aria-label','JSON grid');
        const head=table.createTHead().insertRow();
        for(const key of ['#',...columns]){const th=document.createElement('th');th.scope='col';th.textContent=key;head.append(th);}
        const body=table.createTBody();host.append(table);
        const controls=document.createElement('div'),prev=document.createElement('button'),next=document.createElement('button'),label=document.createElement('span');
        prev.textContent='Previous';next.textContent='Next';prev.className=next.className='button';
        controls.append(prev,label,next);host.append(controls);
        function paint(){
          body.replaceChildren();
          for(const item of items.slice(page*100,(page+1)*100)){
            const tr=body.insertRow();tr.insertCell().textContent=item.key;
            for(const key of columns){
              const cell=tr.insertCell();
              const values=records?item.node.children.filter(c=>c.key===key).map(c=>c.node):[item.node];
              for(const value of values){
                if(value.children){
                  const button=document.createElement('button');button.className='button';button.textContent=value.type+' ('+value.children.length+') →';
                  button.addEventListener('click',()=>{host.replaceChildren();const back=document.createElement('button');back.className='button';back.textContent='Back to root';back.addEventListener('click',renderGrid);host.append(back);tableView(value);});cell.append(button);
                }else{const span=document.createElement('div');span.textContent=value.raw;cell.append(span);}
              }
            }
          }
          prev.disabled=page===0;next.disabled=(page+1)*100>=items.length;
          label.textContent=' Page '+(page+1)+' of '+Math.max(1,Math.ceil(items.length/100))+' ';
        }
        prev.addEventListener('click',()=>{page--;paint();});next.addEventListener('click',()=>{page++;paint();});paint();
      }
      function tableView(node){table(node);}
      tableView(data.tree);
    }
    function view(mode){
      for(const name of ['tree','code','grid']){
        $('json-preview-'+name).hidden=name!==mode;
        $('json-view-'+name).setAttribute('aria-pressed',String(name===mode));
      }
      $('json-collapse').disabled=!data||mode!=='tree';
      if(mode==='code')requestAnimationFrame(()=>editor?.refresh());
    }
    function refresh(){
      data=null;$('json-preview-grid').replaceChildren();
      $('json-preview-error').hidden=true;$('json-preview-error').textContent='';
      $('json-preview-tree').replaceChildren();editor.setValue('');
      $('json-preview-copy').disabled=true;$('json-collapse').disabled=true;
      const file=getActiveFile();$('json-preview-source').textContent=file.name+' · read-only snapshot';
      try{
        data=NotepadJSONPreview.parse(file.content);
        editor.setValue(data.formatted);renderTree();renderGrid();
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
      refresh();view('tree');
    }
    $('json-view-tree').addEventListener('click',()=>view('tree'));
    $('json-view-code').addEventListener('click',()=>view('code'));
    $('json-view-grid').addEventListener('click',()=>view('grid'));
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
