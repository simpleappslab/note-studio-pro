/* Infer schemas from JSON examples locally. No code or references from input are executed. */
(function(root){
  'use strict';
  const targets={
    '2020-12':{label:'JSON Schema 2020-12',uri:'https://json-schema.org/draft/2020-12/schema'},
    '2019-09':{label:'JSON Schema 2019-09',uri:'https://json-schema.org/draft/2019-09/schema'},
    'draft-07':{label:'JSON Schema Draft 07',uri:'http://json-schema.org/draft-07/schema#'},
    'draft-06':{label:'JSON Schema Draft 06',uri:'http://json-schema.org/draft-06/schema#'},
    'draft-04':{label:'JSON Schema Draft 04',uri:'http://json-schema.org/draft-04/schema#'},
    'openapi-3.2':{label:'OpenAPI 3.2',version:'3.2.1'},
    'openapi-3.1':{label:'OpenAPI 3.1',version:'3.1.2'},
    'openapi-3.0':{label:'OpenAPI 3.0',version:'3.0.4'},
    'swagger-2.0':{label:'Swagger / OpenAPI 2.0',version:'2.0'}
  };
  const map=()=>Object.create(null);
  const pointer=key=>String(key).replace(/~/g,'~0').replace(/\//g,'~1');
  function date(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
    const parsed=new Date(value+'T00:00:00Z');return Number.isFinite(parsed.valueOf())&&parsed.toISOString().slice(0,10)===value;
  }
  function stringFormat(value){
    if(date(value))return 'date';
    if(/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/i.test(value)&&date(value.slice(0,10))&&Number.isFinite(Date.parse(value)))return 'date-time';
    if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))return 'uuid';
    if(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))return 'email';
    if(/^[a-z][a-z\d+.-]*:\/\//i.test(value)&&!/[\s\u007f-\uffff<>"{}|\\^`]/.test(value)&&!/%(?![\da-f]{2})/i.test(value)){try{new URL(value);return 'uri';}catch{}}
    return null;
  }
  function toYAML(value){
    const quoted=v=>JSON.stringify(v).replace(/[\u0085\u2028\u2029]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
    const scalar=v=>v===null?'null':typeof v==='string'?quoted(v):String(v);
    const key=k=>/^[A-Za-z_$][A-Za-z\d_$.-]*$/.test(k)&&! /^(?:null|true|false|yes|no|on|off)$/i.test(k)?k:quoted(k);
    function lines(v,depth){
      const pad='  '.repeat(depth);
      if(v===null||typeof v!=='object')return [pad+scalar(v)];
      if(Array.isArray(v)){
        if(!v.length)return [pad+'[]'];
        return v.flatMap(item=>{
          if(item===null||typeof item!=='object')return [pad+'- '+scalar(item)];
          if(!Object.keys(item).length)return [pad+'- '+(Array.isArray(item)?'[]':'{}')];
          const nested=lines(item,depth+1);return [pad+'- '+nested[0].slice(pad.length+2),...nested.slice(1)];
        });
      }
      const entries=Object.entries(v);if(!entries.length)return [pad+'{}'];
      return entries.flatMap(([k,item])=>{
        if(item===null||typeof item!=='object')return [pad+key(k)+': '+scalar(item)];
        if(!Object.keys(item).length)return [pad+key(k)+': '+(Array.isArray(item)?'[]':'{}')];
        return [pad+key(k)+':',...lines(item,depth+1)];
      });
    }
    return lines(value,0).join('\n')+'\n';
  }
  function generate(raw,options={}){
    const opts={target:'2020-12',format:'json',name:'Payload',required:true,additional:true,formats:true,enums:false,examples:false,multiple:false,document:false,...options};
    const target=Object.hasOwn(targets,opts.target)?targets[opts.target]:null;if(!target)throw Error('Choose a supported schema standard.');
    if(!/^[A-Za-z_][A-Za-z\d_.-]{0,79}$/.test(opts.name))throw Error('Schema name must start with a letter or underscore and use up to 80 letters, numbers, periods, underscores or hyphens.');
    if(typeof raw!=='string'||!raw.trim())throw Error('Paste a JSON value or choose a JSON document to generate its schema.');
    if(raw.length>5*1024*1024||new TextEncoder().encode(raw).length>5*1024*1024)throw Error('Use a JSON document up to 5 MB.');
    let value;try{value=JSON.parse(raw.replace(/^\uFEFF/,''));}catch(error){throw Error('Invalid JSON: '+error.message);}
    if(opts.multiple&&!Array.isArray(value))throw Error('Multiple-sample mode needs a top-level JSON array. Turn it off to describe this value.');
    const samples=opts.multiple?value:[value],notes=[],seenNotes=new Set();let visited=0,fields=0;
    const note=text=>{if(!seenNotes.has(text)){seenNotes.add(text);if(notes.length<24)notes.push(text);}};
    function infer(values,path,depth){
      if(depth>64)throw Error('This JSON is nested more than 64 levels. Use a smaller section.');
      visited+=values.length;if(visited>200000)throw Error('This JSON contains more than 200,000 values. Use a smaller sample.');
      if(!values.length){note(path+': no examples are available, so this schema accepts any value.');return {};}
      const groups=new Map();
      for(const value of values){
        if(typeof value==='number'&&!Number.isFinite(value))throw Error(path+': a number is outside this browser’s supported numeric range.');
        const type=value===null?'null':Array.isArray(value)?'array':typeof value==='number'?(Number.isInteger(value)?'integer':'number'):typeof value;
        if(!groups.has(type))groups.set(type,[]);groups.get(type).push(value);
      }
      if(groups.has('number')&&groups.has('integer')){for(const value of groups.get('integer'))groups.get('number').push(value);groups.delete('integer');}
      const variants=[];
      for(const [type,items] of groups){
        const schema={type};
        if(type==='object'){
          const valuesByKey=new Map(),counts=new Map();
          for(const object of items)for(const key of Object.keys(object)){
            if(!valuesByKey.has(key))valuesByKey.set(key,[]);
            valuesByKey.get(key).push(object[key]);counts.set(key,(counts.get(key)||0)+1);
          }
          schema.properties=map();fields+=valuesByKey.size;
          for(const [key,values] of valuesByKey)schema.properties[key]=infer(values,path+'/'+pointer(key),depth+1);
          const required=opts.required?[...counts].filter(([,count])=>count===items.length).map(([key])=>key):[];
          if(required.length)schema.required=required;
          schema.additionalProperties=!!opts.additional;
        }else if(type==='array'){
          const entries=[];for(const array of items)for(const entry of array){if(entries.length>=200000)throw Error(path+': too many array items; use a smaller sample.');entries.push(entry);}
          schema.items=infer(entries,path+'/*',depth+1);
        }else{
          const unsafe=(type==='integer'||type==='number')&&items.some(n=>Number.isInteger(n)&&!Number.isSafeInteger(n));
          if(unsafe)note(path+': a large integer may have been rounded by JSON parsing. Numeric examples and enums were omitted.');
          if(type==='string'&&opts.formats){const format=stringFormat(items[0]);if(format&&items.every(item=>stringFormat(item)===format))schema.format=format;}
          if(opts.enums&&!unsafe){const unique=[...new Set(items)];if(unique.length<=20)schema.enum=unique;else note(path+': more than 20 observed values; enum inference was skipped.');}
          if(opts.examples&&!unsafe)schema.examples=[...new Set(items)].slice(0,3);
        }
        variants.push(schema);
      }
      return variants.length===1?variants[0]:{anyOf:variants};
    }
    const inferred=infer(samples,'$',0),legacy=opts.target==='swagger-2.0',oas30=opts.target==='openapi-3.0';
    function convert(node){
      if(node.anyOf){
        const nonNull=node.anyOf.filter(s=>s.type!=='null'),hasNull=nonNull.length!==node.anyOf.length;
        if((oas30||legacy)&&hasNull&&nonNull.length===1){
          const converted=convert(nonNull[0]);converted[legacy?'x-nullable':'nullable']=true;
          if(converted.enum)converted.enum.push(null);
          if(legacy)note('Swagger 2.0 has no native null type. x-nullable is a tool-specific extension; verify support in your API tooling.');
          return converted;
        }
        if(legacy){note('Swagger 2.0 cannot express mixed-type unions. These nodes are unconstrained; x-inferred-anyOf preserves the inferred alternatives for review.');return {'x-inferred-anyOf':node.anyOf.map(convert)};}
        return {anyOf:node.anyOf.map(convert)};
      }
      if(node.type==='null'&&(oas30||legacy)){
        if(legacy){note('Swagger 2.0 has no native null-only type. Null-only nodes are unconstrained and marked with the x-nullable extension.');return {'x-nullable':true};}
        // nullable is effective only alongside an explicit type in OpenAPI 3.0.
        note('For null-only values, OpenAPI 3.0 uses a nullable schema restricted by enum: [null]. A sample cannot identify the intended non-null type.');
        return {type:'string',nullable:true,enum:[null]};
      }
      const out={};
      for(const [key,value] of Object.entries(node)){
        if(key==='properties'){out.properties=map();for(const [name,property] of Object.entries(value))out.properties[name]=convert(property);}
        else if(key==='items')out.items=convert(value);
        else if(key==='examples'){
          if(target.version&&(oas30||legacy))out.example=value[0];
          else if(opts.target==='draft-04')note('Draft 04 has no standard examples keyword; example annotations were omitted.');
          else out.examples=value;
        }else out[key]=Array.isArray(value)?value.slice():value;
      }
      return out;
    }
    let schema=convert(inferred);schema.title=opts.name;
    if(target.uri)schema={$schema:target.uri,...schema};
    else if(!oas30&&!legacy)schema={$schema:'https://json-schema.org/draft/2020-12/schema',...schema};
    let document=schema;
    if(opts.document&&target.version){
      const definitions=map();definitions[opts.name]=schema;
      document=legacy?{swagger:'2.0',info:{title:opts.name+' API',version:'1.0.0'},paths:{},definitions}:{openapi:target.version,info:{title:opts.name+' API',version:'1.0.0'},paths:{},components:{schemas:definitions}};
      note('This document contains a reusable schema component. Add your API paths, servers and authentication details before using it as an API contract.');
    }
    if(opts.enums)note('Enums restrict values to the supplied examples. Review them before using the schema with new data.');
    const text=opts.format==='yaml'?toYAML(document):JSON.stringify(document,null,2)+'\n';
    if(text.length>8*1024*1024)throw Error('The generated schema exceeds 8 MB. Use a smaller sample or turn off example annotations.');
    const stem=opts.name.toLowerCase(),kind=opts.document&&target.version?'openapi':'schema';
    return {document,text,notes,stats:{values:visited,fields,samples:samples.length},filename:`${stem}.${kind}.${opts.format==='yaml'?'yaml':'json'}`,label:target.label};
  }
  const api={targets,generate,toYAML};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.NotepadSchema=api;
})(typeof self==='object'?self:globalThis);
