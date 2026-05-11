# `@percy/storybook-react-native` — Setup Guide

Visual regression testing for React Native components rendered via [Storybook for React Native](https://github.com/storybookjs/react-native), captured on real iOS Simulators or Android emulators driven by Appium.

This guide walks you from a fresh React Native + Storybook project to your first green Percy build.

---

## 1. Prerequisites

| | macOS (iOS) | macOS (Android) | Linux/Windows (Android only) |
|---|---|---|---|
| Node | 20.19+ or 22.12+ | 20.19+ or 22.12+ | 20.19+ or 22.12+ |
| Xcode (for Simulator) | ✅ from Mac App Store | optional | — |
| Android Studio (for emulator) | optional | ✅ | ✅ |
| CocoaPods | `gem install cocoapods --user-install` | optional | — |
| Appium 2.x | global or project-local | global or project-local | global or project-local |
| `xcuitest` driver | `appium driver install xcuitest@8.4.3` | optional | — |
| `uiautomator2` driver | optional | `appium driver install uiautomator2` | `appium driver install uiautomator2` |

> **iOS-first is the recommended path on Mac.** Skips Android Studio's ~6GB install for the initial dev loop. Add Android once iOS produces a green build.

You also need a [Percy account + project token](https://percy.io). For App Percy projects (recommended for native testing), the token starts with `app_`.

## 2. Have a React Native + Storybook project

If you don't have one, scaffold:

```bash
# Expo (fastest)
npx create-expo-app@latest MyRNApp --template blank
cd MyRNApp
npx storybook@latest init --type react_native

# Or bare RN
npx @react-native-community/cli init MyRNApp
cd MyRNApp
npx storybook@latest init --type react_native
```

This produces `.rnstorybook/` with `main.ts`, `index.ts`, `preview.tsx`, and a few sample stories.

Make Storybook the entry point of your app:

```js
// App.js
import StorybookUIRoot from './.rnstorybook';
export default StorybookUIRoot;
```

## 3. Install Percy

```bash
npm install --save-dev @percy/cli @percy/storybook-react-native
```

Run the scaffolder:

```bash
npx @percy/cli storybook-rn:init
```

This creates a starting `.percy.yml` and `metro.config.js`, both pre-configured to avoid the gotchas in [§7](#7-known-gotchas-the-init-command-fixes-these-for-you).

## 4. The one manual edit

`@storybook/react-native@10.x` ships with the on-device WebSocket connection **disabled by default**. Add `enableWebsockets: true` to your existing `getStorybookUI()` call:

```ts
// .rnstorybook/index.ts
import { view } from './storybook.requires';

const StorybookUIRoot = view.getStorybookUI({
  storage: { /* your existing storage */ },
  enableWebsockets: true,    // ← add this
});

export default StorybookUIRoot;
```

Without this, the Percy SDK can't tell the device which story to render.

> If your project runs on **Expo Go** rather than a native dev build, you'll also need to shim AsyncStorage with an in-memory implementation since Expo Go doesn't bundle every native module. See [§7.4](#74-expo-go-doesnt-include-native-modules-async-storage).

## 5. iOS native dev build

Storybook RN's UI requires native modules (`react-native-reanimated`, `react-native-gesture-handler`, `@react-native-async-storage/async-storage`) that aren't in Expo Go. Build a native dev binary:

```bash
# Expo
npx expo run:ios --device "iPhone 16"

# Bare RN
cd ios && pod install && cd ..
npx react-native run-ios --simulator="iPhone 16"
```

The first build takes 5–15 min (CocoaPods + xcodebuild). Subsequent builds use Xcode's cache and complete in seconds.

The booted simulator should now show your app with Storybook's component picker.

## 6. Run Percy

In separate terminals:

```bash
# Terminal A — Metro (already started by `expo run:ios` / `react-native run-ios`)
# Verify "WebSocket server listening on 127.0.0.1:7007" appeared in its log.

# Terminal B — Appium server
npx appium --port 4723

# Terminal C — Percy
export PERCY_TOKEN=app_xxxxxxxxxxxxxxxxxxxx
npx percy storybook-rn:doctor              # 4/4 ✓
npx percy exec -- npx percy storybook-rn   # auto-discovers stories + uploads
```

A Percy build URL prints when finalization completes. Open it to see one snapshot per story.

### Iterating

```bash
npx percy storybook-rn --dry-run                 # list discovered stories without uploading
npx percy storybook-rn --include="Button/*"      # filter by glob
npx percy storybook-rn --stories "button--primary,card--default"   # explicit override
```

## 7. Known gotchas (the `init` command fixes these for you)

These are real issues that bit during development of the SDK. The default scaffolding handles them — listed here so you understand the *why* and can troubleshoot if you hit them on a non-default config.

### 7.1 IPv4 vs IPv6 localhost mismatch on macOS

Metro's `withStorybook({ websockets: 'auto' })` binds the channel server to whatever `localhost` resolves to. On macOS that's `::1` (IPv6). Node's `fetch` (used by the Percy SDK) dials `127.0.0.1` (IPv4) for `localhost`. They don't bridge.

**Fix (in `metro.config.js`)**: pin IPv4 explicitly:
```js
withStorybook(config, {
  websockets: { host: '127.0.0.1', port: 7007 },  // not 'auto', not 'localhost'
});
```

### 7.2 `enableWebsockets: false` is the default

`getStorybookUI()` in `@storybook/react-native@10.x` reads `globalThis.STORYBOOK_WEBSOCKET` correctly but only opens the connection when explicitly opted in.

**Fix (in `.rnstorybook/index.{ts,js}`)**: pass `enableWebsockets: true`. See [§4](#4-the-one-manual-edit).

### 7.3 `xcuitest` driver version vs Appium 2

`appium-xcuitest-driver@9+` requires Appium 3 (currently in RC). Pair Appium 2 with xcuitest 8:

```bash
npm install --save-dev appium@2 appium-xcuitest-driver@8.4.3
npx appium driver install xcuitest@8.4.3
```

### 7.4 Expo Go doesn't include native modules (Async Storage)

If running via `expo start --ios` (Expo Go) rather than `expo run:ios` (native dev build), Storybook's storage call will fail. Shim it:

```ts
// .rnstorybook/index.ts
const memStore: Record<string, string> = {};
const inMemoryStorage = {
  getItem: async (key: string) => (key in memStore ? memStore[key] : null),
  setItem: async (key: string, value: string) => { memStore[key] = value; },
};

const StorybookUIRoot = view.getStorybookUI({
  storage: inMemoryStorage,
  enableWebsockets: true,
});
```

For production visual testing, prefer the native dev build path — it includes all native modules and matches what your customers see.

### 7.5 Android — `adb reverse` for port forwarding

Unlike iOS Simulator, Android emulators don't share the host's localhost. After the app boots:

```bash
adb reverse tcp:7007 tcp:7007        # Storybook channel
adb reverse tcp:8081 tcp:8081        # Metro (already done by react-native run-android)
```

Without `adb reverse tcp:7007`, the device app can't reach the channel server.

## 8. Configuration reference

`.percy.yml` schema under `storybook-rn:`:

```yaml
storybook-rn:
  appium:
    server: http://localhost:4723         # Appium server URL
    capabilities:                         # passed verbatim to Appium driver
      platformName: iOS                   # or 'Android'
      "appium:platformVersion": "18.4"
      "appium:deviceName": "iPhone 16"
      "appium:bundleId": "com.yourapp"    # iOS — must match Info.plist
      # For Android, replace appium:bundleId with:
      # "appium:appPackage": "com.yourapp"
      # "appium:appActivity": ".MainActivity"
      # "appium:automationName": "UIAutomator2"
  storybook:
    websocketHost: 127.0.0.1              # see §7.1 — pin IPv4
    websocketPort: 7007                   # default, change only if you customized withStorybook
    waitForReadyMs: 4000                  # backstop timeout per story (ms)
  include:                                # story-id glob patterns
    - "**/*"
  skip: []                                # exclusion patterns
```

Override on the CLI:

| Flag | Purpose |
|---|---|
| `--include="Button/*"` | story-id filter (overrides config) |
| `--stories "id1,id2"` | explicit story IDs (skips auto-enumeration) |
| `--config-dir ./my-storybook-dir` | non-default Storybook config location |
| `--dry-run` | list discovered stories without uploading |

## 9. Troubleshooting (error catalog)

Every CLI failure produces a structured error code. Look up the `[error_code]` in the message:

| Error code | Meaning | Fix |
|---|---|---|
| `no_stories_found` | Storybook config missing or no `.stories.*` files matched the glob | Run `npx storybook init --type react_native`, or check your `stories: [...]` glob in `main.ts`. |
| `appium_unreachable` | Appium server didn't accept a connection | Start Appium: `npx appium --port 4723`. Verify with `curl http://localhost:4723/status`. |
| `storybook_ws_unreachable` | Channel server on port 7007 not responding | Verify `withStorybook({ websockets: { host: '127.0.0.1', port: 7007 } })` in `metro.config.js`. Check Metro log for "WebSocket server listening on 127.0.0.1:7007". |
| `percy_cli_unreachable` | Percy CLI's local server (port 5338) not running | Wrap your command with `percy exec -- <your command>`. |
| `token_missing` | `PERCY_TOKEN` env var not set | `export PERCY_TOKEN=app_...`. Get a token from your Percy project settings. |
| `story_render_timeout` | Device didn't ack render within `waitForReadyMs` | Increase `waitForReadyMs` (try 6000–8000). Or verify `enableWebsockets: true` in `getStorybookUI()`. |
| `screenshot_failed` | Appium's `takeScreenshot()` returned an error | Device may have lost focus or session expired. Re-run with `DEBUG=1` for details. |
| `include_zero_match` | Your `--include` / `skip` patterns matched nothing | Run `--dry-run` to see all discovered stories, then adjust patterns. |

## 10. Next steps

- **Approve a baseline**: open the build URL after your first run, click "Approve". Subsequent runs compare against this baseline.
- **CI integration**: wrap your CI test step with `percy exec` and pass `PERCY_TOKEN` from secrets.
- **GitHub PR checks**: connect your Percy project to GitHub — diffs appear as PR status checks automatically.

## 11. Reference example

A complete working setup lives at [`examples/RNStorybookFixture/`](https://github.com/percy/percy-react-native-support/tree/main/examples/RNStorybookFixture) in this repo — clone, `npm install`, `npx expo run:ios`, and follow [§6](#6-run-percy).

---

Issues? File at https://github.com/percy/percy-react-native-support/issues.


---

## Library mode (BrowserStack App Automate)

Everything above describes **CLI mode** — the `npx percy storybook-rn` command driving a local emulator/simulator. As of v0.2.0-alpha.0, `@percy/storybook-react-native` also ships a **library mode** that runs against BrowserStack App Automate from inside your existing WebdriverIO Appium tests.

**When to pick which:**

| | CLI mode (Path A) | Library mode (Path B / App Automate) |
|---|---|---|
| Setup | Local Appium + emulator/simulator on dev machine | BrowserStack account + App Automate session |
| Best for | Laptop dev workflow; iOS-on-Mac CI | Linux CI / cloud CI / real device coverage |
| Customer code | `.percy.yml` config; CLI invoked | Library imports inside an existing WebdriverIO mocha/jasmine spec |
| Storybook host app | Local debug build | Storybook-enabled `.apk` uploaded to BS |

For library-mode setup, see **[`APP_AUTOMATE.md`](./APP_AUTOMATE.md)** and the reference repo at [`percy/example-percy-storybook-react-native`](https://github.com/percy/example-percy-storybook-react-native) (separate repo, mirrors the [`example-percy-appium-js`](https://github.com/percy/example-percy-appium-js) layout).
