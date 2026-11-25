/* Note Studio Pro — all document processing stays in the browser. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const icon = (name, cls = '') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const escapeHTML = (value) => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid = () => globalThis.crypto?.randomUUID?.() || `doc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  // Keep the original key so existing drafts survive the brand update.
  const STORAGE_KEY = 'notepad-workspace-v1';
  const MAX_FILE = 5 * 1024 * 1024;
  const languages = {
    javascript:{label:'JavaScript',mode:'javascript',ext:'js',glyph:'JS'},
    typescript:{label:'TypeScript',mode:'text/typescript',ext:'ts',glyph:'TS'},
    json:{label:'JSON',mode:{name:'javascript',json:true},ext:'json',glyph:'{}'},
    html:{label:'HTML',mode:'htmlmixed',ext:'html',glyph:'<>'},
    css:{label:'CSS',mode:'css',ext:'css',glyph:'#'},
    xml:{label:'XML',mode:'xml',ext:'xml',glyph:'<>'},
    python:{label:'Python',mode:'python',ext:'py',glyph:'PY'},
    sql:{label:'SQL',mode:'text/x-sql',ext:'sql',glyph:'DB'},
    markdown:{label:'Markdown',mode:'markdown',ext:'md',glyph:'M↓'},
    yaml:{label:'YAML',mode:'yaml',ext:'yaml',glyph:'YML'},
    shell:{label:'Shell',mode:'shell',ext:'sh',glyph:'$_'},
    java:{label:'Java',mode:'text/x-java',ext:'java',glyph:'J'},
    cpp:{label:'C / C++',mode:'text/x-c++src',ext:'cpp',glyph:'C+'},
    csharp:{label:'C#',mode:'text/x-csharp',ext:'cs',glyph:'C#'},
    properties:{label:'Properties / INI',mode:'properties',ext:'ini',glyph:'⚙'},
    diff:{label:'Diff / Patch',mode:'diff',ext:'diff',glyph:'±'},
    text:{label:'Plain text',mode:null,ext:'txt',glyph:'TXT'}
  };
  const detectLanguage=(name,content='')=>NotepadLanguage.detect(content,name);
  const autoLanguageFor=f=>typeof f.languageAuto==='boolean'?f.languageAuto:!languages[f.language]||f.language===NotepadLanguage.fromFilename(f.name);
  const defaultSettings={theme:'light',fontSize:13,tabSize:2,indentWithTabs:false,wrap:false,lineNumbers:true,minimap:true,brackets:true,trailing:false,sidebar:true};
  let settings={...defaultSettings};
  let files=[]; let activeId; let storageFailed=false; let storageWarned=false; let restoringIssue=false;
  let saveTimer; let minimapTimer; let searchTimer; let secondary=null; let splitLinked=null; let splitSource=null; let activeEditor=null;
  const docs=new Map();
  const languageTimers=new Map();
  const search={case:false,word:false,regex:false,matches:[],index:-1,marks:[],current:null};
  let jsonPreview=null;
  const activeFile=()=>files.find(f=>f.id===activeId);
  const isDirty=f=>f.content!==f.savedContent;
  const editorForAction=()=>activeEditor===secondary && secondary && !$('secondary-pane').hidden ? secondary : cm;
  function makeFile(name,content='',extra={}) {
    const f={id:uid(),name,content:content.replace(/\r\n?/g,'\n'),savedContent:content.replace(/\r\n?/g,'\n'),language:detectLanguage(name,content),languageAuto:true,eol:content.includes('\r\n')?'CRLF':'LF',bookmarks:[],readOnly:false,...extra};
    if(f.languageAuto)f.language=detectLanguage(f.name,f.content);
    return f;
  }
  function initialFiles() {
    const welcome=makeFile('welcome.md',`# Your workspace, at your own pace.\n\nA familiar home for your text, notes, and code — right in the browser.\n\n## Make yourself at home\n\n- Open a file with Ctrl+O, or drop files anywhere.\n- Create a tab with Ctrl+N. Double-click a tab to rename it.\n- Save a file to your device with Ctrl+S.\n- Find with Ctrl+F. Replace with Ctrl+H.\n- Jump to a line with Ctrl+G.\n- Browse every command with Ctrl+K.\n\n## A few useful tools\n\n- Syntax highlighting for JavaScript, JSON, SQL, Python, and more.\n- Format and validate JSON; indent other code.\n- Sort lines, remove duplicates, and trim trailing whitespace.\n- Fold code with the arrows beside line numbers.\n- Click the narrow left gutter to bookmark a line. F2 jumps ahead.\n- Split the editor for two linked views of the same document.\n- Compare text or files with the Diff checker (Ctrl+Alt+D).\n- Toggle word wrap with Alt+Z.\n\n## Your files stay with you\n\nDrafts are restored from this browser's local storage. They are not\nuploaded, synced across devices, or written to the original file.\nUse Save to write to a selected file, or File → Export workspace for a backup.\nClearing site data or using private browsing can remove local drafts.\n\nThis is an independent browser editor inspired by Notepad++.\nIt does not run native Notepad++ plugins or executables.\n\nHappy editing.\n`);
    const playground=makeFile('playground.js',`/**\n * A fresh page. A little possibility.\n * Your browser workspace is ready when you are.\n */\n\nconst workspace = {\n  name: "My workspace",\n  theme: "a little green",\n  autosave: true,\n  madeFor: "your next idea"\n};\n\n// Start small. Make something useful.\nconst projects = [\n  { name: "A personal website", status: "exploring" },\n  { name: "My everyday tools", status: "building" },\n  { name: "The next big idea", status: "dreaming" }\n];\n\nfunction findYourFlow(projects) {\n  return projects\n    .filter(project => project.status !== "done")\n    .map(({ name, status }) => ({\n      name,\n      status,\n      readyToBegin: true\n    }));\n}\n\n// A few things to try:\n//   Ctrl + F       Find something\n//   Ctrl + H       Find and replace\n//   Alt  + Z       Toggle word wrap\n//   Ctrl + K       Find any command\n\nconst nextUp = findYourFlow(projects);\n\nfor (const project of nextUp) {\n  console.log("Let's work on: " + project.name);\n}\n\n// Your next idea starts here.\n`);
    const json=makeFile('sample.json',JSON.stringify({workspace:'My workspace',version:'1.0',preferences:{theme:'light',indentation:2,wordWrap:false},projects:[{name:'Personal website',tags:['ideas','web'],active:true},{name:'Everyday tools',tags:['productivity'],active:true}],note:'Try changing this file, then use Format JSON.'},null,2)+'\n');
    files=[welcome,playground,json];activeId=playground.id;
  }
  try {
    const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null');
    if(saved?.version===1 && Array.isArray(saved.files) && saved.files.length && saved.files.every(f=>typeof f.id==='string'&&typeof f.name==='string'&&typeof f.content==='string')) {
      const seen=new Set();
      files=saved.files.filter(f=>!seen.has(f.id)&&seen.add(f.id)).slice(0,100).map(f=>makeFile(f.name,f.content,{id:f.id,linked:f.linked===true,savedContent:typeof f.savedContent==='string'?f.savedContent:f.content,language:languages[f.language]?f.language:detectLanguage(f.name,f.content),languageAuto:autoLanguageFor(f),eol:f.eol==='CRLF'?'CRLF':'LF',bookmarks:Array.isArray(f.bookmarks)?f.bookmarks.filter(n=>Number.isInteger(n)&&n>=0):[],readOnly:!!f.readOnly}));
      activeId=files.some(f=>f.id===saved.activeId)?saved.activeId:files[0].id;
      settings={...defaultSettings,...saved.settings};
      settings.fontSize=Math.max(10,Math.min(24,Number(settings.fontSize)||13));
      settings.tabSize=[2,4,8].includes(Number(settings.tabSize))?Number(settings.tabSize):2;
      settings.theme=settings.theme==='dark'?'dark':'light';
    } else initialFiles();
  } catch {initialFiles();restoringIssue=true;}
  function docFor(f) {if(!docs.has(f.id)) docs.set(f.id,new CodeMirror.Doc(f.content,languages[f.language].mode));return docs.get(f.id);}
  const keyMap={
    'Ctrl-S':()=>dispatch('save'),'Cmd-S':()=>dispatch('save'),
    'Ctrl-O':()=>dispatch('open'),'Cmd-O':()=>dispatch('open'),
    'Ctrl-F':()=>dispatch('find'),'Cmd-F':()=>dispatch('find'),
    'Ctrl-H':()=>dispatch('replace'),'Cmd-Alt-F':()=>dispatch('replace'),
    'Ctrl-G':()=>dispatch('goto'),'Cmd-L':()=>dispatch('goto'),
    'Ctrl-K':()=>dispatch('palette'),'Cmd-K':()=>dispatch('palette'),
    'Ctrl-Shift-P':()=>dispatch('palette'),'Cmd-Shift-P':()=>dispatch('palette'),
    'Ctrl-Shift-F':()=>dispatch('format'),'Cmd-Shift-F':()=>dispatch('format'),
    'Ctrl-Alt-D':()=>dispatch('diff'),'Cmd-Alt-D':()=>dispatch('diff'),
    'Ctrl-Alt-M':()=>dispatch('markdown'),'Cmd-Alt-M':()=>dispatch('markdown'),
    'Alt-Z':()=>dispatch('wrap'),'Ctrl-D':()=>dispatch('duplicate-line'),'Cmd-D':()=>dispatch('duplicate-line'),
    'Ctrl-/':()=>dispatch('comment'),'Cmd-/':()=>dispatch('comment'),
    'Ctrl-Space':ed=>ed.showHint({hint:CodeMirror.hint.anyword,completeSingle:false}),
    'Ctrl-Shift-K':()=>dispatch('delete-line'),'Cmd-Shift-K':()=>dispatch('delete-line'),
    'Ctrl-Shift-U':()=>dispatch('uppercase'),'Ctrl-U':()=>dispatch('lowercase'),
    'F2':()=>dispatch('next-bookmark'),'Shift-F2':()=>dispatch('previous-bookmark'),
    'Ctrl-F2':()=>dispatch('bookmark'),'Cmd-F2':()=>dispatch('bookmark'),
    'F3':()=>dispatch('find-next'),'Shift-F3':()=>dispatch('find-prev'),
    'Tab':ed=>{if(ed.somethingSelected())ed.indentSelection('add');else ed.replaceSelection(settings.indentWithTabs?'\t':' '.repeat(settings.tabSize),'end','+input');},
    'Shift-Tab':ed=>ed.indentSelection('subtract'),
    'Esc':()=>{if(!$('search-panel').hidden)closeSearch();else if(document.body.classList.contains('focus-mode'))dispatch('focus');}
  };
  const baseOptions=()=>({mode:languages[activeFile().language].mode,lineNumbers:settings.lineNumbers,styleActiveLine:true,matchBrackets:true,autoCloseBrackets:settings.brackets,indentUnit:settings.tabSize,tabSize:settings.tabSize,indentWithTabs:settings.indentWithTabs,lineWrapping:settings.wrap,foldGutter:true,gutters:['bookmarks','CodeMirror-linenumbers','CodeMirror-foldgutter'],showTrailingSpace:settings.trailing,viewportMargin:15,extraKeys:keyMap,readOnly:activeFile().readOnly,placeholder:'A fresh page. Start typing…',dragDrop:false});
  const cm=CodeMirror($('editor'),{...baseOptions(),value:docFor(activeFile())});
  const occurrences=createNotepadOccurrenceHighlighter();occurrences.attach(cm);
  const markdownPreview=createNotepadMarkdownPreview({getFile:activeFile,onVisibilityChange:()=>{document.body.classList.toggle('markdown-preview-open',markdownPreview.isOpen());refreshEditors();}});
  activeEditor=cm;
  function notify(message,error=false) {
    const el=document.createElement('div');el.className='toast'+(error?' error':'');el.innerHTML=icon(error?'note':'check')+`<span>${escapeHTML(message)}</span>`;
    $('toasts').append(el);setTimeout(()=>el.remove(),error?6500:3600);
  }
  function persist() {
    clearTimeout(saveTimer);
    try {
      localStorage.setItem(STORAGE_KEY,JSON.stringify({version:1,files,activeId,settings}));storageFailed=false;
      $('draft-state').innerHTML=icon('check')+'<span>Session saved</span>';
      $('draft-state').title='Drafts saved to this browser';
    } catch {
      storageFailed=true;$('draft-state').innerHTML=icon('note')+'<span>Session not saved</span>';
      $('draft-state').title='Browser storage is unavailable or full. Save your files or export your workspace.';
      if(!storageWarned){notify('Browser storage is unavailable or full. Save your files or export your workspace.',true);storageWarned=true;}
    }
  }
  function scheduleSave(){clearTimeout(saveTimer);$('draft-state').innerHTML=icon('check')+'<span>Saving session…</span>';saveTimer=setTimeout(persist,400);}
  function renderFiles() {
    jsonPreview?.schedule();
    $('file-count').textContent=files.length;
    $('file-list').innerHTML=files.map(f=>`<div role="listitem"><button class="file-row ${f.id===activeId?'active':''}" data-file="${escapeHTML(f.id)}" title="${escapeHTML(f.name)}${isDirty(f)?' · Unsaved to device':''}">${fileType(f)}<span class="file-name">${escapeHTML(f.name)}</span>${isDirty(f)?'<span class="dirty-dot" aria-label="Unsaved changes"></span>':''}</button></div>`).join('');
    $('tabs').innerHTML=files.map(f=>`<div class="tab ${f.id===activeId?'active':''}" data-tab="${escapeHTML(f.id)}"><button class="tab-select" role="tab" aria-selected="${f.id===activeId}" aria-label="${escapeHTML(f.name)}${isDirty(f)?' (unsaved)':''}" data-file="${escapeHTML(f.id)}" tabindex="${f.id===activeId?'0':'-1'}"></button>${fileType(f)}<span class="tab-name">${escapeHTML(f.name)}</span>${isDirty(f)?'<span class="dirty-dot" title="Unsaved to device"></span>':''}<button class="tab-close" data-close="${escapeHTML(f.id)}" title="Close ${escapeHTML(f.name)}" aria-label="Close ${escapeHTML(f.name)}">${icon('close')}</button></div>`).join('');
    const f=activeFile(),lang=languages[f.language];
    $('crumb-name').textContent=f.name;$('crumb-type').textContent=lang.glyph;$('crumb-type').className=`file-type tiny ${lang.ext}`;
    $('language-status').innerHTML=escapeHTML(lang.label)+(f.languageAuto?' <span class="language-auto-label">Auto</span>':'')+icon('down');
    $('language-status').title=f.languageAuto?'Detected automatically · click to choose a language':'Manual language · click and choose Auto-detect to resume';
    $('eol-status').textContent=f.eol;
    $('readonly-label').textContent=f.readOnly?'Read only':'Editable';
    $('editor-footnote').querySelector('span:last-child').textContent=isDirty(f)?'Local draft · Changes pending on device':'Less setup. More flow.';
    document.title=`${isDirty(f)?'• ':''}${f.name} — Note Studio Pro`;
  }
  function fileType(f){const l=languages[f.language];return `<span class="file-type ${l.ext}" aria-hidden="true">${escapeHTML(l.glyph)}</span>`;}
  function updateStatus() {
    const ed=editorForAction(),pos=ed.getCursor(),text=cm.getValue(),selection=ed.getSelections().join('\n');
    $('cursor-position').textContent=`Ln ${(pos.line+1).toLocaleString()}, Col ${(pos.ch+1).toLocaleString()}`;
    $('document-stats').textContent=`${cm.lineCount().toLocaleString()} ${cm.lineCount()===1?'line':'lines'} · ${text.length.toLocaleString()} characters`;
    $('selection-stats').hidden=!selection;$('selection-stats').textContent=selection?`${selection.length.toLocaleString()} selected`:'';
    const history=cm.historySize();$('undo-button').disabled=!history.undo;$('redo-button').disabled=!history.redo;
  }
  function updateMap() {
    clearTimeout(minimapTimer);
    if(!settings.minimap)return;
    const lines=cm.getValue().split('\n'),track=$('map-track'),pre=$('map-content');
    const spacing=Math.min(5,Math.max(1,track.clientHeight/Math.max(lines.length,1)));
    pre.style.lineHeight=spacing+'px';pre.style.fontSize=Math.min(2.7,spacing*.65)+'px';pre.textContent=lines.map(l=>l.slice(0,90)).join('\n');
    updateMapViewport();
  }
  function updateMapViewport(){
    if(!settings.minimap)return;
    const s=cm.getScrollInfo(),v=cm.getViewport(),height=$('map-track').clientHeight,spacing=parseFloat($('map-content').style.lineHeight)||5;
    const contentHeight=Math.min(height,cm.lineCount()*spacing);
    const top=Math.min(Math.max(0,contentHeight-15),(v.from/Math.max(1,cm.lineCount()))*contentHeight);
    $('map-viewport').style.top=top+'px';$('map-viewport').style.height=Math.min(height-top,Math.max(15,(v.to-v.from)*spacing))+'px';
    $('map-track').setAttribute('aria-valuenow',String(Math.round(100*s.top/Math.max(1,s.height-s.clientHeight))));
  }
  function rememberBookmarks(){const marks=[];cm.eachLine(h=>{if(h.gutterMarkers?.bookmarks)marks.push(cm.getLineNumber(h));});activeFile().bookmarks=marks;}
  function applyDetectedLanguage(f){
    if(!f.languageAuto||!files.includes(f))return;
    clearTimeout(languageTimers.get(f.id));languageTimers.delete(f.id);
    const next=detectLanguage(f.name,f.content);if(next===f.language)return;
    f.language=next;
    if(f.id===activeId){cm.setOption('mode',languages[next].mode);if(splitLinked)secondary?.setOption('mode',languages[next].mode);renderFiles();}
    scheduleSave();
  }
  function scheduleLanguageDetection(f){
    clearTimeout(languageTimers.get(f.id));if(!f.languageAuto)return;
    languageTimers.set(f.id,setTimeout(()=>applyDetectedLanguage(f),300));
  }
  function onChange(){
    activeFile().content=cm.getValue();rememberBookmarks();renderFiles();updateStatus();scheduleSave();
    scheduleLanguageDetection(activeFile());markdownPreview.update();
    clearTimeout(minimapTimer);minimapTimer=setTimeout(updateMap,100);
    if(!$('search-panel').hidden){clearTimeout(searchTimer);searchTimer=setTimeout(()=>runSearch(false),100);}
  }
  cm.on('change',onChange);cm.on('cursorActivity',()=>{updateStatus();jsonPreview?.updateActions();});cm.on('scroll',updateMapViewport);cm.on('viewportChange',updateMapViewport);cm.on('focus',()=>{activeEditor=cm;});
  cm.on('gutterClick',(ed,line,gutter)=>{if(gutter==='bookmarks')toggleBookmark(line);});
  function renderBookmarks(){cm.operation(()=>{cm.eachLine(h=>{if(h.gutterMarkers?.bookmarks)cm.setGutterMarker(h,'bookmarks',null);});for(const n of activeFile().bookmarks){if(n<cm.lineCount())cm.setGutterMarker(n,'bookmarks',bookmarkMarker());}});}
  function bookmarkMarker(){const mark=document.createElement('div');mark.className='line-bookmark';mark.textContent='◆';mark.title='Bookmark · click to remove';return mark;}
  function toggleBookmark(line=editorForAction().getCursor().line){const info=cm.lineInfo(line);cm.setGutterMarker(line,'bookmarks',info.gutterMarkers?.bookmarks?null:bookmarkMarker());rememberBookmarks();scheduleSave();}
  function jumpBookmark(direction){const all=activeFile().bookmarks.slice().sort((a,b)=>a-b);if(!all.length){notify('Click the left gutter or press Ctrl+F2 to add a bookmark.');return;}const line=editorForAction().getCursor().line;const target=direction>0?(all.find(n=>n>line)??all[0]):(all.slice().reverse().find(n=>n<line)??all.at(-1));cm.setCursor(target,0);cm.scrollIntoView({line:target,ch:0},100);cm.focus();}
  function refreshEditors(){requestAnimationFrame(()=>{cm.refresh();secondary?.refresh();updateMap();});}
  function unlinkSplit(){if(splitLinked&&splitSource){splitSource.unlinkDoc(splitLinked);splitLinked=null;splitSource=null;}}
  function linkSplit(){unlinkSplit();splitSource=cm.getDoc();splitLinked=splitSource.linkedDoc({sharedHist:true});secondary.swapDoc(splitLinked);secondary.setOption('mode',languages[activeFile().language].mode);secondary.setOption('readOnly',activeFile().readOnly);}
  function switchFile(id,focus=true){
    if(!files.some(f=>f.id===id))return;
    if(id===activeId&&cm.getDoc()===docs.get(id)){if(focus)cm.focus();return;}
    clearSearchMarks();unlinkSplit();activeId=id;const f=activeFile();cm.swapDoc(docFor(f));cm.setOption('mode',languages[f.language].mode);cm.setOption('readOnly',f.readOnly);
    if(!$('secondary-pane').hidden&&secondary)linkSplit();activeEditor=cm;renderFiles();renderBookmarks();updateStatus();updateMap();if(!$('search-panel').hidden)runSearch(false);scheduleSave();refreshEditors();markdownPreview.update(true);jsonPreview?.sync();
    $('tabs').querySelector('.tab.active')?.scrollIntoView({block:'nearest',inline:'nearest'});if(focus)cm.focus();
  }
  function applySettings(){
    document.body.toggleAttribute('data-dark',settings.theme==='dark');
    document.body.classList.toggle('sidebar-hidden',!settings.sidebar);
    for(const ed of [cm,secondary].filter(Boolean)){ed.setOption('lineWrapping',settings.wrap);ed.setOption('lineNumbers',settings.lineNumbers);ed.setOption('tabSize',settings.tabSize);ed.setOption('indentUnit',settings.tabSize);ed.setOption('indentWithTabs',settings.indentWithTabs);ed.setOption('autoCloseBrackets',settings.brackets);ed.setOption('showTrailingSpace',settings.trailing);ed.getWrapperElement().style.fontSize=settings.fontSize+'px';}
    $('minimap').hidden=!settings.minimap;$('wrap-button').setAttribute('aria-pressed',String(settings.wrap));$('map-button').setAttribute('aria-pressed',String(settings.minimap));
    $('indent-status').textContent=`${settings.indentWithTabs?'Tabs':'Spaces'}: ${settings.tabSize}`;$('zoom-status').textContent=Math.round(settings.fontSize/13*100)+'%';
    refreshEditors();scheduleSave();
  }
  function workspaceHasRoom(){if(files.length<100)return true;notify('This workspace supports up to 100 files. Export a backup before closing files.',true);return false;}
  function newFile(){if(!workspaceHasRoom())return;let n=1;while(files.some(f=>f.name===`untitled-${n}.txt`))n++;const f=makeFile(`untitled-${n}.txt`);files.push(f);switchFile(f.id);}
  const fileHandles = new WeakMap();
  const savesInProgress = new WeakSet();
  let handleDatabase;
  function accessHandle(id, operation) {
    if (!handleDatabase) {
      handleDatabase = new Promise((resolve, reject) => {
        const request = indexedDB.open('note-studio-file-links', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('handles');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }).catch(error => { handleDatabase = undefined; throw error; });
    }
    return handleDatabase.then(db => new Promise((resolve, reject) => {
      const tx = db.transaction('handles', operation === undefined ? 'readonly' : 'readwrite');
      const store = tx.objectStore('handles');
      const request = operation === undefined ? store.get(id) : operation === null ? store.delete(id) : store.put(operation, id);
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error);
    }));
  }
  function linkFile(f, handle) {
    fileHandles.set(f, handle);
    f.linked = true;
    accessHandle(f.id, handle).catch(() => notify('File linked for this session. After reopening, use Save As to select it again.', true));
  }
  function forgetFile(f) {
    if (f.linked) accessHandle(f.id, null).catch(() => {});
    fileHandles.delete(f);
    f.linked = false;
  }
  async function chooseFiles() {
    if (!window.showOpenFilePicker) return $('file-input').click();
    try {
      const handles = await window.showOpenFilePicker({multiple:true});
      for (const handle of handles) await openFiles([await handle.getFile()], [handle]);
    } catch (error) {
      if (error.name !== 'AbortError') notify('Could not open the selected file.', true);
    }
  }
  async function openFiles(list, handles = []){
    let opened=0;
    for(const [index,file] of list.entries()){
      if(files.length>=100){notify('This workspace supports up to 100 files. Export a backup before closing files.',true);break;}
      if(file.size>MAX_FILE){notify(`${file.name} is larger than the 5 MB file limit.`,true);continue;}
      try{const content=await file.text();if(content.includes('\u0000')){notify(`${file.name} looks like a binary or UTF-16 file. Open UTF-8 text files here.`,true);continue;}const f=makeFile(file.name,content);if(handles[index])linkFile(f,handles[index]);files.push(f);switchFile(f.id);opened++;}catch{notify(`Could not read ${file.name}.`,true);}
    }
    if(opened)notify(`${opened} ${opened===1?'file':'files'} opened. Drafts stay in this browser.`);$('file-input').value='';
  }
  function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.style.display='none';(document.querySelector('dialog[open]')||document.body).append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  async function copyText(text,container=document.body){
    if(navigator.clipboard?.writeText)try{await navigator.clipboard.writeText(text);return;}catch{}
    // Fallback for browsers that restrict the Clipboard API. Keep focus and selection intact.
    const focused=document.activeElement,range=typeof focused?.selectionStart==='number'?[focused.selectionStart,focused.selectionEnd,focused.selectionDirection]:null;
    const selection=window.getSelection(),ranges=selection?Array.from({length:selection.rangeCount},(_,i)=>selection.getRangeAt(i).cloneRange()):[];
    const field=document.createElement('textarea');field.value=text;field.readOnly=true;field.tabIndex=-1;field.setAttribute('aria-label','Text to copy');field.style.cssText='position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    container.append(field);let copied=false;
    try{field.focus({preventScroll:true});field.select();field.setSelectionRange(0,text.length);copied=document.execCommand('copy');}
    finally{field.remove();if(focused?.isConnected){focused.focus({preventScroll:true});if(range)focused.setSelectionRange(...range);}if(selection&&ranges.length){selection.removeAllRanges();for(const r of ranges)selection.addRange(r);}}
    if(!copied)throw Error('Clipboard unavailable');
  }
  async function copyDocument(){
    const text=cm.getValue();if(!text){notify('This document is empty.');return;}
    const button=$('copy-all-button');button.disabled=true;
    try{await copyText(text);notify(`Copied all text · ${text.length.toLocaleString()} characters`);button.querySelector('use').setAttribute('href','#i-check');clearTimeout(copyDocument.timer);copyDocument.timer=setTimeout(()=>button.querySelector('use').setAttribute('href','#i-copy'),1600);}
    catch{notify('Clipboard access is unavailable. Select all text and use your browser’s Copy command.',true);}
    finally{button.disabled=false;}
  }
  async function saveFile(f = activeFile(), saveAs = false) {
    if (savesInProgress.has(f)) { notify('A save is already in progress.'); return false; }
    savesInProgress.add(f);
    const snapshot = f.content;
    const content = f.eol === 'CRLF' ? snapshot.replace(/\n/g, '\r\n') : snapshot;
    try {
      let handle = saveAs ? null : fileHandles.get(f);
      if (!saveAs && f.linked && !handle) {
        handle = await accessHandle(f.id);
        if (!handle) throw Error('Missing file link');
      }
      if (!handle && !window.showSaveFilePicker) {
        if (!saveAs) {
          notify('Draft kept here. This browser supports downloading a copy with File → Save As.', true);
          return false;
        }
        downloadBlob(new Blob([content], {type:'text/plain;charset=utf-8'}), f.name);
        notify('Download started: ' + f.name);
      } else {
        if (!handle) handle = await window.showSaveFilePicker({suggestedName:f.name});
        const writer = await handle.createWritable();
        try {
          await writer.write(content);
          await writer.close();
        } catch (error) {
          await writer.abort().catch(() => {});
          throw error;
        }
        if (files.includes(f)) {
          if (fileHandles.get(f) !== handle) linkFile(f, handle);
          f.name = handle.name;
        }
        notify('Saved ' + handle.name);
      }
      f.savedContent = snapshot;
      renderFiles();
      persist();
      return true;
    } catch (error) {
      if (error.name !== 'AbortError') notify('Save failed. Your draft is still here. Use Save As to choose the file again.', true);
      return false;
    } finally {
      savesInProgress.delete(f);
    }
  }
  function closeFileNow(id){const idx=files.findIndex(f=>f.id===id);if(idx<0)return;forgetFile(files[idx]);const active=id===activeId;if(active)unlinkSplit();files.splice(idx,1);docs.delete(id);clearTimeout(languageTimers.get(id));languageTimers.delete(id);if(!files.length){const f=makeFile('untitled-1.txt');files.push(f);}if(active)switchFile(files[Math.min(idx,files.length-1)].id);else{renderFiles();scheduleSave();}}
  function closeFile(id){const f=files.find(f=>f.id===id);if(!f)return;if(isDirty(f)){showModal('Close document',`<p><strong>${escapeHTML(f.name)}</strong> has edits that have not been saved to your device. Closing it removes its local draft.</p>`,[{text:'Cancel',action:closeModal},{text:'Discard',className:'danger',action:()=>{closeModal();closeFileNow(id);}},{text:'Save & close',className:'primary',action:async()=>{closeModal();if(await saveFile(f) && !isDirty(f))closeFileNow(id);}}]);}else closeFileNow(id);}
  function closeOthers(){const others=files.filter(f=>f.id!==activeId);if(others.some(isDirty)){showModal('Close other documents',`<p>Some other documents have edits that have not been saved to your device. Exporting a workspace backup will keep a copy of every draft.</p>`,[{text:'Cancel',action:closeModal},{text:'Export & close others',className:'primary',action:()=>{exportWorkspace();closeModal();closeOthersNow();}}]);}else closeOthersNow();}
  function closeOthersNow(){files.filter(f=>f.id!==activeId).forEach(f=>{forgetFile(f);docs.delete(f.id);clearTimeout(languageTimers.get(f.id));languageTimers.delete(f.id);});files=[activeFile()];renderFiles();persist();}
  function renameFile(id=activeId,saveAfter=false){
    const f=files.find(x=>x.id===id);
    showInputModal(saveAfter?'Save as':'Rename document','File name',f.name,(name)=>{name=name.trim();if(!name||/[\\/\u0000-\u001f]/.test(name))return 'Use a file name without slashes or control characters.';if(f.name!==name)forgetFile(f);f.name=name;if(f.languageAuto)f.language=detectLanguage(name,f.content);if(f.id===activeId){cm.setOption('mode',languages[f.language].mode);secondary?.setOption('mode',languages[f.language].mode);}renderFiles();markdownPreview.update();persist();closeModal();if(saveAfter)saveFile(f,true);else notify('Document renamed.');},saveAfter?'Save file':'Rename');
  }
  function duplicateFile(){if(!workspaceHasRoom())return;const f=activeFile(),dot=f.name.lastIndexOf('.'),base=dot>0?f.name.slice(0,dot):f.name,ext=dot>0?f.name.slice(dot):'',copy=makeFile(`${base} copy${ext}`,f.content,{language:f.language,languageAuto:f.languageAuto,eol:f.eol,savedContent:''});files.push(copy);switchFile(copy.id);notify('Document duplicated.');}
  function exportWorkspace(){downloadBlob(new Blob([JSON.stringify({app:'note-studio-pro',version:1,files,activeId,settings},null,2)],{type:'application/json'}),`note-studio-pro-${new Date().toISOString().slice(0,10)}.json`);notify('Workspace backup download started.');}
  async function importWorkspace(file){
    if(!file)return;if(file.size>20*1024*1024){notify('Workspace backups must be smaller than 20 MB.',true);return;}
    try{const data=JSON.parse(await file.text());if(!['note-studio-pro','notepad-workspace'].includes(data.app)||data.version!==1||!Array.isArray(data.files)||!data.files.length||!data.files.every(f=>typeof f.name==='string'&&typeof f.content==='string'))throw Error('Invalid backup');
      const imported=data.files.slice(0,100-files.length).map(f=>makeFile(f.name,f.content,{language:languages[f.language]?f.language:detectLanguage(f.name,f.content),languageAuto:autoLanguageFor(f),eol:f.eol==='CRLF'?'CRLF':'LF'}));if(!imported.length){notify('The workspace already has 100 files.',true);return;}
      files.push(...imported);switchFile(imported[0].id);persist();notify(`${imported.length} documents imported into this workspace.`);
    }catch{notify('This is not a valid Note Studio Pro workspace backup.',true);}finally{$('workspace-input').value='';}
  }
  function clearSearchMarks(){for(const m of search.marks)m.clear();search.marks=[];search.current?.clear();search.current=null;}
  function getSearchRegex(){let term=$('find-input').value;if(!term)return null;if(!search.regex)term=term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');if(search.word)term=`\\b(?:${term})\\b`;return new RegExp(term,'gm'+(search.case?'':'i'));}
  function runSearch(selectFirst=false){
    clearSearchMarks();search.matches=[];search.index=-1;$('search-error').hidden=true;
    let regex;try{regex=getSearchRegex();}catch(err){$('search-error').textContent='Invalid regular expression: '+err.message;$('search-error').hidden=false;$('match-count').textContent='Invalid regex';return;}
    if(!regex){$('match-count').textContent='No search';return;}
    const text=cm.getValue();let m;let capped=false;
    while((m=regex.exec(text))!==null){if(search.matches.length>=2000){capped=true;break;}search.matches.push({from:m.index,to:m.index+m[0].length,match:m});if(m[0].length===0)regex.lastIndex=m.index+1;}
    cm.operation(()=>{for(const hit of search.matches){if(hit.to>hit.from)search.marks.push(cm.markText(cm.posFromIndex(hit.from),cm.posFromIndex(hit.to),{className:'cm-search-hit'}));}});
    const pos=cm.indexFromPos(cm.getCursor());const exact=search.matches.findIndex(h=>h.from===cm.indexFromPos(cm.getCursor('from'))&&h.to===cm.indexFromPos(cm.getCursor('to')));
    search.index=exact;
    if(selectFirst&&search.matches.length){const i=search.matches.findIndex(h=>h.from>=pos);selectMatch(i<0?0:i,false);}else updateMatchCount(capped);
    if(capped){$('search-error').textContent='Showing the first 2,000 matches. Narrow your search for larger documents.';$('search-error').hidden=false;}
  }
  function updateMatchCount(capped=false){const count=search.matches.length;$('match-count').textContent=count?`${search.index>=0?search.index+1+' / ':''}${count}${capped?'+':''}`:'No results';}
  function selectMatch(index,focus=false){if(!search.matches.length){updateMatchCount();return;}search.index=(index+search.matches.length)%search.matches.length;const hit=search.matches[search.index];const from=cm.posFromIndex(hit.from),to=cm.posFromIndex(hit.to);cm.setSelection(from,to);cm.scrollIntoView({from,to},70);search.current?.clear();search.current=hit.to>hit.from?cm.markText(from,to,{className:'cm-current-hit'}):null;updateMatchCount();if(focus)cm.focus();}
  function findNext(direction=1){if($('search-panel').hidden){openSearch(false);return;}if(!search.matches.length){runSearch(false);if(!search.matches.length)return;}if(search.index<0){const pos=cm.indexFromPos(cm.getCursor()),i=search.matches.findIndex(h=>h.from>=pos);selectMatch(direction>0?(i<0?0:i):(i<0?search.matches.length-1:i-1));}else selectMatch(search.index+direction);}
  function openSearch(replace=false){$('search-panel').hidden=false;$('replace-row').hidden=!replace;const selection=editorForAction().getSelection();if(selection&&!selection.includes('\n'))$('find-input').value=selection;runSearch(false);$('find-input').focus();$('find-input').select();refreshEditors();}
  function closeSearch(){$('search-panel').hidden=true;clearSearchMarks();refreshEditors();cm.focus();}
  function expandReplacement(replacement,match,source){if(!search.regex)return replacement;return replacement.replace(/\$(\$|&|`|'|\d{1,2})/g,(token,key)=>{if(key==='$')return '$';if(key==='&')return match[0];if(key==='`')return source.slice(0,match.index);if(key==="'")return source.slice(match.index+match[0].length);const n=Number(key);return n>0&&n<match.length?(match[n]??''):token;});}
  function replaceOne(){if(!canEdit())return;runSearch(false);if(!search.matches.length)return;if(search.index<0){findNext(1);return;}const hit=search.matches[search.index],text=cm.getValue(),replacement=expandReplacement($('replace-input').value,hit.match,text);cm.replaceRange(replacement,cm.posFromIndex(hit.from),cm.posFromIndex(hit.to),'+input');runSearch(false);findNext(1);}
  function replaceAll(){if(!canEdit())return;let regex;try{regex=getSearchRegex();}catch{runSearch();return;}if(!regex)return;const original=cm.getValue();let count=0;const result=original.replace(regex,(...args)=>{count++;const named=typeof args.at(-1)==='object';const source=args[named?args.length-2:args.length-1],offset=args[named?args.length-3:args.length-2];const match=args.slice(0,named?args.length-3:args.length-2);match.index=offset;return expandReplacement($('replace-input').value,match,source);});if(count){replaceDocument(result);notify(`Replaced ${count.toLocaleString()} ${count===1?'match':'matches'}.`);}else notify('No matches to replace.');runSearch(false);}
  function canEdit(){if(activeFile().readOnly){notify('This document is read only. Turn off read-only mode in Edit to make changes.',true);return false;}return true;}
  function replaceDocument(text){if(!canEdit())return;const end={line:cm.lastLine(),ch:cm.getLine(cm.lastLine()).length};cm.replaceRange(text,{line:0,ch:0},end,'+input');}
  function editLines(transform){if(!canEdit())return;const ed=editorForAction(),from=ed.getCursor('from'),to=ed.getCursor('to'),selected=ed.somethingSelected(),last=selected&&to.ch===0&&to.line>from.line?to.line-1:to.line;const start=selected?{line:from.line,ch:0}:{line:0,ch:0},end=selected?{line:last,ch:ed.getLine(last).length}:{line:ed.lastLine(),ch:ed.getLine(ed.lastLine()).length};const value=ed.getRange(start,end),changed=transform(value);if(changed!==value)ed.replaceRange(changed,start,end,'+input');ed.focus();}
  function transformCase(upper){if(!canEdit())return;const ed=editorForAction();if(ed.somethingSelected())ed.replaceSelection(upper?ed.getSelection().toUpperCase():ed.getSelection().toLowerCase(),'around','+input');else editLines(t=>upper?t.toUpperCase():t.toLowerCase());}
  function duplicateLine(){if(!canEdit())return;const ed=editorForAction();if(ed.somethingSelected()){const selected=ed.getSelection(),end=ed.getCursor('to');ed.replaceRange(selected,end,end,'+input');}else{const pos=ed.getCursor(),line=ed.getLine(pos.line);ed.replaceRange('\n'+line,{line:pos.line,ch:line.length},null,'+input');ed.setCursor(pos.line+1,pos.ch);}}
  function formatJSON(){if(!canEdit())return;try{const formatted=JSON.stringify(JSON.parse(cm.getValue()),null,settings.indentWithTabs?'\t':settings.tabSize);replaceDocument(formatted+'\n');notify('JSON is valid and formatted.');}catch(err){notify('JSON could not be formatted: '+err.message,true);}}
  function transformJSONString(destringify=false){
    if(!canEdit())return;
    const ed=editorForAction(),selected=ed.somethingSelected();
    const source=selected?ed.getSelection():ed.getValue();
    try{
      if(source.length>MAX_FILE)throw new Error('Use up to 5 MB of text for this action.');
      const result=destringify?JSON.parse(source):JSON.stringify(source);
      if(typeof result!=='string')throw new Error('Expected a quoted JSON string. Use Stringify JSON first to encode text.');
      ed.getDoc().changeGeneration(true);
      if(selected)ed.replaceSelection(result,'around','json-string-transform');
      else ed.replaceRange(result,{line:ed.firstLine(),ch:0},{line:ed.lastLine(),ch:ed.getLine(ed.lastLine()).length},'json-string-transform');
      ed.getDoc().changeGeneration(true);
      ed.focus();
      notify(destringify?'JSON string decoded (one layer).':'Text encoded as a JSON string.');
    }catch(err){notify('JSON could not be '+(destringify?'destringified':'stringified')+': '+err.message,true);}
  }
  function formatCode(){if(!canEdit())return;applyDetectedLanguage(activeFile());if(activeFile().language==='json'){formatJSON();return;}const ed=editorForAction();if(ed.somethingSelected())ed.indentSelection('smart');else ed.operation(()=>{for(let n=ed.firstLine();n<=ed.lastLine();n++)ed.indentLine(n,'smart');});notify('Code indentation updated.');}
  function gotoLine(){showInputModal('Go to line',`Line number (1–${cm.lineCount().toLocaleString()})`,String(editorForAction().getCursor().line+1),(value)=>{if(!/^\d+(?::\d+)?$/.test(value.trim()))return 'Enter a line number, or line:column.';const [line,col=1]=value.split(':').map(Number);if(line<1||line>cm.lineCount())return `Enter a line between 1 and ${cm.lineCount()}.`;closeModal();const ed=editorForAction();ed.setCursor(line-1,Math.max(0,col-1));ed.scrollIntoView({line:line-1,ch:col-1},100);ed.focus();},'Go to line');}
  function toggleMarkdown(){if(!markdownPreview.isOpen()&&!$('secondary-pane').hidden)toggleSplit();markdownPreview.toggle();if(!markdownPreview.isOpen())cm.focus();}
  function toggleSplit(){const pane=$('secondary-pane'),open=pane.hidden;if(open)markdownPreview.close();pane.hidden=!open;$('split-button').setAttribute('aria-pressed',String(open));if(open){if(!secondary){secondary=CodeMirror($('secondary-editor'),baseOptions());occurrences.attach(secondary);secondary.on('change',onChange);secondary.on('cursorActivity',updateStatus);secondary.on('focus',()=>{activeEditor=secondary;});secondary.on('gutterClick',(ed,line,gutter)=>{if(gutter==='bookmarks')toggleBookmark(line);});}linkSplit();applySettings();}else{unlinkSplit();activeEditor=cm;}refreshEditors();}
  function showModal(title,body,actions=[],wide=false){closeDropdown();const modal=$('modal');modal.classList.toggle('palette-modal',wide);$('modal-content').innerHTML=`<div class="modal-head"><h2>${escapeHTML(title)}</h2><button class="icon-btn small" data-modal-close title="Close dialog" aria-label="Close dialog">${icon('close')}</button></div><div class="modal-body">${body}</div>${actions.length?'<div class="modal-actions"></div>':''}`;for(const a of actions){const b=document.createElement('button');b.className='button '+(a.className||'');b.textContent=a.text;b.addEventListener('click',a.action);$('modal-content').querySelector('.modal-actions').append(b);}$('modal-content').querySelector('[data-modal-close]').onclick=closeModal;if(!modal.open)modal.showModal();}
  function closeModal(){if($('modal').open)$('modal').close();setTimeout(()=>cm.focus(),0);}
  const diffChecker=createNotepadDiffChecker({getFiles:()=>files,getActiveFile:activeFile,getSettings:()=>settings,getMode:language=>languages[language]?.mode||null,detectLanguage:(text,name)=>detectLanguage(name,text),languageLabel:language=>languages[language]?.label||'Plain text',notify,download:downloadBlob,copyText});
  const dataTranspose=createNotepadTranspose({getText:()=>{const ed=editorForAction();return ed.somethingSelected()?ed.getSelection():ed.getValue();},copyText,openDocument:(text,name,language)=>{if(!workspaceHasRoom())return false;const file=makeFile(name,text,{language,languageAuto:false,savedContent:''});files.push(file);switchFile(file.id);return true;}});
  jsonPreview=createNotepadJSONPreview({getActiveFile:activeFile,copyText,onEditor:refreshEditors,selectionText:()=>{const ed=editorForAction();return ed.somethingSelected()?ed.getSelection():activeFile().content;}});
  const schemaGenerator=createNotepadSchemaGenerator({getFiles:()=>files,getActiveFile:activeFile,getSettings:()=>settings,copyText,download:downloadBlob,openDocument:(text,name,language)=>{if(!workspaceHasRoom())return false;const file=makeFile(name,text,{language,languageAuto:false,savedContent:''});files.push(file);switchFile(file.id);return true;}});
  function showInputModal(title,label,value,submit,button='Confirm'){showModal(title,`<label for="modal-input">${escapeHTML(label)}</label><input id="modal-input" type="text" value="${escapeHTML(value)}" autocomplete="off" spellcheck="false"><div class="form-error" id="modal-error" role="status"></div>`,[{text:'Cancel',action:closeModal},{text:button,className:'primary',action:()=>{const error=submit($('modal-input').value);if(error)$('modal-error').textContent=error;}}]);const input=$('modal-input');input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();const error=submit(input.value);if(error)$('modal-error').textContent=error;}});requestAnimationFrame(()=>{input.focus();input.select();});}
  function maskOptions() {
    const value = settings.masking || {};
    return {
      disabled: Array.isArray(value.disabled) ? value.disabled : [],
      fields: Array.isArray(value.fields) ? value.fields.filter(key => typeof key === 'string' && NoteMask.validField(key)) : [],
      learn: value.learn === true
    };
  }
  function maskingSettings(done = closeModal) {
    const options = maskOptions();
    const rows = Object.entries(NoteMask.categories).map(([key,label]) =>
      `<label class="setting-row">${label}<input class="switch" type="checkbox" id="pi-${key}" ${options.disabled.includes(key) ? '' : 'checked'}></label>`).join('');
    showModal('PI masking settings', `<fieldset class="pi-types"><legend>Data to mask</legend>${rows}</fieldset>` + `
      <label class="setting-row">Suggest fields to remember<input class="switch" type="checkbox" id="pi-learn" ${options.learn ? 'checked' : ''}></label>
      <label for="pi-fields">Custom fields · one per line</label>
      <textarea id="pi-fields" rows="4" spellcheck="false" placeholder="customerAlias"></textarea>
      <p>Approved field names apply to future scans on this browser. Remove a name to forget it.</p>
      <p id="pi-error" role="status"></p>`, [
      {text:'Cancel', action:done},
      {text:'Save settings', className:'primary', action:() => {
        const fields = [...new Set($('pi-fields').value.split(/[\s,]+/).filter(Boolean))];
        if (fields.length > 256 || !fields.every(NoteMask.validField)) {
          $('pi-error').textContent = 'Use up to 256 field names of 1–64 letters, digits, dots, underscores or hyphens, starting with a letter or underscore.';
          return;
        }
        settings.masking = {fields, disabled:Object.keys(NoteMask.categories).filter(key => !$('pi-'+key).checked), learn:$('pi-learn').checked};
        persist();
        done();
      }}
    ]);
    $('pi-fields').value = options.fields.join('\n');
  }
  function reviewMask() {
    const editor = editorForAction();
    const selection = editor.somethingSelected();
    const original = selection ? editor.getSelection() : editor.getValue();
    if (!original) { notify('Select or enter a log to mask.'); return; }
    function review() {
      const options = maskOptions();
      let result;
      try { result = NoteMask.scan(original, options); }
      catch { notify('Unable to scan this payload. Try a smaller section.', true); return; }
      showModal('Mask for AI', `<div class="pi-summary"><span class="pi-mark">${icon('shield')}</span><div><strong>${result.total ? result.total + (result.total === 1 ? ' match masked' : ' matches masked') : 'No matches detected'}</strong><small>${selection ? 'Selected text' : 'Whole document'} · ${escapeHTML(activeFile().name)}</small></div></div>
        <label for="pi-output">Review and edit</label><textarea id="pi-output" rows="10" spellcheck="false" autocomplete="off"></textarea>
        <p class="pi-help">Check for missed details before copying. Edits here affect only the copy.</p><div id="pi-suggestions"></div><p id="pi-status" role="status"></p>`, [
        {text:'Masking settings', action:() => maskingSettings(review)},
        {text:'Copy reviewed text', className:'primary', action:async () => {
          try { await copyText($('pi-output').value, $('modal')); closeModal(); notify('Reviewed text copied.'); }
          catch { $('pi-status').textContent = 'Clipboard unavailable. Select and copy the reviewed preview manually.'; }
        }}
      ], true);
      $('pi-output').value = result.text;
      for (const field of result.suggestions) {
        const button = document.createElement('button');
        button.className = 'button';
        button.textContent = 'Always mask ' + field;
        button.onclick = () => {
          if (options.fields.length >= 256) { $('pi-status').textContent = 'Remove a saved field in masking settings first.'; return; }
          options.fields.push(field);
          settings.masking = options;
          persist();
          review();
        };
        $('pi-suggestions').append(button);
      }
    }
    review();
  }
  function showSettings(){
    showModal('Editor settings',`<button class="button" id="pi-settings">PI masking settings</button>
      <div class="setting-row"><div><strong>Appearance</strong><span>Workspace color theme</span></div><select id="setting-theme" aria-label="Appearance"><option value="light">Light</option><option value="dark">Dark</option></select></div>
      <div class="setting-row"><div><strong>Font size</strong><span>Editor text, in pixels</span></div><input type="number" id="setting-font" min="10" max="24" aria-label="Font size"></div>
      <div class="setting-row"><div><strong>Indent size</strong><span>Spaces per indentation level</span></div><select id="setting-indent" aria-label="Indent size"><option value="2">2 spaces</option><option value="4">4 spaces</option><option value="8">8 spaces</option></select></div>
      ${[['tabs','Use tab characters','Indent with tabs instead of spaces',settings.indentWithTabs],['wrap','Word wrap','Keep long lines in view',settings.wrap],['numbers','Line numbers','A little help finding your place',settings.lineNumbers],['map','Document map','See the shape of your file',settings.minimap],['brackets','Auto-close brackets','A matching pair, every time',settings.brackets],['trailing','Show trailing spaces','Highlight whitespace at line endings',settings.trailing]].map(([key,title,desc,checked])=>`<div class="setting-row"><div><strong>${title}</strong><span>${desc}</span></div><input class="switch" type="checkbox" id="setting-${key}" aria-label="${title}" ${checked?'checked':''}></div>`).join('')}`,[{text:'Done',className:'primary',action:closeModal}]);
    $('pi-settings').onclick=()=>maskingSettings(showSettings);
    $('setting-theme').value=settings.theme;$('setting-font').value=settings.fontSize;$('setting-indent').value=settings.tabSize;
    const changes={'theme':['theme',e=>e.target.value],'font':['fontSize',e=>Math.max(10,Math.min(24,Number(e.target.value)||13))],'indent':['tabSize',e=>Number(e.target.value)],'tabs':['indentWithTabs',e=>e.target.checked],'wrap':['wrap',e=>e.target.checked],'numbers':['lineNumbers',e=>e.target.checked],'map':['minimap',e=>e.target.checked],'brackets':['brackets',e=>e.target.checked],'trailing':['trailing',e=>e.target.checked]};
    for(const [id,[key,read]] of Object.entries(changes))$('setting-'+id).onchange=e=>{settings[key]=read(e);applySettings();};
  }
  const shortcutRows=[['New document','Ctrl N'],['Open files','Ctrl O'],['Save to device','Ctrl S'],['Save as','Ctrl Shift S'],['Find / Replace','Ctrl F / Ctrl H'],['Diff checker','Ctrl Alt D'],['Markdown preview','Ctrl Alt M'],['Next / previous match','F3 / Shift F3'],['Go to line','Ctrl G'],['Command palette','Ctrl K'],['Format / indent','Ctrl Shift F'],['Toggle word wrap','Alt Z'],['Duplicate line / selection','Ctrl D'],['Delete line','Ctrl Shift K'],['Toggle comment','Ctrl /'],['Word completion','Ctrl Space'],['Bookmark line','Ctrl F2'],['Next / previous bookmark','F2 / Shift F2'],['Undo / Redo','Ctrl Z / Ctrl Shift Z'],['Next / previous document','Ctrl Alt → / ←'],['Exit focus mode','Esc']];
  function showShortcuts(){showModal('A few shortcuts to your flow',`<table class="shortcuts-table">${shortcutRows.map(([label,key])=>`<tr><td>${label}</td><td><kbd>${key}</kbd></td></tr>`).join('')}</table><p class="shortcut-note">On Mac, ⌘ replaces Ctrl for common shortcuts. Some browser or system shortcuts may take priority. Every action is also available in the menus.</p>`,[{text:'Got it',className:'primary',action:closeModal}]);}
  function showAbout(){showModal('About Note Studio Pro',`<div class="about-brand"><img class="about-brand-logo" src="assets/note-studio-pro-logo.png" alt="Note Studio Pro logo"><div class="about-brand-caption"><strong>Note Studio Pro</strong><span class="about-version">VERSION 1.9.0</span></div></div><p>A little space for your notes, code, and next idea. A familiar editing experience, with no installation.</p><div class="about-detail"><strong>Private by design</strong><br>Document contents are processed and stored in this browser. Save updates the selected file in supported browsers. Save As lets you choose a destination. Workspace backups let you move drafts between browsers.</div><div class="about-detail">An independent editor inspired by Notepad++. Native plugins, executable macros, and filesystem-wide search are outside this browser version.<br>Powered by <a href="https://codemirror.net/5/" target="_blank" rel="noopener">CodeMirror 5</a> · <a href="vendor/LICENSE-CodeMirror.txt" target="_blank" rel="noopener">MIT license</a>.</div>`,[{text:'Back to editing',className:'primary',action:closeModal}]);}
  const commands=[
    ['new','New document','Ctrl N','plus'],['open','Open files…','Ctrl O','open'],['save','Save file to device','Ctrl S','save'],['save-as','Save file as…','Ctrl Shift S','save'],['rename','Rename document…','','note'],['duplicate-file','Duplicate document','','note'],['close','Close document','','close'],['close-others','Close other documents','','close'],
    ['undo','Undo','Ctrl Z','undo'],['redo','Redo','Ctrl Shift Z','redo'],['select-all','Select all','Ctrl A','note'],['mask-ai','Mask for AI','','shield'],['copy-all','Copy all text to clipboard','','copy'],['duplicate-line','Duplicate line / selection','Ctrl D','note'],['delete-line','Delete current line','Ctrl Shift K','note'],['comment','Toggle comment','Ctrl /','code'],['uppercase','Convert to UPPERCASE','Ctrl Shift U','code'],['lowercase','Convert to lowercase','Ctrl U','code'],['read-only','Toggle read-only mode','','shield'],
    ['find','Find in document','Ctrl F','search'],['replace','Find and replace','Ctrl H','replace'],['diff','Diff checker · compare text & files','Ctrl Alt D','diff'],['find-next','Find next','F3','down'],['find-prev','Find previous','Shift F3','up'],['goto','Go to line…','Ctrl G','right'],['bookmark','Toggle line bookmark','Ctrl F2','bookmark'],['next-bookmark','Next bookmark','F2','bookmark'],['previous-bookmark','Previous bookmark','Shift F2','bookmark'],
    ['wrap','Toggle word wrap','Alt Z','wrap'],['sidebar','Toggle explorer','','folder'],['minimap','Toggle document map','','map'],['split','Toggle split editor','','split'],['markdown','Markdown preview','Ctrl Alt M','preview'],['fold-all','Fold all code','','code'],['unfold-all','Unfold all code','','code'],['line-numbers','Toggle line numbers','','note'],['focus','Toggle focus mode','','expand'],['theme','Toggle light / dark theme','','sun'],['zoom-in','Increase font size','','plus'],['zoom-out','Decrease font size','','note'],['zoom-reset','Reset font size','','note'],
    ['auto-language','Auto-detect document language','','code'],['language','Set document language…','','code'],['format','Format / indent code','Ctrl Shift F','code'],['format-json','Format & validate JSON','','code'],['minify-json','Minify JSON','','code'],['stringify-json','Stringify JSON (escape text)','','code'],['destringify-json','Destringify JSON (unescape string)','','code'],['transpose','Data transpose (rows ↔ columns)','','code'],['json-preview','JSON preview & tree','','code'],['schema','Generate JSON Schema / OpenAPI from JSON','','code'],['sort','Sort lines A → Z','','sort'],['sort-desc','Sort lines Z → A','','sort'],['dedupe','Remove duplicate lines','','note'],['trim','Trim trailing spaces','','code'],['remove-empty','Remove empty lines','','note'],['eol','Toggle LF / CRLF line endings','','replace'],['export','Export workspace backup','','save'],['import','Import workspace backup…','','open'],['settings','Editor settings…','','settings'],['shortcuts','Keyboard shortcuts','','keyboard'],['about','About Note Studio Pro','','note']
  ];
  const commandById=id=>commands.find(c=>c[0]===id);
  function showPalette(){
    closeDropdown();const modal=$('modal');modal.classList.add('palette-modal');$('modal-content').innerHTML=`<div class="palette-search">${icon('search')}<input id="palette-input" placeholder="What would you like to do?" autocomplete="off" aria-label="Search commands"><kbd>Esc</kbd></div><div class="palette-results" id="palette-results" role="listbox" aria-label="Commands"></div><div class="palette-caption">↑ ↓ to navigate &nbsp; · &nbsp; Enter to run a command</div>`;
    let results=commands,index=0;const render=()=>{$('palette-results').innerHTML=results.length?results.map(([id,label,key],i)=>`<button data-command="${id}" class="${i===index?'selected':''}" role="option" aria-selected="${i===index}"><span>${escapeHTML(label)}</span>${key?`<kbd>${key}</kbd>`:''}</button>`).join(''):'<div class="empty-results">No matching commands. Try “format” or “wrap”.</div>';};render();
    $('palette-input').oninput=e=>{results=commands.filter(c=>c[1].toLowerCase().includes(e.target.value.toLowerCase()));index=0;render();};
    $('palette-input').onkeydown=e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();index=(index+(e.key==='ArrowDown'?1:-1)+results.length)%Math.max(1,results.length);render();$('palette-results').querySelector('.selected')?.scrollIntoView({block:'nearest'});}else if(e.key==='Enter'&&results[index]){e.preventDefault();const id=results[index][0];modal.close();dispatch(id);}};
    $('palette-results').onclick=e=>{const item=e.target.closest('[data-command]');if(item){modal.close();dispatch(item.dataset.command);}};if(!modal.open)modal.showModal();requestAnimationFrame(()=>$('palette-input').focus());
  }
  const menuMap={File:['new','open','save','save-as','-', 'rename','duplicate-file','close','close-others','-','export','import'],Edit:['undo','redo','-','select-all','copy-all','duplicate-line','delete-line','comment','-','uppercase','lowercase','read-only'],Search:['find','replace','find-next','find-prev','-','goto','bookmark','next-bookmark','previous-bookmark'],View:['wrap','line-numbers','minimap','sidebar','split','markdown','focus','-','fold-all','unfold-all','-','theme','zoom-in','zoom-out','zoom-reset'],Language:['auto-language','-',...Object.keys(languages).map(k=>'lang:'+k)],Tools:['mask-ai','diff','transpose','json-preview','schema','-','format','format-json','minify-json','stringify-json','destringify-json','-','sort','sort-desc','dedupe','trim','remove-empty','-','settings'],Help:['shortcuts','about']};
  $('menus').innerHTML=Object.keys(menuMap).map(name=>`<button class="menu-button" data-menu="${name}" aria-haspopup="menu" aria-expanded="false">${name}</button>`).join('');
  function actionChecked(id){return ({wrap:settings.wrap,'line-numbers':settings.lineNumbers,minimap:settings.minimap,sidebar:settings.sidebar,split:!$('secondary-pane').hidden,markdown:markdownPreview.isOpen(),focus:document.body.classList.contains('focus-mode'),theme:settings.theme==='dark','read-only':activeFile().readOnly})[id];}
  function closeDropdown(){const d=$('dropdown');d.hidden=true;d.innerHTML='';document.querySelectorAll('[data-menu]').forEach(b=>{b.classList.remove('active');b.setAttribute('aria-expanded','false');});}
  function showDropdown(items,anchor,point){
    const d=$('dropdown');d.innerHTML=items.map(item=>{if(item==='-')return '<div class="menu-separator" role="separator"></div>';if(item==='auto-language'){const checked=activeFile().languageAuto;return `<button role="menuitemradio" aria-checked="${checked}" data-dropdown="auto-language" class="${checked?'checked':''}">${icon(checked?'check':'code')}<span>Auto-detect language</span></button>`;}if(item.startsWith('lang:')){const key=item.slice(5),l=languages[key],checked=!activeFile().languageAuto&&activeFile().language===key;return `<button role="menuitemradio" aria-checked="${checked}" class="${checked?'checked':''}" data-dropdown="${item}">${checked?icon('check'):'<span class="check-spacer"></span>'}<span>${l.label}</span></button>`;}const c=commandById(item);if(!c)return '';const checked=actionChecked(item);return `<button role="${checked!==undefined?'menuitemcheckbox':'menuitem'}" ${checked!==undefined?`aria-checked="${checked}"`:''} class="${checked?'checked':''}" data-dropdown="${item}">${icon(checked?'check':c[3])}<span>${escapeHTML(c[1])}</span>${c[2]?`<kbd>${c[2]}</kbd>`:''}</button>`;}).join('');jsonPreview?.updateActions();
    d.hidden=false;const rect=anchor?.getBoundingClientRect();const left=point?.x??rect?.left??20,top=point?.y??rect?.bottom??120;d.style.left=Math.min(left,window.innerWidth-d.offsetWidth-10)+'px';d.style.top=Math.max(5,Math.min(top+3,window.innerHeight-d.offsetHeight-8))+'px';
    d.querySelector('button')?.focus();
  }
  $('dropdown').onclick=e=>{const b=e.target.closest('[data-dropdown]');if(!b)return;const id=b.dataset.dropdown;closeDropdown();if(id.startsWith('lang:'))setLanguage(id.slice(5));else dispatch(id);};
  $('dropdown').onkeydown=e=>{const buttons=[...$('dropdown').querySelectorAll('button')],i=buttons.indexOf(document.activeElement);if(e.key==='Escape'){closeDropdown();cm.focus();}else if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();buttons[(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}};
  function setLanguage(lang){if(!languages[lang])return;activeFile().languageAuto=false;clearTimeout(languageTimers.get(activeId));languageTimers.delete(activeId);activeFile().language=lang;cm.setOption('mode',languages[lang].mode);secondary?.setOption('mode',languages[lang].mode);renderFiles();persist();cm.focus();}
  function setReadOnly(){const f=activeFile();f.readOnly=!f.readOnly;cm.setOption('readOnly',f.readOnly);secondary?.setOption('readOnly',f.readOnly);renderFiles();persist();notify(f.readOnly?'Document is now read only.':'Document is editable.');}
  function dispatch(action,anchor){
    const ed=editorForAction();
    jsonPreview?.sync();
    if(jsonPreview&&!jsonPreview.allowed(action))return;
    switch(action){
      case 'new':newFile();break;
      case 'open':chooseFiles();break;
      case 'save':saveFile();break;
      case 'mask-ai':reviewMask();break;
      case 'copy-all':copyDocument();break;
      case 'save-as':if(window.showSaveFilePicker)saveFile(activeFile(),true);else renameFile(activeId,true);break;
      case 'rename':renameFile();break;
      case 'duplicate-file':duplicateFile();break;
      case 'close':closeFile(activeId);break;
      case 'close-others':closeOthers();break;
      case 'undo':if(canEdit())ed.undo();ed.focus();break;
      case 'redo':if(canEdit())ed.redo();ed.focus();break;
      case 'select-all':ed.execCommand('selectAll');ed.focus();break;
      case 'duplicate-line':duplicateLine();break;
      case 'delete-line':if(canEdit())ed.execCommand('deleteLine');break;
      case 'comment':if(canEdit()){ed.toggleComment();ed.focus();}break;
      case 'uppercase':transformCase(true);break;
      case 'lowercase':transformCase(false);break;
      case 'read-only':setReadOnly();break;
      case 'find':openSearch();break;
      case 'replace':openSearch(true);break;
      case 'diff':diffChecker.open();break;
      case 'schema':schemaGenerator.open();break;
      case 'json-preview':jsonPreview.open();break;
      case 'transpose':dataTranspose.open();break;
      case 'find-next':findNext(1);break;
      case 'find-prev':findNext(-1);break;
      case 'close-search':closeSearch();break;
      case 'replace-one':replaceOne();break;
      case 'replace-all':replaceAll();break;
      case 'goto':gotoLine();break;
      case 'bookmark':toggleBookmark();break;
      case 'next-bookmark':jumpBookmark(1);break;
      case 'previous-bookmark':jumpBookmark(-1);break;
      case 'wrap':settings.wrap=!settings.wrap;applySettings();break;
      case 'minimap':settings.minimap=!settings.minimap;applySettings();break;
      case 'line-numbers':settings.lineNumbers=!settings.lineNumbers;applySettings();break;
      case 'sidebar':if(window.innerWidth<=760){document.body.classList.toggle('sidebar-mobile-open');refreshEditors();}else{settings.sidebar=!settings.sidebar;applySettings();}break;
      case 'split':toggleSplit();break;
      case 'markdown':toggleMarkdown();break;
      case 'fold-all':cm.operation(()=>{for(let i=0;i<cm.lineCount();i++)cm.foldCode({line:i,ch:0},null,'fold');});break;
      case 'unfold-all':cm.operation(()=>{for(let i=0;i<cm.lineCount();i++)cm.foldCode({line:i,ch:0},null,'unfold');});break;
      case 'focus':document.body.classList.toggle('focus-mode');refreshEditors();break;
      case 'theme':settings.theme=settings.theme==='light'?'dark':'light';applySettings();break;
      case 'zoom-in':settings.fontSize=Math.min(24,settings.fontSize+1);applySettings();break;
      case 'zoom-out':settings.fontSize=Math.max(10,settings.fontSize-1);applySettings();break;
      case 'zoom-reset':settings.fontSize=13;applySettings();break;
      case 'auto-language':activeFile().languageAuto=true;applyDetectedLanguage(activeFile());renderFiles();persist();cm.focus();break;
      case 'language':showDropdown(menuMap.Language,anchor||$('language-status'));break;
      case 'format':formatCode();break;
      case 'format-json':formatJSON();break;
      case 'stringify-json':transformJSONString();break;
      case 'destringify-json':transformJSONString(true);break;
      case 'minify-json':if(canEdit())try{replaceDocument(JSON.stringify(JSON.parse(cm.getValue())));notify('JSON minified.');}catch(err){notify('Invalid JSON: '+err.message,true);}break;
      case 'sort':editLines(t=>t.split('\n').sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).join('\n'));notify('Lines sorted A → Z.');break;
      case 'sort-desc':editLines(t=>t.split('\n').sort((a,b)=>b.localeCompare(a,undefined,{numeric:true})).join('\n'));notify('Lines sorted Z → A.');break;
      case 'dedupe':editLines(t=>[...new Set(t.split('\n'))].join('\n'));notify('Duplicate lines removed.');break;
      case 'trim':editLines(t=>t.replace(/[\t ]+$/gm,''));notify('Trailing spaces trimmed.');break;
      case 'remove-empty':editLines(t=>t.split('\n').filter(l=>l.trim()).join('\n'));notify('Empty lines removed.');break;
      case 'eol':activeFile().eol=activeFile().eol==='LF'?'CRLF':'LF';renderFiles();persist();notify(`Downloads will use ${activeFile().eol} line endings.`);break;
      case 'export':exportWorkspace();break;
      case 'import':$('workspace-input').click();break;
      case 'settings':showSettings();break;
      case 'shortcuts':showShortcuts();break;
      case 'about':showAbout();break;
      case 'palette':showPalette();break;
      case 'workspace-menu':showDropdown(['new','open','rename','duplicate-file','close','close-others','-','export','import'],anchor||$('sidebar'));break;
    }
  }
  let lastFileClick={id:null,time:0};
  document.addEventListener('click',e=>{
    const close=e.target.closest('[data-close]');if(close){e.stopPropagation();closeFile(close.dataset.close);return;}
    const tab=e.target.closest('[data-file]');if(tab){const id=tab.dataset.file,now=performance.now(),double=lastFileClick.id===id&&now-lastFileClick.time<380;lastFileClick={id,time:double?0:now};switchFile(id);document.body.classList.remove('sidebar-mobile-open');if(double)renameFile(id);return;}
    const menu=e.target.closest('[data-menu]');if(menu){const was=menu.classList.contains('active');closeDropdown();if(!was){menu.classList.add('active');menu.setAttribute('aria-expanded','true');showDropdown(menuMap[menu.dataset.menu],menu);}return;}
    const action=e.target.closest('[data-action]');if(action){e.preventDefault();closeDropdown();dispatch(action.dataset.action,action);return;}
    if(!e.target.closest('#dropdown'))closeDropdown();
  });
  for(const area of [$('tabs'),$('file-list')])area.addEventListener('contextmenu',e=>{const el=e.target.closest('[data-tab],[data-file]');if(!el)return;e.preventDefault();switchFile(el.dataset.tab||el.dataset.file,false);showDropdown(['rename','duplicate-file','save','close','close-others'],null,{x:e.clientX,y:e.clientY});});
  $('tabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const idx=files.findIndex(f=>f.id===activeId);const n=e.key==='Home'?0:e.key==='End'?files.length-1:(idx+(e.key==='ArrowRight'?1:-1)+files.length)%files.length;switchFile(files[n].id,false);$('tabs').querySelector('.tab.active .tab-select')?.focus();});
  $('file-input').addEventListener('change',e=>openFiles([...e.target.files]));
  $('workspace-input').addEventListener('change',e=>importWorkspace(e.target.files[0]));
  $('find-input').addEventListener('input',()=>runSearch(true));
  $('find-input').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();findNext(e.shiftKey?-1:1);}else if(e.key==='Escape'){e.preventDefault();closeSearch();}});
  $('replace-input').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();replaceOne();}else if(e.key==='Escape')closeSearch();});
  for(const key of ['case','word','regex'])$(key+'-option').onclick=()=>{search[key]=!search[key];$(key+'-option').setAttribute('aria-pressed',String(search[key]));runSearch(true);$('find-input').focus();};
  $('map-track').addEventListener('pointerdown',e=>{const track=$('map-track');track.setPointerCapture(e.pointerId);const navigate=ev=>{const rect=track.getBoundingClientRect(),spacing=parseFloat($('map-content').style.lineHeight)||5;const line=Math.max(0,Math.min(cm.lineCount()-1,Math.floor((ev.clientY-rect.top)/spacing)));cm.scrollIntoView({line,ch:0},cm.getScrollInfo().clientHeight/3);};navigate(e);track.onpointermove=navigate;track.onpointerup=()=>{track.onpointermove=null;};});
  $('map-track').addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End'].includes(e.key)){e.preventDefault();const info=cm.getScrollInfo();const next=e.key==='Home'?0:e.key==='End'?info.height:info.top+(e.key.includes('Down')?1:-1)*(e.key.startsWith('Page')?info.clientHeight:50);cm.scrollTo(null,next);}});
  $('modal').addEventListener('click',e=>{if(e.target===$('modal')){const r=$('modal').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeModal();}});
  let dragDepth=0;
  document.addEventListener('dragenter',e=>{if(e.dataTransfer?.types.includes('Files')){e.preventDefault();dragDepth++;$('drop-overlay').hidden=false;}});
  document.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files')){e.preventDefault();e.dataTransfer.dropEffect='copy';}});
  document.addEventListener('dragleave',()=>{dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)$('drop-overlay').hidden=true;});
  document.addEventListener('drop',e=>{if(e.dataTransfer?.files.length){e.preventDefault();dragDepth=0;$('drop-overlay').hidden=true;const dropped=[...e.dataTransfer.files];
    const items=[...e.dataTransfer.items].filter(item=>item.kind==='file');
    const handles=items.map(item=>item.getAsFileSystemHandle?.()?.catch(()=>null));
    Promise.all(handles).then(results=>openFiles(dropped,results.length===dropped.length?results:[]));}});
  window.addEventListener('blur',()=>{dragDepth=0;$('drop-overlay').hidden=true;persist();});
  window.addEventListener('resize',()=>{closeDropdown();refreshEditors();});
  window.addEventListener('note-studio:before-update',event=>{persist();if(storageFailed)event.preventDefault();});
  window.addEventListener('beforeunload',e=>{persist();if(storageFailed&&files.some(isDirty)){e.preventDefault();e.returnValue='';}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)persist();});
  document.addEventListener('keydown',e=>{
    const modifier=e.ctrlKey||e.metaKey,key=e.key.toLowerCase(),inEditor=e.target.closest('.CodeMirror'),input=e.target.matches('input,textarea,select');
    if(e.key==='Escape'&&!$('dropdown').hidden){closeDropdown();e.preventDefault();return;}
    if($('modal').open||$('diff-dialog').open||$('schema-dialog').open||$('pwa-dialog')?.open)return;
    if(modifier&&e.altKey&&key==='d'){e.preventDefault();dispatch('diff');return;}
    if(modifier&&e.altKey&&key==='m'){e.preventDefault();dispatch('markdown');return;}
    if(modifier&&e.altKey&&['ArrowRight','ArrowLeft'].includes(e.key)){e.preventDefault();const n=(files.findIndex(f=>f.id===activeId)+(e.key==='ArrowRight'?1:-1)+files.length)%files.length;switchFile(files[n].id);return;}
    const action=modifier&&key==='n'?'new':modifier&&key==='o'?'open':modifier&&key==='s'?(e.shiftKey?'save-as':'save'):modifier&&key==='k'&&!e.shiftKey?'palette':modifier&&key==='p'&&e.shiftKey?'palette':null;
    if(action){e.preventDefault();e.stopPropagation();dispatch(action);return;}
    if(inEditor)return;
    if(modifier&&key==='f'&&!e.shiftKey){e.preventDefault();dispatch('find');}
    else if(modifier&&key==='h'){e.preventDefault();dispatch('replace');}
    else if(modifier&&key==='g'&&!input){e.preventDefault();dispatch('goto');}
    else if(e.altKey&&key==='z'){e.preventDefault();dispatch('wrap');}
    else if(e.key==='Escape'&&document.body.classList.contains('focus-mode'))dispatch('focus');
  },true);
  renderFiles();renderBookmarks();applySettings();updateStatus();persist();jsonPreview.sync();
  if(restoringIssue)notify('The previous browser session could not be restored. Import a workspace backup if you have one.',true);
  if(/Mac|iPhone|iPad/.test(navigator.platform)){
    document.querySelector('.command-trigger kbd').textContent='⌘ K';
  }
})();
