// Just enough of the compound file binary format ([MS-CFB]) to list and read an Outlook .msg's
// streams. Ported from /case-data's render_document.py `_Cfb`, which ingest uses; read-only.

import { DataServerError } from "../errors.js";

const MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const END_OF_CHAIN = 0xfffffffe;
const FREE = 0xffffffff;

interface DirEntry {
  name: string;
  type: number;
  left: number;
  right: number;
  child: number;
  start: number;
  size: number;
}

export function isCompoundFile(data: Buffer): boolean {
  return data.length >= 512 && data.subarray(0, 8).equals(MAGIC);
}

function notMessage(why: string): DataServerError {
  return new DataServerError(`not a readable .msg: ${why}`, "not_a_message");
}

export class CompoundFile {
  private readonly sectorSize: number;
  private readonly miniSize: number;
  private readonly miniCutoff: number;
  private readonly fat: number[] = [];
  private readonly miniFat: number[];
  private readonly entries: DirEntry[];
  private readonly miniStream: Buffer;
  /** Stream path ("/name" or "/storage/name") -> entry; a storage maps to null. */
  readonly streams = new Map<string, DirEntry | null>();

  constructor(private readonly data: Buffer) {
    if (!isCompoundFile(data)) throw notMessage("not an OLE compound file");
    this.sectorSize = 1 << data.readUInt16LE(30);
    this.miniSize = 1 << data.readUInt16LE(32);
    this.miniCutoff = data.readUInt32LE(56);
    const firstDir = data.readUInt32LE(48);
    const firstMiniFat = data.readUInt32LE(60);
    const miniFatCount = data.readUInt32LE(64);
    let difat = data.readUInt32LE(68);
    const difatCount = data.readUInt32LE(72);

    const fatSectors = this.u32s(data.subarray(76, 76 + 109 * 4));
    for (let i = 0; i < difatCount && difat < END_OF_CHAIN; i += 1) {
      const entries = this.u32s(this.sector(difat));
      fatSectors.push(...entries.slice(0, -1));
      difat = entries[entries.length - 1];
    }
    for (const s of fatSectors) {
      if (s === FREE || s === END_OF_CHAIN) continue;
      this.fat.push(...this.u32s(this.sector(s)));
    }
    this.miniFat = this.u32s(this.readChain(firstMiniFat)).slice(0, (miniFatCount * this.sectorSize) / 4);

    const dir = this.readChain(firstDir);
    this.entries = [];
    for (let i = 0; i + 128 <= dir.length; i += 128) this.entries.push(dirEntry(dir.subarray(i, i + 128)));
    if (this.entries.length === 0 || this.entries[0].type !== 5) throw notMessage("compound file has no root entry");
    const root = this.entries[0];
    this.miniStream = this.readChain(root.start).subarray(0, root.size);
    this.walk(root.child, "");
  }

  private u32s(buf: Buffer): number[] {
    const out: number[] = [];
    for (let i = 0; i + 4 <= buf.length; i += 4) out.push(buf.readUInt32LE(i));
    return out;
  }

  private sector(n: number): Buffer {
    const off = (n + 1) * this.sectorSize;
    return this.data.subarray(off, off + this.sectorSize);
  }

  private readChain(start: number): Buffer {
    const out: Buffer[] = [];
    const seen = new Set<number>();
    for (let s = start; s < END_OF_CHAIN; s = this.fat[s]) {
      if (seen.has(s) || s >= this.fat.length) throw notMessage("corrupt FAT chain");
      seen.add(s);
      out.push(this.sector(s));
    }
    return Buffer.concat(out);
  }

  private readMiniChain(start: number, size: number): Buffer {
    const out: Buffer[] = [];
    const seen = new Set<number>();
    for (let s = start; s < END_OF_CHAIN; s = this.miniFat[s]) {
      if (seen.has(s) || s >= this.miniFat.length) throw notMessage("corrupt mini-FAT chain");
      seen.add(s);
      out.push(this.miniStream.subarray(s * this.miniSize, (s + 1) * this.miniSize));
    }
    return Buffer.concat(out).subarray(0, size);
  }

  private walk(index: number, prefix: string): void {
    const stack = [index];
    while (stack.length > 0) {
      const i = stack.pop() as number;
      if (i === FREE || i >= this.entries.length) continue;
      const e = this.entries[i];
      stack.push(e.left, e.right);
      const path = `${prefix}/${e.name}`;
      if (e.type === 1) {
        this.streams.set(path, null);
        this.walk(e.child, path);
      } else if (e.type === 2) {
        this.streams.set(path, e);
      }
    }
  }

  read(path: string): Buffer | undefined {
    const e = this.streams.get(path);
    if (!e) return undefined;
    return e.size < this.miniCutoff ? this.readMiniChain(e.start, e.size) : this.readChain(e.start).subarray(0, e.size);
  }

  /** Immediate child storages under prefix (recipient and attachment storages). */
  children(prefix: string): string[] {
    const depth = prefix.split("/").length;
    return [...this.streams]
      .filter(([p, e]) => e === null && p.startsWith(`${prefix}/`) && p.split("/").length === depth + 1)
      .map(([p]) => p)
      .sort();
  }
}

function dirEntry(raw: Buffer): DirEntry {
  const nameLength = raw.readUInt16LE(64);
  return {
    name: raw.subarray(0, Math.max(nameLength - 2, 0)).toString("utf16le"),
    type: raw[66],
    left: raw.readUInt32LE(68),
    right: raw.readUInt32LE(72),
    child: raw.readUInt32LE(76),
    start: raw.readUInt32LE(116),
    size: raw.readUInt32LE(120),
  };
}
