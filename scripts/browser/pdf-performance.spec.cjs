const {test, expect} = require('@playwright/test');
const {PDFDocument, StandardFonts} = require('pdf-lib');
const {mkdirSync, writeFileSync} = require('node:fs');
const path = require('node:path');
const {performance} = require('node:perf_hooks');

test('Phase 3 samples opening and rendering native and scanned PDFs at 10, 100 and 500 pages', async ({page, context}, info) => {
  test.setTimeout(120000);
  const measurements = [];
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto('/pdf-studio.html');
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 720, 480);
    ctx.fillStyle = '#222';
    ctx.font = '30px sans-serif';
    for (let i = 0; i < 9; i++) ctx.fillText('Representative scanned document row ' + i, 22, 40 + i * 45);
    return canvas.toDataURL().split(',')[1];
  });
  for (const kind of ['native', 'scanned']) {
    for (const count of [10, 100, 500]) {
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const image = kind === 'scanned' ? await doc.embedPng(Buffer.from(base64, 'base64')) : null;
      for (let i = 0; i < count; i++) {
        const leaf = doc.addPage([540, 360]);
        if (image) leaf.drawImage(image, {x: 0, y: 0, width: 540, height: 360});
        else leaf.drawText('Synthetic native text page ' + (i + 1) + '\n' + 'Representative rows of text.\n'.repeat(8),
          {x: 20, y: 320, size: 12, font});
      }
      const data = Buffer.from(await doc.save());
      await page.reload();
      await expect(page.locator('#pdf-app')).toHaveAttribute('aria-busy', 'false');
      await page.evaluate(() => { window.showOpenFilePicker = undefined; });
      const started = performance.now();
      const [chooser] = await Promise.all([page.waitForEvent('filechooser'),
        page.getByRole('button', {name: 'Open PDF'}).click()]);
      await chooser.setFiles({name: kind + '-' + count + '.pdf', mimeType: 'application/pdf', buffer: data});
      await expect(page.locator('#position')).toHaveText('1 / ' + count);
      const openMs = Math.round(performance.now() - started);
      let peakSampledJs = 0;
      const renderStarted = performance.now();
      for (const index of [Math.ceil(count / 2), count]) {
        await page.getByRole('button', {name: 'Page ' + index, exact: true}).click();
        await expect(page.locator('#position')).toHaveText(index + ' / ' + count);
        const {metrics} = await cdp.send('Performance.getMetrics');
        peakSampledJs = Math.max(peakSampledJs, metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value || 0);
      }
      const residentThumbnails = await page.locator('#pages canvas').evaluateAll(nodes => nodes.filter(node => node.width > 0).length);
      expect(residentThumbnails).toBeLessThan(25);
      measurements.push({kind, pages: count, inputBytes: data.length, openMs,
        twoPageNavigationsMs: Math.round(performance.now() - renderStarted),
        peakSampledMainThreadJsMiB: Math.round(peakSampledJs / (1024 * 1024) * 10) / 10, residentThumbnails});
    }
  }
  const report = {scope: 'Synthetic fixtures. Peak of two sampled renderer JS heaps, excluding workers, WASM and decoded graphics.',
    measurements};
  const dir = process.env.ALLNOTE_SCREENSHOTS || info.outputPath('benchmark');
  mkdirSync(dir, {recursive: true});
  writeFileSync(path.join(dir, 'phase3-benchmark.json'), JSON.stringify(report, null, 2));
  await info.attach('phase3-benchmark', {body: JSON.stringify(report), contentType: 'application/json'});
});
