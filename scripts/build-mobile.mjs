import {cpSync, readFileSync, rmSync, writeFileSync} from 'node:fs';

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
