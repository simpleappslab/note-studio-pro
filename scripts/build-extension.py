from pathlib import Path
from PIL import Image
import argparse
import hashlib, json, re, shutil, subprocess, zipfile

parser = argparse.ArgumentParser(description='Package the offline Chrome extension.')
parser.add_argument('--output', type=Path, required=True, help='Destination ZIP outside the source checkout')
args = parser.parse_args()
source = Path(__file__).resolve().parent.parent / 'dist'
subprocess.run(['node', 'scripts/vendor-pdf.mjs'], cwd=source.parent, check=True)
output = args.output.resolve()
output.parent.mkdir(parents=True, exist_ok=True)
build = output.parent / 'extension-build' / 'note-studio-pro'
build.mkdir(parents=True, exist_ok=True)
for name in ['pi-mask.js', 'transpose-core.js', 'transpose.js', 'transpose.css', 'json-preview-core.js', 'json-preview.js', 'json-preview.css', 'app.js', 'index.html', 'styles.css', 'diff.css', 'diff-core.js', 'diff-checker.js', 'diff-worker.js', 'language-detection.js', 'schema-core.js', 'schema-ui.js', 'schema-worker.js', 'schema.css', 'occurrence-highlight.js', 'markdown-core.js', 'markdown-preview.js', 'markdown-worker.js', 'markdown.css', 'brand.css', 'pdf-studio.html', 'pdf-studio.css', 'pdf-studio.mjs', 'pdf-studio-core.js', 'pdf-qpdf-worker.js', 'pdf-intelligence.mjs', 'pdf-pi-worker.js', 'pdf-properties.mjs', 'pdf-text-edit.mjs', 'pdf-compare.mjs', 'pdf-batch.mjs']:
    shutil.copy2(source / name, build / name)
shutil.copytree(source / 'vendor', build / 'vendor', dirs_exist_ok=True)
shutil.copytree(source / 'assets', build / 'assets', dirs_exist_ok=True)

csp = "script-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; connect-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self';"
html = (build / 'index.html').read_text()
html = html.replace('<title>Note Studio Pro · Browser workspace</title>', '<title>Note Studio Pro</title>')
for section in ['HEAD','SCRIPT','HEADER','DIALOG']:
    html = re.sub(r'<!-- PWA_' + section + r'_START -->.*?<!-- PWA_' + section + r'_END -->', '', html, flags=re.S)
html = html.replace('WEB WORKSPACE', 'CHROME EXTENSION').replace('Local workspace', 'Offline workspace')
html = html.replace('<meta name="viewport" content="width=device-width,initial-scale=1">', '<meta name="viewport" content="width=device-width,initial-scale=1">\n  <meta http-equiv="Content-Security-Policy" content="' + csp + '">')
html = re.sub(r'<link rel="icon"[^>]*>', '<link rel="icon" href="icons/icon48.png">', html)
(build / 'index.html').write_text(html)
js = (build / 'app.js').read_text()
js = js.replace('A little space for your notes, code, and next idea. A familiar editing experience, with no installation.', 'A little space for your notes, code, and next idea. A familiar editing experience, available offline in Chrome.')
js = js.replace('Powered by <a href="https://codemirror.net/5/"', '<a href="privacy.html" target="_blank" rel="noopener">Privacy policy</a> · Powered by <a href="https://codemirror.net/5/"')
(build / 'app.js').write_text(js)

manifest = {
    'manifest_version': 3,
    'name': 'Note Studio Pro',
    'short_name': 'Note Studio',
    'version': '1.8.0',
    'description': 'Offline text and code editor with tabs, syntax highlighting, diff, live Markdown preview, JSON Schema/OpenAPI, and local drafts.',
    'minimum_chrome_version': '116',
    'icons': {str(n): f'icons/icon{n}.png' for n in [16, 32, 48, 128]},
    'action': {
        'default_title': 'Open Note Studio Pro',
        'default_icon': {str(n): f'icons/icon{n}.png' for n in [16, 32, 48, 128]}
    },
    'background': {'service_worker': 'background.js'},
    'homepage_url': 'https://notepad-workbench-ramakant.ramsmahobia.chatgpt.site/',
    'content_security_policy': {'extension_pages': csp.replace(
        "script-src 'self'", "script-src 'self' 'wasm-unsafe-eval'").replace(
        "connect-src 'none'", "connect-src 'self'").replace("font-src 'self';", "font-src 'self' data:;")}
}
(build / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')

(build / 'background.js').write_text('''// Only extension-owned editor contexts are inspected. No page access is requested.
let opening;
chrome.action.onClicked.addListener(() => {
  if (opening) return;
  opening = openEditor().catch(error => console.error('Could not open Note Studio Pro:', error))
    .finally(() => { opening = null; });
});

async function openEditor() {
  const url = chrome.runtime.getURL('index.html');
  const contexts = await chrome.runtime.getContexts({contextTypes: ['TAB'], documentUrls: [url]});
  const existing = contexts.find(context => context.tabId >= 0);
  if (existing) {
    try {
      await chrome.tabs.update(existing.tabId, {active: true});
    } catch {
      await chrome.tabs.create({url});
      return;
    }
    try { await chrome.windows.update(existing.windowId, {focused: true}); } catch {}
    return;
  }
  await chrome.tabs.create({url});
}
''')

# Resize the supplied brand symbol for Chrome's required icon sizes.
(build / 'icons').mkdir(parents=True, exist_ok=True)
mark = Image.open(source / 'assets' / 'note-studio-pro-mark.png').convert('RGBA')
for size in [16, 32, 48, 128]:
    mark.resize((size, size), Image.Resampling.LANCZOS).save(build / 'icons' / f'icon{size}.png')

(build / 'privacy.html').write_text('''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Note Studio Pro — Privacy</title>
<style>body{font:16px/1.7 system-ui,sans-serif;color:#26363f;background:#f6f8fa;max-width:760px;margin:50px auto;padding:0 24px}h1{font-size:28px}h2{font-size:19px;margin-top:30px}a{color:#167a9b}small{color:#75858f}</style></head>
<body><h1>Note Studio Pro — Privacy policy</h1><small>Extension version 1.8.0 · Effective 14 November 2026</small>
<p>Note Studio Pro is a text and code editor that processes documents locally in your browser. This policy covers the packaged Chrome extension.</p>
<h2>Documents and settings</h2><p>Files you choose to open, document contents, draft names, bookmarks, and editor settings are processed on your device. The extension saves drafts and settings in local browser storage so that you can return to them. It does not upload your documents, send them to the publisher, or include analytics or advertising.</p>
<h2>Clipboard</h2><p>Copy-all commands write the chosen document contents to your device clipboard when you click them. The extension does not read your clipboard.</p>
<h2>Files and backups</h2><p>Open reads only the files you explicitly select or drag into the editor. PDF Studio edits PDF files in memory. Save writes to the original PDF when you grant file access. Save As creates a local copy, using a download if a save picker is unavailable. Note exports create downloads at your request. Backup files contain document contents and should be handled as private files.</p>
<h2>Browser access</h2><p>The extension does not request access to websites, browsing history, cookies, or your Google account. Clicking its toolbar icon opens or focuses its own editor tab. It does not replace the Chrome New Tab page.</p>
<h2>Retention and deletion</h2><p>Drafts remain in this Chrome profile until removed from the workspace, extension data is cleared, or the extension is uninstalled. Export a backup before uninstalling or clearing data. Drafts in the website and the extension are separate; use Export and Import to move a workspace.</p>
<h2>External links</h2><p>Help and attribution links open only when selected. Those websites have their own policies. Chrome Web Store distribution and Google services are governed by Google's policies.</p>
<h2>Questions and changes</h2><p>Use the publisher contact shown on the Chrome Web Store listing. If the extension's data handling changes, this policy should be updated with the release.</p>
</body></html>''')

(build / 'PUBLISHING.md').write_text('''# Note Studio Pro — extension handoff

This is an independent editor inspired by Notepad++. It is not affiliated with the Notepad++ project.

## What this package contains

Manifest V3 extension, version 1.8.0, for Chrome 116 or later. Clicking the extension toolbar icon opens the editor in a full Chrome tab, or focuses an editor tab that is already open. It includes its JavaScript, styles, language modes, icons, and bundled third-party license notices. Editing runs locally and does not require a connection after installation.

No website access, browsing-history, cookies, account, or downloads API permissions are requested. File downloads use ordinary browser downloads. The Chrome New Tab page is not replaced.

## Try it on a device where you are allowed to install extensions

1. Extract the ZIP to a folder.
2. Open chrome://extensions in Chrome.
3. Enable Developer mode, choose Load unpacked, and select the folder containing manifest.json.
4. Pin Note Studio Pro and click its toolbar icon.

If your company manages Chrome and blocks extensions or developer mode, follow your company's policy; use the hosted browser app instead. A store listing does not override an administrator's restrictions.

## Bring across existing website drafts

In the website, choose File → Export workspace. In the extension, choose File → Import workspace and select that backup. Import adds documents to the current workspace. Website and extension storage are separate. Save or export a backup before uninstalling the extension.

## Update an unpacked installation\n\n1. Export a workspace backup before updating.\n2. Close the extension editor tab. Extract this ZIP over the contents of the same extension folder you originally loaded. Keep the folder path unchanged to retain the unpacked extension identity.\n3. Open chrome://extensions and click Reload for Note Studio Pro. Reopen it from the toolbar.\n4. Choose Diff in the toolbar, Tools → Diff checker, or Ctrl+Alt+D (Cmd+Alt+D on Mac).\n\nVersion 1.7.0 introduces the Note Studio Pro name, supplied logo and teal/blue icons. Existing local drafts and earlier workspace backups remain compatible. Version 1.6.0 added live Markdown preview beside the source. Open it with the eye icon, View → Markdown preview, or Ctrl+Alt+M (Cmd+Alt+M on Mac). It follows the active tab and supports headings, tables, task lists, links and code blocks. Rendering works offline. Raw HTML stays escaped, unsafe link schemes are rejected, and external images appear as links. Double-click occurrence highlighting remains available. Double-click a word to highlight every exact, case-sensitive occurrence in the current document, including both linked split views. Click elsewhere, change the selection, edit, switch tabs, or press Escape to clear. Highlights remain while scrolling and do not modify document text. JSON → Schema remains in Quick Tools and the Tools menu. Generate JSON Schema (2020-12, 2019-09, Draft 07/06/04), OpenAPI 3.0/3.1/3.2, and Swagger 2.0 schemas from JSON. Copy, download JSON/YAML, or open output in a new tab. API targets can produce starter documents with reusable components. Review inferred required fields, formats and enum restrictions. Swagger 2.0 uses x-nullable and widens unsupported unions with generation notes. Automatic language detection and manual overrides remain available. No additional permissions are requested.\n\n## JSON → Schema\n\nOpen Generate schema in Quick Tools or Tools → Generate JSON Schema / OpenAPI from JSON. JSON input may come from an open tab, file or pasted text. Nested objects, heterogeneous arrays, nulls and primitive roots are supported. Require common fields, additional properties, format detection, enums, examples and multiple root samples are configurable. API documents contain reusable schemas only; add paths, servers and authentication details separately. All generation runs offline.\n\n## Publish in the Chrome Web Store

1. Register your Chrome Web Store developer account and complete its account requirements. Google requires a one-time registration fee; use the amount displayed in the dashboard. The account owner should accept the developer agreement and complete payment personally.
2. In the developer dashboard, create a new item and upload this ZIP. manifest.json is already at the ZIP root.
3. Enter the store listing below; add genuine screenshots from an installed copy and the 128px icon supplied in this package. Choose the category and distribution countries that fit your release.
4. Publish privacy.html at a public HTTPS URL under your control and enter that URL in the listing as required. The policy text is supplied, but no public privacy-policy URL has been deployed by this packaging task. Add your publisher/support contact to the account and listing; the supplied policy refers readers to that contact.
5. Complete the Privacy tab accurately. Single purpose: local text and code editing. This version does not collect or transmit document content, browsing activity, or personal information. Review the current form and declarations yourself rather than accepting certifications blindly.
6. Test the unpacked extension, including toolbar opening, file open/download, local recovery, workspace import/export, diff comparisons, matching highlights, full-text copying from each pane and the main editor, automatic language changes, persistence of manual language choices, patch download, schema inference, JSON/YAML schema downloads, generated tabs, and offline use. Browser extension installation was not available in the build environment; installed-extension behavior has not been verified here.
7. Submit for Google's review. Approval and review timing are Google's decision; the package has not been submitted or approved.

Official guides:
- https://developer.chrome.com/docs/webstore/register
- https://developer.chrome.com/docs/webstore/publish/
- https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code

## Store listing\n\nUse STORE-LISTING.txt for the complete name, short description and detailed feature description.\n\n## Validation performed

Checked JavaScript syntax, packaged-file references, icon dimensions, ZIP layout, required manifest fields, and absence of remotely loaded executable code and inline HTML event handlers. The website's editing flow and the new diff comparison, whitespace ignoring, swap, and navigation were browser-tested. Automatic JSON detection with immediate formatting, SQL detection, manual override persistence across reload, returning to Auto mode, and independent SQL/JSON detection in the diff panes were browser-tested. Local detection fixtures cover all 17 supported modes and a large-input check. Exact clipboard contents were checked for both diff panes and the main editor, including a Unicode sample and copying with a partial selection. Matching highlighting was checked both enabled and disabled, with change highlights retained. Synthetic patch contents were round-trip checked against the patch utility, including empty text and final-newline changes. Markdown renderer fixtures cover tables, nested lists, task lists, heading anchors, code fences, Unicode, external image handling, unsafe links and escaped source HTML. The QA browser did not expose download events for either patch export or the existing Save action, so actual downloaded files still need checking on an installed copy. The schema generator was browser-tested with JSON and OpenAPI YAML output, opening a generated YAML tab, copying the full output and pasting it back as valid JSON, invalid-input errors with exports disabled, and an actual JSON schema download whose contents were parsed and checked. The schema engine passed 573 interoperability fixtures across nine standards using JSON Schema/OpenAPI validators and YAML round trips; core inference checks cover required fields, mixed arrays, nulls, prototype-like keys and bounded large input. Double-click occurrence highlighting was browser-tested in light and dark themes, in both linked split views, after scrolling, with exact case-sensitive matches, Unicode words, and literal punctuation. Clicking elsewhere, Escape, tab changes and edits cleared highlights. Highlighting left the document contents unchanged. Live Markdown preview was browser-tested with tables, task lists, fenced code, edits, undo, active-tab changes, heading links, empty documents, toolbar/menu/keyboard controls and switching between preview and linked split view. Browser checks confirmed raw HTML stayed inactive, javascript links were not created and external images did not load automatically. Chrome-extension loading and store review remain separate checks.
''')

(build / 'STORE-LISTING.txt').write_text((source.parent / 'CHROME_WEB_STORE_LISTING.txt').read_text())

with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(build.rglob('*')):
        if path.is_file():
            archive.write(path, path.relative_to(build).as_posix())
print(json.dumps({'archive': str(output), 'bytes': output.stat().st_size, 'files': len(list(build.rglob('*'))), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}))
