// A mail message's body as the mail tools return it, its search-result summary,
// and its attachment list (docs/Plans/2026-10-15_imap-mail.md, step 3). Bodies
// come from the correspondence parser (eml.ts, html.ts), so no mail parsing
// package is bundled.

import { decodeWords, type MimeParts } from "../correspondence/eml.js";
import { readHtml } from "../correspondence/html.js";

export type BodyFormat = "text" | "html";

export interface BodyOptions {
  format: BodyFormat;
  maxLength: number;
  stripQuoted: boolean;
  stripInlineImages: boolean;
}

export interface RenderedBody {
  body: string;
  bodyFormat: BodyFormat;
  bodyTruncated?: true;
  strippedQuoted?: true;
  strippedInlineImages?: number;
}

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

const INLINE_IMG_TAG = /<img\b[^>]*\bsrc\s*=\s*["']?\s*data:[^>]*>/gi;
const INLINE_IMG_URI = /data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]+/g;

const ON_WROTE = /^On .{1,200} wrote:\s*$/;
const ORIGINAL_MESSAGE = /^-{2,}\s*Original Message\s*-{2,}$/i;
const UNDERSCORE_RULE = /^_{10,}$/;
const FROM_LINE = /^From: .+$/;
const SENT_OR_DATE_LINE = /^(Sent|Date): /;
const TO_LINE = /^To: /;
const QUOTED_LINE = /^>/;

/** The index of the first line that opens a quoted reply, after the first non-blank line; -1 if none. */
function quoteStart(lines: string[]): number {
  const first = lines.findIndex((line) => line.trim() !== "");
  if (first < 0) return -1;
  for (let i = first + 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (ON_WROTE.test(line) || ORIGINAL_MESSAGE.test(line) || UNDERSCORE_RULE.test(line)) return i;
    if (FROM_LINE.test(line)) {
      const next = lines.slice(i + 1, i + 5).map((l) => l.trim());
      if (next.some((l) => SENT_OR_DATE_LINE.test(l)) && next.some((l) => TO_LINE.test(l))) return i;
    }
    if (QUOTED_LINE.test(line) && i + 1 < lines.length && QUOTED_LINE.test(lines[i + 1].trim())) return i;
  }
  return -1;
}

export function renderBody(parts: MimeParts, opts: BodyOptions): RenderedBody {
  let body: string;
  if (opts.format === "html") {
    body = parts.html ?? (parts.plain !== undefined ? escapeHtml(parts.plain).replace(/\r?\n/g, "<br>\n") : "");
  } else {
    body = parts.plain ?? (parts.html !== undefined ? readHtml(parts.html).text : "");
  }
  const out: Omit<RenderedBody, "body" | "bodyFormat"> = {};

  if (opts.stripInlineImages) {
    let count = 0;
    body = body.replace(opts.format === "html" ? INLINE_IMG_TAG : INLINE_IMG_URI, () => {
      count += 1;
      return "";
    });
    if (count > 0) out.strippedInlineImages = count;
  }

  // Quote stripping reads lines of text, so it applies to the text format only.
  if (opts.stripQuoted && opts.format === "text") {
    const lines = body.split(/\r?\n/);
    const at = quoteStart(lines);
    if (at >= 0) {
      body = lines.slice(0, at).join("\n").trimEnd();
      out.strippedQuoted = true;
    }
  }

  if (body.length > opts.maxLength) {
    body = body.slice(0, opts.maxLength);
    out.bodyTruncated = true;
  }
  return { body, bodyFormat: opts.format, ...out };
}

// --- summaries -------------------------------------------------------------------

interface Address {
  name?: string;
  address?: string;
}

/** The fields of one fetched message that summarize() reads (imapflow's FETCH response). */
export interface FetchedSummary {
  uid: number;
  envelope?: {
    date?: Date | string;
    subject?: string;
    messageId?: string;
    from?: Address[];
    to?: Address[];
    cc?: Address[];
  };
  flags?: Set<string>;
  size?: number;
  internalDate?: Date | string;
}

export interface MessageSummary {
  uid: number;
  folder: string;
  date?: string;
  from?: string;
  to: string[];
  cc?: string[];
  subject?: string;
  messageId?: string;
  seen: boolean;
  flagged?: true;
  answered?: true;
  size?: number;
}

export const formatAddress = (a: Address | undefined): string | undefined =>
  a?.name ? `${a.name} <${a.address}>` : a?.address;

export const formatAddresses = (list: Address[] | undefined): string[] =>
  (list ?? []).map(formatAddress).filter((a): a is string => a !== undefined);

/** ISO 8601 in UTC, or undefined for a missing or unparseable date. */
export function isoDate(value: Date | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

// The search-result shape. `/timecamping-data`'s ingest reads these keys as they
// are: `from` a string, `to` a list, `cc` a list or absent, `messageId` as the
// envelope gives it (angle brackets included).
export function summarize(message: FetchedSummary, folder: string): MessageSummary {
  const e = message.envelope ?? {};
  const summary: MessageSummary = {
    uid: message.uid,
    folder,
    date: isoDate(e.date ?? message.internalDate),
    from: formatAddress(e.from?.[0]),
    to: formatAddresses(e.to),
    subject: e.subject,
    messageId: e.messageId,
    seen: message.flags?.has("\\Seen") ?? false,
    size: message.size,
  };
  if (e.cc?.length) summary.cc = formatAddresses(e.cc);
  if (message.flags?.has("\\Flagged")) summary.flagged = true;
  if (message.flags?.has("\\Answered")) summary.answered = true;
  return summary;
}

// --- attachments -----------------------------------------------------------------

/** One node of imapflow's bodyStructure. */
export interface StructureNode {
  part?: string;
  type: string;
  parameters?: Record<string, string>;
  id?: string;
  size?: number;
  disposition?: string;
  dispositionParameters?: Record<string, string>;
  childNodes?: StructureNode[];
}

export interface AttachmentEntry {
  index: number;
  part: string;
  filename?: string;
  contentType: string;
  size?: number;
  contentId?: string;
  inline?: true;
}

// Every node that is an attachment (disposition `attachment`, or a filename on a
// non-text type), in tree order. An attachment is not walked into, so an attached
// message is one entry. `index` is the order here, which download_attachment
// recomputes from the same structure.
export function attachmentList(structure: StructureNode | undefined): AttachmentEntry[] {
  const out: AttachmentEntry[] = [];
  const walk = (node: StructureNode): void => {
    const type = (node.type ?? "").toLowerCase();
    const disposition = (node.disposition ?? "").toLowerCase();
    const rawName = node.dispositionParameters?.filename ?? node.parameters?.name;
    if (!type.startsWith("multipart/") && (disposition === "attachment" || (rawName && !type.startsWith("text/")))) {
      const entry: AttachmentEntry = {
        index: out.length,
        part: node.part ?? "1",
        filename: rawName === undefined ? undefined : decodeWords(rawName),
        contentType: type,
        size: node.size,
        contentId: node.id,
      };
      if (disposition === "inline") entry.inline = true;
      out.push(entry);
      return;
    }
    for (const child of node.childNodes ?? []) walk(child);
  };
  if (structure) walk(structure);
  return out;
}
