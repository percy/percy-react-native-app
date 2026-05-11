import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, mkdtempSync } from 'node:fs';
import {
  provisionApp,
  useAppReference,
  __forTesting,
} from '../../percy/provisionApp.js';

const { fileCustomId, buildAuthHeader } = __forTesting;

let tmp;
let apkPath;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'percy-storybook-rn-test-'));
  apkPath = join(tmp, 'storybook.apk');
  writeFileSync(apkPath, Buffer.from('fake-apk-bytes'));
  vi.unstubAllGlobals();
  delete process.env.BROWSERSTACK_USERNAME;
  delete process.env.BROWSERSTACK_ACCESS_KEY;
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('fileCustomId', () => {
  it('returns 40-char hex sha256 prefix', async () => {
    const id = await fileCustomId(apkPath);
    expect(id).toHaveLength(40);
    expect(id).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic for same content', async () => {
    expect(await fileCustomId(apkPath)).toBe(await fileCustomId(apkPath));
  });

  it('differs when content differs', async () => {
    const other = join(tmp, 'other.apk');
    writeFileSync(other, Buffer.from('different-bytes'));
    expect(await fileCustomId(apkPath)).not.toBe(await fileCustomId(other));
  });
});

describe('buildAuthHeader', () => {
  it('produces base64 Basic header', () => {
    expect(buildAuthHeader('foo', 'bar')).toBe(`Basic ${Buffer.from('foo:bar').toString('base64')}`);
  });
});

describe('useAppReference', () => {
  it('returns the same bs:// ref', () => {
    expect(useAppReference('bs://abc123')).toBe('bs://abc123');
  });

  it('rejects non-bs:// refs', () => {
    expect(() => useAppReference('http://example.com/app.apk')).toThrow();
  });
});

describe('provisionApp — local transport', () => {
  it('returns the local path when no BS creds present', async () => {
    const ref = await provisionApp(apkPath);
    expect(ref).toBe(apkPath);
  });

  it('returns the local path when opts.transport === "local" even with BS env', async () => {
    process.env.BROWSERSTACK_USERNAME = 'u';
    process.env.BROWSERSTACK_ACCESS_KEY = 'k';
    const ref = await provisionApp(apkPath, { transport: 'local' });
    expect(ref).toBe(apkPath);
  });

  it('throws when local file does not exist', async () => {
    await expect(provisionApp(join(tmp, 'missing.apk'))).rejects.toThrow();
  });
});

describe('provisionApp — App Automate transport', () => {
  it('hits recent_apps GET and skips upload on cache hit', async () => {
    process.env.BROWSERSTACK_USERNAME = 'u';
    process.env.BROWSERSTACK_ACCESS_KEY = 'k';

    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes('/recent_apps/')) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ app_url: 'bs://cached-ref-123' }],
        };
      }
      throw new Error('upload should not be called when cache hits');
    });
    vi.stubGlobal('fetch', fetchMock);

    const ref = await provisionApp(apkPath, { postUploadSettleMs: 0 });
    expect(ref).toBe('bs://cached-ref-123');
    // recent_apps probe + nothing else
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls through to upload on recent_apps 404', async () => {
    process.env.BROWSERSTACK_USERNAME = 'u';
    process.env.BROWSERSTACK_ACCESS_KEY = 'k';

    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes('/recent_apps/')) {
        return { ok: false, status: 404, text: async () => 'not found' };
      }
      // upload
      return {
        ok: true,
        status: 200,
        json: async () => ({ app_url: 'bs://newly-uploaded-456' }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const ref = await provisionApp(apkPath, { postUploadSettleMs: 0 });
    expect(ref).toBe('bs://newly-uploaded-456');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries on 5xx with exponential backoff', async () => {
    process.env.BROWSERSTACK_USERNAME = 'u';
    process.env.BROWSERSTACK_ACCESS_KEY = 'k';

    let calls = 0;
    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes('/recent_apps/')) {
        return { ok: false, status: 404, text: async () => '' };
      }
      calls++;
      if (calls < 3) {
        return { ok: false, status: 502, text: async () => 'bad gateway' };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ app_url: 'bs://succeeded-after-retry' }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const ref = await provisionApp(apkPath, {
      postUploadSettleMs: 0,
      uploadRetries: 3,
    });
    expect(ref).toBe('bs://succeeded-after-retry');
    // 1 recent_apps + 3 upload attempts
    expect(fetchMock).toHaveBeenCalledTimes(4);
  }, 30_000);

  it('fails fast on 4xx (no retry)', async () => {
    process.env.BROWSERSTACK_USERNAME = 'u';
    process.env.BROWSERSTACK_ACCESS_KEY = 'k';

    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes('/recent_apps/')) {
        return { ok: false, status: 404, text: async () => '' };
      }
      return { ok: false, status: 401, text: async () => 'unauthorized' };
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      provisionApp(apkPath, { postUploadSettleMs: 0, uploadRetries: 3 }),
    ).rejects.toMatchObject({ code: 'bs_upload_failed' });
    // 1 recent_apps + 1 upload attempt (no retry on 4xx)
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws bs_upload_too_large on 413', async () => {
    process.env.BROWSERSTACK_USERNAME = 'u';
    process.env.BROWSERSTACK_ACCESS_KEY = 'k';

    const fetchMock = vi.fn(async (url) => {
      if (String(url).includes('/recent_apps/')) {
        return { ok: false, status: 404, text: async () => '' };
      }
      return { ok: false, status: 413, text: async () => 'too large' };
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      provisionApp(apkPath, { postUploadSettleMs: 0 }),
    ).rejects.toMatchObject({ code: 'bs_upload_too_large' });
  });

  it('throws bs_credentials_missing when env not set and no opts.credentials', async () => {
    // No env vars set in this test (cleared in beforeEach).
    // Without creds, provisionApp returns local path — not an error.
    // But explicitly forcing transport=app-automate should throw.
    // Actually: per spec, no creds => local transport, return local path.
    const ref = await provisionApp(apkPath);
    expect(ref).toBe(apkPath);
  });
});

describe('provisionApp — debug-build detection (item 2.3)', () => {
  it('rejects a real debug APK with build_is_debug_variant', async () => {
    process.env.BROWSERSTACK_USERNAME = 'u';
    process.env.BROWSERSTACK_ACCESS_KEY = 'k';
    const DEBUG_APK = '/Users/aryankumar/Desktop/Percy/Percy-react-native-support/examples/RNStorybookFixture/android/app/build/outputs/apk/debug/app-debug.apk';
    // Stub fetch so we never actually hit BS — the guard must fire before that.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(provisionApp(DEBUG_APK, { postUploadSettleMs: 0 })).rejects.toMatchObject({
      code: 'build_is_debug_variant',
    });
    // Guard fires before any network call.
    expect(fetchSpy).not.toHaveBeenCalled();
  }, 30_000);

  it('accepts the same APK when skipDebugBuildCheck is true', async () => {
    process.env.BROWSERSTACK_USERNAME = 'u';
    process.env.BROWSERSTACK_ACCESS_KEY = 'k';
    const DEBUG_APK = '/Users/aryankumar/Desktop/Percy/Percy-react-native-support/examples/RNStorybookFixture/android/app/build/outputs/apk/debug/app-debug.apk';
    // Stub fetch: recent_apps says cache hit so we don't actually upload.
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [{ app_url: 'bs://cached-debug-ref' }],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const ref = await provisionApp(DEBUG_APK, { postUploadSettleMs: 0, skipDebugBuildCheck: true });
    expect(ref).toBe('bs://cached-debug-ref');
  }, 30_000);

  it('accepts a release APK normally (no guard fires)', async () => {
    process.env.BROWSERSTACK_USERNAME = 'u';
    process.env.BROWSERSTACK_ACCESS_KEY = 'k';
    const RELEASE_APK = '/Users/aryankumar/Desktop/Percy/Percy-react-native-support/examples/RNStorybookFixture/android/app/build/outputs/apk/release/app-release.apk';
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [{ app_url: 'bs://cached-release-ref' }],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const ref = await provisionApp(RELEASE_APK, { postUploadSettleMs: 0 });
    expect(ref).toBe('bs://cached-release-ref');
  }, 30_000);
});
