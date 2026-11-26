const {test, expect, chromium} = require('@playwright/test');
const {PDFDocument, PDFName, PDFNumber, PDFRawStream, StandardFonts} = require('pdf-lib');
const {mkdirSync, readFileSync, mkdtempSync, rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');

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
  } finally {
    await context?.close();
    rmSync(temp, {recursive: true, force: true});
  }
});
