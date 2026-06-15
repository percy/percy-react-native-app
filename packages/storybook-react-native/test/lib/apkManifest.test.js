import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, promises as fs, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { readApkDebuggable, __forTesting } from '../../percy/util/apkManifest.js';

const { parseAxmlDebuggable, parseStringPool } = __forTesting;

const DEBUG_APK = process.env.PERCY_TEST_DEBUG_APK
  ?? '/Users/aryankumar/Desktop/Percy/Percy-react-native-support/examples/RNStorybookFixture/android/app/build/outputs/apk/debug/app-debug.apk';
const RELEASE_APK = process.env.PERCY_TEST_RELEASE_APK
  ?? '/Users/aryankumar/Desktop/Percy/Percy-react-native-support/examples/RNStorybookFixture/android/app/build/outputs/apk/release/app-release.apk';

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

  it('returns null when a start element appears before any string pool', () => {
    // Root XML header + a START_ELEMENT chunk with no STRING_POOL in front.
    // Names can't be resolved, parser must bail with `null`.
    const buf = Buffer.alloc(8 + 16 + 16);
    buf.writeUInt16LE(0x0003, 0);
    buf.writeUInt16LE(8, 2);
    // Start element chunk
    buf.writeUInt16LE(0x0102, 8);  // type
    buf.writeUInt16LE(16, 10);     // headerSize
    buf.writeUInt32LE(32, 12);     // chunkSize (header 16 + body 16)
    // Skip body — we just need the parser to recognise the chunk type.
    expect(parseAxmlDebuggable(buf)).toEqual({
      debuggable: null,
      source: 'absent',
    });
  });
});

// ---- synthesized AXML fixtures ----
//
// Hand-rolled binary AXML buffers covering the happy paths of
// `parseAxmlDebuggable`, `parseStringPool`, and the UTF-8 / UTF-16 string
// readers. Replaces real-APK coverage from the example fixture, which moved
// to the standalone example repo.
//
// AXML layout reference: Android's frameworks/base ResourceTypes.h.

/**
 * Build an AXML UTF-8 string-pool chunk for the given strings.
 * Returns a Buffer containing only the string-pool chunk (header + index +
 * data + 4-byte alignment pad).
 */
function buildStringPoolUtf8(strings) {
  const HEADER_SIZE = 28;
  // Encode each string: u8 charLen, u8 byteLen, bytes, u8 0x00 terminator.
  // Pre-pass for varint sizing: we deliberately stick to non-varint (<128
  // chars) for the simple cases; the varint paths are covered separately.
  const encoded = strings.map((s) => {
    if (s.length >= 0x80) {
      // Varint-style: high bit set on first byte, second byte contains low 8
      // bits. Same for byteLen (assuming UTF-8 byte length matches char length
      // for the ASCII strings we craft below).
      const len = s.length;
      const hi = 0x80 | ((len >> 8) & 0x7f);
      const lo = len & 0xff;
      const bytes = Buffer.from(s, 'utf8');
      return Buffer.concat([
        Buffer.from([hi, lo, hi, lo]),
        bytes,
        Buffer.from([0x00]),
      ]);
    }
    const bytes = Buffer.from(s, 'utf8');
    return Buffer.concat([
      Buffer.from([s.length, bytes.length]),
      bytes,
      Buffer.from([0x00]),
    ]);
  });

  const indexArray = Buffer.alloc(strings.length * 4);
  let runningOffset = 0;
  encoded.forEach((b, i) => {
    indexArray.writeUInt32LE(runningOffset, i * 4);
    runningOffset += b.length;
  });

  const stringData = Buffer.concat(encoded);
  // 4-byte align string data section.
  const padLen = (4 - (stringData.length % 4)) % 4;
  const padded = Buffer.concat([stringData, Buffer.alloc(padLen)]);

  const stringsStart = HEADER_SIZE + indexArray.length;
  const chunkSize = stringsStart + padded.length;

  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt16LE(0x0001, 0);       // type = STRING_POOL
  header.writeUInt16LE(HEADER_SIZE, 2);  // header size
  header.writeUInt32LE(chunkSize, 4);    // chunk size
  header.writeUInt32LE(strings.length, 8);  // string count
  header.writeUInt32LE(0, 12);              // style count
  header.writeUInt32LE(0x100, 16);          // flags: UTF-8
  header.writeUInt32LE(stringsStart, 20);   // strings start
  header.writeUInt32LE(0, 24);              // styles start

  return Buffer.concat([header, indexArray, padded]);
}

/**
 * Build an AXML UTF-16LE string-pool chunk for the given strings. Used to
 * exercise the UTF-16 branch of `parseStringPool` / `readUtf16String`.
 */
function buildStringPoolUtf16(strings) {
  const HEADER_SIZE = 28;
  const encoded = strings.map((s) => {
    // u16 charLen + chars + u16 0x0000 terminator (non-varint for simple).
    const chars = Buffer.from(s, 'utf16le');
    const out = Buffer.alloc(2 + chars.length + 2);
    out.writeUInt16LE(s.length, 0);
    chars.copy(out, 2);
    // Trailing u16 0x0000 already zero from alloc.
    return out;
  });

  const indexArray = Buffer.alloc(strings.length * 4);
  let runningOffset = 0;
  encoded.forEach((b, i) => {
    indexArray.writeUInt32LE(runningOffset, i * 4);
    runningOffset += b.length;
  });

  const stringData = Buffer.concat(encoded);
  const padLen = (4 - (stringData.length % 4)) % 4;
  const padded = Buffer.concat([stringData, Buffer.alloc(padLen)]);

  const stringsStart = HEADER_SIZE + indexArray.length;
  const chunkSize = stringsStart + padded.length;

  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt16LE(0x0001, 0);
  header.writeUInt16LE(HEADER_SIZE, 2);
  header.writeUInt32LE(chunkSize, 4);
  header.writeUInt32LE(strings.length, 8);
  header.writeUInt32LE(0, 12);
  header.writeUInt32LE(0, 16);              // flags: no UTF-8 bit → UTF-16
  header.writeUInt32LE(stringsStart, 20);
  header.writeUInt32LE(0, 24);

  return Buffer.concat([header, indexArray, padded]);
}

/**
 * Build a single START_ELEMENT chunk with N attributes.
 *
 * Each attribute = { nameIdx, dataType, data } and is laid out as
 * 20 bytes per `ResXMLTree_attribute`.
 */
function buildStartElement({ nameIdx, attrs }) {
  const HEADER_SIZE = 16;
  const BODY_HEAD = 16; // ns(4)+name(4)+attrStart(2)+attrSize(2)+attrCount(2)+pad(2)
  const ATTR_SIZE = 20;
  const body = Buffer.alloc(BODY_HEAD + attrs.length * ATTR_SIZE);
  body.writeInt32LE(-1, 0);            // ns = none
  body.writeInt32LE(nameIdx, 4);       // element name idx
  body.writeUInt16LE(BODY_HEAD, 8);    // attrStartRel
  body.writeUInt16LE(ATTR_SIZE, 10);   // attrSize
  body.writeUInt16LE(attrs.length, 12); // attrCount
  body.writeUInt16LE(0, 14);            // pad (idAttr/classAttr/styleAttr)

  attrs.forEach((a, i) => {
    const off = BODY_HEAD + i * ATTR_SIZE;
    body.writeInt32LE(-1, off + 0);     // attr ns
    body.writeInt32LE(a.nameIdx, off + 4);
    body.writeInt32LE(-1, off + 8);     // raw value
    body.writeUInt16LE(8, off + 12);    // typedValue.size
    body.writeUInt8(0, off + 14);       // res0
    body.writeUInt8(a.dataType, off + 15);
    body.writeInt32LE(a.data, off + 16);
  });

  const chunkSize = HEADER_SIZE + body.length;
  const header = Buffer.alloc(HEADER_SIZE);
  header.writeUInt16LE(0x0102, 0);
  header.writeUInt16LE(HEADER_SIZE, 2);
  header.writeUInt32LE(chunkSize, 4);
  // ResXMLTree_node tail: line number + commentRef. Parser doesn't read
  // these but they're part of the 16-byte header it walks past.
  header.writeUInt32LE(0, 8);
  header.writeInt32LE(-1, 12);

  return Buffer.concat([header, body]);
}

function buildAxml(stringPool, elements) {
  const root = Buffer.alloc(8);
  root.writeUInt16LE(0x0003, 0);
  root.writeUInt16LE(8, 2);
  root.writeUInt32LE(8 + stringPool.length + elements.reduce((n, e) => n + e.length, 0), 4);
  return Buffer.concat([root, stringPool, ...elements]);
}

describe('parseAxmlDebuggable — synthesized AXML (UTF-8 string pool)', () => {
  it('returns debuggable=true when an <application> element carries android:debuggable="true"', () => {
    const strings = ['debuggable', 'application', 'other'];
    const pool = buildStringPoolUtf8(strings);
    const el = buildStartElement({
      nameIdx: 1,
      attrs: [{ nameIdx: 0, dataType: 0x12, data: 1 }],
    });
    expect(parseAxmlDebuggable(buildAxml(pool, [el]))).toEqual({
      debuggable: true,
      source: 'binary',
    });
  });

  it('returns debuggable=false when start elements parse cleanly but no debuggable attr is set', () => {
    const strings = ['name', 'application'];
    const pool = buildStringPoolUtf8(strings);
    const el = buildStartElement({
      nameIdx: 1,
      attrs: [{ nameIdx: 0, dataType: 0x03, data: 42 }], // ordinary string attr
    });
    expect(parseAxmlDebuggable(buildAxml(pool, [el]))).toEqual({
      debuggable: false,
      source: 'binary',
    });
  });

  it('ignores a debuggable attr whose dataType is not INT_BOOLEAN (defensive)', () => {
    const strings = ['debuggable', 'application'];
    const pool = buildStringPoolUtf8(strings);
    const el = buildStartElement({
      nameIdx: 1,
      attrs: [{ nameIdx: 0, dataType: 0x03, data: 1 }], // string type, not bool
    });
    // No matching attr was honoured, but a start element was parsed cleanly →
    // false is the documented absence semantic.
    expect(parseAxmlDebuggable(buildAxml(pool, [el]))).toEqual({
      debuggable: false,
      source: 'binary',
    });
  });

  it('treats debuggable=0 as false (TYPE_INT_BOOLEAN with data=0)', () => {
    const strings = ['debuggable', 'application'];
    const pool = buildStringPoolUtf8(strings);
    const el = buildStartElement({
      nameIdx: 1,
      attrs: [{ nameIdx: 0, dataType: 0x12, data: 0 }],
    });
    expect(parseAxmlDebuggable(buildAxml(pool, [el]))).toEqual({
      debuggable: false,
      source: 'binary',
    });
  });
});

describe('parseAxmlDebuggable — synthesized AXML (UTF-16 string pool)', () => {
  it('reads strings from a UTF-16LE pool and detects debuggable=true', () => {
    const strings = ['debuggable', 'application'];
    const pool = buildStringPoolUtf16(strings);
    const el = buildStartElement({
      nameIdx: 1,
      attrs: [{ nameIdx: 0, dataType: 0x12, data: 1 }],
    });
    expect(parseAxmlDebuggable(buildAxml(pool, [el]))).toEqual({
      debuggable: true,
      source: 'binary',
    });
  });
});

describe('parseStringPool — direct unit tests', () => {
  it('reads a small UTF-8 pool with multiple ASCII strings', () => {
    const pool = buildStringPoolUtf8(['alpha', 'beta', 'gamma']);
    expect(parseStringPool(pool, 0, 28)).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('reads a small UTF-16LE pool with multiple ASCII strings', () => {
    const pool = buildStringPoolUtf16(['one', 'two', 'three']);
    expect(parseStringPool(pool, 0, 28)).toEqual(['one', 'two', 'three']);
  });

  it('decodes UTF-8 varint string lengths (charLen high bit set)', () => {
    // Build a single >=128-char string so both charLen and byteLen take the
    // varint two-byte form in `readUtf8String`.
    const long = 'a'.repeat(200);
    const pool = buildStringPoolUtf8([long]);
    const result = parseStringPool(pool, 0, 28);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(long);
  });

  it('returns "" for a string whose offset falls past the buffer end', () => {
    // Build a valid 2-string pool then truncate the buffer so the second
    // string's absolute offset is exactly at/past buf.length — triggering
    // the `absOffset >= buf.length` short-circuit in parseStringPool.
    //   header(28) + indexArr(8) + 'alpha'(8) + 'beta'(7) + pad(1) = 52
    //   second-string absOffset = stringDataStart(36) + 8 = 44
    // Cutting to exactly 44 bytes makes absOffset === buf.length.
    const pool = buildStringPoolUtf8(['alpha', 'beta']);
    const truncated = pool.subarray(0, 44);
    const result = parseStringPool(truncated, 0, 28);
    expect(result[0]).toBe('alpha');
    expect(result[1]).toBe('');
  });

  it('returns null when the index array would overflow the buffer', () => {
    // Header announces 999 strings but the buffer holds only the 28-byte
    // header — index array is unreachable.
    const buf = Buffer.alloc(28);
    buf.writeUInt16LE(0x0001, 0);
    buf.writeUInt16LE(28, 2);
    buf.writeUInt32LE(28, 4);
    buf.writeUInt32LE(999, 8);   // bogus string count
    buf.writeUInt32LE(0, 12);
    buf.writeUInt32LE(0x100, 16);
    buf.writeUInt32LE(28, 20);
    expect(parseStringPool(buf, 0, 28)).toBe(null);
  });

  it('returns null when the chunk header itself is truncated', () => {
    const tiny = Buffer.alloc(8);
    expect(parseStringPool(tiny, 0, 28)).toBe(null);
  });

  it('returns "" when readUtf16String throws RangeError mid-buffer (catch path)', () => {
    // Construct an index-array entry pointing 1 byte before the buffer end,
    // so absOffset < buf.length passes the >= check, but `buf.readUInt16LE`
    // inside readUtf16String tries to read offset+1 which is past EOF and
    // throws — exercising the try/catch in parseStringPool.
    const HEADER_SIZE = 28;
    // Build a buffer just big enough: header(28) + indexArr(4) + stringData(2) = 34.
    const buf = Buffer.alloc(34);
    buf.writeUInt16LE(0x0001, 0);
    buf.writeUInt16LE(HEADER_SIZE, 2);
    buf.writeUInt32LE(34, 4);
    buf.writeUInt32LE(1, 8);                       // 1 string
    buf.writeUInt32LE(0, 12);
    buf.writeUInt32LE(0, 16);                      // UTF-16
    buf.writeUInt32LE(HEADER_SIZE + 4, 20);        // stringsStart = 32
    buf.writeUInt32LE(0, 24);
    // Index entry — relative offset within string data section. With
    // stringsStart=32 and entry=1, absOffset=33. buf.length=34, so the
    // first readUInt16LE(33) call tries to read bytes 33+34 → RangeError.
    buf.writeUInt32LE(1, HEADER_SIZE);
    const result = parseStringPool(buf, 0, HEADER_SIZE);
    expect(result[0]).toBe('');
  });

  it('returns null when the root header size is out of range (rootHeaderSize > buf.length)', () => {
    // Valid XML magic but a bogus root header size larger than the buffer →
    // the `rootHeaderSize < 8 || rootHeaderSize > buf.length` guard fires.
    const buf = Buffer.alloc(8);
    buf.writeUInt16LE(0x0003, 0);   // type = XML
    buf.writeUInt16LE(0xffff, 2);   // header size > buf.length
    expect(parseAxmlDebuggable(buf)).toEqual({ debuggable: null, source: 'absent' });
  });

  it('returns null when the root header size is below the 8-byte minimum', () => {
    const buf = Buffer.alloc(8);
    buf.writeUInt16LE(0x0003, 0);
    buf.writeUInt16LE(4, 2);        // header size < 8
    expect(parseAxmlDebuggable(buf)).toEqual({ debuggable: null, source: 'absent' });
  });

  it('decodes UTF-16 strings whose charLen uses the varint high-bit extension', () => {
    // Manually build a UTF-16 pool with one string using varint length
    // encoding (charLen high bit set, second u16 carries the low 16 bits).
    const HEADER_SIZE = 28;
    // Encode "hello" with the varint shape: high u16 has 0x8000, then a u16
    // containing the low 16 bits of the real length (5).
    const chars = Buffer.from('hello', 'utf16le'); // 10 bytes
    const stringBuf = Buffer.alloc(2 + 2 + chars.length + 2);
    stringBuf.writeUInt16LE(0x8000, 0);  // high bit set, "high half" = 0
    stringBuf.writeUInt16LE(5, 2);        // actual char count
    chars.copy(stringBuf, 4);
    // Trailing u16 0x0000 already zero from alloc.

    const indexArray = Buffer.alloc(4);
    indexArray.writeUInt32LE(0, 0);
    const padLen = (4 - (stringBuf.length % 4)) % 4;
    const padded = Buffer.concat([stringBuf, Buffer.alloc(padLen)]);

    const stringsStart = HEADER_SIZE + indexArray.length;
    const chunkSize = stringsStart + padded.length;

    const header = Buffer.alloc(HEADER_SIZE);
    header.writeUInt16LE(0x0001, 0);
    header.writeUInt16LE(HEADER_SIZE, 2);
    header.writeUInt32LE(chunkSize, 4);
    header.writeUInt32LE(1, 8);
    header.writeUInt32LE(0, 12);
    header.writeUInt32LE(0, 16);                // UTF-16
    header.writeUInt32LE(stringsStart, 20);
    header.writeUInt32LE(0, 24);

    const pool = Buffer.concat([header, indexArray, padded]);
    expect(parseStringPool(pool, 0, HEADER_SIZE)).toEqual(['hello']);
  });
});

// ---- readApkDebuggable — synthesized .apk (real ZIP) fixtures ----
//
// readApkDebuggable extracts AndroidManifest.xml from a real ZIP (APKs are
// ZIP archives) via adm-zip, then hands the bytes to parseAxmlDebuggable.
// We build genuine .apk ZIPs on disk containing synthesized binary AXML
// manifests — covering the adm-zip extraction path end-to-end without
// shipping a binary APK fixture.

/** Build an AXML buffer for an <application android:debuggable=<bool>> element. */
function buildDebuggableManifest(debuggable) {
  const strings = ['debuggable', 'application'];
  const pool = buildStringPoolUtf8(strings);
  const el = buildStartElement({
    nameIdx: 1,
    attrs: [{ nameIdx: 0, dataType: 0x12, data: debuggable ? 1 : 0 }],
  });
  return buildAxml(pool, [el]);
}

/** Write a real .apk (ZIP) to disk with the given AndroidManifest.xml bytes. */
function writeApkZip(dir, name, manifestBuf) {
  const zip = new AdmZip();
  zip.addFile('AndroidManifest.xml', manifestBuf);
  zip.addFile('classes.dex', Buffer.from('not-a-real-dex'));
  const p = join(dir, name);
  zip.writeZip(p);
  return p;
}

describe('readApkDebuggable — synthesized .apk ZIP fixtures', () => {
  let tmp;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tmp) await fs.rm(tmp, { recursive: true, force: true });
    tmp = undefined;
  });

  it('reads android:debuggable=true from a synthesized debug APK ZIP', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'percy-apk-zip-'));
    const apk = writeApkZip(tmp, 'app-debug.apk', buildDebuggableManifest(true));
    const result = await readApkDebuggable(apk);
    expect(result).toEqual({ debuggable: true, source: 'binary' });
  });

  it('reads android:debuggable=false from a synthesized release APK ZIP', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'percy-apk-zip-'));
    const apk = writeApkZip(tmp, 'app-release.apk', buildDebuggableManifest(false));
    const result = await readApkDebuggable(apk);
    expect(result).toEqual({ debuggable: false, source: 'binary' });
  });

  it('returns null when the APK ZIP has no AndroidManifest.xml entry', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'percy-apk-zip-'));
    const zip = new AdmZip();
    zip.addFile('classes.dex', Buffer.from('only-a-dex'));
    const apk = join(tmp, 'no-manifest.apk');
    zip.writeZip(apk);
    expect(await readApkDebuggable(apk)).toEqual({ debuggable: null, source: 'absent' });
  });

  it('returns null for an APK larger than the 1 GB cap (without reading it)', async () => {
    tmp = mkdtempSync(join(tmpdir(), 'percy-apk-zip-'));
    const apk = join(tmp, 'huge.apk');
    writeFileSync(apk, 'header');
    // Grow the file to just over 1 GB via a sparse truncate — this reports a
    // >1 GB stat.size to readApkDebuggable's MAX_APK_SIZE_BYTES guard while
    // consuming ~no real disk (the OS allocates a hole, not blocks).
    await fs.truncate(apk, 1024 * 1024 * 1024 + 1);
    expect(await readApkDebuggable(apk)).toEqual({ debuggable: null, source: 'absent' });
  });
});
