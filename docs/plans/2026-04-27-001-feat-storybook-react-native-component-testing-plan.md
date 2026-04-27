---
title: "@percy/storybook-react-native — Component Visual Testing on Real Devices"
type: feat
status: superseded
superseded_by: docs/plans/2026-04-27-002-feat-storybook-react-native-component-testing-v2-plan.md
date: 2026-04-27
origin: https://browserstack.atlassian.net/wiki/spaces/PER/pages/6168216344/Task+Brief+React+Native+Component+Testing+Support+in+App+Percy
---

> ⚠️ **SUPERSEDED on 2026-04-27.** This plan assumed a Percy-built native shell distributed to BrowserStack devices with customer JS bundle injection — a 4–5 month, multi-team effort with code signing, HSM, multi-tenant isolation. **Course correction:** Percy's existing Appium SDK (`GenericProvider`) already supports any local Appium session, and Storybook RN's port-7007 WebSocket exposes story navigation directly. The simpler architecture (BYO emulator + Appium driver + WebSocket) is captured in **[v2 plan](./2026-04-27-002-feat-storybook-react-native-component-testing-v2-plan.md)** — single phase, ~4–6 weeks, no shell, no signing, no backend changes.
>
> This v1 file is kept for research record only — its risk analysis, security review, scope cuts, and framework-research findings remain useful context. **Do not execute against this plan.**

# @percy/storybook-react-native — Component Visual Testing on Real Devices

## Overview

Ship a Percy SDK that lets React Native teams snapshot every Storybook story on real iOS and Android devices via App Percy's existing device cloud. Customers add `@percy/storybook-react-native` to their RN project, register the addon in their Storybook config, and run `npx percy storybook-rn` in CI. The SDK enumerates stories, bundles them with Metro, validates the bundle against a pre-built Percy "shell" host app, uploads the bundle, and triggers per-story snapshots in App Percy's device sessions. Diffs land in the customer's existing Percy dashboard alongside their full-screen App Percy builds.

This plan implements the directional decisions captured in the [Task Brief](https://browserstack.atlassian.net/wiki/spaces/PER/pages/6168216344/) — including its appended Brainstorm Session Outcomes (2026-04-27) and Design Check Outcomes (2026-04-27).

**Three architectural pillars driving this plan:**

1. **Pre-built Percy shell, customer-side JS bundle** — keep CI overhead at ~1–2 min instead of the 8–15 min a per-run native rebuild would cost.
2. **Pre-upload validation gate** — fail fast in CLI before consuming device-cloud minutes when stories use unsupported native modules or RN version is mismatched.
3. **Reuse existing App Percy infrastructure** — same device cloud, same snapshot/comparison pipeline, same dashboard. New work is concentrated at the SDK layer + a small backend metadata extension.

## Problem Statement

App Percy today captures full-screen native snapshots of RN apps driven by Appium/Detox/Maestro tests. Customers cannot test individual UI components in isolation — they must build a screen that exercises every variant, navigate to it via E2E, and snapshot the entire screen. That's slow, brittle, and requires maintaining a dummy app. Existing workarounds (Storybook on Percy Web via React-Native-Web) lose native fidelity (fonts, shadows, safe area, platform-specific widgets).

**Customer signal validated in brainstorm:** RN customers want real-device parity matching existing App Percy behavior, not a faster-but-different rendering path. Native fidelity is the differentiator vs. Chromatic / Applitools / Sauce Visual.

## Proposed Solution

### High-level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Customer Repo (CI)                                                  │
│  ┌──────────────────┐    ┌─────────────────────────┐                 │
│  │ Storybook config │ →  │ @percy/storybook-       │                 │
│  │ (.stories.tsx)   │    │ react-native CLI        │                 │
│  └──────────────────┘    └────────────┬────────────┘                 │
│                                       │                              │
│                          1. Enumerate stories                        │
│                          2. Metro bundle (JS-only)                   │
│                          3. Pre-upload validation gate               │
│                          4. Upload bundle                            │
└───────────────────────────────────────┬──────────────────────────────┘
                                        ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Percy Backend                                                       │
│  ┌──────────────────────────┐  ┌──────────────────────────────────┐  │
│  │ Builds API               │  │ Percy Shell Artifact Store       │  │
│  │ build_type=storybook_rn  │  │ (.ipa + .apk per RN version)     │  │
│  └────────────┬─────────────┘  └────────────────┬─────────────────┘  │
│               │                                 │                    │
│               └──────────────┬──────────────────┘                    │
│                              ▼                                       │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ App Percy Device Orchestrator                                │    │
│  │ - Boots Percy shell .ipa/.apk on selected device             │    │
│  │ - Injects customer JS bundle URL via launch arg              │    │
│  │ - Tails device logs for [percy:ready] markers                │    │
│  │ - Triggers snapshot per story → existing snapshot pipeline   │    │
│  └──────────────────────────┬───────────────────────────────────┘    │
│                             ▼                                        │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ Snapshots API + Comparison Pipeline + Dashboard (unchanged)  │    │
│  └──────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

### Components

#### 1. `@percy/storybook-react-native` (npm package)

A Percy CLI plugin distributed via npm. Built using `@percy/cli-command` (yargs-based command bus). **CLI surface and ergonomics mirror `@percy/storybook` web SDK** (zero learning curve for existing Percy customers). **Upload pipeline mirrors `@percy/cli-app`** — uses `@percy/client` for build/snapshot API auth, does NOT depend on the local `:5338` snapshot server (that's for browser SDKs).

Entry surface:
- `npx percy storybook-rn` — auto-discover + run
- `npx percy storybook-rn --include="Button/*"` — story name filter
- `npx percy storybook-rn doctor` — local-only validation (runs full pre-upload gate without uploading; recommended first run)
- `npx @percy/storybook-react-native init` — first-run scaffolding

Config: standard `.percy.yml` extension under a `storybook-rn:` key. Dry-run via config (`dryRun: true`) or env var (`PERCY_DRY_RUN=1`), not a CLI flag.

#### 2. Percy Shell (host app)

A pre-built bare React Native app, **dev-signed by Percy's Apple Developer team and Android-release-signed**, stored in Percy's artifact store. One `.ipa` + one `.apk` per supported RN line. **Distribution to BrowserStack uses dev-signing + cloud auto-resign** — BrowserStack auto-resigns uploaded `.ipa` with its wildcard provisioning profile. **Apple Developer Enterprise Program is explicitly NOT used** (Apple revokes accounts that distribute Enterprise-signed apps externally).

Composition:
- Bare RN runtime, **Hermes V1 + New Architecture (Fabric/TurboModules)**, **RN 0.76+ only**. Old Architecture and JSC are explicitly unsupported.
- Embedded `@storybook/react-native` runtime (story registry + navigator + WebSocket server on port 7007 — reused as IPC channel)
- Bundled common native modules (initial set: `react-native-svg`, `react-native-reanimated`, `react-native-gesture-handler`, `react-native-safe-area-context`, `react-native-vector-icons`). **`@react-native-async-storage/async-storage` is intentionally excluded** — cross-tenant persistence risk on shared devices.
- **Percy snapshot trigger module**: registers a Storybook decorator that hooks `useEffect` on mount + idle, emits `{ type: 'percy:ready', storyId, seq, hmac }` over Storybook RN's existing port-7007 WebSocket. **HMAC-nonce per session prevents customer JS spoofing** (orchestrator and shell share a nonce; customer JS cannot derive it). Falls back to HMAC-prefixed log markers (`[percy:ready:<hmac>]`) only if WebSocket port-forward fails.
- **Capability-restricted JS sandbox**: bundle-loader bootstrap overrides global `fetch`, `XMLHttpRequest`, WebSocket; iOS `NSAppTransportSecurity` and Android network security config deny outbound except the Percy bundle host.
- **Bundle-loader bootstrap (RCTReloadCommand pattern)**: receives a single-use 5-min build-scoped session token at launch (NOT the raw bundle URL); exchanges token at Percy auth endpoint for bundle URL + SHA-256 digest; verifies digest before evaluation; uses `RCTReloadCommand` to restart the bridge with the customer bundle as entry. **One device session = one bundle = one bridge lifetime.** Bundles are session-fresh, never persisted across sessions.
- **Inter-session reset**: orchestrator uninstalls + reinstalls shell between tenant sessions (iOS WDA `installApp`/`removeApp`; Android `pm uninstall` + reinstall) + clears clipboard/keyboard cache on `applicationWillTerminate` / `onDestroy`.

**Versioning (MVP):** Hardcoded constant in the SDK:
```js
const SHELL = { version: '1.0.0', rnRange: '>=0.76.0 <0.77.0', engine: 'hermes', arch: 'new', modules: [...] };
```
**One shell line at MVP.** Shell version manifest infrastructure (JSON format, dynamic selection logic, `shells.yaml` lifecycle file) introduced only when shell count > 2.

#### 3. Pre-upload validation gate (in CLI)

Runs entirely locally on the customer's CI before any upload. Hard-fails with explicit, actionable error messages. **Two static checks + one dynamic preflight:**

1. **`metro-bundle-and-validate`** — single Metro invocation that produces the bundle, walks its module graph, cross-references resolved imports against the shell manifest, and enforces the size cap (default 50 MB hard, server-enforced via streaming counter). Catches: no stories found, story enumeration errors, unsupported native modules, bundle compile errors, oversized bundles. Single shared error formatter.
2. **`rn-version-check`** — one-liner against customer's `package.json`. Fail with `RN 0.71.4 not supported. Required: RN >=0.76.0 with Hermes V1 + New Architecture.`
3. **Dynamic preflight** — spin up the shell once on a single emulator (cheaper than a full device session) with the customer bundle, run a 60-second "import smoke" pass that loads each story without rendering, captures any runtime errors. Catches the runtime-only mismatches static analysis misses: TurboModule spec mismatches, native asset misses, `requireNativeComponent` string mismatches, version-skew within allowed modules. Only on success → reserve the full device matrix.

**Reframed NFR:** "100% of statically-detectable mismatches caught by static gate; dynamic preflight catches runtime mismatches before full-matrix device reservation."

#### 4. Device-session orchestrator adapter (App Percy backend)

Extension to App Percy's existing device-orchestration code path, implemented as a `StorybookRNOrchestrator` class behind a `BuildOrchestrationStrategy` interface (alongside `WebOrchestrator` and `AppOrchestrator`). **A lint/architecture rule forbids `if build_type ==` branches outside the strategy factory.**

Per device session:
1. Pull selected Percy shell `.ipa`/`.apk` from artifact store.
2. Pull customer JS bundle + asset manifest archive (paired upload) from blob storage.
3. Mint single-use 5-min session token bound to `(build_id, device_session_id, tenant_id)`; pass via Appium environment variable (NOT visible in `ps` / system logs).
4. Boot shell on device; orchestrator port-forwards Storybook RN WebSocket on port 7007 via `adb reverse` (Android) / `iproxy` (iOS) and connects as a WebSocket client.
5. **Sharding** (Phase 1 primitive, not fast-follow): split N stories across configured shard count (default `shards: auto` → at least 2 shards per platform); orchestrator splits by stable hash of `story_id`. Restate SLA as "P75 wall-clock with default sharding."
6. Per shard: send `{ type: 'setCurrentStory', args: [{ storyId, viewMode: 'story' }] }` via WebSocket; await `{ type: 'percy:ready', storyId, seq, hmac }` ack with valid HMAC (sequence numbers detect drops); trigger snapshot via existing App Percy snapshot API; tag snapshot with `story_id` + device label; advance.
7. Per-story timeout (30s default) — story marked failed, advance. **`parameters.percy.skip`** per-story skip honored. (`parameters.percy.waitFor` deferred to Future Considerations — overlaps with timeout.)
8. Session timeout (8 min hard cap) — terminate, mark remaining stories failed, build marked partial.
9. **Inter-session reset**: uninstall + reinstall shell on device before next tenant's session boots.

#### 5. Backend metadata extensions

Minimal schema additions (final after deepening):

- `builds.build_type` — enum: `web`, `app`, `storybook_rn` (new value). Selected by `BuildOrchestrationStrategy` factory.
- `builds.bundle_ios_url` (nullable) + `builds.bundle_android_url` (nullable) — **paired per-platform bundles from day one** (Metro `Platform.select`, `.ios.tsx`/`.android.tsx` resolution are core RN idioms; defaulting to one bundle would break early adopters and bake a bad assumption into the schema).
- `builds.assets_archive_url` (nullable) — Metro emits assets as a separate manifest, not inlined; uploaded as a tarball alongside the JS bundles.
- `snapshots.story_id` (nullable) — canonical Storybook story ID (`Component/Variant`). **Only this column is added; `component_name` and `args_hash` are dropped from MVP.** Component name is derived in dashboard via `split('/')[0]`. Args grouping deferred until grouping UI exists.

**Snapshot naming convention:** `{ComponentName}/{StoryName}/{DeviceLabel}` — composed at SDK layer, stored as the canonical snapshot name. Device last so iOS+Android renders of the same story sort adjacently in the existing flat dashboard view. SDK populates both `name` (display) and `story_id` (structured contract for Phase 2+ grouping UI).

**Future-proofing:** any further Storybook-specific snapshot metadata sits behind a `snapshot_metadata` JSONB column or a `snapshot_storybook_metadata` join table, decided via a follow-up ADR before column #4 lands.

### Implementation Phases

**Three phases total** (Phase 2 dogfood + design-partner work folded into Phase 1 success criteria).

#### Phase 0 — Percy Shell & Build Pipeline (pre-MVP, blocks everything else)

**Goal:** Shipping artifact: dev-signed `.ipa` + Android-release-signed `.apk` for **one** RN line (RN 0.76.x with Hermes V1 + New Architecture).

**Tasks:**
- Create internal `percy-storybook-rn-shell` repo (RN 0.76.x bare project, New Arch + Hermes V1).
- Embed `@storybook/react-native` runtime in the shell entry; expose its existing port-7007 WebSocket as the IPC channel.
- Bundle the initial native module set (`react-native-svg`, `react-native-reanimated`, `react-native-gesture-handler`, `react-native-safe-area-context`, `react-native-vector-icons`). **AsyncStorage explicitly excluded.**
- Implement Percy snapshot trigger as a Storybook decorator that emits `{ type: 'percy:ready', storyId, seq, hmac }` over the port-7007 WebSocket. HMAC nonce per session.
- Implement bundle-loader bootstrap (RCTReloadCommand pattern): receive single-use session token at launch, exchange for bundle URL + SHA-256 digest, verify, load via `RCTReloadCommand`.
- Implement capability-restricted JS sandbox (override `fetch`/`XMLHttpRequest`/WebSocket; ATS + network-security-config deny outbound).
- iOS: produce `.ipa` signed with **development provisioning profile** from Percy's existing Apple Developer team (preserves `get-task-allow`; BrowserStack auto-resigns on upload). **No Apple Developer Enterprise Program.**
- Android: configure release signing using Google Play App Signing (Percy holds only the upload key); produce signed `.apk`.
- Code-signing key management: store distribution cert + Android upload key in cloud HSM (GCP KMS / AWS CloudHSM); two-person approval to release a shell artifact; calendar-driven expiry alerts (T-60d, T-30d, T-7d).
- CI pipeline (Buildkite) to rebuild shell artifacts on every shell-repo commit; upload to artifact store keyed by manifest hash (`sha256(rn_minor + arch + engine + native_modules_sorted)`).
- Hardcode `SHELL` constant in the SDK (single shell version pointer). **Manifest JSON infrastructure NOT shipped in MVP.**
- **Capacity uplift planning** (Phase 0 dependency, not Phase 1 monitoring): forecast device-minute load (tenants × builds/day × stories × devices × s/story); confirm dedicated component-testing pool OR core-pool headroom of ≥3× current peak before Phase 1 dogfood begins. Per-tenant concurrent-build cap (5).
- `e2e-fixtures/` directory committed alongside shell repo: pinned golden Storybook RN apps (one per supported RN line) for nightly integration tests. Snapshot baselines in-repo, PR-reviewed.

**Success criteria:**
- Shell boots on a real iOS device + a real Android device; loads a hand-crafted JS bundle via RCTReloadCommand; renders three sample Storybook stories; orchestrator receives `percy:ready` over port-7007 WebSocket with valid HMAC.
- Inter-session reset proven: integration test writes a sentinel in tenant A's session and asserts tenant B cannot read it.
- Dev-signed shell uploaded to BrowserStack and successfully resigned + booted via `appium`.
- Capacity forecast signed off by infra leads.

**Estimated effort:** 4–6 weeks for one mobile/RN-experienced engineer.

#### Phase 1 — SDK + CLI MVP + Dogfood + Design Partners

**Goal:** End-to-end self-serve flow validated by an external customer.

**Tasks (SDK + CLI package `@percy/storybook-react-native`):**
- Register `storybook-rn`, `storybook-rn:init`, and `storybook-rn:doctor` commands on Percy CLI command bus.
- Story enumeration: load Storybook config, walk story file globs, generate synthetic Metro entry (`__percy_entry.js`).
- Metro integration: programmatic invocation via `Metro.runBuild(config, { entry, platform, dev:false, minify:true, sourceMap:true (separate file) })` — produces per-platform bundle + asset manifest tarball. Hermes-parser flag matched to shell engine.
- **Pre-upload validation gate** (two static checks: `metro-bundle-and-validate` + `rn-version-check`).
- **Dynamic preflight**: emulator-based smoke load before reserving full device matrix.
- Per-platform bundle + asset archive upload to Percy backend (paired upload, retry with exp backoff).
- Live progress tail: append-only CI-safe lines, heartbeat every 10s, ETA after first 5 stories.
- **Metro cache persistence guidance** in `init` output (CI cache key `hash(package-lock.json + .storybook/**)`).
- `init` scaffolding: drops `.percy.yml`, prints copy-paste snippet for Storybook addon registration (no AST editing), drops sample `Button.stories.tsx` if no stories exist, prints next-steps with `doctor` command.

**Tasks (Backend):**
- New `build_type=storybook_rn` discriminator on builds, selected by `BuildOrchestrationStrategy` factory.
- Schema migration: add `bundle_ios_url`, `bundle_android_url`, `assets_archive_url`, `snapshots.story_id` (all nullable). Expand-contract pattern (add columns + new enum value in one release; deploy orchestrator in next).
- Bundle-upload endpoint: server-side streaming size cap, single-use upload token bound to `(project_id, build_id)`, per-tenant blob prefixes with IAM-enforced isolation.
- Session-token mint endpoint: 5-min TTL, single-use nonce, validates `(build_id, device_session_id, tenant_id)`.
- `StorybookRNOrchestrator` implementation: pull artifacts, port-forward WebSocket, send `setCurrentStory`, await HMAC'd `percy:ready`, trigger existing snapshot API, advance.
- **Sharding as Phase 1 primitive** (not fast-follow): orchestrator splits N stories across at least 2 shards per platform.
- Inter-session reset: uninstall + reinstall shell between tenant sessions.
- First-class telemetry from Phase 1: P75/P95 build time, per-story render-time histogram, Metro-bundle-time. (Required to defend the 5-min target pre-GA.)

**Dogfood + Design Partners (folded into Phase 1):**
- Internal dogfooding: 1–2 RN-using internal teams; daily feedback for 2–3 weeks.
- 2–3 friendly customers as design partners with hands-on integration support.
- Iterate on: native module manifest, error messages, `init` template content, documentation.

**Success criteria (this is the new MVP gate):**
- **One external customer integrates self-serve from public docs + reference repo**, runs ≥10 builds over ≥1 week, with **zero synchronous engineer assistance**. Time-to-first-green-build is the headline metric.
- All static gate failures produce clear error messages from the catalog (see Error Catalog appendix) with non-zero CLI exit codes.
- Dynamic preflight catches at least one runtime mismatch class that static analysis missed (proven on a fixture).
- Live CLI progress renders correctly across Buildkite + GitHub Actions + CircleCI.
- `e2e-fixtures/` nightly integration test green for ≥2 consecutive weeks.

**Estimated effort:** 8–10 weeks across 2 engineers (one full-stack on SDK/CLI + dogfood support, one on backend orchestrator + schema).

#### Phase 2 — Documentation, Beta Open, GA

**Goal:** Open beta gate, then GA.

**Tasks:**
- Customer-facing docs:
  - "Visual testing for React Native components with Storybook" landing article.
  - Quota math explainer (stories × devices × builds/day = snapshot consumption).
  - **Fidelity-gap section**: explicitly documents what Percy shell does and does not match in customer's app (RN minor, native module versions, Hermes V1, New Architecture).
  - **Support matrix**: auto-generated from shell manifest at doc-build time. SDK release blocked if matrix file is stale.
  - Migration from RN-Web Storybook approach.
- Reference example repo: maintained as a workspace in the SDK monorepo (or git submodule); daily scheduled GitHub Action runs `percy storybook-rn --dry-run` against the latest published SDK; failure → Slack webhook + visible README badge.
- Beta open: feature flag `rn_component_testing` flipped for any opted-in App Percy customer.
- Monitoring dashboards: `RNStorybookBuildStarted/Completed`, `RNStorybookCLIError` (introduced now, not Phase 1) error_code distribution, P75/P95 build time, device-pool utilization, core-pool regression delta.
- **Pricing decision before GA, not after**: pick (a) component-snapshot SKU, (b) bill-per-render-not-per-device, or (c) free-tier-N-snapshots-per-build. Default in this plan is option (a) deferred — choose explicitly before flag default-on.
- GA: flag default-on for all App Percy customers.
- **60-day post-GA review** with named owner, three pre-committed tripwires (active-projects floor, FP rate ceiling, quota-driven disable rate), and a written sunset criterion. On the calendar before Phase 2 ships.

**Success criteria:**
- P75 component build time < 5 min sustained (with sharding + Metro cache + WebSocket IPC; without these the target is unattainable).
- Device-pool contention < 5% AND App Percy core-build P75 regression < 5% (single threshold, both must be under).
- ≤8% reviewer rejection-without-code-change rate (anchored to App Percy native FP rate, not Percy Web's 5%).

**Estimated effort:** 3–4 weeks docs + ongoing monitoring.

## Alternative Approaches Considered

| Approach | Why Rejected |
|---|---|
| **RN-Web on Percy Web** (render stories as React Native Web in headless Chrome) | Loses native fidelity (fonts, shadows, safe area, platform-specific widgets) — the entire reason customers ask for RN component testing per brainstorm. Cheap to build but breaks the App Percy promise. |
| **Per-run customer app build** (build a fresh native host on every CI run with customer's stories embedded) | 8–15 min CI overhead per build (cold xcodebuild + gradle). Defeats the "shift-left visual coverage into PR builds" value prop. Also creates a tight coupling between Percy and customer's toolchain. |
| **Custom dashboard grouping UI in MVP** (dedicated component-grouped build view) | Solved instead by snapshot naming convention `{Component}/{Story}/{Device}` — alphabetical sort in existing flat view yields visual grouping for free. Saves weeks of frontend work. |
| **Per-customer custom shells** (rebuild shell per customer to support their custom native modules) | Operational nightmare; defeats fast-CI goal. Custom-native components are usually integration components (Camera, Map, biometric prompts) covered better by existing screen-level App Percy. |
| **Appcues + dashboard banner discovery in MVP** | Cut by brainstorm; reintroduce post-MVP once we have evidence the core feature works. |

## System-Wide Impact

### Interaction Graph

Trace of a single `percy storybook-rn` invocation, two levels deep:

1. **CLI invocation** → enumerate stories (reads `.storybook/main.js`) → invoke Metro programmatically → produce JS bundle → run pre-upload validation gate
2. **Pre-upload gate fails** → CLI exits non-zero → CI fails the PR check → no Percy build created → no device cost incurred
3. **Pre-upload gate passes** → CLI calls `POST /api/v1/builds` (new `build_type=storybook_rn`) → calls `POST /api/v1/builds/:id/storybook-rn-bundle` to upload bundle blob → Percy backend writes blob to storage, kicks off device-orchestrator job
4. **Device orchestrator** → fetches matching shell from artifact store (manifest-hash-keyed) → reserves an iOS device + an Android device per shard → boots shell on each with a single-use 5-min session token (Appium env var, NOT visible in `ps`/system logs) → port-forwards Storybook RN's WebSocket on port 7007 via `adb reverse` (Android) / `iproxy` (iOS) → connects as WebSocket client
5. **Shell on device** → boots → exchanges session token at Percy auth endpoint for bundle URL + SHA-256 digest → fetches bundle, verifies digest → uses `RCTReloadCommand` to load bundle as the bridge entry → Storybook RN runtime enumerates stories → on each `setCurrentStory` message from the orchestrator: render → Percy decorator emits `{ type: 'percy:ready', storyId, seq, hmac }` over the same WebSocket
6. **Orchestrator on valid `percy:ready`** (HMAC verified, sequence number monotonic) → calls existing App Percy snapshot API with story metadata → snapshot service captures + uploads → orchestrator sends `setCurrentStory` for the next story; per-shard parallelism is the bottleneck, not per-story serial
7. **Snapshot service** → standard pipeline: store snapshot, create comparison record, run diff against baseline, post status to GitHub PR check (existing path)

**Existing systems touched:**
- Percy CLI (plugin registration, no changes to core)
- Builds API (one new column: `build_type`)
- Snapshots API (three new nullable columns)
- App Percy device orchestrator (new build_type adapter)
- Artifact storage (new shell artifact bucket/prefix)
- GitHub PR check integration (no changes — existing multi-build-per-commit handling covers the case)

### Error & Failure Propagation

| Layer | Failure Mode | Handling |
|---|---|---|
| Pre-upload gate (CLI) | Module not in shell, RN version mismatch, no stories, bundle too large | Hard fail, exit 1, no build created, no device cost |
| Bundle upload | Network error mid-upload | CLI retries 3× with exponential backoff; fail with explicit error after exhaustion |
| Bundle storage | Blob write error backend-side | Build marked `errored`, CLI receives error response, exits 1 |
| Device boot | Shell crashes on launch | Build marked failed, CLI surfaces `Shell launch failed on <device>` |
| Bundle load on device | JS error during bundle eval | Shell emits `[percy:fatal]`, orchestrator marks build failed, CLI exits 1 |
| Per-story render | Story throws during render | Mark single snapshot failed (existing pattern), shell advances to next story |
| Per-story timeout | Story renders but never settles (animation loop, async hang) | 30s default timeout; story marked failed, shell emits `[percy:timeout]`, advances |
| Session timeout | Whole session exceeds 8min | Terminate session, remaining stories marked failed, build marked partial |
| Quota exceeded mid-build | Snapshot quota exhausted partway | Server stops accepting snapshots; build marked partial; CLI surfaces `Quota exceeded. X/Y captured. Use --include to filter.` |
| Snapshot upload | Single snapshot upload fails | Existing pattern: retry, then mark snapshot errored without failing build |

**Critical guardrail:** native module / RN version mismatch must NEVER produce a baselined red-screen snapshot. The pre-upload gate is the contract that prevents this. If it fails, no build exists.

### State Lifecycle Risks

| Risk | Mitigation |
|---|---|
| Partial bundle upload (CLI killed) | Bundle uploads use multipart with checksum; backend rejects incomplete uploads. Build stays in `pending` until bundle confirmed; cleanup job deletes pending-with-no-bundle builds after 1h |
| Orphan device sessions (orchestrator crashes mid-session) | Existing App Percy session timeout (15min hard cap) terminates orphans; existing watchdog reclaims devices |
| Stale shell in artifact store | Shells are immutable, versioned. Old shells retained for 90 days for audit; cleanup beyond that |
| Snapshot uploaded but story_id metadata write fails | Use single transaction: snapshot row + story metadata committed together. Failure → snapshot not created |
| Customer's RN upgrade breaks compat with cached shell version | CLI re-resolves shell version per run from customer's current `package.json`; cache only the bundle artifact, not the shell-selection decision |
| Two concurrent CI builds for the same commit | Existing Percy parallel-build handling (multiple builds per commit, finalized when last reports) covers this; no new logic needed |

### API Surface Parity

- **Builds API** — new `build_type=storybook_rn` field. Existing API consumers default to `web`/`app` — no breaking change.
- **Snapshots API** — three new nullable columns. Existing snapshots have `null` for these. Dashboard ignores `null` (no behavior change for non-component builds).
- **GitHub PR check integration** — no changes. Existing logic reports a Percy check per build; component build = additional check on the PR (alongside any existing E2E Percy build).
- **Public CLI** — net-new commands. No existing CLI surface affected.
- **Storybook addon API** — Percy ships a Storybook RN addon module that registers `parameters.percy` schema (e.g., `parameters.percy.waitFor`, `parameters.percy.skip`). Standard Storybook addon contract — no Percy invention.

### Integration Test Scenarios

Five scenarios that unit tests with mocks would never catch:

1. **End-to-end first build, happy path** — `init` on a fresh RN project → `storybook-rn` → build appears in dashboard with N component snapshots from each device → diff against synthetic baseline → reviewer approves → next run shows no changes
2. **Native module manifest miss** — story imports `react-native-camera` (not in shell) → pre-upload gate fires → CLI exits 1 with explicit message → no build row created in DB → no device session reserved (verifies cost guarantee)
3. **RN version skew** — customer on RN 0.71 (no shell available) → pre-upload gate fires → CLI exits 1 → message lists supported versions
4. **Story timeout mid-build** — bundle has 100 stories; story #50 has an infinite animation → story #50 snapshot marked failed, shell advances → stories #51–100 captured normally → build status: partial-success with 99/100 snapshots
5. **Quota exceeded mid-build** — customer at 95/100 of quota → starts a 50-snapshot component build → first 5 snapshots succeed → server stops accepting → build marked partial → CLI emits clear "quota exceeded, 5/50 captured" → does NOT exit 1 (this is a soft fail, not a CLI bug)

## Acceptance Criteria

### MVP Gate (single source of truth)

- [ ] **One external customer integrates self-serve from public docs + reference repo, runs ≥10 builds over ≥1 week with zero synchronous engineer assistance.** Time-to-first-green-build is the headline metric.

### Functional Requirements

- [ ] `npx percy storybook-rn` enumerates stories from a standard Storybook RN config (`.storybook/main.{js,ts}` or default `*.stories.tsx` discovery).
- [ ] `npx @percy/storybook-react-native init` drops `.percy.yml`, prints copy-paste snippet for Storybook addon registration (no AST editing of customer's `.storybook/main`), drops a sample `Button.stories.tsx` if no stories exist, prints next-steps including `doctor` command.
- [ ] `npx percy storybook-rn doctor` runs the full pre-upload gate locally without uploading; non-zero exit on any failure.
- [ ] CLI runs the **two static checks** + **dynamic preflight smoke load**; each failure exits 1 with a specific actionable error message (see Error Catalog).
- [ ] CLI live-tails per-story progress per device in CI logs (append-only format, heartbeat every 10s, ETA after first 5 stories).
- [ ] Bundle upload retries on transient network failure (3× exp backoff). Per-platform bundles + asset-archive uploaded as paired blobs.
- [ ] Backend creates `build_type=storybook_rn` builds via the `BuildOrchestrationStrategy` factory; snapshots tagged `{Component}/{Story}/{Device}` (device last so iOS+Android renders sort adjacently).
- [ ] Snapshots appear in existing flat Percy build dashboard, sorted alphabetically (component-grouped via naming convention).
- [ ] Default device matrix: 1 latest-stable iOS device + 1 latest-stable Android device. Hardcoded in MVP.
- [ ] `--include="Pattern/*"` filter applied at story-enumeration stage. (No `--dry-run` flag — use config `dryRun: true` or `PERCY_DRY_RUN=1`.)
- [ ] `parameters.percy.skip` per-story skip honored. (`parameters.percy.waitFor` deferred — see Future Considerations.)
- [ ] Per-story 30s default timeout enforced. Session 8min hard cap enforced.
- [ ] Sharding works by default (`shards: auto` → at least 2 shards per platform).
- [ ] Inter-session shell reset proven: integration test writes a sentinel in tenant A and asserts tenant B cannot read it.
- [ ] Storybook RN port-7007 WebSocket used as primary IPC channel; HMAC-prefixed log markers used as fallback only.
- [ ] Customer JS sandbox: `fetch` / `XMLHttpRequest` / WebSocket overridden; ATS + network security config deny outbound except Percy bundle host.

### Non-Functional Requirements

- [ ] P75 build time for a 100-story project (× 2 devices, with default sharding) ≤ 5 min (post-Phase-2 target).
- [ ] CLI overhead with persisted Metro cache ≤ 2 min on warm path.
- [ ] **Static gate detects 100% of statically-detectable mismatches; dynamic preflight catches runtime mismatches before full-matrix device reservation.** (Replaces the unmeetable "100% pre-upload detection" NFR.)
- [ ] No regression on existing App Percy core build P75 latency. **Single threshold: <5% device-pool contention AND <5% core-build P75 regression** (rollback trigger; both gate Phase 2 GA).
- [ ] No new permission scopes introduced (RBAC reuses existing App Percy roles).
- [ ] **Billing unit definition:** 1 snapshot = 1 story rendered on 1 device. Component build (50 stories × 2 devices) = 100 snapshot quota deductions. No batch discounts, no separate component-build pricing tier in MVP.

### Quality Gates

- [ ] Unit tests for SDK story enumeration (across Storybook config formats: JS, TS, ESM, CJS).
- [ ] Unit tests for pre-upload validation gate (both static checks + preflight; happy + failure paths).
- [ ] Integration test: real Metro bundle of a fixture Storybook RN project, verify expected stories enumerated and assets archive produced.
- [ ] Integration test (nightly on real devices, gated against `e2e-fixtures/`): full e2e on golden Storybook RN apps — boot shell on real iOS + Android, capture 3-story fixture, assert snapshots created with correct metadata. Baselines committed in-repo, PR-reviewed.
- [ ] Backend migration is reversible (drop nullable columns; revert `build_type` enum). Expand-contract: schema additions deploy in release N; orchestrator deploys in release N+1.
- [ ] Code-signing key handling: HSM-backed; two-person approval for shell artifact promotion; expiry alert wiring verified.
- [ ] **Security review of bundle-upload endpoint is a Phase-1 hard blocker** (not just a checklist item): signed URL TTLs, blob path tenancy isolation, server-enforced size cap via streaming counter, replay-window enforcement, single-use nonce.
- [ ] Documentation: landing article + quota math explainer + fidelity-gap section + migration guide written before GA flag flip.
- [ ] Reference example repo as workspace in SDK monorepo + daily scheduled CI smoke; visible README freshness badge.
- [ ] Architecture lint rule active: `if build_type ==` branches forbidden outside the `BuildOrchestrationStrategy` factory.

## Success Metrics

Per brainstorm decision: **MVP success = "the feature works end-to-end for at least one customer or internal dogfood project."** Numerical targets are *post-MVP observation metrics*, not gates.

Post-MVP observation targets (revisit in Phase 3 with real data):

| Category | Metric | Initial Target | Notes |
|---|---|---|---|
| Adoption | Active integrated projects | ≥25 in 90 days post-GA | Anchor against actual RN customer count from BigQuery before locking |
| Engagement | % of integrated projects running components on every PR (vs nightly only) | ≥50% in 60 days | More honest signal than absolute snapshot count |
| Quality | Reviewer rejection-without-code-change rate | ≤8% | Anchor to internal App Percy full-screen FP rate, not Percy Web's 5% |
| Performance | P75 build time, 100-story project | ≤5 min | Aligns with App Percy core SLA |
| Cost guardrail | App Percy core build P75 regression | <10% | Rollback trigger |

## Dependencies & Prerequisites

| Dependency | Owner | Blocking? |
|---|---|---|
| iOS code signing + provisioning for Percy shell distribution | Platform/Mobile Infra | Yes — Phase 0 blocker |
| Android signing keys for Percy shell | Platform/Mobile Infra | Yes — Phase 0 blocker |
| App Percy device orchestrator code access + extension hooks | App Percy backend team | Yes — Phase 1 blocker |
| Artifact storage bucket + access pattern | Infra | Yes — Phase 0 blocker |
| Buildkite pipeline for shell builds | DevOps | Yes — Phase 0 blocker |
| Schema migration approval (3 nullable columns + enum extension) | Backend leads | Yes — Phase 1 blocker |
| Bundle-upload endpoint security review | Security | Yes — Phase 1 gate before public beta |
| Customer billing reuse confirmation | Finance/Billing | No — already confirmed in brainstorm |
| Design partner identification | PM (Sai/Keegan) | No — Phase 2 prerequisite |

## Risk Analysis & Mitigation

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| **R1**: Multi-version shell maintenance burden grows unbounded | High | Medium | Cap at last 3 RN minor versions; sunset older shells with 90-day deprecation notice. Automated shell rebuild on RN release. |
| **R2**: Native module manifest grows long; every addition requires shell rebuild | High | Medium | Quarterly review of `RNStorybookCLIError` `error_code=module_not_in_shell` data; add modules requested by ≥3 customers. Long-tail customers wait or request custom-shell as paid service in Phase 4+. |
| **R3**: Device-cloud cost spike from RN component runs (multi-tenant pool contention) | Medium | High | Capacity uplift moved to **Phase 0 dependency**, not Phase 2 monitoring. Forecast device-minute load before Phase 1 dogfood; confirm dedicated component-testing pool OR core-pool headroom of ≥3× current peak. **Single threshold: contention <5% AND core-build P75 regression <5%** (both gate Phase 2 GA). Per-tenant concurrent-build cap (5) to bound runaway tenants. |
| **R4**: Pre-upload validation false negatives (unexpected internal RN APIs) | Medium | Medium | Bundle health check (smoke-load bundle in JS-only sandbox before upload). Catches most static-analysis blind spots. |
| **R5**: First-time integration friction despite `init` (Storybook RN setup itself is non-trivial) | Medium | Medium | Reference example repo with copy-paste `git clone` quickstart. Linked from `init` output and docs. Active Slack support during Phase 2. |
| **R6**: RN ecosystem fragmentation (New Architecture / Fabric / Hermes vs JSC) | Medium | High | **Initial shell line: New Architecture + Hermes V1, RN 0.76+ only.** Old Architecture and JSC support deferred indefinitely. Document explicitly in support matrix. Rationale: Hermes V1 is the default in RN 0.84+; New Arch is default in RN 0.76+ — pinning to these is "supporting RN's defaults," not an unusual constraint. |
| **R7**: Customer's bundle includes platform-specific code that crashes on the other platform | Medium | Low | Per-platform builds (iOS bundle vs Android bundle) → 2× upload time. Defer to Phase 2 if observed; MVP assumes platform-agnostic stories. |
| **R8**: Shell crashes on device with no useful diagnostics | Low | High | Comprehensive logging in shell. CLI surfaces last 200 lines of device log on shell-crash exit. Internal Sentry/Honeycomb wired for shell crashes. |
| **R9**: RN bundle loading APIs change in future RN versions | Low | Medium | Pin shell against specific RN minor; new shell line per RN minor. Use the same `RCTReloadCommand` pattern EAS Update / former-CodePush use — stable surface. |
| **R10**: Shell signing-key compromise (silent supply-chain attack against every customer's device sessions) | Low | Critical | HSM-backed signing (GCP KMS / AWS CloudHSM); CI signer holds no key material at rest; two-person approval for shell artifact promotion; annual rotation runbook with T-60d/30d/7d expiry alerts; Google Play App Signing for Android (Percy holds only upload key, not the irreplaceable app-signing key). |
| **R11**: App Store / distribution restrictions on remote JS execution | Low | Low (was High before deepening) | Use development-profile signing + cloud auto-resign (BrowserStack/Sauce/AWS DF all auto-resign on upload). **Apple Developer Enterprise Program explicitly NOT used** — Apple revokes accounts that distribute Enterprise-signed apps externally. |
| **R12**: New Architecture (Fabric/TurboModules) compat fragmentation across third-party native modules | High | Medium | Pin shell to New Architecture + Hermes V1 (default since RN 0.84). Maintain a public "New-Arch compatibility list" in shell manifest; pre-upload gate refuses bundles with modules not on the list. **Old Architecture support deferred indefinitely.** Initial GA: RN 0.76+ Hermes V1 New Arch only. |
| **R13**: Reference example repo bit-rots vs SDK API changes | High | Medium | Reference repo as workspace in SDK monorepo (or git submodule) — exercised by SDK CI on every PR. Daily scheduled GitHub Action runs `percy storybook-rn --dry-run` against latest published SDK; failure → Slack webhook + visible README badge. SDK-version footer auto-injected at doc-build time. |
| **R14**: Single dogfood project = single point of failure for nightly integration tests | Medium | Medium | Replace with Percy-owned `e2e-fixtures/` directory of pinned golden Storybook RN apps (one per supported RN line) committed alongside shell repo. Snapshot baselines in-repo, PR-reviewed. Keep one "wild" dogfood run as informational smoke signal only (not gating). |

## Resource Requirements

- **Engineering**:
  - 1 mobile/RN-experienced full-stack engineer (lead) for Phases 0–1: ~10–12 weeks
  - 1 backend engineer (App Percy adapter + schema): ~6 weeks
  - 0.25 FTE design support (no new UI but consultation on dashboard fit)
  - 0.5 FTE docs in Phase 3
- **Infra**: device-cloud capacity headroom; artifact storage for shells
- **Calendar**: ~4–5 months from Phase 0 kickoff to GA, assuming no major blockers
- **Customer-facing**: 2–3 design-partner customers identified by Phase 2 start

## Future Considerations

Listed here for forward visibility; explicitly out of scope for Phase 0–3:

- **Expo support** — Expo is the larger share of new RN projects in 2026; high-value fast-follow once bare RN is stable. Likely requires separate Expo-flavored shell + EAS Build integration path.
- **Configurable device matrix** — fast-follow once base flow is stable; small SDK + backend lift.
- **Cross-platform side-by-side diff view** — designer ask; pure dashboard UX investment.
- **Component-grouped dashboard view** — defer until snapshot count scales beyond what naming-convention sort handles cleanly (likely past 1000 snapshots/build).
- **Native iOS/Android (non-RN) component testing** — different harness, different audience. Revisit only if RN proves the demand.
- **`parameters.percy.waitFor` per-story override** — overlaps with the 30s default timeout; adds shell-side parsing surface. Re-evaluate if customers ask for it after MVP. (`parameters.percy.skip` ships in MVP as the lower-surface escape hatch.)
- **Storybook play() interaction tests** — parity with Chromatic. Requires shell to host play-function runner; non-trivial.
- **Old Architecture / non-Hermes support** — initial GA pins to RN 0.76+ Hermes V1 + New Architecture. Old Architecture deferred indefinitely; only revisit if material customer demand emerges.
- **Custom-native-module support** beyond bundled set — likely paid customer-specific shell builds, or a sandboxed plugin mechanism. Open question.
- **Shell version manifest + dynamic version selection** — single hardcoded shell at MVP. Manifest infrastructure introduced only when shell count > 2.

## Documentation Plan

To be drafted before Phase 2 GA (own item in Phase 2):

1. **New customer-facing article**: "Visual testing for React Native components with Storybook" — landing page on docs.percy.io/v1/docs/storybook-for-react-native.
2. **Quota math explainer**: short callout on the landing page explaining `stories × devices × builds/day = snapshots`. Includes a worked example (e.g., 100 stories × 2 devices × 50 PR builds/day = 10,000 snapshots/day).
3. **Fidelity-gap section**: explicitly documents what Percy shell does and does NOT match in the customer's app — RN minor, native module versions, Hermes V1, New Architecture flag. Optional `percy storybook-rn verify-shell` boots one customer story locally against the shell to flag drift.
4. **Migration guide**: for customers using Percy Web + RN-Web Storybook today, the path to switch.
5. **CLI reference**: command + flag documentation. Same shape as `@percy/storybook` reference.
6. **Reference example repo**: public GitHub repo with a working RN + Storybook + Percy setup. Maintained as a workspace in the SDK monorepo (or git submodule); daily scheduled CI smoke-test against latest published SDK; visible README freshness badge. Linked from `init` output.
7. **Internal runbook**: triage steps for top `RNStorybookCLIError` error codes; on-call references; signing-key rotation playbook; quarterly tabletop exercise (rebuild + re-sign a shell from a clean machine using only documented secrets).
8. **Support matrix**: which RN versions, which platforms, which native modules — **auto-generated from the shell manifest JSON in CI**. SDK release blocked if matrix file is stale. Embedded version-stamped "last verified against SDK X.Y" footer auto-injected at doc-build time.
9. **Error message catalog**: full drafted message body + exit code + next-step line for each `error_code` in the Error Catalog appendix below — surfaced as a doc page so customers can self-diagnose.

## Error Catalog (Acceptance Contract)

Every CLI failure path produces one of these structured error codes with the listed message body, exit code, and next-step line. This table is the acceptance contract for Phase 1 — implementation is not complete until every code below produces the exact message.

| `error_code` | Message body | Exit | Next-step |
|---|---|---|---|
| `no_stories_found` | "No stories found. Check your storybook config or .stories.tsx files." | 1 | "Run `percy storybook-rn doctor` to diagnose." |
| `module_not_in_shell` | "Module 'react-native-X' not in Percy shell. Bundled: [list]." | 1 | "Run `percy storybook-rn --list-shell-modules` for the full list. Custom modules supported in a future release." |
| `rn_version_mismatch` | "RN 0.71.4 not supported. Required: RN >=0.76.0 with Hermes V1 + New Architecture." | 1 | "Upgrade `react-native` or pin to a supported version." |
| `bundle_too_large` | "Bundle X MB exceeds 50MB cap." | 1 | "Use `--include` to reduce, or extract assets via `assets:` config." |
| `metro_compile_error` | "Metro bundle failed: [error verbatim]." | 1 | "Fix the bundler error; re-run." |
| `preflight_runtime_error` | "Preflight smoke-load failed: [runtime error verbatim]." | 1 | "Module not codegen'd into shell, or runtime API mismatch. Run `--list-shell-modules`." |
| `quota_exceeded` | "Quota exceeded. X/Y snapshots captured." | 0 (soft) | "Use `--include` to filter, or upgrade plan." |
| `partial_validation` | "Validated 39/40 stories. 1 failed: Card/Broken (SyntaxError at line 12). Proceed with 39?" | 0 with `--accept-partial`; 1 otherwise | "Fix the failing story, or pass `--accept-partial` to skip." |
| `include_zero_match` | "No stories matched --include='X'. Discovered 40 stories; none matched." | 1 | "Adjust your `--include` pattern." |

All codes also emit the `RNStorybookCLIError` analytics event (Phase 2+) with the structured `error_code` attribute, driving docs and error-message iteration.

## Sources & References

### Origin

- **Origin document:** [Task Brief: React Native Component Testing Support in App Percy](https://browserstack.atlassian.net/wiki/spaces/PER/pages/6168216344/) (Confluence page 6168216344, version 3, includes Brainstorm Session Outcomes 2026-04-27 and Design Check Outcomes 2026-04-27 appended).

  **Key decisions carried forward:**
  1. Real-device rendering (Path A) — confirmed; rejection of RN-Web (Path B) preserves App Percy promise.
  2. Pre-built Percy shell + customer JS bundle — confirmed; ~1–2 min CI overhead vs 8–15 min per-run app generation.
  3. Same-bucket billing as existing App Percy snapshots — no new SKU.
  4. Reuse existing flat Percy build dashboard via `{Component}/{Story}/{Device}` naming — defers custom grouping UI.
  5. MVP success = "feature works for one customer/dogfood project" — drop pre-built numerical targets.
  6. Pre-upload validation gate (4 checks: native module manifest, RN version, story enumeration, bundle health) — fail fast in CLI, never burn device minutes on broken bundles.
  7. CLI ergonomics mirror `@percy/storybook` web SDK; `init` command back in MVP.
  8. New `build_type=storybook_rn` discriminator + 3 nullable snapshot columns.

### Internal References

- Existing `@percy/storybook` web SDK conventions (CLI shape, addon registration, story enumeration patterns) to mirror.
- App Percy device-orchestrator code path (extension point for new `build_type` adapter).
- Existing snapshot/comparison pipeline (unchanged).
- Percy CLI plugin registration mechanism.

### External References

- [Storybook for React Native (`@storybook/react-native`)](https://github.com/storybookjs/react-native) — story registry + navigator embedded in the Percy shell.
- [Storybook visual testing docs](https://storybook.js.org/docs/writing-tests/visual-testing) — addon contract patterns.
- [Existing Percy Storybook integration docs](https://docs.percy.io/v1/docs/storybook-for-react) — UX baseline to mirror.
- [`percy/percy-storybook` (GitHub)](https://github.com/percy/percy-storybook) — implementation reference for the web SDK.

### Related Work

- Future: Expo + EAS Build integration for the Expo flavored shell.
- Future: dashboard component-grouped view (separate plan).
- Future: custom-native-module support (separate plan, likely paid offering).

---

## Deepened Plan — Research Insights & Risk Mitigations

**Deepened on:** 2026-04-27
**Sections enhanced:** 12 parallel agents (6 document-review personas, 4 targeted reviewers, 2 research) + WebSearch + Context7 (`/facebook/react-native-website`, `/websites/reactnative_dev`)
**User focus:** for every risk, surface concrete mitigations.

### Key Improvements

1. **Replace fragile `[percy:ready]` log-tail IPC with WebSocket + HMAC-nonce control channel.** Strongest cross-reviewer consensus (feasibility, architecture, performance, security all flagged independently). Log markers retained as fallback diagnostic only.
2. **Bundle loading model needs to follow the EAS Update / RCTReloadCommand pattern, not a custom bootstrap.** Bare RN has no public "load arbitrary bundle post-launch" API. Real path is the same one CodePush (retired 2025) and EAS Update use, with a fingerprint-pinned binary↔bundle compatibility manifest.
3. **iOS distribution model is enterprise/ad-hoc, not TestFlight.** App Store will reject "downloads + executes remote JS" for non-Expo apps. Phase 0 budget revised from 4–6 weeks → **6–8 weeks** to absorb Apple Developer Enterprise Program eligibility (multi-week approval).
4. **The "100% pre-upload detection" NFR is unattainable** via static analysis alone. Required: a layered gate with a *dynamic preflight smoke-load* on a single emulator before reserving the full device matrix.
5. **Aggressive scope re-cuts converge from scope-guardian + simplicity reviewers**: collapse Phase 0 to one shell line (delete the manifest infrastructure), drop two of four pre-upload checks, drop two of three snapshot columns, drop AST-editing in `init`, fold Phase 2 into Phase 1. **Net: 1 schema column dropped, 1 deferred, 1 manifest system removed, 1 phase collapsed.**
6. **Five new security threats require Phase 1 mitigation**, not deferral: AsyncStorage cross-tenant persistence, `percyBundleUrl` launch-arg hijack, `console.log` marker spoofing, customer JS network egress, signing-key single point of compromise.
7. **5-min P75 build target is unattainable as designed.** Sharding, Metro-cache persistence, and direct IPC must move to Phase 1 primitives, not fast-follows. Realistic per-snapshot floor is 2.5–4s, not 1.5s.
8. **MVP gate redefined**: "feature works for one customer" is too soft. Replace with: *"one external customer integrates self-serve from public docs + reference repo, runs ≥10 builds over ≥1 week with zero synchronous engineer assistance."*
9. **Five new risks added (R10–R14)** with explicit mitigations: signing-key compromise, App Store distribution restrictions on remote JS, New Architecture compat fragmentation, reference-repo bit-rot, dogfood-project single-point-of-failure.

### Critical Mitigations — Required Before Phase 1 Implementation Starts

These are **not** discretionary improvements; they fix material technical or security flaws in the original plan.

#### M1. Replace log-tail IPC with WebSocket + HMAC-nonce channel

**Problem:** `[percy:ready]` over `console.log` → `idevicesyslog`/`adb logcat` is lossy at scale: ~1KB iOS log line truncation, iOS 15+ log rate-limiting drops messages under load, no ordering guarantees vs render commit, 100–500ms parse latency per direction (ready + next ack = up to 1s/story = 100s of session budget for 100 stories). Customer JS can also call `console.log('[percy:ready] story_id=X')` and spoof the orchestrator into baselining blank screens.

**Mitigation:**
- Shell opens a localhost WebSocket on boot; orchestrator port-forwards via `adb reverse` (Android) / `iproxy` (iOS).
- Message schema: `{type, story_id, seq, ts, hmac}` with monotonic sequence numbers (drop detection) and per-session HMAC the customer JS cannot derive (spoof prevention).
- Add `accessibility-id="percy-status"` element on the shell as a third-tier polling fallback for environments where WebSocket port-forwarding is blocked.
- Keep `[percy:fatal]` console marker as a failsafe diagnostic only.
- Specify in §Components item 2 + §Interaction Graph step 4 + §Acceptance Criteria.

#### M2. Bundle loading via RCTReloadCommand + fingerprint pinning

**Problem:** Plan says shell "fetches JS bundle, hands to RN's bundle-load API." Bare RN does not expose a clean public post-launch bundle-load API — `RCTBridge.bundleURL` is consumed at bridge init; reload requires `DevSettings.reload()` (debug-only) or rebuilding the bridge. Hermes bytecode bundles must match the Hermes version compiled into the host. New Architecture (Fabric/TurboModules) registers components at *build time* via codegen — JS referencing TurboModule specs not codegen'd into the shell will fail at *runtime*, invisible to static analysis.

**Mitigation:**
- Adopt the **EAS Update / former-CodePush pattern**: shell receives `percyBundleUrl` + bundle SHA-256 digest at boot, fetches bundle to local cache, verifies digest, hands to `RCTReloadCommand` to restart the bridge with the new bundle as entry. **One device session = one bundle = one bridge lifetime.**
- Hermes engine + version + New Architecture flag pinned in shell manifest; pre-upload gate refuses bundles compiled against mismatched engine.
- Store bundles fresh per session, never persist across sessions (avoid stale-cached-bundle UX bugs that bit CodePush).
- References: [EAS Update — fingerprint runtime versions](https://docs.expo.dev/eas-update/runtime-versions/); [Migrate from CodePush context](https://docs.expo.dev/eas-update/codepush/).

#### M3. Layered pre-upload validation gate (replace "100% static detection")

**Problem:** Static analysis cannot detect: TurboModule spec mismatches resolved at runtime via `TurboModuleRegistry.getEnforcing`, native view managers referenced by string in `requireNativeComponent`, version skew within an allowed module (shell has reanimated 3.6, customer compiled against 3.10 API), native asset mismatches (fonts, drawables), Hermes/JSC bytecode mismatch. The 100% NFR is unmeetable. EAS fingerprint flapping (issues [#2448](https://github.com/expo/eas-cli/issues/2448), [#2615](https://github.com/expo/eas-cli/issues/2615)) shows even Expo's mature fingerprinting has documented false negatives.

**Mitigation:**
- **Layered gate with two stages:**
  1. **Static manifest check** (already in plan): walks Metro bundle's resolved imports, cross-references against shell's manifest. Catches direct-import mismatches.
  2. **Dynamic preflight** (new): spin up the shell once on a single emulator (cheaper than a full device session) with the customer bundle, run a 60-second "import smoke" pass that loads each story without rendering, captures any runtime errors. Only on success → reserve the full device matrix.
- Reword acceptance NFR (§Non-Functional Requirements): *"Pre-upload gate detects 100% of statically-detectable mismatches; dynamic preflight catches runtime mismatches before full-matrix device reservation."*
- Add `error_code=preflight_runtime_error` to error catalog with the runtime error message surfaced verbatim.

#### M4. Multi-tenant device isolation hardening

**Problem (security review):** Shell on shared real devices + bundled `@react-native-async-storage/async-storage` = cross-tenant data persistence. Customer A's bundle writes a sentinel; Customer B's bundle reads it. Same risk for clipboard, NSURLCache, WebView local storage, keyboard cache.

**Mitigation:**
- **Drop `@react-native-async-storage/async-storage` from the MVP bundled-module list.** It has no legitimate visual-testing purpose. Re-add only on customer request with a security review.
- Mandate post-session device reset: orchestrator uninstalls + reinstalls the shell between tenant sessions (iOS: WDA `installApp`/`removeApp`; Android: `pm uninstall` + reinstall).
- Add explicit clears for clipboard + keyboard cache in shell `applicationWillTerminate` / `onDestroy`.
- New §Acceptance Criteria item: *"No customer-writable persistence survives session boundary; verified by an integration test that writes a sentinel in tenant A and asserts tenant B cannot read it."*

#### M5. `percyBundleUrl` tenant binding + capability sandboxing

**Problem:** Launch-arg `percyBundleUrl` lacks tenant binding (can be hijacked into another tenant's session); customer JS bundle has unrestricted access to `fetch`, `XMLHttpRequest`, WebSocket, file system → can exfiltrate via network or bridge attacks via bundled native modules (`react-native-svg` has historical XXE/network-fetch CVEs).

**Mitigation:**
- **Pass an opaque single-use 5-minute build-scoped session token** via launch arg, not the raw signed URL. Shell exchanges the token at a Percy auth endpoint for the bundle URL + SHA-256 digest. Token validates `(build_id ↔ device_session_id ↔ tenant_id)`.
- Shell verifies SHA-256 of fetched bundle before evaluation.
- Restrict bundle host to a fixed Percy domain; reject any other host.
- **Capability-restrict the JS sandbox**: bootstrap overrides global `fetch`, `XMLHttpRequest`, WebSocket; iOS `NSAppTransportSecurity` and Android network security config deny outbound except the Percy bundle host.
- Bundle upload endpoint: server-side streaming size cap (50 MB hard, kill-connection), per-tenant blob prefixes with IAM-enforced isolation, single-use upload token bound to `(project_id, build_id)`.
- Promote §Quality Gates "Security review of bundle-upload endpoint" from checklist to **Phase-1 hard blocker**.

#### M6. Code-signing key management (new R10)

**Problem (maintainability + security):** iOS distribution certs/profiles + Android upload-key compromise = silent supply-chain attack against every Percy customer's device sessions. Plan says nothing about HSM storage, rotation, or break-glass.

**Mitigation:**
- iOS distribution cert + Android release key stored in cloud HSM (GCP KMS / AWS CloudHSM); signing performed by a controlled CI signer that holds no key material at rest.
- Two-person approval to release a new shell artifact to production artifact store.
- Annual rotation runbook documented in internal runbook (§Documentation Plan); calendar-driven CI alerts at T-60d, T-30d, T-7d for cert/profile expiry.
- Quarterly tabletop: rebuild + re-sign a shell from a clean machine using only documented secrets.
- Use Google Play App Signing so Percy holds only the **upload key**, not the irreplaceable app-signing key.
- New row in §Risk Analysis (see R10 below).

#### M7. iOS distribution path = enterprise/ad-hoc, not TestFlight

**Problem (feasibility):** Plan implies "TestFlight-style internal distribution" for the Percy shell, but App Store review will reject "downloads and executes remote JavaScript" for non-Expo apps. Real path is **Apple Developer Enterprise Program** (in-house) or **ad-hoc** with UDID-registered BrowserStack devices — both with weeks-long approval cycles and acceptable-use restrictions Percy must confirm.

**Mitigation:**
- Phase 0 task list: explicitly choose distribution path. Recommendation: enterprise certificate (in-house) for shell distribution to BrowserStack devices.
- New Phase 0 dependency: *"Apple Developer Enterprise Program eligibility confirmed — audit acceptable-use restrictions for Percy's use case."* Engage in week 1.
- **Revise Phase 0 timeline from 4–6 weeks to 6–8 weeks.** Code signing setup is the long pole.

#### M8. Sharding + Metro cache + direct IPC = Phase 1 performance primitives

**Problem (performance review):** 200 snapshots in 5 minutes = 1.5s/story. Realistic floor is 2.5–4s/story per device on real hardware. With 100 stories sequential per device, P75 lands at 4–7 minutes. Cold Metro bundle is 45–90s on CI without cache. Log-tail IPC adds ~100s/100-story session.

**Mitigation:**
- **Sharding as Phase 1 primitive**: shard 100 stories across N parallel device sessions of the same OS. `shards: auto` config; orchestrator splits by stable hash of `story_id`. Restate SLA as "P75 wall-clock with default sharding."
- **Metro cache persistence across CI runs** via standard CI cache key `hash(package-lock.json + .storybook/**)`. Document and ship as part of `init`. Cold bundle 45–90s → 8–15s.
- **Direct WebSocket IPC** (M1) saves ~50–100s/100-story session vs. log-tail.
- Add P75/P95 build-time, per-story render-time histogram, Metro-bundle-time as **first-class telemetry from Phase 1** (not Phase 3 monitoring). Without these, the 5-min target cannot be defended pre-GA.
- Treat capacity uplift as **Phase 0 dependency**, not Phase 2 monitoring item. Gate beta open behind a dedicated component-testing pool OR confirmed core-pool headroom of ≥3× current peak. Per-tenant concurrent-build cap (5) bounds runaway tenants.

### Per-Section Enhancements

#### §Components / §Architecture

- **Architecture cleanup (architecture-strategist):** Introduce a `BuildOrchestrator` interface in App Percy backend with concrete `WebOrchestrator`, `AppOrchestrator`, `StorybookRNOrchestrator` implementations selected by `build_type`. **Forbid `if build_type ==` branches outside the factory** (lint rule / architecture test). Prevents the new discriminator from spreading through the codebase as a leaky abstraction.
- **Per-platform bundles from day one (architecture-strategist):** Default to per-platform bundles (`bundle.ios.js`, `bundle.android.js`) instead of deferring to Phase 2. Marginal cost is one extra Metro invocation; both parallelizable. Schema: store `bundle_ios_url` + `bundle_android_url` (nullable, mutually exclusive with `bundle_url`) on the build row. **Avoids a breaking schema change later** (R7 mitigation).
- **Shell artifact key by manifest hash, not RN version (architecture-strategist):** Shell artifact keyed by `sha256(rn_version + arch_flag + native_modules_sorted)` rather than RN version alone. Customer's `package.json` resolves to a manifest hash; CLI looks up shell by hash. Multiple shells per RN version coexist cleanly.

#### §Pre-Upload Validation Gate

- **Collapse 4 checks → 2 (scope-guardian + simplicity consensus):** Reframe as: (1) `metro-bundle-and-validate` — single Metro invocation that produces the bundle, walks its module graph, cross-references against shell manifest, and enforces size cap (combines original checks 1, 2, 4 because they're side-effects of the same operation); (2) `rn-version-check` — one-liner against `package.json`. **Inflated "four checks" to "two checks" reduces CLI surface and shared error formatter.**
- **Add a third stage: dynamic preflight** (M3) — spin up shell once on emulator before reserving full matrix.

#### §Backend Schema Extensions

- **Drop `component_name` and `args_hash` columns (simplicity):** Ship only `story_id`. Derive component name in dashboard via `split('/')[0]`. Drop `args_hash` until grouping UI exists. **Removes one migration column and defers another.**
- **Future-proof container (architecture-strategist):** Co-locate any future Storybook-specific snapshot metadata behind a `snapshot_metadata` JSONB column or `snapshot_storybook_metadata` join table guarded by a feature flag. Decide via a follow-up ADR before column #4 lands.

#### §`init` Command

- **Drop AST-editing of `.storybook/main.{js,ts}` (scope-guardian + simplicity + design-lens consensus):** Brittle across JS/TS/ESM/CJS variants (4-config-format test matrix in Quality Gates is the tell). Replace with: `init` drops `.percy.yml` + prints a copy-paste 6-line block with the literal next command (`percy storybook-rn --dry-run`) + inlines a 3-story `Button.stories.tsx` if no stories exist. Reference repo becomes a fallback, not the primary path.
- **Reference repo as workspace in SDK monorepo (maintainability):** Add reference repo as a workspace/subdirectory of the SDK monorepo (or git submodule) so it's exercised by SDK CI on every PR. Add a daily scheduled GitHub Action in the public repo that runs `percy storybook-rn --dry-run` against the latest published SDK; fail loudly via Slack webhook + visible README badge.

#### §CLI Ergonomics

- **CLI progress format spec (design-lens):** Append-only lines (no cursor movement; CI-safe across Buildkite/CircleCI/GHA), heartbeat every 10s, ETA after first 5 stories complete. Fixed format example:
  ```
  [percy:storybook-rn] iOS-17  [====    ] 23/40  Button/Disabled (4.2s)
  [percy:storybook-rn] And-14  [===     ] 19/40  Card/WithImage  (2.8s)
  ```
- **Drop `--dry-run` flag (simplicity):** Replace with `storybook-rn:` config key `dryRun: true` or `PERCY_DRY_RUN` env var. CLI exposes only `--include`.
- **Add `percy storybook-rn doctor` (product-lens):** Local-only Phase 1 deliverable. Runs the full pre-upload validation gate without uploading. Surfaced in `init` next-steps output as the explicit step before first CI run. **Eliminates the "first-real-signal-after-5-min-build" feedback latency that kills self-serve adoption.**

#### §Snapshot Naming Convention

- **Re-order to put device LAST (design-lens):** `{ComponentName}/{StoryName}/{ArgsHash}/{Device}` — pushes Device to the leaf so iOS+Android renders of the same variant become *adjacent rows* in the alphabetically-sorted flat dashboard view. Cognitive-load improvement for reviewers at scale.
- **Coherence fix (coherence-reviewer):** Document explicitly: SDK populates both the canonical snapshot `name` AND the structured `story_id` field (the latter for future grouping UI). The naming convention is the MVP display; `story_id` is the structured data contract for Phase 3+ grouping UI.

#### §Phasing

- **Collapse Phase 2 into Phase 1 (simplicity):** "Internal dogfood + design partners" with 3–4 week budget is success criteria of Phase 1, not a phase. Renumber to **3 phases**: Phase 0 (Shell), Phase 1 (SDK + dogfood + design partners), Phase 2 (Docs + Beta + GA).
- **Collapse Phase 0 to one shell line (scope-guardian + simplicity):** Hardcode `const SHELL = { version: '1.0.0', rnRange: '>=0.75.0 <0.76.0', modules: [...] }` in the SDK code. Delete the manifest JSON format and version-selection logic. Reintroduce a manifest only when shell count > 2.

#### §Acceptance Criteria

- **Redefine MVP gate (product-lens):** *"One external customer integrates self-serve from public docs + reference repo, runs ≥10 builds over ≥1 week with zero synchronous engineer assistance. Time-to-first-green-build is the headline metric."* Replaces the current "feature works for one customer" gate.
- **Add billing unit definition (coherence-reviewer):** *"1 snapshot = 1 story rendered on 1 device. Component build (50 stories × 2 devices) = 100 snapshot quota deductions. No batch discounts in MVP."*
- **Standardize R3 vs AC threshold (coherence-reviewer):** Use 5% for both contention and core-build P75 regression. Phase 3 GA only proceeds if Phase 2 observes contention < 5% AND regression < 5%.

#### §Error Catalog (new appendix)

Add as new appendix — **acceptance contract for Phase 1**:

| `error_code` | Message body | Exit | Next-step |
|---|---|---|---|
| `no_stories_found` | "No stories found. Check your storybook config or .stories.tsx files." | 1 | "Run `percy storybook-rn doctor` to diagnose." |
| `module_not_in_shell` | "Module 'react-native-X' not in Percy shell. Bundled: [list]." | 1 | "Run `percy storybook-rn --list-shell-modules` for full list. Custom modules supported in a future release." |
| `rn_version_mismatch` | "RN 0.71.4 not supported. Available shells: 0.75.x." | 1 | "Upgrade `react-native` or pin to a supported version." |
| `bundle_too_large` | "Bundle X MB exceeds 50MB cap." | 1 | "Use `--include` to reduce, or extract assets via `assets:` config." |
| `metro_compile_error` | "Metro bundle failed: [error]." | 1 | "Fix the bundler error; re-run." |
| `preflight_runtime_error` | "Preflight smoke-load failed: [runtime error verbatim]." | 1 | "Module not codegen'd into shell, or runtime API mismatch. Run `--list-shell-modules`." |
| `quota_exceeded` | "Quota exceeded. X/Y snapshots captured." | 0 (soft) | "Use `--include` to filter, or upgrade plan." |
| `partial_validation` | "Validated 39/40 stories. 1 failed: Card/Broken (SyntaxError at line 12). Proceed with 39?" | 0 with `--accept-partial`; 1 otherwise | "Fix the failing story, or pass `--accept-partial` to skip." |
| `include_zero_match` | "No stories matched --include='X'. Discovered 40 stories; none matched." | 1 | "Adjust your `--include` pattern." |

### Updated Risk Register — New Rows R10–R14

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| **R10**: Shell signing-key compromise (silent supply-chain attack) | Low | Critical | M6: HSM-backed signing, dual-control approval, annual rotation runbook with T-60d/30d/7d expiry alerts, Google Play App Signing for Android (Percy holds only upload key) |
| **R11**: App Store / distribution restrictions on remote JS execution | Medium | High | M7: Use enterprise/ad-hoc distribution; engage Apple Developer Enterprise Program eligibility in Phase 0 week 1; document acceptable-use review |
| **R12**: New Architecture (Fabric/TurboModules) compat fragmentation across third-party native modules | High | Medium | Pin shell to New Architecture + Hermes V1 (default since RN 0.84). Maintain a public "New-Arch compatibility list" in shell manifest; pre-upload gate refuses bundles with modules not on the list. Old Architecture support deferred indefinitely. |
| **R13**: Reference example repo bit-rots vs SDK API changes | High | Medium | Reference repo as workspace in SDK monorepo + daily scheduled CI smoke; visible README badge; SDK-version footer auto-injected at doc-build time |
| **R14**: Single dogfood project = single point of failure for nightly integration tests | Medium | Medium | Replace with Percy-owned `e2e-fixtures/` directory of pinned golden Storybook RN apps (one per supported RN line) committed alongside shell repo. Snapshot baselines in-repo, PR-reviewed. Keep one "wild" dogfood run as informational smoke signal only. |

### Maintainability Hardening (steady-state operations)

- **Shell lifecycle as `shells.yaml` manifest** with explicit `supported_until` dates per RN line. CI fails if more than 3 lines are "active" simultaneously. Auto-open sunset PR 90 days before EoL. Track per-shell `last_used_at` from telemetry; downgrade to "cold" (rebuild on demand only) after 30 days of zero customer builds. Named owner rotation in CODEOWNERS for the shell repo.
- **Hard cap on bundled native modules** (initial: 15) with public inclusion criteria (active maintenance, ≥10K weekly downloads, no peer-conflicting deps). Pin module versions in a lockfile committed to the shell repo. Quarterly review tied to `RNStorybookCLIError` `error_code=module_not_in_shell` telemetry. Long-tail customers offered the documented "custom shell as paid service" path (R2 fallback) rather than left blocked.
- **Shell manifest as semver public API**: major bump required for module removals or major version upgrades. Pre-upload gate compares not just module presence but version range; warn on minor bumps, fail on major. 6-week deprecation window before removal; keep N-1 shell available.
- **Generate the support-matrix doc page** directly from the shell manifest JSON in CI. Block SDK release if the matrix file is stale. Embed version-stamped "last verified against SDK X.Y" footer auto-injected at doc-build time.

### Product Hardening (post-GA accountability)

- **Lock in a 60-day post-GA review** with named owner, three pre-committed tripwires (active-projects floor, FP rate ceiling, quota-driven disable rate), and a written sunset criterion. Put it on the calendar before Phase 2 ships.
- **Document the fidelity gap explicitly**: support matrix names "what Percy shell does and does not match in your app" (RN version range, native module versions, Hermes vs JSC, New Architecture). Optional `percy storybook-rn verify-shell` command boots one customer story locally against shell to flag drift.
- **Re-meter pricing decision before GA, not after**: choose explicitly between (a) component-snapshot SKU at lower per-unit cost reflecting cheaper render, (b) bill per story-render not per-device-snapshot (so adding a device doesn't 2× cost), or (c) free tier of N component-snapshots per build to neutralize the "skip on PR" incentive. The current "same App Percy quota" decision will fight the Phase 2 "≥50% running on every PR" engagement metric.
- **Add escape hatches at each friction point**: (a) `init` detects no Storybook RN and offers to install it; (b) RN version mismatch error includes "request shell for 0.X" link that files a tracked issue; (c) custom-module failure surfaces a "stub this module" config option that renders a placeholder so the rest of the bundle still snapshots.

### References (deepening sources)

- [EAS Update — fingerprint runtime versions](https://docs.expo.dev/eas-update/runtime-versions/) — pattern for binary↔bundle compatibility pinning
- [Migrate from CodePush context (Expo docs)](https://docs.expo.dev/eas-update/codepush/) — pitfalls in production OTA-bundle deployment
- [eas-cli #2448 — fingerprint flapping](https://github.com/expo/eas-cli/issues/2448) — documented false-negative mode for static-analysis pre-flight gates
- [Storybook RN testing docs](https://storybookjs.github.io/react-native/docs/intro/testing/) — programmatic story enumeration + ready signals
- [Sherlo — RN Storybook visual testing](https://sherlo.io/) — closest commercial analog to Percy's design
- [AppRegistry — React Native](https://reactnative.dev/docs/appregistry) — bundle entry semantics
- [React Native 0.84 + Hermes V1 guide](https://rorklab.net/en/articles/rork-dev/react-native-084-hermes-v1-guide) — current stable engine baseline (2026)
- [BrowserStack vs AWS Device Farm — isolation models](https://www.browserstack.com/guide/aws-device-farm-alternatives) — shared-device sandboxing patterns

### Action Items — Recommended Plan Amendments (apply to plan body before `/ce:work`)

The following are the concrete edits needed to the plan body above (numbered for tracking; high-impact items in bold):

1. **§Components item 2 (Percy Shell):** Drop `@react-native-async-storage/async-storage` from initial bundled module list (M4).
2. **§Components item 2 + §Interaction Graph step 4:** Replace `[percy:ready]` log-tail IPC spec with WebSocket + HMAC + nonce control channel (M1).
3. **§Components item 2:** Replace `percyBundleUrl` raw signed URL launch arg with single-use 5-min build-scoped session token; shell exchanges at auth endpoint for URL + SHA-256 digest (M5).
4. **§Components item 3:** Reframe four pre-upload checks as two checks + add dynamic preflight stage (M3).
5. **§Components item 5:** Drop `component_name` and `args_hash` columns; ship only `story_id` (simplicity).
6. **§Components item 6 (NEW):** Add `BuildOrchestrationStrategy` interface; forbid `if build_type ==` outside the factory.
7. **§Implementation Phases / Phase 0:** Revise timeline 4–6 weeks → **6–8 weeks**; add Apple Developer Enterprise Program eligibility task in week 1 (M7).
8. **§Implementation Phases / Phase 0:** Collapse to one shell line; hardcode shell constant in SDK; delete manifest JSON infrastructure.
9. **§Implementation Phases / Phase 1:** Add sharding + Metro cache persistence + direct IPC + telemetry as Phase 1 primitives (M8).
10. **§Implementation Phases:** Collapse Phase 2 into Phase 1; renumber Phase 3 → Phase 2 (simplicity).
11. **§Acceptance Criteria:** Replace MVP gate with self-serve adoption gate (product-lens).
12. **§Acceptance Criteria (NEW):** Billing unit definition (coherence).
13. **§Acceptance Criteria:** Drop AST-editing requirement from `init`; add copy-paste output + sample story drop.
14. **§Acceptance Criteria (NEW):** Add `percy storybook-rn doctor` as Phase 1 deliverable.
15. **§Snapshot Naming Convention:** Re-order to `{Component}/{Story}/{ArgsHash}/{Device}` (device last).
16. **§Risk Analysis:** Add R10–R14 rows.
17. **§Risk Analysis R3:** Standardize threshold at 5% (not 5% / 10% conflict).
18. **§Documentation Plan:** Add support-matrix auto-generation from shell manifest; add quota math explainer (already in plan); add fidelity-gap section.
19. **NEW §Error Catalog appendix:** 9-row table (acceptance contract).
20. **§Future Considerations:** Move `parameters.percy.waitFor` to Future Considerations (keep `.skip` for MVP).

### Quality Checks

- [x] All original content preserved (this addendum is appended; no rewrite)
- [x] Research insights clearly attributed to reviewers
- [x] Code examples (CLI progress format, error catalog) are concrete
- [x] External references are current (2024–2026 sources)
- [x] No contradictions with existing sections (amendments listed for explicit follow-up)
- [x] Enhancement summary accurately reflects ~50 distinct findings synthesized into ~20 trackable amendments

---

## Framework Constraints — Confirmed Implementation Path (post-deepening)

The framework-docs research surfaced **two material refinements that simplify the architecture vs. the original plan and the deepening addendum.** Both should be incorporated as primary path, with the more pessimistic options retained as fallbacks only.

### F1. Use Storybook RN's existing WebSocket protocol (port 7007), don't invent a new one

**Finding:** `@storybook/react-native` v9.1.4+ already runs an on-device WebSocket server on port 7007 (`enableWebsockets: true`, default in v10). Official protocol includes `{ type: 'setCurrentStory', args: [{ viewMode, storyId }] }` for remote story selection. v10.2 adds an `experimental_mcp` HTTP endpoint at `/mcp`. **This is the same channel Storybook's own dev tooling uses — it's stable, documented, and shipping.**

**Implication for M1 (replace log-tail IPC):** The deepening addendum's M1 mitigation said "Shell opens a localhost WebSocket on boot." That's correct, but **we don't need to invent the protocol** — we connect to Storybook RN's existing socket. Percy's shell + orchestrator become a *client* of Storybook RN's existing tooling protocol, not a new bridge.

**Refined implementation:**
- Shell boots, Storybook RN's runtime starts the WebSocket on `:7007`.
- Orchestrator port-forwards `7007` via `adb reverse` (Android) / `iproxy` (iOS) and connects as a WebSocket client.
- Story navigation: orchestrator sends `{ type: 'setCurrentStory', ... }` — same message Storybook's web tooling sends.
- **Ready signal**: register a Percy decorator in the shell's preview config that hooks `useEffect` on mount + idle, sends `{ type: 'percy:ready', storyId, seq, hmac }` over the same socket. No protocol fork — Storybook ignores unknown message types.
- **HMAC-nonce for spoof prevention** (M3 from the deepening) still applies: customer JS doesn't know the nonce, can't spoof `percy:ready`.
- **Fallback:** if port 7007 is unavailable (older Storybook RN, port-forward fails), fall back to `[percy:ready]` log-tail with HMAC prefix.

**Net result:** Lower implementation risk. Less code to maintain. **The IPC concern from feasibility/architecture/performance reviewers is materially de-risked** — we ride on Storybook's protocol stability, not Percy-invented log parsing.

**Source:** [Storybook RN WebSockets and tooling blog (Feb 2026)](https://github.com/storybookjs/react-native/blob/next/docs/blog/2026-02-18-websockets-and-tooling.md).

### F2. iOS distribution: dev-signed shell + BrowserStack auto-resign — DO NOT use Apple Developer Enterprise Program

**Finding:** BrowserStack's documented behavior is to **auto-resign uploaded `.ipa` with its own wildcard provisioning profile** by default. Customers can upload a dev-signed (or even unsigned) `.ipa` and BrowserStack handles installation. Sauce Labs and AWS Device Farm follow similar resign-on-upload models. The `get-task-allow` entitlement (required for some debug instrumentation) is **stripped by enterprise/distribution profiles** but **preserved on development profiles** — use a development profile for the shell, then let the device cloud resign.

**Apple Developer Enterprise Program is actively risky:** Apple revokes accounts that distribute Enterprise-signed apps outside the issuing organization. A Percy-distributed shell on shared device clouds could trigger revocation of Percy's entire Apple Developer Enterprise account.

**Implication for M7 (iOS distribution path):** The deepening addendum recommended Enterprise Program eligibility as a Phase 0 dependency with multi-week approval. **That's wrong.** The simpler, safer, faster path is:

- Build the Percy shell `.ipa` with a **development provisioning profile** from Percy's existing Apple Developer team account (no Enterprise Program needed, no UDID list collection, no acceptable-use review).
- Upload to BrowserStack via standard `.ipa` upload. BrowserStack auto-resigns with its wildcard profile.
- For Sauce Labs: same — auto-resigns on upload.
- For AWS Device Farm or self-hosted device labs (post-MVP): document an Ad Hoc fallback path with UDID registration as needed.

**Net result:**
- **Phase 0 timeline returns to 4–6 weeks** (the deepening's revised 6–8 weeks was based on the now-rejected Enterprise approach).
- R11 (App Store / distribution restrictions) downgrades from High → Low impact: dev-signed + cloud-resign is the documented, supported path for every major device cloud.
- One fewer Phase 0 dependency (no Enterprise Program eligibility task).

**Sources:**
- [BrowserStack iOS app resigning](https://www.browserstack.com/docs/app-automate/appium/resign-ios-apps)
- [BrowserStack UDID FAQ](https://www.browserstack.com/support/faq/app-automate/app/to-run-ios-apps-do-i-need-to-add-browserstack-ios-devices-udid-to-my-provisioning-profile)

### F3. SDK structure: mirror `@percy/cli-app`, not `@percy/storybook` web

**Finding:** Percy CLI plugin pattern uses `@percy/cli-command` (yargs-based command bus, not oclif). Plugins auto-register via `package.json` `"@percy/cli": { "commands": [...] }` declaration. **Critically:** `@percy/sdk-utils` and the local `:5338` snapshot server target browser SDKs that POST DOM snapshots — App Percy uses a different upload path (build creation + per-snapshot device-orchestrator triggers). The brainstorm decision "follow `@percy/storybook` web SDK conventions" was correct *for CLI ergonomics* (flag names, addon pattern) but **wrong for the upload pipeline** — the SDK should structurally mirror `@percy/cli-app`, not `@percy/storybook` web.

**Implication:**
- Mirror **CLI surface and naming conventions** from `@percy/storybook` web (decision unchanged — drives customer mental-model parity).
- Mirror **upload pipeline + build orchestration** from `@percy/cli-app` (new — reuses App Percy's existing build/snapshot API auth via `@percy/client`, not the local `:5338` server).
- Do **not** depend on `@percy/sdk-utils.postSnapshot()` — go direct to Percy API via `@percy/client`.

This is a clarification, not a re-architecture. It pre-empts an implementation-time confusion that would otherwise surface in Phase 1 code review.

### F4. Confirmed: Hermes bytecode is RN-minor-locked → multi-version shell is forced, not optional

**Finding:** Bundled Hermes guarantees JSI compatibility *within an RN minor only*. A Hermes-built shell loads only Hermes bytecode bundles compiled for the same minor. There is no "compat across minors" path.

**Implication:** R1 (multi-version shell maintenance burden) is structurally unavoidable, not a design choice. Maintainability mitigations (lifecycle manifest, hard cap, sunset PRs) are critical, not optional. Confirms the deepening addendum's hardening plan is the right path.

**Refined recommendation:** **Narrow initial GA to RN 0.76+ only** (Hermes V1 + New Architecture default), and explicitly list "Old Architecture not supported, RN < 0.76 not supported" as validation-gate failures with clear upgrade messaging. Two shell lines (0.76.x, 0.77.x) at GA, expanding to 3 only as RN releases land. This keeps the operational footprint to the floor.

### F5. Metro programmatic API constraints

**Finding:** `Metro.runBuild(config, { entry, platform, out, dev:false, minify:true, sourceMap:true })` is the supported async API. Metro requires a real entry file — the CLI must generate a synthetic entry (`__percy_entry.js`) that `require()`s `storybook.requires.js` (auto-generated by `@storybook/react-native` from the stories glob). Assets emitted as a separate manifest, not inlined — must be uploaded alongside the bundle.

**Implication:**
- §Components item 1 implementation note: CLI generates `__percy_entry.js` at runtime with `transformer.hermesParser` matched to shell engine, `dev:false`, `minify:true`, `inlineSourceMap:false`.
- §Components item 5 (backend storage) needs to handle **bundle + asset manifest** as paired uploads, not single-file. Schema: `bundle_url` + `assets_archive_url` (nullable). Update F1 amendment list accordingly.

**Source:** [Metro API reference](https://github.com/facebook/metro/blob/main/docs/API.md).

### Summary of Framework-Confirmed Refinements

| Item | Original/Deepening Said | Framework Research Confirms | Action |
|---|---|---|---|
| F1 | Custom WebSocket IPC with Percy-invented protocol | Storybook RN already runs WebSocket on :7007 with documented protocol | Use Storybook's existing socket as primary; HMAC-nonced custom messages over same channel |
| F2 | Apple Developer Enterprise Program required, +2 weeks Phase 0 | BrowserStack auto-resigns with wildcard profile; Enterprise Program is actively risky | Use development profile + cloud auto-resign; Phase 0 returns to 4–6 weeks |
| F3 | Mirror `@percy/storybook` web SDK | CLI: yes. Upload pipeline: mirror `@percy/cli-app` instead | Document the split explicitly in implementation plan |
| F4 | Multi-version shell strategy "for compat" | Multi-version is structurally forced by Hermes JSI versioning | Narrow GA to RN 0.76+ Hermes V1 + New Arch (no Old Arch ever) |
| F5 | Bundle is single JS file | Bundle + separate asset manifest required | Schema needs paired upload URLs; bundle + assets archive |

### Net Impact on Plan

- **Phase 0 timeline: confirmed 4–6 weeks** (the deepening's 6–8 week revision was conservative for the now-rejected Enterprise path).
- **IPC implementation risk: materially reduced** — riding Storybook's WebSocket vs inventing one.
- **R11 severity: High → Low** (cloud auto-resign is the documented path).
- **R12 (New Arch fragmentation): unchanged but narrowed scope** — only RN 0.76+ Hermes V1 New Arch ever supported.
- **F3 + F5 add concrete implementation guidance** that prevents Phase 1 rework.

### Final References (framework-specific, append to Sources & References)

- [React Native AppRegistry docs](https://reactnative.dev/docs/appregistry)
- [Bundled Hermes architecture](https://reactnative.dev/architecture/bundled-hermes)
- [React Native New Architecture landing](https://reactnative.dev/architecture/landing-page)
- [Metro API reference](https://github.com/facebook/metro/blob/main/docs/API.md)
- [Storybook React Native WebSockets and tooling (Feb 2026)](https://github.com/storybookjs/react-native/blob/next/docs/blog/2026-02-18-websockets-and-tooling.md)
- [Percy CLI repo (`@percy/cli`)](https://github.com/percy/cli)
- [`@percy/cli-command`](https://www.npmjs.com/package/@percy/cli-command)
- [`@percy/cli-app` reference (model for upload pipeline)](https://github.com/percy/cli/tree/master/packages/cli-app)
- [BrowserStack iOS app resigning docs](https://www.browserstack.com/docs/app-automate/appium/resign-ios-apps)
- [iOS App Distribution Guide 2026](https://foresightmobile.com/blog/ios-app-distribution-guide-2026)

