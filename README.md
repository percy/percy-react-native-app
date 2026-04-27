# Percy Storybook React Native

Visual regression testing for React Native components rendered via [Storybook for React Native](https://github.com/storybookjs/react-native), running on real iOS Simulators or Android emulators driven by Appium.

This is a monorepo. Packages:

| Package | Status |
|---|---|
| [`@percy/storybook-react-native`](./packages/storybook-react-native) | 🚧 In development (Phase 1) |
| `@percy/storybook-react-native-addon` (optional Storybook addon) | Planned |
| `examples/RNStorybookFixture` (reference RN app) | Planned |

## Plan

Active execution plan: [`docs/plans/2026-04-27-002-feat-storybook-react-native-component-testing-v2-plan.md`](./docs/plans/2026-04-27-002-feat-storybook-react-native-component-testing-v2-plan.md)

Original v1 plan is preserved as research record only and is marked superseded.

## Quickstart (developing the SDK)

```bash
npm install
npm test
npm run build
```

## Local dev loop (testing the SDK against a real RN app)

See the "Local Development & Testing" section of the v2 plan for the full step-by-step. iOS Simulator on Mac is the recommended week-1 path.
