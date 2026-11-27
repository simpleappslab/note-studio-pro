import {cpSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';

const target = 'mobile-build';
rmSync(target, {recursive: true, force: true});
cpSync('dist', target, {
  recursive: true,
  filter: source => !/(?:^|\/)(?:sw\.js|pwa\.js|pwa\.css|app\.webmanifest|\.nojekyll)$/.test(source),
});

const bridge = '  <script defer src="native-files.js"></script>\n';
const notes = target + '/index.html';
const pwaMarkup = /<!-- PWA_(HEAD|SCRIPT|HEADER|DIALOG)_START -->[\s\S]*?<!-- PWA_\1_END -->/g;
const notesHtml = readFileSync(notes, 'utf8').replace(pwaMarkup, '');
const notesEntry = '  <script defer src="app.js"></script>';
if (!notesHtml.includes(notesEntry)) throw Error('Notes entry script not found.');
writeFileSync(notes, notesHtml.replace(notesEntry, bridge + notesEntry));

const studio = target + '/pdf-studio.html';
const entry = '  <script type="module" src="pdf-studio.mjs"></script>';
const html = readFileSync(studio, 'utf8');
if (!html.includes(entry)) throw Error('PDF Studio entry script not found.');
writeFileSync(studio, html.replace(entry, bridge + entry));
cpSync('mobile/native-files.js', target + '/native-files.js');

const ocr = target + '/vendor/ocr/';
const core = ocr + 'tesseract-core-lstm.wasm.js';
const worker = ocr + 'worker.min.js';
// Native WebViews can load the entry worker while failing nested importScripts requests.
writeFileSync(ocr + 'native-ocr-worker.js', readFileSync(core, 'utf8') + '\n' + readFileSync(worker, 'utf8'));
rmSync(core);
rmSync(worker);

// Android's asset packager treats a .gz suffix specially. Preserve the gzip
// bytes under a regular binary filename; Tesseract detects the gzip signature.
for (const language of ['eng', 'hin']) {
  const model = ocr + 'languages/' + language + '.traineddata';
  renameSync(model + '.gz', model + '.bin');
}
