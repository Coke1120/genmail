import { createHash, verify } from 'node:crypto';
import { readFileSync, openSync, readSync, closeSync, fstatSync, createReadStream } from 'node:fs';
import { posix } from 'node:path';
import { inflateRawSync } from 'node:zlib';

export const updatePublicKey = readFileSync(new URL('./update-public-key.pem', import.meta.url));
export const platforms = ['macos-arm64', 'windows-x64'];
export const archiveLimit = 750 * 1024 * 1024;
export function verifyManifest(bytes, signature, version, key = updatePublicKey) {
  if (bytes.length > 16384 || !/^[A-Za-z0-9+/]{86}==$/.test(signature.trim()) || !verify(null, bytes, key, Buffer.from(signature.trim(), 'base64'))) throw new Error('The update signature could not be verified.');
  const value = JSON.parse(bytes);
  if (value.version !== version || !/^\d+\.\d+\.\d+(?:-(?:alpha|beta)\.\d+)?$/.test(version)) throw new Error('The update version does not match.');
  for (const platform of platforms) {
    const item = value.platforms?.[platform];
    if (!item || item.name !== `Morrow-Mail-${version}-${platform}.zip` || !/^[a-f0-9]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > archiveLimit) throw new Error('The signed update manifest is invalid.');
  }
  return value;
}
export async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

// Inspect names and symlink destinations before either platform's native extractor
// can write files. ZIP64 is deliberately unsupported for these small desktop bundles.
export function inspectArchive(path, root) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const read = (offset, length) => {
      if (offset < 0 || length < 0 || offset + length > size) throw new Error('Invalid update archive.');
      const buffer = Buffer.alloc(length);
      if (readSync(fd, buffer, 0, length, offset) !== length) throw new Error('Incomplete update archive.');
      return buffer;
    };
    const tail = read(Math.max(0, size - 65557), Math.min(size, 65557));
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { end = i; break; }
    if (end < 0 || tail.readUInt32LE(end + 4) !== 0) throw new Error('Unsupported update archive.');
    const count = tail.readUInt16LE(end + 10), length = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16);
    if (!count || count === 65535 || length > 32 * 1024 * 1024 || tail.readUInt16LE(end + 8) !== count || offset + length !== size - tail.length + end) throw new Error('Unsupported update archive.');
    const central = read(offset, length), seen = new Set();
    let cursor = 0, expanded = 0;
    const safe = name => !name.includes('\\') && !name.includes('\0') && !name.includes(':') && !name.startsWith('/') && name.split('/').every(part => part !== '..' && part !== '.') && (name === root || name.startsWith(root + '/') || name.startsWith('__MACOSX/'));
    for (let index = 0; index < count; index++) {
      if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== 0x02014b50) throw new Error('Invalid update archive entries.');
      const flags = central.readUInt16LE(cursor + 8), method = central.readUInt16LE(cursor + 10), packed = central.readUInt32LE(cursor + 20), unpacked = central.readUInt32LE(cursor + 24);
      const nameLength = central.readUInt16LE(cursor + 28), extra = central.readUInt16LE(cursor + 30), comment = central.readUInt16LE(cursor + 32);
      const nameBytes = central.subarray(cursor + 46, cursor + 46 + nameLength), name = nameBytes.toString('utf8');
      if (cursor + 46 + nameLength + extra + comment > central.length || !Buffer.from(name).equals(nameBytes) || !safe(name) || seen.has(name.toLowerCase()) || (flags & 1) || ![0, 8].includes(method)) throw new Error('Unsafe update archive entry.');
      seen.add(name.toLowerCase()); expanded += unpacked;
      if (expanded > 4 * 1024 ** 3 || unpacked > archiveLimit) throw new Error('The expanded update is too large.');
      const localOffset = central.readUInt32LE(cursor + 42), local = read(localOffset, 30);
      if (localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28) + packed > offset) throw new Error('Invalid update archive offsets.');
      if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(8) !== method || local.readUInt16LE(6) !== flags || !read(localOffset + 30, local.readUInt16LE(26)).equals(nameBytes)) throw new Error('Inconsistent update archive entry.');
      if (((central.readUInt32LE(cursor + 38) >>> 16) & 0xf000) === 0xa000) {
        if (packed > 8192 || unpacked > 4096) throw new Error('Unsafe update symlink.');
        const data = read(localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28), packed);
        const link = (method === 8 ? inflateRawSync(data, { maxOutputLength: 4096 }) : data).toString('utf8');
        if (!link || link.startsWith('/') || link.includes('\\') || link.includes(':') || link.includes('\0') || !safe(posix.join(posix.dirname(name), link))) throw new Error('Unsafe update symlink.');
      }
      cursor += 46 + nameLength + extra + comment;
    }
    if (cursor !== central.length) throw new Error('Invalid update archive directory.');
  } finally { closeSync(fd); }
}
