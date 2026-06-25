# `@percy/storybook-react-native`

Visual regression testing for React Native components rendered via [Storybook for React Native](https://github.com/storybookjs/react-native), captured on real iOS Simulators or Android emulators driven by Appium.

## Quickstart

```bash
npm install --save-dev @percy/cli @percy/storybook-react-native
npx @percy/cli storybook-rn:init           # scaffold .percy.yml + metro.config.js
# add `enableWebsockets: true` to .rnstorybook/index → see SETUP.md §4
npx percy storybook-rn:doctor              # verify your stack (4/4 ✓)
export PERCY_TOKEN=app_xxxxxxxx
percy exec -- npx percy storybook-rn       # snapshot + upload
```

➡ **Full walkthrough: [SETUP.md](./SETUP.md)** — covers iOS Simulator + native dev build, Android emulator, troubleshooting, error catalog, and configuration reference.

## What it does

```
[your RN app + Storybook RN]   running on iOS Simulator / Android emulator
                ↓
        [your local Appium server]
                ↓
[@percy/storybook-react-native] ← this SDK
        ↓                    ↓
[Storybook channel :7007]   [Appium W3C session]
   /select-story-sync        takeScreenshot()
                ↓
   POST localhost:5338/percy/comparison
                ↓
   [Percy CLI uploads to Percy backend]
                ↓
        [Percy build + diff + dashboard]
```

- **No Percy-side build pipeline.** Your app, on your simulator, drives the test.
- **No code signing complexity.** Use a development provisioning profile.
- **Reuses existing Percy CLI infrastructure.** No new backend.

## Commands

| Command | Purpose |
|---|---|
| `npx percy storybook-rn` | Auto-discover stories, capture each on the connected device, upload. |
| `npx percy storybook-rn --dry-run` | List discovered stories without uploading. |
| `npx percy storybook-rn --stories "id1,id2"` | Explicit story IDs (overrides auto-discovery). |
| `npx percy storybook-rn --include="Button/*,Card/*"` | Comma-separated glob filter on story IDs. |
| `npx percy storybook-rn --exclude="*--skip"` | Comma-separated glob patterns to skip. |
| `npx percy storybook-rn:doctor` | Local-only preflight checks (no upload). |
| `npx @percy/cli storybook-rn:init` | Scaffold `.percy.yml` + `metro.config.js` + print next steps. |

## Configuration

`.percy.yml` schema lives at `storybook-rn:` — see [SETUP.md §8](./SETUP.md#8-configuration-reference) for the full reference.

## Module layout

| File | Responsibility |
|---|---|
| `src/runner.js` | Story loop: select → render → screenshot → upload |
| `src/story-enumerator.js` | Read `.rnstorybook/main.*` + parse `.stories.*` files |
| `src/appium-client.js` | `webdriverio` wrapper; owns Appium session |
| `src/storybook-channel.js` | HTTP client for Storybook RN's port-7007 channel server |
| `src/comparison-poster.js` | Posts to `:5338/percy/comparison` (App Percy upload path) |
| `src/config.js` | `.percy.yml` schema + defaults |
| `src/errors.js` | Structured error catalog |
| `src/commands/storybook-rn.js` | Primary CLI command |
| `src/commands/doctor.js` | Preflight checks |
| `src/commands/init.js` | Scaffolding |

## Two modes

This package ships two ways to drive snapshots:

- **CLI mode** (documented above) — drives a local Appium server against an iOS
  Simulator / Android emulator via the Storybook RN channel. Files live in `src/`.
- **Library mode** — for running on **BrowserStack App Automate** real devices
  from your own Appium driver script. Import from the package entry point:

  ```js
  import percyStorybookSnapshot, { discoverStories, provisionApp, runSession } from '@percy/storybook-react-native';
  ```

  Library mode requires `@percy/appium-app` (a peer dependency) and delegates the
  actual screenshot/upload to it. See **[APP_AUTOMATE.md](./APP_AUTOMATE.md)** for
  the full walkthrough. Files live in `percy/`.

## Reference example

A complete working RN + Storybook + Percy setup lives in the standalone [`percy/example-percy-storybook-react-native`](https://github.com/percy/example-percy-storybook-react-native) repo.

## Troubleshooting

See [SETUP.md §7 Known gotchas](./SETUP.md#7-known-gotchas-the-init-command-fixes-these-for-you) and [§9 Error catalog](./SETUP.md#9-troubleshooting-error-catalog).

## License

MIT
