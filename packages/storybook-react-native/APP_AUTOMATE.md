# `@percy/storybook-react-native` — App Automate (Library Mode)

This guide is for customers running their RN component snapshots against **BrowserStack App Automate** from a CI runner — typically Linux. It complements the local-device CLI flow in [`SETUP.md`](./SETUP.md).

## Architecture in one diagram

```
┌─────────────────────────┐                  ┌──────────────────────────┐
│  Your CI runner (Linux) │                  │ BrowserStack App Automate│
│                         │                  │                          │
│ ┌─────────────────────┐ │                  │   ┌──────────────────┐   │
│ │ Your Appium spec    │ │                  │   │ Real Android     │   │
│ │  - imports          │ │ wdio.remote()    │   │ device            │   │
│ │  percyStorybookSnap │◀┼──────────────────┼──▶│  + your Storybook │   │
│ │  + discoverStories  │ │                  │   │    .apk           │   │
│ └─────────┬───────────┘ │                  │   └──────────────────┘   │
│           │             │                  │                          │
│ ┌─────────▼───────────┐ │  POST :5338      │                          │
│ │ Percy CLI           │ │  /percy/comparison                         │
│ │ (percy app:exec)    │◀┼──────────────────┘                          │
│ └─────────┬───────────┘ │                                              │
└───────────┼─────────────┘                                              │
            ▼
   ┌──────────────────┐
   │ Percy backend    │
   │ App Percy build  │
   └──────────────────┘
```

The SDK auto-detects the App Automate transport from your driver's `bstack:options` capability. There is no `--transport` flag — same code path works against any standards-compliant Appium endpoint.

## Required environment

| Variable | Purpose | Where set |
|---|---|---|
| `BROWSERSTACK_USERNAME` | App Automate auth | CI secret |
| `BROWSERSTACK_ACCESS_KEY` | App Automate auth | CI secret |
| `PERCY_TOKEN` | App-type Percy project token | CI secret |
| `PERCY_APP_URL` | `bs://...` reference returned by `provisionApp` | Set by upload step |
| `PERCY_RN_PROJECT_DIR` | Path to your RN project root (where `.rnstorybook/main.ts` lives) | CI step env |

## Capability shape

The SDK detects App Automate via the presence of `bstack:options` (with non-empty `userName`/`accessKey`) on the driver. Standard shape:

```js
const driver = await wdio.remote({
  hostname: 'hub.browserstack.com',
  port: 443,
  protocol: 'https',
  path: '/wd/hub',
  capabilities: {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:app': process.env.PERCY_APP_URL,           // bs://... from provisionApp
    'appium:deviceName': 'Google Pixel 8',
    'appium:platformVersion': '13.0',
    'appium:autoGrantPermissions': true,
    'bstack:options': {
      userName: process.env.BROWSERSTACK_USERNAME,
      accessKey: process.env.BROWSERSTACK_ACCESS_KEY,
      projectName: 'Percy Storybook RN',
      sessionName: 'storybook-android',
    },
  },
});
```

## Customer-side test shape

```js
import percyStorybookSnapshot, {
  discoverStories,
  runSession,
} from '@percy/storybook-react-native';

await runSession(driver, async () => {
  for (const story of await discoverStories({ cwd: process.env.PERCY_RN_PROJECT_DIR })) {
    await percyStorybookSnapshot(driver, story);
  }
});
```

The `runSession(driver, fn)` helper wraps your iteration in `try/finally` and ensures `driver.deleteSession()` runs even when the test throws — preventing dangling BrowserStack sessions from burning quota.

## Snapshot options (flat surface)

`percyStorybookSnapshot(driver, story, options)` takes a **flat** options object. Navigation-only keys (`navigationStrategy`, `appScheme`, `appPackage`, `renderMs`, `coldBootMaxMs`, `globalNavigationBudgetMs`, `testIdPollMaxMs`, `stabilityPollMaxMs`, `stabilityMaxAttempts`, `stabilitySettleMs`, `cacheNavigatorState`) are consumed by the SDK; everything else is forwarded to `@percy/appium-app`'s `percyScreenshot`. That includes the full `@percy/percy-appium-js` option surface:

```js
await percyStorybookSnapshot(driver, story, {
  // --- Region options (the most common reason to use the flat surface) ---
  ignoreRegionXpaths: ['//XCUIElementTypeOther[@name="header"]'],
  ignoreRegionAccessibilityIds: ['toast'],
  ignoreRegionAppiumElements: [await driver.$('~live-clock')],
  customIgnoreRegions: [{ top: 0, bottom: 50, left: 0, right: 360 }],
  considerRegionXpaths: ['//*[@id="content"]'],
  considerRegionAccessibilityIds: ['main-content'],
  considerRegionAppiumElements: [await driver.$('~main')],
  customConsiderRegions: [{ top: 100, bottom: 800, left: 0, right: 360 }],

  // --- Full-page + scroll ---
  fullPage: true,
  screenLengths: 3,
  scrollableXpath: '//XCUIElementTypeScrollView',
  scrollableId: 'feed-scroll',
  topScrollviewOffset: 0,
  bottomScrollviewOffset: 0,
  androidScrollAreaPercentage: 80,
  scrollSpeed: 100,

  // --- Tile / metadata ---
  statusBarHeight: 24,
  navigationBarHeight: 0,
  orientation: 'portrait',           // 'portrait' | 'landscape'
  deviceName: 'Pixel 8 (Android 14)', // override auto-derived label

  // --- Workflow ---
  sync: true,                         // wait for diff completion
  testCase: 'forms-button-primary',
  labels: ['nightly', 'a11y'],

  // --- Animation ---
  freezeAnimatedImage: true,          // default true; flip to false to opt out

  // --- Navigation (consumed by the SDK, NOT forwarded) ---
  navigationStrategy: 'deeplink',
  appScheme: 'myapp',
  appPackage: 'com.acme.storybook',
  renderMs: 500,
});
```

The legacy nested escape hatch `snapshot: { ... }` is still honored and wins last for backwards compat with the pre-flat API.

## App provisioning

`provisionApp(localPath)` does:

1. Computes `sha256(file).slice(0, 40)` as the BrowserStack `custom_id`.
2. Probes `GET /app-automate/recent_apps/{custom_id}` — if BS already has this exact content, **returns the existing `bs://` reference without re-uploading**.
3. Otherwise uploads via `POST /app-automate/upload` (multipart) with retries on transient 5xx (3× exponential backoff).
4. Returns the `bs://...` reference.

For customers with their own upload pipeline, `useAppReference('bs://...')` is the escape hatch.

## Troubleshooting

| Error code | What it means | What to do |
|---|---|---|
| `bs_credentials_missing` | `BROWSERSTACK_USERNAME` / `BROWSERSTACK_ACCESS_KEY` not set | Add the env vars or pass via `provisionApp(path, { credentials })`. |
| `bs_upload_failed` | BrowserStack rejected the upload | Check the response body in the error message. 401/403 → bad creds. Other 4xx → see the BS docs link in the error. |
| `bs_upload_too_large` | App exceeds BS plan size limit (1 GB default) | Strip native modules from your Storybook `.apk` or contact BS support. |
| `bs_app_not_ready` | First Appium session install fails because BS is still processing the upload | The SDK retries once after a 5s pause. If you see this repeatedly, file a Percy issue. |
| `nav_navigator_not_detected` | Storybook RN navigator (lite or full) not found within `coldBootMaxMs` | Confirm your `.apk` is a Storybook-enabled build (not the production app). Check the BS session video. |
| `nav_element_not_found` | A specific story's component group or leaf wasn't tappable | Verify the component title and story name match the on-device sidebar exactly. CSF titles with escaped slashes need explicit unescaping. |
| `nav_render_timeout` | Story rendered but the screenshot-stability poll never converged within 8s | Likely a permanent animation. Set `freezeAnimatedImage: false` is not the answer (it's already on by default); use `parameters.percy.waitFor` per story instead. |
| `app_cold_boot_timeout` | Cold-boot poll exceeded 30s | Slow BS device; bump `coldBootMaxMs` via options. |
| `bs_app_reference_stale` | The `bs://` reference points to an app upload that BrowserStack no longer has (uploads expire after ~30 days) | Re-run `provisionApp` (or your upload step) to get a fresh `bs://` URL. |
| `bs_quota_exhausted` | Your BrowserStack plan's App Automate parallel/session quota is used up | Wait for running sessions to finish, or raise the plan limit. |
| `invalid_app_reference` | App reference doesn't start with `bs://` | Pass the `bs://` URL returned by `provisionApp()` or your own upload script — not a local file path. |
| `build_is_debug_variant` | The uploaded app is a debug build (`android:debuggable="true"`), which expects Metro on `localhost:8081` and redboxes on a cloud device | Build the release variant (`./gradlew assembleRelease`), which embeds the JS bundle. |
| `build_failed` | The SDK-driven gradle/EAS build command exited non-zero | Read the build output above the error; fix the native build failure and re-run. |
| `build_toolchain_missing` | The build command isn't available on this machine (gradle wrapper, Xcode, or EAS CLI not found) | Install the missing toolchain, or build the artifact yourself and pass its path to `provisionApp`. |
| `build_artifact_not_found` | Build succeeded but no `.apk` at the expected output path | Custom flavors/output paths — locate the artifact and pass it to `provisionApp` directly. |
| `apple_signing_required` | iOS on App Automate needs a distribution-signed `.ipa`, which the SDK can't produce for you | Follow [IOS_SIGNING.md](./IOS_SIGNING.md), then `provisionApp('./MyApp.ipa')`. |
| `unsupported_project_type` | Project path is neither an Expo nor bare React Native root | Pass the RN project root (the directory whose `package.json` lists `react-native`). |
| `unsupported_platform` | The Appium session's platform isn't Android or iOS | Set `platformName` to `Android` or `iOS` in your capabilities. |
| `deep_link_unsupported_platform` | Deep-link navigation didn't settle in time on this platform | Verify the URL scheme is registered; or drop `navigationStrategy: 'deeplink'` to use the default UI-tap path. |
| `url_scheme_silent_failure` | The deep link was sent but the app never surfaced the story (scheme registered to nothing, or swallowed) | Check the scheme in `app.json` / `AndroidManifest.xml` / `Info.plist` matches `appScheme` exactly. |
| `nav_state_diverged` | The on-device navigator ended up somewhere other than the requested story | Usually a duplicate story title — make CSF `title` + export names unique across the project. |
| `no_stories_found` | Story discovery found a `.rnstorybook` config but no `.stories.*` files matched its glob (or no config at all) | Check the `stories:` glob in `.rnstorybook/main.ts`, set `PERCY_RN_PROJECT_DIR` to the project root, or pass `--stories` explicitly. |
| `include_zero_match` | `include`/`skip` patterns filtered out every discovered story | Loosen the `include`/`skip` globs in `.percy.yml`. |
| `invalid_descriptor` | Appium session has no `platformName` capability | Set `platformName` (iOS or Android) in `.percy.yml` `appium.capabilities`. |
| `invalid_config` | A `.percy.yml` `storybook-rn:` value failed validation (e.g. `appium.server` not an http(s) URL) | Fix the value named in the message — e.g. `appium.server: http://localhost:4723`. |
| `appium_unreachable` | No Appium session — `connect()` was never called or the server is down | Start the Appium server / check `appium.server`; in library mode, pass a live driver. |
| `percy_appium_app_missing` | `@percy/appium-app` peer dependency isn't installed | `npm install --save-dev @percy/appium-app`. |
| `percy_cli_unreachable` | Percy CLI server isn't running (command not wrapped in `percy exec` / `percy app:exec`) | Wrap the run: `npx percy app:exec -- <command>`, with `PERCY_TOKEN` set. |
| `token_missing` | `PERCY_TOKEN` isn't set | Export the app-type project token (starts with `app_`) from your Percy project settings. |
| `screenshot_failed` | Appium screenshot capture failed mid-run | Device lost focus or session expired — check the App Automate session video; re-run with `DEBUG=1`. |
| `story_render_timeout` | The channel/select-story call errored or the story never acked render | Local mode: confirm Metro is running and the device is connected. Bump `storybook.waitForReadyMs` for slow stories. |
| `storybook_ws_unreachable` | Storybook's channel server is up but WebSockets are disabled | Add `enableWebsockets: true` to `getStorybookUI()` in `.rnstorybook/index` (see SETUP.md §4). |
| `all_snapshots_failed` | Every story in the run failed to capture | Read the per-story errors above; re-run with `DEBUG=1` for full detail. |

## Performance defaults

| Option | Default | Why |
|---|---|---|
| `coldBootMaxMs` | 30000 | Real BS Android devices cold-boot anywhere from 4s to 20s under load. |
| `globalNavigationBudgetMs` | 8000 | Hard ceiling per `snapshotStory` call across all ready-signal tiers. |
| `renderMs` | 1500 | Fallback delay after stability poll exhausts. |
| `stabilitySettleMs` | 200 | First stability capture deferred by this much to avoid catching the pre-render frame as "stable." |
| `cacheNavigatorState` | `false` | Opt-in. When true, the SDK keeps the drawer open + cached expanded groups across stories — saves ~500ms per intra-component story. |

Override per call:

```js
await percyStorybookSnapshot(driver, story, {
  globalNavigationBudgetMs: 12000,
  cacheNavigatorState: true,
});
```

## Deep-link mode (opt-in)

For customers willing to register a URL scheme in `app.json` (Expo) or `AndroidManifest.xml` (bare RN), deep-link navigation is faster (~500ms vs ~2s/story):

```js
await percyStorybookSnapshot(driver, story, {
  navigationStrategy: 'deeplink',
  appScheme: 'myapp',
  appPackage: 'com.acme.storybook',
});
```

URL form: `myapp:///?STORYBOOK_STORY_ID=<storyId>`. Storybook RN's built-in URL handler natively handles the parameter — no customer-side routing code required, just the scheme registration.

**iOS < 16.4 caveat:** `mobile: deepLink` is unreliable below iOS 16.4. The SDK throws `deep_link_unsupported_platform` and tells the customer to drop `navigationStrategy` to use the default UI-tap path (which works on all iOS versions).
