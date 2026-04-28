---
date: 2026-04-28
topic: path-b-release-build-driver
---

# Path B — Release-Build Driver for `@percy/storybook-react-native`

## Problem Frame

The shipped Path A (channel-server-based, local-emulator) requires the customer's app to be a **debug build** connected to a Metro dev server on the customer's machine. That works for design partners and dev workflows, but most production CI flows for Percy customers point at **App Automate** (BrowserStack's cloud device farm) — and in that flow:

- The customer uploads a **release `.ipa`/`.apk`** to App Automate.
- The device is in the cloud, not on the customer's machine.
- There is no Metro server, no port-7007 channel, no WebSocket between the SDK and the device app.

This blocks App Percy customers (Percy's primary customer base) from using `@percy/storybook-react-native` in their actual CI workflows.

**Path B** opens the App Automate customer segment by removing the Metro dependency entirely and driving Storybook story selection via deep links instead of the channel server.

## Requirements

- **R1.** SDK supports a "release-build" driver mode that works against any Appium endpoint (local emulator with release binary, BrowserStack App Automate, Sauce Labs, AWS Device Farm, customer's self-hosted Selenium grid). The mode is selected automatically based on `appium.server` config — `localhost`/`127.0.0.1` uses Path A's channel-server driver, anything else uses the release-build driver.

- **R2.** The release-build driver drives story selection by sending deep links into the customer's app via Appium's `mobile: deepLink` command (or platform equivalent). One Appium session per build; deep links sent sequentially per story within the session.

- **R3.** The customer's app implements an entry-point gate that renders Storybook if launched via the Percy deep-link scheme, else renders the real app. SDK ships a `storybookOrApp({ storybook, app })` helper from `@percy/storybook-react-native/runtime` so the customer change is ~3 lines in their app entry file.

- **R4.** Render-ack uses the same `waitForReadyMs` settle-delay backstop that Path A uses (default ~1500–2000ms). Per-story override via the standard Storybook `parameters.percy.waitFor` convention. No customer-side decorators, addons, or other app-code changes for the ack mechanism.

- **R5.** Story enumeration is unchanged — uses the existing `src/story-enumerator.js` parser of `.rnstorybook/main.{ts,js}` + `.stories.*` files. The new driver consumes the same `StoryDescriptor[]` produced today.

- **R6.** Comparison-upload payload uses platform-detected `tag.osName` (read from `driver.capabilities.platformName`), not the current iOS hardcode. Same `postComparison` endpoint, same Percy CLI upload flow, same App Percy backend.

- **R7.** Android and iOS supported by the same SDK code path, differing only in the customer's manifest declaration (URL scheme in `Info.plist` for iOS, intent filter in `AndroidManifest.xml` for Android). The runtime helper, Appium command, and snapshot upload are platform-agnostic.

- **R8.** `npx percy storybook-rn:init` scaffolding is extended to optionally generate the entry-point gate snippet + URL-scheme manifest patches. Existing `.percy.yml` + `metro.config.js` scaffolding continues to work for Path A users.

- **R9.** `npx percy storybook-rn:doctor` preflight checks adapt to the selected driver mode — Path B skips the Metro/channel-server checks and instead verifies that the customer's app launches via the deep-link scheme. App Automate-specific checks (token, hub URL reachable, app upload accessible) are added for cloud Appium endpoints.

## Success Criteria

- **One external customer** integrates against App Automate self-serve from public docs, runs ≥10 Percy builds over ≥1 week, with **zero synchronous engineer assistance**. Same shape as Path A's MVP gate but against the cloud Appium endpoint.
- **Path B's per-build wall-clock for a 100-story library on App Automate is within 2× of Path A's local-emulator wall-clock** for the same library. Same ballpark cost, with the cloud-test-real-devices upside.
- **Customer-touching surface area is bounded** — the customer change to adopt Path B (vs. Path A) is at most: change `appium.server` URL + `bstack:options` capabilities in `.percy.yml`, add 3-line entry-point gate, declare URL scheme in Info.plist / AndroidManifest. Nothing else.
- **No regressions on Path A** — existing customers on the local-emulator path see no behavior changes. Build #11 / #12-equivalent runs continue to produce identical Percy builds.

## Scope Boundaries

- **Not in scope:** UI-driven story navigation (Appium taps on Storybook sidebar items). Discussed and rejected — fragile, slow, and unnecessary given deep links work.
- **Not in scope:** Pixel-stable polling for render-ack. Considered, rejected as over-engineered. Add only if production data shows the fixed-delay default is too flaky.
- **Not in scope:** Replacing Path A. Path B coexists; auto-detection routes between the two.
- **Not in scope:** A `@percy/storybook-react-native-addon` companion package. Rendering ack is handled inside the SDK without a customer-side decorator.
- **Not in scope:** Building/uploading the customer's release binary on their behalf. Customer's CI handles the build + upload; Percy SDK only drives the resulting Appium session.
- **Not in scope:** Multi-build optimizations like sharding (one session per shard of stories). Stories run sequentially in one session in MVP. Sharding is a follow-up if device-minute economics demand it.

## Key Decisions

- **Single-session + `mobile: deepLink`** as the primary mechanism (not relaunch-per-story): App Automate cost model is per-session-minute. Relaunch-per-story = 100 sessions × ~30s startup each = 50+ min of pure overhead vs 5–8 min for one session driving 100 deep links. 10× cost difference for marginal reliability gain.

- **Scope as "release-build driver," not "App Automate driver"**: The only BrowserStack-specific thing is the Appium endpoint URL. Same SDK code works against Sauce Labs, AWS Device Farm, customer grids, and local release-build runs. Free reach, zero extra cost.

- **Coexist with Path A via auto-detection on `appium.server`**: A customer's `.percy.yml` is the single switch. Localhost → channel-server driver. Anything else → release-build driver. No new flags.

- **Render-ack: fixed-delay backstop, no decorator/addon needed**: Same mechanism Path A already uses (`waitForReadyMs`). Customer-side cost: zero. Per-story override via the standard Storybook `parameters.percy.waitFor` for the rare animated-loop story. Pixel-stable polling considered and rejected for MVP — adds 3–5× screenshot calls per story (real money on App Automate device-minutes) for unproven reliability gain.

- **Customer entry-point gate via SDK runtime helper**: Customer change is `import { storybookOrApp }` + a 1-line wrapper around their existing entry. The helper reads `Linking.getInitialURL()` to decide. No decorator changes, no addon, no fork-the-build.

- **Platform parity via Appium's `mobile: deepLink`**: Single command works on both iOS (URL scheme) and Android (intent). Customer's manifest declares the scheme/intent filter (one-time), then both platforms behave the same from the SDK's perspective.

- **Path A's verified architecture remains the recommended dev-loop path**: Path B is for CI / production; Path A is for `npm run percy:test` on the developer's Mac during integration. Customers naturally use both.

## Dependencies / Assumptions

- Customer's app already has Storybook RN integrated (same prerequisite as Path A).
- Customer's app has (or can add) a URL scheme registered for deep links — most apps already have one for password reset, OAuth callbacks, share-sheet handlers, etc.
- Storybook RN's `view.selectStory(storyId)` (or `view.getStorybookUI({ initialSelection })` for cold start) works as documented and renders the story without further state setup.
- Appium's `mobile: deepLink` command is supported by `xcuitest@8.4.3` (iOS) and `uiautomator2` (Android) — assumed yes based on standard Appium mobile commands; verify in planning.
- `@percy/sdk-utils` `postComparison` accepts platform-detected `tag.osName: 'Android'` — assumed yes since `@percy/appium-app` already does this; verify by reading their `tag` payload.

## Outstanding Questions

### Resolve Before Planning

(empty — design space resolved during the brainstorm)

### Deferred to Planning

- **[Affects R2]** **[Technical]** Verify Appium's `mobile: deepLink` command is supported by `xcuitest@8.4.3` and matching `uiautomator2` driver. If not, identify the correct platform-specific commands (iOS: `xcrun simctl openurl` equivalent via Appium; Android: `mobile: shell am start` with `-a android.intent.action.VIEW`).

- **[Affects R3]** **[Technical]** Whether Percy's existing `@percy/appium-app` `AppAutomateProvider` auto-detection (BrowserStack hostname check) can be reused for BrowserStack-specific niceties (`bstack:options` handling, session URLs in build metadata). If yes, free benefits; if not, build a simpler generic provider.

- **[Affects R4]** **[Needs research]** Empirical settle-delay tuning. Path A defaults to `waitForReadyMs: 4000`; Path B may need different defaults given there's no WS render-ack to short-circuit the wait. Benchmark against the fixture's 7 stories on a real App Automate device to set a sensible default.

- **[Affects R7]** **[Technical]** Android-specific bundle identifier vs. activity-name capability shape. Path A's `.percy.yml` has iOS `appium:bundleId`; Android needs `appium:appPackage` + `appium:appActivity`. The `init` scaffolding should generate platform-appropriate templates.

- **[Affects R9]** **[Technical]** Doctor's preflight checks for App Automate: which BrowserStack-specific signals are reachable without holding open an Appium session (e.g. token validation via REST API)? Spec the checks during planning.

- **[Affects success criteria]** **[Needs research]** App Automate device-minute economics for a 100-story build. Estimate based on typical session-minute-rate × `(setup + 100 × per-story-time + teardown)`. If the cost is materially worse than expected, revisit sharding (parallel sessions) as a possible follow-up.

## Next Steps

→ `/ce:plan` for structured implementation planning. The design space is resolved; remaining items are technical questions that planning + light codebase research will answer.
