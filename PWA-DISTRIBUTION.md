# Note Studio Pro — PWA and GitHub distribution

Version 1.8.0. The PWA works in the browser and can be installed as a separate app window without an Apple Developer membership.

## Use and install

Open the app's HTTPS address in Chrome or Edge. Choose Install app in the editor and follow the browser's installation controls. In Safari on Mac, use File → Add to Dock. On iPhone/iPad, use Safari's Share → Add to Home Screen.

Before going offline, leave the app open until Available offline appears. The first online visit downloads the editor, language modes, Markdown renderer, schema generator and diff engine. Once prepared, the same address can reopen without a server connection. Native operating-system installation prompts still depend on the browser and device policy.

Drafts are saved locally in that browser profile and web origin. They are not uploaded or synced. Changing from the existing website to a GitHub Pages address creates a separate workspace; use File → Export workspace backup and Import workspace backup to move documents. Keep an exported backup before clearing browser data.

## Publish a first GitHub release in the browser

1. Extract the GitHub ZIP. Its Note-Studio-Pro folder contains the clean project.
2. Create a GitHub repository, for example note-studio-pro. A public repository supports public downloads and free GitHub Pages hosting.
3. Upload the contents of the extracted project folder, including the .github folder if using Actions. Do not upload ZIPs as the website itself.
4. In Releases, choose Draft a new release. Create tag v1.8.0 and use the release notes supplied in RELEASE-NOTES.md.
5. Attach the PWA ZIP, the GitHub ZIP and SHA256SUMS.txt as release assets, then publish.
6. Put the live app address in the repository About section and release notes.

The current live app can remain the primary address. Publishing on GitHub does not require changing that address or moving existing drafts.

## Optional GitHub Pages hosting

In repository Settings → Pages, choose GitHub Actions as the source. Run the Publish PWA to GitHub Pages workflow from Actions. It deploys the bundled dist folder. All resource paths, manifest scope and service-worker URLs are relative, so a project address such as /note-studio-pro/ is supported.

For another static host, extract the PWA ZIP to its public directory. HTTPS is required except on localhost. The host must serve sw.js as JavaScript and app.webmanifest as JSON. Deploy the complete package together.

## Rebuild and release

Development checks require Node.js 24 or later and npm. ZIP packaging also uses Python 3.

    npm ci
    npm run build:pwa
    npm run check
    npm test
    npm run package:web -- /absolute/output/directory

The Create GitHub release workflow can build and publish the ZIPs from a repository using its own GitHub Actions token. It is manually triggered and requires a tag matching the version in package.json. It is separate from the optional Pages deployment.

After any edit to dist, rerun build:pwa before deployment. It regenerates the service worker with a content-based build ID and per-file SHA-256 checks. HTML is checked against its build marker so static hosts can add preview metadata without breaking offline setup.

## Updates

The app prepares updates in the background. Update ready opens the update information. Update and reopen applies the prepared version after saving drafts. If another Note Studio Pro window is open, close it first; the app avoids forcing updates across independent open workspaces. Without an explicit update, the new version activates after all app windows close.

The cache holds bundled app files only. It never stores opened documents, clipboard content, uploads or external websites. Existing document storage and backup formats are preserved.

## Native Mac downloads

The native Mac ZIPs are separate from the PWA. For Apple-trusted direct downloads, the publisher needs a Developer ID Application certificate, hardened-runtime signing and Apple notarization. These use paid Apple Developer Program membership even when the app is free. Self-signed/ad-hoc signatures do not provide that publisher trust. Signing and notarization do not override an administrator's device restrictions.

The unsigned native 1.7.0 downloads are testing builds. The PWA is the recommended distribution route without an Apple signing subscription.
