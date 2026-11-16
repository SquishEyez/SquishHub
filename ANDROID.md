# SquishHub for Android

The Android app is the same hub (`index.html` + `src/`) packaged with
[Capacitor](https://capacitorjs.com). App ID: `uk.nextdoormedia.squishhub`.

## Signing in

**Anchor:** CONNECT ANCHOR creates a signing request and opens an `esr:` link,
which Android hands to the Anchor app. You approve there; the signature comes
back through Anchor's callback service (`cb.anchor.link`), and Anchor opens
`squishhub://signed` to bring SquishHub back to the front. If Anchor isn't
installed, the app says so and links to https://anchorwallet.io/download.

**WAX Cloud Wallet:** logs in and signs in a popup window, which the app opens
in-app (`PopupChromeClient.java`) so the wallet can report back. Google sign-in
may refuse to run inside an app's web view; log in another way, or use the
website, if that happens.

## Build

Requirements: Node 20+, JDK 21, Android SDK (platform 36, build-tools 36).
Set `sdk.dir` in `android/local.properties`, or set `ANDROID_HOME`.

```bash
npm install
npm run android:build
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```

`npm run android:open` opens the project in Android Studio. To publish on
Google Play, make a release bundle signed with your own upload key:
Android Studio → Build → Generate Signed App Bundle.
