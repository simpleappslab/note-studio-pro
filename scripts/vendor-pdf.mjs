import { cpSync, copyFileSync, mkdirSync } from 'node:fs';

const pdfjs = 'node_modules/pdfjs-dist/';
const qpdf = 'node_modules/@wasm-zoo/qpdf/';
const vendor = 'dist/vendor/';
mkdirSync(vendor + 'pdfjs', { recursive: true });
mkdirSync(vendor + 'qpdf', { recursive: true });
for (const file of ['pdf.mjs', 'pdf.worker.mjs']) {
  copyFileSync(pdfjs + 'legacy/build/' + file, vendor + 'pdfjs/' + file);
}
for (const dir of ['cmaps', 'standard_fonts', 'iccs', 'wasm']) {
  cpSync(pdfjs + dir, vendor + 'pdfjs/' + dir, { recursive: true });
}
copyFileSync(pdfjs + 'LICENSE', vendor + 'pdfjs/LICENSE');
copyFileSync('node_modules/pdf-lib/dist/pdf-lib.min.js', vendor + 'pdf-lib.min.js');
copyFileSync('node_modules/pdf-lib/LICENSE.md', vendor + 'LICENSE-pdf-lib.md');
for (const file of ['qpdf-core.js', 'qpdf-core.wasm', 'LICENSE', 'LICENSE.wasm-zoo.txt', 'provenance.json', 'sbom.cdx.json']) {
  copyFileSync(qpdf + file, vendor + 'qpdf/' + file);
}
cpSync(qpdf + 'LICENSES', vendor + 'qpdf/LICENSES', { recursive: true });
