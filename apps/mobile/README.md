# Tasklist for Android

The Android app wraps the shared app in `packages/core` (the same code as the desktop and web versions) using Capacitor. It syncs with the Tasklist desktop app over your Wi-Fi; nothing goes through the internet.

## Build the APK

Needs Android Studio's SDK and its bundled Java (already set up on this PC).

```bash
npm install
npm run apk
```

The signed APK is copied to `releases/Tasklist.apk` at the repository root (from the root: `npm run android:apk`).

- `copy-web.js` copies `packages/core` into `www/` before each build. Edit the app in `packages/core`, not in `www/`.
- `android-assets.js` regenerates the launcher icons and launch screen using `scripts/make-icons.js`.
- Release signing uses `android/tasklist-release.jks` and the passwords in `android/keystore.properties`. Keep both files private and backed up: Android only installs an update over the existing app when it is signed with the same key.
- Bump `versionCode` / `versionName` in `android/app/build.gradle` for each new release.
- Release builds are shrunk (R8 `minifyEnabled` + `shrinkResources`), and Google ML Kit's barcode engine and models are left out because the scanner uses ZXing. That keeps the APK around 2.6 MB instead of 30 MB. If a new plugin breaks only in release builds, add keep rules to `android/app/proguard-rules.pro`.

## How sync works

- The desktop app runs a small server on port 5180 on your local network.
- In the Android app: sidebar → **Connect** → **Scan the QR code** shown in the PC's Connect dialog (the QR holds the PC address and pairing token). Or enter the PC address and 6-digit code; the code works for 10 minutes. After pairing the phone keeps a private token.
- Scanning uses `@capacitor/barcode-scanner` with the bundled ZXing engine, so it doesn't depend on Google Play services. That library needs Android 8.0+ (`minSdkVersion = 26`). The web app calls it through `Capacitor.nativePromise` because there's no bundler.
- Requests use Android's native HTTP (`CapacitorHttp`), because Chrome's web view blocks web pages from reaching local-network devices. `usesCleartextTraffic` is on because the PC serves plain HTTP on the local network.
