import {cpSync,copyFileSync,mkdirSync,existsSync} from 'node:fs';
const root='node_modules/pdfjs-dist/',dest='dist/vendor/pdfjs/';
mkdirSync(dest,{recursive:true});
for(const f of ['pdf.mjs','pdf.worker.mjs'])copyFileSync(root+'build/'+f,dest+f);
for(const d of ['cmaps','standard_fonts'])if(existsSync(root+d))cpSync(root+d,dest+d,{recursive:true});
copyFileSync(root+'LICENSE',dest+'LICENSE');
copyFileSync('node_modules/pdf-lib/dist/pdf-lib.min.js','dist/vendor/pdf-lib.min.js');
copyFileSync('node_modules/pdf-lib/LICENSE.md','dist/vendor/LICENSE-pdf-lib.md');
