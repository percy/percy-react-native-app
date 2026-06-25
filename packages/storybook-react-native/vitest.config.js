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
        // Thin I/O wrappers with no branching logic of their own:
        //   - appium-client.js wraps webdriverio's remote()/takeScreenshot()
        //   - storybook-channel.js wraps fetch() against the metro channel
        // Both require a live Appium session / metro server to exercise
        // meaningfully and are covered end-to-end via the example repo run.
        // The orchestration that ties them together (src/runner.js) IS unit
        // tested in test/runner.test.js with these collaborators mocked.
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
        // Floor that reflects the suite as of the post-example-removal +
        // coverage-fillers push (~225 tests). Two surfaces still drag the
        // global numbers down significantly:
        //   - percy/buildAndProvision.js (~213 lines uncovered, 34% stmts):
        //     subprocess (gradle/expo/xcodebuild) invocation paths — covered
        //     for argument shape + error fan-out; not unit-tested for actual
        //     subprocess exec because that hits real toolchains during CI.
        //     Validated end-to-end by the example repo's `npm run build`
        //     pipeline.
        //   - percy/navigator/uiTapStrategy.js (~245 lines uncovered, 34%
        //     stmts / 8% funcs): demoted v9-only experimental path.
        //     Validated empirically on the v9 sandbox but the deeply mocked
        //     driver fixtures required for unit coverage would lock in
        //     implementation details we still expect to churn.
        // Together they account for ~450 of the global uncovered lines.
        // Other modules are 92%+ (most at 100%).
        //
        // Raise these alongside new tests; do NOT lower without a comment
        // justifying why coverage is going backwards.
        lines: 80,
        functions: 85,
        statements: 80,
        branches: 85,
      },
    },
  },
});
