# example-percy-storybook-react-native

Example repo demonstrating `@percy/storybook-react-native`'s **library mode** running against **BrowserStack App Automate**. Mirrors the [`percy/example-percy-appium-js`](https://github.com/percy/example-percy-appium-js) shape — same tutorial flow, applied to React Native + Storybook component snapshots.

## What this proves

A customer with an RN app that uses `@storybook/react-native` can:

- Build a Storybook-enabled `.apk` (separate from production)
- Upload it to App Automate via `provisionApp` (or this repo's `scripts/upload-apk.js`)
- Run a small WebdriverIO mocha test that drives Storybook RN's on-device navigator drawer
- Get one Percy snapshot per story — on a real BrowserStack Android device — with **zero changes to their app code**

The integration uses only existing, published Percy/BrowserStack tooling: [`@percy/storybook-react-native`](https://www.npmjs.com/package/@percy/storybook-react-native), [`@percy/appium-app`](https://www.npmjs.com/package/@percy/appium-app), [`@percy/cli`](https://www.npmjs.com/package/@percy/cli), and [`webdriverio`](https://www.npmjs.com/package/webdriverio).

## Repo layout

```
webdriverio/
  android/
    android.conf.js           wdio config (BS caps, mocha framework)
    specs/
      storybook.spec.js       the test — discovers stories, snapshots each
  package.json                npm run android
resources/                    drop your built Storybook .apk here
scripts/
  upload-apk.js               convenience wrapper around provisionApp
.github/workflows/
  percy-app-automate.yml      Linux CI workflow (Android only in MVP)
```

## Tutorial

The flow mirrors `example-percy-appium-js`'s README closely.

### Step 1 — Clone and install

```bash
cd webdriverio
npm install
cd ..
```

### Step 2 — BrowserStack credentials

```bash
export BROWSERSTACK_USERNAME="<your username>"
export BROWSERSTACK_ACCESS_KEY="<your access key>"
```

### Step 3 — Build a Storybook `.apk`

Build a Storybook-enabled debug `.apk` — distinct from your production app's `.apk`. See the parent SDK's `STORYBOOK_HOST_APP.md` for the recommended Expo / bare RN build setup.

Drop the resulting file at `resources/PercyStorybookExample.apk`.

### Step 4 — Upload to App Automate

```bash
PERCY_APP_PATH=./resources/PercyStorybookExample.apk \
  node scripts/upload-apk.js
```

The script prints a `bs://...` URL. Export it:

```bash
export PERCY_APP_URL="bs://..."
```

The SDK's `provisionApp` uses BrowserStack's `custom_id` + `recent_apps` GET pattern, so re-running with the same `.apk` skips the upload and reuses the prior `bs://` reference.

### Step 5 — Percy project + token

In Percy, create a new **app**-type project. Copy the project token, then:

```bash
export PERCY_TOKEN="<your project token>"
```

### Step 6 — Point at your RN project

The SDK auto-discovers stories from your RN app's `.rnstorybook/main.{ts,js}` + `.stories.*` files. Set the project root:

```bash
export PERCY_RN_PROJECT_DIR=/path/to/your/rn/app
```

### Step 7 — Run

```bash
cd webdriverio
npx percy app:exec -- npm run android
```

You'll see logs like:

```
[percy] BrowserStack session: https://app-automate.browserstack.com/dashboard/v2/sessions/abc123
[percy] forms-button--primary captured in 3120ms (app-automate)
[percy] forms-button--disabled captured in 2810ms (app-automate)
...
[percy] Finalized build #1234: https://percy.io/...
```

Open the Percy URL — one snapshot per story, captured on a real BrowserStack device.

### Step 8 — Make a visual change & re-run

Edit a component, rebuild the `.apk`, re-upload, re-run. Percy will flag the diff on the next build.

## Customer adaptation

A real customer would:

1. Drop their own RN+Storybook `.apk` into `resources/` (no need to use this example's APK)
2. Update `PERCY_RN_PROJECT_DIR` to point at their RN project root (so `discoverStories` reads their `.rnstorybook/main.ts`)
3. Adjust the device cap in `webdriverio/android/android.conf.js` to their preferred BrowserStack Android device
4. Run `npm run android`

That's it. **No URL scheme registration. No Percy-specific React component to wrap your app with. No metro/channel server.** The SDK uses Storybook RN's in-app navigator drawer via Appium UI taps — works against any standard `@storybook/react-native` v10.x app.

## Why UI-tap navigation (vs deep-link)

Storybook RN supports a `?STORYBOOK_STORY_ID=<id>` URL parameter natively. The SDK exposes deep-link as an opt-in alternative (faster — ~500ms vs ~2s per story) for customers willing to register a URL scheme:

```js
// Phase 2 / opt-in:
await percyStorybookSnapshot(driver, story, {
  navigationStrategy: 'deeplink',
  appScheme: 'myapp',
  appPackage: 'com.acme.storybook',
});
```

The default UI-tap path requires no customer-side code or config beyond what Storybook RN already gives you.

## References

- [`@percy/storybook-react-native`](https://github.com/percy/percy-react-native-support) — the SDK
- [`example-percy-appium-js`](https://github.com/percy/example-percy-appium-js) — the upstream pattern this repo mirrors
- [`@storybook/react-native`](https://github.com/storybookjs/react-native) — Storybook for React Native
- [BrowserStack App Automate](https://www.browserstack.com/app-automate)
- [Percy CLI](https://docs.percy.io/docs/cli-overview)
