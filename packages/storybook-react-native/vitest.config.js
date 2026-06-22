import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['percy/**/*.js', 'src/**/*.js', 'index.js'],
      exclude: [
        // CLI command harness — composed from @percy/cli-command, exercised
        // end-to-end via runner.test.js. Unit coverage would be tautological.
        'src/commands/**',
        // Legacy Phase 1 metro-channel CLI path. The library-mode API
        // (percyStorybookSnapshot + provisionApp) is the canonical surface
        // for v0.2+; these files remain for backwards-compat with the
        // original `npx percy storybook-rn` flow and are integration-tested
        // via `test/runner.test.js`.
        'src/runner.js',
        'src/appium-client.js',
        'src/storybook-channel.js',
        // Telemetry shim — best-effort POST to Percy backend, no-op when
        // unreachable. No business logic to cover.
        'percy/util/postFailedEvents.js',
        '**/*.test.js',
        '**/node_modules/**',
        'coverage/**',
      ],
      thresholds: {
        // GREEN-FLOOR thresholds, set ~5 points below the locally-achieved
        // coverage (~290 tests) so CI on Node 22/24 has headroom and stays
        // green without flapping. Locally achieved (v8, Node 18 dev):
        //   lines 99.66% | statements 99.66% | functions 100% | branches 94.47%
        //
        // The two previously-large gaps are now fully line-covered via
        // mock-based behavioral tests (no source exclusions):
        //   - percy/buildAndProvision.js → 100% (node:child_process spawn faked;
        //     gradle/expo/xcodebuild paths driven via a queued fake-child).
        //   - percy/navigator/uiTapStrategy.js → 100% lines (Appium driver
        //     mocked + a deterministic virtual clock so the poll/stability/
        //     timeout state machine runs instantly and predictably).
        // Remaining uncovered lines are defensive/dead branches only
        // (apkManifest.js 59-60 unreachable catch; storyParser.js 134-141
        // export-const collection gated unreachable by an upstream `continue`).
        //
        // Raise these alongside new tests; do NOT lower without a comment
        // justifying why coverage is going backwards.
        lines: 94,
        functions: 95,
        statements: 94,
        branches: 89,
      },
    },
  },
});
