const {test, expect, chromium} = require('@playwright/test');
const {PDFDocument, PDFName, PDFNumber, PDFRawStream, StandardFonts} = require('pdf-lib');
const {mkdirSync, readFileSync, mkdtempSync, rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const vm = require('node:vm');

const route = '/pdf-studio.html';
const password = '--Café studio 2026';
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/B1sAAAAASUVORK5CYII=', 'base64');

async function fixture({compressible = false} = {}) {
  const doc = await PDFDocument.create();
  doc.setTitle('AllNote PDF Studio · sample');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const title = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const [index, subtitle] of ['Project overview', 'Design notes', 'Approval record'].entries()) {
    const page = doc.addPage([560, 690 + 10 * index]);
    const green = require('pdf-lib').rgb(.14, .37, .24);
    page.drawText('ALLNOTE  /  STUDIO SAMPLE', {x: 48, y: 626, size: 12, color: green, font: title});
    page.drawText(subtitle, {x: 48, y: 566, size: 32, font: title});
    page.drawText('A demonstration document for the offline PDF workspace.', {x: 48, y: 530, size: 14, font});
    page.drawRectangle({x: 48, y: 439, width: 450, height: 60, color: require('pdf-lib').rgb(.91, .95, .92)});
    page.drawText(['Overview and review timeline', 'Rotate, organize, and mark up pages', 'Sign and save a local copy'][index],
      {x: 64, y: 464, size: 17, font: title, color: green});
    page.drawText('Page ' + (index + 1) + '  /  3', {x: 48, y: 42, size: 10, font});
    if (compressible) {
      const stream = doc.context.stream('% ' + 'repeatable PDF content '.repeat(17000) + '\n');
      page.node.addContentStream(doc.context.register(stream));
    }
  }
  const field = doc.getForm().createTextField('Reviewer');
  field.setText('AllNote');
  field.addToPage(doc.getPage(2), {x: 48, y: 345, width: 220, height: 30, font});
  return Buffer.from(await doc.save({useObjectStreams: false}));
}

function click(page, action) {
  return page.locator('[data-op="' + action + '"]').click();
}
async function navigate(page) {
  await page.goto(route);
  await expect(page.locator('#pdf-app')).toHaveAttribute('aria-busy', 'false');
}
async function open(page, bytes, name = 'studio-sample.pdf') {
  await page.evaluate(() => { window.showOpenFilePicker = undefined; });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', {name: 'Open PDF'}).click()]);
  await chooser.setFiles({name, mimeType: 'application/pdf', buffer: bytes});
}
async function openReady(page, bytes, name) {
  await open(page, bytes, name);
  await expect(page.locator('#position')).toHaveText('1 / 3');
  await expect(page.locator('#pdf-app')).toHaveAttribute('aria-busy', 'false');
}
async function chooseImage(page, selector) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator(selector).click()]);
  await chooser.setFiles({name: 'sample.png', mimeType: 'image/png', buffer: image});
}
async function saveDownload(page, action = 'save-as') {
  if (action === 'save-as') await page.evaluate(() => { window.showSaveFilePicker = undefined; });
  const [download] = await Promise.all([page.waitForEvent('download'), click(page, action)]);
  return {data: readFileSync(await download.path()), name: download.suggestedFilename()};
}
async function fillPassword(page, value, confirmation = false) {
  await page.getByLabel('Password', {exact: true}).fill(value);
  if (confirmation) await page.getByLabel('Confirm password').fill(value);
  await page.getByRole('button', {name: 'Continue'}).click();
}
async function canvasLine(page, start, end) {
  const box = await page.locator('#markup').boundingBox();
  await page.mouse.move(box.x + start[0], box.y + start[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + end[0], box.y + end[1], {steps: 12});
  await page.mouse.up();
}

async function scannedFixture(page, text, {hindi = false, rotated = false} = {}) {
  const image = await page.evaluate(async ({text, hindi}) => {
    const canvas = document.createElement('canvas');
    canvas.width = 740;
    canvas.height = 320;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 740, 320);
    ctx.fillStyle = '#000';
    if (hindi) {
      const font = new FontFace('Indic fixture', 'url(vendor/ocr/devanagari.woff)');
      document.fonts.add(await font.load());
    }
    ctx.font = hindi ? '56px "Indic fixture"' : '48px sans-serif';
    ctx.fillText(text, 45, 115);
    ctx.fillText(text, 45, 210);
    return canvas.toDataURL('image/png').split(',')[1];
  }, {text, hindi});
  const doc = await PDFDocument.create();
  const picture = await doc.embedPng(Buffer.from(image, 'base64'));
  if (rotated) {
    const degrees = require('pdf-lib').degrees;
    const leaf = doc.addPage([320, 740]);
    leaf.setRotation(degrees(90));
    leaf.drawImage(picture, {x: 320, y: 0, width: 740, height: 320, rotate: degrees(90)});
  } else {
    doc.addPage([740, 320]).drawImage(picture, {x: 0, y: 0, width: 740, height: 320});
  }
  return Buffer.from(await doc.save());
}

test('Notes toolbar, PDF thumbnails and drag organization preserve the document form', async ({page}) => {
  await page.goto('/');
  await expect(page.locator('.CodeMirror').first()).toBeVisible();
  await page.getByRole('link', {name: 'PDF Studio'}).click();
  await openReady(page, await fixture());
  await expect.poll(async () => page.locator('#pages canvas').first().evaluate(canvas =>
    canvas.getContext('2d').getImageData(3, 3, 1, 1).data[3])).toBe(255);
  await page.getByRole('button', {name: 'Page 1', exact: true}).dragTo(page.getByRole('button', {name: 'Page 3', exact: true}));
  await expect(page.locator('#status')).toHaveText('Moved page 1 to position 3.');
  const {data} = await saveDownload(page);
  const doc = await PDFDocument.load(data);
  expect(doc.getPages().map(item => item.getHeight())).toEqual([700, 710, 690]);
  expect(doc.getForm().getTextField('Reviewer').getText()).toBe('AllNote');
  await click(page, 'undo');
  await expect(page.locator('#position')).toHaveText('1 / 3');
  await click(page, 'redo');
  await expect(page.locator('#position')).toHaveText('3 / 3');
  await click(page, 'move-up');
  await expect(page.locator('#position')).toHaveText('2 / 3');
  await page.getByRole('searchbox').fill('Approval record');
  await page.getByRole('button', {name: 'Find next'}).click();
  await expect(page.locator('#status')).toHaveText('Match on page 3.');
  await page.getByRole('link', {name: 'Notes'}).click();
  await page.getByRole('link', {name: 'PDF Studio'}).click();
  await expect(page.getByRole('heading', {name: 'PDF Studio', exact: true})).toBeVisible();
});

test('draws visual edits and a multi-stroke signature and captures both themes', async ({page}, info) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await navigate(page);
  await openReady(page, await fixture());
  await page.getByLabel('Text / watermark').fill('Reviewed locally');
  await page.getByRole('button', {name: 'Text', exact: true}).click();
  await page.locator('#markup').click({position: {x: 48, y: 325}});
  await expect(page.locator('#status')).toHaveText('Markup added to page 1.');
  await page.getByRole('button', {name: 'Highlight', exact: true}).click();
  await canvasLine(page, [45, 143], [410, 167]);
  await expect(page.getByRole('button', {name: 'Highlight', exact: true})).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', {name: 'Rectangle', exact: true}).click();
  await canvasLine(page, [46, 348], [235, 472]);
  await expect(page.getByRole('button', {name: 'Rectangle', exact: true})).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', {name: 'Ellipse', exact: true}).click();
  await canvasLine(page, [253, 348], [417, 472]);
  await expect(page.getByRole('button', {name: 'Ellipse', exact: true})).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', {name: 'Pen', exact: true}).click();
  await canvasLine(page, [315, 300], [380, 323]);
  await expect(page.getByRole('button', {name: 'Pen', exact: true})).toHaveAttribute('aria-pressed', 'false');
  await chooseImage(page, '[data-tool="image"]');
  await page.locator('#markup').click({position: {x: 390, y: 525}});
  await expect(page.getByRole('button', {name: 'Image', exact: true})).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', {name: 'Signature', exact: true}).click();
  await expect(page.locator('#pdf-app')).toHaveAttribute('aria-busy', 'false');
  await canvasLine(page, [64, 435], [106, 388]);
  await canvasLine(page, [106, 388], [126, 433]);
  await canvasLine(page, [78, 418], [155, 407]);
  await page.getByRole('button', {name: 'Place signature'}).click();
  await expect(page.locator('#status')).toHaveText('Signature placed on page 1.');
  const screenshotDir = process.env.ALLNOTE_SCREENSHOTS || info.outputPath('screenshots');
  mkdirSync(screenshotDir, {recursive: true});
  await page.screenshot({path: path.join(screenshotDir, 'pdf-studio-light.png')});
  await page.getByRole('button', {name: 'Dark mode'}).click();
  await expect(page.locator('body')).toHaveAttribute('data-dark', '');
  await page.screenshot({path: path.join(screenshotDir, 'pdf-studio-dark.png')});
  await page.getByRole('searchbox').fill('Reviewed locally');
  await page.getByRole('button', {name: 'Find next'}).click();
  await expect(page.locator('#status')).toHaveText('Match on page 1.');
  await expect(page.locator('#document-state')).toHaveText('Unsaved changes');
  const {data} = await saveDownload(page);
  const doc = await PDFDocument.load(data);
  expect(doc.getPageCount()).toBe(3);
  expect(doc.getPage(0).node.Resources().lookup(PDFName.of('XObject')).keys()).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('saves AES-256, rejects wrong passwords, and only removes with authorization', async ({page}) => {
  await navigate(page);
  await openReady(page, await fixture());
  await click(page, 'protect');
  await fillPassword(page, password, true);
  await expect(page.locator('#status')).toHaveText('Password set. Save the PDF to apply it to a file.');
  const {data} = await saveDownload(page);
  const protectedDoc = await PDFDocument.load(data, {ignoreEncryption: true});
  const encryption = protectedDoc.context.lookup(protectedDoc.context.trailerInfo.Encrypt);
  expect(encryption.lookup(PDFName.of('V'), PDFNumber).asNumber()).toBe(5);
  expect(encryption.lookup(PDFName.of('R'), PDFNumber).asNumber()).toBe(6);

  await navigate(page);
  await open(page, data, 'locked.pdf');
  await expect(page.getByRole('heading', {name: 'Open protected PDF'})).toBeVisible();
  await fillPassword(page, 'incorrect');
  await expect(page.locator('#password-help')).toHaveText('That password was incorrect. Try again.');
  await fillPassword(page, password);
  await expect(page.locator('#status')).toHaveText('locked.pdf · 3 pages');
  await expect(page.locator('#document-state')).toHaveText('Password protected');
  await click(page, 'unprotect');
  await fillPassword(page, 'incorrect');
  await expect(page.locator('#status')).toHaveText('The current PDF password did not match.');
  await click(page, 'unprotect');
  await fillPassword(page, password);
  await expect(page.locator('#status')).toContainText('Password removed.');
  const unlocked = await saveDownload(page);
  expect((await PDFDocument.load(unlocked.data)).getPageCount()).toBe(3);
  await click(page, 'undo');
  await expect(page.locator('#document-state')).toContainText('Password protected');
});

test('restricted PDFs require the owner password before edit or removal', async ({page}) => {
  const bundle = path.resolve('dist/vendor/qpdf');
  const source = readFileSync(path.join(bundle, 'qpdf-core.js'), 'utf8');
  const createQpdf = vm.runInNewContext(source + '; createQpdfCore', {
    WebAssembly, URL, TextEncoder, TextDecoder, crypto, require, process, Buffer, setTimeout, clearTimeout
  });
  const qpdf = await createQpdf({wasmBinary: readFileSync(path.join(bundle, 'qpdf-core.wasm'))});
  qpdf.FS.writeFile('/input.pdf', await fixture());
  expect(qpdf.callMain(['/input.pdf', '--encrypt', 'reader', 'owner', '256',
    '--modify=none', '--', '/restricted.pdf'])).toBe(0);
  await navigate(page);
  await open(page, Buffer.from(qpdf.FS.readFile('/restricted.pdf')), 'restricted.pdf');
  await fillPassword(page, 'reader');
  await expect(page.getByRole('heading', {name: 'PDF owner password required'})).toBeVisible();
  await fillPassword(page, 'reader');
  await expect(page.locator('#password-help')).toContainText('does not grant owner access');
  await fillPassword(page, 'owner');
  await expect(page.locator('#status')).toHaveText('restricted.pdf · 3 pages');
  await expect(page.locator('#document-state')).toHaveText('Password protected');
});

test('lossless compression preserves text and forms; configured raster compression does not', async ({page}) => {
  const input = await fixture({compressible: true});
  await navigate(page);
  await openReady(page, input);
  await click(page, 'compress');
  await expect(page.locator('#status')).toContainText('Reduced size by');
  const {data} = await saveDownload(page);
  expect(data.length).toBeLessThan(input.length / 2);
  const doc = await PDFDocument.load(data);
  expect(doc.getForm().getTextField('Reviewer').getText()).toBe('AllNote');
  await expect(page.locator('#position')).toHaveText('1 / 3');
  await page.getByRole('searchbox').fill('Approval record');
  await page.getByRole('button', {name: 'Find next'}).click();
  await expect(page.locator('#status')).toHaveText('Match on page 3.');

  await openReady(page, input);
  await page.locator('#compression').selectOption('raster');
  await page.locator('#resolution').selectOption('72');
  await page.locator('#quality').selectOption('.5');
  page.once('dialog', dialog => dialog.accept());
  await click(page, 'compress');
  await expect(page.locator('#status')).toContainText('Reduced size by');
  const raster = await saveDownload(page);
  const rasterDoc = await PDFDocument.load(raster.data);
  expect(rasterDoc.getForm().getFields()).toHaveLength(0);
  expect(rasterDoc.getPageCount()).toBe(3);
  await page.getByRole('button', {name: 'Find next'}).click();
  await expect(page.locator('#status')).toHaveText('No matching text.');
});

test('writes to the opened handle and a separate Save As handle using local writable streams', async ({page}) => {
  await navigate(page);
  await page.evaluate(async input => {
    const dir = await navigator.storage.getDirectory();
    const source = await dir.getFileHandle('source.pdf', {create: true});
    const dest = await dir.getFileHandle('copy.pdf', {create: true});
    const stream = await source.createWritable();
    await stream.write(new Uint8Array(input));
    await stream.close();
    window.showOpenFilePicker = async () => [source];
    window.showSaveFilePicker = async () => dest;
    window.readFixture = async name => Array.from(new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer()));
    window.changeFixture = async name => {
      const writer = await (await dir.getFileHandle(name)).createWritable();
      await writer.write('external edit');
      await writer.close();
    };
  }, [...await fixture()]);
  await page.getByRole('button', {name: 'Open PDF'}).click();
  await expect(page.locator('#status')).toHaveText('source.pdf · 3 pages');
  await click(page, 'rotate');
  await expect(page.locator('#status')).toHaveText('Selected pages rotated.');
  await click(page, 'save');
  await expect(page.locator('#status')).toHaveText('Saved source.pdf.');
  await click(page, 'remove');
  await expect(page.locator('#status')).toHaveText('Selected pages deleted.');
  await click(page, 'save-as');
  await expect(page.locator('#status')).toHaveText('Saved copy.pdf.');
  const source = await PDFDocument.load(Uint8Array.from(await page.evaluate(() => window.readFixture('source.pdf'))));
  const copy = await PDFDocument.load(Uint8Array.from(await page.evaluate(() => window.readFixture('copy.pdf'))));
  expect(source.getPageCount()).toBe(3);
  expect(source.getPage(0).getRotation().angle).toBe(90);
  expect(copy.getPageCount()).toBe(2);
  await page.evaluate(() => window.changeFixture('copy.pdf'));
  await click(page, 'save');
  await expect(page.locator('#status')).toContainText('The file changed outside PDF Studio.');
});

test('extracts, splits, converts images, merges PDFs and exports page images and text', async ({page}) => {
  const input = await fixture();
  await navigate(page);
  await openReady(page, input);
  await page.getByLabel('Pages (e.g. 1,3-5)').fill('3,1');
  const extracted = await saveDownload(page, 'extract');
  expect((await PDFDocument.load(extracted.data)).getPages().map(item => item.getHeight())).toEqual([710, 690]);
  await page.getByLabel('Pages (e.g. 1,3-5)').fill('2');
  const split = await saveDownload(page, 'split');
  expect(split.name).toBe('studio-sample-page-2.pdf');
  await page.getByText('Export', {exact: true}).click();
  expect((await saveDownload(page, 'png')).data.subarray(1, 4).toString()).toBe('PNG');
  expect((await saveDownload(page, 'jpg')).data.subarray(0, 2)).toEqual(Buffer.from([255, 216]));
  expect((await saveDownload(page, 'txt')).data.toString()).toContain('Approval record');
  await chooseImage(page, '#images');
  await expect(page.locator('#status')).toHaveText('images.pdf · 1 pages');
  await saveDownload(page);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', {name: 'Merge', exact: true}).click()]);
  await chooser.setFiles(['first.pdf', 'second.pdf'].map(name => ({name, mimeType: 'application/pdf', buffer: input})));
  await expect(page.locator('#status')).toHaveText('merged.pdf · 6 pages');
});

test('PWA precaches PDF Studio and both workers for a cold offline navigation', async ({page, context, baseURL}) => {
  const outbound = [];
  context.on('request', request => {
    if (!request.url().startsWith(baseURL) || request.method() !== 'GET') outbound.push(request.url());
  });
  await page.goto('/');
  await expect(page.locator('#pwa-status')).toHaveAttribute('data-ready', 'true', {timeout: 30000});
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('link', {name: 'PDF Studio'}).click();
  await openReady(page, await fixture({compressible: true}));
  await click(page, 'compress');
  await expect(page.locator('#status')).toContainText('Reduced size by');
  await click(page, 'protect');
  await fillPassword(page, password, true);
  await expect(page.locator('#status')).toContainText('Password set.');
  expect(outbound).toEqual([]);
});

test('packaged Chrome extension opens from Notes and works with networking off', async () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'allnote-extension-'));
  let context;
  try {
    execFileSync('python3', ['scripts/build-extension.py', '--output', path.join(temp, 'allnote.zip')]);
    const extension = path.join(temp, 'extension-build', 'note-studio-pro');
    context = await chromium.launchPersistentContext(path.join(temp, 'profile'), {
      channel: 'chromium',
      executablePath: process.env.ALLNOTE_CHROMIUM,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
      offline: true
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', {timeout: 15000});
    const id = new URL(worker.url()).host;
    const page = context.pages()[0];
    await page.goto('chrome-extension://' + id + '/index.html');
    await expect(page.locator('.CodeMirror').first()).toBeVisible();
    await page.getByRole('link', {name: 'PDF Studio'}).click();
    await openReady(page, await fixture({compressible: true}));
    await click(page, 'compress');
    await expect(page.locator('#status')).toContainText('Reduced size by');
    const {data} = await saveDownload(page);
    expect((await PDFDocument.load(data)).getPageCount()).toBe(3);
    await open(page, await scannedFixture(page, 'EXTENSION OCR TEST'), 'extension-scan.pdf');
    await expect(page.locator('#position')).toHaveText('1 / 1');
    await page.locator('#intelligence summary').click();
    await click(page, 'ocr');
    await expect(page.locator('#status')).toContainText('Recognized 1 scanned page(s)', {timeout: 30000});
    const recognized = await saveDownload(page, 'ocr-txt');
    expect(recognized.data.toString()).toContain('EXTENSION OCR TEST');
  } finally {
    await context?.close();
    rmSync(temp, {recursive: true, force: true});
  }
});

test('Phase 3 identifies native sensitive text and reconstructs pages without source objects', async ({page}) => {
  const doc = await PDFDocument.create();
  const first = doc.addPage([510, 600]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  first.drawText('Email: agent@example.com', {x: 45, y: 450, size: 24, font});
  first.drawText('Public information', {x: 45, y: 370, size: 24, font});
  doc.setTitle('private metadata');
  await doc.attach(Buffer.from('sensitive attachment'), 'secret.txt', {mimeType: 'text/plain'});
  doc.addJavaScript('embedded-code', 'this.print();');
  await navigate(page);
  await open(page, Buffer.from(await doc.save()));
  await expect(page.locator('#position')).toHaveText('1 / 1');
  await page.locator('#intelligence summary').click();
  await click(page, 'pi-scan');
  await expect(page.locator('#redaction-regions li')).toHaveCount(1);
  const preview = process.env.ALLNOTE_SCREENSHOTS;
  if (preview) await page.screenshot({path: path.join(preview, 'phase3-redaction.png')});
  page.once('dialog', dialog => dialog.accept());
  const {data} = await saveDownload(page, 'redact-export');
  const result = await PDFDocument.load(data, {updateMetadata: false});
  expect(result.getTitle()).toBeUndefined();
  expect(result.catalog.get(PDFName.of('Names'))).toBeUndefined();
  expect(result.catalog.get(PDFName.of('OpenAction'))).toBeUndefined();
  expect(data.includes(Buffer.from('agent@example.com'))).toBe(false);
  const decoded = await page.evaluate(async bytes => {
    const pdfjs = await import('/vendor/pdfjs/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';
    const task = pdfjs.getDocument({data: Uint8Array.from(bytes)});
    try {
      const pdf = await task.promise;
      const rendered = await pdf.getPage(1);
      const view = rendered.getViewport({scale: 1});
      const canvas = document.createElement('canvas');
      canvas.width = view.width;
      canvas.height = view.height;
      await rendered.render({canvas, viewport: view}).promise;
      return {
        text: (await rendered.getTextContent()).items.map(item => item.str).join(''),
        redacted: [...canvas.getContext('2d').getImageData(90, 140, 1, 1).data],
        background: [...canvas.getContext('2d').getImageData(20, 50, 1, 1).data]
      };
    } finally {await task.destroy();}
  }, [...data]);
  expect(decoded).toEqual({text: '', redacted: [0, 0, 0, 255], background: [255, 255, 255, 255]});
});

test('Phase 3 OCR recognizes a scanned page offline and adds independently searchable invisible text', async ({page, context}) => {
  await page.goto('/');
  await expect(page.locator('#pwa-status')).toHaveAttribute('data-ready', 'true', {timeout: 30000});
  await context.setOffline(true);
  await page.getByRole('link', {name: 'PDF Studio'}).click();
  await expect(page.locator('#pdf-app')).toHaveAttribute('aria-busy', 'false');
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 300;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 720, 300);
    ctx.fillStyle = '#000';
    ctx.font = '48px sans-serif';
    ctx.fillText('ALLNOTE OCR TEST', 48, 130);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const doc = await PDFDocument.create();
  const picture = await doc.embedPng(Buffer.from(image, 'base64'));
  doc.addPage([720, 300]).drawImage(picture, {x: 0, y: 0, width: 720, height: 300});
  const native = doc.addPage([500, 300]);
  native.drawText('Native text must remain single');
  await open(page, Buffer.from(await doc.save()));
  await expect(page.locator('#position')).toHaveText('1 / 2');
  await page.locator('#intelligence summary').click();
  await page.locator('#intelligence-scope').selectOption('all');
  await click(page, 'ocr');
  await expect(page.locator('#status')).toContainText('Recognized 1 scanned page(s)', {timeout: 30000});
  if (process.env.ALLNOTE_SCREENSHOTS) {
    await page.screenshot({path: path.join(process.env.ALLNOTE_SCREENSHOTS, 'phase3-ocr.png')});
  }
  const {data: extracted} = await saveDownload(page, 'ocr-txt');
  expect(extracted.toString()).toContain('ALLNOTE OCR TEST');
  await click(page, 'ocr-layer');
  await expect(page.locator('#status')).toContainText('Searchable text added');
  const savedOcr = await saveDownload(page);
  const ocrContents = await page.evaluate(async bytes => {
    const engine = await import('/vendor/pdfjs/pdf.mjs');
    engine.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';
    const task = engine.getDocument({data: Uint8Array.from(bytes)});
    try {return (await (await (await task.promise).getPage(1)).getTextContent()).items.map(item => item.str);} finally {await task.destroy();}
  }, [...savedOcr.data]);
  expect(ocrContents.join(' ').replace(/\s+/g, ' ')).toContain('ALLNOTE OCR TEST');
  await page.getByRole('searchbox').first().fill('ALLNOTE OCR TEST');
  await page.getByRole('button',{name:'Find next'}).click();
  await expect(page.locator('#status')).toContainText('Match on page 1');
});

test('Phase 3 edits existing content, form values, metadata, and page bookmarks', async ({page}) => {
  await navigate(page);
  await openReady(page, await fixture());
  await page.locator('#existing-text summary').click();
  await click(page, 'load-editable-text');
  await expect(page.locator('#editable-block').getByRole('option', {name: 'Project overview'})).toHaveCount(1);
  await page.locator('#editable-block').selectOption({label: 'Project overview'});
  await page.locator('#editable-value').fill('Updated overview');
  await click(page, 'apply-text-edit');
  await expect(page.locator('#status')).toContainText('Existing text updated');

  await page.locator('#properties summary').click();
  await click(page, 'read-properties');
  await page.locator('#property-value-0').fill('Phase 3 edited sample');
  await click(page, 'save-properties');
  await expect(page.locator('#status')).toContainText('Document properties updated');

  await page.locator('#forms summary').click();
  await click(page, 'read-form');
  await expect(page.locator('#form-data')).toHaveValue(/AllNote/);
  await page.locator('#form-data').fill(JSON.stringify({Reviewer: 'Edited locally'}));
  await click(page, 'write-form');
  await expect(page.locator('#status')).toContainText('Form data updated');
  await page.locator('#field-name').fill('Approved');
  await page.locator('#field-kind').selectOption('checkbox');
  await page.getByRole('button', {name: 'Draw field'}).click();
  await canvasLine(page, [60, 300], [95, 335]);
  await expect(page.locator('#status')).toContainText('Form field added.');

  await page.locator('#bookmarks summary').click();
  await click(page, 'read-bookmarks');
  await page.locator('#bookmark-title').fill('Review section');
  await click(page, 'add-bookmark');
  await expect(page.locator('#bookmark-list')).toContainText('Review section');
  if (process.env.ALLNOTE_SCREENSHOTS) {
    await page.screenshot({path: path.join(process.env.ALLNOTE_SCREENSHOTS, 'phase3-editing.png')});
  }
  const {data} = await saveDownload(page);
  const saved = await PDFDocument.load(data, {updateMetadata: false});
  expect(saved.getTitle()).toBe('Phase 3 edited sample');
  expect(saved.getForm().getTextField('Reviewer').getText()).toBe('Edited locally');
  expect(saved.getForm().getCheckBox('Approved').isChecked()).toBe(false);
  expect(saved.catalog.get(PDFName.of('Outlines'))).toBeDefined();
  await page.getByRole('searchbox').first().fill('Updated overview');
  await page.getByRole('button',{name:'Find next'}).click();
  await expect(page.locator('#status')).toContainText('Match on page 1');
  await page.getByRole('searchbox').first().fill('Project overview');
  await page.getByRole('button',{name:'Find next'}).click();
  await expect(page.locator('#status')).toContainText('No matching text');
});

test('Phase 3 compares text, images and document structure', async ({page}) => {
  await navigate(page);
  await openReady(page, await fixture());
  const other = await PDFDocument.load(await fixture());
  other.setTitle('Modified copy');
  other.getPage(0).drawText('Additional copy text', {x: 48, y: 330});
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), click(page, 'compare')]);
  await chooser.setFiles({name: 'other.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await other.save())});
  await expect(page.locator('#compare-summary')).toContainText('Metadata');
  await expect(page.locator('#compare-text')).toContainText('Additional copy text');
  await page.locator('#compare-mode').selectOption('changes');
  await expect(page.locator('#compare-diff')).toBeVisible();
  if (process.env.ALLNOTE_SCREENSHOTS) {
    await page.screenshot({path: path.join(process.env.ALLNOTE_SCREENSHOTS, 'phase3-comparison.png')});
  }
  await page.locator('#compare-audit').click();
  await expect(page.locator('#status')).toHaveText('Visual audit complete.');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#compare-report').click()]);
  const report = JSON.parse(readFileSync(await download.path()));
  expect(report.pageCounts).toEqual([3, 3]);
  expect(report.pages[0].visualChanges.ratio).toBeGreaterThan(0);
  expect(report.pages[0].textChanged).toBe(true);
});

test('Phase 3 batch reports malformed files and archives successful copies', async ({page}) => {
  await navigate(page);
  await page.locator('#open-batch').click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#batch-add').click()]);
  await chooser.setFiles([
    {name: 'valid.pdf', mimeType: 'application/pdf', buffer: await fixture()},
    {name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 broken fixture')}
  ]);
  await page.locator('#batch-operation').selectOption('rotate');
  await page.locator('#batch-concurrency').selectOption('2');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#batch-run').click();
  await expect(page.locator('#batch-queue')).toContainText('valid.pdf · Complete');
  await expect(page.locator('#batch-queue')).toContainText('bad.pdf · Failed');
  if (process.env.ALLNOTE_SCREENSHOTS) {
    await page.screenshot({path: path.join(process.env.ALLNOTE_SCREENSHOTS, 'phase3-batch.png')});
  }
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#batch-zip').click()]);
  const {unzipSync} = require('fflate');
  const zip = unzipSync(readFileSync(await download.path()));
  const rotated = await PDFDocument.load(zip['valid-rotated.pdf']);
  expect(rotated.getPages().map(item => item.getRotation().angle)).toEqual([90, 90, 90]);
});

test('Phase 3 loads Hindi OCR for a rotated scan and restarts after cancellation', async ({page}) => {
  await navigate(page);
  await open(page, await scannedFixture(page, 'भारत सरकार', {hindi: true, rotated: true}), 'hindi.pdf');
  await expect(page.locator('#position')).toHaveText('1 / 1');
  await page.locator('#intelligence summary').click();
  await page.locator('#ocr-language').selectOption('hin');
  await click(page, 'ocr');
  await page.locator('#cancel-intelligence').click();
  await expect(page.locator('#status')).toHaveText('Processing canceled.');
  await expect(page.locator('#pdf-app')).toHaveAttribute('aria-busy', 'false');
  await click(page, 'ocr');
  await expect(page.locator('#status')).toContainText('Recognized 1 scanned page(s)', {timeout: 30000});
  expect((await saveDownload(page, 'ocr-txt')).data.toString()).toContain('भारत सरकार');
});

test('Phase 3 batches a review plan only for the exact PDF it references', async ({page}) => {
  await navigate(page);
  const input = await fixture();
  await openReady(page, input);
  await page.locator('#intelligence summary').click();
  await page.locator('#redact-query').fill('Project overview');
  await click(page, 'redact-search');
  await expect(page.locator('#redaction-regions li')).toHaveCount(1);
  page.once('dialog', dialog => dialog.accept());
  const plan = await saveDownload(page, 'redact-review');
  await page.locator('#open-batch').click();
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#batch-add').click()]);
  await chooser.setFiles([
    {name:'reviewed.pdf', mimeType:'application/pdf', buffer:input},
    {name:'unreviewed.pdf', mimeType:'application/pdf', buffer:await fixture({compressible:true})}
  ]);
  await page.locator('#batch-operation').selectOption('redact');
  await page.locator('#batch-review').setInputFiles({name:plan.name, mimeType:'application/json', buffer:plan.data});
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#batch-run').click();
  await expect(page.locator('#batch-queue')).toContainText('reviewed.pdf · Complete');
  await expect(page.locator('#batch-queue')).toContainText('unreviewed.pdf · Failed');
});

test('Phase 3 removes standard metadata while preserving native text and forms', async ({page}) => {
  await navigate(page);
  await openReady(page, await fixture());
  await page.locator('#properties summary').click();
  await click(page, 'read-properties');
  await page.locator('#property-value-1').fill('Private author');
  await page.locator('#xmp-replace').check();
  await click(page, 'save-properties');
  await expect(page.locator('#status')).toContainText('Document properties updated');
  await expect(page.locator('#xmp-info')).toHaveValue(/Private author/);
  page.once('dialog', dialog => dialog.accept());
  const {data} = await saveDownload(page, 'metadata-copy');
  const doc = await PDFDocument.load(data, {updateMetadata: false});
  expect(doc.getAuthor()).toBeUndefined();
  expect(doc.getTitle()).toBeUndefined();
  expect(doc.catalog.get(PDFName.of('Metadata'))).toBeUndefined();
  expect(doc.getForm().getTextField('Reviewer').getText()).toBe('AllNote');
  const report = await saveDownload(page, 'sanitize-report');
  expect(JSON.parse(report.data).removed.metadata).toBeGreaterThanOrEqual(2);
});

test('Phase 3 rewrites selected actions, attachments and hidden annotations without rasterizing text', async ({page}) => {
  const doc = await PDFDocument.create();
  const leaf = doc.addPage([400, 500]);
  leaf.drawText('Visible source content');
  doc.setTitle('Keep title');
  await doc.attach(Buffer.from('PRIVATE ATTACHMENT CONTENT'), 'private.txt', {mimeType: 'text/plain'});
  doc.addJavaScript('private-script', 'this.print();');
  const hidden = doc.context.obj({Type:'Annot', Subtype:'Text', Rect:[30,20,44,36], F:2, Contents: require('pdf-lib').PDFHexString.fromText('hidden note')});
  const link = doc.context.obj({Type:'Annot', Subtype:'Link', Rect:[30,42,56,56],
    A:{S:'URI',URI:require('pdf-lib').PDFHexString.fromText('https://example.test/private')}});
  leaf.node.set(PDFName.of('Annots'), doc.context.obj([doc.context.register(hidden),doc.context.register(link)]));
  doc.catalog.set(PDFName.of('OpenAction'), doc.context.obj({S:'Launch', F:require('pdf-lib').PDFHexString.fromText('private')}));
  await navigate(page);
  await open(page, Buffer.from(await doc.save()));
  await expect(page.locator('#position')).toHaveText('1 / 1');
  await page.locator('#properties summary').click();
  await page.locator('#sanitize-options [value="metadata"]').uncheck();
  for (const option of ['attachments','actions','external','annotations']) {
    await page.locator('#sanitize-options [value="' + option + '"]').check();
  }
  page.once('dialog', dialog => dialog.accept());
  const {data} = await saveDownload(page, 'metadata-copy');
  const cleaned = await PDFDocument.load(data, {updateMetadata: false});
  expect(cleaned.getTitle()).toBe('Keep title');
  expect(cleaned.catalog.get(PDFName.of('OpenAction'))).toBeUndefined();
  const names = cleaned.catalog.lookup(PDFName.of('Names'));
  expect(names.get(PDFName.of('EmbeddedFiles'))).toBeUndefined();
  expect(names.get(PDFName.of('JavaScript'))).toBeUndefined();
  const notes = cleaned.getPage(0).node.Annots();
  expect(notes.size()).toBe(1);
  expect(notes.lookup(0).get(PDFName.of('A'))).toBeUndefined();
});

test('Phase 3 requests permission before changing an existing digital signature', async ({page}) => {
  const lib = require('pdf-lib');
  const doc = await PDFDocument.create();
  doc.addPage([500, 600]).drawText('Signed document');
  const signature = doc.context.obj({
    FT: 'Sig', T: lib.PDFHexString.fromText('Signed'),
    V: {Type: 'Sig', ByteRange: [0, 10, 20, 10], Contents: lib.PDFHexString.of('00')}
  });
  doc.catalog.set(PDFName.of('AcroForm'),
    doc.context.obj({Fields: [doc.context.register(signature)]}));
  await navigate(page);
  await open(page, Buffer.from(await doc.save()));
  await expect(page.locator('#position')).toHaveText('1 / 1');
  const warning = page.waitForEvent('dialog').then(async dialog => {
    const message = dialog.message();
    await dialog.dismiss();
    return message;
  });
  await click(page, 'rotate');
  expect(await warning).toContain('may invalidate the existing digital signature');
  await expect(page.locator('#document-state')).toHaveText('');
});

test('Phase 3 creates an unsigned signature widget and writes an appearance without a signature value', async ({page}) => {
  await navigate(page);
  await openReady(page, await fixture());
  await page.locator('#forms summary').click();
  await page.locator('#field-name').fill('InkApproval');
  await page.locator('#field-kind').selectOption('signature');
  await page.getByRole('button', {name:'Draw field'}).click();
  await canvasLine(page, [60, 300], [250, 365]);
  await expect(page.locator('#status')).toContainText('Form field added.');
  await page.locator('#forms summary').click();
  await page.getByRole('button', {name:'Signature', exact:true}).click();
  await page.locator('#signature-field').selectOption('InkApproval');
  await canvasLine(page, [96, 314], [125, 337]);
  await canvasLine(page, [125, 337], [158, 306]);
  await page.getByRole('button', {name:'Place signature'}).click();
  await expect(page.locator('#status')).toContainText('visual appearance');
  const {data} = await saveDownload(page);
  const doc = await PDFDocument.load(data, {updateMetadata:false});
  const field = doc.getForm().getSignature('InkApproval');
  expect(field.acroField.dict.get(PDFName.of('V'))).toBeUndefined();
  expect(field.acroField.getWidgets()[0].getAppearances().normal).toBeDefined();
});
