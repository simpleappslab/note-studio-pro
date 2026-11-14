const assert=require('node:assert/strict');
const {render}=require('../dist/markdown-core.js');
let cases=0;
function check(source,pattern){assert.match(render(source).html,pattern);cases++;}
check('# Title\n\n## Details',/<h1 id="md-h-title">Title<\/h1>/);
check('**bold** and *italic* and ~~gone~~',/<strong>bold<\/strong>.*<em>italic<\/em>.*<s>gone<\/s>/s);
check('- one\n  - nested\n\n1. first\n2. second',/<ul>.*<ul>.*nested.*<ol>/s);
check('> quoted\n\n---',/<blockquote>.*quoted.*<hr>/s);
check('```js\nconst x = "<script>";\n```',/<pre><code class="language-js">.*&lt;script&gt;.*<\/code><\/pre>/s);
check('| Name | Status |\n| --- | --- |\n| Preview | Ready |',/<table>.*<th>Name<\/th>.*<td>Ready<\/td>/s);
check('- [x] shipped\n- [ ] next',/<input[^>]*checked=""[^>]*disabled="".*<input[^>]*disabled=""/s);
check('[Website](https://example.com)',/<a href="https:\/\/example.com" target="_blank" rel="noopener noreferrer">Website<\/a>/);
check('https://example.com',/<a href="https:\/\/example.com"/);
check('[Go](#title)',/<a href="#title">Go<\/a>/);
const headings=render('# Hello\n# Hello\n# Hello-2\n# नमस्ते');
assert.equal(headings.headings,4);
assert.equal(new Set([...headings.html.matchAll(/id="([^"]+)"/g)].map(x=>x[1])).size,4);cases++;
for(const source of [
  '<script>alert(1)</script>',
  '<img src=x onerror=alert(1)>',
  '<svg onload=alert(1)>',
  '[x](javascript:alert%281%29)',
  '[x](java&#x73;cript:alert%281%29)',
  '[x](vbscript:msgbox%281%29)',
  '[x](data:text/html;base64,PHNjcmlwdD4=)',
  '![x](data:image/svg+xml;base64,PHN2Zy8+)',
  '![" onerror="alert(1)](https://example.com/image.png)',
  '```html\n</code><img src=x onerror=alert(1)>\n```'
]){
  const {html}=render(source);
  assert.doesNotMatch(html,/<script\b|<svg\b|<(?:img|a|input)\b[^>]*\son(?:error|load|focus)=/i);
  assert.doesNotMatch(html,/<a\b[^>]*href="(?:javascript|vbscript|data):/i);cases++;
}
const external=render('![Diagram](https://example.com/private.png)');
assert.equal(external.imagesLinked,1);assert.doesNotMatch(external.html,/<img\b/);assert.match(external.html,/rel="noopener noreferrer"/);cases++;
check('![Pixel](data:image/png;base64,iVBORw0KGgo=)',/<img src="data:image\/png;base64,iVBORw0KGgo=" alt="Pixel" loading="lazy">/);
assert.equal(render('').html,'');cases++;
assert.throws(()=>render('x'.repeat(5*1024*1024+1)),/5 MB/);cases++;
assert.match(render('\uFEFF# BOM').html,/<h1/);cases++;
const large=render(('# Heading\n\nParagraph with **bold** and `code`.\n\n').repeat(3000));
assert.equal(large.headings,3000);cases++;
console.log(JSON.stringify({markdownCases:cases,largeHeadings:large.headings,largeHTML:large.html.length}));
