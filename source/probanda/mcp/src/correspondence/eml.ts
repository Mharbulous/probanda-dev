// A MIME message (.eml): headers unfolded and RFC 2047-decoded, multipart walked, and the first
// inline text/plain, text/html and text/rtf parts decoded through their transfer encoding and charset.

import { DataServerError } from "../errors.js";

export interface MimeParts {
  headers: Map<string, string>;
  plain?: string;
  html?: string;
  rtf?: Buffer;
  attachments: { name: string; size: number }[];
}

function splitHead(raw: Buffer): { head: string; body: Buffer } {
  const text = raw.toString("latin1");
  const m = /\r?\n\r?\n/.exec(text);
  if (!m) return { head: text, body: Buffer.alloc(0) };
  return { head: text.slice(0, m.index), body: raw.subarray(m.index + m[0].length) };
}

function parseHeaders(head: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!headers.has(name)) headers.set(name, line.slice(colon + 1).trim());
  }
  return headers;
}

export function decodeCharset(bytes: Buffer, charset: string | undefined): string {
  const label = (charset ?? "utf-8").trim().toLowerCase().replace(/^"|"$/g, "");
  try {
    return new TextDecoder(label === "us-ascii" ? "windows-1252" : label).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function quotedPrintable(text: string): Buffer {
  const soft = text.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < soft.length; i += 1) {
    if (soft[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(soft.slice(i + 1, i + 3))) {
      out.push(parseInt(soft.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      out.push(soft.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(out);
}

/** RFC 2047 encoded words in a header value; whitespace between two encoded words is dropped. */
export function decodeWords(value: string): string {
  return value
    .replace(/(=\?[^?]+\?[bBqQ]\?[^?]*\?=)\s+(?==\?)/g, "$1")
    .replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_w, charset: string, enc: string, data: string) => {
      const bytes =
        enc.toUpperCase() === "B" ? Buffer.from(data, "base64") : quotedPrintable(data.replace(/_/g, " "));
      return decodeCharset(bytes, charset.replace(/\*.*$/, ""));
    });
}

function param(value: string, key: string): string | undefined {
  const m = new RegExp(`(?:^|;)\\s*${key}\\*?\\s*=\\s*("([^"]*)"|[^;\\s]+)`, "i").exec(value);
  if (!m) return undefined;
  return m[2] ?? m[1];
}

function decodeBody(body: Buffer, encoding: string | undefined): Buffer {
  const enc = (encoding ?? "").trim().toLowerCase();
  if (enc === "base64") return Buffer.from(body.toString("latin1").replace(/[^A-Za-z0-9+/=]/g, ""), "base64");
  if (enc === "quoted-printable") return quotedPrintable(body.toString("latin1"));
  return body;
}

export function parseMime(raw: Buffer): MimeParts {
  const { head } = splitHead(raw);
  const headers = parseHeaders(head);
  if (!headers.has("from") && !headers.has("subject") && !headers.has("date")) {
    throw new DataServerError("not a readable .eml: no From, Subject or Date header", "not_a_message");
  }
  const parts: MimeParts = { headers, attachments: [] };
  walk(raw, parts, 0);
  return parts;
}

function walk(raw: Buffer, out: MimeParts, depth: number): void {
  const { head, body } = splitHead(raw);
  const headers = parseHeaders(head);
  const type = headers.get("content-type") ?? "text/plain";
  const mediaType = type.split(";")[0].trim().toLowerCase();
  const disposition = (headers.get("content-disposition") ?? "").toLowerCase();
  const filename = param(headers.get("content-disposition") ?? "", "filename") ?? param(type, "name");

  if (mediaType.startsWith("multipart/") && depth < 20) {
    const boundary = param(type, "boundary");
    if (!boundary) return;
    const delimiter = `--${boundary}`;
    const whole = body.toString("latin1");
    const close = whole.indexOf(`${delimiter}--`);
    const text = close >= 0 ? whole.slice(0, close) : whole;
    const pieces = text.split(new RegExp(`\\r?\\n?${escapeRegex(delimiter)}[ \\t]*\\r?\\n`));
    for (const piece of pieces.slice(1)) {
      if (piece.trim() === "") continue;
      walk(Buffer.from(piece, "latin1"), out, depth + 1);
    }
    return;
  }
  const decoded = decodeBody(body, headers.get("content-transfer-encoding"));
  if (disposition.startsWith("attachment") || (filename && !mediaType.startsWith("text/"))) {
    out.attachments.push({ name: decodeWords(filename ?? "attachment"), size: decoded.length });
    return;
  }
  const charset = param(type, "charset");
  if (mediaType === "text/plain" && out.plain === undefined) out.plain = decodeCharset(decoded, charset);
  else if (mediaType === "text/html" && out.html === undefined) out.html = decodeCharset(decoded, charset);
  else if ((mediaType === "text/rtf" || mediaType === "application/rtf") && out.rtf === undefined) out.rtf = decoded;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
