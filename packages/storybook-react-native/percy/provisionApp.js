import { promises as fs } from 'node:fs';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import { log } from './util/log.js';
import { err } from '../src/errors.js';
import { assertValidAppReference } from './util/validations.js';

const UPLOAD_URL = 'https://api-cloud.browserstack.com/app-automate/upload';
const RECENT_APPS_URL = 'https://api-cloud.browserstack.com/app-automate/recent_apps';

const DEFAULTS = {
  uploadRetries: 3,
  uploadTimeoutMs: 120_000,
  postUploadSettleMs: 5_000, // defensive — until Phase 1 PoC measures actual readiness
};

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
  return { userName, accessKey };
}

function basicAuthHeader(userName, accessKey) {
  return `Basic ${Buffer.from(`${userName}:${accessKey}`).toString('base64')}`;
}

/**
 * Compute sha256 of the file at `localPath` and slice to 40 chars to fit
 * BrowserStack's `custom_id` charset constraints ([A-Za-z0-9._-], max 100).
 *
 * @param {string} localPath
 */
async function fileCustomId(localPath) {
  const buf = await fs.readFile(localPath);
  return createHash('sha256').update(buf).digest('hex').slice(0, 40);
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
      log.debug(`recent_apps probe non-OK: ${res.status}`);
      return undefined;
    }
    const json = /** @type {Array<{ app_url?: string }>} */ (await res.json());
    if (!Array.isArray(json) || json.length === 0) return undefined;
    return json[0]?.app_url;
  } catch (cause) {
    log.debug(`recent_apps probe failed: ${cause instanceof Error ? cause.message : cause}`);
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
 * @param {string} authHeader
 * @param {string} localPath
 * @param {string} customId
 * @param {{ retries: number, timeoutMs: number }} retryOpts
 */
async function uploadWithRetry(authHeader, localPath, customId, retryOpts) {
  const stat = await fs.stat(localPath).catch(() => null);
  if (!stat || !stat.isFile()) {
    throw err(
      'bs_upload_failed',
      `App file not found at ${localPath}.`,
      'Pass a valid path to a built .apk or .ipa.',
    );
  }
  const data = await fs.readFile(localPath);
  const filename = basename(localPath);

  let lastErr;
  for (let attempt = 1; attempt <= retryOpts.retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), retryOpts.timeoutMs);
    try {
      const form = new FormData();
      form.append('file', new Blob([new Uint8Array(data)]), filename);
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
          `BrowserStack rejected the upload (413). ${body.slice(0, 200)}`,
          'Reduce app size or contact BrowserStack support to raise the per-account limit.',
        );
      }
      if (res.status >= 400 && res.status < 500) {
        const body = await res.text().catch(() => '');
        throw err(
          'bs_upload_failed',
          `BrowserStack upload failed with HTTP ${res.status}: ${body.slice(0, 200)}`,
          'Verify BROWSERSTACK_USERNAME / BROWSERSTACK_ACCESS_KEY and try again.',
        );
      }
      if (!res.ok) {
        // 5xx — retry
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const json = /** @type {{ app_url?: string }} */ (await res.json());
      if (!json.app_url) {
        throw err(
          'bs_upload_failed',
          `BrowserStack returned 200 but no app_url in response: ${JSON.stringify(json)}`,
        );
      }
      return json.app_url;
    } catch (cause) {
      lastErr = cause;
      // Don't retry on our typed PercyStorybookRNError 4xx — they're already terminal.
      if (cause && /** @type {{ code?: string }} */ (cause).code &&
          ['bs_upload_too_large', 'bs_upload_failed'].includes(/** @type {{ code: string }} */ (cause).code) &&
          // Generic 'bs_upload_failed' from 4xx is terminal; from network/5xx, retry.
          attempt > 1) {
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
  const isAppAutomate = Boolean(userName && accessKey) && opts?.transport !== 'local';

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

  const { userName: u, accessKey: k } = readCredentials(opts);
  const auth = basicAuthHeader(u, k);
  const customId = await fileCustomId(localPath);

  // Server-side dedup probe — skip upload if BS already has this content-hash.
  const cached = await probeRecentApps(auth, customId, 10_000);
  if (cached) {
    log.info(`[storybook-rn] reusing existing BrowserStack upload (custom_id=${customId}).`);
    return assertValidAppReference(cached);
  }

  const appUrl = await uploadWithRetry(auth, localPath, customId, {
    retries: merged.uploadRetries,
    timeoutMs: merged.uploadTimeoutMs,
  });

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
};
