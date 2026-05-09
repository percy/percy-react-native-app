# Building a Storybook Host App for `@percy/storybook-react-native`

Both CLI mode and library mode (App Automate) require a **Storybook-enabled build of your RN app** — distinct from your production app. This guide covers the recommended build setup.

## Why a separate build?

Your production app's entry point renders your app. The Storybook host app's entry point renders the Storybook navigator, which lets `@percy/storybook-react-native` iterate every registered story.

**Don't gate Storybook behind a runtime flag in your production build.** Apple's App Store §2.3.1 (Hidden Features) makes runtime-gated single binaries that reach production a real rejection risk. Use a separate Xcode scheme / EAS Build profile / Metro env-flag-driven bundle.

## Expo (recommended)

`app.json`:
```json
{
  "expo": {
    "name": "MyApp Storybook",
    "slug": "myapp-storybook",
    "scheme": "myapp"
  }
}
```

`index.js` (or `App.js`):
```js
// MyApp-Storybook scheme entry — only the Storybook root, not the prod app.
import StorybookUIRoot from './.rnstorybook';
export default StorybookUIRoot;
```

Build a `.apk`:
```bash
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease && cd ..
cp android/app/build/outputs/apk/release/app-release.apk \
   ./PercyStorybookExample.apk
```

> ⚠️ **Use `assembleRelease`, not `assembleDebug`.** A standard Expo `assembleDebug` build does **not** embed the JS bundle into the APK — it expects Metro to be running on `localhost:8081` to serve JS at runtime. On a BrowserStack cloud device, Metro isn't reachable, so the app launches into a React Native redbox with `loadJSBundleFromAssets` errors. `assembleRelease` always bundles JS via `export:embed` and uses the auto-generated `debug.keystore` (no Apple Developer account required for Android). If you must use a debug build, set `react { bundleInDebug = true }` in `android/app/build.gradle`.

## Bare React Native (Metro env-flag pattern)

`metro.config.js`:
```js
module.exports = {
  resolver: {
    sourceExts: process.env.STORYBOOK === 'true'
      ? ['storybook.tsx', 'storybook.ts', 'storybook.jsx', 'storybook.js', 'tsx', 'ts', 'jsx', 'js']
      : ['tsx', 'ts', 'jsx', 'js'],
  },
};
```

`App.storybook.tsx`:
```tsx
import StorybookUIRoot from './.rnstorybook';
export default StorybookUIRoot;
```

Build:
```bash
STORYBOOK=true npx react-native build-android --mode=debug
```

## Verifying

Install the resulting `.apk` on a local emulator:

```bash
adb install -r ./PercyStorybookExample.apk
adb shell am start -n com.your.package/.MainActivity
```

You should see Storybook's navigator drawer (or its split-screen layout depending on which `@storybook/react-native-ui` package you've installed) — **not** your production app.

## URL scheme registration (deep-link mode only)

The default UI-tap path doesn't need a URL scheme. **Skip this section unless you've opted in to `navigationStrategy: 'deeplink'`.**

### Expo

```json
{ "expo": { "scheme": "myapp" } }
```

### Bare RN — Android

`android/app/src/main/AndroidManifest.xml`:
```xml
<intent-filter android:autoVerify="false">
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="myapp" />
</intent-filter>
```

### Bare RN — iOS (Phase 2)

`ios/MyApp/Info.plist`:
```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLSchemes</key>
    <array><string>myapp</string></array>
  </dict>
</array>
```

## Common gotchas

### `@react-native-async-storage/async-storage` 3.x missing Maven artifact

Storybook RN depends transitively on `@react-native-async-storage/async-storage`. Versions 3.x ship the native Android dependency (`org.asyncstorage.shared_storage:storage-android:1.0.0`) as a **local Maven repository** under `node_modules`, but RN autolinking does not always wire that local repo into the Gradle `allprojects.repositories` block.

Symptom (gradle build):
```
Could not find org.asyncstorage.shared_storage:storage-android:1.0.0.
Required by:
    project :app > project :react-native-async-storage_async-storage
```

Fix — add to `android/build.gradle` `allprojects.repositories`:
```gradle
maven { url "${rootDir}/../node_modules/@react-native-async-storage/async-storage/android/local_repo" }
```

This will be unnecessary once async-storage 3.x publishes the native artifact to Maven Central. Track [`react-native-async-storage/async-storage` releases](https://github.com/react-native-async-storage/async-storage/releases) for the fix.

## App size considerations

Storybook host apps tend to be larger than production builds (every story, every component, every fixture in one bundle). BrowserStack's per-account upload limit is 1 GB by default — most Storybook builds land between 30 MB and 200 MB and are well within the limit. If you exceed it, strip unused native modules or split your stories into multiple host apps.
