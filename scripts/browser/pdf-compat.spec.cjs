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

test('narrow web layout keeps page controls available and closes tool drawers with Escape', async ({page}) => {
  await page.setViewportSize({width: 375, height: 740});
  await page.goto('/pdf-studio.html');
  await expect(page.locator('#pdf-app')).toHaveAttribute('aria-busy', 'false');
  const tools = page.getByRole('button', {name: 'Tools', exact: true});
  await expect(page.locator('#document-tools')).toBeHidden();
  await tools.click();
  await expect(page.locator('#document-tools')).toBeVisible();
  await expect(tools).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('#document-tools')).toBeHidden();
  await expect(tools).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
