export async function inspectPdf(pdf, signal) {
  const {info, metadata} = await pdf.getMetadata();
  const outline = await pdf.getOutline();
  const fields = await pdf.getFieldObjects();
  const attachments = await pdf.getAttachments();
  let attachmentBytes = 0;
  const attachmentKeys = [];
  for (const [name, attachment] of Object.entries(attachments || {}).sort(([a], [b]) => a.localeCompare(b))) {
    signal.throwIfAborted();
    const content = attachment.content;
    attachmentBytes += content?.byteLength || 0;
    if (attachmentBytes > 50 * 1024 * 1024) throw Error('Compared attachments exceed 50 MiB.');
    const digest = content ? new Uint8Array(await crypto.subtle.digest('SHA-256', content)) : [];
    attachmentKeys.push([name, Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')]);
  }
  const pages = [];
  let characters = 0;
  for (let index = 1; index <= pdf.numPages; index++) {
    signal.throwIfAborted();
    const page = await pdf.getPage(index);
    const {width, height} = page.getViewport({scale: 1});
    const items = await page.getTextContent();
    const text = items.items.map(item => (item.str || '') + (item.hasEOL ? '\n' : ' ')).join('').trim();
    characters += text.length;
    if (characters > 2000000) throw Error('Comparison text exceeds two million characters per document.');
    const annotations = (await page.getAnnotations()).map(item => [item.subtype, item.rect, item.fieldName ?? null, item.contentsObj?.str ?? null, item.annotationFlags]);
    pages.push({index, width, height, text, annotations});
    page.cleanup();
  }
  return {pages, info, xmp: metadata?.getRaw().slice(0, 100000) || null,
    outline, fields, attachments: attachmentKeys};
}

export function alignPages(left, right) {
  const remaining = new Set(right.map(page => page.index));
  const key = page => page.width + 'x' + page.height + ':' + page.text;
  const indexed = new Map();
  for (const page of right) {
    if (!page.text) continue;
    const id = key(page);
    if (!indexed.has(id)) indexed.set(id, []);
    indexed.get(id).push(page);
  }
  const result = left.map(page => {
    const match = page.text ? indexed.get(key(page))?.shift() : null;
    if (match) remaining.delete(match.index);
    return {left: page, right: match || null};
  });
  for (const pair of result) {
    if (pair.right) continue;
    const match = right.find(page => remaining.has(page.index));
    if (match) {
      pair.right = match;
      remaining.delete(match.index);
    }
  }
  for (const page of right) if (remaining.has(page.index)) result.push({left: null, right: page});
  return result;
}

export async function renderComparison(pdf, index, size, pdfjs) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', {willReadFrequently: true});
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size, size);
  if (!index) return canvas;
  const page = await pdf.getPage(index);
  const view = page.getViewport({scale: 1});
  const viewport = page.getViewport({scale: (size - 10) / Math.max(view.width, view.height)});
  await page.render({canvas, viewport, annotationMode: pdfjs.AnnotationMode.DISABLE}).promise;
  page.cleanup();
  return canvas;
}

export function difference(left, right, output, sensitivity) {
  const width = left.width;
  const height = left.height;
  output.width = width;
  output.height = height;
  const target = output.getContext('2d');
  const first = left.getContext('2d').getImageData(0, 0, width, height);
  const second = right.getContext('2d').getImageData(0, 0, width, height);
  let affected = 0;
  for (let i = 0; i < first.data.length; i += 4) {
    const delta = Math.max(Math.abs(first.data[i] - second.data[i]),
      Math.abs(first.data[i + 1] - second.data[i + 1]), Math.abs(first.data[i + 2] - second.data[i + 2]));
    if (delta >= sensitivity) {
      first.data[i] = 209;
      first.data[i + 1] = 51;
      first.data[i + 2] = 74;
      affected++;
    }
  }
  target.putImageData(first, 0, 0);
  return affected / (width * height);
}

export function comparisonSummary(left, right, pairs) {
  const structural = {};
  for (const [name, key] of [['Metadata','info'], ['XMP','xmp'], ['Bookmarks','outline'],
    ['Form fields','fields'], ['Attachments','attachments']]) {
    structural[name] = JSON.stringify(left[key]) !== JSON.stringify(right[key]);
  }
  return {
    pageCounts: [left.pages.length, right.pages.length], structural,
    pages: pairs.map(pair => ({
      before: pair.left?.index ?? null,
      after: pair.right?.index ?? null,
      textChanged: pair.left?.text !== pair.right?.text,
      dimensionsChanged: pair.left?.width !== pair.right?.width || pair.left?.height !== pair.right?.height,
      annotationsChanged: JSON.stringify(pair.left?.annotations) !== JSON.stringify(pair.right?.annotations),
      visualChanges: null
    }))
  };
}
