# PDF Studio Phase 3

Phase 3 builds on the merged PDF Studio in PR #3. This branch is a review build. The PDF and OCR workers use bundled resources. PDFs, rendered pages, passwords, detected text and review state stay in browser memory. Exporting a result writes a local file. Opening OCR text in Notes requires confirmation because Notes saves drafts locally.

## Workflows

- **OCR and redaction** reads the existing text layer first. Recognize scans runs English, Hindi or both language models on selected pages without native text. Use Images to PDF to open PNG or JPEG scans. Export the OCR text or add an invisible text layer to the PDF. Confidence is an estimate.
- **Redaction** finds native or previously recognized text with the AllNote rules and local custom expressions. Review the selected regions and draw missing areas before export. Raster reconstruction renders a new PDF from sanitized pixels. It discards source metadata, attachments, actions, annotations, forms, bookmarks, text layers and revision history. The result may still show sensitive pixels outside the reviewed regions. Export a review plan to apply the same regions to a matching input in Batch. Plans contain coordinates and a SHA-256 file fingerprint.
- **Document properties** inspects PDF Info, XMP, document language and tag availability. Edits can replace the Info fields and regenerate supported RDF/XMP fields from those values. Structural sanitization can remove selected standard metadata, attachments, actions, external action links, annotations marked hidden and values in wholly hidden form fields. It performs a full rewrite. Private keys, unsupported structures and visible content can remain. Pixel reconstruction discards additional source structures. Both routes offer a report.
- **Edit existing text** finds isolated horizontal standard-font WinAnsi blocks on the current page. Edit the text, color, font, size, alignment or coordinates, or clear the text to delete the block. It rewrites that page stream. Complex font encoding, rotated blocks, ligatures, mixed-line syntax and text in arbitrary nested objects are unsupported. This is separate from redaction.
- **AcroForm** reads and writes supported field values, imports and exports JSON, draws new text and choice widgets, and flattens supported forms. Reset clears editable values. Draw an unsigned signature widget or place a handwritten appearance in a supported unsigned widget. XFA and cryptographic signature creation are unsupported. Existing signed fields remain read-only and PDF rewrites may invalidate signatures.
- **Bookmarks** edits internal page destinations and nested items. Rewrites normalize supported destinations to Fit. External actions and unresolved destinations block outline rewriting. Accessibility inspection is descriptive and does not certify PDF/UA.
- **Compare** aligns exact native text pages and falls back to position for unmatched pages. It provides the AllNote line diff, normalized pixel comparison, overlay and slider, and a JSON report. Scanned page reordering and ambiguous duplicate pages may need manual review. Visual comparison omits annotation rendering and reports annotation changes separately.
- **Batch** creates separate files, keeps a bounded queue, supports cancellation and retry of failed files, and archives results. A reviewed redaction plan applies only to the exact input it references. Lossless compression keeps the original bytes when the result is larger. Batch OCR exports text and does not rewrite each input with an OCR layer. Batch sensitive detection reports native matches and lists pages that need OCR.

## Implementation and dependency review

| Module | Responsibility |
| --- | --- |
| `pdf-intelligence.mjs` | Pinned Tesseract worker protocol, searchable PDF text layer and pixel reconstruction |
| `pdf-pi-worker.js` | Bounded local detection, shared masking settings and cancellable regular expressions |
| `pdf-properties.mjs` | AcroForm data, metadata descriptors and outline editing |
| `pdf-text-edit.mjs` | Size-limited streaming decompression and conservative content-stream rewriting |
| `pdf-compare.mjs`, `pdf-batch.mjs` | Document and image comparison, queue operations and ZIP packaging |

Tesseract.js 7 and its WebAssembly core use Apache-2.0. English and Hindi model data are pinned through the language packages with the tessdata_best Apache notice. The Noto Devanagari subsets use OFL-1.1. The fontkit fork and fflate use MIT. Licenses ship with the generated runtime assets. PDF.js, pdf-lib and QPDF continue from the previous release. The application uses the existing WebAssembly CSP allowance and does not add JavaScript eval permission. OCR runs with one worker per document and batch OCR runs with one active file. Runtime model paths are fixed to bundled resources and worker outputs are not logged. OCR model data is cached as part of PWA installation, while the recognizer loads a language only on demand.

## Verification and limits

| Area | Automated evidence | Remaining limits |
| --- | --- | --- |
| OCR and search layer | Offline English OCR on a mixed scanned/native file and in the packaged extension, rotated Hindi OCR, cancellation/restart and independent PDF.js extraction | Sparse native text can cause a scanned page to be skipped. Complex positioning and OCR accuracy vary by document. |
| Sensitive detection and redaction | Native email detection, exported pixel verification, independent text extraction and object/metadata inspection | Rule-based matches, no general unlabelled name/address recognition, reads learned AllNote rules and supports per-document exact-text ignores. Pixel reconstruction is the supported permanent route. |
| Forms, metadata, outline and existing text | Saved-PDF round trip for text rewrite, title, form values, new checkbox and bookmark, plus XMP generation and removal, unsigned signature appearance and existing-signature warning | Test coverage is narrower than all field structures. Signed widgets are read-only. Existing-text coverage is deliberately limited. |
| Comparison | Text patch, a visual difference, structural metadata change and report download | Scanned page alignment is positional. Reports do not determine semantic equivalence. |
| Batch | Concurrent good and malformed inputs, per-file status, ZIP output and redaction-plan fingerprint checks | OCR produces text and reviewed redaction takes one matching plan per run. |
| Compatibility and performance | Chromium browser scenarios, offline PWA, packaged Chrome extension, Microsoft Edge and Playwright WebKit smoke tests, 10/100/500-page browser benchmark | WebKit is a Safari engine proxy. Apple Safari itself requires separate verification. Browser file handles depend on host support. Sampled JS heap excludes workers, WASM and graphics. The benchmark measures opening and navigation on synthetic inputs. |

Comparison text is limited to two million characters per input. OCR and visual audit process at most 100 pages per run. Input PDFs are limited to 50 MiB and 1,000 pages. Rendered page images are bounded, and thumbnail bitmaps are released when they leave the viewport. The preview workflow attaches screenshots, a benchmark JSON report, package builds and a dependency audit.

This report covers application behavior and automated tests. It does not establish sanitization of arbitrary PDFs, OCR accuracy across populations, or absence of vulnerabilities in bundled native code.
