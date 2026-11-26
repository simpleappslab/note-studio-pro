const base = new URL('./vendor/ocr/', import.meta.url);
const MAX_PIXELS = 12_000_000;

export async function recognizePages(pages, language, render, signal, progress) {
  if (!['eng', 'hin', 'eng+hin'].includes(language)) throw Error('Unsupported OCR language.');
  const worker = new Worker(new URL('worker.min.js', base));
  const langs = language.split('+');
  let jobId = 0;
  function job(action, payload, transfer = []) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const id = ++jobId;
      const stop = () => finish(reject, new DOMException('OCR canceled', 'AbortError'));
      const timeout = setTimeout(() => finish(reject, Error('OCR operation timed out.')), 45000);
      function finish(callback, result) {
        clearTimeout(timeout);
        signal.removeEventListener('abort', stop);
        worker.onmessage = worker.onerror = null;
        callback(result);
      }
      signal.addEventListener('abort', stop, {once: true});
      worker.onerror = event => {
        event.preventDefault();
        finish(reject, Error('The OCR worker failed to start.'));
      };
      worker.onmessage = ({data}) => {
        if (data.jobId !== id || data.status === 'progress') return;
        if (data.status === 'resolve') finish(resolve, data.data);
        else finish(reject, Error('The local OCR operation failed.'));
      };
      worker.postMessage({workerId: 'allnote-ocr', jobId: id, action, payload}, transfer);
    });
  }
  try {
    // This protocol is provided by the pinned Tesseract.js browser worker.
    await job('load', {options: {lstmOnly: true, corePath: new URL('tesseract-core-lstm.wasm.js', base).href}});
    await job('loadLanguage', {langs, options: {langPath: new URL('languages', base).href,
      cacheMethod: 'none', gzip: true, lstmOnly: true}});
    await job('initialize', {langs, oem: 1, config: {}});
    const results = [];
    for (const index of pages) {
      signal.throwIfAborted();
      progress(index);
      const canvas = await render(index);
      try {
        if (canvas.width * canvas.height > MAX_PIXELS) throw Error('OCR image exceeds 12 megapixels.');
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        if (!blob) throw Error('The OCR image could not be read.');
        const image = await blob.arrayBuffer();
        const data = await job('recognize', {image: new Uint8Array(image), options: {},
          output: {text: true, blocks: true}}, [image]);
        const words = (data.blocks || []).flatMap(block => block.paragraphs.flatMap(paragraph =>
          paragraph.lines.flatMap(line => line.words.map(word => ({
            text: word.text,
            confidence: word.confidence,
            box: [word.bbox.x0 / canvas.width, word.bbox.y0 / canvas.height,
              word.bbox.x1 / canvas.width, word.bbox.y1 / canvas.height]
          })))));
        results.push({index, text: data.text, confidence: data.confidence, words});
      } finally {
        canvas.width = canvas.height = 0;
      }
    }
    return results;
  } finally {
    worker.terminate();
  }
}

export async function searchablePDF(lib, engine, bytes, results, getViewport) {
  const doc = await engine.open(bytes);
  doc.registerFontkit(globalThis.fontkit);
  const fonts = new Map();
  for (const {index, words} of results) {
    const view = await getViewport(index);
    const page = doc.getPage(index - 1);
    for (const {text, box} of words) {
      const value = text.trim();
      if (!value) continue;
      const subset = /[\u0900-\u097f]/u.test(value) ? 'devanagari' : 'latin';
      if (!fonts.has(subset)) {
        const response = await fetch(new URL(subset + '.woff', base));
        if (!response.ok) throw Error('The bundled OCR font could not be loaded.');
        fonts.set(subset, await doc.embedFont(await response.arrayBuffer(), {subset: true}));
      }
      const font = fonts.get(subset);
      const [left, top, right, bottom] = box;
      const [x, y] = view.convertToPdfPoint(left * view.width, bottom * view.height);
      const width = (right - left) * view.width / view.scale;
      const height = (bottom - top) * view.height / view.scale;
      const advance = font.widthOfTextAtSize(value, 1);
      if (advance && width > 0 && height > 0) {
        page.drawText(value, {x, y, font, opacity: 0, size: Math.min(height, width / advance),
          rotate: lib.degrees(view.rotation)});
      }
    }
  }
  return doc.save();
}

export function rectangle(first, last, width, height) {
  return [
    Math.min(first[0], last[0]) / width,
    Math.min(first[1], last[1]) / height,
    Math.max(first[0], last[0]) / width,
    Math.max(first[1], last[1]) / height
  ].map(value => Math.max(0, Math.min(1, value)));
}

export async function rasterRedact(lib, count, render, regions, color, signal, progress, maxBytes) {
  if (!/^#[a-f0-9]{6}$/i.test(color)) throw Error('Invalid redaction color.');
  const output = await lib.PDFDocument.create({updateMetadata: false});
  let total = 0;
  for (let index = 1; index <= count; index++) {
    signal.throwIfAborted();
    progress(index);
    const {canvas, width, height} = await render(index);
    try {
      const context = canvas.getContext('2d');
      context.fillStyle = color;
      for (const {box} of regions.filter(region => region.index === index)) {
        const left = Math.max(0, Math.floor(box[0] * canvas.width) - 4);
        const top = Math.max(0, Math.floor(box[1] * canvas.height) - 4);
        const right = Math.min(canvas.width, Math.ceil(box[2] * canvas.width) + 4);
        const bottom = Math.min(canvas.height, Math.ceil(box[3] * canvas.height) + 4);
        context.fillRect(left, top, right - left, bottom - top);
      }
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw Error('Could not reconstruct page ' + index + '.');
      total += blob.size;
      if (total > maxBytes) throw Error('Reconstructed page images exceed the output limit.');
      const image = await output.embedPng(await blob.arrayBuffer());
      output.addPage([width, height]).drawImage(image, {x: 0, y: 0, width, height});
    } finally {
      canvas.width = canvas.height = 0;
    }
  }
  signal.throwIfAborted();
  const bytes = await output.save();
  if (bytes.length > maxBytes) throw Error('The reconstructed PDF exceeds the output limit.');
  return bytes;
}
