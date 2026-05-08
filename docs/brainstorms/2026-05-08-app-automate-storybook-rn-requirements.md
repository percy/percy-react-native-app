---
topic: App Automate Transport for Storybook-RN Component Testing
date: 2026-05-08
parent_ticket: PER-7859
parent_brief: https://browserstack.atlassian.net/wiki/spaces/PER/pages/6168216344/
status: brainstorm-complete
builder: Aryan Kumar
mode: percy-builder/ce-brainstorm-mentor (TB-backed, in-chat)
---

# Requirements: App Automate Transport for Storybook-RN Component Testing

This document captures the brainstorm-mentor outcomes for adding App Automate as a device-hosting option for the Storybook-RN component-testing SDK shipped under PER-7859. It is the origin document for the plan that follows.

## 1. Problem Statement

Customers who already use Percy with `@percy/storybook` for **web** Storybook want the **native equivalent** for their React Native component libraries. Today, no path delivers it on the BrowserStack platform their Appium-driven CI already runs against.

The local-Sim Storybook-RN SDK (PER-7859) shipped that path for laptop workflows — but it cannot run in the Linux CI most QA/SDET teams use, because iOS Simulator is Mac-only.

**Reasoning:** This is a *consolidation pitch*, not an iOS-CI-coverage pitch. iOS-in-Linux-CI is incidental upside, not the headline.

## 2. User Personas

* **PRIMARY — QA / SDET running Appium against App Automate in CI.** Already has `percy-appium-js` or `percy-appium-app` in their suite for full-screen E2E snapshots. Wants Storybook-RN component snapshots through the same surface.
* **Frontend RN Developers** maintain the Storybook-RN component library and produce the Storybook host `.apk`/`.ipa`. Already covered for laptop workflows by PER-7859.
* **DevOps / Build Engineers** wire the new test job into CI, manage BS credentials, monitor session-minute consumption.

## 3. Strategic Intent

* **Expansion-led** primary motion (existing App Automate Percy customers extending into RN component coverage).
* **Acquisition** (net-new RN customers adopting Percy for iOS-in-Linux-CI) is incidental upside, not the launch pitch.

## 4. Architecture Decisions

### 4.1 No backend / API / UI changes
Pure SDK delivery. Snapshots land in the existing App Percy build view via the existing `{Component}/{Story}/{Device}` naming convention.

### 4.2 SDK-as-library (not standalone CLI runner)
Customer integrates SDK helpers into their existing Appium test suite. There is no `--transport=app-automate` flag on a top-level command. The story-iteration and snapshot logic is exposed as library functions the customer composes.

### 4.3 Transport auto-detection
SDK inspects the Appium driver's session capabilities at call time:
- `bstack:options` present → App Automate transport
- otherwise → local transport

No flag, no config — inferred at runtime.

### 4.4 SDK owns app provisioning (with escape hatch)
- `provisionApp(localPath)` — uploads to BrowserStack via App Automate Upload API for App Automate, or installs via Appium for local. Caches by app hash to avoid re-upload.
- `useAppReference(ref)` — escape hatch for customers with existing upload pipelines.

### 4.5 Story selection via Appium UI driving
Eliminates the `localhost:7007` Storybook channel server dependency. The SDK taps the in-app Storybook navigator via Appium UI commands. Single approach across local + App Automate.

### 4.6 Integrate with `percy-appium-js` patterns
Build on / integrate with patterns from `github.com/percy/percy-appium-js` rather than reimplement Appium driving + screenshot capture + Percy upload. Reduces duplicate code; gives existing `percy-appium-js` users a familiar mental model.

### 4.7 Storybook host app is separate from production app
Customer maintains a Storybook-enabled `.apk`/`.ipa` distinct from their production app. Component coverage requires a **separate Appium test job** in CI driving the Storybook app. Onboarding docs must call this out prominently.

### 4.8 No explicit `finalize()` in MVP API
Mirror finalization pattern from `percy-appium-js` / `percy-appium-app` — confirm convention during implementation. Percy CLI's `percy exec` wrapper auto-finalizes on test process exit.

## 5. MVP API

```js
import { PercyStorybook } from '@percy/storybook-react-native';

const percy = new PercyStorybook();

// (a) SDK-managed upload (DX default)
const appRef = await percy.provisionApp('./storybook.apk');
// (b) Customer pre-provisions and passes bs:// directly
//     percy.useAppReference('bs://xxxx')

const driver = await wdio.remote({
  capabilities: { /* App Automate caps + app: appRef */ }
});

// (a) SDK-discovered stories (DX default)
for (const story of await percy.discoverStories()) {
  await percy.snapshotStory(driver, story);
}
// (b) Customer-supplied story list
//     for (const s of myExplicitArray) await percy.snapshotStory(driver, s);
```

## 6. Out of Scope (MVP)

- `init` command for App Automate path (SDK-as-library has no scaffold target)
- Standalone CLI runner with `--transport` flag
- Dashboard UI changes / API changes / backend changes
- iOS App Automate (Phase 2 — distribution-signing barrier)
- Configurable BS device matrix (Phase 2)
- Auto-discovery beyond `.rnstorybook/main.{ts,js}` patterns
- Session-chunking helper (only if PoC reveals BS session-time hits)
- Parallel device sessions
- Visual AI / smart-diff tuning
- Direct upstream contribution to `percy-appium-js`

## 7. Instrumentation

Single event, transport inferred from driver capabilities at call time:

| Event | Trigger | Attributes |
|---|---|---|
| `RNStorybookSnapshotCaptured` | Each `snapshotStory()` returns success or failure | `transport` (`local` \| `app-automate`, inferred), `component`, `story`, `device_platform`, `device_name`, `bs_session_id` (if App Automate), `result`, `duration_ms`, `sdk_version`, `rn_version` |

All other PER-7859 events are dropped — build/CLI/dashboard lifecycle is owned by Percy CLI / App Percy backend.

## 8. Success Signals (Qualitative — No Numerical Targets at MVP)

- **Feasibility:** one end-to-end run succeeds against an App Automate Android device using SDK-as-library inside an Appium test
- **Engineering parity:** SDK-as-library serves both transports with transport inferred from driver capabilities
- **Adoption (post-PoC):** at least one design-partner customer extends to native RN component coverage in App Automate CI
- **Performance (post-PoC):** per-story end-to-end time within 2× of local-Sim baseline

## 9. Resolve Before Planning

*(None — the brainstorm-mentor session resolved all blocking items.)*

## 10. Open Questions (Investigate During PoC, Not Blocking Plan)

| # | Topic | Question | Owner |
|---|---|---|---|
| 1 | `percy-appium-js` integration shape | Depend as library? Mirror API? Contribute upstream as sub-module? | Builder + percy-appium-js maintainers |
| 2 | Storybook-RN navigator stability | Stable testIDs/a11y labels for Appium tap-driving on `@storybook/react-native` 10.3.2? | Builder (PoC) |
| 3 | Per-story latency on remote BS | Within 2× local-Sim baseline? | Builder (PoC) |
| 4 | App Automate session time limits | Need session-chunking for 200+ story runs? | Builder (PoC) |
| 5 | App-hash caching | Does BS upload API already de-dup server-side? | Builder (PoC) |
| 6 | Finalization pattern | What do `percy-appium-js` / `percy-appium-app` do? Mirror it. | Builder (read-only) |
| 7 | App Automate session-minute cost model | Forecast per design-partner | Builder + PMM |

## 11. Brainstorm Decisions Log (Reference)

| Lens | Original Direction | Outcome | Final Reasoning |
|---|---|---|---|
| 1 — Problem Validation | Persona = QA/SDET; standalone CLI runner with `--transport` flag | ✏️ Modified | Persona confirmed. Architecture pivots to **SDK-as-library**. Integrate with `percy-appium-js` patterns. |
| 2 — Competitor Benchmarking | "First to market" pitch | 🔄 Overridden | Differentiation deferred / not load-bearing. Pitch is consolidation. |
| 3 — Premium Value & Pricing | Headline: iOS-coverage-in-Linux-CI | 🔄 Overridden | Buying motion is **consolidation** — "we already use Percy + web Storybook, want native equivalent." |
| 4 — Audience & UI Real Estate | Flat list MVP | ✅ Confirmed (tightened) | **No UI changes, no API changes, no backend changes.** Pure SDK delivery. |
| 5 — Tracking & Success | 5 events with `transport` attribute | ✏️ Modified | Reduced to **single event** `RNStorybookSnapshotCaptured`. |
| App provisioning (cross-cutting) | Vague | ✏️ Specified | SDK owns provisioning. `provisionApp` + `useAppReference`. App-hash caching (validate if BS de-dups). |
| 6 — Customer Workflow | Implied integration into existing E2E test | 🔄 Overridden | Storybook host app is separate `.apk`/`.ipa`. Requires separate Appium test job. |
| 7 — Simplicity (`provisionApp` vs customer-handles) | Cut to escape hatch only | ✅ Keep both | DX default + escape hatch. |
| 7 — Simplicity (`discoverStories`) | Cut auto-discovery | ✅ Keep both | DX default + explicit array. |
| 7 — Simplicity (`finalize()`) | Drop from required API | ✅ Confirmed; reference other SDKs | Mirror `percy-appium-js`/`percy-appium-app` pattern. |

## 12. References

- **Parent Task Brief (PER-7859):** https://browserstack.atlassian.net/wiki/spaces/PER/pages/6168216344/
- **Parent plan:** `docs/plans/2026-04-24-001-feat-react-native-storybook-app-percy-plan.md`
- **PoC repo:** https://github.com/percy/percy-react-native-support
- **Reference SDK (JS):** https://github.com/percy/percy-appium-js
- **Reference SDK (Java):** https://github.com/percy/percy-appium-app
- **Storybook for React Native:** https://github.com/storybookjs/react-native
- **BrowserStack App Automate:** https://www.browserstack.com/app-automate
