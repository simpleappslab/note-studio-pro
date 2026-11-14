import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const output=path.resolve(process.argv[2]||path.join(root,'release'));
await mkdir(output,{recursive:true});
function run(command,args){return new Promise((resolve,reject)=>{const proc=spawn(command,args,{cwd:root,stdio:'inherit'});proc.on('error',reject);proc.on('close',code=>code===0?resolve():reject(Error(command+' exited with '+code)));});}
await run(process.execPath,[path.join(root,'scripts','build-pwa.mjs')]);
await run(process.platform==='win32'?'python':'python3',[path.join(root,'scripts','package-web.py'),root,output,pkg.version]);
