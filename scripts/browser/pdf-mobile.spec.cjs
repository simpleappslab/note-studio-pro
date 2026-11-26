const {test, expect, devices} = require('@playwright/test');
const {PDFDocument} = require('pdf-lib');
const {readFileSync} = require('node:fs');
const path = require('node:path');

test.use({...devices['Pixel 7'], defaultBrowserType: undefined});

test('phone viewport fits the PDF and supports page navigation, touch markup and export', async ({page, context}) => {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]).drawText('Mobile PDF workspace');
  doc.addPage([612, 792]).drawText('Second page');
  await page.goto('/');
  await page.getByRole('link', {name:'PDF Studio', exact:true}).tap();
  await expect(page.locator('#pdf-app')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('button', {name: 'Batch', exact: true})).toBeHidden();
  await page.getByRole('button', {name: 'Actions'}).tap();
  await expect(page.getByRole('button', {name: 'Batch', exact: true})).toBeVisible();
  await page.getByRole('button', {name: 'Actions'}).tap();
  await page.evaluate(() => {
    window.showOpenFilePicker = undefined;
    window.showSaveFilePicker = undefined;
  });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', {name: 'Open PDF'}).tap()]);
  await chooser.setFiles({name: 'mobile.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save())});
  await expect(page.locator('#position')).toHaveText('1 / 2');
  await expect(page.getByLabel('Zoom', {exact: true})).toHaveValue('fit');
  await expect(page.locator('#page-sidebar')).toBeHidden();
  await expect(page.locator('#document-tools')).toBeHidden();
  await expect.poll(() => page.locator('#paper').evaluate(paper => paper.scrollWidth <= paper.clientWidth + 1)).toBe(true);
  const pages = page.getByRole('button', {name: 'Pages', exact: true});
  await pages.tap();
  await page.getByRole('button', {name: 'Page 2', exact: true}).tap();
  await expect(page.locator('#position')).toHaveText('2 / 2');
  await expect(pages).toHaveAttribute('aria-expanded', 'false');

  const tools = page.getByRole('button', {name: 'Tools', exact: true});
  await tools.tap();
  await page.getByRole('button', {name: 'Pen', exact: true}).tap();
  await expect(page.locator('#document-tools')).toBeHidden();
  await expect(page.locator('#markup')).toHaveAttribute('data-tool', 'ink');
  const session = await context.newCDPSession(page);
  const box = await page.locator('#markup').boundingBox();
  await session.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x:box.x+65,y:box.y+140}]});
  await session.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{x:box.x+130,y:box.y+175}]});
  await session.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
  await session.detach();
  await expect(page.locator('#status')).toContainText('Markup added');
  const [download] = await Promise.all([
    page.waitForEvent('download', {timeout: 10000}),
    page.getByRole('button', {name:'Save As'}).click()
  ]);
  const output = await PDFDocument.load(readFileSync(await download.path()));
  expect(output.getPageCount()).toBe(2);
  expect(output.getPage(1).node.Contents()).toBeDefined();

  if (process.env.ALLNOTE_SCREENSHOTS) {
    await page.screenshot({path: path.join(process.env.ALLNOTE_SCREENSHOTS, 'pdf-studio-phone.png')});
    await tools.tap();
    await page.screenshot({path: path.join(process.env.ALLNOTE_SCREENSHOTS, 'pdf-studio-phone-tools.png')});
  }
  for (const width of [320, 844]) {
    await page.setViewportSize({width, height: width === 320 ? 640 : 375});
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});
