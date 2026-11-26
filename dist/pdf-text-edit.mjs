// Existing content editing is limited to isolated horizontal WinAnsi text blocks.
const blockPattern = /\bBT\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg\s+\/([^\s/]+)\s+([\d.]+)\s+Tf\s+[\d.]+\s+TL\s+1\s+0\s+0\s+1\s+([-\d.]+)\s+([-\d.]+)\s+Tm\s+<([\dA-Fa-f]+)>\s+Tj\s+T\*\s+ET\b/g;
const allowedFont = /^(?:Helvetica(?:-Bold|-Oblique|-BoldOblique)?|Times-(?:Roman|Bold|Italic|BoldItalic)|Courier(?:-Bold|-Oblique|-BoldOblique)?)$/;

async function contentText(lib, stream) {
  const filters = stream.dict.get(lib.PDFName.of('Filter'));
  if (!filters) return new TextDecoder('latin1').decode(stream.getContents());
  if (filters.asString?.() !== '/FlateDecode' || stream.dict.has(lib.PDFName.of('DecodeParms')) ||
      typeof DecompressionStream === 'undefined') return '';
  const reader = new Blob([stream.getContents()]).stream()
    .pipeThrough(new DecompressionStream('deflate')).getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) return '';
      chunks.push(value);
    }
  } catch {
    return '';
  } finally {
    await reader.cancel().catch(() => {});
  }
  return new TextDecoder('latin1').decode(await new Blob(chunks).arrayBuffer());
}

async function candidates(lib, doc, index) {
  const page = doc.getPage(index);
  const resources = page.node.Resources()?.lookupMaybe(lib.PDFName.of('Font'), lib.PDFDict);
  if (!resources) return [];
  const contents = page.node.normalizedEntries().Contents;
  const result = [];
  for (let i = 0; i < contents.size(); i++) {
    const stream = contents.lookup(i);
    if (!(stream instanceof lib.PDFRawStream) || stream.getContents().length > 512000) continue;
    const size = stream.dict.get(lib.PDFName.of('Length'))?.asNumber?.();
    if (!Number.isFinite(size) || size > 512000) continue;
    const source = await contentText(lib, stream);
    // A conservative grammar gate keeps literals, comments, inline images and nested strings out.
    if (/[^\x09\x0a\x0d\x20-\x7e]|[()%]|\bBI\b/.test(source)) continue;
    for (const match of source.matchAll(blockPattern)) {
      const dictionary = resources.lookupMaybe(lib.PDFName.of(match[4]), lib.PDFDict);
      const font = dictionary?.get(lib.PDFName.of('BaseFont'))?.asString?.()?.slice(1);
      if (!allowedFont.test(font || '') ||
          dictionary?.get(lib.PDFName.of('Subtype'))?.asString?.() !== '/Type1' ||
          dictionary?.get(lib.PDFName.of('Encoding'))?.asString?.() !== '/WinAnsiEncoding' ||
          dictionary?.has(lib.PDFName.of('ToUnicode'))) continue;
      const hex = match[8];
      if (hex.length % 2 || !/^(?:[2-6][0-9A-F]|7[0-9A-E])+$/i.test(hex)) continue;
      const text = String.fromCharCode(...hex.match(/.{2}/g).map(byte => parseInt(byte, 16)));
      if (text.length > 500) continue;
      result.push({page, contents, i, source, match, text, font});
    }
  }
  return result;
}

export async function listEditableText(lib, doc, index) {
  return (await candidates(lib, doc, index)).slice(0, 300).map(({text, font, match}, id) => ({
    id, text, font, size: Number(match[5]), x: Number(match[6]), y: Number(match[7]),
    color: '#' + match.slice(1, 4).map(value => Math.round(255 * Number(value)).toString(16).padStart(2, '0')).join('')
  }));
}

export async function rewriteText(lib, doc, index, id, edit) {
  const value = (await candidates(lib, doc, index))[id];
  if (!value || id >= 300) throw Error('Load supported text for this page first.');
  const {page, contents, source, match, i} = value;
  let next = '';
  if (edit.text) {
    if (!/^[\x20-\x7e]{1,500}$/.test(edit.text) || !allowedFont.test(edit.font) ||
        ![edit.x, edit.y, edit.size].every(Number.isFinite) ||
        edit.size < 6 || edit.size > 144 || !/^#[\da-f]{6}$/i.test(edit.color)) {
      throw Error('Use ASCII text, a standard font, valid coordinates and a size from 6 to 144 pt.');
    }
    const font = await doc.embedFont(edit.font);
    const name = page.node.newFontDictionary(font.name, font.ref).asString();
    const width = font.widthOfTextAtSize(edit.text, edit.size);
    const offsets = {left: 0, center: width / 2, right: width};
    const x = edit.x - (offsets[edit.align] || 0);
    if (x < 0 || x + width > page.getWidth() || edit.y < 0 || edit.y + edit.size > page.getHeight()) {
      throw Error('The edited text exceeds the page bounds.');
    }
    const rgb = edit.color.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255).join(' ');
    const encoded = font.encodeText(edit.text).toString();
    next = 'BT\n' + rgb + ' rg\n' + name + ' ' + edit.size + ' Tf\n' + edit.size +
      ' TL\n1 0 0 1 ' + x + ' ' + edit.y + ' Tm\n' + encoded + ' Tj\nT*\nET';
  }
  const rewritten = source.slice(0, match.index) + next + source.slice(match.index + match[0].length);
  const streams = doc.context.obj(contents.asArray().slice());
  streams.set(i, doc.context.register(doc.context.flateStream(rewritten)));
  page.node.set(lib.PDFName.of('Contents'), streams);
  return doc.save();
}
