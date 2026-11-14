# Note Studio Pro 1.8.0 — Installable web app

Install Note Studio Pro from its web address on Windows or Mac and open it in its own app window.

- Branded install guidance for Chrome, Edge and Safari.
- Complete offline app cache, including syntax modes, diff, Markdown preview and JSON Schema/OpenAPI generation.
- An Available offline indicator appears only after every required app file has been saved.
- Updates prepare a complete new cache. Applying an update saves workspace drafts before refreshing; other workspace windows must be closed first.
- Existing drafts and earlier workspace backups remain compatible.
- Root-domain and GitHub project-page hosting use the same package.

Open the app once while online and wait for Available offline before relying on offline reopening. Drafts stay in the browser profile for that web address. Export a workspace backup before clearing browser data or moving to another hosting address.

Assets:
- PWA ZIP: ready-to-host static app.
- GitHub ZIP: project, tests, release workflow and optional GitHub Pages workflow.
- SHA256SUMS.txt: checksums for both ZIPs.

Desktop downloads from version 1.7.0 are separate, unsigned development builds. This PWA release does not sign or notarize those native applications.

Validation covers language, diff, schema and Markdown engines plus offline-cache lifecycle, integrity, hosting subpaths and update isolation. Browser QA reloaded the PWA with the preview server stopped, restored a test draft, rendered Markdown, generated and copied a valid JSON Schema and completed a diff comparison from cached files.
