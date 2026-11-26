# PDF Studio security review

The web app, Chrome extension and PWA load pinned PDF engines from the application bundle. PDF bytes, passwords, drawn signatures and undo history are held in browser memory. They never enter the AllNote draft store or the PWA asset cache. File uploads, external processing APIs and telemetry are absent from the PDF Studio flow.

- PDF.js draws to a canvas. The app does not create an active PDF annotation layer, execute embedded scripts, or enable XFA. Workers and asset requests are limited to the application origin. WebAssembly compilation is permitted for the bundled engines.
- The QPDF WebAssembly worker receives a copy of the bytes for each password or lossless compression operation. Its paths and command options are fixed, and it is terminated after the operation or timeout. Engine diagnostics stay inside the worker.
- Saved password-protected PDFs use AES-256, revision 6. The workspace asks for the existing password before opening an encrypted PDF, and requires the owner password where permission flags restrict operations. Password removal requires re-entry. PDF exports from a protected workspace use encryption. Image and text exports require explicit acknowledgment that they are unprotected.
- Save writes through a user-selected file handle and checks the disk snapshot before overwriting. Save As can use a browser download. Documents larger than 50 MiB or 1,000 pages are rejected, and raster dimensions and undo history are bounded.
- The workflow runs the full npm lockfile audit and CodeQL on application JavaScript and Python. Vendored code is excluded from CodeQL. The QPDF build ships with its upstream provenance, component list and notices in `dist/vendor/qpdf`. The npm audit does not attest to vulnerabilities inside bundled C/C++ and WebAssembly components.
- Lossless compression preserves document content and structure but rewrites the file. PDF rewrites can invalidate existing cryptographic signatures. Handwriting creates visible PDF marks. Markup and highlighting leave the underlying content accessible. Raster compression deliberately discards searchable text, links and forms.

The validation workflow publishes the audit result, Chromium test report, screenshots and preview packages. The file write test uses real browser writable streams with controlled picker responses.
