import fs from 'node:fs/promises';
import AdmZip from 'adm-zip';

/**
 * Minimal Android Binary XML (AXML) reader focused on detecting
 * `android:debuggable="true"` in an APK's AndroidManifest.xml.
 *
 * The AXML format (per Android `ResourceTypes.h`) is a chunked binary
 * representation of XML. We only need to walk far enough to find the
 * `<application>` element's `debuggable` attribute. The full format is
 * documented at:
 *   https://android.googlesource.com/platform/frameworks/base/+/master/libs/androidfw/include/androidfw/ResourceTypes.h
 *
 * We use adm-zip to extract AndroidManifest.xml from the APK (APKs are
 * ZIP archives; the manifest is conventionally stored compressed).
 */

const CHUNK_TYPE_XML = 0x0003;
const CHUNK_TYPE_STRING_POOL = 0x0001;
const CHUNK_TYPE_XML_START_ELEMENT = 0x0102;
const STRING_POOL_FLAG_UTF8 = (1 << 8);
const TYPE_INT_BOOLEAN = 0x12;

/** Hard cap on APK size we'll attempt to read via adm-zip. */
const MAX_APK_SIZE_BYTES = 1024 * 1024 * 1024; // 1 GB matches BS upload limit

/**
 * Extract AndroidManifest.xml from an APK + parse the `debuggable` flag.
 *
 * Returns `debuggable: null` on ANY structural failure — caller must treat
 * "unknown" distinctly from "known-false". Falsely reporting `false` would
 * let a debuggable build slip past the pre-upload check and redbox on the
 * cloud device.
 *
 * @param {string} apkPath
 * @returns {Promise<{ debuggable: boolean | null, source: 'binary' | 'absent' }>}
 *   - `debuggable: true`  → APK is debuggable (expects Metro at runtime)
 *   - `debuggable: false` → APK is not debuggable (release-shape)
 *   - `debuggable: null`  → could not parse manifest; caller should not infer safety
 */
export async function readApkDebuggable(apkPath) {
  let manifestBuf;
  try {
    const stat = await fs.stat(apkPath);
    if (stat.size > MAX_APK_SIZE_BYTES) {
      return { debuggable: null, source: 'absent' };
    }
    const zip = new AdmZip(apkPath);
    const entry = zip.getEntry('AndroidManifest.xml');
    if (!entry) return { debuggable: null, source: 'absent' };
    manifestBuf = entry.getData();
  } catch {
    return { debuggable: null, source: 'absent' };
  }

  try {
    return parseAxmlDebuggable(manifestBuf);
  } catch {
    return { debuggable: null, source: 'absent' };
  }
}

/**
 * Walk an AXML buffer and return whether the application element has
 * `android:debuggable="true"`.
 *
 * Returns `{ debuggable: false, source: 'binary' }` only when the AXML
 * was parsed cleanly AND no `debuggable` attribute was present — that
 * matches a real release build (absent → false per Android convention).
 *
 * Returns `{ debuggable: null, source: 'absent' }` on ANY structural
 * failure (truncation, wrong root chunk, missing string pool before
 * elements). "Unknown" must not be confused with "known-false" by the
 * caller — falsely returning `false` would let a debuggable APK upload.
 *
 * Strategy: parse the string pool, then scan every start-element's
 * attributes for the `debuggable` name index.
 *
 * @param {Buffer} buf
 */
export function parseAxmlDebuggable(buf) {
  if (buf.length < 8) return { debuggable: null, source: 'absent' };

  // Top-level XML chunk header
  const rootType = buf.readUInt16LE(0);
  const rootHeaderSize = buf.readUInt16LE(2);
  if (rootType !== CHUNK_TYPE_XML) return { debuggable: null, source: 'absent' };
  if (rootHeaderSize < 8 || rootHeaderSize > buf.length) {
    return { debuggable: null, source: 'absent' };
  }

  let offset = rootHeaderSize;
  let stringPool = null;
  let sawStartElement = false;
  let debuggable = false;

  while (offset + 8 <= buf.length) {
    const chunkType = buf.readUInt16LE(offset);
    const chunkHeaderSize = buf.readUInt16LE(offset + 2);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkSize < 8 || chunkSize > buf.length - offset) {
      // Truncated or malformed chunk — cannot trust anything after this point.
      return { debuggable: null, source: 'absent' };
    }

    if (chunkType === CHUNK_TYPE_STRING_POOL) {
      stringPool = parseStringPool(buf, offset, chunkHeaderSize);
      if (stringPool === null) return { debuggable: null, source: 'absent' };
    } else if (chunkType === CHUNK_TYPE_XML_START_ELEMENT) {
      // A start-element before the string pool means we can't resolve
      // attribute names — bail rather than guess.
      if (!stringPool) return { debuggable: null, source: 'absent' };
      sawStartElement = true;
      // After the chunk header:
      //   line number (4) + comment ref (4) — these are part of the
      //   "ResXMLTree_node" header. Then the start-element body:
      //   ns (4) + name (4) + attributeStart (2) + attributeSize (2)
      //   + attributeCount (2) + ... (more counts we don't need)
      const bodyOffset = offset + chunkHeaderSize;
      if (bodyOffset + 14 > buf.length) return { debuggable: null, source: 'absent' };
      const attrStartRel = buf.readUInt16LE(bodyOffset + 8);
      const attrSize = buf.readUInt16LE(bodyOffset + 10);
      const attrCount = buf.readUInt16LE(bodyOffset + 12);
      const attrStartAbs = bodyOffset + attrStartRel;

      for (let i = 0; i < attrCount; i++) {
        const attrOffset = attrStartAbs + i * attrSize;
        if (attrOffset + 20 > buf.length) break;
        // ResXMLTree_attribute layout:
        //   0..3   ns string index
        //   4..7   name string index
        //   8..11  raw value string index (or -1)
        //   12..13 typedValue.size
        //   14     typedValue.res0
        //   15     typedValue.dataType
        //   16..19 typedValue.data
        const nameIdx = buf.readInt32LE(attrOffset + 4);
        const name = stringPool[nameIdx];
        if (name === 'debuggable') {
          const dataType = buf.readUInt8(attrOffset + 15);
          const data = buf.readInt32LE(attrOffset + 16);
          if (dataType === TYPE_INT_BOOLEAN) {
            debuggable = data !== 0;
            return { debuggable, source: 'binary' };
          }
        }
      }
    }
    offset += chunkSize;
  }

  // We parsed the manifest end-to-end without hitting a `debuggable` attr.
  // A real release APK omits the attr entirely — Android treats absence as
  // false. We can confidently report `false` only if we saw at least one
  // start element resolved through the string pool; otherwise the parse
  // didn't actually inspect anything and we should report unknown.
  if (!sawStartElement) return { debuggable: null, source: 'absent' };
  return { debuggable, source: 'binary' };
}

/**
 * Parse an AXML string pool chunk. Returns an array of strings indexed
 * by their pool index.
 *
 * The string pool header layout:
 *   0..1   chunk type
 *   2..3   header size
 *   4..7   chunk size
 *   8..11  string count
 *   12..15 style count
 *   16..19 flags (bit 8 = UTF-8 encoded; otherwise UTF-16LE)
 *   20..23 strings start offset (from start of chunk)
 *   24..27 styles start offset
 *
 * @param {Buffer} buf
 * @param {number} chunkOffset
 * @param {number} headerSize
 */
function parseStringPool(buf, chunkOffset, headerSize) {
  if (chunkOffset + 28 > buf.length) return null;
  const stringCount = buf.readUInt32LE(chunkOffset + 8);
  const flags = buf.readUInt32LE(chunkOffset + 16);
  const stringsStart = buf.readUInt32LE(chunkOffset + 20);
  const isUtf8 = (flags & STRING_POOL_FLAG_UTF8) !== 0;

  const indexArrayStart = chunkOffset + headerSize;
  const stringDataStart = chunkOffset + stringsStart;
  if (indexArrayStart + stringCount * 4 > buf.length) return null;
  if (stringDataStart > buf.length) return null;

  const result = new Array(stringCount);
  for (let i = 0; i < stringCount; i++) {
    const stringOffset = buf.readUInt32LE(indexArrayStart + i * 4);
    const absOffset = stringDataStart + stringOffset;
    if (absOffset >= buf.length) {
      result[i] = '';
      continue;
    }
    try {
      result[i] = isUtf8 ? readUtf8String(buf, absOffset) : readUtf16String(buf, absOffset);
    } catch {
      result[i] = '';
    }
  }
  return result;
}

/**
 * AXML UTF-8 strings: optional u16 char count, then u8 byte count, then
 * the bytes themselves. AOSP also writes some pools with two-byte u8
 * lengths (varint-style) — we handle both.
 */
function readUtf8String(buf, offset) {
  let charLen = buf.readUInt8(offset);
  let cursor = offset + 1;
  if (charLen & 0x80) {
    charLen = ((charLen & 0x7f) << 8) | buf.readUInt8(cursor++);
  }
  let byteLen = buf.readUInt8(cursor++);
  if (byteLen & 0x80) {
    byteLen = ((byteLen & 0x7f) << 8) | buf.readUInt8(cursor++);
  }
  return buf.toString('utf8', cursor, cursor + byteLen);
}

/**
 * AXML UTF-16 strings: u16 char count (possibly varint), then the chars.
 */
function readUtf16String(buf, offset) {
  let charLen = buf.readUInt16LE(offset);
  let cursor = offset + 2;
  if (charLen & 0x8000) {
    charLen = ((charLen & 0x7fff) << 16) | buf.readUInt16LE(cursor);
    cursor += 2;
  }
  return buf.toString('utf16le', cursor, cursor + charLen * 2);
}

export const __forTesting = { parseAxmlDebuggable, parseStringPool };
