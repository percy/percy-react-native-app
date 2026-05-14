import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { readApkDebuggable } from '../../percy/util/apkManifest.js';

const DEBUG_APK = '/Users/aryankumar/Desktop/Percy/Percy-react-native-support/examples/RNStorybookFixture/android/app/build/outputs/apk/debug/app-debug.apk';
const RELEASE_APK = '/Users/aryankumar/Desktop/Percy/Percy-react-native-support/examples/RNStorybookFixture/android/app/build/outputs/apk/release/app-release.apk';

const skipIf = (cond) => (cond ? it.skip : it);

describe('readApkDebuggable — real APK fixtures', () => {
  skipIf(!existsSync(DEBUG_APK))(
    'reads android:debuggable=true from a real debug APK',
    async () => {
      const result = await readApkDebuggable(DEBUG_APK);
      expect(result.source).toBe('binary');
      expect(result.debuggable).toBe(true);
    },
    30_000,
  );

  skipIf(!existsSync(RELEASE_APK))(
    'reads android:debuggable=false (absent) from a real release APK',
    async () => {
      const result = await readApkDebuggable(RELEASE_APK);
      expect(result.source).toBe('binary');
      expect(result.debuggable).toBe(false);
    },
    30_000,
  );

  it('returns { debuggable: null, source: "absent" } for a non-APK path', async () => {
    const result = await readApkDebuggable('/etc/hostname');
    expect(result).toEqual({ debuggable: null, source: 'absent' });
  });

  it('returns null for a missing file', async () => {
    const result = await readApkDebuggable('/tmp/this-file-does-not-exist.apk');
    expect(result).toEqual({ debuggable: null, source: 'absent' });
  });
});
