import {readFile,writeFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dist=path.join(root,'dist');
const marker=/<meta name="note-studio-build" content="[^"]*">/;
async function walk(directory){
 const files=[];
 for(const entry of await readdir(directory,{withFileTypes:true})){
  if(entry.name.startsWith('.'))continue;
  const file=path.join(directory,entry.name);
  if(entry.isDirectory())files.push(...await walk(file));
  else if(entry.isFile()&&entry.name!=='sw.js')files.push(file);
 }
 return files;
}
const files=(await walk(dist)).sort();
const rows=[];
for(const file of files){
 let bytes=await readFile(file);
 if(path.basename(file)==='index.html')bytes=Buffer.from(bytes.toString().replace(marker,'<meta name="note-studio-build" content="BUILD">'));
 rows.push([path.relative(dist,file).split(path.sep).join('/'),createHash('sha256').update(bytes).digest('hex')]);
}
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const digest=createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0,16);
const version=pkg.version+'-'+digest;
const indexFile=path.join(dist,'index.html');
const html=await readFile(indexFile,'utf8');
if(!marker.test(html))throw Error('The app build marker is missing.');
await writeFile(indexFile,html.replace(marker,'<meta name="note-studio-build" content="'+version+'">'));
const assets=[];
for(const file of files){
 const url=path.relative(dist,file).split(path.sep).join('/');
 const bytes=await readFile(file);
 // Hosting can add preview metadata to HTML. Validate its build marker at runtime.
 assets.push({url,integrity:url==='index.html'?null:'sha256-'+createHash('sha256').update(bytes).digest('base64')});
}
const template=await readFile(path.join(root,'scripts','sw-template.js'),'utf8');
await writeFile(path.join(dist,'sw.js'),template.replace('__PWA_VERSION__',JSON.stringify(version)).replace('__PWA_ASSETS__',JSON.stringify(assets,null,2)));
console.log(JSON.stringify({version,assets:assets.length,scope:'relative to hosting path',integrity:'SHA-256 assets and exact HTML build marker'}));
