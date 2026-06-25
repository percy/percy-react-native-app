import { promises as fs } from 'node:fs';
import { basename, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { log } from './util/log.js';
import { err } from '../src/errors.js';
import { assertValidAppReference } from './util/validations.js';
import { readApkDebuggable } from './util/apkManifest.js';

const UPLOAD_URL = 'https://api-cloud.browserstack.com/app-automate/upload';
const RECENT_APPS_URL = 'https://api-cloud.browserstack.com/app-automate/recent_apps';

const DEFAULTS = {
  uploadRetries: 3,
  uploadTimeoutMs: 120_000,
  postUploadSettleMs: 5_000, // defensive — until Phase 1 PoC measures actual readiness
  probeTimeoutMs: 10_000,
};

/**
 * Error codes that must not be retried — they're authentication / payload /
 * configuration problems that won't fix themselves on a re-send. Module-level
 * so the upload retry loop and any future caller share one definition.
 */
const TERMINAL_UPLOAD_CODES = new Set([
  'bs_upload_too_large',
  'bs_upload_failed',
  'bs_credentials_missing',
]);

/**
 * Strip credentials from a string before logging it. Redacts the exact known
 * secrets first — accepts either a single value or an array (the access key /
 * userName / the computed `Basic <base64>` auth header we hold in scope) —
 * which catches keys containing hyphens or shorter than the heuristic
 * threshold. Then falls back to a widened base64/alphanumeric heuristic for
 * any key (or reflected `Authorization` header — whose `+ / =` chars the plain
 * alphanumeric heuristic would miss) echoed in a shape we didn't anticipate.
 * Finally truncates to 200 chars.
 *
 * @param {string} body
 * @param {string | string[]} [secrets]  exact literal value(s) to redact (e.g. accessKey, auth header)
 */
function scrubSecrets(body, secrets = []) {
  const list = Array.isArray(secrets) ? secrets : [secrets];
  let scrubbed = String(body);
  for (const s of list) {
    // Only redact non-trivial values — a 1-char "secret" would nuke the body.
    if (typeof s === 'string' && s.length >= 4) {
      scrubbed = scrubbed.split(s).join('[redacted]');
    }
  }
  return scrubbed
    // Widened to include base64 `+ / =` so a reflected Basic-auth header is caught.
    .replace(/[A-Za-z0-9+/=]{20,}/g, '[redacted]')
    .slice(0, 200);
}

/**
 * Read BrowserStack credentials from opts or env. Throws if missing.
 * @param {{ credentials?: { userName?: string, accessKey?: string } }} opts
 */
function readCredentials(opts) {
  const userName =
    opts?.credentials?.userName ?? process.env.BROWSERSTACK_USERNAME;
  const accessKey =
    opts?.credentials?.accessKey ?? process.env.BROWSERSTACK_ACCESS_KEY;
  if (!userName || !accessKey) {
    throw err(
      'bs_credentials_missing',
      'BrowserStack credentials not found.',
      'Set BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY env vars, or pass them as opts.credentials.',
    );
  }
  // `userName:accessKey` is base64'd into the Basic auth header. A colon in
  // the userName splits the header on the wire and silently corrupts the
  // accessKey BS receives. Fail fast with a clear error instead of an opaque
  // 401 mid-upload.
  if (typeof userName !== 'string' || userName.includes(':')) {
    throw err(
      'bs_credentials_missing',
      'BrowserStack userName must be a string without colons.',
      'Pass the userName from your BrowserStack account; do not paste the entire userName:accessKey string.',
    );
  }
  return { userName, accessKey };
}

function basicAuthHeader(userName, accessKey) {
  return `Basic ${Buffer.from(`${userName}:${accessKey}`).toString('base64')}`;
}

/**
 * Compute sha256 of the supplied buffer and slice to 40 chars to fit
 * BrowserStack's `custom_id` charset constraints ([A-Za-z0-9._-], max 100).
 *
 * @param {Buffer} buf
 */
function bufferCustomId(buf) {
  return createHash('sha256').update(buf).digest('hex').slice(0, 40);
}

/**
 * Back-compat shim — older external callers read the customId from a path
 * directly. Internally we now hash a once-read buffer to avoid double-reading
 * large APKs.
 *
 * @param {string} localPath
 */
async function fileCustomId(localPath) {
  return bufferCustomId(await fs.readFile(localPath));
}

/**
 * Probe BrowserStack for a previously-uploaded app with this custom_id.
 * Returns the existing `bs://` URL on hit, undefined on miss.
 *
 * Endpoint shape (per BS docs as of 2026-04-25):
 *   GET /app-automate/recent_apps/{custom_id}
 *   200 → array of apps; pick the first; non-empty.app_url is the bs:// ref.
 *   404 / empty array → never uploaded under this custom_id; fall through to upload.
 */
async function probeRecentApps(authHeader, customId, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${RECENT_APPS_URL}/${encodeURIComponent(customId)}`, {
      method: 'GET',
      headers: { Authorization: authHeader },
      signal: ctrl.signal,
    });
    if (res.status === 404) return undefined;
    if (!res.ok) {
      // Treat as miss — don't fail provisionApp because the probe optimization didn't hit.
      log.debug(`[storybook-rn] recent_apps probe non-OK: ${res.status}`);
      return undefined;
    }
    const json = /** @type {Array<{ app_url?: string }>} */ (await res.json());
    if (!Array.isArray(json) || json.length === 0) return undefined;
    return json[0]?.app_url;
  } catch (cause) {
    log.debug(`[storybook-rn] recent_apps probe failed: ${scrubSecrets(cause instanceof Error ? cause.message : String(cause), authHeader)}`);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Upload an APK/IPA to BrowserStack with retry. Returns the bs:// URL.
 *
 * Retries on 5xx and network errors only. 4xx fails fast.
 *
 * The `data` Buffer is read once by the caller and shared across retries —
 * a fresh FormData wrapper is needed each attempt (FormData/Blob is consumed
 * by fetch and not reusable), but the underlying byte payload is shared by
 * reference so retries don't 3x our peak memory.
 *
 * @param {string} authHeader
 * @param {Buffer} data           pre-read file contents
 * @param {string} filename       basename for the multipart part
 * @param {string} customId
 * @param {{ retries: number, timeoutMs: number }} retryOpts
 * @param {string[]} [secrets]  exact credential values to redact from logged bodies
 */
async function uploadWithRetry(authHeader, data, filename, customId, retryOpts, secrets = []) {
  // Single Blob backed by the existing Buffer — retries reuse the underlying
  // bytes through fresh FormData wrappers below.
  const fileBlob = new Blob([data]);

  let lastErr;
  for (let attempt = 1; attempt <= retryOpts.retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), retryOpts.timeoutMs);
    try {
      const form = new FormData();
      form.append('file', fileBlob, filename);
      form.append('custom_id', customId);
      log.info(`[storybook-rn] uploading ${filename} (${(data.length / 1024 / 1024).toFixed(1)} MB) — attempt ${attempt}/${retryOpts.retries}`);
      const res = await fetch(UPLOAD_URL, {
        method: 'POST',
        headers: { Authorization: authHeader },
        body: form,
        signal: ctrl.signal,
      });

      if (res.status === 413) {
        const body = await res.text().catch(() => '');
        throw err(
          'bs_upload_too_large',
          `BrowserStack rejected the upload (413). ${scrubSecrets(body, secrets)}`,
          'Reduce app size or contact BrowserStack support to raise the per-account limit.',
        );
      }
      if (res.status >= 400 && res.status < 500) {
        const body = await res.text().catch(() => '');
        throw err(
          'bs_upload_failed',
          `BrowserStack upload failed with HTTP ${res.status}: ${scrubSecrets(body, secrets)}`,
          'Verify BROWSERSTACK_USERNAME / BROWSERSTACK_ACCESS_KEY and try again.',
        );
      }
      if (!res.ok) {
        // 5xx — retry
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${scrubSecrets(body, secrets)}`);
      }
      const json = /** @type {{ app_url?: string }} */ (await res.json());
      if (!json.app_url) {
        throw err(
          'bs_upload_failed',
          `BrowserStack returned 200 but no app_url in response: ${scrubSecrets(JSON.stringify(json), secrets)}`,
        );
      }
      return json.app_url;
    } catch (cause) {
      lastErr = cause;
      // Typed PercyStorybookRNError → terminal (4xx — auth/payload/etc.).
      // Generic Error → transient (5xx, network, abort) and worth retrying.
      const code = cause && /** @type {{ code?: string }} */ (cause).code;
      if (code && TERMINAL_UPLOAD_CODES.has(code)) {
        throw cause;
      }
      if (attempt < retryOpts.retries) {
        const backoffMs = 1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 500);
        log.warn(`[storybook-rn] upload attempt ${attempt} failed; retrying in ${backoffMs}ms.`);
        await new Promise((r) => setTimeout(r, backoffMs));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  // Exhausted retries — wrap last error.
  throw err(
    'bs_upload_failed',
    `BrowserStack upload failed after ${retryOpts.retries} attempts: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
    'Check network reachability to api-cloud.browserstack.com and retry the CI job.',
  );
}

/**
 * Provision an app for an Appium session.
 *
 * For App Automate (BROWSERSTACK_USERNAME present in env or opts.credentials):
 *   1. Compute custom_id = sha256(file).slice(0, 40)
 *   2. GET /app-automate/recent_apps/{custom_id} — return existing bs:// on hit
 *   3. Otherwise upload via POST /app-automate/upload (multipart) with retry
 *   4. Defensive 5s settle pause after upload (Phase 1 PoC may drop or replace
 *      with a status poll once empirical readiness is measured)
 *
 * For local transport (no BS creds):
 *   No-op; returns the absolute path. Customer's Appium driver capabilities
 *   pass it directly as the `app` cap.
 *
 * @param {string} localPath
 * @param {object} [opts]
 * @returns {Promise<string>}  bs:// URL or absolute local path
 */
export async function provisionApp(localPath, opts = {}) {
  const merged = { ...DEFAULTS, ...opts };

  const userName = opts?.credentials?.userName ?? process.env.BROWSERSTACK_USERNAME;
  const accessKey = opts?.credentials?.accessKey ?? process.env.BROWSERSTACK_ACCESS_KEY;
  const hasCreds = Boolean(userName && accessKey);

  // Did the caller explicitly ask for App Automate? An explicit
  // transport/target of 'app-automate', or a bs:// path that only makes sense
  // on the cloud. If so but creds are missing, DON'T silently fall back to a
  // local file path — a cloud session can't consume it and would fail opaquely
  // on-device. Surface the dedicated bs_credentials_missing error (otherwise
  // unreachable on this path) so the misconfiguration is obvious up front.
  const wantsAppAutomate =
    opts?.transport === 'app-automate' ||
    opts?.target === 'app-automate' ||
    (typeof localPath === 'string' && localPath.startsWith('bs://'));
  if (wantsAppAutomate && !hasCreds) {
    readCredentials(opts); // throws bs_credentials_missing with full guidance
  }

  const isAppAutomate = hasCreds && opts?.transport !== 'local';

  if (!isAppAutomate) {
    // Local transport — no upload. Caller passes the path directly to Appium.
    const stat = await fs.stat(localPath).catch(() => null);
    if (!stat || !stat.isFile()) {
      throw err(
        'bs_upload_failed',
        `App file not found at ${localPath}.`,
        'Pass a valid path to a built .apk or .ipa.',
      );
    }
    return localPath;
  }

  // Sanity check: reject debuggable Android builds before consuming BS session
  // minutes. Debug builds expect Metro on localhost:8081 to serve JS — on a
  // cloud device, no Metro = redbox loadJSBundleFromAssets failure. Documented
  // as a known onboarding gotcha in STORYBOOK_HOST_APP.md.
  const androidExt = extname(localPath).toLowerCase();
  if (!opts?.skipDebugBuildCheck && (androidExt === '.apk' || androidExt === '.aab')) {
    const probe = await readApkDebuggable(localPath).catch(() => null);
    if (probe?.debuggable === true) {
      throw err(
        'build_is_debug_variant',
        `${basename(localPath)} is a DEBUG build (android:debuggable="true"). Debug builds expect Metro on localhost:8081 to serve the JS bundle. On a BrowserStack cloud device there is no Metro, so the app would crash with a redbox loadJSBundleFromAssets error.`,
        'Build the release variant: `cd android && ./gradlew assembleRelease` (or `bundleRelease` for .aab). To bypass this check (e.g., you set bundleInDebug=true in app/build.gradle), pass { skipDebugBuildCheck: true } to provisionApp().',
      );
    }
    // .aab manifests are protobuf-encoded at a different path, so the binary
    // XML probe can't read them — be honest that the check was skipped rather
    // than implying a clean bill of health.
    if (androidExt === '.aab' && probe?.debuggable !== false) {
      log.warn(`[storybook-rn] Could not verify the debuggable flag for ${basename(localPath)} (.aab). Ensure it is a release bundle, or the cloud session may redbox.`);
    }
  }

  const { userName: u, accessKey: k } = readCredentials(opts);
  const auth = basicAuthHeader(u, k);

  // Read the file once and share the Buffer for both hashing and (if needed)
  // uploading. Large APKs (50 MB–200 MB) plus 2× redundant reads = pointless
  // I/O and memory pressure.
  const stat = await fs.stat(localPath).catch(() => null);
  if (!stat || !stat.isFile()) {
    throw err(
      'bs_upload_failed',
      `App file not found at ${localPath}.`,
      'Pass a valid path to a built .apk or .ipa.',
    );
  }
  const data = await fs.readFile(localPath);
  const customId = bufferCustomId(data);

  // Server-side dedup probe — skip upload if BS already has this content-hash.
  const cached = await probeRecentApps(auth, customId, merged.probeTimeoutMs);
  if (cached) {
    log.info(`[storybook-rn] reusing existing BrowserStack upload (custom_id=${customId}).`);
    return assertValidAppReference(cached);
  }

  const appUrl = await uploadWithRetry(auth, data, basename(localPath), customId, {
    retries: merged.uploadRetries,
    timeoutMs: merged.uploadTimeoutMs,
  }, [k, u, auth]);

  // Defensive settle — Phase 1 PoC will measure whether this is needed.
  if (merged.postUploadSettleMs > 0) {
    await new Promise((r) => setTimeout(r, merged.postUploadSettleMs));
  }

  return assertValidAppReference(appUrl);
}

/**
 * Escape hatch — accept a pre-provisioned bs:// reference (e.g., from the
 * customer's existing CI upload step). Returns it back for symmetry with
 * provisionApp's signature.
 *
 * @param {unknown} ref
 * @returns {string}
 */
export function useAppReference(ref) {
  return assertValidAppReference(ref);
}

export const __forTesting = {
  fileCustomId,
  buildAuthHeader: basicAuthHeader,
  scrubSecrets,
};
