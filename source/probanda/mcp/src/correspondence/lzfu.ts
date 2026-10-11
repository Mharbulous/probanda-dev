// PR_RTF_COMPRESSED ([MS-OXRTFCP]): the RTF body Outlook keeps in every .msg, stored either
// uncompressed ("MELA") or LZ77-compressed against a 4096-byte dictionary preloaded with a fixed
// RTF prefix ("LZFu"). The CRC is not checked: a reader, not a validator.

import { DataServerError } from "../errors.js";

const COMPRESSED = 0x75465a4c; // "LZFu"
const UNCOMPRESSED = 0x414c454d; // "MELA"

export const LZFU_PREBUFFER =
  "{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}{\\f0\\fnil \\froman \\fswiss \\fmodern \\fscript " +
  "\\fdecor MS Sans SerifSymbolArialTimes New RomanCourier{\\colortbl\\red0\\green0\\blue0\r\n\\par " +
  "\\pard\\plain\\f0\\fs20\\b\\i\\u\\tab\\tx";

export function decompressRtf(data: Buffer): Buffer {
  if (data.length < 16) throw new DataServerError("compressed RTF body is truncated", "not_a_message");
  const rawSize = data.readUInt32LE(4);
  const type = data.readUInt32LE(8);
  const body = data.subarray(16);
  if (type === UNCOMPRESSED) return body.subarray(0, rawSize);
  if (type !== COMPRESSED) throw new DataServerError("compressed RTF body has an unknown type", "not_a_message");

  const dict = Buffer.alloc(4096);
  const pre = Buffer.from(LZFU_PREBUFFER, "latin1");
  pre.copy(dict);
  let write = pre.length;
  const out: number[] = [];
  let at = 0;
  while (at < body.length) {
    const control = body[at++];
    for (let bit = 0; bit < 8 && at < body.length; bit += 1) {
      if ((control & (1 << bit)) === 0) {
        const byte = body[at++];
        out.push(byte);
        dict[write] = byte;
        write = (write + 1) % 4096;
        continue;
      }
      if (at + 1 >= body.length) return Buffer.from(out);
      const token = (body[at] << 8) | body[at + 1];
      at += 2;
      const offset = token >> 4;
      const length = (token & 0xf) + 2;
      if (offset === write) return Buffer.from(out);
      for (let i = 0; i < length; i += 1) {
        const byte = dict[(offset + i) % 4096];
        out.push(byte);
        dict[write] = byte;
        write = (write + 1) % 4096;
      }
    }
  }
  return Buffer.from(out);
}
