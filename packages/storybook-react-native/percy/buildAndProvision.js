import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { log } from './util/log.js';
import { provisionApp } from './provisionApp.js';
import { err } from '../src/errors.js';

/**
 * One-step build + upload for the App Automate flow.
 *
 *   const appRef = await buildAndProvision({
 *     projectPath: './path/to/rn/project',
 *     platform: 'android',
 *   });
 *
 * Detects Expo vs bare RN and runs the appropriate build pipeline:
 *   - Expo: expo prebuild + gradle assembleDebug
 *   - Bare RN Android: cd android && ./gradlew assembleDebug
 *   - Bare RN iOS Simulator: xcodebuild for Sim (no signing)
 *
 * iOS for App Automate explicitly throws `apple_signing_required` —
 * cloud-device iOS needs a distribution-signed .ipa that requires the
 * customer's Apple Developer account. The SDK can't fake that.
 *
 * @param {{
 *   projectPath: string,
 *   platform: 'android' | 'ios',
 *   target?: 'app-automate' | 'simulator' | 'emulator',
 *   variant?: 'debug' | 'release',
 *   buildTimeoutMs?: number,
 *   skipBuildIfArtifactExists?: boolean,
 * } & Parameters<typeof provisionApp>[1]} opts
 *
 * @returns {Promise<string>}  bs:// URL (App Automate) or absolute local path (Simulator/local)
 */
export async function buildAndProvision(opts) {
  const projectPath = path.resolve(opts.projectPath);
  const platform = opts.platform;
  const variant = opts.variant ?? 'debug';
  const target = opts.target ?? (platform === 'ios' ? 'simulator' : 'app-automate');
  const buildTimeoutMs = opts.buildTimeoutMs ?? 15 * 60_000;

  if (!platform || !['android', 'ios'].includes(platform)) {
    throw err(
      'unsupported_project_type',
      `buildAndProvision requires platform: 'android' | 'ios', got ${platform}.`,
    );
  }

  // iOS App Automate is the wall — the SDK cannot sign for distribution.
  if (platform === 'ios' && target === 'app-automate') {
    throw err(
      'apple_signing_required',
      'iOS for App Automate requires a distribution-signed .ipa from your Apple Developer account.',
      'Build the .ipa yourself (see STORYBOOK_HOST_APP.md "URL scheme registration → Bare RN — iOS"), then call provisionApp(ipaPath) directly. The SDK cannot sign on your behalf.',
    );
  }

  // Verify project path exists.
  try {
    await fs.access(projectPath);
  } catch {
    throw err(
      'build_failed',
      `Project path not found: ${projectPath}.`,
      'Pass an absolute path to your RN project root (the directory containing package.json).',
    );
  }

  const projectType = await detectProjectType(projectPath);
  log.info(`[storybook-rn] buildAndProvision: ${platform} / ${variant} / ${projectType}`);

  let artifactPath;
  if (platform === 'android') {
    artifactPath = await buildAndroid(projectPath, projectType, variant, buildTimeoutMs);
  } else {
    artifactPath = await buildIosSimulator(projectPath, projectType, buildTimeoutMs);
  }

  log.info(`[storybook-rn] build artifact: ${artifactPath}`);

  // For Simulator/local we don't upload — caller passes the path to Appium directly.
  if (target === 'simulator' || target === 'emulator') {
    return artifactPath;
  }

  return provisionApp(artifactPath, opts);
}

/**
 * Detect whether a project is Expo-managed or bare RN.
 *
 * @param {string} projectPath
 * @returns {Promise<'expo' | 'bare-rn' | 'unknown'>}
 */
async function detectProjectType(projectPath) {
  const pkgPath = path.join(projectPath, 'package.json');
  let pkg;
  try {
    pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8'));
  } catch {
    throw err(
      'build_failed',
      `Could not read ${pkgPath}.`,
      'Confirm projectPath points at the RN project root (containing package.json).',
    );
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps.expo) return 'expo';
  if (deps['react-native']) return 'bare-rn';
  return 'unknown';
}

/**
 * Build an Android debug APK. Returns the absolute APK path.
 */
async function buildAndroid(projectPath, projectType, variant, timeoutMs) {
  const gradleTask =
    variant === 'release' ? 'assembleRelease' : 'assembleDebug';
  const expectedApk = path.join(
    projectPath,
    'android',
    'app',
    'build',
    'outputs',
    'apk',
    variant,
    `app-${variant}.apk`,
  );

  // Step 1: Expo prebuild if Expo-managed (idempotent — fast on subsequent runs).
  if (projectType === 'expo') {
    const androidDir = path.join(projectPath, 'android');
    const exists = await fs.access(androidDir).then(() => true).catch(() => false);
    if (!exists) {
      log.info('[storybook-rn] running: npx expo prebuild --platform android');
      await runCommand('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install'], {
        cwd: projectPath,
        timeoutMs,
      });
    } else {
      log.debug('[storybook-rn] android/ exists; skipping expo prebuild');
    }
  } else if (projectType !== 'bare-rn') {
    throw err(
      'unsupported_project_type',
      `Could not detect project type for ${projectPath}. Expected Expo or bare React Native (package.json must list 'expo' or 'react-native' in dependencies).`,
      'Pass a path to a valid RN project root.',
    );
  }

  // Step 2: Gradle assembleDebug.
  const gradleWrapper = path.join(projectPath, 'android', 'gradlew');
  const wrapperExists = await fs.access(gradleWrapper).then(() => true).catch(() => false);
  if (!wrapperExists) {
    throw err(
      'build_toolchain_missing',
      `Gradle wrapper not found at ${gradleWrapper}.`,
      'Run `npx expo prebuild --platform android` (Expo) or ensure the android/ directory is checked in (bare RN).',
    );
  }

  log.info(`[storybook-rn] running: ./gradlew ${gradleTask}`);
  await runCommand('./gradlew', [gradleTask], {
    cwd: path.join(projectPath, 'android'),
    timeoutMs,
  });

  // Step 3: Locate the artifact.
  const exists = await fs.access(expectedApk).then(() => true).catch(() => false);
  if (!exists) {
    throw err(
      'build_artifact_not_found',
      `Built ${gradleTask} but APK not found at ${expectedApk}.`,
      'Check the gradle output above for build errors. Some flavors produce a different output path.',
    );
  }
  return expectedApk;
}

/**
 * Build an iOS Simulator .app. Returns the absolute .app path.
 *
 * For App Automate iOS we throw apple_signing_required earlier — this only
 * runs for local Simulator targets.
 */
async function buildIosSimulator(projectPath, projectType, timeoutMs) {
  if (process.platform !== 'darwin') {
    throw err(
      'build_toolchain_missing',
      'iOS builds require macOS with Xcode installed.',
      'Build on a Mac runner (or use Android for non-Mac CI).',
    );
  }

  // Expo: prebuild + run-ios path. We use prebuild + xcodebuild for headless.
  if (projectType === 'expo') {
    const iosDir = path.join(projectPath, 'ios');
    const exists = await fs.access(iosDir).then(() => true).catch(() => false);
    if (!exists) {
      log.info('[storybook-rn] running: npx expo prebuild --platform ios');
      await runCommand('npx', ['expo', 'prebuild', '--platform', 'ios', '--no-install'], {
        cwd: projectPath,
        timeoutMs,
      });
    }
  }

  // Find workspace/project under ios/.
  const iosDir = path.join(projectPath, 'ios');
  let entries;
  try {
    entries = await fs.readdir(iosDir);
  } catch (cause) {
    // Bare RN with no ios/ dir would otherwise throw a raw Node ENOENT,
    // breaking the typed-error contract. Map it to the documented code.
    if (/** @type {{ code?: string }} */ (cause)?.code === 'ENOENT') {
      throw err(
        'build_artifact_not_found',
        `No ios/ directory found at ${iosDir}.`,
        'For Expo, run `npx expo prebuild --platform ios`; for bare RN, ensure the iOS project is initialized.',
        cause,
      );
    }
    throw cause;
  }
  const workspace = entries.find((e) => e.endsWith('.xcworkspace'));
  const project = entries.find((e) => e.endsWith('.xcodeproj'));
  if (!workspace && !project) {
    throw err(
      'build_artifact_not_found',
      `No .xcworkspace or .xcodeproj found in ${iosDir}.`,
      'Run `npx expo prebuild --platform ios` (Expo) or check that the iOS project is initialized (bare RN).',
    );
  }
  const schemeName = (workspace ?? project).replace(/\.(xcworkspace|xcodeproj)$/, '');
  // The scheme name comes from a filesystem entry name and is passed as a bare
  // xcodebuild argument. Reject a leading dash or shell/option metacharacters so
  // a maliciously- or oddly-named project dir can't inject xcodebuild options.
  if (/^-/.test(schemeName) || !/^[A-Za-z0-9._ -]+$/.test(schemeName)) {
    throw err(
      'build_failed',
      `Refusing to build: derived Xcode scheme name "${schemeName}" contains unsafe characters.`,
      'Rename the .xcworkspace/.xcodeproj so its name is alphanumeric and does not start with "-".',
    );
  }

  const buildDir = path.join(iosDir, 'build');
  const xcodebuildArgs = [
    '-scheme', schemeName,
    '-configuration', 'Debug',
    '-sdk', 'iphonesimulator',
    '-derivedDataPath', buildDir,
    'CODE_SIGNING_ALLOWED=NO',
    'build',
  ];
  if (workspace) xcodebuildArgs.unshift('-workspace', path.join(iosDir, workspace));
  else xcodebuildArgs.unshift('-project', path.join(iosDir, project));

  log.info('[storybook-rn] running: xcodebuild …');
  await runCommand('xcodebuild', xcodebuildArgs, { cwd: projectPath, timeoutMs });

  // Locate .app under DerivedData.
  const appPath = path.join(
    buildDir, 'Build', 'Products', 'Debug-iphonesimulator', `${schemeName}.app`,
  );
  const exists = await fs.access(appPath).then(() => true).catch(() => false);
  if (!exists) {
    throw err(
      'build_artifact_not_found',
      `xcodebuild succeeded but .app not found at ${appPath}.`,
      'Check the xcodebuild output. Custom scheme names may produce a different output path.',
    );
  }
  return appPath;
}

/**
 * Run a command with stdio streamed to log.info, hard timeout, and meaningful
 * error mapping for the most common toolchain-missing cases.
 *
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd: string, timeoutMs: number }} opts
 */
function runCommand(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stderrBuf = '';
    child.stdout.on('data', (chunk) => log.debug(chunk.toString().trimEnd()));
    child.stderr.on('data', (chunk) => {
      const s = chunk.toString();
      stderrBuf += s;
      log.debug(s.trimEnd());
    });

    const timer = setTimeout(() => {
      // SIGTERM first, then escalate to SIGKILL if the process is still alive
      // after a grace period. A gradle daemon (or any child ignoring SIGTERM)
      // would otherwise survive as an orphan holding the emulator/ports.
      child.kill('SIGTERM');
      const escalate = setTimeout(() => child.kill('SIGKILL'), 5000);
      escalate.unref?.();
      child.once('exit', () => clearTimeout(escalate));
      reject(
        err(
          'build_failed',
          `Build command \`${cmd} ${args.join(' ')}\` timed out after ${opts.timeoutMs}ms.`,
          'Increase opts.buildTimeoutMs, or check whether the build is hung waiting on a prompt.',
        ),
      );
    }, opts.timeoutMs);

    child.on('error', (cause) => {
      clearTimeout(timer);
      const code = /** @type {{ code?: string }} */ (cause).code;
      if (code === 'ENOENT') {
        reject(
          err(
            'build_toolchain_missing',
            `Build command \`${cmd}\` not found on PATH.`,
            'Install the required toolchain (Node + npm for `npx`; Java + Android SDK for gradle; Xcode for xcodebuild).',
            cause,
          ),
        );
        return;
      }
      reject(
        err('build_failed', `Build command failed to spawn: ${cause.message}`, undefined, cause),
      );
    });

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      // A process killed by a signal reports code === null; surface the signal
      // instead of an unhelpful "exited with code null".
      const how = code === null ? `was killed by signal ${signal}` : `exited with code ${code}`;
      reject(
        err(
          'build_failed',
          `Build command \`${cmd} ${args.join(' ')}\` ${how}.`,
          'See the gradle/xcodebuild output above. Common causes: missing JDK, ANDROID_HOME unset, Xcode license unagreed.',
          new Error(stderrBuf.slice(-500)),
        ),
      );
    });
  });
}

export const __forTesting = { detectProjectType };
