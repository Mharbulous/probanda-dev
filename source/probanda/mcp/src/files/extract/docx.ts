// .docx body text inside the server: a minimal ZIP reader (central directory, stored or deflated
// entries, node:zlib) and the same tag-stripping the pre-filing gate's Python helper applies to
// word/document.xml, so a memo reads the same through either path.

import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/** The bytes of one named entry of the ZIP archive `zip`. Throws when it is absent or unreadable. */
export function zipEntry(zip: Buffer, name: string): Buffer {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file (no end of central directory)");
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== CENTRAL_SIG) throw new Error("corrupt zip central directory");
    const method = zip.readUInt16LE(at + 10);
    const compressedSize = zip.readUInt32LE(at + 20);
    const nameLen = zip.readUInt16LE(at + 28);
    const extraLen = zip.readUInt16LE(at + 30);
    const commentLen = zip.readUInt16LE(at + 32);
    const localAt = zip.readUInt32LE(at + 42);
    const entryName = zip.toString("utf-8", at + 46, at + 46 + nameLen);
    at += 46 + nameLen + extraLen + commentLen;
    if (entryName !== name) continue;
    if (zip.readUInt32LE(localAt) !== LOCAL_SIG) throw new Error(`corrupt zip local header for ${name}`);
    const dataAt = localAt + 30 + zip.readUInt16LE(localAt + 26) + zip.readUInt16LE(localAt + 28);
    const data = zip.subarray(dataAt, dataAt + compressedSize);
    if (method === 0) return Buffer.from(data);
    if (method === 8) return inflateRawSync(data);
    throw new Error(`zip entry ${name} uses unsupported compression method ${method}`);
  }
  throw new Error(`no ${name} in the archive`);
}

/** The body text of the .docx at `path`: one line per paragraph, tabs and line breaks kept. */
export function docxText(path: string): string {
  const xml = zipEntry(readFileSync(path), "word/document.xml").toString("utf-8");
  return xml
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:br[^>]*\/>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
