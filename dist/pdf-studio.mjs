import * as pdfjs from './vendor/pdfjs/pdf.mjs';

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
    unprotect: !current?.password
  };
  for (const control of controls) {
    control.disabled = busy || !current || Boolean(restrictions[control.dataset.op || control.id]);
  }
  for (const id of ['open','merge','images']) $(id).disabled = busy;
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

function transformPdf(input, operation, password = '') {
  return new Promise((resolve, reject) => {
    const worker = new Worker(asset('pdf-qpdf-worker.js'));
    const finish = (callback, value) => {
      clearTimeout(timeout);
      worker.terminate();
      callback(value);
    };
    const timeout = setTimeout(() => finish(reject, Error('The PDF operation timed out.')), 45000);
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
    data: data.slice(), password, isEvalSupported: false, enableXfa: false,
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
  page = index;
  $('range').value = String(page);
  $('position').textContent = page + ' / ' + viewer.numPages;
  $('empty').hidden = true;
  $('page-surface').hidden = false;
  $('pages').querySelector('[aria-current]')?.removeAttribute('aria-current');
  $('pages').children[page - 1]?.firstElementChild.setAttribute('aria-current', 'page');
}

const thumbnails = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const canvas = entry.target;
    thumbnails.unobserve(canvas);
    const pdf = viewer;
    const generation = thumbGeneration;
    thumbnailQueue = thumbnailQueue.then(async () => {
      if (generation !== thumbGeneration) return;
      const pdfPage = await pdf.getPage(Number(canvas.dataset.page));
      if (generation !== thumbGeneration) return;
      const unit = pdfPage.getViewport({scale: 1});
      await paint(pdfPage, pdfPage.getViewport({scale: Math.min(104 / unit.width, 118 / unit.height)}), canvas);
      pdfPage.cleanup();
    }).catch(() => {
      canvas.hidden = true;
    });
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
    canvas.width = 80;
    canvas.height = 100;
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
  undo = [];
  redo = [];
  saved = file ? current : null;
  status(filename + ' · ' + viewer.numPages + ' pages');
}

async function change(data, {password = current.password, index = page} = {}) {
  const previous = current;
  const pageBeforeChange = page;
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

async function pageText(index) {
  const pdfPage = await viewer.getPage(index);
  const content = await pdfPage.getTextContent();
  pdfPage.cleanup();
  return content.items.map(item => (item.str || '') + (item.hasEOL ? '\n' : ' ')).join('').trimEnd();
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
  signature: 'Sign directly on the page, then select Place signature.'
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
    else setTool(next);
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
    if (tool === 'rectangle') ctx.strokeRect(x, y, w, h);
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
  if (tool === 'highlight' || tool === 'rectangle' || tool === 'ellipse') {
    stroke[1] = point;
  } else if (stroke.length < 3000) {
    stroke.push(point);
  }
  drawDraft();
};
markup.onpointerup = event => {
  if (!stroke || !event.isPrimary) return;
  const path = [...stroke, pointerPoint(event)];
  stroke = null;
  if (tool === 'signature' && signature.length < 30) {
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

$('finish-signature').onclick = () => void run(() => drawMarkup('signature', signature));
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
refreshControls();
