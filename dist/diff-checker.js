/* Side-by-side comparison of editable snapshots; workspace documents are untouched. */
(function () {
  'use strict';
  window.createNotepadDiffChecker = function ({getFiles, getActiveFile, getSettings, getMode, detectLanguage, languageLabel, notify, download, copyText}) {
    const $ = id => document.getElementById(id), dialog = $('diff-dialog');
    const panes = {}; let worker = null, timer, requestId = 0, result = null, current = -1;
    let loading = false, scrolling = false, initialized = false, opener = null, widgets = [];
    const maxSize = 5 * 1024 * 1024;
    function resetResult(message = 'Ready to compare') {
      result = null; current = -1;
      for (const widget of widgets) widget.clear(); widgets = [];
      $('diff-summary').textContent = message; $('diff-counter').textContent = '0 / 0';
      for (const id of ['diff-prev','diff-next','diff-export','diff-merge-left','diff-merge-right']) $(id).disabled = true;
      for (const pane of Object.values(panes)) { pane.editor.clearGutter('diff-merge-gutter'); pane.editor.refresh(); }
    }
    function changedChunk(side, line) {
      if (!result) return -1;
      const chunks = result.chunks, start = side === 'left' ? 'leftStart' : 'rightStart', end = side === 'left' ? 'leftEnd' : 'rightEnd';
      let lo = 0, hi = chunks.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (chunks[mid][end] <= line) lo = mid + 1; else hi = mid; }
      return lo < chunks.length && chunks[lo][start] <= line && line < chunks[lo][end] ? lo : -1;
    }
    function matchingLine(side, line) {
      if (!result || !$('diff-matching').checked) return false;
      const start = side === 'left' ? 'leftStart' : 'rightStart', end = side === 'left' ? 'leftEnd' : 'rightEnd';
      let lo = 0, hi = result.ops.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (result.ops[mid][end] <= line) lo = mid + 1; else hi = mid; }
      const op = result.ops[lo];
      return !!op && op.type === 'equal' && op[start] <= line && line < op[end];
    }
    function sources() {
      for (const side of ['left','right']) {
        const select = $('diff-source-' + side), old = select.value;
        select.replaceChildren(new Option('Custom / pasted text', ''));
        for (const file of getFiles()) select.add(new Option(file.name, file.id));
        select.value = getFiles().some(file => file.id === old) ? old : '';
      }
    }
    function updatePaneLanguage(side,edited=false){
      const pane=panes[side],language=detectLanguage(pane.editor.getValue(),pane.name);
      if(language!==pane.language){pane.language=language;pane.editor.setOption('mode',getMode(language));}
      $('diff-name-'+side).textContent=`${pane.name} · ${languageLabel(language)} (Auto) · ${edited?'edited copy':'editable copy'}`;
    }
    function ensureEditors() {
      if (initialized) return;
      initialized = true;
      for (const side of ['left','right']) {
        const label = side === 'left' ? 'Original text' : 'Modified text';
        const ed = CodeMirror($('diff-editor-' + side), {
          value:'', mode:null, lineNumbers:true, gutters:['CodeMirror-linenumbers','diff-merge-gutter'], lineWrapping:false, viewportMargin:12,
          screenReaderLabel:label, dragDrop:false, indentUnit:2, tabSize:2,
          lineNumberFormatter:n => (changedChunk(side, n - 1) >= 0 ? (side === 'left' ? '− ' : '+ ') : '  ') + n,
          extraKeys:{'Alt-Down':() => navigate(1),'Alt-Up':() => navigate(-1),'Ctrl-Enter':compareNow,'Cmd-Enter':compareNow}
        });
        panes[side] = {editor:ed, name:side === 'left' ? 'original.txt' : 'modified.txt', epoch:0,language:'text'};
        ed.on('renderLine', (instance, line, element) => {
          const number = instance.getLineNumber(line), index = changedChunk(side, number);
          if (index >= 0) { element.classList.add(side === 'left' ? 'diff-line-removed' : 'diff-line-added'); if (index === current) element.classList.add('diff-line-current'); }
          else if (matchingLine(side, number)) element.classList.add('diff-line-match');
        });
        ed.on('change', () => {
          if (loading) return;
          panes[side].epoch++; $('diff-source-' + side).value = '';
          clearTimeout(panes[side].languageTimer);
          panes[side].languageTimer=setTimeout(()=>updatePaneLanguage(side,true),250);
          queueCompare();
        });
        ed.on('scroll', () => {
          if (scrolling || !$('diff-sync').checked) return;
          const other = panes[side === 'left' ? 'right' : 'left']; if (!other) return;
          scrolling = true; const info = ed.getScrollInfo(); other.editor.scrollTo(info.left, info.top);
          requestAnimationFrame(() => { scrolling = false; });
        });
        $('diff-source-' + side).addEventListener('change', event => {
          const file = getFiles().find(file => file.id === event.target.value);
          if (file) load(side, file.content, file.name, file.id);
          else { $('diff-name-' + side).textContent = 'Custom text · paste or type below'; ed.focus(); }
        });
        $('diff-file-' + side).addEventListener('change', async event => {
          const file = event.target.files[0]; event.target.value = ''; if (file) await readFile(side, file);
        });
      }
    }
    function load(side, text, name, sourceId = '') {
      const pane = panes[side]; pane.epoch++; pane.name = name;
      clearTimeout(pane.languageTimer);
      loading = true; pane.editor.setValue(text.replace(/\r\n?/g, '\n')); pane.editor.clearHistory(); loading = false;
      $('diff-source-' + side).value = sourceId;
      updatePaneLanguage(side);
      queueCompare();
    }
    async function readFile(side, file) {
      if (file.size > maxSize) { notify('Choose a UTF-8 text file up to 5 MB for comparison.',true); return; }
      const pane = panes[side], epoch = ++pane.epoch;
      try {
        const text = await file.text(); if (epoch !== pane.epoch) return;
        if (text.includes('\u0000')) { notify('Choose a UTF-8 text file for comparison.',true); return; }
        load(side, text, file.name);
      } catch { notify('Could not read ' + file.name,true); }
    }
    function queueCompare() {
      clearTimeout(timer); requestId++; resetResult('Comparing…');
      worker?.terminate(); worker = null;
      timer = setTimeout(compareNow, 280);
    }
    function texts() { return {left:panes.left.editor.getValue(),right:panes.right.editor.getValue()}; }
    function compareNow() {
      if (!initialized || !dialog.open) return;
      clearTimeout(timer); worker?.terminate(); worker = null;
      const id = ++requestId, text = texts(); resetResult('Comparing…');
      if (text.left.length > maxSize || text.right.length > maxSize || text.left.split('\n').length > 100000 || text.right.split('\n').length > 100000) {
        $('diff-summary').textContent = 'Compare up to 5 MB and 100,000 lines per side. Try a smaller section.'; return;
      }
      const message = {id,action:'compare',...text,ignoreWhitespace:$('diff-whitespace').checked};
      const fallback = () => {
        worker?.terminate(); worker = null;
        setTimeout(() => { if (id !== requestId || !dialog.open) return; try { showResult(NotepadDiff.compare(text.left,text.right,message.ignoreWhitespace)); } catch { $('diff-summary').textContent = 'Could not compare this text. Try a smaller section.'; } },0);
      };
      try {
        worker = new Worker(new URL('diff-worker.js',document.baseURI));
        worker.onmessage = ({data}) => {
          if (data.id !== requestId || !dialog.open) return;
          if (data.error) { $('diff-note').textContent = 'Could not prepare result: ' + data.error; $('diff-export').disabled = false; return; }
          showResult(data.result);
        };
        worker.onerror = fallback; worker.postMessage(message);
      } catch { fallback(); }
    }
    function showResult(value) {
      result = value; current = value.chunks.length ? 0 : -1;
      const count = value.chunks.length, ignored = $('diff-whitespace').checked;
      $('diff-summary').replaceChildren();
      const label = document.createElement('strong');
      label.textContent = count ? `${count.toLocaleString()} ${count === 1 ? 'change' : 'changes'}` : (ignored ? 'No differences (whitespace ignored)' : 'Texts are identical');
      $('diff-summary').append(label);
      for (const [number, name, sign] of [[value.added,'added','+'],[value.removed,'removed','−']]) {
        const badge = document.createElement('span'); badge.className = 'diff-stat-' + name; badge.textContent = `${sign}${number.toLocaleString()} ${name}`; $('diff-summary').append(badge);
      }
      $('diff-note').textContent = value.simplified ? 'Large or repetitive sections are grouped. All changed text is included.' : 'Editable copies · comparison text stays here until this page reloads';
      for (const id of ['diff-prev','diff-next','diff-merge-left','diff-merge-right']) $(id).disabled = !count;
      // Export always includes exact text changes, even when the view ignores whitespace.
      $('diff-export').disabled = texts().left === texts().right;
      $('diff-counter').textContent = count ? `1 / ${count}` : '0 / 0';
      for (const pane of Object.values(panes)) pane.editor.operation(() => pane.editor.refresh());
      // Toolbar arrows remain available for large comparisons without thousands of DOM controls.
      if (count <= 1000) value.chunks.forEach((chunk, index) => {
        for (const side of ['left','right']) {
          const ed = panes[side].editor, button = document.createElement('button');
          const target = side === 'left' ? 'right' : 'left';
          button.type = 'button'; button.className = 'diff-merge-arrow';
          button.textContent = target === 'right' ? '→' : '←';
          button.title = 'Copy change ' + (index + 1) + ' from ' + side + ' to ' + target;
          button.setAttribute('aria-label', button.title);
          button.addEventListener('click', event => {
            event.preventDefault(); event.stopPropagation();
            if (result === value) mergeChunk(target, index);
          });
          ed.setGutterMarker(Math.min(ed.lastLine(), chunk[side + 'Start']), 'diff-merge-gutter', button);
        }
      });
      if (count <= 1000) for (const chunk of value.chunks) {
        const leftSize = chunk.leftEnd - chunk.leftStart, rightSize = chunk.rightEnd - chunk.rightStart;
        if (leftSize === rightSize) continue;
        const side = leftSize < rightSize ? 'left' : 'right', ed = panes[side].editor;
        const end = chunk[side === 'left' ? 'leftEnd' : 'rightEnd'];
        const spacer = document.createElement('div'); spacer.className = 'diff-spacer'; spacer.setAttribute('aria-hidden','true');
        spacer.style.height = Math.abs(leftSize - rightSize) * ed.defaultTextHeight() + 'px';
        widgets.push(ed.addLineWidget(Math.max(0,end - 1),spacer,{above:end === 0,coverGutter:true,noHScroll:true,handleMouseEvents:false}));
      }
    }
    function navigate(direction) {
      if (!result?.chunks.length) return;
      current = (current + direction + result.chunks.length) % result.chunks.length;
      const chunk = result.chunks[current]; scrolling = true;
      for (const side of ['left','right']) {
        const ed = panes[side].editor, line = Math.min(ed.lineCount() - 1,chunk[side === 'left' ? 'leftStart' : 'rightStart']);
        ed.refresh(); ed.scrollTo(null,Math.max(0,ed.heightAtLine(line,'local') - 50));
      }
      requestAnimationFrame(() => { scrolling = false; });
      $('diff-counter').textContent = `${current + 1} / ${result.chunks.length}`;
    }
    function mergeChunk(targetSide, index = current) {
      if (!result || !dialog.open || !result.chunks[index]) return;
      const text = texts(), edit = NotepadDiff.mergeEdit(text.left, text.right, result.chunks[index], targetSide);
      const ed = panes[targetSide].editor;
      const mergedLength = ed.getValue().length - (edit.to - edit.from) + edit.text.length;
      if (mergedLength > maxSize) { notify('Merged text would exceed the 5 MB comparison limit.', true); return; }
      const remainingLines=ed.lineCount()-(ed.getRange(ed.posFromIndex(edit.from),ed.posFromIndex(edit.to)).match(/\n/g)||[]).length;
      if(remainingLines+(edit.text.match(/\n/g)||[]).length>100000){notify('Merged text would exceed 100,000 lines.',true);return;}
      ed.getDoc().changeGeneration(true);
      ed.replaceRange(edit.text, ed.posFromIndex(edit.from), ed.posFromIndex(edit.to), 'diff-merge');
      ed.getDoc().changeGeneration(true);
      ed.focus();
      // change invalidates every old arrow before another merge can run.
      compareNow();
      notify('Change copied to the ' + targetSide + ' comparison pane. Undo to restore it.');
    }
    function exportPatch() {
      if (!result) return;
      $('diff-note').textContent = 'Preparing patch…';
      const text = texts();
      try {
        // Start the download in the explicit click gesture, including browsers that restrict async downloads.
        const patch = NotepadDiff.patch(text.left,text.right,panes.left.name,panes.right.name);
        download(new Blob([patch],{type:'text/plain;charset=utf-8'}),'comparison.diff');
        $('diff-note').textContent = 'Patch download started · includes all exact text changes';
      } catch { $('diff-note').textContent = 'Could not prepare this patch. Try a smaller section.'; }
    }
    async function copyAll(side, button) {
      const text = panes[side].editor.getValue(), label = side === 'left' ? 'Original' : 'Modified';
      if (!text) { $('diff-note').textContent = label + ' text is empty.'; return; }
      button.disabled = true;
      try {
        await copyText(text,dialog);
        $('diff-note').textContent = `${label} text copied · ${text.length.toLocaleString()} characters`;
        const symbol = button.querySelector('use'); symbol.setAttribute('href','#i-check');
        clearTimeout(panes[side].copyTimer);
        panes[side].copyTimer = setTimeout(() => symbol.setAttribute('href','#i-copy'),1600);
      } catch { $('diff-note').textContent = 'Clipboard access is unavailable. Select the text and use your browser’s Copy command.'; }
      finally { button.disabled = false; }
    }
    function open() {
      opener = document.activeElement;
      if (!dialog.open) dialog.showModal();
      const first = !initialized; ensureEditors(); sources();
      for (const pane of Object.values(panes)) pane.editor.getWrapperElement().style.fontSize = getSettings().fontSize + 'px';
      if (first) {
        const active = getActiveFile(), other = getFiles().find(file => file.id !== active.id);
        load('left',active.content,active.name,active.id);
        if (other) load('right',other.content,other.name,other.id);
      }
      requestAnimationFrame(() => { for (const pane of Object.values(panes)) pane.editor.refresh(); compareNow(); });
    }
    dialog.addEventListener('click', event => {
      const button = event.target.closest('[data-diff]'); if (!button) return;
      const action = button.dataset.diff;
      if (action === 'close') dialog.close();
      else if (action === 'compare') compareNow();
      else if (action === 'prev') navigate(-1);
      else if (action === 'next') navigate(1);
      else if (action === 'export') exportPatch();
      else if (action === 'merge-left') mergeChunk('left');
      else if (action === 'merge-right') mergeChunk('right');
      else if (action.startsWith('copy-')) copyAll(action.slice(5),button);
      else if (action.startsWith('open-')) $('diff-file-' + action.slice(5)).click();
      else if (action === 'swap') {
        const left = {text:panes.left.editor.getValue(),name:panes.left.name,source:$('diff-source-left').value};
        load('left',panes.right.editor.getValue(),panes.right.name,$('diff-source-right').value);
        load('right',left.text,left.name,left.source); compareNow();
      } else if (action === 'clear') {
        load('left','','original.txt'); load('right','','modified.txt'); compareNow(); panes.left.editor.focus();
      }
    });
    $('diff-whitespace').addEventListener('change',compareNow);
    $('diff-matching').addEventListener('change',() => {
      for (const pane of Object.values(panes)) pane.editor.refresh();
    });
    dialog.addEventListener('close', () => { clearTimeout(timer); requestId++; worker?.terminate(); worker = null; if (opener?.isConnected) opener.focus(); });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); dialog.close(); }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); compareNow(); }
    });
    for (const type of ['dragenter','dragover','dragleave']) dialog.addEventListener(type, event => { if (event.dataTransfer?.types.includes('Files')) { event.stopPropagation(); event.preventDefault(); } });
    dialog.addEventListener('drop', event => {
      if (!event.dataTransfer?.files.length) return;
      event.preventDefault(); event.stopPropagation();
      const side = event.target.closest('[data-diff-side]')?.dataset.diffSide;
      if (side) readFile(side,event.dataTransfer.files[0]);
      else notify('Drop a text file into the original or modified pane.');
    });
    return {open};
  };
})();
