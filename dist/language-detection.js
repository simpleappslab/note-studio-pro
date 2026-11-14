/* Bounded, browser-local language detection. No content is executed or uploaded. */
(function (root) {
  'use strict';
  const extensions = {
    js:'javascript',jsx:'javascript',mjs:'javascript',cjs:'javascript',ts:'typescript',tsx:'typescript',
    json:'json',html:'html',htm:'html',css:'css',xml:'xml',svg:'xml',xsl:'xml',xslt:'xml',
    py:'python',sql:'sql',soql:'sql',md:'markdown',markdown:'markdown',yaml:'yaml',yml:'yaml',
    sh:'shell',bash:'shell',zsh:'shell',java:'java',cls:'java',apex:'java',
    c:'cpp',h:'cpp',cpp:'cpp',hpp:'cpp',cc:'cpp',cxx:'cpp',cs:'csharp',ini:'properties',
    properties:'properties',conf:'properties',diff:'diff',patch:'diff',txt:'text',log:'text'
  };
  function fromFilename(name = '') {
    const base = String(name).split(/[\\/]/).pop().toLowerCase();
    if (['.bashrc','.zshrc','.bash_profile'].includes(base)) return 'shell';
    return extensions[base.split('.').pop()] || 'text';
  }
  function detect(content = '', name = '') {
    const hint = fromFilename(name), full = String(content).replace(/^\uFEFF/,'').trim();
    if (!full) return hint;
    const text = full.slice(0,24000), scores = {};
    const add = (language, value) => { scores[language] = (scores[language] || 0) + value; };
    if (/^[{[]/.test(full)) {
      if (full.length <= 65536) {
        try { const parsed = JSON.parse(full); if (parsed && typeof parsed === 'object') return 'json'; } catch {}
      }
      // Also recognise incomplete or large JSON while the user is still editing.
      const keys = text.match(/(?:^|[,{])\s*"(?:[^"\\]|\\.)*"\s*:/g) || [];
      if (keys.length >= 2 || (keys.length && /[}\]]\s*$/.test(full))) add('json',17);
    }
    if (/^#![^\n]*\bpython[\d.]*\b/i.test(text)) return 'python';
    if (/^#![^\n]*\b(?:ba|z|da|k)?sh\b/i.test(text)) return 'shell';
    if (/^<\?xml\b/i.test(text)) return 'xml';
    if (/^<!doctype\s+html\b/i.test(text)) return 'html';
    if (/^<(?:html|head|body|div|span|section|main|script|style|p|button|form|input|table|h[1-6])\b/i.test(text)) return 'html';
    if (/^<[A-Za-z_][\w:.-]*\b/.test(text) && /<\/[\w:.-]+\s*>/.test(text)) return hint === 'html' ? 'html' : 'xml';

    if (/^diff --git\b/m.test(text) || (/^--- .+/m.test(text) && /^\+\+\+ .+/m.test(text) && /^@@ /m.test(text))) add('diff',30);
    if (/<\/?(?:html|head|body|div|span|section|main|script|style|p|button|form|input|table|h[1-6])\b[^>]*>/i.test(text)) add('html',14);
    if (/<([A-Za-z_][\w:.-]*)\b[^>]*>[\s\S]*<\/\1\s*>/.test(text) || /^<(?:svg|[\w.-]+:[\w.-]+)\b/i.test(text)) add('xml',10);

    if (/\b(?:SELECT\s+[\s\S]{1,2000}?\s+FROM\s+[\w."`[]|INSERT\s+INTO\b|UPDATE\s+[\w."`[]+\s+SET\b|DELETE\s+FROM\b|CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|PROCEDURE|FUNCTION)\b)/i.test(text)) add('sql',18);
    if (/^\s*(?:DECLARE\b|BEGIN\s*$)/im.test(text) && /\bEND\s*;/i.test(text)) add('sql',12);

    if (/^\s*(?:async\s+)?def\s+\w+\s*\([^\n]*\)\s*(?:->[^:\n]+)?:/m.test(text)) add('python',18);
    if (/^\s*(?:from\s+[\w.]+\s+import\s+|import\s+[\w.]+\s*$)/m.test(text)) add('python',10);
    if (/^\s*(?:if|elif|for|while|class|with|try|except)\b[^\n]*:\s*(?:#.*)?$/m.test(text)) add('python',8);
    if (/\b(?:print|range|len)\s*\(/.test(text) && /\b(?:True|False|None|self)\b/.test(text)) add('python',7);

    if (/\b(?:export\s+)?(?:interface\s+\w+(?:\s+extends\s+[\w, ]+)?\s*\{|type\s+\w+(?:<[^>\n]+>)?\s*=)/.test(text)) add('typescript',19);
    if (/\b\w+\??\s*:\s*(?:string|number|boolean|unknown|never|any)\b/.test(text)) add('typescript',16);
    if (/\b(?:const|let|var)\s+[\w$[{][^\n]{0,180}=/.test(text)) add('javascript',9);
    if (/\b(?:async\s+)?function\s*[\w$]*\s*\(/.test(text) || /=>\s*(?:[{(]|[\w$])/.test(text)) add('javascript',10);
    if (/\b(?:console\.(?:log|error|warn)|document\.(?:querySelector|getElementById)|JSON\.(?:parse|stringify))\s*\(/.test(text)) add('javascript',9);
    if (/\b(?:import\s+[^\n]+\s+from\s+['"]|export\s+(?:default|function|const|class)\b)/.test(text)) add('javascript',10);

    if (/^\s*#\s*include\s*[<"]|\bstd::|\busing\s+namespace\s+std\b/m.test(text)) add('cpp',25);
    if (/\b(?:int|void)\s+main\s*\(/.test(text)) add('cpp',12);
    if (/^\s*using\s+(?:System|Microsoft)(?:[.;\s])/m.test(text) || /\bConsole\.Write(?:Line)?\s*\(/.test(text)) add('csharp',23);
    if (/\bnamespace\s+[\w.]+\s*[{;]/.test(text)) add('csharp',12);
    if (/\b(?:public|private|protected)\s+(?:static\s+)?(?:class|interface)\s+\w+/.test(text)) { add('java',4); add('csharp',4); }
    if (/\bSystem\.out\.|^\s*(?:package\s+[\w.]+\s*;|import\s+java\.)|\bpublic\s+static\s+void\s+main\s*\(/m.test(text)) add('java',23);
    if (/\b(?:with|without|inherited)\s+sharing\s+class\b|@(?:AuraEnabled|InvocableMethod)\b|\bSystem\.debug\s*\(/.test(text)) add('java',20);

    const properties = text.match(/(?:^|[;{\n])\s*(?:--[\w-]+|color|background(?:-[\w-]+)?|display|margin(?:-[\w-]+)?|padding(?:-[\w-]+)?|font(?:-[\w-]+)?|width|height|border(?:-[\w-]+)?|position|align-items|justify-content)\s*:/g) || [];
    if (properties.length && /(?:^|[}\n])\s*(?:[.#][\w-]|:[\w-]|[a-z]|@(?:media|supports|keyframes|layer))[^{}\n;=]*\{/.test(text)) add('css',16);

    if (/^\s*(?:echo|printf|export|source|chmod|mkdir|curl|wget|sudo|apt-get)\s+[^\n]+/m.test(text)) add('shell',9);
    if (/\b(?:then|fi|esac|done)\s*(?:[;\n]|$)/m.test(text) && /\b(?:if|for|case|while)\b/.test(text)) add('shell',12);
    if (/\$\{?[A-Za-z_]\w*\}?/.test(text) && /^\s*[A-Z_][A-Z_\d]*=/m.test(text)) add('shell',7);

    const yamlKeys = text.match(/^\s*(?:[\w.-]+|"[^"\n]+"|'[^'\n]+'):\s+(?:[^\n]*)$/gm) || [];
    if (!/^[{[]/.test(text) && yamlKeys.length >= 2 && !/;\s*$/m.test(text)) add('yaml',12);
    if (/^---\s*$/m.test(text) && (yamlKeys.length || /^\s*-\s+\S/m.test(text))) add('yaml',14);
    const iniKeys = text.match(/^\s*[\w.-]+\s*=\s*[^\n]+$/gm) || [];
    if (iniKeys.length >= 2 && !/^\s*(?:const|let|var|def|function|export)\b/m.test(text) && !/[;{}]\s*$/m.test(text)) add('properties',10);
    if (/^\s*\[[\w .:-]+\]\s*$/m.test(text) && iniKeys.length) add('properties',16);
    if (/^#{1,6}\s+\S/m.test(text)) add('markdown',8);
    if (/^\s*```[\w-]*\s*$/m.test(text) || (text.includes('](http') && /\[[^\]\n]{1,500}\]\(https?:\/\/[^)\n]{1,1000}\)/.test(text))) add('markdown',12);
    if (/^\s*(?:[-*+] |\d+\. )\S/m.test(text) && /\*\*[^*\n]+\*\*|^#{1,6}\s+/m.test(text)) add('markdown',5);

    const ranked = Object.entries(scores).sort((a,b) => (b[1] + (b[0] === hint ? 2 : 0)) - (a[1] + (a[0] === hint ? 2 : 0)));
    return ranked.length && ranked[0][1] >= 8 ? ranked[0][0] : hint;
  }
  const api = {detect,fromFilename};
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NotepadLanguage = api;
})(typeof self === 'object' ? self : globalThis);
