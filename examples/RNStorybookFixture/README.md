# RNStorybookFixture

A **known-working** Expo + React Native + Storybook + Percy reference setup.

This is a starter project, not part of the SDK. Use it to:

- **Verify your local environment** before integrating Percy into your real app — if a green Percy build comes out of this fixture on your Mac, your environment is good.
- **Copy the configuration into your own app** — the `metro.config.js`, `.percy.yml`, and `.rnstorybook/index.ts` here represent the exact shapes that work end-to-end on iOS Simulator.
- **Skim what a Percy snapshot looks like** — the sample `Button/Header/Page` stories are Storybook's defaults; replace them with your own components when you adapt this for production.

For the canonical setup walkthrough (prerequisites, troubleshooting, error catalog), read **[../../packages/storybook-react-native/SETUP.md](../../packages/storybook-react-native/SETUP.md)** — that's the document for customers integrating into a real app.

---

## What's in here

```
.rnstorybook/
├── main.ts                  Storybook config — addons disabled (Expo Go incompatibility)
├── index.ts                 Storybook UI root — has enableWebsockets:true (mandatory)
├── preview.tsx              CSF preview decorators
├── storybook.requires.ts    Auto-generated story registry (don't edit)
└── stories/
    ├── Button.stories.tsx   4 variants: Primary, Secondary, Large, Small
    ├── Header.stories.tsx   2 states: LoggedIn, LoggedOut
    └── Page.stories.tsx     1 story: Default
metro.config.js              withStorybook + websockets pinned to 127.0.0.1
App.js                       Renders StorybookUIRoot from .rnstorybook (Storybook is the entire app)
.percy.yml                   Lives at repo root (one level up) — see ../../.percy.yml
```

The 7 stories above are what produces 7 snapshots in a Percy build.

## Run it (Mac, iOS Simulator)

### Prerequisites

```bash
# Install once
xcode-select --install                                # confirm Xcode CLI tools
gem install cocoapods --user-install                  # CocoaPods (no sudo needed via rbenv)
nvm install 20.19.5 && nvm use 20.19.5                # Node 20+ required by Storybook 10
```

### Three-terminal flow

**Terminal 1 — build, install, and run the fixture on iPhone 16:**
```bash
# from the repo root
xcrun simctl boot "iPhone 16" 2>/dev/null
open -a Simulator
cd examples/RNStorybookFixture
npx expo run:ios --device "iPhone 16"
# First run: 5–15 min (CocoaPods + xcodebuild). Subsequent runs are cached.
# Leaves Metro running on :8081 + Storybook channel on :7007.
```

**Terminal 2 — Appium server:**
```bash
# from the repo root
npx appium --port 4723
# Verify with: curl -sf http://localhost:4723/status
```

**Terminal 3 — Percy snapshot run:**
```bash
# from the repo root
export PERCY_TOKEN=app_xxxxxxxxxxxxxxxxxxxxxxxx          # from your Percy project settings
npx percy storybook-rn:doctor                            # 4/4 checks should pass
npx percy exec -- npx percy storybook-rn --config-dir examples/RNStorybookFixture/.rnstorybook
```

When that finishes you'll see a Percy build URL like:
```
https://percy.io/<your-org>/app/<your-project>/builds/<build-id>
```

Open it. You'll see 7 component snapshots, one per story.

## Adapting this for your own app

You don't ship the fixture itself. Instead:

1. **Verify the fixture works on your machine first** — use it as a smoke test of your local Xcode/Appium/Percy stack.
2. **Apply the same config patterns to your real app:**
   - Copy `metro.config.js`'s `withStorybook({ websockets: { host: '127.0.0.1', port: 7007 } })` block.
   - Copy `.rnstorybook/index.ts`'s `enableWebsockets: true` option.
   - Copy `.percy.yml` (one level up at the repo root) — change `appium:bundleId` to your app's actual bundle identifier.
3. **Replace the sample stories** with your own components.
4. Run the same 3-terminal flow against your app.

The full integration walkthrough is in [`packages/storybook-react-native/SETUP.md`](../../packages/storybook-react-native/SETUP.md).

## Known limitations

- **iOS Simulator only.** Android emulator path is documented in SETUP.md §7.5 but not yet end-to-end verified on this fixture. If you need Android, expect to run into one or two issues that haven't been encountered yet.
- **Expo dev build, not Expo Go.** Storybook RN's UI requires `react-native-reanimated` and `react-native-gesture-handler` natively — Expo Go's pre-bundled binary doesn't include them. `npx expo run:ios` builds your own dev binary that does. Don't try to run this with `expo start` + Expo Go.
- **Sample stories use Storybook's default scaffold.** They're real RN components (`Pressable`, `Text`, `View`) but they're not your design system. Treat them as scaffolding to delete.

## Versions this was built and verified against

| | |
|---|---|
| Node | 20.19.5 |
| React Native | 0.81.5 |
| `@storybook/react-native` | 10.3.2 |
| Expo | 54.0.x |
| Xcode / iOS Simulator | iOS 18.4 |
| Appium | 2.19.0 |
| `appium-xcuitest-driver` | 8.4.3 |
| CocoaPods | 1.16.2 |

If you're on different versions — especially older RN minors or the Old Architecture — adjust accordingly. Newer minors of these will probably work; older ones may need package version pins.
