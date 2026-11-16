# Local security review — 16 November 2026

Scope: pending JSON stringify/destringify, diff merging, JSON preview/tree and data transpose changes, plus shared rendering, clipboard, storage and offline-cache paths. This is a source review and local automated test run, not a penetration test or assurance of zero risk.

## Findings fixed

- CSV/TSV transpose output could be interpreted as spreadsheet formulas when copied into another application. Output now prefixes formula-like cells with an apostrophe, including tested whitespace/control-character variants. The UI reports modified cells. JSON output retains exact data. Spreadsheet behavior varies; this mitigation does not make arbitrary exported files universally safe.
- The web app lacked a Content Security Policy. A policy now restricts scripts, connections and resources to the app origin, blocks objects, frames, form submission and base-URL changes, and disallows inline/evaluated scripts. Inline styles remain allowed for the editor. Referrer metadata is disabled.
- Stringify/destringify now rejects input above the existing 5 MB character limit. Diff merging also rejects results above 100,000 lines as well as its existing size limit.

## Reviewed behavior

- The new preview and transpose code uses textContent/value for user data, not HTML parsing or JavaScript evaluation.
- No network, clipboard-read or storage calls were found in the new JSON preview/transpose modules. Copy runs from explicit button handlers. Worker messages in diff stay within the app.
- Preview and transpose keep original documents unchanged. Opening output as a document uses existing autosave. Diff merges affect comparison copies. String transforms intentionally edit the selected text/document with undo and read-only checks.
- JSON numbers retain source spelling in preview and transpose. Special object keys use arrays/Maps, not assignment to object prototypes.
- Offline asset fetching remains restricted to the service worker's bundled-asset allowlist. Document data is not included in those requests.
- Existing Markdown rendering escapes raw HTML, rejects unsafe link schemes and turns external images into links.

## Validation

JavaScript syntax checks and the full local test suite passed, including 8 new security test groups, 144 merge cases and prior parser/offline-cache checks. Payload tests cover HTML/script injection, spreadsheet formulas, whitespace bypasses, special keys and input bounds.

## Remaining limits / release checks

- Live browser security-policy, keyboard/Undo and UI verification remain outstanding: Chromium could not start under this runtime's socket restrictions.
- After explicit user approval, `npm audit --omit=dev --json` completed successfully on 16 November 2026. It reported 0 known vulnerabilities across all severity levels for the production dependency graph in the lockfile. This is a registry advisory check, not proof that dependencies are free of undiscovered vulnerabilities or that vendored bundles exactly match the lockfile.
- Browser drafts are stored unencrypted in localStorage. A compromised browser, same-origin application, device or malicious extension can expose them. The app is not a secure secrets vault.
- Same-origin hosting and update integrity still rely on the repository, deployment account and browser. CSP does not protect against an authorized-looking malicious update.
- Files and clipboard contents can be interpreted differently by destination apps. Formula mitigation alters delimited output cells; JSON output deliberately preserves original strings.
- This review was completed before publication of version 1.9.0.
