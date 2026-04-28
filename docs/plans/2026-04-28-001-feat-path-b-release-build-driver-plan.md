---
title: "Path B — Release-Build Driver for @percy/storybook-react-native"
type: feat
status: active
date: 2026-04-28
origin: docs/brainstorms/2026-04-28-path-b-release-build-driver-requirements.md
---

# Path B — Release-Build Driver for `@percy/storybook-react-native`

## Overview

Add a second driver mode to `@percy/storybook-react-native` that snapshots Storybook stories from a **release `.ipa`/`.apk`** running against any Appium endpoint (BrowserStack App Automate, Sauce Labs, AWS Device Farm, customer's grid, or a local emulator with a release binary). The new driver removes the Metro/channel-server dependency that the existing Path A relies on. Path A continues to work unchanged for local-emulator development; the new driver is selected automatically when the customer's `appium.server` points at a non-localhost host.

This unblocks **App Percy customers running production CI workflows** — they upload a release binary to App Automate, run our SDK in CI against the cloud Appium endpoint, and get one Percy snapshot per Storybook story without standing up Metro or BrowserStack Local tunnels.

## Problem Statement

The shipped Path A architecture works because three things share a localhost network: the customer's app (running on their dev simulator), Metro's port-7007 channel server (running on the customer's Mac), and the Percy SDK (also running on the customer's Mac). Story selection flows over Metro's `/select-story-sync` HTTP endpoint, which broadcasts `setCurrentStory` to the device app via WebSocket and waits for the device to ack the render.

That entire mechanism breaks for the App Automate / cloud-Appium model:

- **The device is in BrowserStack's data center**, not on the customer's machine.
- **The customer uploads a release `.ipa`/`.apk`**, not a debug build connected to Metro.
- **There is no Metro server** anywhere — production release builds bundle JS at build time.
- **No port 7007 is reachable from the cloud device** without setting up BrowserStack Local, which most customers don't want as a hard dependency on every CI run.

This excludes Percy's primary customer segment (App Percy users on BrowserStack's device cloud) from `@percy/storybook-react-native`. Path B is the architectural addition that opens that segment.

## Proposed Solution

A new **`ReleaseBuildDriver`** that drives story selection via Appium's `mobile: deepLink` command instead of Metro's channel server, paired with a tiny customer-side runtime helper that handles deep links inside the customer's app.

### High-level architecture

```
Customer's CI runner                         BrowserStack / Sauce / Local cloud
┌───────────────────────────────┐            ┌───────────────────────────────┐
│ npx percy exec -- npx percy   │            │ Real device                   │
│   storybook-rn                │            │                               │
│                               │            │ ┌───────────────────────────┐ │
│ ┌───────────────────────────┐ │            │ │ Customer's release app    │ │
│ │ Story enumerator          │ │            │ │ (the .ipa / .apk)         │ │
│ │ (parses .stories files)   │ │            │ │                           │ │
│ └────────────┬──────────────┘ │            │ │ App.js entry uses         │ │
│              ▼                │            │ │   storybookOrApp({...})   │ │
│ ┌───────────────────────────┐ │            │ │   from @percy/storybook-  │ │
│ │ Driver selector           │ │            │ │   react-native/runtime    │ │
│ │ • localhost → ChannelServer│ │            │ │                           │ │
│ │ • else → ReleaseBuild      │ │            │ │ On launch URL match:      │ │
│ └────────────┬──────────────┘ │            │ │   render Storybook        │ │
│              ▼                │            │ │ On subsequent deep links: │ │
│ ┌───────────────────────────┐ │            │ │   call view.setStory(id)  │ │
│ │ ReleaseBuildDriver        │ │  Appium    │ └───────────────────────────┘ │
│ │ • per-story:              │ │  W3C       │                               │
│ │   1. mobile: deepLink     │ ┼──cloud────►│   ◄── deep link arrives       │
│ │   2. wait waitForReadyMs  │ │  session   │                               │
│ │   3. takeScreenshot()     │ ◄────────────┤   ◄── PNG bytes back          │
│ └────────────┬──────────────┘ │            │                               │
│              ▼                │            └───────────────────────────────┘
│ ┌───────────────────────────┐ │
│ │ comparison-poster.js      │ │
│ │ POST :5338/percy/comparison│ │
│ └────────────┬──────────────┘ │
└──────────────┼────────────────┘
               ▼
   Percy CLI → App Percy backend → Build finalized
```

### Per-story flow

1. Driver composes deep link: `${customerScheme}://${customerPath}?storyId=${urlEncoded(storyId)}`
2. Driver calls Appium `mobile: deepLink` with platform-appropriate params (`{ url, bundleId }` for iOS, `{ url, package }` for Android).
3. Customer's app (already running in the Appium session) receives the URL via React Native's `Linking.addEventListener('url', ...)`.
4. The `storybookOrApp` runtime helper parses the URL, extracts `storyId`, calls `view.setStory(storyId)`. Storybook RN re-renders.
5. Driver waits `waitForReadyMs` (default 4000ms — same as Path A's settle backstop). Per-story override via Storybook's standard `parameters.percy.waitFor` for animated stories.
6. Driver calls `appium.takeScreenshot()`, posts to `localhost:5338/percy/comparison` with platform-detected `tag.osName`.
7. Move to next story. Same Appium session.

One Appium session, N stories. No Metro, no channel server, no WebSocket.

## Technical Approach

### Architecture

#### 1. Driver abstraction

Introduce a `Driver` interface in `src/drivers/`:

```js
// src/drivers/driver.js (informal interface, JSDoc-typed)
class Driver {
  /** @param {ResolvedConfig} config */
  constructor(config) {}
  /** Open the Appium session, perform any one-time setup. */
  async setupForBuild() {}
  /** Navigate to the named story; resolve when caller may screenshot. */
  async renderStory(storyId) {}
  /** Close the Appium session. */
  async teardownForBuild() {}
  /** Used by comparison-poster to set tag.osName, tag.deviceName etc. */
  getDeviceTag() { return { name: '...', osName: '...', osVersion: '...' }; }
}
```

Two concrete implementations:

| Class | Selected when | What it does per story |
|---|---|---|
| `ChannelServerDriver` | `appium.server` host is `localhost` or `127.0.0.1` | Existing Path A logic: `POST /select-story-sync/<id>` to Metro, await render-ack, settle, screenshot. |
| `ReleaseBuildDriver` | any other `appium.server` | New: send `mobile: deepLink` to customer's app, wait `waitForReadyMs`, screenshot. |

`runner.js` becomes driver-agnostic — its loop only knows about `Driver`, `AppiumClient`, and `comparison-poster`. The driver encapsulates the per-story navigation strategy.

#### 2. Driver selection

```js
// src/drivers/index.js
import { ChannelServerDriver } from './channel-server-driver.js';
import { ReleaseBuildDriver } from './release-build-driver.js';

export function selectDriver(config, log) {
  const url = new URL(config.appium.server);
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (isLocal) {
    log(`Driver: channel-server (localhost Appium endpoint)`);
    return new ChannelServerDriver(config);
  }
  log(`Driver: release-build (cloud Appium endpoint: ${url.hostname})`);
  return new ReleaseBuildDriver(config);
}
```

A `--driver` CLI flag overrides auto-detection (escape hatch for edge cases — e.g. customer running a release build against a local Appium for iteration).

#### 3. `ReleaseBuildDriver` implementation

```js
// src/drivers/release-build-driver.js (sketch)
export class ReleaseBuildDriver {
  constructor(config) {
    this.config = config;
    this.scheme = config.releaseBuild?.deepLinkScheme;
    this.path = config.releaseBuild?.deepLinkPath ?? 'percy';
    this.appium = new AppiumClient(config.appium);
  }

  async setupForBuild() {
    if (!this.scheme) throw err('release_build_misconfigured', 'storybook-rn.releaseBuild.deepLinkScheme is required.');
    await this.appium.connect();
    // First story is via initial URL — see notes on cold-launch optimization.
  }

  async renderStory(storyId) {
    const url = `${this.scheme}://${this.path}?storyId=${encodeURIComponent(storyId)}`;
    await this.sendDeepLink(url);
    await sleep(this.config.storybook.waitForReadyMs); // settle
  }

  async sendDeepLink(url) {
    const platform = this.appium.getPlatform();
    if (platform === 'iOS') {
      await this.appium.driver.execute('mobile: deepLink', {
        url,
        bundleId: this.config.appium.capabilities['appium:bundleId'],
      });
    } else if (platform === 'Android') {
      // Primary: Appium's mobile: deepLink (requires Android instant apps in some cases)
      try {
        await this.appium.driver.execute('mobile: deepLink', {
          url,
          package: this.config.appium.capabilities['appium:appPackage'],
        });
      } catch (cause) {
        // Fallback: am start with VIEW intent
        await this.appium.driver.execute('mobile: shell', {
          command: 'am',
          args: ['start', '-a', 'android.intent.action.VIEW', '-d', url, this.config.appium.capabilities['appium:appPackage']],
        });
      }
    } else {
      throw err('release_build_unsupported_platform', `Platform "${platform}" not supported. Only iOS and Android.`);
    }
  }

  async teardownForBuild() {
    await this.appium.disconnect();
  }

  getDeviceTag() {
    return {
      name: this.appium.getDeviceLabel(),
      osName: this.appium.getPlatform(),       // 'iOS' or 'Android' — was hardcoded in Path A
      osVersion: this.appium.getOsVersion(),
      deviceName: this.appium.getDeviceName(),
    };
  }
}
```

#### 4. Customer-side runtime helper

New subpath export `@percy/storybook-react-native/runtime`:

```js
// src/runtime/storybook-or-app.js
import { useEffect, useState } from 'react';
import { Linking } from 'react-native';

const URL_RE = (scheme, path) => new RegExp(`^${escapeRegex(scheme)}://${escapeRegex(path)}\\b`);

export function storybookOrApp({
  storybook: Storybook,
  app: App,
  view,
  scheme = 'percy',
  path = 'percy',
}) {
  const matcher = URL_RE(scheme, path);
  return function PercyOrAppRoot() {
    const [mode, setMode] = useState(/** @type {'loading' | 'storybook' | 'app'} */ ('loading'));

    useEffect(() => {
      Linking.getInitialURL().then((url) => {
        if (url && matcher.test(url)) {
          setMode('storybook');
          handleStoryUrl(url);
        } else {
          setMode('app');
        }
      });
      const sub = Linking.addEventListener('url', (e) => {
        if (matcher.test(e.url)) handleStoryUrl(e.url);
      });
      return () => sub.remove();
    }, []);

    function handleStoryUrl(url) {
      try {
        const parsed = new URL(url);
        const storyId = parsed.searchParams.get('storyId');
        if (storyId && view) view.setStory(storyId);
      } catch (e) {
        console.warn('[percy] failed to parse story URL', url, e);
      }
    }

    if (mode === 'loading') return null;
    return mode === 'storybook' ? <Storybook /> : <App />;
  };
}
```

Customer integration in their app entry:

```js
// App.js — customer's full Percy integration
import StorybookUIRoot, { view } from './.rnstorybook';
import App from './src/App';
import { storybookOrApp } from '@percy/storybook-react-native/runtime';

export default storybookOrApp({ storybook: StorybookUIRoot, app: App, view });
```

Three-line wrapper. Customer also adds `scheme` to `app.json` (Expo) or `Info.plist` + `AndroidManifest.xml` (bare RN). The `init` command scaffolds these.

#### 5. Schema additions

`.percy.yml` extension under `storybook-rn:`:

```yaml
storybook-rn:
  appium:
    server: https://hub-cloud.browserstack.com/wd/hub      # cloud → release-build
    capabilities:
      platformName: iOS
      "appium:platformVersion": "18.4"
      "appium:deviceName": "iPhone 16"
      "appium:bundleId": "com.yourcompany.yourapp"
      "appium:automationName": XCUITest
      "bstack:options":
        userName: "..."
        accessKey: "..."
        appiumVersion: "2.19.0"
  releaseBuild:                                            # NEW SECTION
    deepLinkScheme: myapp                                  # required for release-build mode
    deepLinkPath: percy                                    # default
  storybook:
    waitForReadyMs: 4000                                   # backstop settle
  include: ["**/*"]
  skip: []
```

`releaseBuild:` is required when the auto-detected mode is release-build, ignored when it's channel-server.

#### 6. Comparison-poster osName fix (R6)

Currently `comparison-poster.js` hardcodes `tag.osName: 'iOS'`. Refactor:

```js
// before
tag: { name: input.tag, osName: 'iOS', width, height }

// after
tag: { name: input.tag, osName: input.osName, osVersion: input.osVersion, width, height }
```

The driver passes `osName` from `getDeviceTag()` which reads `driver.capabilities.platformName`. ChannelServerDriver passes `'iOS'` for now (still iOS-only verified) but the API contract allows Android once we verify it.

### Implementation Phases

#### Phase 1 — Driver abstraction + auto-detection (~4–5 days)

**Goal:** Refactor the runner to be driver-agnostic. Existing Path A behavior unchanged.

**Tasks:**
- New `src/drivers/driver.js` (interface contract, no concrete logic).
- New `src/drivers/channel-server-driver.js` — extract existing `StorybookChannelClient`-based logic out of `runner.js` into this class, behind the `Driver` interface.
- New `src/drivers/release-build-driver.js` — skeleton class that throws `not_yet_implemented` until Phase 2.
- New `src/drivers/index.js` — `selectDriver(config, log)` auto-detection.
- Modified `src/runner.js` — driver-agnostic loop:
  ```js
  const driver = selectDriver(config, log);
  await driver.setupForBuild();
  for (const story of stories) {
    await driver.renderStory(story.id);
    const png = await driver.appium.takeScreenshot();
    await postSnapshotComparison({ ...nameAndTag, screenshotBase64: png, osName: driver.getDeviceTag().osName });
  }
  await driver.teardownForBuild();
  ```
- Modified `src/config.js` — add `releaseBuild:` block to `PERCY_CONFIG_SCHEMA` (optional).
- Modified `src/comparison-poster.js` — accept `osName` from caller (Path A passes `'iOS'`, Phase 2 ReleaseBuildDriver passes detected platform).
- Modified `src/commands/storybook-rn.js` — add `--driver` flag (auto/channel-server/release-build).
- Tests:
  - `test/drivers/select-driver.test.js` — auto-detection: localhost → channel-server, hub-cloud.browserstack.com → release-build, --driver flag override.
  - `test/drivers/channel-server-driver.test.js` — same coverage that `test/runner.test.js` had for the channel-server flow, just run through the new abstraction.
  - Existing `test/comparison-poster.test.js` — update to assert `osName` is read from caller, not hardcoded.

**Success criteria:**
- All 38 existing tests pass against the refactored code, plus ~10 new tests for driver selection.
- `npx percy storybook-rn --config-dir examples/RNStorybookFixture/.rnstorybook` (Path A flow, localhost) produces the same Percy build it does today (build #12-equivalent).
- `npx percy storybook-rn --driver release-build` against the fixture throws a clear `not_yet_implemented` error in `setupForBuild`.

#### Phase 2 — `ReleaseBuildDriver` core: deep links + settle + screenshot (~5–6 days)

**Goal:** End-to-end story navigation via Appium deep links, on iOS Simulator first.

**Tasks:**
- Implement `ReleaseBuildDriver.setupForBuild()` — opens Appium session via `AppiumClient.connect()`, validates `releaseBuild.deepLinkScheme` is set.
- Implement `ReleaseBuildDriver.sendDeepLink(url)` — platform-aware:
  - iOS: `driver.execute('mobile: deepLink', { url, bundleId })` (requires `appium:bundleId` in capabilities).
  - Android primary: `driver.execute('mobile: deepLink', { url, package })`.
  - Android fallback: `driver.execute('mobile: shell', { command: 'am', args: ['start', '-a', 'android.intent.action.VIEW', '-d', url, '<package>'] })` — used when `mobile: deepLink` is unavailable or returns "instant apps disabled" on the device.
- Implement `ReleaseBuildDriver.renderStory(storyId)` — composes URL, sends deep link, sleeps `waitForReadyMs`.
- Per-story `parameters.percy.waitFor` override: extend `story-enumerator.js` to extract this parameter from each `.stories.*` file and attach to the `StoryDescriptor`. Driver consults `story.waitForOverride` first, falling back to config default.
- `getDeviceTag()` reads from `driver.capabilities.platformName` / `platformVersion` / `deviceName` (or `appium:deviceName`).
- Tests:
  - Stub `webdriverio.remote()` and assert: iOS path sends `mobile: deepLink` with `bundleId`; Android path sends with `package`; Android fallback fires when primary throws.
  - URL composition: special characters in storyId are URL-encoded.
  - `parameters.percy.waitFor` extraction from a fixture stories file.
- Manual verification: against the `examples/RNStorybookFixture` rebuilt as a release build (signed dev profile, distributed to local iOS simulator via `xcrun simctl install`), point `appium.server` at a local Appium and verify all 7 stories snapshot correctly.

**Success criteria:**
- Local iOS simulator + release-build fixture produces a Percy build with all 7 stories (build #13-equivalent).
- Android local emulator + release-build fixture produces a Percy build with all 7 stories.
- `tag.osName` correctly reflects platform (no longer hardcoded `'iOS'`).

#### Phase 3 — Customer entry-point gate runtime helper (~3–4 days)

Runs in parallel with Phase 2.

**Goal:** Customer-side helper that gates Storybook vs App and handles deep-link routing.

**Tasks:**
- New file `packages/storybook-react-native/src/runtime/storybook-or-app.js` (sketch above).
- New subpath export in `packages/storybook-react-native/package.json`:
  ```json
  "exports": {
    ".": "./src/index.js",
    "./runtime": "./src/runtime/storybook-or-app.js"
  }
  ```
- Tests using React Testing Library or a lightweight React renderer:
  - On Percy URL: renders Storybook component, calls `view.setStory(storyId)`.
  - On non-Percy URL: renders App component, ignores deep links.
  - On subsequent deep link arriving while in Storybook mode: calls `view.setStory(newStoryId)`.
  - On unparseable URL: falls back to App, logs warning.
  - Cleanup: `Linking.addEventListener` subscription is removed on unmount.
- Update `examples/RNStorybookFixture/App.js` to use the helper, demonstrating the integration shape customers will copy.

**Success criteria:**
- Helper renders correctly against a synthetic React tree in unit tests.
- Fixture's release build shows Storybook when launched with the Percy URL, real "App" content otherwise.

#### Phase 4 — `init` + `doctor` updates for release-build mode (~3–4 days)

**Goal:** `npx @percy/cli storybook-rn:init` scaffolds release-build templates when appropriate; `doctor` adapts checks.

**Tasks:**
- `init` interactive prompt (single yes/no): "Will you primarily run this against a cloud Appium endpoint (BrowserStack, Sauce, etc.)?"
  - If yes: scaffold release-build `.percy.yml` template (with `bstack:options` placeholder, `releaseBuild.deepLinkScheme`).
  - If no: existing channel-server template.
  - Either way: print instructions for adding the URL scheme to `app.json` (Expo) / `Info.plist` + `AndroidManifest.xml` (bare RN), and the 3-line `App.js` change using the runtime helper.
- `doctor` adapts checks based on the auto-detected driver mode:
  - **Channel-server mode (existing):** PERCY_TOKEN, Percy CLI server, Appium reachable, Storybook channel reachable on :7007.
  - **Release-build mode (new):** PERCY_TOKEN, Percy CLI server, Appium hub reachable (curl `${appium.server}/status`), `releaseBuild.deepLinkScheme` set, BrowserStack credentials valid (if hostname matches `*.browserstack.com`, hit `/health` on the BrowserStack REST API with credentials).
- Tests for both `init` flows and both `doctor` modes.

**Success criteria:**
- `init` produces a working `.percy.yml` for both modes.
- `doctor` returns 4/4 ✓ for a properly configured release-build setup against a BrowserStack hub URL.

#### Phase 5 — Documentation, release-build fixture target, end-to-end verification (~3–5 days)

**Goal:** Customer-facing docs + a verified Percy build against real BrowserStack App Automate.

**Tasks:**
- Extend `packages/storybook-react-native/SETUP.md` with a Path B section:
  - When to use Path B vs Path A.
  - Customer `App.js` change (3 lines + 1 import).
  - URL scheme registration for Expo + bare RN.
  - `.percy.yml` capabilities for App Automate / Sauce Labs / AWS Device Farm.
  - The runtime helper API and per-story `parameters.percy.waitFor` Storybook convention.
- Extend the fixture: add a release-build target.
  - For Expo fixture: document `npx expo prebuild` + `npx expo run:ios --configuration Release` (produces a release-signed `.ipa`).
  - Add a new `examples/RNStorybookFixture/App.js` that uses `storybookOrApp` (currently it just renders `StorybookUIRoot`).
- End-to-end verification on real BrowserStack App Automate:
  - Get App Automate access keys.
  - Build a release `.ipa` of the fixture, upload to App Automate via REST API, store `app_url`.
  - Point `appium.server` at `https://hub-cloud.browserstack.com/wd/hub`, capabilities reference the uploaded app.
  - Run `percy exec -- npx percy storybook-rn` against the fixture from the project's CI.
  - Verify a Percy build appears with all 7 stories captured on a real BrowserStack iPhone.
  - Repeat for Android (real BrowserStack Pixel).
- Document the verified Percy build URLs as proof points (alongside builds #11, #12 from Path A).

**Success criteria:**
- One Percy build from real BrowserStack App Automate iOS device.
- One Percy build from real BrowserStack App Automate Android device.
- SETUP.md customer can follow cold and reach a green build (target for design partner #1).

### Total estimated effort

~4–5 weeks for one engineer, with Phase 2 + Phase 3 running in parallel weeks 2–3. Two engineers could compress to ~3 weeks.

## Alternative Approaches Considered

| Approach | Why rejected |
|---|---|
| **Path A (channel server) only — extend with BrowserStack Local tunnel.** Customer runs `BrowserStackLocal` binary on their machine, cloud devices reach Metro through the tunnel. | Works (called Path A-extended in the brainstorm), but unusual for App Automate workflow. Most customers upload release binaries; Metro debug-build flow doesn't fit. Customer adds a new long-running process to CI. Higher friction than Path B. Kept as a documented option, not the recommended one. |
| **Per-story device-session relaunch.** Each story = new Appium session, app launched with the deep link as the initial URL. | App Automate cost model is per-session-minute. Setup overhead is ~30s/session. 100 stories = 50+ minutes of pure session-startup overhead (10× cost vs single-session). No reliability benefit because in-session deep links are well-supported. |
| **UI-driven story navigation.** Appium taps on Storybook sidebar items by accessibility ID or text. | Fragile (Storybook UI text/structure changes between versions, theme/locale changes). Slower than deep links (multiple taps + animations per story). Adds large surface area of UI selectors that change with Storybook major versions. Deep links bypass the UI entirely. |
| **In-app marker for render-ack (accessibility ID, log marker, in-app HTTP).** Customer's Storybook decorator emits a "ready" signal we poll. | Adds customer integration cost (new decorator in `preview.tsx`). The fixed `waitForReadyMs` settle delay we use in Path A has been adequate; pixel-stable polling considered + rejected for over-engineering. Per-story `parameters.percy.waitFor` is the customer escape hatch when needed (and it's a Storybook standard, not Percy-specific). |
| **Pixel-stable polling.** SDK takes 2–5 screenshots per story until two consecutive ones are pixel-identical. | Considered + rejected. 3–5× device-minute consumption on App Automate is real money, with marginal reliability gain over fixed delay. Add as opt-in mode if production data shows the fixed delay is too flaky. |
| **Replace Path A with Path B.** | No. Path A is materially better for the developer dev-loop on a Mac (one-process Metro, no app rebuild per change). Local-emulator + dev build with HMR is the right tool for "I'm iterating on a story". Path B is the right tool for CI / production. Both ship, customer's `appium.server` config picks. |

## System-Wide Impact

### Interaction Graph

Trace of a single `npx percy exec -- npx percy storybook-rn` invocation in release-build mode:

1. **CLI invocation** → Percy CLI starts local server on `:5338` → loads our `@percy/cli`-registered commands → invokes `storybook-rn` command.
2. **Story enumeration** → reads `.rnstorybook/main.{ts,js}` → walks `.stories.*` files → produces `StoryDescriptor[]` (existing logic, plus extracted `parameters.percy.waitFor` per story in Phase 2).
3. **Driver selection** → `selectDriver(config)` reads `appium.server` host. Cloud hub URL → `ReleaseBuildDriver`.
4. **`driver.setupForBuild()`** → validates `releaseBuild.deepLinkScheme` is set → opens Appium session via `webdriverio.remote()` against the cloud endpoint, with full capabilities including `bstack:options` for App Automate. App Automate auto-launches the app on the device.
5. **Customer's app boots on device** → `App.js`'s `storybookOrApp` helper runs → `Linking.getInitialURL()` returns null on cold launch (no URL passed via launch args) → renders `App` (the customer's real app, OR for the fixture, just the Storybook UI placeholder).
   - **Optimization (Phase 2.5):** SDK passes the first story's deep link as `appium:processArguments.args` so the cold-launch initial URL skips a useless first-story navigation round-trip. Saves ~1s per build.
6. **Per story (driver.renderStory):**
   - SDK composes URL `${scheme}://${path}?storyId=${id}`.
   - SDK calls `driver.execute('mobile: deepLink', { url, bundleId })` (iOS) or `{ url, package }` (Android, with shell-am-start fallback).
   - App Automate / Appium dispatches the URL to the customer's app on-device.
   - Customer's app receives via `Linking.addEventListener('url', ...)` → `storybookOrApp` extracts `storyId` → calls `view.setStory(storyId)`.
   - `view.setStory` emits Storybook's `SET_CURRENT_STORY` event on the in-process channel → Storybook RN remounts the story tree.
   - SDK sleeps `waitForReadyMs` (or per-story override) → calls `appium.takeScreenshot()` → reads PNG IHDR for dimensions → `postSnapshotComparison({ name, tag: { name, osName: 'iOS'|'Android', width, height }, tiles })`.
   - Percy CLI on `:5338` accepts the comparison, queues for upload to App Percy backend.
7. **`driver.teardownForBuild()`** → `driver.deleteSession()` ends the Appium session. App Automate cleans up the device.
8. **Percy CLI** finalizes the build, prints `https://percy.io/.../builds/<id>`.

### Error & Failure Propagation

| Layer | Failure | Handling |
|---|---|---|
| Driver selection | `releaseBuild.deepLinkScheme` missing | Fail fast in `setupForBuild` with `release_build_misconfigured` error code. Pre-flight via `doctor`. |
| Appium session open | Cloud hub unreachable / credentials invalid | `appium_unreachable` from existing `AppiumClient`. Clear message pointing at `bstack:options.userName`/`accessKey`. |
| Deep-link command | `mobile: deepLink` fails on iOS | Throws `release_build_deeplink_failed` with the underlying Appium error. Per-story; build continues with that story marked failed. |
| Deep-link command | `mobile: deepLink` fails on Android (instant apps disabled) | Auto-fallback to `mobile: shell am start ...`. If that also fails, story marked failed, build continues. |
| Customer app | App not in foreground when deep link fires | iOS brings to foreground automatically; Android usually does. If app crashes mid-build, subsequent stories all fail with screenshots-of-crash → SDK detects via consecutive failures pattern, optionally aborts after 3 consecutive failures. |
| `view.setStory` | Unknown storyId (story enumeration found stale data) | Storybook RN logs internal warning; whatever was previously rendered stays on screen → SDK still takes a screenshot. Result: duplicate snapshot of previous story. Mitigation: log warning in SDK ("storyId X may not have rendered"). |
| Settle wait | Story has permanent animation (looping spinner) | Configurable per-story via `parameters.percy.waitFor`. Default 4s captures whatever frame is on screen at t=4s. |
| Screenshot | `driver.takeScreenshot()` fails | Existing `screenshot_failed` error code. Story marked failed, build continues. |
| postComparison | Percy CLI server returns error (quota, schema validation) | Existing flow — story marked errored, surfaced in CI logs. Build can still finalize as partial. |
| Session timeout | App Automate session expires (default ~10–30 min) | Caught by Appium client; SDK logs warning, finalizes Percy build with whatever stories captured so far. Customer needs to enable longer session timeout or shard stories across builds. |
| Build finalize | Comparison upload mismatch / orphan tiles | Existing Percy CLI handling — error reported with build URL for debugging. |

### State Lifecycle Risks

| Risk | Mitigation |
|---|---|
| App state accumulates across stories within a session (memory, navigation stack from previous story remnants, network requests in flight from previous story) | Storybook RN remounts the story component tree on `setStory`, reseting React-level state. Side effects (analytics events, fetches) leak across stories — acceptable for visual testing since Percy compares pixels. Customers concerned about deep state isolation can use `parameters.percy.skip` for problematic stories. |
| Customer's URL scheme collides with their existing routes (OAuth, password reset, share sheet) | Path namespacing (`myapp://percy?storyId=...`) prevents collision with `myapp://oauth?...` etc. The runtime helper matches only on the path, not the bare scheme. |
| App Automate session state from a previous build | App Automate gives clean device sessions per Appium session — no state leak between builds at the device level. |
| Customer's `view` global is constructed even when rendering App (not Storybook) | Negligible memory cost (story registry is loaded but UI doesn't mount). For customers who care, document an alternative pattern that lazy-loads `.rnstorybook` only when the storybook URL is detected. Not a Phase 1 requirement. |

### API Surface Parity

- **`@percy/storybook-react-native` package:**
  - `src/runner.js` — refactored to driver-agnostic loop (Phase 1).
  - `src/comparison-poster.js` — `osName` now caller-supplied (Phase 1). Backwards-compat: defaults to `'iOS'` if omitted, so no breaking change for any external caller.
  - `src/index.js` — exports `selectDriver`, `ChannelServerDriver`, `ReleaseBuildDriver` for advanced consumers (and tests).
  - New subpath export `./runtime` — pure customer-side React, no Appium/Percy CLI deps.
- **`.percy.yml` schema:**
  - New optional `releaseBuild:` block under `storybook-rn:`. Backwards-compat: omitted → channel-server mode (existing behavior).
- **CLI flags:**
  - New `--driver auto|channel-server|release-build`. Default `auto`.
  - Existing `--include`, `--stories`, `--config-dir`, `--dry-run` unchanged.
- **Subcommands:**
  - `storybook-rn` — same surface, internal driver dispatch is new.
  - `storybook-rn:init` — adapts scaffolding based on customer answer (Phase 4).
  - `storybook-rn:doctor` — adapts checks based on driver mode (Phase 4).
- **Percy CLI plugin metadata:** unchanged. Same `package.json` `@percy/cli.commands` entry.
- **Percy backend:** unchanged. Same `:5338/percy/comparison` endpoint, same App Percy build creation. Only the `tag.osName` field starts varying per platform (was constant `'iOS'` before).

### Integration Test Scenarios

Five cross-layer scenarios that unit tests with mocks would never catch:

1. **Driver auto-detection round-trip.** Same fixture, two `.percy.yml` configs (localhost + cloud). Verify both produce green Percy builds with matching story counts. Confirms the driver abstraction doesn't introduce regressions in either mode.
2. **iOS release build deep-link round-trip.** Fixture release `.ipa` installed on iOS Simulator, Appium running locally. SDK sends 7 deep links, all 7 stories render and snapshot. Confirms `mobile: deepLink` + customer helper work end-to-end on iOS.
3. **Android release build deep-link round-trip.** Same as #2, on an Android emulator. Confirms `mobile: deepLink` + Android intent handling + `package` capability work end-to-end.
4. **App Automate cold-launch + deep-link.** Fixture release `.ipa` uploaded to BrowserStack, real BrowserStack iPhone. Full E2E across the cloud network. Confirms there's no hidden localhost assumption in the flow.
5. **Storyless fallback.** Customer's enumeration produces a stale storyId that no longer exists in the bundle. SDK still completes the build, story marked errored with a helpful warning, others succeed. Confirms graceful degradation.

## Acceptance Criteria

### Functional Requirements

- [ ] `npx percy storybook-rn` against a `localhost`/`127.0.0.1` Appium endpoint uses `ChannelServerDriver` (existing Path A behavior, no regression).
- [ ] `npx percy storybook-rn` against any non-localhost Appium endpoint uses `ReleaseBuildDriver`.
- [ ] `--driver` flag overrides auto-detection.
- [ ] `ReleaseBuildDriver` sends `mobile: deepLink` with `bundleId` on iOS, `package` on Android.
- [ ] Android `mobile: deepLink` failure auto-falls-back to `mobile: shell am start -a android.intent.action.VIEW -d <url>`.
- [ ] `storybookOrApp` runtime helper renders Storybook when launched via the configured Percy URL scheme, else renders the customer's app.
- [ ] `storybookOrApp` handles subsequent `Linking` events while in Storybook mode, calling `view.setStory` for each.
- [ ] `parameters.percy.waitFor` per-story override (Storybook standard) parsed from `.stories.*` files and respected by both drivers.
- [ ] `tag.osName` correctly reflects platform from Appium capabilities (no longer hardcoded).
- [ ] `init` scaffolds release-build templates when customer chooses cloud target; channel-server templates otherwise.
- [ ] `doctor` runs mode-appropriate checks (channel-server skips `:7007` check in release-build mode; release-build adds App Automate hub reachability check).

### Non-Functional Requirements

- [ ] Per-build wall-clock for a 100-story library on App Automate ≤ 2× the local-emulator path's wall-clock for the same library.
- [ ] Customer change to adopt Path B from a Path A integration: ≤10 lines (config + URL-scheme registration + `App.js` import/wrap), excluding the customer's existing Storybook RN setup.
- [ ] No regressions on Path A: existing `examples/RNStorybookFixture` produces a Percy build identical in structure to build #12.
- [ ] Path B's URL scheme registration is documented for both Expo and bare RN.

### Quality Gates

- [ ] Existing 38 unit tests still green after the driver abstraction refactor.
- [ ] New tests for: `selectDriver` auto-detection, deep-link command shaping (iOS + Android), Android fallback, runtime helper URL gating, runtime helper deep-link routing, `parameters.percy.waitFor` extraction, `osName` propagation through comparison-poster.
- [ ] Integration test (gated, manual for now): release-build fixture on local iOS Simulator + Android emulator, both produce green Percy builds.
- [ ] One verified Percy build against real BrowserStack App Automate iOS device.
- [ ] One verified Percy build against real BrowserStack App Automate Android device.
- [ ] SETUP.md updated with Path B section that a customer following cold can use without engineer help.
- [ ] Fixture's release-build target builds successfully on a clean machine via `npx expo prebuild && npx expo run:ios --configuration Release`.

## Success Metrics

Per the brainstorm, MVP success is binary and customer-validated:

- **Primary:** One external customer integrates against App Automate self-serve from public docs, runs ≥10 Percy builds over ≥1 week, with **zero synchronous engineer assistance.**
- **Secondary (cost ceiling):** Path B's per-100-story-build device-minute consumption on App Automate is within 2× the local-emulator path's wall-clock cost. If it's >5×, sharding becomes a Phase 6 priority.
- **Tertiary (regressions):** All existing Path A customer integrations continue to work without code changes (auto-detection routes them correctly).

## Dependencies & Prerequisites

| Dependency | Owner | Blocking? |
|---|---|---|
| BrowserStack App Automate access (org-level account, test credentials) | Percy infra/PM | Yes — Phase 5 verification blocker |
| Confirm Appium `mobile: deepLink` command on `xcuitest@8.4.3` and `appium-uiautomator2-driver` work as documented | Implementation team | Yes — Phase 2 starts with a 1-day spike to verify this against a hand-crafted fixture before committing to the API shape |
| Storybook RN `view.setStory` (or equivalent) callable without WS connection | Verified ✅ via source read at `dist/index.js:1679,1700`. `_setStory` is the underscore-prefixed internal; `setStory` is exposed via `getStorybookUI` return object | No |
| URL-scheme registration patterns for Expo + bare RN | Documented in Expo docs (`app.json`) and React Native docs (Info.plist + AndroidManifest) | No |
| Percy CLI server `:5338/percy/comparison` accepts platform-detected `tag.osName` | Confirmed from `@percy/core` `comparisonSchema` — `osName` is a valid `tag` field | No |

## Risk Analysis & Mitigation

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| **R1**: Android `mobile: deepLink` "instant apps disabled" caveat causes silent failures on real devices | High | Medium | Auto-fallback to `mobile: shell am start ... -a android.intent.action.VIEW` (documented works even without instant apps). Phase 2 unit test verifies fallback fires when primary throws. |
| **R2**: iOS `mobile: deepLink` requires Safari hop on simulator in some xcuitest versions, opening Safari → URL handler → app | Medium | Medium | Verify with `xcuitest@8.4.3` (our pinned version) during Phase 2 spike. If problematic, document `mobile: launchApp` with `arguments: ['--percy-url', url]` as alternative + add a custom launch-arg parser to the `storybookOrApp` helper. |
| **R3**: `Linking.addEventListener` doesn't fire for some deep-link delivery paths on iOS (Universal Links vs. URL scheme handling differences) | Medium | Medium | Use plain URL scheme (e.g. `myapp://`), NOT Universal Links. Universal Links require server-side `apple-app-site-association` files which add prerequisite friction. URL schemes work uniformly. |
| **R4**: Customer's existing URL scheme is shared with OAuth / password reset / share sheet → ambiguous routing | Medium | Low | Path namespacing (`myapp://percy?storyId=...`). The runtime helper matches only when path is `/percy` (configurable). Customer's other routes (`myapp://oauth?code=...`) don't trigger Storybook mode. Document this clearly in SETUP.md. |
| **R5**: App Automate session timeout (~10–30 min default) limits stories per build | Medium | Medium | Document session-timeout extension via `bstack:options.idleTimeout` capability (BrowserStack-specific). For libraries >300 stories, Phase 6 sharding becomes necessary. Explicitly call out as out-of-scope for MVP. |
| **R6**: Customer publishes a Storybook-as-app to App Store and gets rejected | Low | High | SETUP.md must explicitly state: Path B builds are for INTERNAL CI testing only, never for App Store submission. The runtime helper's `storybookOrApp` pattern means a single binary CAN serve both purposes — Storybook for CI, real app for App Store — same binary, different launch URL. |
| **R7**: `view.setStory(unknownStoryId)` silently no-ops; SDK screenshots whatever was on screen | Medium | Low | Driver logs warning when this happens (story enumeration was stale). Build still completes; affected stories show as "duplicates" of the previous story in Percy diff dashboard. Customers re-running enumeration on every build means stale enums are rare in practice. |
| **R8**: `mobile: deepLink` parameter name mismatches between driver versions (e.g. `bundleId` vs `appium:bundleId` capability key) | Medium | Low | Phase 2 spike verifies exact param names against `xcuitest@8.4.3` and current `uiautomator2`. If we encounter version drift in customer environments, peer-dep version pin in `package.json`. |
| **R9**: App Automate device-minute cost spikes on rollout (10× a customer's current usage) | Medium | Medium | Math: 100 stories × ~3s/story + 30s setup + 30s teardown ≈ 6 min/build. At ~$0.50–$1/device-minute, $3–$6 per build. Customers running 50 PR builds/day = $150–$300/day. Document upfront in SETUP.md. Sharding (Phase 6) is the optimization if customers complain. |
| **R10**: `Linking.getInitialURL()` returns the cold-launch URL on iOS but `null` on some Android configurations, breaking the gate logic | Low | Medium | Test on actual iOS + Android during Phase 3. Fallback: customer can opt to launch with a build-time env var (`PERCY_STORYBOOK_MODE=1`) detected at app boot, bypassing `Linking` entirely. Document as alternative. |
| **R11**: Customer's `view` is `undefined` if they don't import `view` from `.rnstorybook` — `view.setStory` throws | Medium | Low | The `storybookOrApp` helper requires `view` as a parameter. If undefined, log a clear warning ("Pass `view` from .rnstorybook to enable in-session story switching") and fall back to relaunch-per-story behavior. |

## Resource Requirements

- **Engineering:** 1 RN-experienced full-stack engineer for ~4–5 weeks. Could compress to ~3 weeks with a 2nd engineer running Phase 3 in parallel with Phase 2.
- **Infra:** BrowserStack App Automate access (existing Percy infrastructure has this; need a non-prod project token for Phase 5 verification).
- **Customer-facing:** 1–2 design partners willing to integrate Path B during Phase 6 (post-MVP); not blocking the engineering work but blocking the success metric.

## Future Considerations

Not in MVP scope but informed by this plan:

- **Sharding** — split N stories across M parallel Appium sessions. Mitigates session-timeout for huge libraries (>300 stories) and reduces wall-clock time. Architecturally, the driver abstraction supports this — runner can construct M drivers with disjoint story-id partitions.
- **Custom-binary support** — currently the customer's app is the "fixture" of itself. Some customers may want Percy to bundle a Storybook-only release binary on their behalf (similar to Sherlo's model). Not Phase 1; document as Path C if customer demand emerges.
- **Sauce Labs / AWS Device Farm provider integration** — same code path as App Automate, but currently no provider auto-detection like `@percy/appium-app`'s `AppAutomateProvider`. If customers on those clouds report quality-of-life issues, add per-cloud providers.
- **`Linking` event polling for in-session story switches when `Linking.addEventListener` is unreliable** — if R3 / R10 surface in production, add a poll-based alternative inside `storybookOrApp` that periodically checks `Linking.getInitialURL()` (some platforms keep updating it).
- **Detox / Maestro replacement for Appium** — Appium is the lowest-common-denominator. Detox (RN-native test runner) and Maestro (declarative mobile UI) are viable alternatives. If Appium proves too slow on App Automate, consider Detox-based driver as a faster alternative for the local-emulator path.

## Documentation Plan

- **`packages/storybook-react-native/SETUP.md`** — extend with:
  - "When to use Path A vs Path B" decision table at the top.
  - Path B section with full step-by-step (URL scheme registration, `App.js` change, `.percy.yml` capabilities for App Automate / Sauce / AWS Device Farm).
  - Update the "Known gotchas" section to include R1, R2, R3, R4, R6 above with their fixes.
  - Update error catalog with new codes: `release_build_misconfigured`, `release_build_deeplink_failed`, `release_build_unsupported_platform`.
- **`examples/RNStorybookFixture/README.md`** — add a Path B section showing how to build the release target locally and run against local Appium without Metro.
- **`packages/storybook-react-native/README.md`** — add Path B to the architecture diagram.
- **Top-level `README.md`** — Path B mentioned in the Status section once Phase 5 verification completes.
- **JIRA ticket PER-7859** — add a comment when Path B ships an MVP, mirroring the format of the Path A "what's working" comment.

## Sources & References

### Origin

- **Origin document:** [`docs/brainstorms/2026-04-28-path-b-release-build-driver-requirements.md`](../brainstorms/2026-04-28-path-b-release-build-driver-requirements.md). Key decisions carried forward:
  1. Single-session + `mobile: deepLink` is the primary mechanism (not relaunch-per-story).
  2. Scoped as "release-build driver" not "App Automate driver" — same code works against any non-localhost Appium endpoint.
  3. Coexist with Path A via auto-detection on `appium.server` host.
  4. Render-ack: fixed-delay backstop, zero customer integration; per-story override via Storybook's standard `parameters.percy.waitFor`.

### Internal references

- Path A v2 plan: [`docs/plans/2026-04-27-002-feat-storybook-react-native-component-testing-v2-plan.md`](./2026-04-27-002-feat-storybook-react-native-component-testing-v2-plan.md) — the architectural baseline.
- Existing `runner.js` story loop: `packages/storybook-react-native/src/runner.js` — to be refactored in Phase 1.
- `comparison-poster.js`: `packages/storybook-react-native/src/comparison-poster.js` — `osName` hardcode at line ~52, fix in Phase 1.
- `AppiumClient`: `packages/storybook-react-native/src/appium-client.js` — extends with `getPlatform()`, `getOsVersion()`, `getDeviceName()` accessors in Phase 2.
- Percy build #11 (Path A end-to-end with channel server): https://percy.io/9560f98d/app/test-app-ak-af154739/builds/49141889
- Percy build #12 (Path A with auto-enumeration): https://percy.io/9560f98d/app/test-app-ak-af154739/builds/49143218
- JIRA ticket: https://browserstack.atlassian.net/browse/PER-7859

### External references

- Appium `mobile: deepLink` (iOS xcuitest): [`appium-xcuitest-driver` capabilities reference](https://appium.github.io/appium-xcuitest-driver/latest/reference/capabilities/) — accepts `{ url, bundleId }`.
- Appium `mobile: deepLink` (Android uiautomator2): [`appium-uiautomator2-driver`](https://github.com/appium/appium-uiautomator2-driver) — PR #151 added the command; works with `{ url, package }`.
- Android intent fallback (`am start -a android.intent.action.VIEW -d`): [Appium activity startup docs](https://github.com/appium/appium-uiautomator2-driver/blob/master/docs/activity-startup.md).
- Storybook RN `view.setStory` API: `dist/index.js:1679,1700` in installed `@storybook/react-native@10.3.2` — channel-emit pattern.
- React Native `Linking` API: [official docs](https://reactnative.dev/docs/linking) — `getInitialURL()`, `addEventListener('url', ...)`.
- Percy CLI `comparisonSchema`: [`@percy/core/dist/config.js`](https://github.com/percy/cli/blob/master/packages/core/src/config.js) — confirms `tag.osName` accepts arbitrary string.
- Percy `@percy/appium-app` `AppAutomateProvider`: [`percy/percy-appium-js`](https://github.com/percy/percy-appium-js) — pattern reference for App-Automate-specific niceties (selected for reuse evaluation in Phase 4).

### Related work

- Path A complete (shipped): commit history in `feat/customer-deliverable` branch of [`percy/percy-react-native-support`](https://github.com/percy/percy-react-native-support).
- Open PR #1 in same repo — Path A customer-deliverable polish (auto-enumeration, SETUP doc, etc.).

---

## Deepening Insights & Plan Amendments

**Deepened on:** 2026-04-28
**Sections enhanced:** 9 parallel agents (3 best-practices research, 1 framework-docs research, 1 architecture review, 1 feasibility review, 1 performance/cost review, 1 security review, 1 App Store research) + 2 web searches
**User focus:** verify the 8 specific concerns from the brainstorm; surface architectural risks not yet named.

### Key Improvements

1. **Storybook RN already ships a deep-link convention we should use, not invent around.** `?STORYBOOK_STORY_ID=<id>` is intercepted natively at `dist/index.js:1591` (cold-launch) and `:1566` (warm-launch). Eliminates the need for a custom URL scheme + helper. The customer-side surface area collapses to nearly zero.
2. **`view.setStory` does not exist as a public API.** The brainstorm's load-bearing assumption was wrong. The correct programmatic API is `view._channel.emit(SET_CURRENT_STORY, { storyId })` — works without WebSocket — but only one rung up from private. Better: `getStorybookUI({ initialSelection })` for cold-start + the built-in `?STORYBOOK_STORY_ID=` convention for warm-launch.
3. **App Store rejection risk is real and the plan's R6 mitigation cited the wrong guideline.** Real risk is §2.3.1 (Hidden Features) + §5.1.2 (Privacy Manifest), not §3.3.2 (DPA). Industry standard pattern (Shopify, Expo, Microsoft) is **separate build target/scheme**, not runtime-gated single binary. **The plan flips: recommend separate target as primary; runtime-gated single binary listed only as explicit fallback with all warnings.**
4. **Cost math was wrong by ~10×.** App Automate is parallel-slot subscription ($249/mo per parallel), not per-device-minute. Real cost is $0.30–$2/build, not $3–$6. Per-story latency was underestimated — realistic 6.5–9s P50, 100-story builds at 13–19 min wall-clock (borderline 2× breach).
5. **Pixel-stable polling rejection was wrong directionally.** Early-exit polling at 200ms intervals *reduces* device-minutes for stable stories (most settle <1s) and only spends the full 4s on the animated few. Should be Phase 2 primitive.
6. **Deep-link silent no-op is the dominant production failure mode** for `mobile: deepLink`. iOS 16.3- has Safari hop hangs. Android 12+ has the `null`-return bug ([java-client#1955](https://github.com/appium/java-client/issues/1955)). Plan needs a **handshake / self-test step at `setupForBuild`** to fail fast before burning 100 stories on broken deep-link delivery.
7. **Architecture issues** — driver abstraction leaks via `.appium` access; runtime helper should be a **separate package** not subpath export; `osName` should be **required not defaulted**; `parameters.percy.waitFor` extraction needs **AST parser**, not regex.
8. **`__DEV__` gating in default Storybook RN init code strips Storybook from release builds.** This is a real concrete concern — the customer's `index.js` template has `if (__DEV__)` around Storybook imports. Without `init` rewriting this (with a codemod, not regex), the release build won't actually contain Storybook.
9. **Security threats** — universal deep-link activation, internal UI disclosure, URL-scheme collision with OAuth, cold-launch source manipulation. Mitigation: HMAC-signed URLs + storyId allowlist + build-time gate (`process.env.PERCY_STORYBOOK_BUILD === '1'`).
10. **Phase 5 estimate is too optimistic** — first-time App Automate setup with iOS code signing is 7–10 days, not 3–5.

### Critical revisions required to the plan body

These are not optional refinements — these are corrections to errors or omissions surfaced by the deepening research.

#### CR1. Default pattern: separate build target, NOT runtime-gated single binary

**The plan currently recommends a single binary with runtime URL gate.** Research surfaces concrete App Store rejections in 2025–2026 citing exactly this pattern under §2.3.1 (hidden features) and §4.2.2 (minimum functionality). Industry standard is a separate Xcode scheme / Expo build profile / Metro env-flag-driven bundle.

**Plan amendment:**
- Make **separate build target** the recommended pattern in `init`. The customer creates a `MyApp-Storybook` scheme (Xcode) or `EAS Build` profile (Expo) or sets `STORYBOOK=true` env var (`withStorybook({ enabled: !!process.env.STORYBOOK })` Metro plugin pattern, which replaces all `@storybook/*` imports with empty modules in production).
- Move the runtime-gated single binary to an **explicit fallback** with these required warnings:
  - "Apple may reject single-binary apps containing Storybook under §2.3.1 (Hidden Features)."
  - "Privacy Manifest disclosures under §5.1.2 may be required if Storybook RN's telemetry runs in production."
  - "Internal UI surface is reachable via deep-link injection by anyone able to launch URLs on the device."
- Phase 4's `init` interactive prompt becomes: "How will you produce the Percy binary? (a) Separate build target [recommended], (b) Single binary runtime-gated [requires explicit ack of risks]."

#### CR2. Replace `view.setStory(storyId)` with the documented Storybook RN deep-link convention

**The brainstorm's API assumption was wrong.** `view.setStory` does not exist. Two correct paths exist, both already implemented in `@storybook/react-native@10.3.2`:

1. **Best path — the built-in `STORYBOOK_STORY_ID` convention.** Storybook RN intercepts URLs containing `?STORYBOOK_STORY_ID=<id>` at both cold-launch (`dist/index.js:1591`) and warm-launch (`:1566`). It validates the ID against the story index (`_storyIdExists` at `:1571`) and emits `SET_CURRENT_STORY` on the local channel. **No custom URL scheme handler needed in the customer app.** The customer's existing scheme + Storybook's built-in convention is enough.
2. **Fallback for advanced needs — `view._channel.emit(SET_CURRENT_STORY, { storyId })`.** Underscored but stable across v9.x and v10.x. Use this only when overriding Storybook's URL handling.

**Plan amendment:**
- Replace the entire `storybookOrApp({ storybook, app, view })` design. Customer side becomes a 1-line addition: import `getStorybookUI` and call it normally. **Storybook RN's built-in URL handler does the rest.**
- The `--scheme`/`--path` config becomes: `releaseBuild.deepLinkUrl` — full URL template with `${STORYBOOK_STORY_ID}` placeholder. Default: `${customer-scheme}://?STORYBOOK_STORY_ID=${storyId}`.
- The runtime helper package shrinks dramatically — possibly to nothing. Customer change is just registering their URL scheme in `Info.plist`/`AndroidManifest.xml` (which they likely already have) and ensuring Storybook is the rendered root.
- Render-completion signal is `view._channel.on(STORY_RENDERED, callback)` — wait for it (with timeout backstop) instead of fixed delay.

#### CR3. Reconsider pixel-stable polling — adopt early-exit polling as Phase 2 primitive

**The plan rejected pixel-stable polling on 3–5× device-minute consumption grounds.** Performance review surfaces this was directionally wrong:

- Most stories settle <1s. Polling every ~200ms with early-exit on 2 consecutive identical frames means **stable stories cost ~400ms** (2 polls), not 4s.
- Only the rare animated story uses the full `waitForReadyMs` cap.
- Net effect: **fewer device-minutes overall**, not more.

**Plan amendment:** Phase 2 implements `waitForReadyMs` as the *cap*, not the *fixed* duration:
```
poll every 200ms for screenshot stability:
  hash current screenshot
  if hash == previous hash for 2 consecutive polls → settled, return
  if elapsed > waitForReadyMs → cap reached, return last screenshot
```
This produces faster builds AND lower per-build cost. Reverse the brainstorm's earlier rejection.

#### CR4. Add `setupForBuild` deep-link handshake / self-test

**The dominant silent failure mode for `mobile: deepLink`** (across iOS Safari hangs, Android 12 null returns, BrowserStack quirks) is: Appium reports success, but the URL never reached the app. The driver then runs the full 100-story loop, all screenshots are pixel-identical (story 1), Percy build is green-but-wrong.

**Plan amendment:** First step in `ReleaseBuildDriver.setupForBuild()`:
1. Send a sentinel deep link: `${scheme}://?STORYBOOK_STORY_ID=__percy_handshake__`.
2. Wait for one of:
   - `STORY_RENDERED` event with `storyId === '__percy_handshake__'` (via Appium element check or screenshot comparison against a known sentinel pixel pattern).
   - 8s timeout → fail with `release_build_deeplink_unverified` error code.
3. If the sentinel doesn't render, abort the build BEFORE any real story runs.

This catches every silent no-op pattern (iOS Safari hang, Android null return, scheme-not-registered, helper-not-installed) within 8s of the build starting.

#### CR5. Correct cost & latency claims

**Plan amendment to the relevant sections (lines 552, 572, 597, 611):**

- **Cost: $0.30–$2/build, not $3–$6.** App Automate is parallel-slot subscription pricing ($249/mo per slot), not per-device-minute. The economic constraint is parallel-slot occupancy, not minute-meter.
- **Per-story P50 latency: 6.5–9s, not 3s.** Detail: ~700ms `mobile: deepLink` round-trip + 4000ms settle (or pixel-poll) + 1500ms `takeScreenshot` round-trip + ~100ms `postComparison`.
- **100-story wall-clock: 13–19 min P50, not 10–16.**
- **iOS cold-launch P50: 30–40s, P95: 50–70s.** Android: 24s P50, 35–45s P95.
- **Idle timeout default 90s, max 300s.** **Total session max 2 HOURS HARD CAP** (not configurable). Hard ceiling on stories per session: ~150 (not the implicit assumption of unbounded).

#### CR6. Make `mode` explicit config; deprecate hostname-only auto-detection

**Hostname heuristic** (`localhost`/`127.0.0.1` → channel-server, else release-build) breaks on:
- BrowserStack Local tunnel against localhost:4723 (would route channel-server, but Metro isn't running).
- Corp grid `selenium.corp.example.com:4723` (could be either).
- SSH port-forwarded cloud Appium at localhost:4444 (would route channel-server, wrong).

**Plan amendment:** Add explicit `storybook-rn.mode: 'auto' | 'channel-server' | 'release-build'`, default `auto`. Auto-detection probes `:7007` reachability AND parses the URL — if signals disagree, log a warning and require explicit `mode`.

#### CR7. Move runtime helper to a separate package (or eliminate)

Now that CR2 collapses the runtime helper to near-nothing (Storybook RN's built-in URL handler does the work), the **runtime helper may not need to exist as a package at all.** If we still ship it (e.g., for HMAC verification per CR9), it must be a separate npm package `@percy/storybook-react-native-runtime` with peer-deps `react`, `react-native`, `@storybook/react-native@^9 || ^10` — **not** a subpath export of the main SDK package, which would risk pulling node-only deps into the customer's RN bundle.

#### CR8. Make `osName` required, not defaulted

`comparison-poster.js` defaulting `osName` to `'iOS'` silently miscategorizes Android snapshots. **Make it a required argument**; throw on omission. External callers via `src/index.js` get a loud, immediate, fixable error instead of silently miscategorized Percy builds.

#### CR9. Add HMAC-signed deep links + storyId allowlist (security)

**Plan amendment** (security hardening):
- Driver computes HMAC over `(storyId + timestamp)` using a secret known only at Percy-build time.
- URL becomes: `${scheme}://?STORYBOOK_STORY_ID=<id>&exp=<ts>&sig=<hmac>`.
- Runtime helper (or a small Storybook decorator) validates HMAC + freshness before passing the storyId to the channel.
- StoryId is also allowlisted against `view._storyIndex.entries` (which Storybook RN's own URL handler already does at line 1571 — we get this for free if we use the built-in convention).
- Production binaries (without the build-time HMAC secret) **cannot validate** any inbound URL → cannot enter Storybook mode even if scheme is registered. This is the main mitigation against deep-link injection in shipped apps.

#### CR10. Use AST-based parser for `parameters.percy.waitFor` extraction

**Plan amendment:** Use `@babel/parser` (already a transitive dep of every RN project) to walk story files. Regex breaks on:
- CSF v3 `export const Foo = { parameters: { percy: { waitFor: 4000 } } }` with TS annotations
- `satisfies Meta<typeof Component>` syntax
- Imported parameter objects (`parameters: BASE_PARAMS`)
- Spread parameters (`parameters: { ...sharedParams, percy: { waitFor: 2000 } }`)

Story enumerator already AST-walks for the title; reuse the parse pass.

### New risks identified (R12–R18)

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| **R12**: `__DEV__` gate in default Storybook RN init code strips Storybook from release bundles | High | High | `init` must rewrite the customer's Storybook entry to remove `__DEV__` gate (when single-binary mode chosen) OR generate a separate build target's entry (when separate-target mode chosen). Use `@babel/parser` codemod, not regex. Phase 5 quality gate: `grep storybook main.jsbundle` (or Hermes equivalent) must show non-zero hits. |
| **R13**: iOS Simulator vs real device divergence on Universal Links via Appium | Medium | Medium | Use custom URL schemes (e.g., `myapp://`), NOT Universal Links. Universal Links require server-side `apple-app-site-association` and behave differently on Simulator. Document explicitly. |
| **R14**: iOS 16.3- Safari-hop hangs on `mobile: deepLink` real devices | High on legacy, Low going forward | Medium | Require `appium:platformVersion: '16.4'` minimum in `.percy.yml` capabilities. Add `doctor` check that warns on iOS <16.4. Add 20s per-call timeout + retry with `terminateApp`+`activateApp`. |
| **R15**: Android 12+ `mobile: deepLink` returns null silently | Medium | High | Auto-fallback to `mobile: shell am start -a android.intent.action.VIEW -d <url> <package>`. Verify activity changed via `getCurrentActivity()` post-call; on no-change, escalate to fallback. (Already in plan, but make it the default code path, not exception path.) |
| **R16**: Storybook RN telemetry (channel server, store hooks) fires in production binary if single-binary mode chosen | Medium | Medium | Document under SETUP.md security section. Recommend customers disable telemetry via `withStorybook({ enabled: false })` in production Metro config + ensure separate target. Privacy Manifest update obligation if telemetry shipped. |
| **R17**: Customer's app upload to BrowserStack contains hardcoded secrets | Medium | High | Add SETUP.md security section: "Scan release binary for embedded secrets before upload (`strings <app> | grep -iE 'token|key|secret'`)." Recommend dedicated CI signing identity. |
| **R18**: Universal session-state contamination across stories (in-flight network requests, animation timers, navigation state) | Medium | Low | Document `parameters.percy.skip` for stories with side effects. Optional `--reset-between-stories` flag that calls `terminateApp`+`activateApp` between every N stories (~1–2s/story cost). Off by default. |

### Plan amendments — tracking list

The following are concrete amendments to apply to the plan body before `/ce:work`:

| # | Section | Amendment |
|---|---|---|
| **A1** | §Proposed Solution + R6 | Make **separate build target the primary recommended pattern**. Move runtime-gated single binary to explicit fallback with App Store rejection warnings. |
| **A2** | §Architecture, customer-side helper | Replace `view.setStory(storyId)` API assumption with **Storybook RN's built-in `?STORYBOOK_STORY_ID=` URL convention**. Customer-side helper may shrink to zero or near-zero. |
| **A3** | §Architecture | Replace fixed-delay settle with **`STORY_RENDERED` event listener + early-exit pixel-stable polling**, capped by `waitForReadyMs`. |
| **A4** | §Phase 2 task list | Add **deep-link handshake / self-test** as the first step in `ReleaseBuildDriver.setupForBuild()`. |
| **A5** | §Performance numbers | Correct cost claims to **$0.30–$2/build** (parallel-slot, not per-minute). Correct latency to **6.5–9s/story**, **13–19 min wall-clock for 100 stories**, **iOS cold-launch 30–40s P50**. |
| **A6** | §Driver selection | Add explicit **`storybook-rn.mode` config** (`auto`/`channel-server`/`release-build`), default `auto`; auto-detect probes both URL host AND `:7007` reachability. |
| **A7** | §Components | Move runtime helper to **separate npm package** `@percy/storybook-react-native-runtime` (or eliminate per A2). |
| **A8** | §Components | Make **`osName` required argument** to `postSnapshotComparison`. Throw on omission. |
| **A9** | §Architecture, security | Add **HMAC-signed deep links** with build-time secret. Production binaries cannot validate → cannot enter Storybook mode even if scheme registered. |
| **A10** | §Implementation Phases | **AST-based** `parameters.percy.waitFor` extraction (`@babel/parser`), not regex. |
| **A11** | §Phase 1 task list | **Telemetry hooks as Phase 1 primitive** (per-story `deeplink_ms`, `settle_ms`, `screenshot_ms`, `total_ms`, build summary). Required to validate cost/latency claims, impossible to retrofit. |
| **A12** | §Future Considerations | **Move sharding from Future Considerations to Phase 6 mandatory before GA.** Customers with >100-story libraries hit the 2-hour session cap without it. |
| **A13** | §Phase 1 task list | **Explicit story-level error semantics**: per-story try/catch, retry-once on transient Appium errors, abort after 3 consecutive failures, structured `story_render_failed` event per skip. |
| **A14** | §Resource Requirements | **Phase 5 estimate revised to 7–10 days** (was 3–5). First-time App Automate setup + iOS code signing is bigger than estimated. |
| **A15** | §Phase 0 prerequisites | Add **Apple Developer Program seat** (for release-signing the fixture) as Phase 0 blocker. |
| **A16** | §Phase 5 task list | Add **automated nightly E2E** (Buildkite job against BrowserStack iOS+Android, asserts green Percy build, Slacks on failure). Without this, R6/R12/R14/R15 risk silent breakage. |
| **A17** | §Phase 4 init scaffolding | **`init` must rewrite the customer's `__DEV__` gate around Storybook imports** via AST codemod. Required for Storybook to actually appear in release builds. |
| **A18** | §Phase 5 quality gates | Add gate: **release-build of fixture must contain Storybook bundle** (verified by inspecting `main.jsbundle` or via deep-link self-test on the actual release binary). |
| **A19** | §Acceptance Criteria, NFRs | Document **RN minimum version 0.71+** (for `singleTask` MainActivity launchMode + `onNewIntent` setIntent in default RN template) and **iOS minimum 16.4+** (to avoid Safari-hop hangs). |
| **A20** | §Acceptance Criteria | Add **`bstack:options.idleTimeout: 300`** as a default in scaffolded `.percy.yml`. |
| **A21** | §Acceptance Criteria | **Hard ceiling 100 stories per session for MVP**, throws `session_capacity_exceeded` if exceeded. Defer >100 to Phase 6 sharding. |
| **A22** | §Documentation Plan | Add **customer artifact security guidance** for BrowserStack uploads (scan for secrets, dedicated signing identity). |
| **A23** | §Documentation Plan | **Secrets schema hardening** — `.percy.yml` requires env-var references (`${BROWSERSTACK_ACCESS_KEY}`), rejects literals; `doctor` scrubs credentials in output. |

### Cross-cutting recommendation

The single biggest risk-reducer surfaced by deepening: **the deep-link handshake at `setupForBuild` (A4)**. Without it, a half-dozen silent-failure modes (broken scheme registration, iOS Safari hang, Android null return, missing `__DEV__` gate rewrite, customer's RN version <0.71 lacking `singleTask`, wrong `bundleId` capability) all converge on the same outcome: a green Percy build full of pixel-identical wrong screenshots. Phase 5 verification on real BrowserStack would be the first place anyone notices.

### References (deepening sources)

- [Apple App Review Guidelines §2.3.1, §4.2.2, §5.1.2 (rev. Jan 2026)](https://developer.apple.com/app-store/review/guidelines/)
- [Storybook RN: How to prevent .storybook directory from being bundled (Discussion #535)](https://github.com/storybookjs/react-native/discussions/535)
- [Metro `withStorybook({ enabled: false })` tree-shaking pattern](https://storybookjs.github.io/react-native/docs/intro/configuration/metro-configuration/)
- [BrowserStack App Automate idleTimeout (default 90s, max 300s)](https://www.browserstack.com/docs/app-automate/appium/troubleshooting/browserstack-idle-timeout)
- [BrowserStack max session 2 hours (hard cap, not configurable)](https://www.browserstack.com/support/faq/automate/basics-automate/what-is-the-maximum-duration-that-a-single-automate-app-automate-test-can-be-executed-on-browserstack)
- [BrowserStack pricing 2026 — parallel-slot subscription model](https://www.browserstack.com/pricing)
- [BrowserStack: Deep link opening Siri app on iOS real devices (legacy bug)](https://www.browserstack.com/support/faq/app-automate/common-errors/deep-link-opening-the-siri-app-on-real-ios-devices)
- [Appium Pro #84: Reliably Opening Deep Links Across Platforms](https://appiumpro.com/editions/84-reliably-opening-deep-links-across-platforms-and-devices)
- [Appium issue #15575 — Safari deep link hangs on iOS real device](https://github.com/appium/appium/issues/15575)
- [Appium java-client #1955 — `mobile: deepLink` returns null on Android 12](https://github.com/appium/java-client/issues/1955)
- [DoorDash blog: Your deep links might be broken — Web Intents and Android 12](https://careersatdoordash.com/blog/your-deep-links-might-be-broken-web-intents-and-android-12/)
- [React Native Linking API (RN 0.81)](https://reactnative.dev/docs/linking)
- [`@storybook/react-native@10.3.2` source: `dist/index.js:1387,1591,1566,1571,1679,1700`](https://github.com/storybookjs/react-native/blob/main/packages/react-native/src/index.ts) — built-in `?STORYBOOK_STORY_ID=` URL convention
- [Storybook RN core events: `SET_CURRENT_STORY`, `STORY_RENDERED`, `UPDATE_STORY_ARGS`](https://storybook.js.org/docs/api/core-events)

### Quality checks

- [x] All original content preserved (this section is appended; nothing rewritten)
- [x] Research insights attributed to specific agents in headings
- [x] No contradictions between sections (amendments listed for explicit follow-up)
- [x] External references current (2024–2026 sources, with version pins)
- [x] Every amendment is concretely actionable, not aspirational
- [x] Critical revisions (CR1–CR10) and risks (R12–R18) clearly distinguished from minor refinements
- [x] Cost/latency corrections numerically specific (not "more than estimated")
