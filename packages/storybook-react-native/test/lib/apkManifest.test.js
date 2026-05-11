import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { readApkDebuggable, __forTesting } from '../../percy/util/apkManifest.js';

const { parseAxmlDebuggable } = __forTesting;

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

describe('parseAxmlDebuggable — structural safety', () => {
  it('returns null for a buffer too short for the root header', () => {
    expect(parseAxmlDebuggable(Buffer.alloc(4))).toEqual({
      debuggable: null,
      source: 'absent',
    });
  });

  it('returns null when the root chunk is not the XML magic', () => {
    const buf = Buffer.alloc(8);
    // wrong chunk type — definitely not 0x0003.
    buf.writeUInt16LE(0xdead, 0);
    buf.writeUInt16LE(8, 2);
    expect(parseAxmlDebuggable(buf)).toEqual({ debuggable: null, source: 'absent' });
  });

  it('returns null when a chunkSize claims more bytes than the buffer has', () => {
    // Valid XML root header, but the next chunk header claims a huge size.
    const buf = Buffer.alloc(16);
    buf.writeUInt16LE(0x0003, 0); // type = XML
    buf.writeUInt16LE(8, 2);      // header size = 8
    // Subsequent chunk: type/header valid but chunkSize bogus.
    buf.writeUInt16LE(0x0001, 8); // type = STRING_POOL
    buf.writeUInt16LE(28, 10);    // header size (will be too big)
    buf.writeUInt32LE(0xffffffff, 12); // chunkSize > buf.length
    expect(parseAxmlDebuggable(buf)).toEqual({ debuggable: null, source: 'absent' });
  });

  it('returns null when no start element was ever reached (no string pool)', () => {
    // Valid root header, then a single padding chunk that is not the
    // string pool — the walk ends without ever resolving any element.
    const buf = Buffer.alloc(24);
    buf.writeUInt16LE(0x0003, 0);
    buf.writeUInt16LE(8, 2);
    // Padding chunk: harmless type, exact size = remaining bytes, but no
    // start element follows.
    buf.writeUInt16LE(0x00ff, 8);
    buf.writeUInt16LE(8, 10);
    buf.writeUInt32LE(16, 12);
    const result = parseAxmlDebuggable(buf);
    expect(result.debuggable).toBe(null);
    expect(result.source).toBe('absent');
  });
});
