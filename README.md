# Percy Storybook React Native

Visual regression testing for [React Native](https://reactnative.dev) components rendered via [Storybook for React Native](https://github.com/storybookjs/react-native), captured on real iOS Simulators or Android emulators driven by Appium, uploaded to [Percy](https://percy.io).

## Repo layout

| Package | Description |
|---|---|
| [`packages/storybook-react-native`](./packages/storybook-react-native) | The `@percy/storybook-react-native` SDK + CLI. **Start here.** |
| [`examples/RNStorybookFixture`](./examples/RNStorybookFixture) | Working Expo + Storybook RN fixture used as both a reference and the SDK's E2E test target. |
| [`docs/plans`](./docs/plans) | Planning artifacts (v1 superseded, v2 active). |

## Get started

➡ **[`packages/storybook-react-native/SETUP.md`](./packages/storybook-react-native/SETUP.md)** — complete setup walkthrough, troubleshooting, and configuration reference.

## Quickstart

```bash
npm install --save-dev @percy/cli @percy/storybook-react-native
npx @percy/cli storybook-rn:init
# Add `enableWebsockets: true` to .rnstorybook/index — see SETUP.md §4
export PERCY_TOKEN=app_xxxxxxxx
npx percy storybook-rn:doctor
npx percy exec -- npx percy storybook-rn
```

## Trying the reference example

```bash
git clone https://github.com/percy/percy-react-native-support.git
cd percy-react-native-support
npm install
cd examples/RNStorybookFixture
npx expo run:ios --device "iPhone 16"      # cold build: ~10 min
# (in another terminal)
npx appium --port 4723
# (in another terminal, back at repo root)
export PERCY_TOKEN=app_xxxxxxxx
npx percy exec -- npx percy storybook-rn
```

A Percy build URL prints when the run completes. Open it to see one snapshot per story.

## Status

- ✅ End-to-end pipeline verified on iPhone 16 Simulator with iOS 18.4
- ✅ Auto story enumeration from `.rnstorybook/main.{ts,js}` + `.stories.*` files
- ✅ Reuses Percy's existing CLI upload pipeline (no new backend)
- ✅ 23+ unit tests passing

See [docs/plans/2026-04-27-002-...-v2-plan.md](./docs/plans/2026-04-27-002-feat-storybook-react-native-component-testing-v2-plan.md) for the architecture and roadmap.

## License

MIT
