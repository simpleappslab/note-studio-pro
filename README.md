# Note Studio Pro

Note Studio Pro is a browser-local text and code editor inspired by Notepad++. An independent implementation, not affiliated with the Notepad++ project.

## Installable app and offline use

Open [Note Studio Pro](https://simpleappslab.github.io/note-studio-pro/) and choose **Install app**. Chrome and Edge can open it in a separate app window; Safari on Mac offers **File → Add to Dock**.

Wait for **Available offline** before disconnecting. Offline support includes the editor, all language modes, diff, Markdown preview and schema generation. Drafts stay local. Use workspace export/import when moving between web addresses.

Version 1.8.0 adds branded install guidance, offline readiness, content-checked caching and draft-preserving updates. Read **PWA-DISTRIBUTION.md** for release and hosting instructions. GitHub-ready release archives are produced by **npm run package:web**.

## Run

Serve `dist/` with any static HTTP server. All editor assets are included; no CDN is required. `node scripts/vendor.mjs` regenerates the vendored editor assets after `npm install`.

## Features

- Multiple documents with independent undo history, rename, duplicate, and close protection.
- Syntax highlighting for 17 language modes, code folding, matching brackets, word completion, line bookmarks, and linked split views.
- Find and replace with case, whole-word, and regular-expression options and capture-group substitutions.
- Double-click a word to highlight all exact, case-sensitive occurrences of the selected text in the current document, including both linked split views. Click elsewhere, move the selection, edit, switch tabs or press Escape to clear. Matching uses literal text and stays active while scrolling; document contents are unchanged.
- JSON validation, formatting and minification; indentation, line sorting, duplicate removal, case conversion, whitespace cleanup.
- UTF-8 file opening, drag and drop, download saving, LF/CRLF output, local draft restoration, and workspace backup import/export.
- Light/dark theme, font size, indentation settings, word wrap, line numbers, document map, focus mode, keyboard shortcuts and a command palette.

## Markdown preview

Click the eye icon in the toolbar, choose **View → Markdown preview**, or press **Ctrl+Alt+M** (Cmd+Alt+M on Mac). A live preview opens beside the source and follows the active document. On narrow screens it appears below the editor. The preview supports headings, emphasis, links, nested lists, task lists, blockquotes, fenced code, tables and strikethrough. Heading links navigate within the preview. Opening linked split view closes Markdown preview, and vice versa.

Rendering runs locally in a bundled worker, including offline in the extension. Source text and undo history are preserved. Raw HTML is displayed as text, unsafe link schemes are rejected, and external images appear as links to avoid automatic network requests. Embedded PNG/JPEG/GIF/WebP data images can render inline. The preview supports source documents up to 5 MB and generated HTML up to 8 MB.

## Automatic language detection

New documents detect their language from pasted or typed content and set syntax highlighting automatically. Recognisable content takes priority; the filename is used when content is ambiguous. Detection supports the editor’s existing 17 language modes, including JSON, SQL/SOQL, JavaScript, TypeScript, Python, HTML, XML, CSS, YAML and Apex (Java highlighting). Each diff pane also detects its language.

The status bar shows the language with an Auto badge. Choosing a language manually locks it for that document. Choose **Language → Auto-detect language** to resume. The choice is retained across reloads, workspace backups and duplicates. Detection uses a bounded local sample and does not upload content. Ambiguous snippets can require a manual choice.

## Diff checker

Open **Diff** on the toolbar, **Tools → Diff checker**, or press **Ctrl+Alt+D** (Cmd+Alt+D on Mac). Compare editable copies of open tabs, local UTF-8 files, or pasted text. Added and removed lines are highlighted, gaps align the two versions, and Previous/Next jumps between changes. Optional spaces/tabs ignoring and synchronized scrolling are available. Enable **Highlight matching text** to highlight matching lines in blue on both sides; additions and removals retain their colours. Each pane has a copy-all icon that copies its entire text. The main toolbar and Edit menu also offer **Copy all text** for the active document. Copying preserves the current selection and does not change the text. Export .diff downloads an exact unified patch, including whitespace changes even if hidden in the view. Source tabs are unchanged; comparison copies are kept until reload.

Comparison supports up to 5 MB and 100,000 lines per side. A bundled Web Worker handles the comparison. Large repetitive regions may be grouped to bound memory and processing. All changed text is retained in the result and exported patch.

## JSON to Schema

Open **Generate schema** in Quick Tools, **Tools → Generate JSON Schema / OpenAPI from JSON**, or search for “schema” in the command palette. Use an open document, a local JSON file, pasted JSON or the included example. Generation runs locally in a bundled Web Worker and leaves the source document unchanged.

Choose JSON Schema 2020-12, 2019-09, Draft 07, Draft 06 or Draft 04; OpenAPI 3.2, 3.1 or 3.0; or Swagger/OpenAPI 2.0. API targets can produce a standalone Schema Object or a starter OpenAPI document containing a reusable component (a definition for Swagger 2.0). JSON input cannot reveal API operations, servers or authentication; supply these details separately. Copy the complete output, download JSON/YAML, or open it in a new editor tab.

Objects and arrays are inferred recursively. Mixed values produce unions, numeric samples combine integers and decimals, and object fields are merged across all samples at the same location. **Require common fields** requires only fields present in every relevant object sample. **Root array = multiple samples** describes each root item as a separate example; with it off, the root remains an array. Options control additional properties, format detection, enum restrictions and example annotations.

Review the inferred contract before using it with new data. An empty array cannot establish its item type; null alone cannot reveal an intended non-null type. OpenAPI 3.0 uses `nullable` for null values. Swagger 2.0 uses the tool-specific `x-nullable` extension and cannot express mixed-type unions: those nodes accept any value, retain alternatives in `x-inferred-anyOf`, and show a generation note. Enums are opt-in because they restrict future values to the supplied observations. Draft 04 omits example annotations. Large integers may be rounded by JavaScript JSON parsing; numeric enum/example values are omitted with a note in that case. Inputs are limited to 5 MB, 200,000 values and 64 nesting levels.

## Data behavior

Document contents stay in the browser and are saved in localStorage. They are not sent to a server. Save triggers a download and does not overwrite an opened file. Browser storage is not a backup; export a workspace or download files to retain copies. Private browsing or clearing site data can remove drafts. File opening is limited to 5 MB per file; the workspace supports 100 files. Workspace import appends documents to the current workspace.

Native Notepad++ plugins, binary editing, executable macros, filesystem-wide search, and full Notepad++ feature parity are outside this version.

## License

CodeMirror 5 is used under its MIT license, included in `dist/vendor/LICENSE-CodeMirror.txt`. Markdown-it is MIT licensed and the task-list plugin is ISC licensed; their notices are included beside the bundled assets.
