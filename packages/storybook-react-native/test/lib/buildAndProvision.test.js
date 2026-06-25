import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync } from 'node:fs';
import {
  buildAndProvision,
  __forTesting,
} from '../../percy/buildAndProvision.js';

const { detectProjectType } = __forTesting;

let tmp;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'percy-storybook-rn-build-test-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
  delete process.env.BROWSERSTACK_USERNAME;
  delete process.env.BROWSERSTACK_ACCESS_KEY;
});

describe('detectProjectType', () => {
  it('detects Expo by `expo` dependency', async () => {
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ dependencies: { expo: '^54.0.0' } }),
    );
    expect(await detectProjectType(tmp)).toBe('expo');
  });

  it('detects bare RN by `react-native` dependency', async () => {
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ dependencies: { 'react-native': '0.74.0' } }),
    );
    expect(await detectProjectType(tmp)).toBe('bare-rn');
  });

  it('returns unknown for non-RN package', async () => {
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ dependencies: { lodash: '^4.0.0' } }),
    );
    expect(await detectProjectType(tmp)).toBe('unknown');
  });

  it('throws build_failed on missing package.json', async () => {
    await expect(detectProjectType(tmp)).rejects.toMatchObject({
      code: 'build_failed',
    });
  });
});

describe('buildAndProvision — input validation', () => {
  it('throws unsupported_project_type for unknown platform', async () => {
    await expect(
      buildAndProvision({ projectPath: tmp, platform: 'flutter' }),
    ).rejects.toMatchObject({ code: 'unsupported_project_type' });
  });

  it('throws build_failed when projectPath does not exist', async () => {
    await expect(
      buildAndProvision({
        projectPath: '/nonexistent/path/that/does/not/exist',
        platform: 'android',
      }),
    ).rejects.toMatchObject({ code: 'build_failed' });
  });
});

describe('buildAndProvision — iOS bare-RN with no ios/ directory', () => {
  const isDarwin = process.platform === 'darwin';

  function writeBareRnPkg() {
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ dependencies: { 'react-native': '0.74.0' } }),
    );
  }

  // The readdir ENOENT mapping lives *after* the macOS guard in
  // buildIosSimulator, so it's only reachable on darwin. Bare RN (not Expo) +
  // simulator target skips `expo prebuild`, so the missing ios/ dir hits
  // fs.readdir directly — without the mapping that would surface as a raw Node
  // ENOENT, breaking the typed-error contract.
  it.runIf(isDarwin)('maps the readdir ENOENT to a typed build_artifact_not_found (macOS)', async () => {
    writeBareRnPkg();
    await expect(
      buildAndProvision({ projectPath: tmp, platform: 'ios', target: 'simulator' }),
    ).rejects.toMatchObject({ code: 'build_artifact_not_found' });
  });

  // Off macOS (e.g. Linux CI), the earlier toolchain guard fires first — assert
  // that typed error there so the path still has coverage on every platform.
  it.skipIf(isDarwin)('throws build_toolchain_missing for iOS builds off macOS', async () => {
    writeBareRnPkg();
    await expect(
      buildAndProvision({ projectPath: tmp, platform: 'ios', target: 'simulator' }),
    ).rejects.toMatchObject({ code: 'build_toolchain_missing' });
  });
});

describe('buildAndProvision — iOS App Automate signing wall', () => {
  it('throws apple_signing_required for ios + app-automate target', async () => {
    writeFileSync(
      join(tmp, 'package.json'),
      JSON.stringify({ dependencies: { expo: '^54.0.0' } }),
    );
    await expect(
      buildAndProvision({
        projectPath: tmp,
        platform: 'ios',
        target: 'app-automate',
      }),
    ).rejects.toMatchObject({ code: 'apple_signing_required' });
  });

  // The simulator-target path is intentionally NOT mocked here — it
  // shells out to `npx expo prebuild` and `xcodebuild` and is best
  // exercised by integration tests (which require Xcode on a Mac runner).
  // The unit test scope is "the apple_signing_required guard fires for
  // app-automate but not for simulator," which is verified by the
  // app-automate test above (the simulator path enters build territory
  // beyond the early-return guard).
});

describe('buildAndProvision — exposed via top-level index.js', () => {
  it('is exported as a named function', async () => {
    const mod = await import('../../index.js');
    expect(typeof mod.buildAndProvision).toBe('function');
  });
});
