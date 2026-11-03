// drafting_forms__read_message: one Outlook .msg or .eml in a matter, read with its highlights, for
// /draft's reply route (references/reply.md). Read-only and matter-confined: never a 0. DRAFT,
// TRASH, 0. CASE DATA, privileged or disclosed tree. scanMessageHeaders is the header-only pass the
// /draft opening's inbound-mail notice reuses.

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, win32 as pathWin32 } from "node:path";

import { DataServerError, ValidationError } from "../errors.js";
import { validateMatterRoot } from "../files/matter-root.js";
import { assertContained, PathOutOfScopeError, resolveWithin } from "../files/scope.js";
import { zoneProblem } from "../files/zones.js";
import { CompoundFile } from "./cfb.js";
import { decodeWords, parseMime } from "./eml.js";
import type { HighlightRun } from "./highlight.js";
import { readHtml } from "./html.js";
import { decompressRtf } from "./lzfu.js";
import { readRtf, textDecoder } from "./rtf.js";

export interface MessageHeaders {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  /** ISO 8601 UTC, or null when the message carries no usable time. */
  sent: string | null;
}

export interface Message extends MessageHeaders {
  body: string;
  body_truncated: boolean;
  highlights: HighlightRun[];
  /** Where the highlights were read from: html, rtf, or none (a plain-text-only message). */
  highlight_source: "html" | "rtf" | "none";
  attachments: { name: string; size: number }[];
}

export const MESSAGE_EXTENSIONS = new Set([".msg", ".eml"]);
const BODY_LIMIT = 100_000;
const SCAN_LIMIT = 2_000;
const OTHER_CANDIDATES = 5;

// ---------------------------------------------------------------------------------------------
// .msg ([MS-OXMSG]): MAPI properties in __substg1.0_<tag><type> streams and a fixed-size
// __properties_version1.0 stream.

class MsgNode {
  private readonly fixed = new Map<number, Buffer>();
  readonly codepage: number;

  constructor(private readonly cfb: CompoundFile, private readonly prefix: string, codepage: number) {
    const raw = cfb.read(`${prefix}/__properties_version1.0`) ?? Buffer.alloc(0);
    const header = prefix === "" ? 32 : 8;
    for (let i = header; i + 16 <= raw.length; i += 16) this.fixed.set(raw.readUInt32LE(i), raw.subarray(i + 8, i + 16));
    this.codepage = this.int(0x3ffd) ?? codepage;
  }

  int(prop: number): number | undefined {
    const v = this.fixed.get(((prop << 16) | 0x0003) >>> 0);
    return v ? v.readUInt32LE(0) : undefined;
  }

  time(prop: number): string | null {
    const v = this.fixed.get(((prop << 16) | 0x0040) >>> 0);
    if (!v) return null;
    const ticks = v.readBigUInt64LE(0);
    if (ticks === 0n) return null;
    const ms = Number(ticks / 10_000n) - 11_644_473_600_000;
    return new Date(ms).toISOString();
  }

  text(prop: number): string | undefined {
    const tag = prop.toString(16).toUpperCase().padStart(4, "0");
    const wide = this.cfb.read(`${this.prefix}/__substg1.0_${tag}001F`);
    if (wide) return wide.toString("utf16le").replace(/\0+$/, "");
    const narrow = this.cfb.read(`${this.prefix}/__substg1.0_${tag}001E`);
    if (narrow) return textDecoder(this.codepage).decode(narrow).replace(/\0+$/, "");
    return undefined;
  }

  binary(prop: number): Buffer | undefined {
    const tag = prop.toString(16).toUpperCase().padStart(4, "0");
    return this.cfb.read(`${this.prefix}/__substg1.0_${tag}0102`);
  }
}

function collapse(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function address(node: MsgNode, nameProp: number, smtpProp: number, addrProp: number): string {
  const name = collapse(node.text(nameProp));
  let addr = collapse(node.text(smtpProp) ?? node.text(addrProp));
  if (addr && !addr.includes("@")) addr = ""; // an Exchange DN, not an address
  if (name && addr && name.toLowerCase() !== addr.toLowerCase()) return `${name} <${addr}>`;
  return addr || name;
}

function msgHeaders(cfb: CompoundFile, msg: MsgNode): MessageHeaders {
  const to: string[] = [];
  const cc: string[] = [];
  for (const path of cfb.children("")) {
    if (!path.startsWith("/__recip_version1.0_")) continue;
    const r = new MsgNode(cfb, path, msg.codepage);
    const kind = r.int(0x0c15) ?? 1;
    const a = address(r, 0x3001, 0x39fe, 0x3003);
    if (!a) continue;
    if (kind === 1) to.push(a);
    else if (kind === 2) cc.push(a);
  }
  const transport = msg.text(0x007d);
  const dateHeader = transport ? /^date:[ \t]*(.+)$/im.exec(transport.replace(/\r?\n[ \t]+/g, " "))?.[1] : undefined;
  return {
    from: address(msg, 0x0c1a, 0x5d01, 0x0c1f) || address(msg, 0x0042, 0x5d02, 0x0065),
    to: to.length ? to : splitList(msg.text(0x0e04)),
    cc: cc.length ? cc : splitList(msg.text(0x0e03)),
    subject: collapse(msg.text(0x0037)),
    sent: isoOrNull(dateHeader) ?? msg.time(0x0039) ?? msg.time(0x0e06),
  };
}

function splitList(text: string | undefined): string[] {
  return (text ?? "").split(";").map(collapse).filter(Boolean);
}

function isoOrNull(text: string | undefined): string | null {
  if (!text) return null;
  const t = Date.parse(text);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function openMsg(bytes: Buffer): { cfb: CompoundFile; msg: MsgNode } {
  const cfb = new CompoundFile(bytes);
  if (!cfb.streams.has("/__properties_version1.0")) {
    throw new DataServerError("not a readable .msg: no top-level property stream", "not_a_message");
  }
  return { cfb, msg: new MsgNode(cfb, "", 1252) };
}

function parseMsg(bytes: Buffer, bodyLimit: number): Message {
  const { cfb, msg } = openMsg(bytes);
  const headers = msgHeaders(cfb, msg);

  let html: string | undefined;
  const htmlBytes = msg.binary(0x1013);
  if (htmlBytes) html = textDecoder(msg.int(0x3fde) ?? msg.codepage).decode(htmlBytes);
  else html = msg.text(0x1013);

  let rtfText: string | undefined;
  let rtfRuns: HighlightRun[] = [];
  if (!html) {
    const compressed = msg.binary(0x1009);
    if (compressed) {
      const reading = readRtf(decompressRtf(compressed));
      if (reading.html !== undefined) html = reading.html;
      else {
        rtfText = reading.text;
        rtfRuns = reading.highlights;
      }
    }
  }

  const htmlReading = html ? readHtml(html) : undefined;
  const plain = msg.text(0x1000);
  const body = plain ?? htmlReading?.text ?? rtfText;
  if (body === undefined) throw new DataServerError("the .msg has no plain-text, HTML or RTF body", "not_a_message");

  const attachments: { name: string; size: number }[] = [];
  for (const path of cfb.children("")) {
    if (!path.startsWith("/__attach_version1.0_")) continue;
    const a = new MsgNode(cfb, path, msg.codepage);
    const name = collapse(a.text(0x3707) ?? a.text(0x3704) ?? a.text(0x3001));
    attachments.push({ name: name || "attachment", size: a.binary(0x3701)?.length ?? a.int(0x0e20) ?? 0 });
  }

  return finish(headers, body, htmlReading ? htmlReading.highlights : rtfRuns, htmlReading ? "html" : rtfText !== undefined ? "rtf" : "none", attachments, bodyLimit);
}

// ---------------------------------------------------------------------------------------------
// .eml

function emlHeaders(headers: Map<string, string>): MessageHeaders {
  const list = (v: string | undefined) => (v ? splitAddresses(decodeWords(v)) : []);
  return {
    from: collapse(decodeWords(headers.get("from") ?? "")),
    to: list(headers.get("to")),
    cc: list(headers.get("cc")),
    subject: collapse(decodeWords(headers.get("subject") ?? "")),
    sent: isoOrNull(headers.get("date")),
  };
}

/** Commas outside quotes and angle brackets separate addresses. */
function splitAddresses(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const c of text) {
    if (c === '"') quoted = !quoted;
    else if (c === "<" && !quoted) depth += 1;
    else if (c === ">" && !quoted) depth = Math.max(0, depth - 1);
    if (c === "," && !quoted && depth === 0) {
      out.push(current);
      current = "";
    } else current += c;
  }
  out.push(current);
  return out.map((a) => collapse(a.replace(/^"([^"]*)"/, "$1"))).filter(Boolean);
}

function parseEml(bytes: Buffer, bodyLimit: number): Message {
  const mime = parseMime(bytes);
  const headers = emlHeaders(mime.headers);
  let html = mime.html;
  let rtfReading: ReturnType<typeof readRtf> | undefined;
  if (!html && mime.rtf) {
    rtfReading = readRtf(mime.rtf);
    if (rtfReading.html !== undefined) html = rtfReading.html;
  }
  const htmlReading = html ? readHtml(html) : undefined;
  const body = mime.plain ?? htmlReading?.text ?? rtfReading?.text ?? "";
  const highlights = htmlReading?.highlights ?? rtfReading?.highlights ?? [];
  const source = htmlReading ? "html" : rtfReading ? "rtf" : "none";
  return finish(headers, body, highlights, source, mime.attachments.map(({ name, size }) => ({ name, size })), bodyLimit);
}

function finish(
  headers: MessageHeaders,
  body: string,
  highlights: HighlightRun[],
  source: Message["highlight_source"],
  attachments: Message["attachments"],
  bodyLimit: number
): Message {
  const normalized = body.replace(/\r\n/g, "\n").replace(/\0+$/, "");
  return {
    ...headers,
    body: normalized.slice(0, bodyLimit),
    body_truncated: normalized.length > bodyLimit,
    highlights,
    highlight_source: source,
    attachments,
  };
}

// ---------------------------------------------------------------------------------------------

export function parseMessage(bytes: Buffer, extension: string, bodyLimit = BODY_LIMIT): Message {
  const ext = extension.toLowerCase();
  if (ext === ".msg") return parseMsg(bytes, bodyLimit);
  if (ext === ".eml") return parseEml(bytes, bodyLimit);
  throw new DataServerError(`not a message file: ${extension} (only .msg and .eml)`, "unsupported_extension");
}

export function parseMessageHeaders(bytes: Buffer, extension: string): MessageHeaders {
  const ext = extension.toLowerCase();
  if (ext === ".msg") {
    const { cfb, msg } = openMsg(bytes);
    return msgHeaders(cfb, msg);
  }
  if (ext === ".eml") return emlHeaders(parseMime(bytes).headers);
  throw new DataServerError(`not a message file: ${extension} (only .msg and .eml)`, "unsupported_extension");
}

export interface ScannedMessage extends MessageHeaders {
  /** Matter-relative path, backslash-separated. */
  path: string;
}

/**
 * Every readable .msg / .eml under a validated matter root, headers only, skipping the excluded
 * folders, links that leave the matter, and files that do not parse. Stops at SCAN_LIMIT files.
 */
export function scanMessageHeaders(root: string): { messages: ScannedMessage[]; truncated: boolean } {
  const messages: ScannedMessage[] = [];
  let seen = 0;
  const walk = (dir: string, rel: string): boolean => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return true;
    }
    for (const entry of entries) {
      const full = pathWin32.join(dir, entry.name);
      const relPath = rel ? `${rel}\\${entry.name}` : entry.name;
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        if (zoneProblem("scan", full)) continue;
        // A link is followed only while its target stays in the matter and outside the excluded folders.
        let real: string;
        try {
          real = realpathSync.native(full);
          assertContained(root, real, "folder", relPath);
          if (!statSync(real).isDirectory()) continue;
        } catch {
          continue;
        }
        if (zoneProblem("scan", real)) continue;
        if (!walk(real, relPath)) return false;
        continue;
      }
      if (!entry.isFile() || !MESSAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
      if (seen >= SCAN_LIMIT) return false;
      seen += 1;
      try {
        messages.push({ path: relPath, ...parseMessageHeaders(readFileSync(full), extname(entry.name)) });
      } catch {
        // Not a message after all; the scan reports what it can read.
      }
    }
    return true;
  };
  const complete = walk(root, "");
  return { messages, truncated: !complete };
}

// ---------------------------------------------------------------------------------------------
// The tool.

export interface ReadMessageArgs {
  matter_root: string;
  path?: string;
  from?: string;
}

function rejectFirewall(relative: string): void {
  if (zoneProblem("read", pathWin32.dirname(relative))) {
    throw new PathOutOfScopeError(`path lies in a folder this tool never reads (TRASH, 0. CASE DATA, privileged, disclosed): ${relative}`);
  }
}

export function readMessage(args: ReadMessageArgs): unknown {
  const hasPath = typeof args.path === "string" && args.path !== "";
  const hasFrom = typeof args.from === "string" && args.from.trim() !== "";
  if (hasPath === hasFrom) {
    throw new ValidationError("drafting_forms__read_message takes exactly one of path or from");
  }
  const root = validateMatterRoot(args.matter_root);

  if (hasPath) {
    const given = args.path as string;
    let full: string;
    if (pathWin32.isAbsolute(given)) {
      try {
        full = realpathSync.native(given);
      } catch {
        throw new DataServerError(`path not found: ${given}`, "not_found");
      }
      assertContained(root, full, "path", given);
    } else {
      full = resolveWithin(root, given, "path");
    }
    const relative = pathWin32.relative(root, full);
    rejectFirewall(relative);
    const ext = extname(full).toLowerCase();
    if (!MESSAGE_EXTENSIONS.has(ext)) {
      throw new DataServerError(`not a message file: ${relative} (only .msg and .eml)`, "unsupported_extension");
    }
    return { path: relative, ...parseMessage(readFileSync(full), ext) };
  }

  const needle = (args.from as string).trim().toLowerCase();
  const scan = scanMessageHeaders(root);
  const matches = scan.messages
    .filter((m) => m.from.toLowerCase().includes(needle))
    .sort((a, b) => (b.sent ?? "").localeCompare(a.sent ?? "") || a.path.localeCompare(b.path));
  if (matches.length === 0) {
    throw new DataServerError(
      `no .msg or .eml in the matter is from "${args.from}" (${scan.messages.length} message(s) scanned` +
        `${scan.truncated ? `, stopped at ${SCAN_LIMIT}` : ""}). Name the file by path instead.`,
      "no_match"
    );
  }
  const newest = matches[0];
  const full = pathWin32.join(root, newest.path);
  return {
    path: newest.path,
    ...parseMessage(readFileSync(full), extname(full)),
    other_candidates: matches.slice(1, 1 + OTHER_CANDIDATES),
    scan_truncated: scan.truncated,
  };
}
