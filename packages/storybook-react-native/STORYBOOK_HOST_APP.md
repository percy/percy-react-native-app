# Building a Storybook Host App for `@percy/storybook-react-native`

Both CLI mode and library mode (App Automate) require a **Storybook-enabled build of your RN app** — distinct from your production app. This guide covers the recommended build setup.

## Why a separate build?

Your production app's entry point renders your app. The Storybook host app's entry point renders the Storybook navigator, which lets `@percy/storybook-react-native` iterate every registered story.

**Don't gate Storybook behind a runtime flag in your production build.** Apple's App Store §2.3.1 (Hidden Features) makes runtime-gated single binaries that reach production a real rejection risk. Use a separate Xcode scheme / EAS Build profile / Metro env-flag-driven bundle.

## When Storybook is not the rendered root

The recommended pattern above is "App.js returns StorybookUIRoot directly" — Storybook is the entire app for the host build. The SDK's deep-link navigation assumes this: when the device receives `myapp:///?STORYBOOK_STORY_ID=...`, Storybook RN's built-in URL handler picks up the parameter and renders the matching story.

If your host build wraps Storybook in other UI (a login screen, a tab bar, an onboarding flow), the deep-link reaches your root component but Storybook's URL handler never sees the `STORYBOOK_STORY_ID` parameter. The snapshot will be of whatever your wrapper renders, not the requested story.

**Fix — wire `Linking.getInitialURL()` to bypass your wrapper when a story param is present.** Copy-paste pattern:

```jsx
// MyApp-Storybook scheme entry. Customers whose host build can't make
// Storybook the literal root (auth gates, tabs, etc.) use this pattern.
import { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import StorybookUIRoot from './.rnstorybook';
import App from './src/App';

export default function Root() {
  const [showStorybook, setShowStorybook] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Linking.getInitialURL().then((url) => {
      if (cancelled) return;
      if (url && url.includes('STORYBOOK_STORY_ID=')) setShowStorybook(true);
    });
    // Also listen for foreground deep links (when Appium switches stories
    // without restarting the app).
    const sub = Linking.addEventListener('url', (event) => {
      if (event.url.includes('STORYBOOK_STORY_ID=')) setShowStorybook(true);
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  return showStorybook ? <StorybookUIRoot /> : <App />;
}
```

This is opt-in and customer-side. The SDK can't ship this as a drop-in component because the wrapper architecture varies too much across customer apps. If you'd prefer to keep your existing entry point unchanged, the cleanest fallback is to ship a separate Storybook-only target / EAS Build profile that doesn't have the wrapper at all (the canonical pattern recommended at the top of this guide).

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

## Compatibility & known limitations

The SDK is validated against a specific set of Storybook RN + RN + build-tooling combinations. The matrix below tells you upfront where your setup fits.

| Scenario | Status | Notes |
|---|---|---|
| **Storybook RN versions** | | |
| `@storybook/react-native` v9.x — deep-link | ✅ | `STORYBOOK_STORY_ID` URL parameter has been stable since v9 |
| `@storybook/react-native` v10.x — deep-link | ✅ | Validated end-to-end against v10.3.2 in initial PoC |
| `@storybook/react-native` v10.x — UI-tap | ❌ | v10.3.2 navigator uses a virtualized list that doesn't expose tappable entries to Appium's accessibility tree. Empirically confirmed; use deep-link instead. |
| `@storybook/react-native` < v9 | ❌ | URL handler not present; use UI-tap (also untested) |
| **React Native runtime** | | |
| Hermes | ✅ | No SDK coupling |
| New Architecture (Fabric, TurboModules) | ✅ | No SDK coupling |
| **Expo / build tooling** | | |
| Expo SDK 51+ | ✅ | Validated against SDK 54 |
| EAS Build outputs | ✅ | Customer provides the resulting `.apk` path |
| Bare RN (gradle direct) | ✅ | Same `.apk` contract |
| **Build variants** | | |
| `assembleRelease` | ✅ | Required — embeds JS bundle |
| `assembleDebug` | ❌ | Debug expects Metro on localhost:8081; cloud devices have no Metro → red box on launch. Either use release, or set `react { bundleInDebug = true }` in app/build.gradle |
| Customer's release build is unsigned | ❌ | Android needs at least debug-keystore signing for BS to install. Standard Expo template handles this. |
| **URL scheme (deep-link mode)** | | |
| Scheme registered in `app.json` (Expo) | ✅ | One line: `{ "expo": { "scheme": "myapp" } }` |
| Scheme registered in `AndroidManifest.xml` (bare RN) | ✅ | `<intent-filter>` block |
| No scheme registered | ❌ deep-link silently no-ops | Either register one (recommended) or use UI-tap path |
| **Customer app architecture** | | |
| Storybook is the rendered root (separate target / `App.js` returns `StorybookUIRoot`) | ✅ | Recommended pattern; canonical setup |
| Storybook wrapped behind login / tabs / navigation | ⚠️ | Customer must wire `Linking.getInitialURL()` to navigate-to-Storybook when `STORYBOOK_STORY_ID` URL param is present, otherwise deep-link reaches the root but doesn't render Storybook |
| **Story file syntax** | | |
| Standard CSF (`export default { title: 'Forms/Button' }`) | ✅ | Default case |
| TypeScript `satisfies Meta<…>` pattern | ✅ | Parser handles |
| Computed `title` (`title: TITLE_CONST`) | ⚠️ | Regex parser misses; pass story list explicitly to `discoverStories` until AST parser ships |
| Spread operators in meta (`...defaultMeta`) | ⚠️ | Same as above |
| Stories in monorepo (`apps/*/.rnstorybook/main.ts`) | ✅ | Pass `configDir` opt to `discoverStories` |
| **Platforms** | | |
| Android — App Automate (cloud) | ✅ | Phase 1 default |
| Android — local Appium emulator (library mode) | ✅ | Transport auto-detected |
| Android — local emulator (CLI mode) | ✅ | PER-7859 flow |
| iOS — App Automate | 🟡 Phase 2 | Requires distribution-signed `.ipa` (customer Apple Developer account) |
| iOS — Simulator (local Mac) | 🟡 Phase 2 | Code path exists in `buildAndProvision`; not yet validated |
| iOS < 16.4 — deep-link | ❌ | `mobile: deepLink` unreliable below 16.4; SDK fails fast with `deep_link_unsupported_platform` |

**Legend:** ✅ works · ❌ fails with clear error · ⚠️ has workaround · 🟡 planned

If you're hitting a ❌ or ⚠️ above and the workaround doesn't fit your setup, please file an issue at [`percy/percy-react-native-app`](https://github.com/percy/percy-react-native-app/issues) with your Storybook RN version, RN version, and a minimal reproduction.
