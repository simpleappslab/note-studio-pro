/* Offline Markdown rendering. Source HTML stays escaped; external images are links. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./vendor/markdown-it.js'),require('./vendor/markdown-task-lists.js'));
  else root.NotepadMarkdown=factory(root.markdownit,root.markdownitTaskLists);
})(typeof self==='object'?self:globalThis,function(MarkdownIt,taskLists){
  'use strict';
  const md=new MarkdownIt({html:false,linkify:true,typographer:false,maxNesting:32}).use(taskLists,{enabled:false});
  const escape=md.utils.escapeHtml;
  const openLink=md.renderer.rules.link_open||((tokens,index,options,env,renderer)=>renderer.renderToken(tokens,index,options));
  md.renderer.rules.link_open=(tokens,index,options,env,renderer)=>{
    if(!(tokens[index].attrGet('href')||'').startsWith('#')){
      tokens[index].attrSet('target','_blank');tokens[index].attrSet('rel','noopener noreferrer');
    }
    return openLink(tokens,index,options,env,renderer);
  };
  const image=md.renderer.rules.image;
  md.renderer.rules.image=(tokens,index,options,env,renderer)=>{
    const token=tokens[index],src=token.attrGet('src')||'';
    if(/^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z\d+/=\s]+$/i.test(src)){
      token.attrSet('loading','lazy');return image(tokens,index,options,env,renderer);
    }
    const alt=renderer.renderInlineAsText(token.children||[],options,env)||'Image';
    env.imagesLinked++;
    return `<a class="md-image-link" href="${escape(src)}" target="_blank" rel="noopener noreferrer">${escape(alt)} <span aria-hidden="true">↗</span></a>`;
  };
  md.renderer.rules.heading_open=(tokens,index,options,env,renderer)=>{
    const text=(tokens[index+1]?.children||[]).map(t=>t.type==='softbreak'?' ':t.content||'').join('');
    const base=text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu,'-').replace(/^-+|-+$/g,'').slice(0,100)||'section';
    let slug=base,count=2;while(env.ids.has(slug))slug=base+'-'+count++;
    env.ids.add(slug);tokens[index].attrSet('id','md-h-'+slug);env.headings++;
    return renderer.renderToken(tokens,index,options);
  };
  function render(source){
    if(typeof source!=='string')throw Error('Choose a text document to preview.');
    if(source.length>5*1024*1024||new TextEncoder().encode(source).length>5*1024*1024)throw Error('Markdown preview supports documents up to 5 MB.');
    const env={ids:new Set(),imagesLinked:0,headings:0};
    const html=md.render(source.replace(/^\uFEFF/,''),env);
    if(html.length>8*1024*1024)throw Error('This preview exceeds 8 MB. Preview a smaller document.');
    return {html,headings:env.headings,imagesLinked:env.imagesLinked};
  }
  return {render};
});
