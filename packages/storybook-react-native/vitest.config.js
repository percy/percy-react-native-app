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
        // Floor that reflects the suite as of the regions + review-findings
        // push (149 tests). Two large surfaces drag the line/statement number
        // below the round 80% mark:
        //   - percy/buildAndProvision.js: subprocess (gradle/expo/xcodebuild)
        //     invocation paths — covered for argument shape + error fan-out;
        //     not unit-tested for actual subprocess exec because that hits
        //     real toolchains during CI. Validated end-to-end by the example
        //     repo's `npm run build` pipeline.
        //   - percy/navigator/uiTapStrategy.js: demoted v9-only experimental
        //     path. Validated empirically on the v9 sandbox but the deeply
        //     mocked driver fixtures required for unit coverage would lock
        //     in implementation details we still expect to churn.
        // Raise these alongside new tests; do NOT lower without a comment
        // justifying why coverage is going backwards.
        lines: 75,
        functions: 70,
        statements: 75,
        branches: 75,
      },
    },
  },
});
