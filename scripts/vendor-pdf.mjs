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

const ocr = vendor + 'ocr/';
mkdirSync(ocr + 'languages', { recursive: true });
for (const file of ['worker.min.js', 'worker.min.js.LICENSE.txt']) {
  copyFileSync('node_modules/tesseract.js/dist/' + file, ocr + file);
}
copyFileSync('node_modules/tesseract.js/LICENSE.md', ocr + 'LICENSE-tesseract.md');
copyFileSync('node_modules/tesseract.js-core/LICENSE', ocr + 'LICENSE-core.txt');
copyFileSync('node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', ocr + 'tesseract-core-lstm.wasm.js');
for (const language of ['eng', 'hin']) {
  copyFileSync('node_modules/@tesseract.js-data/' + language + '/4.0.0_best_int/' + language + '.traineddata.gz',
    ocr + 'languages/' + language + '.traineddata.gz');
}
copyFileSync('node_modules/@pdf-lib/fontkit/dist/fontkit.umd.min.js', ocr + 'fontkit.js');
copyFileSync('scripts/licenses/pdf-fontkit.txt', ocr + 'LICENSE-fontkit.md');
const font = 'node_modules/@fontsource/noto-sans-devanagari/';
copyFileSync(font + 'LICENSE', ocr + 'OFL-noto-sans-devanagari.txt');
for (const subset of ['latin', 'devanagari']) {
  copyFileSync(font + 'files/noto-sans-devanagari-' + subset + '-400-normal.woff', ocr + subset + '.woff');
}

copyFileSync('node_modules/fflate/esm/browser.js', vendor + 'fflate.mjs');
copyFileSync('node_modules/fflate/LICENSE', vendor + 'LICENSE-fflate.txt');
copyFileSync('scripts/licenses/tessdata-best.txt', ocr + 'LICENSE-tessdata-best.txt');
