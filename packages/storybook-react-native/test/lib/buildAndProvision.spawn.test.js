import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';

// --- child_process.spawn fake -------------------------------------------------
//
// buildAndProvision.runCommand() spawns gradle / expo / xcodebuild. We mock
// node:child_process so the suite never touches a real toolchain. Each test
// queues the next child's behavior via `spawnQueue`. The fake child is an
// EventEmitter with .stdout / .stderr streams and a .kill() — exactly the
// surface runCommand() consumes.
const spawnState = vi.hoisted(() => ({
  /** @type {Array<{ exitCode?: number, errorCode?: string, errorMessage?: string, stdout?: string, stderr?: string, hang?: boolean }>} */
  queue: [],
  /** @type {Array<{ cmd: string, args: string[], opts: any }>} */
  calls: [],
}));

vi.mock('node:child_process', () => ({
  spawn: (cmd, args, opts) => {
    spawnState.calls.push({ cmd, args, opts });
    const behavior = spawnState.queue.shift() ?? { exitCode: 0 };
    // Side-effect hook: lets a test model a build step that materializes files
    // (e.g. `expo prebuild` creating the android/ or ios/ tree) at the exact
    // moment the command is "run" — before its exit fires and the next FS
    // check in buildAndProvision runs.
    if (typeof behavior.onSpawn === 'function') behavior.onSpawn({ cmd, args });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    // Emit asynchronously so listeners attached after spawn() returns fire.
    queueMicrotask(() => {
      if (behavior.stdout) child.stdout.emit('data', Buffer.from(behavior.stdout));
      if (behavior.stderr) child.stderr.emit('data', Buffer.from(behavior.stderr));
      if (behavior.hang) return; // never resolves — exercises the timeout timer
      if (behavior.errorCode || behavior.errorMessage) {
        const e = new Error(behavior.errorMessage ?? 'spawn error');
        if (behavior.errorCode) e.code = behavior.errorCode;
        child.emit('error', e);
        return;
      }
      child.emit('exit', behavior.exitCode ?? 0);
    });
    return child;
  },
}));

// provisionApp is the upload step — stub it so the build flow returns a stable
// value without hitting BrowserStack. We only assert that build artifacts reach
// it correctly.
const provisionState = vi.hoisted(() => ({ calls: [], impl: null }));
vi.mock('../../percy/provisionApp.js', () => ({
  provisionApp: async (artifactPath, opts) => {
    provisionState.calls.push({ artifactPath, opts });
    if (provisionState.impl) return provisionState.impl(artifactPath, opts);
    return `bs://uploaded-${artifactPath}`;
  },
}));

const { buildAndProvision } = await import('../../percy/buildAndProvision.js');

let tmp;

function resetState() {
  spawnState.queue.length = 0;
  spawnState.calls.length = 0;
  provisionState.calls.length = 0;
  provisionState.impl = null;
}

/** Lay out a bare-RN android project with gradlew + (optionally) the built APK. */
function setupAndroidProject({ expo = false, withGradlew = true, withApk = true, variant = 'debug' } = {}) {
  const deps = expo ? { expo: '^54.0.0' } : { 'react-native': '0.74.0' };
  writeFileSync(join(tmp, 'package.json'), JSON.stringify({ dependencies: deps }));
  const androidDir = join(tmp, 'android');
  mkdirSync(androidDir, { recursive: true });
  if (withGradlew) writeFileSync(join(androidDir, 'gradlew'), '#!/bin/sh\n');
  if (withApk) {
    const apkDir = join(androidDir, 'app', 'build', 'outputs', 'apk', variant);
    mkdirSync(apkDir, { recursive: true });
    writeFileSync(join(apkDir, `app-${variant}.apk`), 'apk-bytes');
  }
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'percy-build-spawn-'));
  resetState();
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('buildAndProvision — Android bare-RN happy path', () => {
  it('runs ./gradlew assembleDebug and uploads the located APK', async () => {
    setupAndroidProject();
    const ref = await buildAndProvision({ projectPath: tmp, platform: 'android' });

    expect(spawnState.calls).toHaveLength(1);
    expect(spawnState.calls[0].cmd).toBe('./gradlew');
    expect(spawnState.calls[0].args).toEqual(['assembleDebug']);
    expect(spawnState.calls[0].opts.cwd).toBe(join(tmp, 'android'));

    expect(provisionState.calls).toHaveLength(1);
    expect(provisionState.calls[0].artifactPath).toBe(
      join(tmp, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
    );
    expect(ref).toContain('bs://uploaded-');
  });

  it('uses assembleRelease for variant=release', async () => {
    setupAndroidProject({ variant: 'release' });
    await buildAndProvision({ projectPath: tmp, platform: 'android', variant: 'release' });
    expect(spawnState.calls[0].args).toEqual(['assembleRelease']);
  });

  it('returns the local artifact path (no upload) for target=emulator', async () => {
    setupAndroidProject();
    const ref = await buildAndProvision({ projectPath: tmp, platform: 'android', target: 'emulator' });
    expect(ref).toBe(
      join(tmp, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'),
    );
    expect(provisionState.calls).toHaveLength(0);
  });
});

describe('buildAndProvision — Android Expo prebuild', () => {
  it('skips expo prebuild when android/ already exists, runs only gradlew', async () => {
    // Expo project that already has android/ committed → prebuild branch skipped.
    setupAndroidProject({ expo: true });
    await buildAndProvision({ projectPath: tmp, platform: 'android' });
    expect(spawnState.calls.map((c) => c.cmd)).toEqual(['./gradlew']);
  });

  it('runs `npx expo prebuild` when android/ is genuinely absent, then gradle', async () => {
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ dependencies: { expo: '^54.0.0' } }));
    // android/ absent at call time → prebuild branch. The prebuild spawn
    // materializes the android tree (gradlew + apk) the moment it "runs",
    // modeling expo prebuild's real effect, so the subsequent gradlew + APK
    // lookup succeed.
    const androidDir = join(tmp, 'android');
    spawnState.queue.push({
      exitCode: 0,
      stdout: 'prebuilding…',
      stderr: 'warn: something',
      onSpawn: () => {
        const apkDir = join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug');
        mkdirSync(apkDir, { recursive: true });
        writeFileSync(join(androidDir, 'gradlew'), '#!/bin/sh\n');
        writeFileSync(join(apkDir, 'app-debug.apk'), 'apk');
      },
    });

    await buildAndProvision({ projectPath: tmp, platform: 'android' });
    expect(spawnState.calls[0].cmd).toBe('npx');
    expect(spawnState.calls[0].args).toEqual([
      'expo', 'prebuild', '--platform', 'android', '--no-install',
    ]);
    expect(spawnState.calls[1].cmd).toBe('./gradlew');
  });
});

describe('buildAndProvision — Android failure surfaces', () => {
  it('throws unsupported_project_type when package.json lists neither expo nor react-native', async () => {
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ dependencies: { lodash: '^4' } }));
    mkdirSync(join(tmp, 'android'), { recursive: true });
    await expect(
      buildAndProvision({ projectPath: tmp, platform: 'android' }),
    ).rejects.toMatchObject({ code: 'unsupported_project_type' });
    expect(spawnState.calls).toHaveLength(0);
  });

  it('throws build_toolchain_missing when gradlew is absent', async () => {
    setupAndroidProject({ withGradlew: false, withApk: false });
    await expect(
      buildAndProvision({ projectPath: tmp, platform: 'android' }),
    ).rejects.toMatchObject({ code: 'build_toolchain_missing' });
  });

  it('throws build_artifact_not_found when the APK is missing after a successful gradle build', async () => {
    setupAndroidProject({ withApk: false });
    await expect(
      buildAndProvision({ projectPath: tmp, platform: 'android' }),
    ).rejects.toMatchObject({ code: 'build_artifact_not_found' });
  });

  it('maps gradle non-zero exit to build_failed', async () => {
    setupAndroidProject();
    spawnState.queue.push({ exitCode: 1, stderr: 'gradle blew up' });
    await expect(
      buildAndProvision({ projectPath: tmp, platform: 'android' }),
    ).rejects.toMatchObject({ code: 'build_failed' });
  });

  it('maps spawn ENOENT (missing binary) to build_toolchain_missing', async () => {
    setupAndroidProject();
    spawnState.queue.push({ errorCode: 'ENOENT', errorMessage: 'spawn ./gradlew ENOENT' });
    await expect(
      buildAndProvision({ projectPath: tmp, platform: 'android' }),
    ).rejects.toMatchObject({ code: 'build_toolchain_missing' });
  });

  it('maps a non-ENOENT spawn error to build_failed', async () => {
    setupAndroidProject();
    spawnState.queue.push({ errorCode: 'EACCES', errorMessage: 'permission denied' });
    await expect(
      buildAndProvision({ projectPath: tmp, platform: 'android' }),
    ).rejects.toMatchObject({ code: 'build_failed' });
  });

  it('times out a hung build with build_failed', async () => {
    setupAndroidProject();
    spawnState.queue.push({ hang: true });
    await expect(
      buildAndProvision({ projectPath: tmp, platform: 'android', buildTimeoutMs: 20 }),
    ).rejects.toMatchObject({ code: 'build_failed' });
    // The hung child was SIGTERM'd by the timeout handler.
    // (kill is on the fake child; we can't reach it here, but the rejection
    // proves the timeout fired.)
  });
});

describe('buildAndProvision — iOS Simulator path', () => {
  const realPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform });
  });

  function forceDarwin() {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
  }

  function setupIosProject({ kind = 'workspace', expo = false, withApp = true } = {}) {
    const deps = expo ? { expo: '^54.0.0' } : { 'react-native': '0.74.0' };
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ dependencies: deps }));
    const iosDir = join(tmp, 'ios');
    mkdirSync(iosDir, { recursive: true });
    if (kind === 'workspace') mkdirSync(join(iosDir, 'MyApp.xcworkspace'));
    else if (kind === 'project') mkdirSync(join(iosDir, 'MyApp.xcodeproj'));
    if (withApp) {
      const appDir = join(iosDir, 'build', 'Build', 'Products', 'Debug-iphonesimulator', 'MyApp.app');
      mkdirSync(appDir, { recursive: true });
    }
  }

  it('throws build_toolchain_missing off macOS', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    setupIosProject();
    await expect(
      buildAndProvision({ projectPath: tmp, platform: 'ios', target: 'simulator' }),
    ).rejects.toMatchObject({ code: 'build_toolchain_missing' });
  });

  it('builds via xcodebuild with -workspace and returns the .app path', async () => {
    forceDarwin();
    setupIosProject({ kind: 'workspace' });
    const ref = await buildAndProvision({ projectPath: tmp, platform: 'ios', target: 'simulator' });
    expect(spawnState.calls[0].cmd).toBe('xcodebuild');
    expect(spawnState.calls[0].args).toContain('-workspace');
    expect(spawnState.calls[0].args).toContain('-scheme');
    expect(spawnState.calls[0].args).toContain('MyApp');
    expect(ref).toBe(
      join(tmp, 'ios', 'build', 'Build', 'Products', 'Debug-iphonesimulator', 'MyApp.app'),
    );
    // simulator target → no upload.
    expect(provisionState.calls).toHaveLength(0);
  });

  it('defaults ios target to "simulator" when target is omitted', async () => {
    // No explicit target → the `platform === 'ios' ? 'simulator' : …` default
    // applies, so we build the .app locally and skip the upload.
    forceDarwin();
    setupIosProject({ kind: 'workspace' });
    const ref = await buildAndProvision({ projectPath: tmp, platform: 'ios' });
    expect(ref).toBe(
      join(tmp, 'ios', 'build', 'Build', 'Products', 'Debug-iphonesimulator', 'MyApp.app'),
    );
    expect(provisionState.calls).toHaveLength(0);
  });

  it('uses -project when only an .xcodeproj is present', async () => {
    forceDarwin();
    setupIosProject({ kind: 'project' });
    await buildAndProvision({ projectPath: tmp, platform: 'ios', target: 'simulator' });
    expect(spawnState.calls[0].args).toContain('-project');
  });

  it('throws build_artifact_not_found when no workspace/project under ios/', async () => {
    forceDarwin();
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ dependencies: { 'react-native': '0.74.0' } }));
    mkdirSync(join(tmp, 'ios'), { recursive: true });
    await expect(
      buildAndProvision({ projectPath: tmp, platform: 'ios', target: 'simulator' }),
    ).rejects.toMatchObject({ code: 'build_artifact_not_found' });
    expect(spawnState.calls).toHaveLength(0);
  });

  it('throws build_artifact_not_found when xcodebuild succeeds but .app is absent', async () => {
    forceDarwin();
    setupIosProject({ kind: 'workspace', withApp: false });
    await expect(
      buildAndProvision({ projectPath: tmp, platform: 'ios', target: 'simulator' }),
    ).rejects.toMatchObject({ code: 'build_artifact_not_found' });
  });

  it('runs `npx expo prebuild --platform ios` for an Expo project missing ios/', async () => {
    forceDarwin();
    writeFileSync(join(tmp, 'package.json'), JSON.stringify({ dependencies: { expo: '^54.0.0' } }));
    const iosDir = join(tmp, 'ios');
    // ios/ absent at first → prebuild branch. prebuild spawn materializes the
    // ios tree (workspace + built .app) modeling its real effect.
    spawnState.queue.push({
      exitCode: 0,
      onSpawn: () => {
        mkdirSync(join(iosDir, 'MyApp.xcworkspace'), { recursive: true });
        mkdirSync(join(iosDir, 'build', 'Build', 'Products', 'Debug-iphonesimulator', 'MyApp.app'), { recursive: true });
      },
    });
    await buildAndProvision({ projectPath: tmp, platform: 'ios', target: 'simulator' });
    expect(spawnState.calls[0].cmd).toBe('npx');
    expect(spawnState.calls[0].args).toEqual(['expo', 'prebuild', '--platform', 'ios', '--no-install']);
    expect(spawnState.calls[1].cmd).toBe('xcodebuild');
  });

  it('skips expo prebuild when ios/ already exists', async () => {
    forceDarwin();
    setupIosProject({ kind: 'workspace', expo: true });
    await buildAndProvision({ projectPath: tmp, platform: 'ios', target: 'simulator' });
    expect(spawnState.calls.map((c) => c.cmd)).toEqual(['xcodebuild']);
  });
});

describe('buildAndProvision — detectProjectType failure inside build', () => {
  it('throws build_failed when package.json cannot be read', async () => {
    // projectPath exists (so the access check passes) but no package.json.
    await expect(
      buildAndProvision({ projectPath: tmp, platform: 'android' }),
    ).rejects.toMatchObject({ code: 'build_failed' });
  });
});
