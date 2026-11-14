import {readFileSync,writeFileSync,copyFileSync,readdirSync} from 'node:fs';
const root='node_modules/codemirror/';
const scripts=['lib/codemirror.js','mode/xml/xml.js','mode/javascript/javascript.js','mode/css/css.js','mode/htmlmixed/htmlmixed.js','mode/clike/clike.js','mode/python/python.js','mode/sql/sql.js','mode/markdown/markdown.js','mode/yaml/yaml.js','mode/shell/shell.js','mode/diff/diff.js','mode/properties/properties.js','addon/edit/matchbrackets.js','addon/edit/closebrackets.js','addon/edit/trailingspace.js','addon/selection/active-line.js','addon/search/searchcursor.js','addon/comment/comment.js','addon/fold/foldcode.js','addon/fold/foldgutter.js','addon/fold/brace-fold.js','addon/fold/xml-fold.js','addon/fold/indent-fold.js','addon/fold/markdown-fold.js','addon/fold/comment-fold.js','addon/hint/show-hint.js','addon/hint/anyword-hint.js','addon/display/placeholder.js'];
writeFileSync('dist/vendor/editor.js',scripts.map(p=>readFileSync(root+p,'utf8')).join('\n;\n'));
writeFileSync('dist/vendor/editor.css',['lib/codemirror.css','addon/fold/foldgutter.css','addon/hint/show-hint.css'].map(p=>readFileSync(root+p,'utf8')).join('\n'));
copyFileSync(root+'LICENSE','dist/vendor/LICENSE-CodeMirror.txt');
copyFileSync('node_modules/markdown-it/dist/browser/markdown-it.umd.min.js','dist/vendor/markdown-it.js');
copyFileSync('node_modules/markdown-it-task-lists/dist/markdown-it-task-lists.min.js','dist/vendor/markdown-task-lists.js');
copyFileSync('node_modules/markdown-it/LICENSE','dist/vendor/LICENSE-markdown-it.txt');
copyFileSync('node_modules/markdown-it-task-lists/LICENSE','dist/vendor/LICENSE-markdown-task-lists.txt');
const notices=[],visited=new Set();
function markdownNotices(name){
  if(visited.has(name))return;visited.add(name);
  const folder='node_modules/'+name+'/',pkg=JSON.parse(readFileSync(folder+'package.json','utf8'));
  for(const file of readdirSync(folder).filter(name=>/^licen[cs]e(?:[.-]|$)/i.test(name)))notices.push(name+' '+pkg.version+'\n\n'+readFileSync(folder+file,'utf8'));
  for(const dependency of Object.keys(pkg.dependencies||{}))markdownNotices(dependency);
}
markdownNotices('markdown-it');markdownNotices('markdown-it-task-lists');
writeFileSync('dist/vendor/LICENSE-Markdown-dependencies.txt',notices.join('\n\n--------------------\n\n'));
console.log('Self-hosted editor assets prepared.');
