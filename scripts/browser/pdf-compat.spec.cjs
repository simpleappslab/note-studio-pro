const {test, expect} = require('@playwright/test');
const {PDFDocument} = require('pdf-lib');
const {readFileSync} = require('node:fs');

test('PDF web viewer and password export work on the configured browser engine', async ({page}) => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 500]).drawText('Browser compatibility PDF');
  await page.goto('/');
  await page.getByRole('link', {name: 'PDF Studio'}).click();
  await expect(page.locator('#pdf-app')).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(() => { window.showOpenFilePicker = undefined; window.showSaveFilePicker = undefined; });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'),
    page.getByRole('button', {name: 'Open PDF'}).click()]);
  await chooser.setFiles({name: 'compatibility.pdf', mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save())});
  await expect(page.locator('#position')).toHaveText('1 / 1');
  await page.getByRole('searchbox').first().fill('Browser compatibility PDF');
  await page.getByRole('button', {name: 'Find next'}).click();
  await expect(page.locator('#status')).toContainText('Match on page 1');
  await page.getByRole('button', {name: 'Set password'}).click();
  await page.getByLabel('Password', {exact: true}).fill('compatibility test');
  await page.getByLabel('Confirm password').fill('compatibility test');
  await page.getByRole('button', {name: 'Continue'}).click();
  await expect(page.locator('#status')).toContainText('Password set.');
  const [download] = await Promise.all([page.waitForEvent('download'),
    page.getByRole('button', {name: 'Save As'}).click()]);
  const encrypted = readFileSync(await download.path());
  expect((await PDFDocument.load(encrypted, {ignoreEncryption: true})).isEncrypted).toBe(true);
});
