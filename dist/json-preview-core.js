/* Lossless JSON preview: numeric tokens and duplicate keys retain their source spelling. */
(function(root){
  'use strict';
  function parse(text){
    if(text.length>5*1024*1024)throw Error('Preview supports JSON up to 5 MB.');
    JSON.parse(text); // Validate syntax; never use the converted values to render numbers.
    const tokens=text.match(/"(?:[^"\\]|\\[\s\S])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]/g);
    let index=0,count=0;
    function node(depth){
      if(depth>128)throw Error('Preview supports up to 128 nesting levels.');
      if(++count>50000)throw Error('Preview supports up to 50,000 values.');
      const token=tokens[index++];
      if(token==='{'||token==='['){
        const type=token==='{'?'object':'array',end=type==='object'?'}':']',children=[];
        while(tokens[index]!==end){
          let key=String(children.length);
          if(type==='object'){key=JSON.parse(tokens[index++]);index++;}
          children.push({key,node:node(depth+1)});
          if(tokens[index]===',')index++;
        }
        index++;
        return {type,children};
      }
      return {type:token[0]==='"'?'string':token==='null'?'null':/^(true|false)$/.test(token)?'boolean':'number',raw:token};
    }
    const tree=node(0);
    let size=0;
    const pieces=[];
    function emit(value){size+=value.length;if(size>8*1024*1024)throw Error('Formatted preview exceeds 8 MB. Reduce nesting or input size.');pieces.push(value);}
    function format(value,depth){
      if(!value.children){emit(value.raw);return;}
      const object=value.type==='object';
      emit(object?'{':'[');
      value.children.forEach((child,i)=>{
        emit((i?',':'')+'\n'+'  '.repeat(depth+1));
        if(object)emit(JSON.stringify(child.key)+': ');
        format(child.node,depth+1);
      });
      if(value.children.length)emit('\n'+'  '.repeat(depth));
      emit(object?'}':']');
    }
    format(tree,0);
    return {tree,formatted:pieces.join(''),count};
  }
  const api={parse};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.NotepadJSONPreview=api;
})(typeof self==='object'?self:globalThis);
