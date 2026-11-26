import * as pdfjs from './vendor/pdfjs/pdf.mjs';
import {properties, pdfForm, readField, setField, formFieldType, treeFromOutline, writeOutline, scrubPdf} from './pdf-properties.mjs';
import {recognizePages, searchablePDF, rectangle, rasterRedact} from './pdf-intelligence.mjs';

import {listEditableText, rewriteText} from './pdf-text-edit.mjs';

import {inspectPdf, alignPages, renderComparison, difference, comparisonSummary} from './pdf-compare.mjs';
import {archive, runBatch} from './pdf-batch.mjs';

const asset = path => new URL(path, import.meta.url).href;
pdfjs.GlobalWorkerOptions.workerSrc = asset('vendor/pdfjs/pdf.worker.mjs');
const $ = id => document.getElementById(id);
const core = globalThis.AllNotePDFCore;
const lib = globalThis.PDFLib;
const engine = core.engine(lib);
const controls = [...document.querySelectorAll('[data-op], [data-tool], #prev, #next, #find, #zoom')];
const markup = $('markup');
const pdfType = { description: 'PDF document', accept: {'application/pdf': ['.pdf']} };
const status = message => { $('status').textContent = message; };

let current = null;
let saved = null;
let viewer = null;
let viewerTask = null;
let page = 1;
let viewport = null;
let filename = 'document.pdf';
let original = null;
let busy = false;
let undo = [];
let redo = [];
let tool = '';
let image = null;
let imageMode = '';
let fileMode = '';
let stroke = null;
let dragging = null;
let thumbnailQueue = Promise.resolve();
let thumbGeneration = 0;

function refreshControls() {
  const restrictions = {
    prev: page === 1,
    next: page >= viewer?.numPages,
    undo: !undo.length,
    redo: !redo.length,
    'move-up': page === 1,
    'move-down': page >= viewer?.numPages,
    save: !original,
    unprotect: !current?.password,
    'ocr-layer': !ocrResults.some(result => result.words.length),
    'ocr-txt': !ocrResults.length,
    'ocr-note': !ocrResults.length,
    'redact-export': !regions.some(region => region.selected),
    'redact-review': !regions.some(region => region.selected),
    'save-properties': !propertiesLoaded,
    'sanitize-report': !sanitizationResult,
    'apply-text-edit': !editBlocks.length || !$('editable-block').value,
    'add-bookmark': bookmarkTree === null,
    'nest-bookmark': !pickedBookmark,
    'rename-bookmark': !pickedBookmark,
    'move-bookmark': !pickedBookmark || pickedBookmark.items.indexOf(pickedBookmark.node) === 0,
    'remove-bookmark': !pickedBookmark
  };
  for (const control of controls) {
    control.disabled = busy || !current || Boolean(restrictions[control.dataset.op || control.id]);
  }
  for (const id of ['open','merge','images','open-batch']) $(id).disabled = busy;
  $('pdf-app').setAttribute('aria-busy', String(busy));
  $('document-state').textContent = [
    current?.password && 'Password protected',
    current && current !== saved && 'Unsaved changes'
  ].filter(Boolean).join(' · ');
}

async function run(operation) {
  if (busy) return;
  busy = true;
  refreshControls();
  try {
    await operation();
  } catch (error) {
    if (error?.name !== 'AbortError') status(error?.message || 'The PDF operation failed.');
  } finally {
    busy = false;
    refreshControls();
  }
}

function transformPdf(input, operation, password = '', signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(asset('pdf-qpdf-worker.js'));
    const finish = (callback, value) => {
      clearTimeout(timeout);
      worker.terminate();
      signal?.removeEventListener('abort', cancel);
      callback(value);
    };
    const cancel = () => finish(reject, new DOMException('Canceled', 'AbortError'));
    const timeout = setTimeout(() => finish(reject, Error('The PDF operation timed out.')), 45000);
    if (signal?.aborted) return cancel();
    signal?.addEventListener('abort', cancel, {once: true});
    worker.onmessage = ({data}) => {
      if (data.error) {
        finish(reject, Error(data.error));
      } else {
        finish(resolve, data.result);
      }
    };
    worker.onerror = event => {
      event.preventDefault();
      finish(reject, Error('The local PDF engine could not start.'));
    };
    const copy = input.slice();
    worker.postMessage({input: copy, operation, password}, [copy.buffer]);
  });
}

function passwordDialog(title, description, confirmPassword = false) {
  const dialog = $('password-dialog');
  const password = $('password');
  const again = $('password-again');
  $('password-title').textContent = title;
  $('password-help').textContent = description;
  $('password-confirmation').hidden = !confirmPassword;
  again.required = confirmPassword;
  dialog.returnValue = 'cancel';

  return new Promise(resolve => {
    function validate() {
      const invalid = password.value.includes('\0') || new TextEncoder().encode(password.value).length > 127;
      password.setCustomValidity(invalid ? 'Use a password of up to 127 UTF-8 bytes.' : '');
      again.setCustomValidity(confirmPassword && again.value !== password.value ? 'Passwords must match.' : '');
    }
    dialog.addEventListener('input', validate);
    dialog.addEventListener('close', () => {
      const result = dialog.returnValue === 'accept' ? password.value : null;
      dialog.removeEventListener('input', validate);
      password.value = again.value = '';
      validate();
      resolve(result);
    }, {once: true});
    dialog.showModal();
    password.focus();
  });
}

function readPdf(data, password) {
  core.validateBytes(data);
  return pdfjs.getDocument({
    data: data.slice(), password, isEvalSupported: false, enableXfa: false, verbosity: pdfjs.VerbosityLevel.ERRORS,
    disableFontFace: true, maxImageSize: 16000000, stopAtErrors: true,
    cMapUrl: asset('vendor/pdfjs/cmaps/'), cMapPacked: true,
    standardFontDataUrl: asset('vendor/pdfjs/standard_fonts/'),
    iccUrl: asset('vendor/pdfjs/iccs/'), wasmUrl: asset('vendor/pdfjs/wasm/')
  });
}

async function authorizeOwner(data, password) {
  while (!password || !(await transformPdf(data, 'is-owner', password))) {
    const help = password
      ? 'That password does not grant owner access. Enter the PDF owner password.'
      : 'This PDF restricts some operations. Enter its owner password to edit it.';
    password = await passwordDialog('PDF owner password required', help);
    if (password === null) throw new DOMException('Opening canceled', 'AbortError');
  }
  return password;
}

async function openedState(data) {
  let password = '';
  for (;;) {
    const task = readPdf(data, password);
    // PDF.js rejects when no password callback is registered and the document needs one.
    let locked = false;
    try {
      const document = await task.promise;
      if (document.numPages < 1 || document.numPages > core.MAX_PAGES) {
        throw Error('PDFs must contain between 1 and 1,000 pages.');
      }
      const permissions = await document.getPermissions();
      locked = Boolean(password) || permissions !== null;
      if (locked && (!permissions || Object.values(pdfjs.PermissionFlag).some(flag => !permissions.has(flag)))) {
        password = await authorizeOwner(data, password);
      }
    } catch (error) {
      if (!(error instanceof pdfjs.PasswordException)) throw error;
      locked = true;
      const attempt = await passwordDialog('Open protected PDF',
        password ? 'That password was incorrect. Try again.' : 'Enter the existing PDF password.');
      if (attempt === null) throw new DOMException('Opening canceled', 'AbortError');
      password = attempt;
      continue;
    } finally {
      await task.destroy();
    }
    if (!locked) return {data, password: ''};
    if (!password) {
      password = await passwordDialog('Open protected PDF', 'Enter the existing non-empty password to edit this protected PDF.');
      if (password === null) throw new DOMException('Opening canceled', 'AbortError');
      // A PDF with an empty user password can open even with a wrong owner password.
      // QPDF verifies the supplied password before making a writable copy.
    }
    return {data: await transformPdf(data, 'decrypt', password), password};
  }
}

async function fileBytes(file) {
  if (!file || file.size > core.MAX_BYTES) throw Error('Input exceeds the 50 MiB file limit.');
  return new Uint8Array(await file.arrayBuffer());
}

function download(data, name, type = 'application/pdf') {
  const url = URL.createObjectURL(new Blob([data], {type}));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function stem() {
  return filename.replace(/\.pdf$/i, '');
}

async function paint(pdfPage, view, canvas) {
  const width = Math.ceil(view.width);
  const height = Math.ceil(view.height);
  if (!width || !height || width * height > 16000000 || width > 8192 || height > 8192) {
    throw Error('Page exceeds the render limit. Choose a lower resolution.');
  }
  canvas.width = width;
  canvas.height = height;
  await pdfPage.render({canvas, canvasContext: canvas.getContext('2d'), viewport: view}).promise;
}

async function viewPage(pdf, index) {
  const pdfPage = await pdf.getPage(index);
  const unit = pdfPage.getViewport({scale: 1});
  const scale = Math.min(Number($('zoom').value), 8100 / unit.width, 8100 / unit.height,
    Math.sqrt(15500000 / (unit.width * unit.height)));
  const preview = document.createElement('canvas');
  const view = pdfPage.getViewport({scale});
  await paint(pdfPage, view, preview);
  return {preview, view, pdfPage};
}

function showPage(index, {preview, view, pdfPage}) {
  const canvas = $('canvas');
  canvas.width = markup.width = preview.width;
  canvas.height = markup.height = preview.height;
  canvas.getContext('2d').drawImage(preview, 0, 0);
  pdfPage.cleanup();
  viewport = view;
  if (page !== index) resetEditBlocks();
  page = index;
  $('range').value = String(page);
  $('position').textContent = page + ' / ' + viewer.numPages;
  drawDraft();
  $('empty').hidden = true;
  $('page-surface').hidden = false;
  $('pages').querySelector('[aria-current]')?.removeAttribute('aria-current');
  $('pages').children[page - 1]?.firstElementChild.setAttribute('aria-current', 'page');
}

const visibleThumbnails = new WeakSet();
const thumbnails = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const canvas = entry.target;
    if (!entry.isIntersecting) {
      visibleThumbnails.delete(canvas);
      canvas.width = canvas.height = 0;
      continue;
    }
    visibleThumbnails.add(canvas);
    const pdf = viewer;
    const generation = thumbGeneration;
    thumbnailQueue = thumbnailQueue.then(async () => {
      if (generation !== thumbGeneration || !visibleThumbnails.has(canvas) || canvas.width) return;
      const pdfPage = await pdf.getPage(Number(canvas.dataset.page));
      const unit = pdfPage.getViewport({scale: 1});
      const preview = document.createElement('canvas');
      try {
        await paint(pdfPage, pdfPage.getViewport({scale: Math.min(104 / unit.width, 118 / unit.height)}), preview);
        if (generation !== thumbGeneration || !visibleThumbnails.has(canvas)) return;
        canvas.width = preview.width;
        canvas.height = preview.height;
        canvas.getContext('2d').drawImage(preview, 0, 0);
      } finally {
        pdfPage.cleanup();
        preview.width = preview.height = 0;
      }
    }).catch(() => {});
  }
}, {root: $('page-sidebar'), rootMargin: '120px'});

function rebuildThumbnails() {
  thumbGeneration++;
  thumbnails.disconnect();
  const list = document.createDocumentFragment();
  for (let index = 1; index <= viewer.numPages; index++) {
    const row = document.createElement('li');
    const button = document.createElement('button');
    const canvas = document.createElement('canvas');
    const label = document.createElement('span');
    canvas.width = canvas.height = 0;
    canvas.dataset.page = String(index);
    canvas.setAttribute('aria-hidden', 'true');
    label.textContent = 'Page ' + index;
    button.type = 'button';
    button.draggable = true;
    button.onclick = () => void run(() => go(index));
    button.ondragstart = event => {
      if (busy) return event.preventDefault();
      dragging = index;
      event.dataTransfer.setData('text/plain', String(index));
      event.dataTransfer.effectAllowed = 'move';
    };
    button.ondragover = event => {
      if (busy || dragging === null || dragging === index) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      button.toggleAttribute('data-drop', true);
    };
    button.ondragleave = () => button.removeAttribute('data-drop');
    button.ondragend = () => {
      dragging = null;
      $('pages').querySelector('[data-drop]')?.removeAttribute('data-drop');
    };
    button.ondrop = event => {
      if (dragging === null) return;
      event.preventDefault();
      event.stopPropagation();
      const source = dragging;
      dragging = null;
      button.removeAttribute('data-drop');
      void run(() => movePage(source, index));
    };
    button.append(canvas, label);
    row.append(button);
    list.append(row);
    thumbnails.observe(canvas);
  }
  $('pages').replaceChildren(list);
}

async function display(state, index = page) {
  if (state.data === current?.data) {
    current = state;
    return;
  }
  const task = readPdf(state.data);
  let next;
  let rendered;
  try {
    next = await task.promise;
    if (next.numPages < 1 || next.numPages > core.MAX_PAGES) throw Error('Unsupported page count.');
    index = Math.min(next.numPages, index);
    rendered = await viewPage(next, index);
  } catch (error) {
    await task.destroy();
    throw error;
  }
  const old = viewerTask;
  viewerTask = task;
  viewer = next;
  current = state;
  propertiesLoaded = false;
  resetEditBlocks();
  $('property-fields').replaceChildren();
  $('accessibility-info').textContent = '';
  $('xmp-info').value = '';
  $('xmp-replace').checked = false;
  $('xmp-replace').disabled = true;
  sanitizationResult = null;
  $('form-data').value = '';
  $('form-controls').replaceChildren();
  $('signature-field').replaceChildren(new Option('Page markup', ''));
  bookmarkTree = null;
  pickedBookmark = null;
  $('bookmark-list').replaceChildren();
  ocrResults = [];
  $('ocr-confidence').textContent = '';
  regions = [];
  ignoredText.clear();
  renderRegions();
  setTool('');
  rebuildThumbnails();
  showPage(index, rendered);
  if (old) void old.destroy().catch(() => {});
}

async function go(index) {
  if (index < 1 || index > viewer.numPages) return;
  const rendered = await viewPage(viewer, index);
  setTool('');
  showPage(index, rendered);
  $('pages').children[index - 1].scrollIntoView({block: 'nearest'});
}

async function replaceDocument(state, name, file = null, handle = null) {
  await display(state, 1);
  filename = core.safeFilename(name);
  original = handle ? {handle, file} : null;
  warnedSignature = false;
  undo = [];
  redo = [];
  saved = file ? current : null;
  status(filename + ' · ' + viewer.numPages + ' pages');
}

async function change(data, {password = current.password, index = page} = {}) {
  const previous = current;
  const pageBeforeChange = page;
  if (data !== current.data && !warnedSignature) {
    const source = await engine.open(current.data);
    const form = source.catalog.get(lib.PDFName.of('AcroForm'));
    if (form && !source.context.lookup(form)?.has?.(lib.PDFName.of('XFA')) &&
        source.getForm().getFields().some(field => field instanceof lib.PDFSignature && field.acroField.dict.has(lib.PDFName.of('V')))) {
      if (!confirm('Editing this signed PDF may invalidate the existing digital signature. Continue?')) {
        throw new DOMException('Edit canceled', 'AbortError');
      }
    }
    warnedSignature = true;
  }
  await display({data, password}, index);
  undo.push({state: previous, index: pageBeforeChange});
  while (undo.length > 5 || undo.reduce((total, item) => total + item.state.data.length, 0) > 100 * 1024 * 1024) {
    undo.shift();
  }
  redo = [];
}

async function history(from, to) {
  const previous = {state: current, index: page};
  const entry = from.at(-1);
  await display(entry.state, entry.index);
  from.pop();
  to.push(previous);
  status('Page ' + page + ' of ' + viewer.numPages);
}

async function movePage(from, to) {
  if (from === to) return;
  await change(await engine.move(current.data, from - 1, to - 1), {index: to});
  $('pages').children[to - 1].scrollIntoView({block: 'nearest'});
  status('Moved page ' + from + ' to position ' + to + '.');
}

function confirmReplacement() {
  return current === saved || confirm('Discard unsaved changes to this PDF?');
}

async function openFile(file, handle = null) {
  const state = await openedState(await fileBytes(file));
  await replaceDocument(state, file.name, file, handle);
}

function chooseFiles(mode) {
  fileMode = mode;
  $('files').multiple = mode === 'merge';
  $('files').click();
}

$('open').onclick = () => void run(async () => {
  if (!confirmReplacement()) return;
  if (!window.showOpenFilePicker) {
    chooseFiles('open');
    return;
  }
  let handle;
  try {
    [handle] = await window.showOpenFilePicker({types: [pdfType], multiple: false});
  } catch (error) {
    if (error.name !== 'SecurityError' && error.name !== 'NotSupportedError') throw error;
    chooseFiles('open');
    return;
  }
  await openFile(await handle.getFile(), handle);
});

$('merge').onclick = () => {
  if (confirmReplacement()) chooseFiles('merge');
};

function checkBatch(files) {
  if (files.length > 50 || files.reduce((total, file) => total + file.size, 0) > core.MAX_BYTES) {
    throw Error('Use up to 50 files totaling no more than 50 MiB.');
  }
}

$('files').onchange = () => {
  const files = [...$('files').files];
  $('files').value = '';
  if (!files.length) return;
  void run(async () => {
    if (fileMode === 'open') {
      await openFile(files[0]);
      return;
    }
    checkBatch(files);
    const inputs = [];
    let protectedInput = false;
    for (const file of files) {
      const state = await openedState(await fileBytes(file));
      inputs.push(state.data);
      protectedInput ||= Boolean(state.password);
    }
    let password = '';
    if (protectedInput) {
      password = await passwordDialog('Protect merged PDF',
        'Set a password for the merged PDF containing protected pages.', true);
      if (password === null) return;
    }
    await replaceDocument({data: await engine.merge(inputs), password}, 'merged.pdf');
  });
};

const paper = $('paper');
paper.ondragover = event => {
  if (event.dataTransfer.types.includes('Files')) event.preventDefault();
};
paper.ondrop = event => {
  if (!event.dataTransfer.files.length) return;
  event.preventDefault();
  if (!busy && confirmReplacement()) {
    const [file] = event.dataTransfer.files;
    void run(() => openFile(file));
  }
};

async function exportBytes(data = current.data, password = current.password) {
  core.validateBytes(data);
  return password ? transformPdf(data, 'encrypt', password) : data;
}

async function saveFile(saveAs) {
  let handle = original?.handle;
  if (saveAs) {
    handle = null;
    if (window.showSaveFilePicker) {
      try {
        handle = await window.showSaveFilePicker({suggestedName: filename, types: [pdfType]});
      } catch (error) {
        if (error.name !== 'SecurityError' && error.name !== 'NotSupportedError') throw error;
      }
    }
  } else if (handle?.requestPermission && (await handle.requestPermission({mode: 'readwrite'})) !== 'granted') {
    throw Error('Write access was denied. Use Save As to save a copy.');
  }

  const data = await exportBytes();
  if (!handle) {
    download(data, filename);
    saved = current;
    status('Download requested for ' + filename + '.');
    return;
  }

  if (original && await handle.isSameEntry(original.handle)) {
    const latest = await handle.getFile();
    if (latest.lastModified !== original.file.lastModified || latest.size !== original.file.size) {
      throw Error('The file changed outside PDF Studio. Save As to a different file.');
    }
  }
  const stream = await handle.createWritable({mode: 'exclusive'});
  try {
    await stream.write(data);
    await stream.close();
  } catch (error) {
    await stream.abort().catch(() => {});
    throw error;
  }
  // Get a fresh disk snapshot after closing the stream for future conflict checks.
  original = null;
  saved = current;
  filename = core.safeFilename(handle.name);
  original = {handle, file: await handle.getFile()};
  status('Saved ' + filename + '.');
}

const appearanceKey = 'allnote-pdf-theme';
let dark = matchMedia('(prefers-color-scheme: dark)').matches;
try {
  const theme = localStorage.getItem(appearanceKey) || JSON.parse(localStorage.getItem('notepad-workspace-v1'))?.settings?.theme;
  if (theme === 'dark' || theme === 'light') dark = theme === 'dark';
} catch {}
function applyTheme() {
  document.body.toggleAttribute('data-dark', dark);
  $('theme').setAttribute('aria-pressed', String(dark));
}
applyTheme();
$('theme').onclick = () => {
  dark = !dark;
  applyTheme();
  try { localStorage.setItem(appearanceKey, dark ? 'dark' : 'light'); } catch {}
};

$('prev').onclick = () => void run(() => go(page - 1));
$('next').onclick = () => void run(() => go(page + 1));
$('zoom').onchange = () => void run(() => go(page));
$('compression').onchange = () => {
  $('raster-options').hidden = $('compression').value !== 'raster';
};
$('search').onkeydown = event => {
  if (event.key === 'Enter') $('find').click();
};

async function pageText(index, pdf = viewer) {
  const pdfPage = await pdf.getPage(index);
  const content = await pdfPage.getTextContent();
  pdfPage.cleanup();
  return content.items.map(item => (item.str || '') + (item.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+/g, ' ').trimEnd();
}

$('find').onclick = () => void run(async () => {
  const query = $('search').value.trim().toLowerCase();
  if (!query) return;
  for (let step = 1; step <= viewer.numPages; step++) {
    const index = (page - 1 + step) % viewer.numPages + 1;
    if ((await pageText(index)).toLowerCase().includes(query)) {
      await go(index);
      status('Match on page ' + index + '.');
      return;
    }
  }
  status('No matching text.');
});

async function embedImage(doc, file) {
  const data = await fileBytes(file);
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 && data.length >= 24) {
    const dimensions = new DataView(data.buffer);
    if (dimensions.getUint32(16) * dimensions.getUint32(20) > 16000000) {
      throw Error('Use PNG images up to 16 megapixels.');
    }
    return doc.embedPng(data);
  }
  if (data[0] === 0xff && data[1] === 0xd8) return doc.embedJpg(data);
  throw Error('Choose a PNG or JPEG image.');
}

function chooseImages(mode) {
  imageMode = mode;
  $('image-files').multiple = mode === 'convert';
  $('image-files').click();
}

$('images').onclick = () => {
  if (confirmReplacement()) chooseImages('convert');
};
$('image-files').onchange = () => {
  const files = [...$('image-files').files];
  $('image-files').value = '';
  if (!files.length) return;
  void run(async () => {
    checkBatch(files);
    if (imageMode === 'markup') {
      image = files[0];
      setTool('image');
      return;
    }
    const doc = await lib.PDFDocument.create();
    for (const file of files) {
      const embedded = await embedImage(doc, file);
      const scale = Math.min(1, 1200 / Math.max(embedded.width, embedded.height));
      const {width, height} = embedded.scale(scale);
      doc.addPage([width, height]).drawImage(embedded, {width, height, x: 0, y: 0});
    }
    await replaceDocument({data: await doc.save(), password: ''}, 'images.pdf');
  });
};

const toolHelp = {
  text: 'Enter text, then click the page to place it.',
  ink: 'Draw a line on the page with a mouse, pen, or touch.',
  highlight: 'Drag over an area to highlight it.',
  rectangle: 'Drag to draw a rectangle.',
  ellipse: 'Drag to draw an ellipse.',
  image: 'Click the top-left corner where the image should go.',
  signature: 'Sign directly on the page, then select Place signature.',
  redact: 'Draw a rectangle. Review it before exporting a redacted copy.',
  'form-field': 'Draw the bounds for the AcroForm field.'
};
let signature = [];

function setTool(next) {
  tool = next;
  if (next !== 'image') image = null;
  stroke = null;
  signature = [];
  drawDraft();
  for (const button of document.querySelectorAll('[data-tool]')) {
    button.setAttribute('aria-pressed', String(button.dataset.tool === tool));
  }
  if (tool) markup.dataset.tool = tool;
  else delete markup.dataset.tool;
  $('signature-actions').hidden = tool !== 'signature';
  $('finish-signature').disabled = true;
  $('tool-help').textContent = toolHelp[tool] || 'Choose a tool, then place or draw on the page.';
}

for (const button of document.querySelectorAll('[data-tool]')) {
  button.onclick = () => {
    const next = button.dataset.tool;
    if (next === tool) setTool('');
    else if (next === 'image') chooseImages('markup');
    else {
      setTool(next);
      if (next === 'signature') void run(loadSignatureDestinations);
    }
  };
}

function pointerPoint(event) {
  const rect = markup.getBoundingClientRect();
  return [
    Math.min(viewport.width, Math.max(0, (event.clientX - rect.left) * markup.width / rect.width)),
    Math.min(viewport.height, Math.max(0, (event.clientY - rect.top) * markup.height / rect.height))
  ];
}
function selectedColor() {
  const hex = $('color').value;
  return lib.rgb(...[1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255));
}

function fontSize() {
  const input = $('size');
  if (!input.validity.valid) throw Error('Use a size between 6 and 144 pt.');
  return Number(input.value);
}

function drawDraft() {
  const ctx = markup.getContext('2d');
  ctx.clearRect(0, 0, markup.width, markup.height);
  ctx.fillStyle = '#a8353280';
  if (viewport) {
    for (const {box, index, selected} of regions) {
      if (page !== index || !selected) continue;
      ctx.fillRect(box[0] * viewport.width, box[1] * viewport.height,
        (box[2] - box[0]) * viewport.width, (box[3] - box[1]) * viewport.height);
    }
  }
  ctx.strokeStyle = $('color').value;
  ctx.fillStyle = '#ffe16966';
  ctx.lineWidth = 2 * (viewport?.scale || 1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const path of [...signature, ...(stroke ? [stroke] : [])]) {
    const [x, y] = path[0];
    const [endX, endY] = path.at(-1);
    const w = endX - x;
    const h = endY - y;
    ctx.beginPath();
    if (tool === 'rectangle' || tool === 'redact' || tool === 'form-field') ctx.strokeRect(x, y, w, h);
    else if (tool === 'highlight') ctx.fillRect(x, y, w, h);
    else if (tool === 'ellipse') {
      ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.moveTo(x, y);
      for (const point of path) ctx.lineTo(...point);
      ctx.stroke();
    }
  }
}

function textInput() {
  const text = $('annotation').value.trim();
  if (!text) throw Error('Enter text for the annotation or watermark.');
  return text;
}

async function drawMarkup(mode, paths) {
  const doc = await engine.open(current.data);
  const pdfPage = doc.getPage(page - 1);
  const toPdf = ([x, y]) => {
    const [pdfX, pdfY] = viewport.convertToPdfPoint(x, y);
    return {x: pdfX, y: pdfY};
  };
  const color = selectedColor();
  const path = paths[0];
  const start = toPdf(path[0]);
  const rotation = lib.degrees(viewport.rotation);

  if (mode === 'ink' || mode === 'signature') {
    for (const line of paths) {
      for (let i = 1; i < line.length; i++) {
        pdfPage.drawLine({start: toPdf(line[i - 1]), end: toPdf(line[i]), color, thickness: 2, lineCap: lib.LineCapStyle.Round});
      }
    }
  } else if (mode === 'text') {
    const text = textInput();
    const size = fontSize();
    const font = await doc.embedFont(lib.StandardFonts.Helvetica);
    if (font.widthOfTextAtSize(text, size) * viewport.scale > viewport.width - path[0][0]) {
      throw Error('Text exceeds the page edge. Move it left or choose a smaller size.');
    }
    pdfPage.drawText(text, {...start, size, font, color, rotate: rotation});
  } else if (mode === 'image') {
    const embedded = await embedImage(doc, image);
    const width = Math.min(fontSize() * 5, (viewport.width - path[0][0]) / viewport.scale);
    const height = width * embedded.height / embedded.width;
    if (width < 1 || path[0][1] + height * viewport.scale > viewport.height) {
      throw Error('The image exceeds the page edge. Place it higher or choose a smaller size.');
    }
    const origin = toPdf([path[0][0], path[0][1] + height * viewport.scale]);
    pdfPage.drawImage(embedded, {...origin, width, height, rotate: rotation});
  } else {
    const end = toPdf(path.at(-1));
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(start.x - end.x);
    const height = Math.abs(start.y - end.y);
    if (width < 1 || height < 1) return;
    if (mode === 'ellipse') {
      pdfPage.drawEllipse({x: x + width / 2, y: y + height / 2, xScale: width / 2,
        yScale: height / 2, borderColor: color, borderWidth: 2});
    } else {
      const style = mode === 'highlight' ? {color: lib.rgb(1, .85, .18), opacity: .35}
        : {borderColor: color, borderWidth: 2};
      pdfPage.drawRectangle({x, y, width, height, ...style});
    }
  }
  await change(await doc.save());
  status(mode === 'signature' ? 'Signature placed on page ' + page + '.' : 'Markup added to page ' + page + '.');
}

markup.onpointerdown = event => {
  if (!tool || busy || !event.isPrimary || event.button !== 0) return;
  event.preventDefault();
  const point = pointerPoint(event);
  if (tool === 'text' || tool === 'image') {
    void run(() => drawMarkup(tool, [[point]]));
    return;
  }
  stroke = [point];
  markup.setPointerCapture(event.pointerId);
};
markup.onpointermove = event => {
  if (!stroke || !event.isPrimary) return;
  const point = pointerPoint(event);
  if (tool === 'highlight' || tool === 'rectangle' || tool === 'ellipse' || tool === 'redact') {
    stroke[1] = point;
  } else if (stroke.length < 1200) {
    stroke.push(point);
  }
  drawDraft();
};
markup.onpointerup = event => {
  if (!stroke || !event.isPrimary) return;
  const path = [...stroke, pointerPoint(event)];
  stroke = null;
  if (tool === 'redact') {
    const box = rectangle(path[0], path.at(-1), viewport.width, viewport.height);
    if (box[2] - box[0] >= .002 && box[3] - box[1] >= .002) {
      regions.push({index: page, box, selected: true, label: 'Drawn region'});
      renderRegions();
      refreshControls();
    }
  } else if (tool === 'form-field') {
    void run(() => createFormField(path[0], path.at(-1)));
  } else if (tool === 'signature' && signature.length < 30) {
    signature.push(path);
    $('finish-signature').disabled = false;
  } else if (tool !== 'signature') {
    void run(() => drawMarkup(tool, [path]));
  }
  drawDraft();
};
markup.onpointercancel = () => {
  stroke = null;
  drawDraft();
};

$('finish-signature').onclick = () => void run(() => $('signature-field').value
  ? writeSignatureAppearance() : drawMarkup('signature', signature));
$('clear-signature').onclick = () => setTool('signature');

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(Error('Image export failed.')), type, quality));
}

async function rasterize() {
  if (viewer.numPages > 100) throw Error('Raster compression supports up to 100 pages.');
  const doc = await lib.PDFDocument.create();
  const canvas = document.createElement('canvas');
  const scale = Number($('resolution').value) / 72;
  let size = 0;
  for (let index = 1; index <= viewer.numPages; index++) {
    status('Compressing page ' + index + ' of ' + viewer.numPages + '…');
    const pdfPage = await viewer.getPage(index);
    const {width, height} = pdfPage.getViewport({scale: 1});
    await paint(pdfPage, pdfPage.getViewport({scale}), canvas);
    pdfPage.cleanup();
    const blob = await canvasBlob(canvas, 'image/jpeg', Number($('quality').value));
    size += blob.size;
    if (size >= current.data.length) return null;
    const embedded = await doc.embedJpg(await blob.arrayBuffer());
    doc.addPage([width, height]).drawImage(embedded, {x: 0, y: 0, width, height});
  }
  return doc.save();
}

async function compress() {
  const raster = $('compression').value === 'raster';
  if (raster && !confirm('Raster compression removes searchable text, links, and forms. Continue?')) return;
  const oldSize = current.data.length;
  const data = raster ? await rasterize() : await transformPdf(current.data, 'compress');
  if (!data || data.length >= oldSize) {
    status('The compressed PDF was no smaller. Kept the current document.');
    return;
  }
  await change(data);
  const reduction = (100 * (oldSize - data.length) / oldSize).toFixed(1);
  status('Reduced size by ' + reduction + '%.');
}

async function setPassword() {
  const password = await passwordDialog('Set PDF password',
    'A password is required to open the saved PDF. Keep a copy of the password.', true);
  if (password === null || password === current.password) return;
  await exportBytes(current.data, password);
  await change(current.data, {password});
  status('Password set. Save the PDF to apply it to a file.');
}

async function removePassword() {
  const password = await passwordDialog('Remove PDF password',
    'Enter the current PDF password to save an unprotected copy.');
  if (password === null) return;
  if (password !== current.password) throw Error('The current PDF password did not match.');
  await change(current.data, {password: ''});
  status('Password removed. Save the PDF to apply the change.');
}

async function coordinateMarkup(watermark) {
  const text = textInput();
  const size = fontSize();
  const x = $('x').valueAsNumber;
  const y = $('y').valueAsNumber;
  const doc = await engine.open(current.data);
  const font = await doc.embedFont(lib.StandardFonts.Helvetica);
  const indices = watermark ? core.pageRange($('range').value, doc.getPageCount()) : [page - 1];
  for (const index of new Set(indices)) {
    const pdfPage = await viewer.getPage(index + 1);
    const view = pdfPage.getViewport({scale: 1});
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || y > view.height ||
        x + font.widthOfTextAtSize(text, size) > view.width) {
      throw Error('Text exceeds page bounds.');
    }
    const [pdfX, pdfY] = view.convertToPdfPoint(x, view.height - y);
    doc.getPage(index).drawText(text, {x: pdfX, y: pdfY, size, font, color: selectedColor(),
      opacity: watermark ? .25 : 1, rotate: lib.degrees(view.rotation + (watermark ? 30 : 0))});
  }
  await change(await doc.save());
  status(watermark ? 'Watermark added.' : 'Text added.');
}

async function exportPage(extension) {
  if (current.password && !confirm('Export this page as an unprotected image?')) return;
  const canvas = document.createElement('canvas');
  const pdfPage = await viewer.getPage(page);
  await paint(pdfPage, pdfPage.getViewport({scale: 1.5}), canvas);
  pdfPage.cleanup();
  const type = extension === 'png' ? 'image/png' : 'image/jpeg';
  download(await canvasBlob(canvas, type, .9), stem() + '-' + page + '.' + extension, type);
  status('Image download requested.');
}

async function exportText() {
  if (current.password && !confirm('Export the text to an unprotected file?')) return;
  const chunks = [];
  for (let index = 1; index <= viewer.numPages; index++) chunks.push(await pageText(index));
  download(chunks.join('\n\n'), stem() + '.txt', 'text/plain;charset=utf-8');
  status('Text download requested.');
}

async function splitPages() {
  const indices = [...new Set(core.pageRange($('range').value, viewer.numPages))];
  if (indices.length > 20) throw Error('Select up to 20 pages per split.');
  const parts = [];
  for (const index of indices) {
    const part = await engine.extract(current.data, String(index + 1));
    parts.push(await exportBytes(part));
  }
  for (const [i, part] of parts.entries()) download(part, stem() + '-page-' + (indices[i] + 1) + '.pdf');
  status('Split downloads requested.');
}

let ocrResults = [];
let regions = [];
const ignoredText = new Set();
let intelligenceTask = null;

function selectedPages() {
  return $('intelligence-scope').value === 'all'
    ? Array.from({length: viewer.numPages}, (_, i) => i + 1)
    : [...new Set(core.pageRange($('range').value, viewer.numPages).map(i => i + 1))];
}

async function intelligenceOperation(task) {
  intelligenceTask = new AbortController();
  $('cancel-intelligence').hidden = false;
  try {
    await task(intelligenceTask.signal);
  } finally {
    intelligenceTask = null;
    $('cancel-intelligence').hidden = true;
  }
}
$('cancel-intelligence').onclick = () => {
  intelligenceTask?.abort();
  status('Processing canceled.');
};

async function renderPixels(index, scale, pdf = viewer, signal) {
  const pdfPage = await pdf.getPage(index);
  const unit = pdfPage.getViewport({scale: 1});
  const fit = Math.min(scale, 4096 / unit.width, 4096 / unit.height,
    Math.sqrt(11_900_000 / (unit.width * unit.height)));
  const view = pdfPage.getViewport({scale: fit});
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(view.width);
  canvas.height = Math.ceil(view.height);
  signal?.throwIfAborted();
  const task = pdfPage.render({canvas, viewport: view, annotationMode: pdfjs.AnnotationMode.DISABLE});
  const cancel = () => task.cancel();
  signal?.addEventListener('abort', cancel, {once: true});
  try {
    await task.promise;
    return {canvas, width: unit.width, height: unit.height};
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
    pdfPage.cleanup();
  }
}

async function recognizeScans() {
  await intelligenceOperation(async signal => {
    const selected = selectedPages();
    if (selected.length > 100) throw Error('Process up to 100 pages per OCR run.');
    const scans = [];
    status('Checking for existing text layers…');
    for (const index of selected) {
      signal.throwIfAborted();
      if (!(await pageText(index)).trim()) scans.push(index);
    }
    if (!scans.length) {
      status('The selected pages already contain searchable text.');
      return;
    }
    status('Loading local OCR language data…');
    const results = await recognizePages(scans, $('ocr-language').value,
      async index => (await renderPixels(index, 2, viewer, signal)).canvas, signal,
      index => status('Recognizing page ' + index + '…'));
    ocrResults = [...ocrResults.filter(result => !scans.includes(result.index)), ...results]
      .sort((a, b) => a.index - b.index);
    $('ocr-confidence').textContent = ocrResults.map(result => 'Page ' + result.index + ' · ' +
      Math.round(result.confidence) + '%').join(', ');
    status('Recognized ' + results.length + ' scanned page(s). Review the text before relying on it.');
  });
}

async function addSearchLayer() {
  const data = await searchablePDF(lib, engine, current.data, ocrResults,
    async index => (await viewer.getPage(index)).getViewport({scale: 1}));
  await change(data);
  status('Searchable text added. Save to keep the OCR text layer.');
}

function ocrText() {
  return ocrResults.map(result => result.text.trimEnd()).join('\n\n');
}

function openOcrInNotes() {
  if (!confirm('Open the extracted text in Notes? Notes stores drafts in this browser.')) return;
  try {
    sessionStorage.setItem('allnote-ocr-transfer', JSON.stringify({name: stem() + '-ocr.txt', text: ocrText()}));
  } catch {
    throw Error('The extracted text could not be transferred. Use OCR text file instead.');
  }
  location.assign('index.html');
}

async function nativeRegions(index) {
  const pdfPage = await viewer.getPage(index);
  const view = pdfPage.getViewport({scale: 1});
  const content = await pdfPage.getTextContent();
  const rows = [];
  let line;
  for (const item of content.items) {
    if (!item.str?.trim()) {
      if (item.hasEOL) line = null;
      continue;
    }
    const [a, b, c, d, x, y] = item.transform;
    const magnitude = Math.hypot(a, b);
    const vertical = Math.hypot(c, d);
    if (!magnitude || !vertical || item.width <= 0) continue;
    const endX = x + a * item.width / magnitude;
    const endY = y + b * item.width / magnitude;
    const points = [
      [x - c * .35, y - d * .35], [x + c * 1.25, y + d * 1.25],
      [endX - c * .35, endY - d * .35], [endX + c * 1.25, endY + d * 1.25]
    ].map(point => view.convertToViewportPoint(...point));
    const min = [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1]))];
    const max = [Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))];
    const box = rectangle(min, max, view.width, view.height);
    if (box[0] === box[2] || box[1] === box[3]) continue;
    if (!line || line.text.length + item.str.length > 4000) {
      line = {index, text: item.str.slice(0, 4000), box};
      rows.push(line);
    } else {
      line.text += ' ' + item.str;
      line.box = [Math.min(line.box[0], box[0]), Math.min(line.box[1], box[1]),
        Math.max(line.box[2], box[2]), Math.max(line.box[3], box[3])];
    }
    if (item.hasEOL) line = null;
  }
  pdfPage.cleanup();
  return rows;
}

function detectRows(rows, query, signal) {
  let masking = {};
  try {
    masking = JSON.parse(localStorage.getItem('notepad-workspace-v1'))?.settings?.masking || {};
  } catch {}
  const selected = new Set([...$('pi-categories').selectedOptions].map(option => option.value));
  const disabled = [...new Set([
    ...(Array.isArray(masking.disabled) ? masking.disabled : []),
    ...[...$('pi-categories').options].map(option => option.value).filter(kind => !selected.has(kind))
  ])];
  const fields = Array.isArray(masking.fields) ? masking.fields.filter(item => typeof item === 'string') : [];
  const custom = $('pi-rules').value.split(/\r?\n/).map(rule => rule.trim()).filter(Boolean);
  if (custom.length > 12 || custom.some(rule => rule.length > 200)) throw Error('Use up to 12 rules of 200 characters.');
  try { localStorage.setItem('allnote-pdf-custom-pi', JSON.stringify(custom)); } catch {}
  return new Promise((resolve, reject) => {
    const worker = new Worker(asset('pdf-pi-worker.js'));
    const stop = () => finish(reject, new DOMException('Detection canceled', 'AbortError'));
    const timer = setTimeout(() => finish(reject, Error('Detection timed out. Review the custom expressions.')), 12000);
    function finish(callback, value) {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      worker.terminate();
      callback(value);
    }
    signal.addEventListener('abort', stop, {once: true});
    worker.onerror = () => finish(reject, Error('The local detection worker could not start.'));
    worker.onmessage = ({data}) => data.error ? finish(reject, Error(data.error)) : finish(resolve, data.matches);
    worker.postMessage({rows: rows.map(row => row.text), options: {disabled, fields}, custom, query});
  });
}

async function scanRegions(query) {
  await intelligenceOperation(async signal => {
    const rows = [];
    for (const index of selectedPages()) {
      signal.throwIfAborted();
      status('Inspecting text on page ' + index + '…');
      const native = await nativeRegions(index);
      rows.push(...native);
      if (!native.length) {
        const result = ocrResults.find(item => item.index === index);
        if (result) rows.push(...result.rows.map(row => ({...row, index})));
      }
      if (rows.length > 40000) throw Error('Scan fewer pages. The selection exceeds 40,000 text regions.');
    }
    signal.throwIfAborted();
    const matches = await detectRows(rows, query, signal);
    if (matches.length > 2000) throw Error('Too many matches. Use a narrower page range or search.');
    for (const {index, label} of matches) {
      const {text, ...row} = rows[index];
      if (ignoredText.has(text)) continue;
      regions.push({...row, text, selected: true, label});
    }
    renderRegions();
    drawDraft();
    status(matches.length + ' region(s) found. Review placement before export.');
  });
}

function renderRegions() {
  const list = $('redaction-regions');
  list.replaceChildren();
  for (const region of regions) {
    const item = document.createElement('li');
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = region.selected;
    check.setAttribute('aria-label', 'Include region on page ' + region.index);
    check.onchange = () => {
      region.selected = check.checked;
      refreshControls();
      drawDraft();
    };
    const button = document.createElement('button');
    button.textContent = 'Page ' + region.index + ' · ' + region.label +
      (Number.isFinite(region.confidence) ? ' · OCR ' + Math.round(region.confidence) + '%' : '');
    button.onclick = () => void run(() => go(region.index));
    item.append(check, button);
    if (region.text) {
      const ignore = document.createElement('button');
      ignore.textContent = 'Ignore text';
      ignore.title = 'Ignore this exact text in this document until it changes';
      ignore.onclick = () => {
        ignoredText.add(region.text);
        regions = regions.filter(candidate => candidate.text !== region.text);
        renderRegions();
        refreshControls();
        drawDraft();
      };
      item.append(ignore);
    }
    list.append(item);
  }
  $('select-regions').disabled = !regions.length;
  $('clear-regions').disabled = !regions.length;
}
$('select-regions').onclick = () => {
  for (const region of regions) region.selected = true;
  renderRegions();
  refreshControls();
  drawDraft();
};
$('clear-regions').onclick = () => {
  regions = [];
  renderRegions();
  refreshControls();
  drawDraft();
};
try {
  const custom = JSON.parse(localStorage.getItem('allnote-pdf-custom-pi'));
  if (Array.isArray(custom)) $('pi-rules').value = custom.join('\n');
} catch {}

async function fingerprint(data) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

function parseReview(review) {
  if (!review || review.version !== 1 || !/^[a-f0-9]{64}$/.test(review.sha256) ||
      !Number.isInteger(review.pages) || review.pages < 1 || review.pages > core.MAX_PAGES ||
      !/^#[a-f0-9]{6}$/i.test(review.color) || !Array.isArray(review.regions) ||
      !review.regions.length || review.regions.length > 2000) throw Error('Invalid redaction plan.');
  for (const {index, box} of review.regions) {
    if (!Number.isInteger(index) || index < 1 || index > review.pages || !Array.isArray(box) ||
        box.length !== 4 || box.some(point => !Number.isFinite(point) || point < 0 || point > 1) ||
        box[0] >= box[2] || box[1] >= box[3]) throw Error('Invalid redaction coordinates.');
  }
  return review;
}

async function exportReview() {
  const selected = regions.filter(region => region.selected).map(({index, box}) => ({index, box}));
  if (!confirm('Export the reviewed regions? The plan contains positions and a document fingerprint.')) return;
  const review = parseReview({version: 1, pages: viewer.numPages, sha256: await fingerprint(current.data),
    color: $('redaction-color').value, regions: selected});
  download(JSON.stringify(review, null, 2), stem() + '-redaction-plan.json', 'application/json');
}

async function exportRaster(redacting) {
  const selected = redacting ? regions.filter(region => region.selected) : [];
  if (redacting && !selected.length) throw Error('Select at least one redaction region.');
  if (!confirm('Create a new PDF from page pixels? Searchable text, annotations, forms, metadata and attachments will be discarded. Review the result for any sensitive pixels.')) return;
  await intelligenceOperation(async signal => {
    const data = await rasterRedact(lib, viewer.numPages, index => renderPixels(index, 2, viewer, signal), selected,
      $('redaction-color').value, signal, index => status('Reconstructing page ' + index + '…'), core.MAX_BYTES);
    signal.throwIfAborted();
    download(await exportBytes(data), stem() + (redacting ? '-redacted.pdf' : '-pixels.pdf'));
    sanitizationResult = {mode: 'pixel reconstruction', pages: viewer.numPages, selectedRegions: selected.length,
      discarded: ['Source metadata and XMP', 'Text and OCR layers', 'Attachments', 'Annotations',
        'AcroForm and XFA objects', 'Document JavaScript and actions', 'Link objects', 'Prior revisions', 'Bookmarks'],
      remaining: ['Visible pixels outside selected regions may contain sensitive information. Review every page.']};
    status('Raster PDF download requested. Review all pages before sharing.');
  });
}

let propertiesLoaded = false;
let sanitizationResult = null;
let bookmarkTree = null;
let pickedBookmark = null;
let warnedSignature = false;

async function exportMetadataRemoved() {
  const selections = new Set([...$('sanitize-options').querySelectorAll('input:checked')].map(input => input.value));
  if (!selections.size) throw Error('Select at least one sanitization option.');
  if (!confirm('Export a rewritten copy? Unselected structures, visible page content and private values in other structures can remain.')) return;
  await intelligenceOperation(async signal => {
    const result = await scrubPdf(lib, engine, current.data, selections, signal);
    const bytes = await transformPdf(result.data, 'rewrite', '', signal);
    download(await exportBytes(bytes), stem() + '-sanitized.pdf');
    sanitizationResult = {mode: 'selected standard structures', removed: result.counts,
      remaining: ['Unselected structures and proprietary keys can remain.',
        'Page pixels and content are retained. Use pixel reconstruction for permanent redaction.',
        'Counts describe removed objects or references and do not certify the absence of hidden data.']};
    status('Sanitized copy requested. Review the report and output before sharing.');
  });
}

async function inspectProperties() {
  const doc = await engine.open(current.data);
  const container = $('property-fields');
  container.replaceChildren();
  for (const [index, [title, get]] of properties.entries()) {
    const raw = doc[get]();
    const label = document.createElement('label');
    label.textContent = title;
    const input = document.createElement('input');
    input.id = 'property-value-' + index;
    input.maxLength = 1500;
    input.defaultValue = raw instanceof Date ? raw.toISOString() : raw || '';
    label.append(input);
    container.append(label);
  }
  const {info, metadata} = await viewer.getMetadata();
  const marks = await viewer.getMarkInfo();
  const structure = await (await viewer.getPage(page)).getStructTree();
  const language = doc.catalog.lookup(lib.PDFName.of('Lang'));
  const decoded = language?.decodeText?.() || '';
  $('accessibility-info').textContent = 'Language ' + (decoded || 'missing') +
    ' · Tagged PDF ' + (marks?.Marked ? 'yes' : 'no') +
    ' · Current page structure ' + (structure ? 'present' : 'unavailable') +
    (info.IsXFAPresent ? ' · XFA unsupported' : '');
  const rawXmp = metadata?.getRaw();
  const xmp = $('xmp-info');
  xmp.value = rawXmp?.slice(0, 8000) || '';
  $('xmp-replace').disabled = false;
  if (rawXmp?.length > 8000) $('accessibility-info').textContent += ' · Showing first 8,000 XMP characters';
  propertiesLoaded = true;
  status('Document properties inspected.');
}

async function saveProperties() {
  const doc = await engine.open(current.data);
  for (const [index, [title, get, set]] of properties.entries()) {
    const input = $('property-value-' + index);
    if (!input || input.defaultValue === input.value) continue;
    const value = input.value.trim();
    const originalValue = doc[get]();
    if (originalValue === value || originalValue instanceof Date && originalValue.toISOString() === value) continue;
    if (title.endsWith('date')) {
      if (!value) {
        doc.getInfoDict().delete(lib.PDFName.of(index === 6 ? 'CreationDate' : 'ModDate'));
      } else {
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) throw Error('Enter a valid ISO date for ' + title + '.');
        doc[set](date);
      }
    } else if (title === 'Keywords') doc[set](value ? value.split(/[,;]+/).map(word => word.trim()) : []);
    else doc[set](value);
  }
  if ($('xmp-replace').checked) replaceXmp(doc);
  await change(await doc.save());
  await inspectProperties();
  status('Document properties updated.');
}

function replaceXmp(doc) {
  const xml = document.implementation.createDocument('adobe:ns:meta/', 'x:xmpmeta');
  const rdf = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
  const dc = 'http://purl.org/dc/elements/1.1/';
  const xmp = 'http://ns.adobe.com/xap/1.0/';
  const pdf = 'http://ns.adobe.com/pdf/1.3/';
  function element(parent, namespace, tag, value) {
    const node = xml.createElementNS(namespace, tag);
    if (value) node.textContent = value;
    parent.appendChild(node);
    return node;
  }
  const root = element(xml.documentElement, rdf, 'rdf:RDF');
  const description = element(root, rdf, 'rdf:Description');
  description.setAttributeNS(rdf, 'rdf:about', '');
  for (const [tag, kind, value] of [['title','Alt',doc.getTitle()], ['description','Alt',doc.getSubject()],
    ['creator','Seq',doc.getAuthor()]]) {
    if (!value) continue;
    const entry = element(description, dc, 'dc:' + tag);
    const values = element(entry, rdf, 'rdf:' + kind);
    const item = element(values, rdf, 'rdf:li', value);
    if (kind === 'Alt') item.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:lang', 'x-default');
  }
  for (const [namespace, tag, value] of [[pdf, 'pdf:Keywords', doc.getKeywords()],
    [pdf, 'pdf:Producer', doc.getProducer()], [xmp, 'xmp:CreatorTool', doc.getCreator()],
    [xmp, 'xmp:CreateDate', doc.getCreationDate()?.toISOString()],
    [xmp, 'xmp:ModifyDate', doc.getModificationDate()?.toISOString()]]) {
    if (value) element(description, namespace, tag, value);
  }
  const data = new TextEncoder().encode(new XMLSerializer().serializeToString(xml));
  const stream = doc.context.stream(data, {Type: 'Metadata', Subtype: 'XML'});
  doc.catalog.set(lib.PDFName.of('Metadata'), doc.context.register(stream));
}

function readFormData(form) {
  return Object.fromEntries(form.getFields().map(field => [field.getName(), readField(lib, field)]));
}

async function inspectForm() {
  const form = pdfForm(lib, await engine.open(current.data));
  $('form-data').value = JSON.stringify(readFormData(form), null, 2);
  drawFormControls(form);
  status(form.getFields().length + ' AcroForm field(s) loaded.');
}

function drawFormControls(form) {
  const container = $('form-controls');
  container.replaceChildren();
  for (const field of form.getFields().slice(0, 200)) {
    const kind = formFieldType(lib, field);
    const label = document.createElement('label');
    const name = field.getName();
    const value = readField(lib, field);
    label.textContent = name;
    let input;
    if (kind === 'checkbox' || kind === 'text') {
      input = document.createElement('input');
      input.type = kind;
      if (kind === 'checkbox') input.checked = value;
      else {
        input.value = value;
        input.maxLength = Math.min(10000, field.getMaxLength() ?? 10000);
      }
    } else if (['radio', 'dropdown', 'list'].includes(kind)) {
      input = document.createElement('select');
      input.multiple = kind !== 'radio' && field.isMultiselect();
      if (!input.multiple) input.add(new Option('Empty', ''));
      const selected = Array.isArray(value) ? value : [value];
      for (const choice of field.getOptions()) input.add(new Option(choice, choice, false, selected.includes(choice)));
    } else {
      label.append(document.createTextNode(' · Read-only ' + kind + ' field'));
      container.append(label);
      continue;
    }
    input.disabled = field.isReadOnly();
    input.onchange = () => {
      try {
        const data = parseForm($('form-data').value);
        data[name] = kind === 'checkbox' ? input.checked :
          input.multiple ? [...input.selectedOptions].map(option => option.value) : input.value;
        $('form-data').value = JSON.stringify(data, null, 2);
      } catch { status('Fix the form JSON before changing field values.'); }
    };
    label.append(input);
    container.append(label);
  }
}

function parseForm(value) {
  if (typeof value !== 'string' || value.length > 200000) throw Error('Form data exceeds the limit.');
  let data;
  try { data = JSON.parse(value); } catch { throw Error('Enter valid form JSON.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('Form data must be a JSON object.');
  return data;
}

async function applyForm(data) {
  const doc = await engine.open(current.data);
  const form = pdfForm(lib, doc);
  const fields = new Map(form.getFields().map(field => [field.getName(), field]));
  for (const [name, value] of Object.entries(data)) {
    const field = fields.get(name);
    if (!field) throw Error('Form data refers to an unknown field.');
    if (field.isReadOnly()) {
      if (JSON.stringify(value) !== JSON.stringify(readField(lib, field))) throw Error('A read-only field was changed.');
      continue;
    }
    setField(lib, field, value);
  }
  await change(await doc.save());
  await inspectForm();
  status('Form data updated.');
}

async function exportForm() {
  if (current.password && !confirm('Download the form fields as unprotected JSON?')) return;
  const data = readFormData(pdfForm(lib, await engine.open(current.data)));
  download(JSON.stringify(data, null, 2), stem() + '-form.json', 'application/json');
}

$('form-json-file').onchange = () => {
  const [file] = $('form-json-file').files;
  $('form-json-file').value = '';
  if (!file) return;
  void run(async () => {
    if (file.size > 200000) throw Error('Form data exceeds the limit.');
    await applyForm(parseForm(await file.text()));
  });
};

async function flattenForm() {
  if (!confirm('Flatten the form into page content? Use Undo to reverse this before saving.')) return;
  const doc = await engine.open(current.data);
  const form = pdfForm(lib, doc);
  if (!form.getFields().length) throw Error('No form fields to flatten.');
  if (form.getFields().some(field => formFieldType(lib, field) === 'signature')) {
    throw Error('Forms with signature fields cannot be flattened here.');
  }
  form.flatten();
  await change(await doc.save());
  status('Form fields flattened into the pages.');
}

async function resetForm() {
  if (!confirm('Clear editable field values? Use Undo to restore them before saving.')) return;
  const form = pdfForm(lib, await engine.open(current.data));
  const values = new Map([['text', ''], ['checkbox', false], ['radio', ''], ['dropdown', []], ['list', []]]);
  return applyForm(Object.fromEntries(form.getFields().flatMap(field => {
    const type = formFieldType(lib, field);
    return !field.isReadOnly() && values.has(type) ? [[field.getName(), values.get(type)]] : [];
  })));
}

function signatureWidgets(field, target) {
  const annotationDicts = new Set();
  const annotations = target.node.Annots();
  if (annotations) {
    for (let i = 0; i < annotations.size(); i++) annotationDicts.add(annotations.lookup(i));
  }
  return field.acroField.getWidgets().filter(widget => annotationDicts.has(widget.dict));
}

async function loadSignatureDestinations() {
  const select = $('signature-field');
  select.replaceChildren(new Option('Page markup', ''));
  const doc = await engine.open(current.data);
  const formDict = doc.catalog.lookupMaybe(lib.PDFName.of('AcroForm'), lib.PDFDict);
  if (!formDict || formDict.has(lib.PDFName.of('XFA'))) return;
  const target = doc.getPage(page - 1);
  for (const field of pdfForm(lib, doc).getFields()) {
    if (field instanceof lib.PDFSignature && !field.isReadOnly() &&
        !field.acroField.dict.has(lib.PDFName.of('V')) && signatureWidgets(field, target).length) {
      select.add(new Option(field.getName(), field.getName()));
    }
  }
}

async function writeSignatureAppearance() {
  const doc = await engine.open(current.data);
  const field = pdfForm(lib, doc).getFieldMaybe($('signature-field').value);
  if (!(field instanceof lib.PDFSignature) || field.isReadOnly() ||
      field.acroField.dict.has(lib.PDFName.of('V'))) throw Error('Only unsigned signature widgets are available.');
  const [widget] = signatureWidgets(field, doc.getPage(page - 1));
  if (!widget) throw Error('The signature widget is on a different page.');
  const {width, height} = widget.getRectangle();
  const points = signature.flat();
  const left = Math.min(...points.map(point => point[0]));
  const top = Math.min(...points.map(point => point[1]));
  const sourceWidth = Math.max(...points.map(point => point[0])) - left;
  const sourceHeight = Math.max(...points.map(point => point[1])) - top;
  if (sourceWidth < 1 && sourceHeight < 1) throw Error('Draw a signature before placing it.');
  if (width < 8 || height < 8 || width > 4096 || height > 4096) throw Error('Unsupported signature widget bounds.');
  const factor = Math.min((width - 6) / Math.max(1, sourceWidth), (height - 6) / Math.max(1, sourceHeight));
  const offsetX = (width - sourceWidth * factor) / 2;
  const offsetY = (height - sourceHeight * factor) / 2;
  const coordinates = point => [offsetX + (point[0] - left) * factor,
    height - offsetY - (point[1] - top) * factor];
  const color = selectedColor();
  const operators = [lib.setLineWidth(1.8), lib.setLineCap(lib.LineCapStyle.Round),
    lib.setStrokingRgbColor(color.red, color.green, color.blue)];
  for (const path of signature) {
    operators.push(lib.moveTo(...coordinates(path[0])));
    for (const point of path.slice(1)) operators.push(lib.lineTo(...coordinates(point)));
    operators.push(lib.stroke());
  }
  const appearance = doc.context.formXObject(operators, {BBox: [0, 0, width, height]});
  widget.setNormalAppearance(doc.context.register(appearance));
  await change(await doc.save({updateFieldAppearances: false}));
  status('Handwriting placed in the unsigned widget as a visual appearance.');
}

async function createFormField(first, last) {
  const doc = await engine.open(current.data);
  const form = pdfForm(lib, doc);
  const name = $('field-name').value.trim();
  const kind = $('field-kind').value;
  if (!name) throw Error('Enter a unique field name.');
  if (form.getFieldMaybe(name)) throw Error('This field name is already in use.');
  const [x1, y1] = viewport.convertToPdfPoint(...first);
  const [x2, y2] = viewport.convertToPdfPoint(...last);
  const box = {x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1)};
  if (box.width < 10 || box.height < 10) throw Error('Draw a larger field area.');
  const target = doc.getPage(page - 1);
  const options = [...new Set($('field-options').value.split(/\r?\n/).map(word => word.trim()).filter(Boolean))];
  if (['radio', 'dropdown', 'list'].includes(kind) && (!options.length || options.length > 20)) {
    throw Error('Enter between 1 and 20 distinct choices.');
  }
  if (kind === 'signature') {
    if (!/^[a-z0-9_-]+$/i.test(name)) throw Error('Use letters, numbers, hyphens or underscores for a signature field.');
    const widget = doc.context.obj({Type: 'Annot', Subtype: 'Widget', FT: 'Sig',
      T: lib.PDFHexString.fromText(name), P: target.ref, F: 4,
      Rect: [box.x, box.y, box.x + box.width, box.y + box.height]});
    const reference = doc.context.register(widget);
    form.acroForm.addField(reference);
    target.node.addAnnot(reference);
  } else if (kind === 'radio') {
    const group = form.createRadioGroup(name);
    const height = box.height / options.length;
    if (height < 10) throw Error('Draw a taller area for the radio options.');
    options.forEach((choice, index) => group.addOptionToPage(choice, target,
      {...box, y: box.y + box.height - (index + 1) * height, width: Math.min(height, box.width), height}));
  } else {
    const create = {text: 'createTextField', checkbox: 'createCheckBox', dropdown: 'createDropdown', list: 'createOptionList'};
    const field = form[create[kind]](name);
    if (kind === 'dropdown' || kind === 'list') field.setOptions(options);
    field.addToPage(target, box);
  }
  await change(await doc.save());
  await inspectForm();
  status('Form field added.');
}

async function inspectBookmarks() {
  bookmarkTree = await treeFromOutline(viewer);
  pickedBookmark = null;
  drawBookmarks();
  status('Bookmarks loaded.');
}

function drawBookmarks() {
  const root = $('bookmark-list');
  root.replaceChildren();
  function append(items, list) {
    for (const node of items) {
      const entry = document.createElement('li');
      const button = document.createElement('button');
      button.textContent = node.title;
      button.setAttribute('aria-pressed', String(pickedBookmark?.node === node));
      button.onclick = () => void run(async () => {
        pickedBookmark = {node, items};
        $('bookmark-title').value = node.title;
        if (node.index) await go(node.index);
        drawBookmarks();
      });
      entry.append(button);
      if (node.children.length) {
        const children = document.createElement('ol');
        append(node.children, children);
        entry.append(children);
      }
      list.append(entry);
    }
  }
  append(bookmarkTree, root);
}

async function editBookmarks(op) {
  if (!bookmarkTree || op !== 'add' && !pickedBookmark) return;
  const title = $('bookmark-title').value.trim();
  if (['add','nest','rename'].includes(op) && !title) throw Error('Enter a bookmark title.');
  const tree = structuredClone(bookmarkTree);
  const locate = (before, after) => {
    for (const [index, node] of before.entries()) {
      if (node === pickedBookmark?.node) return {items: after, index};
      const child = locate(node.children, after[index].children);
      if (child) return child;
    }
    return null;
  };
  const match = locate(bookmarkTree, tree);
  const target = match?.items[match.index];
  const node = {title, index: page, children: []};
  if (op === 'add') tree.push(node);
  if (op === 'nest') target.children.push(node);
  if (op === 'rename') target.title = title;
  if (op === 'remove') match.items.splice(match.index, 1);
  if (op === 'move' && match.index > 0) {
    match.items.splice(match.index, 1);
    match.items.splice(match.index - 1, 0, target);
  }
  const doc = await engine.open(current.data);
  writeOutline(lib, doc, tree);
  await change(await doc.save());
  await inspectBookmarks();
  status('Bookmarks updated.');
}

let editBlocks = [];
const editSelector = $('editable-block');
function resetEditBlocks() {
  editBlocks = [];
  editSelector.replaceChildren(new Option('Select a text block', ''));
}
editSelector.onchange = () => {
  const block = editSelector.value && editBlocks[Number(editSelector.value)];
  if (block) {
    $('editable-value').value = block.text;
    $('editable-font').value = block.font;
    $('editable-size').value = block.size;
    $('editable-color').value = block.color;
    $('editable-x').value = block.x;
    $('editable-y').value = block.y;
    $('editable-align').value = 'left';
  }
  refreshControls();
};
async function findEditBlocks() {
  resetEditBlocks();
  editBlocks = await listEditableText(lib, await engine.open(current.data), page - 1);
  editBlocks.forEach(block => editSelector.add(new Option(block.text, String(block.id))));
  status(editBlocks.length ? 'Choose an existing text block.' :
    'No supported text blocks. Rotated, subset-font, complex and multiline blocks are unavailable.');
}
async function applyTextEdit() {
  const text = $('editable-value').value;
  if (!text && !confirm('Delete the selected text block?')) return;
  const doc = await engine.open(current.data);
  await change(await rewriteText(lib, doc, page - 1, Number(editSelector.value), {
    text, font: $('editable-font').value, color: $('editable-color').value,
    x: $('editable-x').valueAsNumber, y: $('editable-y').valueAsNumber,
    size: $('editable-size').valueAsNumber, align: $('editable-align').value
  }));
  status('Existing text updated. Review the preview before saving.');
}

const workspaceView = document.querySelector('.pdf-body');
let comparison = null;
let comparisonIndex = 0;
let comparisonImages = null;

function workspace(which) {
  workspaceView.hidden = Boolean(which);
  $('compare-workspace').hidden = which !== 'compare';
  $('batch-workspace').hidden = which !== 'batch';
  document.querySelector('.studio-toolbar').hidden = Boolean(which);
}

$('compare-input').onchange = () => {
  const [file] = $('compare-input').files;
  $('compare-input').value = '';
  if (!file) return;
  void run(async () => {
    const state = await openedState(await fileBytes(file));
    const other = readPdf(state.data);
    try {
      const rightPdf = await other.promise;
      const signal = AbortSignal.timeout(45000);
      status('Reading both documents for comparison…');
      const left = await inspectPdf(viewer, signal);
      const right = await inspectPdf(rightPdf, signal);
      const pairs = alignPages(left.pages, right.pages);
      comparison = {pairs, rightPdf, task: other, report: comparisonSummary(left, right, pairs),
        protected: Boolean(current.password || state.password)};
      comparisonIndex = 0;
      workspace('compare');
      await showComparison();
    } catch (error) {
      comparison = null;
      workspace('');
      await other.destroy();
      throw error;
    }
  });
};

$('compare-close').onclick = () => void run(async () => {
  const previous = comparison;
  comparison = comparisonImages = null;
  for (const canvas of $('compare-pages').querySelectorAll('canvas')) canvas.width = canvas.height = 0;
  workspace('');
  await previous.task.destroy();
});

function diffInWorker(left, right) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(asset('diff-worker.js'));
    const finish = (fn, value) => { clearTimeout(timer); worker.terminate(); fn(value); };
    const timer = setTimeout(() => finish(reject, Error('Text comparison timed out.')), 12000);
    worker.onerror = () => finish(reject, Error('The comparison worker could not start.'));
    worker.onmessage = ({data}) => data.error ? finish(reject, Error(data.error)) : finish(resolve, data.result);
    worker.postMessage({action: 'pdf-patch', left, right});
  });
}

async function showComparison() {
  const pair = comparison.pairs[comparisonIndex];
  const before = pair.left?.index;
  const after = pair.right?.index;
  const size = Math.round(600 * Number($('compare-zoom').value));
  comparisonImages = [
    await renderComparison(viewer, before, size, pdfjs),
    await renderComparison(comparison.rightPdf, after, size, pdfjs)
  ];
  for (const [id, image] of [['compare-before', comparisonImages[0]], ['compare-after', comparisonImages[1]]]) {
    const canvas = $(id);
    canvas.width = canvas.height = size;
    canvas.getContext('2d').drawImage(image, 0, 0);
  }
  drawComparison();
  $('compare-page').textContent = (comparisonIndex + 1) + ' / ' + comparison.pairs.length +
    ' · pages ' + (before || '—') + ' → ' + (after || '—');
  $('compare-prev').disabled = comparisonIndex === 0;
  $('compare-next').disabled = comparisonIndex + 1 >= comparison.pairs.length;
  const left = pair.left?.text || '';
  const right = pair.right?.text || '';
  const result = await diffInWorker(left, right);
  $('compare-text').textContent = result || 'No text changes.';
  status('Comparison ready.');
}

function drawComparison() {
  if (!comparisonImages) return;
  const mode = $('compare-mode').value;
  $('compare-pages').dataset.mode = mode;
  const after = $('compare-after');
  const mix = Number($('compare-mix').value);
  after.style.opacity = mode === 'overlay' ? mix / 100 : 1;
  after.style.clipPath = mode === 'slider' ? 'inset(0 ' + (100 - mix) + '% 0 0)' : '';
  const threshold = Number($('compare-threshold').value);
  const ratio = difference(...comparisonImages, $('compare-diff'), threshold);
  const pageResult = comparison.report.pages[comparisonIndex];
  pageResult.visualChanges = {ratio, threshold};
  const changed = Object.entries(comparison.report.structural).filter(([, value]) => value).map(([name]) => name);
  $('compare-summary').textContent = (ratio * 100).toFixed(2) + '% changed pixels on this pair. ' +
    'Document changes · ' + (changed.join(', ') || 'No structural differences detected.');
}

for (const [id, delta] of [['compare-prev', -1], ['compare-next', 1]]) {
  $(id).onclick = () => void run(async () => {
    const next = comparisonIndex + delta;
    if (next < 0 || next >= comparison.pairs.length) return;
    comparisonIndex = next;
    await showComparison();
  });
}
$('compare-zoom').onchange = () => void run(showComparison);
for (const id of ['compare-mode','compare-mix','compare-threshold']) $(id).oninput = drawComparison;
$('compare-find').onclick = () => void run(async () => {
  const query = $('compare-search').value.trim().toLowerCase();
  if (!query) return;
  const pairs = comparison.pairs;
  for (let distance = 1; distance <= pairs.length; distance++) {
    const index = (comparisonIndex + distance) % pairs.length;
    if ([pairs[index].left, pairs[index].right].some(item => item?.text.toLowerCase().includes(query))) {
      comparisonIndex = index;
      await showComparison();
      return;
    }
  }
  status('No text match in either document.');
});
$('compare-audit').onclick = () => void run(async () => {
  if (comparison.pairs.length > 100) throw Error('Visual audit supports up to 100 paired pages.');
  const canvas = document.createElement('canvas');
  const threshold = Number($('compare-threshold').value);
  for (const [index, pair] of comparison.pairs.entries()) {
    status('Comparing images ' + (index + 1) + ' / ' + comparison.pairs.length + '…');
    const left = await renderComparison(viewer, pair.left?.index, 400, pdfjs);
    const right = await renderComparison(comparison.rightPdf, pair.right?.index, 400, pdfjs);
    comparison.report.pages[index].visualChanges = {ratio: difference(left, right, canvas, threshold), threshold};
    left.width = right.width = 0;
  }
  status('Visual audit complete.');
});
$('compare-report').onclick = () => {
  if (comparison.protected && !confirm('Export an unprotected structural comparison report?')) return;
  download(JSON.stringify(comparison.report, null, 2), stem() + '-comparison.json', 'application/json');
};

let batch = [];
let batchController = null;
const asText = (name, text, type = 'text/plain;charset=utf-8') =>
  ({name, bytes: new TextEncoder().encode(text), type});

$('open-batch').onclick = () => workspace('batch');
$('batch-close').onclick = () => {
  if (!batchController) workspace('');
};
$('batch-add').onclick = () => $('batch-input').click();
$('batch-input').onchange = () => {
  enqueue([...$('batch-input').files]);
  $('batch-input').value = '';
};
$('batch-drop').ondragover = event => event.preventDefault();
$('batch-drop').ondrop = event => {
  event.preventDefault();
  enqueue([...event.dataTransfer.files]);
};

function enqueue(files) {
  if (batchController) return;
  if (batch.length + files.length > 30 || [...batch.map(item => item.file), ...files]
      .reduce((size, file) => size + file.size, 0) > 100 * 1024 * 1024) {
    status('Queue supports up to 30 files and 100 MiB of input.');
    return;
  }
  batch.push(...files.map(file => ({file, status: 'Queued'})));
  drawBatch();
}

function drawBatch() {
  const list = $('batch-queue');
  list.replaceChildren();
  for (const item of batch) {
    const row = document.createElement('li');
    row.textContent = core.safeFilename(item.file.name) + ' · ' + item.status + (item.error ? ' · ' + item.error : '');
    if (item.result) {
      const button = document.createElement('button');
      button.textContent = 'Download';
      button.onclick = () => download(item.result.bytes, item.result.name, item.result.type);
      row.append(button);
    }
    list.append(row);
  }
  $('batch-run').disabled = Boolean(batchController) || !batch.some(item => item.status !== 'Complete');
  $('batch-add').disabled = $('batch-clear').disabled = $('batch-close').disabled = Boolean(batchController);
  $('batch-zip').disabled = !batch.some(item => item.result) || Boolean(batchController);
  $('batch-cancel').hidden = !batchController;
  $('batch-operation').disabled = Boolean(batchController);
}
$('batch-clear').onclick = () => {
  batch = [];
  drawBatch();
};
$('batch-operation').onchange = () => {
  const op = $('batch-operation').value;
  $('batch-password-label').hidden = !['protect', 'unlock'].includes(op);
  $('batch-value-label').hidden = !['watermark', 'rename'].includes(op);
  $('batch-language-label').hidden = op !== 'ocr';
  $('batch-review-label').hidden = op !== 'redact';
};
$('batch-zip').onclick = () => {
  try {
    download(archive(batch.flatMap(item => item.result ? [item.result] : [])), 'allnote-batch.zip', 'application/zip');
  } catch (error) { status(error.message); }
};

async function batchProcess(file, signal, config) {
  const {op, password, value, language, review} = config;
  const name = core.safeFilename(file.name).slice(0, -4);
  const data = await fileBytes(file);
  const task = readPdf(data, password || undefined);
  try {
    const pdf = await task.promise;
    if (pdf.numPages > core.MAX_PAGES) throw Error('PDF exceeds the page limit.');
    const permissions = await pdf.getPermissions();
    if (permissions !== null && op !== 'unlock') throw Error('Unlock protected PDFs in a separate batch first.');
    const output = (bytes, suffix) => ({name: name + suffix + '.pdf', bytes, type: 'application/pdf'});
    if (op === 'unlock') {
      if (permissions === null) throw Error('This PDF has no password protection.');
      if (Object.values(pdfjs.PermissionFlag).some(flag => !permissions.has(flag)) &&
          !await transformPdf(data, 'is-owner', password, signal)) throw Error('The PDF owner password is required.');
      return output(await transformPdf(data, 'decrypt', password, signal), '-unlocked');
    }
    if (op === 'protect') return output(await transformPdf(data, 'encrypt', password, signal), '-protected');
    if (op === 'compress') {
      const result = await transformPdf(data, 'compress', '', signal);
      return output(result.length < data.length ? result : data, '-compressed');
    }
    if (op === 'rename') return {...output(data, ''), name: core.safeFilename(value + name + '.pdf')};
    if (op === 'rotate') return output(await engine.rotate(data, '1-' + pdf.numPages, 90), '-rotated');
    if (op === 'watermark') {
      const doc = await engine.open(data);
      const font = await doc.embedFont(lib.StandardFonts.Helvetica);
      for (const item of doc.getPages()) {
        signal.throwIfAborted();
        item.drawText(value, {x: 30, y: 30, size: 16, font, opacity: .32});
      }
      return output(await doc.save(), '-watermarked');
    }
    if (op === 'metadata') {
      const result = await scrubPdf(lib, engine, data, new Set(['metadata']), signal);
      return output(await transformPdf(result.data, 'rewrite', '', signal), '-metadata-removed');
    }
    if (op === 'pixels' || op === 'redact') {
      const redacting = op === 'redact';
      if (redacting && (review.sha256 !== await fingerprint(data) || review.pages !== pdf.numPages)) {
        throw Error('This PDF does not match the reviewed redaction plan.');
      }
      if (pdf.numPages > 100) throw Error('Pixel sanitization supports up to 100 pages per file.');
      return output(await rasterRedact(lib, pdf.numPages, index => renderPixels(index, 1.5, pdf, signal),
        redacting ? review.regions : [], redacting ? review.color : '#000000', signal, () => {}, core.MAX_BYTES),
        redacting ? '-redacted' : '-pixels');
    }
    if (op === 'png') {
      if (pdf.numPages > 100) throw Error('PNG conversion supports up to 100 pages per file.');
      const images = [];
      let size = 0;
      for (let i = 1; i <= pdf.numPages; i++) {
        signal.throwIfAborted();
        const {canvas} = await renderPixels(i, 1.5, pdf, signal);
        const bytes = new Uint8Array(await (await canvasBlob(canvas, 'image/png')).arrayBuffer());
        canvas.width = canvas.height = 0;
        size += bytes.length;
        if (size > core.MAX_BYTES) throw Error('PNG output exceeds 50 MiB.');
        images.push({name: name + '-' + i + '.png', bytes});
      }
      return {name: name + '-images.zip', bytes: archive(images), type: 'application/zip'};
    }
    if (op === 'ocr' && pdf.numPages > 100) throw Error('OCR supports up to 100 pages per file.');
    const native = [];
    const scans = [];
    let characters = 0;
    for (let index = 1; index <= pdf.numPages; index++) {
      signal.throwIfAborted();
      const text = await pageText(index, pdf);
      characters += text.length;
      if (characters > 2_000_000) throw Error('Extracted text exceeds two million characters.');
      native.push(text);
      if (!text.trim()) scans.push(index);
    }
    if (op === 'ocr' && scans.length) {
      const results = await recognizePages(scans, language,
        async index => (await renderPixels(index, 2, pdf, signal)).canvas, signal, () => {});
      for (const result of results) native[result.index - 1] = result.text;
    }
    if (op === 'pi') {
      const counts = native.map((text, index) => ({page: index + 1, matches: globalThis.NoteMask.scan(text).total}));
      return asText(name + '-review.json', JSON.stringify({pages: counts, unrecognizedPages: scans}, null, 2), 'application/json');
    }
    return asText(name + (op === 'ocr' ? '-ocr.txt' : '.txt'), native.join('\n\n'));
  } catch (error) {
    if (error instanceof pdfjs.PasswordException) throw Error('The PDF password is missing or incorrect.');
    throw error;
  } finally {
    await task.destroy();
  }
}

$('batch-run').onclick = () => void (async () => {
  if (batchController) return;
  const op = $('batch-operation').value;
  const password = $('batch-password').value;
  const value = $('batch-value').value.trim();
  if (['protect', 'unlock'].includes(op) && (!password || new TextEncoder().encode(password).length > 127)) {
    status('Enter a password of up to 127 UTF-8 bytes.');
    return;
  }
  if (['watermark', 'rename'].includes(op) && !value) {
    status('Enter watermark text or a file rename prefix.');
    return;
  }
  let review;
  if (op === 'redact') {
    try {
      const file = $('batch-review').files[0];
      if (!file || file.size > 350000) throw Error();
      review = parseReview(JSON.parse(await file.text()));
    } catch {
      status('Select a valid reviewed redaction plan.');
      return;
    }
  }
  if (!confirm('Process queued PDFs into separate copies? PDF rewrites may invalidate existing digital signatures.')) return;
  $('batch-password').value = '';
  batchController = new AbortController();
  const start = batch.filter(item => item.status === 'Complete').length;
  try {
    await runBatch(batch, op === 'ocr' ? 1 : Number($('batch-concurrency').value),
      (file, signal) => batchProcess(file, signal, {op, password, value, review, language: $('batch-language').value}),
      batchController.signal, () => {
        drawBatch();
        status(batch.filter(item => item.status === 'Complete').length + ' / ' + batch.length + ' files complete.');
      });
    const completed = batch.filter(item => item.status === 'Complete').length - start;
    status(completed + ' new result(s). Review file statuses and download copies.');
  } finally {
    batchController = null;
    drawBatch();
  }
})();
$('batch-cancel').onclick = () => batchController?.abort();

const operations = {
  rotate: async () => { await change(await engine.rotate(current.data, $('range').value, 90)); status('Selected pages rotated.'); },
  remove: async () => { await change(await engine.remove(current.data, $('range').value)); status('Selected pages deleted.'); },
  extract: async () => {
    const data = await engine.extract(current.data, $('range').value);
    download(await exportBytes(data), stem() + '-extracted.pdf');
    status('Extracted PDF download requested.');
  },
  split: splitPages,
  'move-up': () => movePage(page, page - 1),
  'move-down': () => movePage(page, page + 1),
  text: () => coordinateMarkup(false),
  watermark: () => coordinateMarkup(true),
  png: () => exportPage('png'),
  jpg: () => exportPage('jpg'),
  txt: exportText,
  compress,
  ocr: recognizeScans,
  'ocr-layer': addSearchLayer,
  'ocr-txt': () => download(ocrText(), stem() + '-ocr.txt', 'text/plain;charset=utf-8'),
  'ocr-note': openOcrInNotes,
  'pi-scan': () => scanRegions(''),
  'redact-search': () => {
    const query = $('redact-query').value.trim().toLowerCase();
    if (!query) throw Error('Enter text to find.');
    return scanRegions(query);
  },
  'redact-export': () => exportRaster(true),
  'redact-review': exportReview,
  sanitize: () => exportRaster(false),
  compare: () => $('compare-input').click(),
  'read-properties': inspectProperties,
  'metadata-copy': exportMetadataRemoved,
  'sanitize-report': () => download(JSON.stringify(sanitizationResult, null, 2),
    stem() + '-sanitization.json', 'application/json'),
  'load-editable-text': findEditBlocks,
  'apply-text-edit': applyTextEdit,
  'save-properties': saveProperties,
  'read-form': inspectForm,
  'write-form': () => applyForm(parseForm($('form-data').value)),
  'export-form': exportForm,
  'import-form': () => $('form-json-file').click(),
  'flatten-form': flattenForm,
  'reset-form': resetForm,
  'read-bookmarks': inspectBookmarks,
  'add-bookmark': () => editBookmarks('add'),
  'nest-bookmark': () => editBookmarks('nest'),
  'rename-bookmark': () => editBookmarks('rename'),
  'move-bookmark': () => editBookmarks('move'),
  'remove-bookmark': () => editBookmarks('remove'),
  protect: setPassword,
  unprotect: removePassword,
  undo: () => history(undo, redo),
  redo: () => history(redo, undo),
  save: () => saveFile(false),
  'save-as': () => saveFile(true)
};

for (const button of document.querySelectorAll('[data-op]')) {
  button.onclick = () => void run(operations[button.dataset.op]);
}
window.addEventListener('beforeunload', event => {
  if (current !== saved || signature.length) {
    event.preventDefault();
    event.returnValue = '';
  }
});
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !$('password-dialog').open) setTool('');
});
$("toggle-pages").onclick = () => {
  const collapsed = $("page-sidebar").toggleAttribute("data-collapsed");
  $("toggle-pages").setAttribute("aria-expanded", String(!collapsed));
  $("toggle-pages").textContent = collapsed ? "Show pages" : "Hide pages";
};
refreshControls();
