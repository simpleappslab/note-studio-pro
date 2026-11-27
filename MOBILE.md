# AllNote PDF Studio mobile apps

The Android and iOS targets bundle the same local PDF editor, PDF engines and English/Hindi OCR assets as the web app. The installed app launches directly into PDF Studio. Use **Open PDF** to select a file through the operating system and **Save As** to send a copy to the system share sheet. On iOS, use **Save to Files** from that sheet. Android destinations depend on the apps installed on the device.

The app writes exported copies to a private, non-backup cache before opening the share sheet. It removes failed exports and prunes successful export copies older than one hour on launch or during another export. Recipients chosen in the share sheet can retain their own copies. The Android manifest removes the internet permission. The native app uses packaged assets and leaves PWA installation and updates to the web build.

## Builds

Use Node.js 24. Run `npm ci --ignore-scripts`, then `npm run sync:mobile` from a machine with the relevant platform tooling. For one platform, run `npm run build:mobile` followed by `npx --no-install cap sync android` or `npx --no-install cap sync ios`.

- Android uses JDK 21 and Android SDK 36 for builds. Run `./gradlew assembleDebug` inside `android/` for an installable debug APK. The app requires an up-to-date Android System WebView.
- iOS uses Xcode and Swift Package Manager. Open `ios/App/App.xcodeproj` and build scheme **App**. iOS 17 or later is configured. The CI simulator artifact runs in a compatible iOS Simulator. A physical-device build needs an Apple signing team and provisioning profile.

The **Native mobile builds** GitHub Actions workflow builds the Android APK and iOS simulator app and tests bundled document processing where supported. Native builds are preview artifacts. Store releases require the publisher's signing and submission setup.
