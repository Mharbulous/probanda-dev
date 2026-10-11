// Synthetic Outlook .msg files for the reply route's reader tests. buildMsg ports /case-data's
// test_render_document.py build_msg: a minimal compound file whose streams under 4096 bytes land in
// the mini stream and larger ones in FAT sectors. Every name and address is invented.

const FREE = 0xffffffff;
const END = 0xfffffffe;

const pad = (buf, size) => Buffer.concat([buf, Buffer.alloc((size - (buf.length % size)) % size)]);
const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0); return b; };

/** top / each recipient / each attachment: { streamName: Buffer }. */
export function buildMsg(top, recips = [], attachs = []) {
  const entries = [];
  const add = (name, type, data = Buffer.alloc(0)) => {
    entries.push({ name, type, right: FREE, child: FREE, data, start: END });
    return entries.length - 1;
  };
  const addChildren = (parent, items) => {
    let prev = null;
    for (const [name, type, data, kids] of items) {
      const i = add(name, type, data);
      if (prev === null) entries[parent].child = i;
      else entries[prev].right = i;
      prev = i;
      if (kids) addChildren(i, kids);
    }
  };
  const streams = (d) => Object.entries(d).map(([n, b]) => [n, 2, b, null]);
  const hex8 = (i) => i.toString(16).toUpperCase().padStart(8, "0");

  const root = add("Root Entry", 5);
  addChildren(root, [
    ...streams(top),
    ...recips.map((r, i) => [`__recip_version1.0_#${hex8(i)}`, 1, Buffer.alloc(0), streams(r)]),
    ...attachs.map((a, i) => [`__attach_version1.0_#${hex8(i)}`, 1, Buffer.alloc(0), streams(a)]),
  ]);

  let mini = Buffer.alloc(0);
  const minifat = [];
  for (const e of entries) {
    if (e.type === 2 && e.data.length > 0 && e.data.length < 4096) {
      const n = Math.ceil(e.data.length / 64);
      e.start = minifat.length;
      for (let k = 1; k < n; k += 1) minifat.push(e.start + k);
      minifat.push(END);
      mini = Buffer.concat([mini, pad(e.data, 64)]);
    }
  }

  const fat = [0xfffffffd];
  const sectors = [null];
  const alloc = (data) => {
    const padded = pad(data, 512);
    const n = padded.length / 512;
    const start = fat.length;
    for (let k = 1; k < n; k += 1) fat.push(start + k);
    fat.push(END);
    for (let k = 0; k < n; k += 1) sectors.push(padded.subarray(k * 512, (k + 1) * 512));
    return start;
  };
  for (const e of entries) if (e.type === 2 && e.data.length >= 4096) e.start = alloc(e.data);
  entries[root].start = alloc(mini);
  entries[root].data = mini;
  const firstMinifat = alloc(Buffer.concat(minifat.map(u32)));
  const nMinifat = fat.length - firstMinifat;

  const dir = Buffer.concat(
    entries.map((e) => {
      const name = Buffer.from(`${e.name}\0`, "utf16le");
      const size = Buffer.alloc(8);
      size.writeUInt32LE(e.data.length);
      return Buffer.concat([pad(name, 64), u16(name.length), Buffer.from([e.type, 1]), u32(FREE), u32(e.right), u32(e.child), Buffer.alloc(36), u32(e.start), size]);
    })
  );
  const firstDir = alloc(dir);
  if (fat.length > 128) throw new Error("fixture outgrew one FAT sector");
  sectors[0] = Buffer.concat([...fat.map(u32), ...Array(128 - fat.length).fill(u32(FREE))]);

  const header = Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(16),
    u16(0x3e), u16(3), u16(0xfffe), u16(9), u16(6), Buffer.alloc(6),
    u32(0), u32(1), u32(firstDir), u32(0), u32(4096),
    u32(firstMinifat), u32(nMinifat), u32(END), u32(0),
    u32(0), ...Array(108).fill(u32(FREE)),
  ]);
  return Buffer.concat([header, ...sectors]);
}

/** A __properties_version1.0 stream: { tag: 8-byte value }. */
export function props(headerLength, fixed) {
  const parts = [Buffer.alloc(headerLength)];
  for (const [tag, value] of Object.entries(fixed)) {
    const v = Buffer.alloc(8);
    value.copy(v);
    parts.push(u32(Number(tag)), Buffer.alloc(4), v);
  }
  return Buffer.concat(parts);
}

/** A Unicode string property stream's name and value. */
export const str = (prop, text) => [`__substg1.0_${prop.toString(16).toUpperCase().padStart(4, "0")}001F`, Buffer.from(text, "utf16le")];
export const bin = (prop, bytes) => [`__substg1.0_${prop.toString(16).toUpperCase().padStart(4, "0")}0102`, bytes];

/** A FILETIME fixed-property value for an ISO time. */
export function filetime(iso) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE((BigInt(Date.parse(iso)) + 11_644_473_600_000n) * 10_000n);
  return b;
}

/**
 * PR_RTF_COMPRESSED as LZFu, every byte a literal: valid input for any reader, since the format
 * lets a compressor choose literals. The run ends with the reference to the write position.
 */
export function lzfuLiterals(rtf) {
  const data = Buffer.from(rtf, "latin1");
  const out = [];
  let write = 207;
  let i = 0;
  for (;;) {
    const controlAt = out.length;
    out.push(0);
    let control = 0;
    let done = false;
    for (let bit = 0; bit < 8; bit += 1) {
      if (i < data.length) {
        out.push(data[i++]);
        write = (write + 1) % 4096;
        continue;
      }
      control |= 1 << bit;
      out.push((write >> 4) & 0xff, (write & 0xf) << 4);
      done = true;
      break;
    }
    out[controlAt] = control;
    if (done) break;
  }
  const body = Buffer.from(out);
  const header = Buffer.alloc(16);
  header.writeUInt32LE(body.length + 12, 0);
  header.writeUInt32LE(data.length, 4);
  header.writeUInt32LE(0x75465a4c, 8);
  return Buffer.concat([header, body]);
}

/** A top-level message with sender, subject, sent time and the given body streams. */
export function message({ fromName, fromAddress, subject, sent, to = [], body = {} }) {
  const top = Object.fromEntries([
    ["__properties_version1.0", props(32, { [(0x0039 << 16) | 0x0040]: filetime(sent) })],
    str(0x0c1a, fromName),
    str(0x5d01, fromAddress),
    str(0x0037, subject),
    ...Object.entries(body),
  ]);
  const recips = to.map(([name, address]) =>
    Object.fromEntries([["__properties_version1.0", props(8, { [(0x0c15 << 16) | 0x0003]: u32(1) })], str(0x3001, name), str(0x39fe, address)])
  );
  return buildMsg(top, recips);
}
