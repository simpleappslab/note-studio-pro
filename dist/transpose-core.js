/* Local, lossless rectangular data transpose. */
(function(root){
  'use strict';
  const json=typeof module==='object'&&module.exports?require('./json-preview-core.js'):root.NotepadJSONPreview;
  const cell=text=>({text,raw:JSON.stringify(text)});
  function delimited(text,separator){
    const rows=[];let row=[],value='',quoted=false,closed=false,started=false,count=0;
    function field(){if(++count>100000)throw Error('Use at most 100,000 cells.');row.push(cell(value));value='';closed=false;started=false;}
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(quoted){
        if(ch==='"'){if(text[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}
        else value+=ch;
      }else if(ch===separator){field();}
      else if(ch==='\r'||ch==='\n'){
        field();rows.push(row);row=[];
        if(ch==='\r'&&text[i+1]==='\n')i++;
      }else if(ch==='"'){
        if(started||closed)throw Error('Unexpected quote in an unquoted field.');
        quoted=true;started=true;
      }else{
        if(closed)throw Error('Unexpected text after a closing quote.');
        value+=ch;started=true;
      }
    }
    if(quoted)throw Error('Unclosed quoted field.');
    if(row.length||value||closed||started||!/[\r\n]$/.test(text)){field();rows.push(row);}
    return rows;
  }
  function fromJSON(text){
    const tree=json.parse(text).tree;
    if(tree.type!=='array')throw Error('JSON input must be an array of arrays or an array of objects.');
    if(!tree.children.length)return [];
    const rows=tree.children.map(x=>x.node),type=rows[0].type;
    if(!['array','object'].includes(type)||rows.some(r=>r.type!==type))throw Error('Use an array of arrays, or an array of objects with scalar cell values.');
    const scalar=node=>{
      if(node.children)throw Error('Nested arrays and objects cannot be transposed as cells.');
      return {raw:node.raw,text:node.type==='string'?JSON.parse(node.raw):node.raw};
    };
    if(type==='array')return rows.map(r=>r.children.map(c=>scalar(c.node)));
    const keys=[],seen=new Set();
    for(const row of rows){
      const local=new Set();
      for(const c of row.children){
        if(local.has(c.key))throw Error('Duplicate object keys cannot be mapped to columns.');
        local.add(c.key);if(!seen.has(c.key)){seen.add(c.key);keys.push(c.key);}
      }
    }
    // Bound rectangular expansion before allocating sparse object rows.
    if((rows.length+1)*keys.length>100000)throw Error('Use at most 100,000 cells including empty cells.');
    return [keys.map(cell),...rows.map(r=>{
      const map=new Map(r.children.map(c=>[c.key,scalar(c.node)]));
      return keys.map(k=>map.get(k)||{text:'',raw:'null'});
    })];
  }
  function detect(text){
    if(text.trimStart().startsWith('['))return 'json';
    let quoted=false;
    for(let i=0;i<text.length;i++){
      if(text[i]==='"'){if(quoted&&text[i+1]==='"')i++;else quoted=!quoted;}
      else if(!quoted&&text[i]==='\t')return 'tsv';
      else if(!quoted&&/[\r\n]/.test(text[i]))break;
    }
    return 'csv';
  }
  function transpose(text,input='auto',output='same'){
    if(text.length>5*1024*1024)throw Error('Use input up to 5 MB.');
    if(!text.length)throw Error('Paste CSV, tab-separated text, or a JSON array.');
    if(text.charCodeAt(0)===0xfeff)text=text.slice(1);
    const format=input==='auto'?detect(text):input;
    if(!['csv','tsv','json'].includes(format))throw Error('Unsupported input format.');
    const rows=format==='json'?fromJSON(text):delimited(text,format==='csv'?',':'\t');
    const width=rows.reduce((n,r)=>Math.max(n,r.length),0);
    if(width*rows.length>100000)throw Error('Use at most 100,000 cells including empty cells.');
    const ragged=rows.some(r=>r.length!==width);
    const blank=format==='json'?{text:'',raw:'null'}:cell('');
    const transposed=Array.from({length:width},(_,col)=>rows.map(row=>row[col]||blank));
    const target=output==='same'?format:output;
    if(!['csv','tsv','json'].includes(target))throw Error('Unsupported output format.');
    let result,protectedCells=0;
    if(target==='json')result='[\n'+transposed.map(row=>'  ['+row.map(c=>c.raw).join(', ')+']').join(',\n')+'\n]';
    else{
      const sep=target==='csv'?',':'\t';
      // Neutralize formula-like text before quoting; CSV quotes alone do not prevent formulas.
      for(const row of transposed)for(let i=0;i<row.length;i++){
        const c=row[i];
        if(/^[\s\u0000-\u001f\ufeff]*[=+@-]/.test(c.text)||/^[\t\r\n]/.test(c.text)){
          row[i]={...c,text:"'"+c.text};protectedCells++;
        }
      }
      const escape=s=>s===''||s.includes(sep)||/["\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
      result=transposed.map(row=>row.map(c=>escape(c.text)).join(sep)).join('\n');
    }
    if(result.length>10*1024*1024)throw Error('Output exceeds 10 MB.');
    return {text:result,format:target,inputFormat:format,protectedCells,rows:rows.length,columns:width,ragged,preview:transposed.slice(0,20).map(row=>row.slice(0,12).map(c=>c.text))};
  }
  const api={transpose};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.NotepadTranspose=api;
})(typeof self==='object'?self:globalThis);
