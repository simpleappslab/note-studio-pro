/* Double-click selection matching. Overlays render matches as they enter view. */
(function(){
  'use strict';
  window.createNotepadOccurrenceHighlighter=function(){
    const editors=new Set(),overlays=new Map();
    let timer;
    function clear(){
      clearTimeout(timer);
      for(const [editor,overlay] of overlays)editor.removeOverlay(overlay);
      overlays.clear();
    }
    function highlight(editor){
      clear();
      if(editor.getSelections().length!==1)return;
      const text=editor.getSelection();
      if(!text.trim()||/[\r\n]/.test(text))return;
      const documents=new Set([editor.getDoc()]);
      editor.getDoc().iterLinkedDocs(doc=>documents.add(doc));
      for(const view of editors){
        if(!documents.has(view.getDoc()))continue;
        const overlay={token(stream){
          const next=stream.string.indexOf(text,stream.pos);
          if(next===stream.pos){stream.pos+=text.length;return 'occurrence-hit';}
          stream.pos=next<0?stream.string.length:next;
          return null;
        }};
        overlays.set(view,overlay);view.addOverlay(overlay);
      }
    }
    function attach(editor){
      if(editors.has(editor))return;
      editors.add(editor);
      editor.on('dblclick',()=>{
        // Let CodeMirror finish its native word selection before reading it.
        clearTimeout(timer);timer=setTimeout(()=>highlight(editor),0);
      });
      for(const event of ['cursorActivity','change','swapDoc'])editor.on(event,clear);
      editor.on('keydown',(_,event)=>{if(event.key==='Escape')clear();});
    }
    document.addEventListener('mousedown',event=>{
      if(![...editors].some(editor=>editor.getWrapperElement().contains(event.target)))clear();
    });
    return {attach,clear};
  };
})();
