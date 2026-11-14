(function(){
  'use strict';
  window.createNotepadMarkdownPreview=function({getFile,onVisibilityChange}){
    const $=id=>document.getElementById(id),pane=$('markdown-pane'),content=$('markdown-content');
    let worker,timer,requestId=0,fileId;
    function cancel(){clearTimeout(timer);requestId++;worker?.terminate();worker=null;}
    function message(title,detail){
      const empty=document.createElement('div');empty.className='markdown-empty';
      const heading=document.createElement('h3');heading.textContent=title;
      const text=document.createElement('p');text.textContent=detail;empty.append(heading,text);content.replaceChildren(empty);
    }
    function finish(result){
      worker?.terminate();worker=null;
      const top=content.scrollTop;content.innerHTML=result.html;content.scrollTop=top;
      content.setAttribute('aria-busy','false');
      $('markdown-status').textContent=result.imagesLinked?'External images open as links.':`${result.headings.toLocaleString()} ${result.headings===1?'heading':'headings'} · Updated live`;
    }
    function failed(text){
      worker?.terminate();worker=null;content.setAttribute('aria-busy','false');
      message('Preview unavailable',text);$('markdown-status').textContent='Edit the source to try again.';
    }
    function render(){
      if(pane.hidden)return;
      const id=++requestId,source=getFile().content;
      if(!source.trim()){
        message('Your Markdown, rendered','Write Markdown in the editor to see a live preview here.');
        content.setAttribute('aria-busy','false');$('markdown-status').textContent='Ready for Markdown';return;
      }
      const fallback=()=>{
        worker?.terminate();worker=null;
        setTimeout(()=>{if(id!==requestId||pane.hidden)return;try{finish(NotepadMarkdown.render(source));}catch(error){failed(error.message);}},0);
      };
      try{
        worker=new Worker(new URL('markdown-worker.js',document.baseURI));
        worker.onmessage=({data})=>{if(id!==requestId||data.id!==id||pane.hidden)return;if(data.error)failed(data.error);else finish(data.result);};
        worker.onerror=fallback;worker.postMessage({id,source});
      }catch{fallback();}
    }
    function update(immediate=false){
      if(pane.hidden)return;
      cancel();const file=getFile();$('markdown-file').textContent=file.name;$('markdown-file').title=file.name;
      if(fileId!==file.id){fileId=file.id;content.replaceChildren();content.scrollTop=0;}
      content.setAttribute('aria-busy','true');$('markdown-status').textContent='Updating preview…';
      if(immediate)render();else timer=setTimeout(render,180);
    }
    function close(){
      if(pane.hidden)return;cancel();pane.hidden=true;$('markdown-button').setAttribute('aria-pressed','false');onVisibilityChange();
    }
    function toggle(){
      if(!pane.hidden){close();return;}
      pane.hidden=false;$('markdown-button').setAttribute('aria-pressed','true');update(true);onVisibilityChange();
    }
    content.addEventListener('click',event=>{
      const link=event.target.closest('a');if(!link||!content.contains(link))return;
      const href=link.getAttribute('href');if(!href?.startsWith('#'))return;
      event.preventDefault();
      let id;try{id=decodeURIComponent(href.slice(1));}catch{return;}
      const target=document.getElementById('md-h-'+id)||document.getElementById(id);
      if(target&&content.contains(target))content.scrollTo({top:content.scrollTop+target.getBoundingClientRect().top-content.getBoundingClientRect().top-20,behavior:'smooth'});
    });
    return {toggle,close,update,isOpen:()=>!pane.hidden};
  };
})();
