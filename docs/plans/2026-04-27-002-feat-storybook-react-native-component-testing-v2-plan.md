---
title: "@percy/storybook-react-native — v2 (Appium + Local Emulator)"
type: feat
status: active
date: 2026-04-27
supersedes: docs/plans/2026-04-27-001-feat-storybook-react-native-component-testing-plan.md
origin: https://browserstack.atlassian.net/wiki/spaces/PER/pages/6168216344/Task+Brief+React+Native+Component+Testing+Support+in+App+Percy
---

# @percy/storybook-react-native — v2 (Appium + Local Emulator)

## Why v2

The v1 plan assumed a Percy-built native shell distributed to BrowserStack devices, customer JS bundle injected at runtime, signed `.ipa`/`.apk`, HSM key management, multi-tenant isolation. **Course-corrected after research validated:** Percy's existing Appium SDK already supports any Appium session (BrowserStack OR local emulator) via `GenericProvider`, screenshot+upload already works through `:5338/percy/comparison`, and Chromatic's only RN path is RN-Web (a web approximation). The differentiated wedge is **BYO emulator + Appium driver + Storybook RN's port-7007 WebSocket** — no shell, no signing, no backend changes, ~4–6 weeks instead of 4–5 months.

v1 stays on disk as research record. **This v2 plan is the source of truth for execution.**

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Customer machine / CI runner                                       │
│                                                                     │
│  ┌────────────────────────────┐   ┌────────────────────────────┐    │
│  │ Customer's RN app          │   │ Local Appium server         │   │
│  │ + @storybook/react-native  │ ← │ (npm i -g appium)           │   │
│  │ + (optional) Percy addon   │   │ Driver: appium-uiautomator2 │   │
│  │ Running on Android         │   │       / appium-xcuitest     │   │
│  │ Emulator OR iOS Simulator  │   └────────────┬───────────────┘    │
│  └────────────┬───────────────┘                │                    │
│               │ adb reverse tcp:7007           │                    │
│               │ (or iproxy for iOS)            │                    │
│               ▼                                ▼                    │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  @percy/storybook-react-native (NEW SDK — this plan)         │   │
│  │  - Connects to Appium session                                │   │
│  │  - Connects to Storybook RN WebSocket :7007                  │   │
│  │  - Per story: setCurrentStory → wait ready → screenshot      │   │
│  │  - POSTs to localhost:5338/percy/comparison                  │   │
│  └────────────────────────┬─────────────────────────────────────┘   │
│                           ▼                                         │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │ @percy/cli (existing, unchanged)                             │   │
│  │ Receives /percy/comparison → uploads to Percy backend        │   │
│  └────────────────────────┬─────────────────────────────────────┘   │
└───────────────────────────┼─────────────────────────────────────────┘
                            ▼
       Existing Percy build / diff / dashboard (no changes)
```

## Components (3 — net-new code is just one)

### 1. `@percy/storybook-react-native` (NEW npm package)

**This is the entire deliverable.** A Percy CLI plugin built with `@percy/cli-command`. Mirrors `@percy/appium-app`'s upload pipeline pattern. ~1500–3000 lines of TypeScript expected.

**CLI surface:**
- `npx percy storybook-rn` — primary command. Connects to Appium session, iterates stories via WebSocket, screenshots each, uploads via `:5338/percy/comparison`.
- `npx percy storybook-rn --include="Button/*"` — filter by story name pattern.
- `npx percy storybook-rn doctor` — local-only validation: Appium reachable? Storybook WebSocket reachable on :7007? `PERCY_TOKEN` set? `@percy/cli` running?
- `npx @percy/storybook-react-native init` — drops `.percy.yml` with default `storybook-rn:` block, prints copy-paste snippet for the optional Percy addon, drops a sample `Button.stories.tsx` if the project has none.

**Config (`.percy.yml`):**
```yaml
storybook-rn:
  appium:
    server: http://localhost:4723         # default; overridable for self-hosted grids
    capabilities:                         # passed verbatim to Appium
      platformName: Android
      appPackage: com.customerapp
      appActivity: .MainActivity
  storybook:
    websocketPort: 7007                   # default
    waitForReadyMs: 1000                  # default; ignored if Percy addon installed
  include: ["**/*"]                       # glob filter
  skip: []
```

**Internals (high-level modules):**
- `appium-client.ts` — wraps `webdriverio` or `@wdio/cli` to connect to an Appium session, exposes `takeScreenshot()`.
- `storybook-ws.ts` — connects to `ws://localhost:7007`; sends `{ type: 'setCurrentStory', args: [{ storyId }] }`; listens for `percy:ready` events from the optional addon (or falls back to `waitForReadyMs` timer).
- `story-enumerator.ts` — reads Storybook RN config or queries the device's running Storybook for the story list (likely the latter, since stories live on-device).
- `runner.ts` — main loop: for each story, navigate → wait → screenshot → post comparison.
- `comparison-poster.ts` — wraps `@percy/sdk-utils` `postComparison` (existing primitive).
- `commands/` — Percy CLI plugin command registrations.

### 2. `@percy/storybook-react-native-addon` (NEW, OPTIONAL Storybook addon)

Tiny companion package the customer adds to their Storybook RN preview config. Registers a decorator that emits `{ type: 'percy:ready', storyId }` over Storybook RN's existing WebSocket once a story has rendered + idled. Without this, the SDK falls back to a configurable time-based wait (`waitForReadyMs`).

**Why optional:** the SDK works without it (time-based wait); customers who care about deterministic timing add it. Same pattern as `@percy/storybook` web addon.

### 3. Documentation + reference example repo

- Customer-facing docs page: setup walkthrough + CLI reference + troubleshooting.
- Public GitHub repo `percy/example-percy-storybook-react-native` — minimal RN app with Storybook + Percy already wired. `git clone && npm install && npm run percy:test` → working Percy build.

## Implementation Plan (single phase, ~4–6 weeks, 1 engineer)

### Week 1 — Skeleton + happy-path proof

- Scaffold npm package: TypeScript + Vitest + `@percy/cli-command` plugin metadata
- Implement `appium-client.ts` (wraps `webdriverio`)
- Implement `storybook-ws.ts` minimal client (connect, `setCurrentStory`, listen)
- Hardcoded one-story end-to-end smoke: connect to a fixture RN+Storybook app on a local Android emulator, switch to one story, screenshot, log it
- **Milestone:** screenshot taken from emulator, written to disk locally

### Week 2 — Percy upload + multi-story loop

- Wire `@percy/sdk-utils` `postComparison` into the runner
- Implement story enumeration (query Storybook RN's running instance for story list via the WebSocket — verify the protocol message)
- Per-story loop: setCurrentStory → wait → screenshot → postComparison
- Time-based wait (`waitForReadyMs` default 1000ms) as the ready-signal default
- Run end-to-end against the local emulator + `@percy/cli` running locally; confirm a Percy build appears in the dashboard with all stories
- **Milestone:** first green Percy build from a real device emulator with real stories

### Week 3 — Optional addon + iOS Simulator support

- Build `@percy/storybook-react-native-addon`: tiny decorator that emits `percy:ready` over the same WebSocket
- SDK detects addon's ready signal and short-circuits the time-based wait
- Test on iOS Simulator (verify no Android-specific assumptions in `appium-client` or port-forward logic)
- Per-platform: confirm `iproxy` (or Appium's auto-port-forward via `mjpegServerPort` capability) handles iOS port forwarding
- **Milestone:** addon-driven deterministic ready signal proven; iOS Simulator path proven

### Week 4 — CLI ergonomics + `init` + `doctor`

- `init` command: scaffold `.percy.yml`, print copy-paste addon snippet, optionally drop sample story
- `doctor` command: pre-flight checks (Appium reachable, WebSocket reachable, token set, CLI running) with clear actionable error messages
- `--include` filter at story-enumeration stage
- Live progress tail in CLI logs (per-story status, append-only CI-safe format)
- Error catalog: 6–8 named error codes with full message bodies

### Week 5 — Documentation + reference repo + dogfood

- Write customer-facing docs (setup + reference + troubleshooting)
- Publish `percy/example-percy-storybook-react-native` reference repo (workspace in SDK monorepo or git submodule; CI verifies it on every SDK PR)
- Internal dogfood on at least one Percy team's RN testbed
- Iterate on error messages, addon snippet, docs based on dogfood feedback

### Week 6 — Beta release + first external customer

- Publish `@percy/storybook-react-native@0.1.0-beta` to npm
- Onboard one design-partner customer with hands-on integration support
- Iterate on whatever breaks
- **MVP gate:** customer integrates self-serve from public docs, runs ≥10 builds over ≥1 week, zero synchronous engineer assistance.

## Acceptance Criteria

- [ ] `npx percy storybook-rn` against a running Android emulator + Appium server + customer RN app with Storybook produces a Percy build with one snapshot per story.
- [ ] Same against an iOS Simulator.
- [ ] `npx percy storybook-rn doctor` runs all preflight checks; clear actionable errors on each failure mode.
- [ ] `npx @percy/storybook-react-native init` drops `.percy.yml`, prints addon snippet, drops sample story if needed.
- [ ] `--include="Pattern/*"` filter applied at enumeration stage.
- [ ] Live progress tail readable in Buildkite, GitHub Actions, CircleCI logs.
- [ ] Optional `@percy/storybook-react-native-addon` provides deterministic ready signal; SDK degrades cleanly to time-based wait when addon absent.
- [ ] Story enumeration handles default Storybook RN config (`.storybook/main.{js,ts}` and on-device story registry).
- [ ] Snapshot naming: `{Component}/{Story}/{DeviceLabel}` (Component first → alphabetical sort groups by component in existing flat dashboard view; iOS+Android of same story sort adjacently).
- [ ] Comparison upload via `localhost:5338/percy/comparison` (same path `@percy/appium-app` uses; no new backend code).
- [ ] Reference example repo: clone → `npm install` → `npm run percy:test` → green Percy build, no edits.
- [ ] Documentation: setup walkthrough + CLI reference + troubleshooting page published.
- [ ] One external customer hits the MVP gate.

**Non-functional:**
- [ ] CLI overhead (Appium connect + story enumeration + WebSocket connect): ≤30s.
- [ ] Per-story wall-clock (setCurrentStory → ready signal → screenshot → upload): ≤4s P75 (deterministic ready signal). ≤6s P75 (time-based wait fallback).
- [ ] **Zero new permissions or backend schema changes.** Pure SDK addition.
- [ ] **Zero net-new infrastructure.** No HSM, no signing, no shell repo, no Buildkite pipeline, no schema migration, no orchestrator.

## Risks (the short list — most v1 risks evaporated)

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| **R1**: Storybook RN's WebSocket protocol changes between minor versions | Medium | Medium | Pin Storybook RN version range in `peerDependencies`; integration test against the lowest+highest supported versions in CI |
| **R2**: Story enumeration is brittle across Storybook RN config formats (JS/TS/ESM/CJS) and on-device-vs-config-file approaches | Medium | Medium | Prefer querying the on-device Storybook (single source of truth at runtime) over parsing config files; fixture tests across config formats |
| **R3**: Time-based ready-signal wait causes flakiness for slow-rendering stories without the addon | High | Low | Configurable `waitForReadyMs`; clear docs recommending the addon for production CI; surface flakiness as `percy storybook-rn doctor --diagnose-flake` (post-MVP) |
| **R4**: Customer's Appium setup varies (server URL, capabilities, driver) — high integration friction | High | Medium | Pass Appium capabilities through verbatim from `.percy.yml`; ship the reference example repo as a copy-paste starting point; `doctor` command surfaces config issues clearly |
| **R5**: Reference example repo bit-rots vs SDK API changes | Medium | Medium | Reference repo as workspace in SDK monorepo (or submodule), exercised by SDK CI on every PR; daily smoke-test with visible README badge |
| **R6**: Storybook 9/10 web-RN parallel mode (`@storybook/react-native-web-vite`) tempts customers to use Percy Web instead, eroding our differentiation | Medium | Low | Documentation explicitly contrasts native fidelity vs RN-Web. RN-Web is a fine choice for some customers — we don't need to win 100%. |
| **R7**: New Architecture (Fabric) compat — third-party native module fragmentation in customer apps | Low | Low | Customer's app is the host; we don't constrain their native modules. Only constraint: Storybook RN must run. Defer to Storybook RN's own compat matrix. |

**Eliminated from v1:** code signing, HSM, multi-tenant isolation, JS bundle hijack, marker spoofing, capability sandbox, App Store distribution, device-pool capacity, schema migration risk, shell version manifest maintenance, native module manifest growth, signing key rotation, Apple Developer Enterprise Program — all not applicable to this architecture.

## Open Questions (resolve during execution)

1. **Story list source of truth:** parse `.storybook/main.{js,ts}` (config file) or query the on-device running Storybook (likely via WebSocket message). Recommendation: on-device, since `@storybook/react-native` v9 builds the registry at app boot — config-file parsing duplicates that work. Verify the WebSocket exposes a list-stories message; if not, contribute upstream or fall back to file parsing.
2. **Multi-platform single run:** `npx percy storybook-rn` against one Appium session = one platform. Should the SDK orchestrate two sessions (Android + iOS) sequentially in one command, or is the customer expected to run twice (once per platform)? **MVP recommendation:** one session per command; customer scripts both. Multi-session orchestration is a fast-follow.
3. **Storybook RN v9 vs v10 protocol differences:** v10.2 adds `experimental_mcp` HTTP endpoint; v9 uses pure WebSocket. Pin compat to v9.1+ initially; revisit v10 once it stabilizes.

## Local Development & Testing — How to Test the Code You'll Build

This section is the answer to "how do I test our code." Once the SDK skeleton exists, this is the loop you run on your laptop to validate every change.

### One-time setup

**Recommended week-1 path on Mac: iOS Simulator only.** Add Android once iOS produces a green Percy build end-to-end (saves ~6GB of Android Studio install + a chunk of setup time during the initial dev loop).

```bash
# 1. Node 18+
node --version

# 2. Xcode → iOS Simulator (macOS only)
xcode-select --install
# Open Xcode once from /Applications to accept license + install Command Line Tools

# 3. Appium 2.x + iOS driver
npm install -g appium@2
appium driver install xcuitest

# 4. Percy CLI
npm install -g @percy/cli

# 5. Percy token (free Percy account)
export PERCY_TOKEN="web_xxxxxxxxxx"
```

**Adding Android later:** install Android Studio (or `brew install --cask android-commandlinetools` for a lighter footprint), then `appium driver install uiautomator2`. Android also needs `adb reverse tcp:7007 tcp:7007` to expose the Storybook WebSocket — iOS doesn't (xcuitest handles localhost forwarding automatically).

### The fixture RN app (your testbed)

Set up once; reuse forever. This is also what becomes the public reference example repo.

```bash
# Inside the SDK monorepo, create an examples/ workspace
npx @react-native-community/cli init RNStorybookFixture --version 0.76 --skip-install
cd examples/RNStorybookFixture

# Add Storybook RN
npx storybook@latest add @storybook/react-native

# Write 3–4 sample stories (Button.stories.tsx, Card.stories.tsx, etc.)

# Build + install on emulator
npm run android        # for Android emulator
npm run ios            # for iOS simulator

# Forward Storybook's WebSocket port (Android only)
adb reverse tcp:7007 tcp:7007
```

### The dev loop (every change)

```bash
# Terminal 1: emulator/simulator running with the fixture app loaded into Storybook mode

# Terminal 2: Appium server
appium

# Terminal 3: Percy CLI (running for the duration of testing)
percy exec -- sleep infinity   # keeps the local :5338 server alive
# Or use percy exec wrapping your test command directly

# Terminal 4: run the SDK against the fixture
cd examples/RNStorybookFixture
npx percy storybook-rn          # ← this is the SDK code you wrote
```

### What to verify

| Layer | How |
|---|---|
| **Appium connection** | `npx percy storybook-rn doctor` — should print "Appium reachable" |
| **Storybook WebSocket** | `doctor` prints "Storybook WS reachable on :7007" |
| **Story enumeration** | `--dry-run` config flag prints the discovered story list — verify it matches your `.stories.tsx` files |
| **Story navigation** | Watch the emulator screen — stories should switch as the SDK iterates |
| **Screenshot capture** | Set `DEBUG=1` to dump screenshots to `./tmp/percy-debug/`; eyeball them |
| **Percy upload** | Open `https://percy.io/<your-org>/<your-project>` — a build should appear with one snapshot per story |
| **Diff workflow** | Make a visual change to a story, re-run; verify the dashboard shows the diff |
| **Error paths** | Kill the emulator → re-run → verify clear error message; kill Appium → re-run → verify; remove WS port forward → re-run → verify |

### CI testing

For automated CI testing of the SDK (separate from the dev loop):

```yaml
# .github/workflows/sdk-e2e.yml (sketch)
- uses: reactivecircus/android-emulator-runner@v2
  with:
    api-level: 34
    target: google_apis
    arch: x86_64
    script: |
      npm install
      npx appium &
      adb reverse tcp:7007 tcp:7007
      npm run --workspace examples/RNStorybookFixture android &
      sleep 60                                    # wait for app to boot into Storybook
      percy exec -- npx percy storybook-rn        # SDK runs against running app
```

The `reactivecircus/android-emulator-runner` GitHub Action provides a real Android emulator in CI — that's the canonical way to run end-to-end tests like this on every PR.

### Unit tests vs end-to-end

- **Unit tests (Vitest, fast):** mock `webdriverio`, mock the WebSocket, test `runner.ts` story-loop logic, error paths, config parsing.
- **Integration tests (real WebSocket, no real device):** spin up a stub WebSocket server that mimics Storybook RN's protocol, run the runner against it. Catches protocol-level bugs without needing an emulator.
- **End-to-end tests (real emulator, real Appium, real Percy):** the dev-loop above; nightly in CI; gates a release.

The pyramid: lots of unit, some integration, one or two E2E nightly.

## Sources & References

### Origin

- [Task Brief (Confluence v3, includes Brainstorm + Design Check)](https://browserstack.atlassian.net/wiki/spaces/PER/pages/6168216344/)
- v1 plan (superseded, kept for research record): `docs/plans/2026-04-27-001-feat-storybook-react-native-component-testing-plan.md`

### Internal references (existing Percy code to mirror)

- `percy/percy-appium-js` — particularly `percy/providers/genericProvider.js` (`takeScreenshot` + `postComparison` flow)
- `percy/cli/packages/sdk-utils/src/post-comparison.js` — `:5338/percy/comparison` endpoint
- `@percy/cli-command` — Percy CLI plugin pattern
- `@percy/cli-app` — closest-shaped existing SDK; mirror its package layout and CLI registration

### External

- [`@storybook/react-native` README + WebSockets blog (Feb 2026)](https://github.com/storybookjs/react-native)
- [Storybook 9 release notes — RN parallel native+web mode](https://storybook.js.org/blog/storybook-9/)
- [WebdriverIO Appium docs](https://webdriver.io/docs/api/appium)
- [Appium 2 docs (server, drivers)](https://appium.io/docs/en/2.0/)
- [reactivecircus/android-emulator-runner GitHub Action](https://github.com/reactivecircus/android-emulator-runner)
- Competitive landmarks (for differentiation positioning):
  - [Sherlo (closed cloud, build-and-upload)](https://sherlo.io/)
  - [Chromatic RN-Web only](https://storybook.js.org/docs/get-started/frameworks/react-native-web-vite)
