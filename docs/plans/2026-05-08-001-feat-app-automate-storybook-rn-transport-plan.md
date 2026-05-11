---
title: "feat: App Automate Transport for Storybook-RN Component Testing"
type: feat
status: active
date: 2026-05-08
origin: docs/brainstorms/2026-05-08-app-automate-storybook-rn-requirements.md
parent_plan: docs/plans/2026-04-24-001-feat-react-native-storybook-app-percy-plan.md
parent_ticket: https://browserstack.atlassian.net/browse/PER-7859
parent_brief: https://browserstack.atlassian.net/wiki/spaces/PER/pages/6168216344/
related_repos:
  - https://github.com/percy/percy-react-native-support
  - https://github.com/percy/percy-appium-js
  - https://github.com/percy/percy-appium-app
  - https://github.com/storybookjs/react-native
---

# feat: App Automate Transport for Storybook-RN Component Testing

## Enhancement Summary

**Deepened on:** 2026-05-08
**Agents consulted:** best-practices-researcher (Storybook RN v10 selectors), framework-docs-researcher (BS Upload API + Appium 2.x/WDIO 9.x), api-contract-reviewer, reliability-reviewer, correctness-reviewer, testing-reviewer, code-simplicity-reviewer.

### Key Improvements (details in §"Research Insights" sections below)

1. **API converted from class to functional** to mirror `@percy/appium-app` family convention (`percyScreenshot(driver, name, options)`). The class shape introduced ceremony, contradicted the sibling SDK's pattern, and risked stale state across driver lifecycles. Library exports become flat functions; an optional `createPercyStorybook(opts)` factory preserves shared-state ergonomics for power users.
2. **App-hash caching replaced with BS `custom_id` + `recent_apps` GET pattern.** BrowserStack supports content-addressed app references via `custom_id` — using `sha256(apk).slice(0,40)` as the custom_id and probing `GET /app-automate/recent_apps/{custom_id}` before upload skips the entire client-side cache layer (no `~/.percy/` cache file, no liveness probe, no eviction). Net: ~40 lines of plan deleted; one HTTP probe added.
3. **Storybook RN v10 ships TWO navigator UI packages** (`@storybook/react-native-ui` full + `@storybook/react-native-ui-lite`). ui-lite has stable testIDs (`mobile-menu-button`, `storybook-explorer-tree`); ui (full) has fewer. Tree leaves have **no testID/a11y label in either** — text-match is unavoidable. Plan now specifies UI-package detection + concrete v10-verified selector cascade.
4. **Transport detection bugfix** — `'bstack:options': {}` is truthy and was incorrectly classified as App Automate. Now requires `bstack.userName || bstack.accessKey` actually present.
5. **`coldBootMs` fixed-sleep replaced with poll-for-ready.** 8s default fails on slow BS devices, wastes time on fast ones. Poll for `mobile-menu-button` testID every 500ms with a 30s ceiling.
6. **Render-ready signal hardened** — global per-story navigation budget (8s default), max stability-poll attempts (4), explicit hash function (downsampled grayscale → SHA-1), and a forced first-capture settle delay (200ms) to prevent capturing a stale pre-render frame as "stable."
7. **BS upload retry + timeout** added to MVP (3× exponential backoff on 5xx + network errors only; 120s fetch timeout). The reliability review made the case that uploads are idempotent and a single transient 502 should not kill a CI run.
8. **Circuit breaker gains second dimension** — abort on EITHER 3 consecutive same-class failures OR >40% cumulative failure rate. The streak-only rule was blind to the 30%-flake regime.
9. **Tap-path cache (`lastExpandedComponent`) scoped per-driver via WeakMap**, not instance-global, and gated by an optional opt-in for MVP — simplicity review pushed cutting it entirely; correctness review showed cross-driver state corruption risk if kept. Compromise: keep optionally, but driver-scoped + with state-divergence detection (probe before each cached tap; on mismatch, evict and replay full sequence).
10. **Snapshot-name parity guarantee** — `snapshotStory` rejects descriptors missing `componentTitle` or `name` rather than fall back to `id` (which silently produced different baselines from CLI mode). Force the caller to fix descriptors at integration time.
11. **`peerDependenciesMeta`** marks `@percy/appium-app` as `optional: true` to avoid breaking install-time behavior for existing `0.1.0` CLI-only consumers. Pin range tightened to `~2.1.0` (patch-only) until automated CI matrix exists.
12. **Phase 2 distinction dropped** — folded into Phase 2 ("post-PoC"). Two phases is enough; the 1.5 sub-tier was creating tracking overhead with no payoff.
13. **Selector strategy explicitly specified for v10**: `~mobile-menu-button` (drawer), `-android uiautomator new UiSelector().text("...")` for tree nodes (leaves have no testID), `-ios predicate string:label == "..."` for iOS Phase 2.
14. **Element-tree fixture-driven testing** added — check in a captured Appium page-source XML from Storybook RN v10.x, run the SDK's selector resolver against it, assert `componentTitle/storyName` descriptors resolve. This is the single test that catches upstream Storybook RN navigator drift between releases — far higher-leverage than the manual-trigger live integration test alone.
15. **Optional `runSession(driver, async () => { ... })` wrapper** to enforce `driver.deleteSession()` on test exit. Reduces dangling-session waste from the high-frequency "customer forgot finally{}" mistake.

### New Considerations Discovered

- **No public Appium-driven Storybook RN harness exists.** Maestro + deep-link is Storybook's own documented testing recommendation. This SDK is genuinely first-mover in the Appium-driven Storybook RN space — confirms the plan's primary path carries non-trivial novelty risk.
- **CSF titles can contain escaped slashes** (`Forms\/Button` = single segment containing `/`). Naive `componentTitle.split('/')` mis-taps. Plan now uses regex with negative lookbehind + segment unescape.
- **WebdriverIO 8 vs 9 capability normalization** drops `appium:` prefix on some keys post-session. Transport detection must read both prefixed and bare key shapes (already noted in plan §358; reinforced).
- **Animated content** (Lottie, blinking cursors, GIFs) breaks screenshot-stability convergence. `@percy/appium-app`'s `freezeAnimatedImage: true` option is the mitigation — pass through by default in `snapshotStory`.
- **Async image rendering** can take 800–2000ms after JS reports "done" — stability poll must remain even when cooperative testID is present.
- **Customer's E2E job + Storybook job share BS quota.** Plan now flags this in cross-team needs (App Automate Eng).

### Sections enhanced

- §"Story Navigation Strategy — Decision" — added Storybook RN v10 UI-package note + selector strategy cascade
- §"Module map" — reduced new modules from 3 to 2 (provisioner inlined into public-api for MVP)
- §"Public API (library mode)" — converted to functional shape; documented `createPercyStorybook(opts)` factory; descriptor validation tightened
- §"`provisionApp` semantics" — replaced hash-cache machinery with `custom_id + recent_apps` GET pattern; added retry + timeout
- §"Story-navigation strategy" — concrete v10 selectors; render-ready hierarchy hardened with global timeouts; tap-path cache scoped by driver; UI-lite vs UI-full detection
- §"Transport detection" — fixed empty-bstack-options bug
- §"Error classification" — new codes: `bs_app_not_ready`, `nav_state_diverged`, `app_cold_boot_timeout`, `invalid_descriptor`
- §"Implementation Phases" — folded Phase 2 into Phase 2; expanded Phase 1 testing scope
- §"Risk Analysis" — added UI-lite vs UI-full split risk; v10 tree-leaf-no-testID risk
- §"Open Questions" — added empirical PoC items (BS upload-to-install delay, BS dedup behavior, UI-lite vs UI-full detection, animation freeze interaction)
- §"Tests" — added 3 critical new tests (render-ready cascade, element-tree fixture, cap-shape matrix); changed integration test to nightly + release-tag schedule

### What was NOT changed despite reviewer pushback

- **Phase 1 scope** — kept Android-only, library-mode-only. Multiple reviewers were aggressive about cuts. Held the line because the user explicitly scoped to PoC scale.
- **Deep-link kept as opt-in alternative.** Best-practices research confirms Maestro+deep-link is Storybook RN's own recommended path — keeping deep-link in the SDK as opt-in lets us match that pattern when customers prefer it.
- **`provisionApp` + `useAppReference` both retained.** Simplicity review suggested cutting one; api-contract review surfaced an inconsistency between them. Fix is consistency (both return the ref string), not removal — the escape hatch addresses a real persona (CI artifact-store integrations).

---

## Conformance to `percy-appium-js` patterns (user directive 2026-05-08)

User confirmed: "follow `percy-appium-js` patterns for dev and then run it for app automate as well — we need everything like this." Architecture aligned to mirror [`percy/percy-appium-js`](https://github.com/percy/percy-appium-js) (the SDK) and [`percy/example-percy-appium-js`](https://github.com/percy/example-percy-appium-js) (the example repo).

### Adopted patterns from `percy-appium-js` (authoritative reference)

**1. Single primary function export + named helpers (CommonJS-style, works in ESM too):**
```js
// index.js
const percyStorybookSnapshot = require('./percy/percyStorybookSnapshot');
const { discoverStories } = require('./percy/discoverStories');
const { provisionApp } = require('./percy/provisionApp');
const { runSession } = require('./percy/util/runSession');

module.exports = percyStorybookSnapshot;            // primary function
module.exports.discoverStories = discoverStories;   // named helpers
module.exports.provisionApp = provisionApp;
module.exports.runSession = runSession;
```
Customer usage:
```js
const percyStorybookSnapshot = require('@percy/storybook-react-native');
const { discoverStories, provisionApp } = require('@percy/storybook-react-native');
```
This mirrors `percyScreenshot(driver, name, options)` exactly (single primary function), plus named helpers attached to the function object — idiomatic CJS, ergonomic in ESM.

**2. Provider-Resolver pattern (the architecture decision that supersedes `transport-detection.js`):**
```
percy/providers/
├── genericProvider.js          // standard W3C Appium / local sim path
├── appAutomateProvider.js      // extends generic with BS-specific behavior
└── providerResolver.js         // picks via static supports(driver) test
```
`providerResolver.js` shape (verified from upstream):
```js
class ProviderResolver {
  static resolve(driver) {
    const Klass = [AppAutomateProvider, GenericProvider]
      .filter(x => x.supports(driver))[0];
    return new Klass(driver);
  }
}
```
- `AppAutomateProvider.supports(driver)` returns `true` when `bstack:options` (with creds) or flat `bstack:userName` is present.
- `GenericProvider.supports(driver)` returns `true` always (catch-all).
- `AppAutomateProvider` extends `GenericProvider` and overrides per-transport behavior.

This **replaces** the inline `detectTransport(driver)` function from earlier sections. Transport detection becomes a static `supports(driver)` method on each provider class.

**3. Driver wrapper abstraction:**
```
percy/driver/driverWrapper.js     // AppiumDriver class
```
Wraps wd vs webdriverio cap-shape differences. Phase 1 may stub this if we only support webdriverio (the spike's pattern); Phase 2 widens to wd.

**4. Per-platform metadata:**
```
percy/metadata/
├── metadata.js              // base class
├── androidMetadata.js
├── iosMetadata.js           // Phase 2
└── metadataResolver.js      // picks by platformName
```
Encapsulates cap-shape reads (`platformName`, `deviceName` w/ vs w/o `appium:` prefix, OS version, etc.). Mirrors PER-7859's existing `appium-client.js:getDeviceLabel` logic but in the percy-appium-js shape.

**5. Util folder** (mirrors upstream — these utilities exist as separate files):
```
percy/util/
├── cache.js           // for any in-memory state (per-driver WeakMap navigator state lives here)
├── log.js             // wraps @percy/logger (consistent log namespace across SDK)
├── timing.js          // TimeIt class for instrumentation
├── postFailedEvents.js // emits failed-event telemetry
├── validations.js     // descriptor + cap shape validators
└── runSession.js      // try/finally driver.deleteSession() helper
```

**6. Test framework note:** percy-appium-js uses **jasmine**. PER-7859's existing SDK uses **vitest**. Keeping vitest for the new code to avoid running two test frameworks in one package. This is a deliberate deviation from upstream — the *patterns* (mock driver fixtures, provider-resolver tests, module structure) are mirrored; the runner differs.

**7. Module syntax:** PER-7859 ships ESM (`"type": "module"`). Keeping ESM for new code. This is the second deliberate deviation. ESM-equivalents of percy-appium-js patterns work fine — `export default` becomes the primary function; named exports become helpers.

### Adopted patterns from `example-percy-appium-js` (example-repo reference)

**Directory structure (target — to be created at `Percy-react-native-support/examples/example-percy-storybook-react-native/`):**
```
example-percy-storybook-react-native/
├── .github/workflows/
│   └── percy-app-automate.yml
├── webdriverio/
│   ├── android/
│   │   ├── android.conf.js
│   │   └── specs/
│   │       └── storybook.spec.js
│   ├── ios/                          # Phase 2
│   │   ├── ios.conf.js
│   │   └── specs/
│   ├── package.json
│   └── package-lock.json
├── resources/
│   └── PercyStorybookExample.apk     # the existing fixture from spike
├── scripts/
│   └── upload-apk.ts                  # imported as-is from spike-storybook-app-percy
├── .gitignore
├── .nvmrc
├── CODEOWNERS
├── LICENSE
└── README.md
```

**`webdriverio/package.json` shape (mirrors upstream):**
```json
{
  "scripts": {
    "android": "./node_modules/.bin/wdio android/android.conf.js",
    "ios": "./node_modules/.bin/wdio ios/ios.conf.js"
  },
  "dependencies": {
    "@percy/appium-app": "^2.1.0",
    "@percy/cli": "^1.31.0",
    "@percy/storybook-react-native": "^0.2.0-alpha.0",
    "@wdio/cli": "^7.26.0",
    "@wdio/local-runner": "^7.26.0",
    "@wdio/mocha-framework": "^7.26.0"
  }
}
```

**`android.conf.js` shape (verified from upstream):**
```js
exports.config = {
  user: process.env.AA_USERNAME || 'BROWSERSTACK_USERNAME',
  key: process.env.AA_ACCESS_KEY || 'BROWSERSTACK_ACCESS_KEY',
  updateJob: false,
  specs: ['./android/specs/storybook.spec.js'],
  exclude: [],
  capabilities: [{
    project: "Percy Storybook RN Example",
    build: "App Percy Webdriverio Storybook RN Android",
    name: "storybook_visual_test",
    device: "Google Pixel 8",
    os_version: "13.0",
    app: process.env.APP || 'bs://<hashed app-id>',
  }],
  logLevel: 'info',
  framework: 'mocha',
  mochaOpts: { ui: 'bdd', timeout: 600000 },  // longer than default — story iteration
};
```

**Customer-side pattern (per-spec):**
```js
// webdriverio/android/specs/storybook.spec.js
const percyStorybookSnapshot = require('@percy/storybook-react-native');
const { discoverStories } = require('@percy/storybook-react-native');

describe('Percy Storybook RN smoke', () => {
  it('snapshots all stories', async () => {
    const stories = await discoverStories({
      cwd: process.env.PERCY_RN_PROJECT_DIR || process.cwd(),
    });
    for (const story of stories) {
      await percyStorybookSnapshot(driver, story);
    }
  });
});
```

**README structure (mirrors upstream):**
- Title + brief description
- "Tutorial" section linking to Percy docs
- Prerequisites: Node 14+, npm, git, BrowserStack account, Percy app project token
- Step-by-step (mirrors `example-percy-appium-java`'s structure):
  1. Clone & install
  2. BrowserStack credentials
  3. Build the example APK (or BYO)
  4. Upload APK via `scripts/upload-apk.ts`
  5. Percy project + token
  6. Pick device + (for deep-link branch) story IDs
  7. Run: `npm run android`
  8. Make a visual change & re-run

The spike repo at `spike-storybook-app-percy/` already implements steps 1–8 with deep-link; the example repo will mirror that flow but with **UI-tap navigation as the default** (no URL scheme registration step).

### Net plan changes from this conformance pass

- §"Module map" — rewritten below to use the `percy/providers/`, `percy/driver/`, `percy/metadata/`, `percy/util/` layout.
- §"Public API" — reshaped to single primary function + named helpers (CommonJS-idiomatic; ESM-compatible).
- §"Transport detection" — replaced inline function with `ProviderResolver.resolve(driver)` pattern.
- §"Implementation Phases" Phase 1 — file additions remapped to provider-resolver layout.
- §"Reference example" — directory structure now mirrors `example-percy-appium-js`.

The architectural intent is unchanged from the previous deepening pass; the shape is now percy-family-conformant.

---

## Plan Summary

Extend `@percy/storybook-react-native` (shipped under PER-7859 for local-Sim only) with a public **SDK-as-library** surface that lets a customer's existing Appium test job — running against **BrowserStack App Automate** — capture per-story snapshots into the existing App Percy project, with **zero backend, API, or UI changes**.

**Pitch:** consolidation. Customers who already use Percy + `@percy/storybook` for *web* Storybook get the **native equivalent** for React Native, riding on the App Automate Appium pipeline they already maintain.

**Phase 1 (this plan):** Android-only, library-mode-only, deep-link-driven story navigation, single Appium SDK shape that works for both local Sim and App Automate transports.

## Story Navigation Strategy — Decision (read first)

**Decision:** **UI-tap on Storybook RN's in-app navigator drawer is the primary navigation strategy.** Deep-link via `STORYBOOK_STORY_ID` URL parameter is documented as an alternative for customers willing to register a URL scheme (Phase 2 opt-in).

**Reasoning (user-confirmed 2026-05-08):** UI-tap requires **zero customer-side code or config changes outside the test file**. The customer's Storybook host app is used exactly as built — the SDK navigates exactly as a human user would. Deep-link is faster and more deterministic *but* requires the customer to register a URL scheme in `app.json` (Expo) or `AndroidManifest.xml` (bare RN). For the consolidation-pitch persona (existing Percy + web Storybook customer extending into native), every additional onboarding step is a meaningful drop-off risk; the customer is already accepting "build a Storybook host app distinct from production app" — adding "register a URL scheme" on top of that is the threshold worth defending against.

### Tradeoffs documented

| Dimension | UI-tap (primary) | Deep-link (alternative, Phase 2) |
|---|---|---|
| Customer-side change required | None outside test file | One line: `app.json` `"scheme": "..."` *or* `AndroidManifest.xml` `<intent-filter>` |
| Per-story navigation latency (spike measurement) | ~2s | ~500ms |
| 100-story library overhead vs deep-link | ~+150s | baseline |
| 200-story library overhead vs deep-link | ~+300s (still well under typical 30-min CI step) | baseline |
| Reliability — happy path | Brittle if Storybook RN changes navigator UI / testIDs across versions | Brittle if Storybook RN renames the `STORYBOOK_STORY_ID` constant (also a real risk) |
| Reliability — silent failure mode | Story not found → tap target missing → SDK throws explicit error | URL scheme not registered → silent no-op → snapshot of wrong story (false-negative diff) |
| iOS < 16.4 compatibility | ✅ works | ❌ requires Safari-indirection fallback (see parent plan §17.3) |
| iOS distribution-signing requirement | Same on both paths | Same on both paths |
| Onboarding doc complexity | Lower (no URL scheme section) | Higher (Expo + bare RN scheme registration walkthroughs) |

### Spike evidence retained but not load-bearing

The `spike-storybook-app-percy/` directory has a working deep-link implementation. Its measurements (~500ms/story) inform the latency tradeoff above but do not invalidate UI-tap as primary. The spike code can be referenced when implementing the deep-link alternative path in Phase 2.

The parent plan (2026-04-24) chose deep-link with an in-app `PercyStorybookRoot` handler — a strictly *more* invasive customer-side change than scheme registration. UI-tap is strictly *less* invasive than either parent-plan or spike paths, and remains the right default for the SDK-as-library shape this plan adopts.

### Open path — when to revisit

If the Phase 1 PoC reveals that:
- Storybook RN's navigator UI lacks stable testIDs / accessibility labels making UI-tap unworkable, **or**
- Per-story latency on cloud devices balloons UI-tap to >5s/story (>2× projected),

then deep-link becomes the de-facto primary and the URL-scheme onboarding step is accepted as the cost of doing business. Open Q §16.1 tracks this revisit gate.

## Sources & Origin

This plan originates from the brainstorm-mentor session captured at `docs/brainstorms/2026-05-08-app-automate-storybook-rn-requirements.md`. Key carried-forward decisions:

- **Pure SDK delivery** — no backend / API / UI / dashboard changes; **no customer app changes outside the test file.** *(See origin: §4.1)*
- **SDK-as-library** — customer composes helpers inside their existing Appium test, not a standalone CLI runner. *(See origin: §4.2)*
- **Transport auto-detection** — `bstack:options` in driver caps → App Automate; otherwise local. No flag. *(See origin: §4.3)*
- **`provisionApp` + `useAppReference`** — DX default + escape hatch. *(See origin: §4.4)*
- **Storybook host app is a separate `.apk`/`.ipa`** from the customer's production app. *(See origin: §4.7)*
- **No explicit `finalize()`** — `percy app:exec` auto-finalizes on test process exit. Mirror `@percy/appium-app` pattern. *(See origin: §4.8)*
- **Single instrumentation event** `RNStorybookSnapshotCaptured` with transport inferred. *(See origin: §7)*
- **Out of scope (MVP):** iOS, configurable matrix, `init` for AA, parallel sessions, session-chunking, custom-native-modules. *(See origin: §6)*

## Overview

`@percy/storybook-react-native@0.1.0-alpha.0` ships today as a Percy CLI command (`percy storybook-rn`) that orchestrates a full local pipeline: local Appium server → local emulator/simulator → in-app Storybook channel server (`localhost:7007`) → screenshot via Appium → upload via Percy CLI. This plan adds a **second, parallel public API surface** on the same package — a small set of library-mode functions the customer imports inside their own Appium test code — that supports the App Automate transport without ever using the `localhost:7007` channel.

Both surfaces share the existing internal modules: `comparison-poster.js`, `errors.js`, `story-enumerator.js`. New modules: `app-provisioner.js`, `story-navigator.js`, `public-api.js` (library entry point).

## Problem Statement

The PER-7859 local-Sim path requires:
- A Mac (iOS Simulator is Mac-only)
- A locally installed Appium server
- A locally booted emulator/simulator
- Network reachability from the SDK to `localhost:7007` inside the simulator

QA/SDET teams running **Linux CI** (the modal CI environment for production RN teams) can satisfy *none* of these for iOS, and `localhost:7007` reachability is also broken when the device is in BrowserStack's cloud (the Appium driver and the channel server live on different sides of a NAT).

These customers already pay for App Automate to run their Appium E2E suite. They already pay for Percy to diff snapshots. They want one pipeline change to add component-level coverage — not a parallel laptop-only workflow.

## Proposed Solution

### Customer integration shape (target)

```js
// customer's existing Appium test file, running under `percy app:exec`:
import { remote } from 'webdriverio';
import {
  provisionApp,
  discoverStories,
  snapshotStory,
  runSession, // optional helper that wraps your test in try/finally with deleteSession
} from '@percy/storybook-react-native';

// (a) DX default — SDK uploads (or reuses an existing bs:// via custom_id) the app.
const appRef = await provisionApp('./build/storybook.apk');
// (b) Escape hatch — customer pre-uploaded; pass bs:// directly:
//     const appRef = 'bs://abc123def456';

const driver = await remote({
  hostname: 'hub.browserstack.com',
  port: 443,
  protocol: 'https',
  path: '/wd/hub',
  capabilities: {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:app': appRef,
    'appium:deviceName': 'Google Pixel 8',
    'appium:platformVersion': '13.0',
    'appium:autoGrantPermissions': true,
    'bstack:options': {
      userName: process.env.BROWSERSTACK_USERNAME,
      accessKey: process.env.BROWSERSTACK_ACCESS_KEY,
      projectName: 'Percy Storybook RN',
      sessionName: 'android-components',
    },
  },
});

await runSession(driver, async () => {
  for (const story of await discoverStories()) {
    await snapshotStory(driver, story);
  }
});
// runSession ensures driver.deleteSession() runs even on test failure.
// No explicit finalize() — `percy app:exec` auto-finalizes on process exit.

// Power-user form: factory-bound options shared across calls.
//   import { createPercyStorybook } from '@percy/storybook-react-native';
//   const percy = createPercyStorybook({ renderMs: 2000, navigationStrategy: 'ui-tap' });
//   await percy.snapshotStory(driver, story);
```

Customer-side changes outside the test file:
1. **Build a Storybook-enabled `.apk`** distinct from production app (already a parent-plan deliverable).

That's it. **No URL scheme registration. No `PercyStorybookRoot` wrapper. No metro/channel server. No new permissions.** The SDK uses Appium UI-tap navigation against Storybook RN's in-app navigator — works against the customer's existing Storybook host app unmodified.

(Customers who prefer faster per-story navigation can opt in to deep-link mode in Phase 2; that path requires a one-line URL scheme registration. See "Story-navigation strategy" below for tradeoffs.)

### Architecture

```mermaid
graph TB
  subgraph "Customer's CI runner (Linux)"
    Test[Customer's Appium test file<br/>imports PercyStorybook]
    SDK["@percy/storybook-react-native (library mode)"]
    CLI["Percy CLI<br/>(percy app:exec wrapper)"]
    Test --> SDK
    Test --> CLI
  end

  subgraph "BrowserStack App Automate"
    Hub[hub.browserstack.com]
    Device[Real Android device]
    HostApp[Storybook-RN host app<br/>(unmodified by customer)]
  end

  subgraph "BrowserStack APIs"
    UploadAPI[api-cloud.browserstack.com<br/>/app-automate/upload]
  end

  subgraph "Percy (unchanged)"
    PercyCLI_localhost[Percy CLI :5338]
    PercyBackend[App Percy backend]
  end

  SDK -->|provisionApp: POST multipart| UploadAPI
  UploadAPI -->|bs:// reference| SDK
  SDK -->|webdriverio remote w/ bs:// caps| Hub
  Hub --> Device
  Device --> HostApp
  SDK -->|Appium UI-tap on Storybook navigator (default)<br/>OR mobile: deepLink (Phase 2 opt-in)| Device
  Device -->|driver.takeScreenshot| SDK
  SDK -->|@percy/sdk-utils postComparison| PercyCLI_localhost
  PercyCLI_localhost --> PercyBackend
```

The two transports converge on the same code path *after* the Appium driver is created. Differences are concentrated in `provisionApp` (BS upload vs Appium `installApp`) and in the deep-link issuing function (which inspects driver caps once at construction time to choose the right Appium command shape).

### Module map (additions to `packages/storybook-react-native/`)

**Layout mirrors `percy-appium-js` repo structure** (see Conformance section above):

```
packages/storybook-react-native/
├── index.js                          # primary fn export + named helpers (NEW)
├── src/                              # existing PER-7859 CLI mode (UNTOUCHED)
│   ├── runner.js
│   ├── storybook-channel.js
│   ├── appium-client.js
│   ├── comparison-poster.js
│   ├── story-enumerator.js
│   ├── config.js
│   ├── errors.js
│   └── commands/
│       ├── storybook-rn.js
│       ├── doctor.js
│       └── init.js
├── percy/                            # NEW — library mode (mirrors percy-appium-js)
│   ├── percyStorybookSnapshot.js     # primary function: percyStorybookSnapshot(driver, story, options)
│   ├── discoverStories.js            # named export — wraps src/story-enumerator
│   ├── provisionApp.js               # named export — BS upload + recent_apps GET
│   ├── providers/
│   │   ├── genericProvider.js        # local Appium / fallback
│   │   ├── appAutomateProvider.js    # BS-specific (extends generic)
│   │   └── providerResolver.js       # static supports() dispatch
│   ├── driver/
│   │   └── driverWrapper.js          # AppiumDriver wrapper (webdriverio v9 only in Phase 1)
│   ├── metadata/
│   │   ├── metadata.js               # base
│   │   ├── androidMetadata.js
│   │   └── metadataResolver.js
│   ├── navigator/
│   │   ├── navigateToStory.js        # primary (UI-tap) entry; calls into uiTapStrategy or deepLinkStrategy
│   │   ├── uiTapStrategy.js          # Storybook RN navigator drawer-tap state machine
│   │   └── deepLinkStrategy.js       # Phase 2 opt-in (mobile: deepLink + STORYBOOK_STORY_ID)
│   └── util/
│       ├── cache.js                  # WeakMap-keyed per-driver navigator state
│       ├── log.js                    # @percy/logger wrapper
│       ├── timing.js                 # TimeIt
│       ├── postFailedEvents.js       # telemetry on failed ops
│       ├── validations.js            # descriptor + cap validators
│       └── runSession.js             # try/finally driver.deleteSession() helper
└── test/
    ├── (existing CLI-mode vitest tests untouched)
    └── lib/                          # NEW — library-mode tests, vitest, mirrors test layout above
        ├── providers/
        │   ├── providerResolver.test.js
        │   ├── genericProvider.test.js
        │   └── appAutomateProvider.test.js
        ├── navigator/
        │   ├── uiTapStrategy.test.js
        │   └── deepLinkStrategy.test.js
        ├── provisionApp.test.js
        ├── percyStorybookSnapshot.test.js
        └── fixtures/
            └── storybook-rn-v10-navigator.xml   # captured Appium page-source
```

| Path | New / Existing | Role |
|---|---|---|
| `index.js` | **NEW** | Top-level entry: `module.exports = percyStorybookSnapshot; module.exports.discoverStories = ...; module.exports.provisionApp = ...; module.exports.runSession = ...;`. Re-exports library-mode API as named helpers attached to the primary function. |
| `percy/percyStorybookSnapshot.js` | **NEW** | Primary function `percyStorybookSnapshot(driver, story, options)` — mirrors `percyScreenshot` shape exactly. Uses `ProviderResolver.resolve(driver)` to dispatch. |
| `percy/providers/providerResolver.js` | **NEW** | `static resolve(driver)` — picks `[AppAutomateProvider, GenericProvider].filter(x => x.supports(driver))[0]`. |
| `percy/providers/genericProvider.js` | **NEW** | Local-Appium fallback. `static supports(driver) { return true; }`. Implements UI-tap navigation + screenshot capture + Percy CLI POST (delegates to `@percy/appium-app` `percyScreenshot`). |
| `percy/providers/appAutomateProvider.js` | **NEW** | Extends `GenericProvider`. `static supports(driver)` returns true when `bstack:options` (with creds) or flat `bstack:userName` is present. Adds session-URL surfacing + BS-specific capability shaping. |
| `percy/navigator/navigateToStory.js` | **NEW** | `navigateToStory(driver, descriptor, opts)` — UI-tap primary, deep-link branch when `opts.strategy === 'deeplink'`. |
| `percy/navigator/uiTapStrategy.js` | **NEW** | Storybook RN in-app navigator state machine (drawer-open / tree-walk / leaf-tap / ready-poll). v10 selector cascade. UI-package detection (lite vs full). |
| `percy/navigator/deepLinkStrategy.js` | **NEW** | Phase 2 opt-in. `mobile: deepLink` + `STORYBOOK_STORY_ID` URL parameter. |
| `src/comparison-poster.js` | EXISTING | Reused unchanged by CLI mode. Library mode delegates to `@percy/appium-app`'s `percyScreenshot` for capture+upload. |
| `src/story-enumerator.js` | EXISTING | Wrapped by `percy/discoverStories.js`. Already produces canonical CSF IDs (`${titleId}--${kebab(exportName)}`). |
| `src/errors.js` | EXTEND | Add new error codes (see Error classification table). Library mode imports from here for parity with CLI mode. |
| `src/appium-client.js` | EXISTING (CLI mode) | **Not used in library mode.** Library mode uses `percy/driver/driverWrapper.js`. |
| `src/index.js` | UNTOUCHED | CLI-mode entry. Library mode entry is the new top-level `index.js` at the package root (mirrors `percy-appium-js`). |
| `src/runner.js` | EXISTING (CLI mode) | Untouched. CLI continues to use `localhost:7007` channel for local Sim. |

**Critical: the CLI runner (`src/runner.js`, `src/commands/storybook-rn.js`) and `localhost:7007` channel client (`src/storybook-channel.js`) are *not* modified.** PER-7859 keeps shipping its current local-Sim flow. Library mode is purely additive.

### Public API (library mode)

#### Functional exports (mirrors `@percy/appium-app`'s `percyScreenshot(driver, name, options)` shape)

```js
// src/public-api.js (pseudo)

const DEFAULTS = {
  renderMs: 1500,
  coldBootMaxMs: 30000,        // poll-for-ready upper bound (replaces fixed coldBootMs sleep)
  globalNavigationBudgetMs: 8000, // hard ceiling per snapshotStory call across all ready-signal tiers
  stabilityMaxAttempts: 4,
  stabilitySettleMs: 200,      // first stability capture deferred by this much (rel-9 / C9 fix)
  navigationStrategy: 'ui-tap', // 'ui-tap' (default) | 'deeplink' (opt-in)
  uploadRetries: 3,
  uploadTimeoutMs: 120000,
  freezeAnimatedImage: true,   // pass-through default for @percy/appium-app
};

// Per-driver navigator state. WeakMap keyed by driver reference — no cross-driver leakage.
const navStateByDriver = new WeakMap();

export async function provisionApp(localPath, opts = {}) {
  // 1. Compute sha256(localPath) → use as custom_id (40 hex chars to fit BS's [A-Za-z0-9._-] format)
  // 2. GET https://api-cloud.browserstack.com/app-automate/recent_apps/{custom_id}
  //    - On 200 with non-empty array → return existing app_url. NO upload.
  //    - On 404 / empty → fall through to upload.
  // 3. POST https://api-cloud.browserstack.com/app-automate/upload with custom_id
  //    multipart, Basic auth, retry-on-5xx (max uploadRetries), uploadTimeoutMs ceiling.
  //    Returns app_url ('bs://...').
  // 4. Optional 5s post-upload pause OR poll for app readiness (PoC-validated).
}

// Escape hatch — accepts pre-provisioned bs:// reference; returns it back for symmetry.
export function useAppReference(ref) {
  if (!ref?.startsWith('bs://')) throw err('invalid_app_reference', `Expected bs://… got ${ref}`);
  return ref;
}

export async function discoverStories(opts = {}) {
  return enumerateStories(opts.cwd ?? process.cwd(), opts.configDir);
}

export async function snapshotStory(driver, descriptor, opts = {}) {
  // Re-detect transport per call (cheap; no cached state to go stale on driver reuse).
  // Validate descriptor: require descriptor.id, descriptor.name, descriptor.componentTitle —
  // throw `invalid_descriptor` on missing fields rather than fall back to id (prevents
  // snapshot-name divergence from CLI mode; api-contract C7 fix).
  // 1. navigateToStory(driver, descriptor, mergedOpts)  — see story-navigator.js
  // 2. delegate capture to @percy/appium-app's percyScreenshot(driver, name, { freezeAnimatedImage, …opts.snapshot })
  // 3. emit RNStorybookSnapshotCaptured event (transport, component, story, device, result, duration_ms, sdk_version)
}

// Optional ergonomic wrapper to enforce driver.deleteSession() — addresses dangling-session waste.
export async function runSession(driver, fn) {
  try { await fn(); } finally { await driver.deleteSession().catch(() => {}); }
}

// Factory for power users who want shared opts without threading them through each call.
export function createPercyStorybook(defaults = {}) {
  return {
    provisionApp,
    discoverStories,
    useAppReference,
    runSession,
    snapshotStory: (driver, descriptor, opts = {}) =>
      snapshotStory(driver, descriptor, { ...defaults, ...opts }),
  };
}
```

#### `provisionApp(localPath, opts)` semantics

**Reads** `BROWSERSTACK_USERNAME` / `BROWSERSTACK_ACCESS_KEY` from env (or `opts.credentials`).

**Content-addressed reuse (replaces hash-cache):**
1. Compute `customId = sha256(file).slice(0, 40)`.
2. `GET https://api-cloud.browserstack.com/app-automate/recent_apps/${customId}` — if BS returns a non-empty match, **return the existing `app_url` without uploading**. This is BrowserStack's own server-side dedup mechanism — no client-side cache file required.
3. On 404 or empty response, fall through to upload: `POST https://api-cloud.browserstack.com/app-automate/upload` with multipart `file=@localPath`, `custom_id=customId`, `Authorization: Basic <base64(user:key)>`. Returns `bs://...` from `app_url`.

**Retry + timeout (correctness-driven):**
- 3 retries with exponential backoff + jitter on 5xx and network errors only (never on 4xx).
- 120s fetch timeout per attempt.
- Surface BS API response body (truncated) in error messages for non-200 responses.

**Post-upload readiness (PoC-validated):**
- BS does not document whether `bs://` is install-ready immediately. Plan ships with a 5s defensive pause after upload; the Phase 1 PoC measures install-success on first attempt and either drops the pause (if always ready) or replaces with a poll on `recent_apps/{customId}` until the app appears (if not).

**Local transport** (no `BROWSERSTACK_USERNAME` env or explicit `opts.transport === 'local'`): no-ops and returns the absolute path; the customer passes that to Appium's `app` capability — Appium `installApp` is implicit in standard caps.

**Why this is simpler than client-side hash caching:**
- No cache file to manage (`~/.percy/...` directory unused).
- No TTL/eviction logic.
- No liveness probe (BS itself signals via 404 when stale).
- Customer's CI cache is a non-issue — `recent_apps` works across CI runs by design.
- Survives across customer machines (CI runners) without shared cache infra.

#### `snapshotStory(driver, descriptor, opts)` semantics

- Inspects `driver.capabilities` once on first call:
  - `bstack:options` present OR `bstack:userName`/`bstack:accessKey` flat caps → `transport=app-automate`
  - Otherwise → `transport=local`
- Delegates to `navigateToStory(driver, descriptor, opts)` in `story-navigator.js` — UI-tap primary, deep-link branch when `opts.strategy === 'deeplink'`.
- For UI-tap path: opens Storybook RN's in-app navigator drawer, traverses `componentTitle` segments (split on `/`), taps story leaf, awaits render-ready (cooperative testID → screenshot stability → `renderMs` fallback).
- For deep-link path: builds `${scheme}:///?STORYBOOK_STORY_ID=${encodeURIComponent(descriptor.id)}` and issues `driver.executeScript('mobile: deepLink', [{ url, package: pkg }])`.
- Waits `renderMs` (default 1500ms) on the deep-link path; UI-tap path uses ready-signal poll instead.
- Captures via `@percy/appium-app`'s `percyScreenshot(driver, name, options)`. **This is the load-bearing reuse decision** — see §"Why delegate to @percy/appium-app" below.
- Names snapshot: `${descriptor.componentTitle ?? descriptor.id}/${descriptor.name ?? descriptor.id}/${deviceLabel}`.
- Emits `RNStorybookSnapshotCaptured` event with transport, component, story, device_platform, device_name, bs_session_id (from `bstack:options`), result, duration_ms, sdk_version.

#### `useAppReference(ref)`

```js
percy.useAppReference('bs://abc123');  // sets _appRef without uploading
```

For customers running their own BS upload as part of build pipeline. Validates `bs://` prefix only (lazy validation; lets Appium reject if invalid).

### Why delegate to `@percy/appium-app` (load-bearing decision)

The existing `comparison-poster.js` POSTs to Percy CLI via `@percy/sdk-utils.postComparison`. So does `@percy/appium-app`. Both reach the same `:5338/percy/comparison` endpoint. Either works.

**Choose `@percy/appium-app` for library mode.** Three reasons:

1. **DOM/animation/percyCSS options** — `@percy/appium-app` ships `freezeAnimatedImage`, `freezeImageBySelectors`, `percyCSS` for masking. RN-native parallels for these (image freezing, CSS-style mask injection) are the same problem space; reusing the option surface keeps customer learning curve flat.
2. **Build telemetry parity** — `@percy/appium-app` already wires Percy CLI's build/session metadata. Going around it would duplicate.
3. **The spike validates this exact composition** — `tests/android.ts:43` imports `percyScreenshot from '@percy/appium-app'` and uses it directly inside a custom Appium test. The pattern works end-to-end against App Automate today.

Add `@percy/appium-app` (`^2.1.0`) as a `peerDependency` (not `dependency`) so the customer has a single version to pin and we don't ship a duplicate copy.

The existing `comparison-poster.js` stays in-tree as the **CLI mode's** poster (continues to serve the local-Sim path). Library mode bypasses it.

### Story-navigation strategy

#### Primary: Appium UI-tap on Storybook RN's in-app navigator

Storybook for React Native renders an in-app navigator (drawer/menu UI) that lists every registered story. The SDK uses Appium's W3C interaction commands to:
1. Open the Storybook navigator (tap `mobile-menu-button` testID — verified stable in v10)
2. Navigate to the story's component group (tap by visible text — tree nodes have no testID in v10)
3. Navigate to the story variant (tap by visible text)
4. Wait for render-ready under a global per-story budget

**Why this is the right default:** zero customer-side code or config changes outside the test file. The customer ships their Storybook host app exactly as Storybook RN scaffolds it, and the SDK drives it as a human reviewer would.

#### Storybook RN v10 navigator: UI-package detection

**Critical:** Storybook RN v10 ships **two parallel UI packages**:
- `@storybook/react-native-ui-lite` — fewer features, more accessibility props (`mobile-menu-button`, `storybook-explorer-tree` testIDs verified)
- `@storybook/react-native-ui` (full) — more features, *fewer* accessibility props

The customer's app uses one or the other depending on their Storybook RN config. The SDK must detect which is in use to choose the right selector cascade.

**Detection strategy** (first-call per driver, cached in WeakMap by driver reference for the rest of the session):
1. Probe for `~mobile-menu-button` (lite-style) — present in both packages where exposed.
2. If absent, probe for the full-package equivalent (text-search for "Storybook" tab).
3. If neither resolves within `coldBootMaxMs`, fail-fast with `nav_navigator_not_detected` error.

#### Element-selection strategy (verified for v10.x via source inspection of `storybookjs/react-native` next branch)

**Verified stable testIDs:**
- `mobile-menu-button` — drawer toggle (both ui packages)
- `mobile-addons-button` — addons panel
- `storybook-explorer-tree` — tree container (lite only)

**Verified gap — tree leaves and component groups have NO testID and NO accessibilityLabel.** Text-match is the only handle. This is the single largest stability risk for the UI-tap path; tracked in §"Risk Analysis" and §"Open Questions".

**Selector priority (Android, UiAutomator2):**
1. `~accessibility-id` for testID-bearing elements (drawer toggle, tree container).
2. `-android uiautomator new UiSelector().text("...")` for tree nodes (component groups + story leaves) — text-match by exact CSF title segment / story name. Sanitize/escape `"` in story names.
3. `-android uiautomator new UiSelector().resourceIdMatches(".*<testID>")` as fallback when `~` resolves through `accessibilityLabel` not `testID`.
4. XPath only as last-resort with explicit warning log including `selector_strategy` field for telemetry.

**RN testID → native attribute mapping gotcha:** On Android, `testID` becomes `resource-id` (suffix `:id/<testID>`), *not* `content-desc`. RN may also mirror `testID` to `content-desc` when no `accessibilityLabel` is set. If both `testID` and `accessibilityLabel` are present (as on `mobile-menu-button`), `~accessibility-id` resolves via `accessibilityLabel` — which differs from the testID. Plan-level resolution: SDK tries `~mobile-menu-button` first, falls through to text match (`"Open story list"` for v10 lite) on miss.

**iOS (XCUITest, Phase 2):** `~testID` works directly (`testID` becomes `accessibilityIdentifier`). For tree nodes: `-ios predicate string:label == "Forms" AND type == "XCUIElementTypeButton"`.

**Story descriptor → tap path resolution:**
The existing `enumerateStories` returns `{ id, name, componentTitle }`. Resolution from descriptor to taps:
- `componentTitle` (e.g. `Forms/Button`) → split on **un-escaped** `/` (regex with negative lookbehind to preserve CSF escaped slashes) → tap each level in order, expanding tree nodes as needed.
- `name` (e.g. `Primary`) → final leaf tap.
- Sanitize segment text before injection into UiAutomator/XPath selectors (escape `"`, `'`).

**Render-ready signal** — bounded per-story navigation budget (default `globalNavigationBudgetMs: 8000` ms). Within that budget, evaluate signals in priority order:
1. **Cooperative testID** *(opt-in; deferred to Phase 2)* — if a future host-app addon emits `percy-ready-<storyId>` after `InteractionManager.runAfterInteractions(...)`, poll for it. Time cap: `min(3000, remainingBudget)` ms. *Phase 1 ships without cooperative testID — listed here for forward-compat.*
2. **Bounded screenshot stability** — capture initial frame at `t = tap + stabilitySettleMs (200ms)` to ensure a transition has occurred (prevents capturing a stale pre-render frame as "stable" — correctness review C9). Then capture up to `stabilityMaxAttempts (4)` more frames at ~150ms intervals; treat ready when **three consecutive hashes match** (not two — guards against the same-frame race). Hash function: SHA-1 over downsampled grayscale to absorb anti-aliasing noise. Time cap: `min(1000, remainingBudget)` ms.
3. **Hard `renderMs` fallback (default 1500ms)** — only fires if signals 1 and 2 both exhaust their caps. Time cap: `min(renderMs, remainingBudget)`.

If the global `globalNavigationBudgetMs` is exceeded across all signals, throw `nav_render_timeout` with `selector_strategy` and tier-by-tier durations for telemetry. **Mitigation for animated content** (Lottie / blinking cursor / GIF — guaranteed to never stabilize): pass `freezeAnimatedImage: true` (the default) through to `@percy/appium-app`'s `percyScreenshot()` to halt animation before capture.

**Pre-iteration setup (per-driver, one-time):**
The first `snapshotStory(driver, ...)` call against a driver must establish a known navigator state. Sequence:
- **Poll for app readiness** (replaces fixed 8s sleep): poll for `~mobile-menu-button` (or `"Storybook"` text fallback) every 500ms until `coldBootMaxMs (30000)` elapses. Failure → `app_cold_boot_timeout`.
- **Dismiss "first launch" tutorial / welcome modal** if Storybook RN shows one (best-effort: tap close button if found; otherwise back-press).
- **Verify Storybook tab is active** (in v10, this is the only tab in most configs).

**Tap-path caching (optional; off by default in MVP — `opts.cacheNavigatorState: true` to enable):**
Per-driver navigator state stored in a WeakMap (no cross-driver state leakage — fixes correctness review C2). State machine:
```js
// In WeakMap keyed by driver ref:
{
  drawerOpen: boolean,
  expandedComponents: Set<string>,  // 'Forms', 'Forms/Button'
  currentStoryId: string | null,
}
```
Skip drawer-open + group-expand when `expandedComponents` already contains the path. **State-divergence detection:** before each cached tap, perform a cheap probe (presence of expected component-group element). On mismatch, evict the entire cached state for this driver and replay the full open-drawer → expand-component sequence. Two consecutive divergences in one session → disable cache for the rest of the session. Telemetry: `nav_state_diverged` count per session.

**Sort stories by `componentTitle` before iteration** to maximize cache hits. Document in onboarding.

**Circuit breaker (correctness + reliability fix — TWO dimensions):**
Inherited from parent plan §17.4 + extended:
- Dimension 1: 3 consecutive same-class failures → abort.
- Dimension 2 (NEW): cumulative same-class failure rate >40% over ≥10 attempts → abort.

This catches the 30%-flake regime where streak-only blind-spots customers into burning their full BS quota. On abort, throw a tagged `PercyCircuitOpen` error; let the test process exit; rely on Percy CLI's existing `percy app:exec` finalize handler. Document explicitly that abort produces a *finalized-but-incomplete* build, not an unfinalized one.

#### Alternative: deep-link via `STORYBOOK_STORY_ID` URL parameter (Phase 2 opt-in)

For customers who want sub-second per-story navigation and accept the URL-scheme registration step. Implementation already exists in `spike-storybook-app-percy/tests/android.ts:75`. Activation:

```js
const percy = createPercyStorybook({ navigationStrategy: 'deeplink', appScheme: 'myapp', appPackage: 'com.acme.storybook' });
```

URL format: `<scheme>:///?STORYBOOK_STORY_ID=<id>`. Issued via Appium's `mobile: deepLink` command. Reference: `STORYBOOK_STORY_ID_PARAM` constant in [`storybookjs/react-native/packages/react-native/src/constants.ts`](https://github.com/storybookjs/react-native/blob/main/packages/react-native/src/constants.ts).

**Customer-side requirement** (the cost the primary path avoids):
- **Expo:** `"scheme": "myapp"` in `app.json`. One line.
- **Bare RN Android:** `<intent-filter>` block in `AndroidManifest.xml`.
- **Bare RN iOS** (Phase 2): `CFBundleURLTypes` entry in `Info.plist`.

**Silent failure detection (Phase 2):** nonce parameter `&_percy_nav=<uuid>` + cooperative accessibility label readback (carried over from parent plan §17.5). Phase 2 ships *without* this — customers using deep-link must manually verify the first build's snapshots in the Percy dashboard before automating.

### Transport detection (correctness review fix — non-empty creds required)

```js
// inside story-navigator.js
function detectTransport(driver) {
  const caps = driver.capabilities ?? {};
  const bstack = caps['bstack:options'] ?? null;
  // Reject empty {} — `'bstack:options': {}` is truthy but has no creds (correctness C1).
  // Require at least one cred field to actually classify as app-automate.
  const nestedHasCreds = bstack && (bstack.userName || bstack.accessKey);
  // Flat / legacy keys — read both prefixed and unprefixed shapes (WDIO 8 vs 9 normalization).
  const flatHasCreds =
    caps['bstack:userName'] ||
    caps['browserstack.user'] ||
    caps.userName;  // post-WDIO-9 normalization can drop vendor prefix
  if (nestedHasCreds || flatHasCreds) return 'app-automate';
  return 'local';
}
```

Re-detect transport per `snapshotStory` call rather than caching at first-call (correctness C8 fix). Cap-property reads are cheap (constant-time object access); the cached-detection optimization carried no payoff and risked stale state across `driver.deleteSession() → new remote()` reuse on the same factory instance.

**Important:** read both `caps['appium:deviceName']` AND `caps.deviceName` for the device label — the parent plan's `appium-client.js:75` confirms WebdriverIO sometimes drops the `appium:` prefix once a session is created. Mirror that pattern in library mode.

### Error classification

Inherit the parent plan's enhancement #4 wisdom: classify errors so the SDK doesn't burn 45s × 200 stories on a deterministic failure.

| Error code | Class | SDK behavior |
|---|---|---|
| `bs_credentials_missing` | Configuration | Fail fast, before upload. |
| `bs_upload_failed` | Network / Configuration | Retried 3× on 5xx + network errors; on exhaustion, fail fast and surface BS API response body. |
| `bs_upload_too_large` | Configuration | Fail fast (BS limit 1 GB per account; accounts vary). |
| `bs_app_not_ready` | Per-session | First Appium session install fails because BS is still processing the upload. SDK retries session creation once after a 5s pause; if still failing, surface clearly. |
| `bs_app_reference_stale` | Per-session | `bs://` ref returned valid but BS later evicted the upload (rare; <30 day TTL boundaries). Drop client-side state, fall through to a fresh `provisionApp`. |
| `bs_quota_exhausted` | Configuration | Surfaced when `wdio.remote()` rejection contains BS quota error code. Distinct from generic appium_unreachable so customers don't blindly retry into the wall. |
| `appium_unreachable` | Infrastructure | Inherited from existing `appium-client.js`. |
| `nav_navigator_not_detected` | Per-session (UI-tap path) | Storybook RN navigator (lite or full) cannot be located within `coldBootMaxMs`. Distinct from `nav_element_not_found`. |
| `nav_element_not_found` | Per-snapshot (UI-tap path) | Mark snapshot failed; circuit breaker after 3 same-class consecutive OR >40% rate. Includes `selector_used`, `selector_strategy` for debugging. |
| `nav_state_diverged` | Per-snapshot (UI-tap path, cache mode) | Cached navigator state out of sync with reality. SDK evicts cache + replays full sequence; surfaces only if the replay also fails. |
| `nav_render_timeout` | Per-snapshot (UI-tap path) | Global per-story navigation budget exceeded. Mark snapshot failed; circuit breaker as above. Includes tier-by-tier durations. |
| `app_cold_boot_timeout` | Per-session (UI-tap path) | Distinct from nav_element_not_found so circuit breaker classifies correctly. |
| `deep_link_unsupported_platform` | Configuration (deep-link path only) | Fail fast on iOS < 16.4 with `opts.strategy === 'deeplink'`; suggest dropping `navigationStrategy` to use the default UI-tap path. |
| `url_scheme_silent_failure` | Configuration / per-snapshot (deep-link path only) | Cannot detect deterministically without cooperative addon. Phase 2 nonce-based detection. |
| `invalid_descriptor` | Per-call | Thrown when `snapshotStory` receives a descriptor missing `componentTitle` or `name`. Prevents snapshot-name divergence from CLI mode. |
| `invalid_app_reference` | Per-call | `useAppReference(ref)` rejects non-`bs://` strings. |
| `screenshot_failed` | Per-snapshot | Continue with next story; mark failed; circuit breaker as above. |
| `percy_cli_unreachable` | Configuration | Fail fast — same as existing CLI mode. |

Add a circuit breaker: 3 consecutive `screenshot_failed` of the same class → abort run. (The parent plan's enhancement #4 suggests this exact pattern.)

### Implementation Phases

#### Phase 1 — PoC (this plan, MVP scope)

**Scope:** Android-only, library-mode-only, deep-link-driven.

- [ ] `src/public-api.js`: `PercyStorybook` class wiring `provisionApp`, `useAppReference`, `discoverStories`, `snapshotStory`
- [ ] `src/app-provisioner.js`: BS multipart upload via `fetch` + `FormData` (Node 18+ native, no extra deps). Mirror `spike-storybook-app-percy/scripts/upload-apk.ts:38` shape.
- [ ] `src/story-navigator.js`: `navigateToStory(driver, descriptor, opts)` — UI-tap primary (Android UiAutomator2 selectors); deep-link branch behind `opts.strategy === 'deeplink'` opt-in (Phase 2).
- [ ] `index.js` (top-level, NEW): primary fn export + named helpers (mirrors `percy-appium-js/index.js`).
- [ ] `percy/percyStorybookSnapshot.js`: primary fn — resolves provider, navigates, captures via `@percy/appium-app`.
- [ ] `percy/providers/{providerResolver,genericProvider,appAutomateProvider}.js`: provider-resolver dispatch.
- [ ] `percy/navigator/{navigateToStory,uiTapStrategy,deepLinkStrategy}.js`: navigation strategies.
- [ ] `percy/driver/driverWrapper.js`: `AppiumDriver` wrapper (webdriverio v9 in Phase 1).
- [ ] `percy/metadata/{metadata,androidMetadata,metadataResolver}.js`: per-platform cap-shape extraction.
- [ ] `percy/util/{cache,log,timing,postFailedEvents,validations,runSession}.js`: utilities.
- [ ] `percy/discoverStories.js`: thin wrapper around existing `src/story-enumerator.js`.
- [ ] `percy/provisionApp.js`: BS upload + `recent_apps` GET pattern.
- [ ] `src/errors.js`: add new error codes (extension only — CLI mode unaffected).
- [ ] `package.json`: add `@percy/appium-app: ~2.1.0` as `peerDependency` (patch-only range pending CI matrix — api-contract finding 005); add `peerDependenciesMeta: { "@percy/appium-app": { "optional": true } }` so existing CLI-only consumers don't see install-time breakage (api-contract finding 004). Update `keywords` to include `app-automate`. Bump `version` to `0.2.0-alpha.0`.
- [ ] **Tests** (vitest, shared `createMockDriver()` factory typed against `import('webdriverio').Browser`):
  - [ ] `test/public-api.test.js` — functional exports wiring; descriptor validation (rejects missing `componentTitle`/`name`); `runSession` ensures `deleteSession` even on test failure; `createPercyStorybook` factory threads opts.
  - [ ] `test/transport-detection.test.js` — **cap-shape matrix** (testing review critical gap #3): nested `bstack:options.userName`, flat `bstack:userName`, legacy `browserstack.user`, hybrid (nested + flat), empty `bstack:options: {}`, and post-WDIO-9-stripped `userName`. Documented precedence: nested > flat > legacy. Empty `{}` returns `local`.
  - [ ] `test/app-provisioner.test.js` — env vs `opts.credentials` precedence; `recent_apps` GET hit (skip upload) vs miss (upload); retry-on-5xx with backoff (mock 502 → 502 → 200); 4xx fails fast with no retry; 120s fetch timeout; multipart Unicode filename + RFC 5987; binary boundary handling.
  - [ ] `test/story-navigator.test.js` — UI-tap path: v10 selector cascade (`~mobile-menu-button` first, text-match fallback), `componentTitle.split('/')` with escaped slash (`Forms\/Button`), special-char story names. **Render-ready cascade explicit branches** (testing review critical gap #1): testID-resolves-immediately → no stability check; testID-times-out → stability converges → no renderMs; testID-times-out + stability-never-converges → renderMs fires; all-three-time-out → `nav_render_timeout` thrown with tier durations. Animated-content fixture (every-other-frame hash differs) → stability times out cleanly. Deep-link branch: round-trip URL encode/decode property test (replaces brittle exact-string match).
  - [ ] `test/story-navigator-cache.test.js` — same-component cache hit; component-switch invalidation; cross-driver isolation (WeakMap keying); state-divergence eviction; 2 consecutive divergences disable cache for session.
  - [ ] `test/element-tree-fixture.test.js` — **fixture-driven selector resolver** (testing review critical gap #2): check in `fixtures/storybook-rn-v10-navigator.xml` (captured Appium page-source from a real Storybook RN v10.x app), assert `componentTitle/storyName` descriptors resolve to matchable nodes via the SDK's selector cascade. Single test that catches upstream Storybook RN navigator drift between releases.
  - [ ] `test/integration-library-mode.test.js` — full mocked drive of `provisionApp (cache hit) → snapshotStory → snapshotStory` against a fake driver; verify circuit breaker fires on 3 consecutive `nav_render_timeout` AND on >40% cumulative rate.
- [ ] **Reference example repo** at `Percy-react-native-support/examples/example-percy-storybook-react-native/` — directory structure mirrors [`percy/example-percy-appium-js`](https://github.com/percy/example-percy-appium-js) exactly:
  - [ ] `webdriverio/android/android.conf.js` — wdio config (mirrors upstream)
  - [ ] `webdriverio/android/specs/storybook.spec.js` — copyable customer test (mocha, mirrors upstream's `test.js`)
  - [ ] `webdriverio/package.json` — `npm run android` script + deps (mirrors upstream)
  - [ ] `resources/PercyStorybookExample.apk` — borrowed from existing spike fixture
  - [ ] `scripts/upload-apk.ts` — imported as-is from `spike-storybook-app-percy/scripts/upload-apk.ts`
  - [ ] `.github/workflows/percy-app-automate.yml` — Linux runner CI workflow
  - [ ] `README.md` — tutorial structure mirrors `example-percy-appium-java`'s README (Steps 1-8)
  - [ ] `.nvmrc`, `CODEOWNERS`, `LICENSE`, `.gitignore` (top-level, mirrors upstream)
- [ ] **Documentation**:
  - [ ] `packages/storybook-react-native/SETUP.md` — extend with library-mode + App Automate section
  - [ ] `packages/storybook-react-native/README.md` — high-level "two ways to use this SDK"
  - [ ] New: `packages/storybook-react-native/STORYBOOK_HOST_APP.md` — how to build a Storybook-enabled `.apk` distinct from production app (the onboarding cliff)

**Success criterion (Phase 1):** one end-to-end run from a Linux runner against a real BS Android device, capturing all stories from a sample fixture, finalizes a Percy build with the full set of snapshots visible in the App Percy dashboard.

#### Phase 2 — iOS, configurable matrix, deep-link opt-in, post-PoC enhancements

App-hash caching is **superseded by the BS `custom_id` + `recent_apps` GET pattern in Phase 1** (no client-side cache file needed). Phase 2 work:

- [ ] iOS XCUITest UI-tap selectors (`-ios predicate string`, accessibility id) for the primary path
- [ ] iOS XCUITest deep-link via `driver.url(...)` for the opt-in deep-link branch (works on iOS 16.4+)
- [ ] iOS < 16.4: deep-link branch fails fast with `deep_link_unsupported_platform`; UI-tap remains supported on all iOS versions
- [ ] iOS distribution-signing onboarding doc (separate doc page; non-trivial Apple Dev account setup)
- [ ] Configurable BS device matrix in customer's call site (currently single device per `wdio.remote()` call; matrix = customer orchestrates multiple `remote()` calls with shared `bs://`)
- [ ] Cooperative accessibility-label addon for the host app (nonce-based deep-link navigation liveness; closes the URL-scheme silent-failure gap)
- [ ] BS upload status polling (replace defensive 5s pause with actual readiness probe, if Phase 1 PoC reveals it's needed)
- [ ] iOS distribution-signing onboarding doc (separate doc page; non-trivial Apple Dev account setup)
- [ ] Configurable BS device matrix in `provisionApp` opts (currently single device per `wdio.remote()` call; matrix = orchestrate multiple `remote()` calls in customer code with shared `bs://`)
- [ ] Optional cooperative accessibility-label addon for the host app (nonce-based navigation liveness)

#### Phase 3 — Beyond MVP

- [ ] Parallel device sessions (concurrency in customer's iteration loop is already possible — just document the pattern; consider exposing a `runMatrix(driver1, driver2, ...)` helper).
- [ ] Session-chunking for >N-story runs hitting BS session time limits.
- [ ] Storybook-RN navigator chrome stripping (the spike's caveat: deep-link selects a story, but Storybook UI chrome — sidebar + nav bar — still appears in snapshots). Options: (a) one-time pre-iteration tap to collapse sidebar, (b) cooperative `PercyStorybookRoot` wrapper from the parent plan that hides chrome.
- [ ] Optional contribution upstream into `percy-appium-js`/`percy-appium-app` (the open question the brainstorm flagged).

## Alternative Approaches Considered

| Approach | Why rejected |
|---|---|
| **Standalone `percy storybook-rn --transport=app-automate` CLI runner** | Brainstorm-mentor §1 modified this — customer is QA/SDET integrating into an *existing* Appium test job, not running a Percy-owned standalone command. SDK-as-library is the lower-friction shape. Also, a standalone runner would need to own webdriverio capabilities — duplicating the customer's existing test config. |
| **Reverse BrowserStack Local tunnel to expose device → SDK localhost:7007** | Brainstorm explicitly rejected. BS Local's reverse direction is undertested, BS Local is an extra runtime dep, and it doesn't solve "we already need URL-scheme registration anyway." |
| **WebSocket relay hosted by Percy backend** | Violates the no-backend-changes constraint. |
| **`PercyStorybookRoot` React component** *(parent plan's approach)* | Higher fidelity (no Storybook chrome leakage), but requires customer to wrap their app root + ship a Percy-built shell. Brainstorm-mentor §4 chose pure SDK. The cooperative `PercyStorybookRoot` is deferred to Phase 2 as an opt-in upgrade. |
| **Reuse `localhost:7007` channel server via reverse port-forwarding** | The Storybook RN channel server runs *inside the RN app on the device*. On a BS cloud device, it's not reachable from the SDK. Reverse port-forwarding via `appium:bstack:` capabilities is version-dependent and fragile. Deep-link sidesteps the entire problem. |
| **Deep-link as primary** *(plan-research initial recommendation)* | Reverted on user input 2026-05-08. Deep-link's speed advantage (~500ms vs ~2s) doesn't outweigh the customer-side onboarding cost of registering a URL scheme. Deep-link kept as Phase 2 opt-in for customers willing to make that change for speed. |

## System-Wide Impact

### Interaction Graph

```
Customer's `percy app:exec -- node test.js` invocation
  └─ Percy CLI (1.31+) starts in a child process, listens on :5338
     └─ Customer's test.js process
        └─ `new PercyStorybook()` instantiated
        └─ `percy.provisionApp('./app.apk')`
           └─ POST api-cloud.browserstack.com/app-automate/upload (multipart)
              └─ HTTP 200 → bs://...
        └─ `wdio.remote()` opens session via hub.browserstack.com
           └─ BS allocates real Android device, installs app from bs:// URL
        └─ for each story:
           └─ `percy.snapshotStory(driver, story)`
              └─ Primary (UI-tap): `driver.findElement(byAccessibilityId|byUiAutomator).click()` per nav-tree level
                 └─ Storybook RN navigator state changes; story mounts
              └─ Alternative (Phase 2 deep-link): `driver.executeScript('mobile: deepLink', [...])`
                 └─ Android Intent.ACTION_VIEW with URL scheme
                    └─ App's deep-link handler routes to Storybook RN
                       └─ Storybook reads STORYBOOK_STORY_ID, mounts story
              └─ `driver.pause(renderMs)`
              └─ `percyScreenshot(driver, name)` from @percy/appium-app
                 └─ `driver.takeScreenshot()` → base64 PNG
                 └─ POST :5338/percy/comparison via @percy/sdk-utils
                    └─ Percy CLI buffers
        └─ `driver.deleteSession()` (customer's responsibility, in finally{})
        └─ test.js process exits (success or failure)
     └─ Percy CLI catches process exit, finalizes build via App Percy backend
        └─ Percy build URL printed to stdout
```

**Two-process lifecycle:** the Percy CLI parent process is the build owner; the test.js child process is the snapshot producer. Build finalization happens *because* test.js exits, not because the SDK calls anything.

### Error & Failure Propagation

| Failure point | Class | Propagation | Impact |
|---|---|---|---|
| BS upload 4xx (auth) | `bs_credentials_missing` / `bs_upload_failed` | Synchronous throw in `provisionApp` | Test process exits before driver creation; build is never started. Percy CLI sees empty build. |
| BS upload 5xx (transient) | `bs_upload_failed` | 3× exponential backoff w/ jitter; throws on exhaustion | Reliability review pulled this into Phase 1; uploads are idempotent so retries are textbook-safe. |
| App Automate session never ready (queue exhausted) | webdriverio `remote()` rejection | Customer's existing test framework handles | Build never started. |
| `mobile: deepLink` rejected (e.g., iOS < 16.4) | `deep_link_unsupported_platform` | Synchronous throw on first `snapshotStory` call (deep-link path only) | UI-tap path sidesteps entirely. |
| Story rendered but snapshot blank (URL scheme not registered) | Silent (Phase 1 limitation) | No error; snapshot captured of "wrong" story | False-negative diff. Phase 2 nonce detection closes this gap. |
| `driver.takeScreenshot()` throws | `screenshot_failed` | Per-snapshot; circuit breaker after 3 | Per-snapshot mark failed; continue. |
| `@percy/appium-app` POST to :5338 fails | Bubbles up from `percyScreenshot` | Per-snapshot retry handled by `@percy/appium-app`; if exhausted, throws | Per-snapshot fail. |
| `percy app:exec` Percy CLI crashes mid-run | Test process keeps running, all subsequent `percyScreenshot` calls fail | All remaining snapshots fail. | Build is in unfinalized state. Manual cleanup via Percy dashboard. |

**Key risk:** the silent URL-scheme-not-registered case. Phase 1 docs must call this out as the #1 onboarding pitfall. Recommend: customer manually verifies the first story's snapshot looks correct in the Percy dashboard before automating.

### State Lifecycle Risks

1. **Stale `bs://` references after BS upload TTL expires** (30 days). With `recent_apps` GET pattern, BS itself returns 404 / empty — SDK falls through to fresh upload. No client-side cache to manage.
2. **Half-finalized builds** when the test process is killed mid-run (CI timeout, OOM). Percy CLI's existing handling applies (same as any other Percy SDK).
3. **Dangling App Automate sessions** if customer's `finally { driver.deleteSession() }` is missing. Document the requirement; not the SDK's job to enforce.
4. **`custom_id` collision** (Phase 1, BS-side): `sha256(file).slice(0, 40)` ≠ unique across customers, but BS scopes by account, so collision risk is intra-account only — and only if the customer happens to upload two byte-identical APKs they want to keep separate (unusual). Document as edge case.

### API Surface Parity

| Surface | Local Sim (CLI mode) | App Automate (library mode) | Same? |
|---|---|---|---|
| Snapshot naming | `${componentTitle}/${name}/${deviceLabel}` | `${componentTitle}/${name}/${deviceLabel}` | ✅ |
| Story discovery | `enumerateStories(cwd)` from `.rnstorybook/main.{ts,js}` | Same function, exposed via `percy.discoverStories()` | ✅ |
| Filter syntax | `--include`/`--skip` glob patterns | Customer iterates `discoverStories().filter(...)` themselves | Different shape, same semantic |
| Error codes | Existing set | Existing set + new App Automate codes | Strict superset |
| Snapshot upload | `comparison-poster.postSnapshotComparison` | `@percy/appium-app` `percyScreenshot` | Different libs, same destination (`:5338/percy/comparison`) |
| Configuration | `.percy.yml` | Constructor opts on `PercyStorybook` | Different shape, intentional (library mode is code-driven) |

The two modes are **interoperable**: a customer can run local Sim via CLI for laptop dev and the same `enumerateStories` output drives the library-mode App Automate run in CI.

### Integration Test Scenarios (cross-layer, would not be caught by unit tests)

1. **Real BS Android upload + session + deep-link round-trip.** Run from a Linux runner, no local Mac. Asserts: bs:// returned, session opens, story navigated, snapshot uploaded, build finalized.
2. **Same `.apk` uploaded twice in one CI run.** Asserts second `provisionApp` hits the `recent_apps` GET path and skips multipart upload. Validates the `custom_id` round-trip against real BS API.
3. **Customer test cleanup path: `finally { driver.deleteSession() }`.** Asserts CI-side test framework's teardown still works with library SDK.
4. **`percy app:exec` wrapper outside vs inside.** Run with and without `percy exec` to confirm `@percy/sdk-utils.isPercyEnabled()` returns true only inside.
5. **URL scheme not registered in app.** Manually break the customer fixture's `app.json`; assert snapshots are visually identical (capturing the "false negative" failure mode for documentation purposes).

## Acceptance Criteria

### Functional

- [ ] `import { PercyStorybook } from '@percy/storybook-react-native'` resolves and exports a constructor.
- [ ] `provisionApp('./local.apk')` with valid `BROWSERSTACK_USERNAME`/`BROWSERSTACK_ACCESS_KEY` returns a `bs://...` reference.
- [ ] `useAppReference('bs://abc')` accepts and returns the same reference back via `getAppReference()` (small inspector method for tests).
- [ ] `discoverStories()` returns the same `StoryDescriptor[]` as the CLI mode's `enumerateStories(process.cwd())` for the same project.
- [ ] `snapshotStory(driver, descriptor)` invoked under `percy app:exec` produces one snapshot in the resulting Percy build, named `${componentTitle}/${name}/${deviceLabel}`.
- [ ] Transport auto-detected: `bstack:options` cap → app-automate; absence → local. Verified via mock-driver fixtures.
- [ ] Test process exit triggers Percy CLI build finalize without explicit `percy.finalize()`.
- [ ] One end-to-end Linux-runner CI job in `examples/RNStorybookFixture/app-automate/` produces a valid Percy build.

### Non-Functional

- [ ] Per-story end-to-end (deep-link issue → snapshot uploaded) ≤ 2× the local-Sim baseline measured under PER-7859. (Spike measured ~500ms/story for deep-link alone; expect ~3-5s/story including screenshot + upload.)
- [ ] BS upload completes in < 60s for a typical 50 MB Storybook `.apk`. (No SLA — surfaced in error if it exceeds.)
- [ ] No new dependencies beyond `@percy/appium-app` peer. (Reuse Node 18+ native `fetch`/`FormData`.)

### Quality Gates

- [ ] All new modules covered by vitest unit tests; existing tests still pass (`npm test` from `packages/storybook-react-native/` exits 0).
- [ ] One integration test executes against a live BS Android device. **Schedule** (testing review #9): runs nightly against pinned Storybook RN version, on every release tag, AND on every PR that touches `story-navigator.js`. Manual-trigger alone is insufficient given documented selector-stability risk.
- [ ] Documentation: `SETUP.md` extended, new `STORYBOOK_HOST_APP.md`, reference example repo updated.
- [ ] `RNStorybookSnapshotCaptured` event emitted in production with valid `transport`, `bs_session_id` (when applicable), `result`, `duration_ms`.

## Success Metrics

Per the brainstorm origin (§3 *origin*: docs/brainstorms/2026-05-08-app-automate-storybook-rn-requirements.md), no numerical targets at MVP. Qualitative signals only:

- **Feasibility:** one end-to-end run from Linux CI against a real BS Android device — passing.
- **Engineering parity:** library-mode and CLI-mode share `story-enumerator.js`, `errors.js`, snapshot-naming convention.
- **Adoption (post-PoC):** at least one design-partner customer (existing Percy + web Storybook user) integrates the library-mode flow into their App Automate CI.

Numerical targets revisited post-launch when shipping data exists.

## Dependencies & Prerequisites

### Runtime

- Node 18+ (for native `fetch` / `FormData`)
- `webdriverio` (peer; existing dep at v9)
- `@percy/cli` ≥ 1.31 (for `percy app:exec` build lifecycle)
- `@percy/appium-app` ≥ 2.1 (peer; new)
- `@percy/sdk-utils` (existing internal dep)

### Customer-side

- BrowserStack App Automate plan with active `BROWSERSTACK_USERNAME`/`BROWSERSTACK_ACCESS_KEY`
- Storybook-enabled `.apk` distinct from production app (covered by parent plan; new doc `STORYBOOK_HOST_APP.md`)
- URL scheme registered in `app.json` (Expo) or `AndroidManifest.xml` (bare RN)
- `@storybook/react-native` v9.x installed in the customer's RN app

### Codebase

- PER-7859 in code review; this plan does not block on its merge but assumes its module structure (the existing `src/` layout shipping in `0.1.0-alpha.0`).

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Storybook RN's in-app navigator lacks stable testIDs / a11y labels in v10.3.2 | Medium | High — invalidates UI-tap primary | **Verify in Phase 1 PoC.** Empirically inspect navigator hierarchy via Appium Inspector; document the resilient selector path. If unworkable, trip the §16.1 revisit gate. |
| Storybook RN's `STORYBOOK_STORY_ID` URL parameter not present in v10.3.2 (deep-link Phase 2) | Low | High — invalidates deep-link branch | **Verify in Phase 2 PoC.** Spike used v9.x. Diff the constants file across versions. |
| Storybook RN v10 ships TWO UI packages (`react-native-ui-lite` vs `react-native-ui` full); selector availability differs | Medium | Medium — UI-tap cascade must branch | Plan-level UI-package detection in `story-navigator.js` (try lite-style testID first; fall through to text-based detection). Document customer guidance on which package to use. |
| v10 tree leaves and component groups have no testID and no a11y label | High | High — UI-tap reduces to text-match for tree nodes | This is the load-bearing fragility. Mitigation: stable text from CSF (component title + story name). Phase 1 PoC must capture an Appium element-tree fixture per Storybook RN minor version and gate releases on fixture-driven tests passing. |
| Customer using deep-link forgets URL scheme registration | High (in deep-link path) | Medium — silent false-negative diffs | Phase 2 nonce detection. UI-tap primary path sidesteps this entirely. |
| BS upload size limit hit (>1.5GB) | Low | Medium — `provisionApp` fails | Document limit; suggest stripping unneeded native modules from Storybook host app. |
| BS session-time limit hit on >200-story runs | Medium (per brainstorm Q4) | Medium — partial run | Phase 3 session-chunking helper. MVP: document the limit; suggest `--include` filtering. |
| `mobile: deepLink` API changes in newer Appium versions | Low | Low — well-established W3C extension | Pin webdriverio peer ≥ 9; document tested Appium versions. |
| `@percy/appium-app` peer mismatch with `@percy/cli` | Low (both Percy-owned) | Medium — version drift | Pin `^2.1.0` peer; add CI matrix test on min/max supported. |
| Race: `provisionApp` returning before BS finishes app processing | Low | Medium — first session fails to install | Phase 1 ships a defensive 5s post-upload pause. Phase 1 PoC measures empirically; if always ready, drop the pause. If not, replace with `recent_apps` poll (Phase 2). |
| UI-tap primary fails PoC viability gates (selector instability or >5s/story latency) | Medium | High — primary path invalid; deep-link becomes mandatory default | Phase 1 PoC measures both. Documented revisit gate in Open Q §16.1. |

## Resource Requirements

- 1 builder (Aryan Kumar) — already context-loaded.
- ~1.5 weeks of focused work for Phase 1 (estimate based on parent plan's complexity vs this plan's smaller scope: ~half the surface area, no backend, no UI).
- BrowserStack App Automate sandbox account for integration tests.
- 1 Storybook host `.apk` from the existing `examples/RNStorybookFixture/` (already produced under PER-7859; needs URL scheme added).

## Future Considerations

- **iOS Phase 2** is the largest single chunk left. iOS distribution signing is the documented onboarding cliff.
- **Optional `PercyStorybookRoot` React component** (parent plan's higher-fidelity approach) becomes a Phase 2 opt-in for customers who want to strip Storybook UI chrome from snapshots.
- **Upstream contribution** of Storybook iteration logic into `@percy/appium-app` (or `percy-appium-js`) — the brainstorm's open question. Direction depends on which SDK family more customers gravitate toward.
- **Maestro-based runner** as an alternative to Appium — parent plan §17.10 already abstracts this via `StoryRunner` interface; library mode could similarly accept any Appium-compatible driver shape.

## Documentation Plan

- [ ] `packages/storybook-react-native/SETUP.md` — add "Library mode (App Automate)" section after the existing CLI section.
- [ ] `packages/storybook-react-native/README.md` — high-level "two ways to use this SDK" diagram.
- [ ] **NEW** `packages/storybook-react-native/STORYBOOK_HOST_APP.md` — companion guide on building a Storybook-enabled `.apk` distinct from production app + URL scheme registration walkthrough (Expo + bare RN sections).
- [ ] **NEW** `packages/storybook-react-native/APP_AUTOMATE.md` — App Automate-specific walkthrough: env vars, capabilities, troubleshooting (URL-scheme silent failure, session timeouts).
- [ ] `examples/RNStorybookFixture/app-automate/README.md` — tutorial mirroring `spike-storybook-app-percy/README.md` but using the new SDK.
- [ ] Confluence page — public-facing "Percy + App Automate for native RN component testing" (post-PoC; cross-team need, owned by Docs team).

## Open Questions

| # | Topic | Question | Owner | Blocks? |
|---|---|---|---|---|
| 1 | **Navigation strategy revisit gate** | UI-tap is the user-confirmed primary. Revisit and switch to deep-link as default if Phase 1 PoC shows: (a) Storybook RN navigator lacks stable testIDs/a11y labels making UI-tap unworkable, OR (b) per-story latency exceeds 5s/story (>2× projection). Until either trips, UI-tap stays primary. | Builder (PoC measurement) | No — implementation can start. |
| 2 | `@percy/appium-app` integration shape | Peer dep + delegate to `percyScreenshot()` (this plan's choice), or implement `comparison-poster`-style POST directly? Plan chose peer for option-surface parity; verify `@percy/appium-app` v2.1 doesn't have option mismatches that surprise us. | Builder | No — can start with peer; switch if issues. |
| 3 | Storybook RN version compat | Spike used v9.x; PER-7859 validated v10.3.2. Confirm `STORYBOOK_STORY_ID` constant is identical across both. | Builder (Phase 1 PoC) | No |
| 4 | BS upload de-dup behavior | Verify `recent_apps/{custom_id}` returns the prior `bs://` for an identical content-hash custom_id. If not, fall back to client-side cache. | Builder (Phase 1 PoC, ~30 min experiment) | No |
| 9 | BS upload-to-install delay | Is `bs://` install-ready immediately after `POST /upload` returns 200, or is a delay needed? Determines whether the defensive 5s post-upload pause stays or gets replaced with `recent_apps` polling. | Builder (Phase 1 PoC) | No |
| 10 | Storybook RN UI-package detection | Empirically determine the most reliable signal for distinguishing `react-native-ui-lite` from `react-native-ui` (full) at runtime via Appium element queries. Probe order documented above is a starting point. | Builder (Phase 1 PoC) | No |
| 11 | `freezeAnimatedImage` interaction | Does `@percy/appium-app`'s `freezeAnimatedImage: true` actually halt animations *before* our screenshot-stability poll runs? Sequencing matters — if it freezes only at capture time, our stability poll may still flake on animated content. | Builder (Phase 1 PoC) | No |
| 12 | BS quota error code shape | Capture the exact `wdio.remote()` rejection shape when an account hits parallel-session quota; map to `bs_quota_exhausted` with a stable matcher. | Builder (Phase 1 PoC) | No |
| 5 | Per-story latency on remote BS | Within 2× local-Sim baseline? | Builder (Phase 1 PoC) | No |
| 6 | App Automate session time limits | Does a 200+ story run hit BS session limit? | Builder (Phase 1 PoC) | No |
| 7 | URL scheme silent failure detection | Phase 1 has no detection. Acceptable, or should we ship a minimal cooperative addon in Phase 1? | Builder + Docs | No (Phase 1 documented as known limitation) |
| 8 | App Automate cost forecast | Forecast session-minute consumption per design-partner library size. | Builder + PMM | No (Phase 2 gate) |

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-05-08-app-automate-storybook-rn-requirements.md](../brainstorms/2026-05-08-app-automate-storybook-rn-requirements.md) — Key decisions carried forward: SDK-as-library architecture, transport auto-detection, no backend changes, single `RNStorybookSnapshotCaptured` event, defer iOS to Phase 2.

### Internal

- **Parent plan:** [docs/plans/2026-04-24-001-feat-react-native-storybook-app-percy-plan.md](2026-04-24-001-feat-react-native-storybook-app-percy-plan.md) — particularly Enhancement Summary §17.3 (iOS deep-link gap), §17.4 (error classification + circuit breaker), §17.5 (nonced deep links), §17.10 (StoryRunner abstraction).
- **Spike:** `/Users/aryankumar/Desktop/Percy/spike-storybook-app-percy/` — particularly `tests/android.ts:75` (deep-link URL builder), `scripts/upload-apk.ts:38` (BS multipart upload), `README.md:194` ("Why deep-link navigation vs UI tapping" comparison).
- **Existing local-Sim SDK:** `Percy-react-native-support/packages/storybook-react-native/src/` — particularly `runner.js:74` (current channel-based flow), `appium-client.js:75` (cap key prefix handling), `story-enumerator.js:269` (canonical CSF ID generation), `comparison-poster.js:50` (Percy CLI POST primitive).
- **Parent ticket:** [PER-7859](https://browserstack.atlassian.net/browse/PER-7859)
- **Parent task brief:** [Confluence](https://browserstack.atlassian.net/wiki/spaces/PER/pages/6168216344/)

### External

- **Storybook RN `STORYBOOK_STORY_ID` constant:** [github.com/storybookjs/react-native/packages/react-native/src/constants.ts](https://github.com/storybookjs/react-native/blob/main/packages/react-native/src/constants.ts)
- **Storybook RN deep-link example:** [github.com/storybookjs/react-native/examples/expo-example/README.md](https://github.com/storybookjs/react-native/blob/main/examples/expo-example/README.md)
- **`@percy/appium-app` SDK:** [github.com/percy/percy-appium-js](https://github.com/percy/percy-appium-js) — public API: `percyScreenshot(driver, name, options?)`. No explicit finalize. Auto-finalizes via `percy app:exec`.
- **`@percy/appium-app` Java equivalent:** [github.com/percy/percy-appium-app](https://github.com/percy/percy-appium-app) — reference for finalization semantics.
- **BS App Automate Appium docs:** [browserstack.com/docs/app-automate/appium](https://www.browserstack.com/docs/app-automate/appium) — capabilities, upload API.
- **BS App Automate upload API:** `POST https://api-cloud.browserstack.com/app-automate/upload` with multipart `file=@...` or `url=...` form, Basic auth, returns `{app_url: "bs://..."}`.
- **Percy Appium Java example:** [github.com/percy/example-percy-appium-java](https://github.com/percy/example-percy-appium-java) — pattern this plan's customer-facing flow mirrors.

### Related Work

- **PER-7859** — local-Sim Storybook-RN MVP, currently in code review.
- **PAPP-574** — anchor ticket for parent plan's broader RN component testing initiative.
- **PAPP-573, PER-6986** — related App Percy tickets in the parent plan's tracking.

## Decisions Log

| Decision | Source | Status | Notes |
|---|---|---|---|
| SDK-as-library, not standalone CLI for App Automate | Brainstorm Lens 1 | ✅ Confirmed | Customer composes inside their existing Appium test job. |
| Transport auto-detect from `bstack:options` capability | Brainstorm Lens 4 | ✅ Confirmed | No flag, no config. |
| `provisionApp` + `useAppReference` (both supported) | Brainstorm Lens 7 | ✅ Confirmed | DX default + escape hatch. |
| `discoverStories` + explicit-array (both supported) | Brainstorm Lens 7 | ✅ Confirmed | Reuses existing CLI-mode `enumerateStories` internally. |
| No explicit `finalize()` | Brainstorm Lens 7 + spike + `@percy/appium-app` research | ✅ Confirmed | Mirror `@percy/appium-app` — auto-finalize via `percy app:exec`. |
| Single instrumentation event `RNStorybookSnapshotCaptured` | Brainstorm Lens 5 | ✅ Confirmed | Transport inferred at call time. |
| Pure consolidation pitch (no iOS-CI-Linux headline) | Brainstorm Lens 3 | ✅ Confirmed | Buying motion = "we already use Percy + web Storybook." |
| Storybook host app is separate from production app | Brainstorm Lens 6 | ✅ Confirmed | Companion docs (new `STORYBOOK_HOST_APP.md`) call this out. |
| Android-first MVP; defer iOS | User decision | ✅ Confirmed | iOS distribution-signing is its own scope. |
| **Story navigation: UI-tap on Storybook RN's in-app navigator** | User decision 2026-05-08 (after deep-link tradeoff review) | ✅ Confirmed | Zero customer-side code/config changes outside the test file. ~150-300s overhead vs deep-link on a 100-200 story library is acceptable; UX-burden saving outweighs the speed cost. Deep-link kept as Phase 2 opt-in for customers willing to register a URL scheme. |
| Delegate `snapshotStory` capture to `@percy/appium-app` | Plan research | ✅ Adopted | Peer dependency; reuses option surface (percyCSS, freeze, etc.). |
| App-hash cache replaced with BS `custom_id` + `recent_apps` GET pattern | Framework-docs research (BS API) | ✅ Adopted | No client-side cache file needed. BS itself provides server-side dedup via custom_id. ~40 lines of plan deleted. |
| API converted from class to functional exports | api-contract reviewer | ✅ Adopted | Mirrors `@percy/appium-app`'s `percyScreenshot(driver, name, options)` precedent; eliminates stale-state risk across driver lifecycles. Optional `createPercyStorybook(opts)` factory preserves shared-opts ergonomics. |
| `peerDependenciesMeta: { '@percy/appium-app': { optional: true } }` | api-contract reviewer | ✅ Adopted | Existing `0.1.0` CLI-only consumers don't see install-time breakage. |
| Peer range tightened from `^2.1.0` to `~2.1.0` | api-contract reviewer | ✅ Adopted | Patch-only until automated CI matrix exists. |
| BS upload retry (3× exponential backoff on 5xx) + 120s timeout in Phase 1 | reliability reviewer | ✅ Adopted | Single transient 502 should not kill a CI run. |
| Render-ready signal hardened: global per-story budget, max stability attempts, downsampled-grayscale SHA-1, forced settle delay before first capture | reliability + correctness reviewers | ✅ Adopted | Closes indefinite-hang and stale-frame-as-stable bugs. |
| Tap-path cache scoped per-driver via WeakMap; opt-in (not default) | correctness + simplicity reviewers | ✅ Adopted | Eliminates cross-driver state corruption while preserving optimization for power users. |
| `coldBootMs` fixed-sleep replaced with poll-for-ready (`coldBootMaxMs` ceiling) | reliability reviewer | ✅ Adopted | Correctness on slow BS devices; speed on fast ones. |
| Circuit breaker gains second dimension (cumulative failure rate) | reliability reviewer | ✅ Adopted | Catches the 30%-flake regime that streak-only blind-spots. |
| `snapshotStory` rejects descriptors missing `componentTitle`/`name` (no fallback to `id`) | api-contract reviewer | ✅ Adopted | Prevents snapshot-name divergence between CLI mode and library mode. |
| `runSession(driver, fn)` helper added | reliability reviewer | ✅ Adopted | Reduces dangling-session waste from missing `finally{}` blocks. |
| Storybook RN UI-package detection (lite vs full) | best-practices research | ✅ Adopted | v10 has two parallel UI packages with different a11y prop coverage; selector cascade must branch. |
| Element-tree fixture-driven tests | testing reviewer | ✅ Adopted | Single test that catches upstream Storybook RN navigator drift between releases. |
| Live integration test scheduled nightly + release-tag + on `story-navigator.js` PRs (not manual-only) | testing reviewer | ✅ Adopted | Manual-trigger insufficient given documented selector-stability risk. |
| Phase 1.5 sub-tier dropped; folded into Phase 2 | simplicity reviewer | ✅ Adopted | Two phases is enough; sub-tier added tracking overhead with no payoff. |
| **Architecture aligned to `percy-appium-js` patterns** (provider-resolver, single primary fn export + named helpers, percy/ subdir layout, driver wrapper, metadata resolver) | User directive 2026-05-08 | ✅ Adopted | "Follow percy-appium-js patterns for dev and run for app automate as well — we need everything like this." Architecture is now percy-family-conformant. |
| **Example repo structure mirrors `example-percy-appium-js`** (`webdriverio/{android,ios}/<conf+specs>` + `resources/` + `scripts/upload-apk.ts` + tutorial-style README) | User directive 2026-05-08 | ✅ Adopted | Same shape as the upstream Appium example so customers familiar with `@percy/appium-app` find immediate parity. |
| Test framework stays vitest (not jasmine) | Plan analysis | ✏️ Deliberate deviation | percy-appium-js uses jasmine; PER-7859 uses vitest. Don't run two test frameworks in one package. *Patterns* mirror percy-appium-js; *runner* differs. |
| Module syntax stays ESM (not CommonJS) | Plan analysis | ✏️ Deliberate deviation | percy-appium-js is CJS; PER-7859 is ESM. Converting would break PER-7859 mid-review. ESM-equivalents of patterns work fine. |
| Use existing `enumerateStories` (regex-based) instead of `@storybook/csf-tools` | Plan research | ✅ Adopted | Already works, already produces canonical CSF IDs, no new dep. |
| Circuit breaker on 3 consecutive same-class failures | Inherited from parent plan §17.4 | ✅ Adopted | Avoid 200-story death spirals on deterministic failures. |

---

**Plan written:** 2026-05-08 (auto mode, ultrathink invoked)
**Plan revised:** 2026-05-08 (course correction — UI-tap reinstated as primary; deep-link demoted to Phase 2 opt-in)
**Plan deepened:** 2026-05-08 (7 parallel agents — best-practices, framework-docs, api-contract, reliability, correctness, testing, simplicity. See "Enhancement Summary" at top.)
**Plan conformed to percy-appium-js:** 2026-05-08 (provider-resolver pattern, percy/ subdir layout, single primary fn + named helpers, example-repo shape mirrored from `example-percy-appium-js`. See "Conformance" section after Enhancement Summary.)
**Status:** ready for `/ce:work`. No blocking open questions; Phase 1 PoC measures the revisit gate (§16.1).
