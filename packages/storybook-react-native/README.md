# @percy/storybook-react-native

Visual regression testing for React Native components rendered via [Storybook for React Native](https://github.com/storybookjs/react-native), captured on real iOS Simulators or Android emulators driven by Appium.

> 🚧 **Status:** v0.1.0-alpha.0 — week-1 skeleton. Not yet runnable end-to-end. See the [v2 plan](../../docs/plans/2026-04-27-002-feat-storybook-react-native-component-testing-v2-plan.md) for milestones.

## How it works

```
[your RN app + Storybook RN]   running on iOS Simulator / Android emulator
                ↓
        [your local Appium server]
                ↓
[@percy/storybook-react-native] ← this SDK
        ↓                    ↓
[Storybook WS :7007]    [Appium W3C session]
   setCurrentStory       takeScreenshot
                ↓
   POST localhost:5338/percy/comparison
                ↓
   [Percy CLI uploads to Percy backend]
                ↓
        [Percy build + diff + dashboard]
```

No Percy-side build pipeline, no shell distribution, no code signing — your own app on your own simulator drives the test.

## Quickstart (once the SDK is past the skeleton stage)

```bash
npm install --save-dev @percy/storybook-react-native @percy/cli
npx @percy/storybook-react-native init    # scaffolds .percy.yml + sample story
npx percy storybook-rn doctor             # verifies your local stack
percy exec -- percy storybook-rn          # runs the visual test
```

## Module layout

| File | Responsibility |
|---|---|
| `src/runner.js` | Main orchestration loop: for each story → setCurrentStory → wait → screenshot → upload |
| `src/appium-client.js` | Wraps `webdriverio`; owns the Appium session; exposes `takeScreenshot()` |
| `src/storybook-ws.js` | Connects to Storybook RN's port-7007 WebSocket; sends `setCurrentStory`; listens for `percy:ready` |
| `src/comparison-poster.js` | Wraps `@percy/sdk-utils` `postComparison` (POSTs to `localhost:5338`) |
| `src/config.js` | `.percy.yml` schema + defaults under the `storybook-rn:` key |
| `src/errors.js` | Error catalog (acceptance contract from the v2 plan) |
| `src/commands/storybook-rn.js` | Primary CLI command |
| `src/commands/init.js` | `init` command — scaffolds `.percy.yml` + addon snippet + sample story |
| `src/commands/doctor.js` | `doctor` command — local-only preflight checks |

## Development

```bash
npm install              # from the monorepo root
npm test                 # runs vitest
```

## Local end-to-end testing

See the **"Local Development & Testing"** section in the [v2 plan](../../docs/plans/2026-04-27-002-feat-storybook-react-native-component-testing-v2-plan.md) — the canonical setup walkthrough using iOS Simulator on Mac.
