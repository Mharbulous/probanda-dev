// The shared fetch module behind sources__check and sources__fetch:
// spec §3.3 "Shared module", #972 section 1 and #989.
//
// This is the local data runtime's only outbound network surface. Every
// request goes through requestSource(), whose first statement is the
// allowed-hosts guard, so a redirect hop is guarded exactly like the first
// request. /plugin-packager's `sources-host-guard` check asserts that shape on
// the built bundle (name-exact), so keep assertSourcesHost the first statement
// of every function that makes a request, and make requests nowhere else.
//
// https only, a browser User-Agent (vaniac.org refuses agent UAs), manual
// redirects to five hops, one retry after a short wait on a 5xx or a transient
// network error, a 24-hour per-URL memo in this process, and nothing written
// to disk except a fetched PDF saved on request (saveFetchedPdf).

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import * as https from "node:https";
import { join } from "node:path";

import { DataServerError, ValidationError } from "../errors.js";
import { writeBytesAtomic } from "../file-lock.js";
import { entryType, locate, parseKnowledgePath, type KnowledgeSeams } from "../knowledge/tree.js";
import { overlayFirmHosts, SOURCES_ALLOWED_HOSTS } from "./hosts.js";

export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const MAX_REDIRECTS = 5;
const MEMO_TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const RETRY_DELAY_MS = 2_000;
/** Network error codes worth one more try; anything else (a 4xx, a DNS miss) is final. */
const TRANSIENT_ERROR_CODES = new Set([
  "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ECONNABORTED", "EPIPE", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH",
]);

/**
 * How bytes leave the process. Production has exactly one: node:https. It only
 * moves bytes: the guard has already required an https URL on an allowed host
 * before a transport is ever called, so a transport cannot widen what is
 * contacted. Tests pass a double that carries those https URLs to a localhost
 * fixture.
 */
export interface Transport {
  request(url: URL, options: RequestOptions, callback: (response: IncomingMessage) => void): ClientRequest;
}

export interface FetchedSource {
  ok: true;
  url: string;
  final_url: string;
  status: number;
  content_type: string | null;
  bytes: Buffer;
  sha256: string;
  /** Every host contacted to get here, in order. */
  hosts: string[];
}

export interface SourceRefused {
  ok: false;
  reason: "host_not_allowed";
  host: string;
  url: string;
  /** Present when the refused URL was a redirect target: the URL that redirected. */
  redirect_from?: string;
  hosts: string[];
}

export interface SourceFailed {
  ok: false;
  reason: "fetch_failed";
  host: string;
  url: string;
  /** A status code, `too_many_redirects`, or an error class; never response text. */
  detail: string;
  status?: number;
  hosts: string[];
  /** Set when the fetch failed twice: a 5xx or a transient network error, retried once. */
  retried?: true;
}

export type FetchOutcome = FetchedSource | SourceRefused | SourceFailed;

export interface SourceFetcher {
  fetchSource(url: string): Promise<FetchOutcome>;
  /**
   * The memoized fetch of a URL, without any request: the fetch while it is within 24
   * hours, "expired" after that, null when this fetcher never fetched it.
   * knowledge__write validates excerpts against it.
   */
  memoized(url: string): FetchedSource | "expired" | null;
}

class HostNotAllowedError extends Error {}

/** The guard. Refuses anything but https to an allowed host. */
export function assertSourcesHost(url: URL, allowed: readonly string[]): void {
  if (url.protocol !== "https:" || !allowed.includes(url.hostname)) {
    throw new HostNotAllowedError(`sources may fetch only https from ${allowed.join(", ")}; refused ${url.href}`);
  }
}

interface RawResponse {
  status: number;
  location: string | null;
  contentType: string | null;
  bytes: Buffer;
}

function requestSource(url: URL, allowed: readonly string[], transport: Transport): Promise<RawResponse> {
  assertSourcesHost(url, allowed);
  return new Promise((resolve, reject) => {
    const req = transport.request(
      url,
      { method: "GET", headers: { "User-Agent": BROWSER_USER_AGENT, Accept: "*/*" }, timeout: REQUEST_TIMEOUT_MS },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            location: firstHeader(response.headers.location),
            contentType: firstHeader(response.headers["content-type"]),
            bytes: Buffer.concat(chunks),
          })
        );
      }
    );
    req.on("timeout", () => req.destroy(Object.assign(new Error("request timed out"), { code: "ETIMEDOUT" })));
    req.on("error", reject);
    req.end();
  });
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function errorClass(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  if (typeof code === "string" && code !== "") return code;
  return err instanceof Error ? err.name : "Error";
}

function parseUrl(url: string): URL {
  try {
    return new URL(url);
  } catch {
    throw new DataServerError(`not a URL: ${JSON.stringify(url)}`, "invalid_url");
  }
}

async function followRedirects(start: URL, allowed: readonly string[], transport: Transport): Promise<FetchOutcome> {
  const hosts: string[] = [];
  let current = start;
  let redirectFrom: string | undefined;
  for (let redirects = 0; ; redirects++) {
    let raw: RawResponse;
    try {
      raw = await requestSource(current, allowed, transport);
    } catch (err) {
      if (err instanceof HostNotAllowedError) {
        return {
          ok: false,
          reason: "host_not_allowed",
          host: current.hostname,
          url: current.href,
          ...(redirectFrom ? { redirect_from: redirectFrom } : {}),
          hosts,
        };
      }
      // Only a network or transport failure (a Node error `code`, which the timeout
      // above also carries) is a gap. Anything else is a programming error: rethrow.
      if (typeof (err as NodeJS.ErrnoException | undefined)?.code !== "string") throw err;
      return { ok: false, reason: "fetch_failed", host: current.hostname, url: current.href, detail: errorClass(err), hosts };
    }
    if (!hosts.includes(current.hostname)) hosts.push(current.hostname);

    if (REDIRECT_STATUSES.has(raw.status) && raw.location) {
      if (redirects === MAX_REDIRECTS) {
        return { ok: false, reason: "fetch_failed", host: current.hostname, url: current.href, detail: "too_many_redirects", status: raw.status, hosts };
      }
      redirectFrom = current.href;
      try {
        current = new URL(raw.location, current);
      } catch (err) {
        return { ok: false, reason: "fetch_failed", host: current.hostname, url: current.href, detail: errorClass(err), status: raw.status, hosts };
      }
      continue;
    }
    if (raw.status < 200 || raw.status > 299) {
      return { ok: false, reason: "fetch_failed", host: current.hostname, url: current.href, detail: String(raw.status), status: raw.status, hosts };
    }
    return {
      ok: true,
      url: start.href,
      final_url: current.href,
      status: raw.status,
      content_type: raw.contentType,
      bytes: raw.bytes,
      sha256: createHash("sha256").update(raw.bytes).digest("hex"),
      hosts,
    };
  }
}

function isTransient(outcome: FetchOutcome): boolean {
  if (outcome.ok || outcome.reason !== "fetch_failed") return false;
  return outcome.status === undefined ? TRANSIENT_ERROR_CODES.has(outcome.detail) : outcome.status >= 500 && outcome.status <= 599;
}

/**
 * A fetcher with its own memo. The allowed hosts are `allowedHosts` plus
 * `firmHosts`, both evaluated on every call. Production code uses only
 * `sourcesFetcher` below; tests build their own with their own host list and a
 * transport double, and may shorten the wait before the one retry.
 */
export function createSourceFetcher(
  allowedHosts: () => readonly string[],
  transport: Transport,
  firmHosts: () => readonly string[] = () => [],
  retryDelayMs: number = RETRY_DELAY_MS
): SourceFetcher {
  const memo = new Map<string, { at: number; fetched: FetchedSource }>();
  return {
    memoized(url: string): FetchedSource | "expired" | null {
      const cached = memo.get(parseUrl(url).href);
      if (!cached) return null;
      return Date.now() - cached.at < MEMO_TTL_MS ? cached.fetched : "expired";
    },
    async fetchSource(url: string): Promise<FetchOutcome> {
      const start = parseUrl(url);
      const allowed = [...allowedHosts(), ...firmHosts()];
      const cached = memo.get(start.href);
      if (cached && Date.now() - cached.at < MEMO_TTL_MS) {
        // No request is made, but the host must still be allowed now.
        try {
          assertSourcesHost(start, allowed);
        } catch (err) {
          if (!(err instanceof HostNotAllowedError)) throw err;
          return { ok: false, reason: "host_not_allowed", host: start.hostname, url: start.href, hosts: [] };
        }
        return cached.fetched;
      }
      let outcome = await followRedirects(start, allowed, transport);
      if (isTransient(outcome)) {
        // A publisher's 502 or a dropped connection is usually momentary: wait, then
        // run the whole guarded chain once more. A second failure is final.
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        outcome = await followRedirects(start, allowed, transport);
        if (!outcome.ok && outcome.reason === "fetch_failed") outcome = { ...outcome, retried: true };
      }
      if (outcome.ok) memo.set(start.href, { at: Date.now(), fetched: outcome });
      return outcome;
    },
  };
}

const HTTPS_TRANSPORT: Transport = { request: https.request };

/**
 * The runtime's one fetcher, over https: the shipped hosts, plus the firm's
 * `_hosts.json` in its knowledge overlay, re-read on every call.
 */
export const sourcesFetcher: SourceFetcher = createSourceFetcher(() => SOURCES_ALLOWED_HOSTS, HTTPS_TRANSPORT, () => overlayFirmHosts());

// ------------------------------------------------------------ HTML to text --

// Stage one: segment on these elements. Every other tag vanishes, as a browser
// renders inline markup, so `<i>Act</i>,` reads "Act," and not "Act ,".
const BLOCK_TAG = /<\/?(?:p|li|h[1-6]|div|br|tr)\b[^>]*>/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  shy: "",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  ndash: "\u2013",
  mdash: "\u2014",
  hellip: "\u2026",
  sect: "\u00a7",
  para: "\u00b6",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * Two-stage normalization, stage by stage: split the page into blocks on
 * `p`, `li`, `h1`-`h6`, `div`, `br` and `tr`, then collapse whitespace within
 * each block. Script, style and comment content is dropped. Nothing is folded
 * here: the curly apostrophe survives in the text and is folded only when
 * matching (passagePresent).
 */
export function htmlBlocks(html: string): string[] {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(BLOCK_TAG, "\u0000")
    .replace(/<[^>]*>/g, "");
  return text
    .split("\u0000")
    .map((block) => decodeEntities(block).replace(/\s+/g, " ").trim())
    .filter((block) => block !== "");
}

function foldApostrophe(text: string): string {
  return text.replace(/\u2019/g, "'");
}

/** Whether a verbatim passage appears in the joined blocks, `’` folded to `'` on both sides. */
export function passagePresent(joinedBlocks: string, passage: string): boolean {
  const needle = foldApostrophe(passage.replace(/\s+/g, " ").trim());
  return needle !== "" && foldApostrophe(joinedBlocks).includes(needle);
}

// ------------------------------------------------------------ PDF on disk --

/**
 * Write a fetched PDF to `<fetchedRoot>\<host>\<sha256 first 12>.pdf`, the one
 * thing this module ever writes, and return its path. Content-addressed, so a
 * second save of the same bytes rewrites the same file. `fetchedRoot` is the
 * overlay's `_fetched\` folder, passed by the caller.
 */
export function saveFetchedPdf(fetchedRoot: string, fetched: FetchedSource): string {
  if (fetched.bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
    throw new DataServerError(`${fetched.final_url} did not return a PDF`, "not_pdf");
  }
  const dir = join(fetchedRoot, new URL(fetched.final_url).hostname);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${fetched.sha256.slice(0, 12)}.pdf`);
  writeBytesAtomic(path, fetched.bytes);
  return path;
}

// ------------------------------------------------------------ sources__fetch --

/** Above this many bytes of text, sources__fetch returns `truncated: true` and no text (spec §3.3). */
export const FETCH_TEXT_LIMIT_BYTES = 200 * 1024;

export interface SourcesFetchSeams extends KnowledgeSeams {
  /** Tests only. Production always uses the runtime's one fetcher. */
  fetcher?: SourceFetcher;
}

function isPdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 5).toString("latin1") === "%PDF-";
}

function matchTerms(raw: unknown): string[] | null {
  if (raw === undefined) return null;
  const terms = typeof raw === "string" ? [raw] : raw;
  if (!Array.isArray(terms) || terms.length === 0 || terms.some((term) => typeof term !== "string" || term.trim() === "")) {
    throw new ValidationError("sources__fetch.match must be a non-empty string or a non-empty array of non-empty strings");
  }
  return terms.map((term) => term.toLowerCase());
}

/** The overlay's `_fetched\` folder, where a saved PDF goes. */
function fetchedRoot(seams: KnowledgeSeams): string {
  const label = "sources__fetch.save";
  const loc = locate(parseKnowledgePath("_fetched", label), seams, label);
  if (entryType(loc.local, label, "_fetched") === "file") {
    throw new DataServerError(`${loc.local.abs} is a file; the overlay's _fetched is a folder`, "grammar_violation");
  }
  return loc.local.abs;
}

/**
 * sources__fetch({url, match?, save?}) (spec §3.3, #989): one guarded fetch, memoized
 * like every other. An HTML page returns its normalized text, one block per line, cut
 * to the blocks matching `match` (literal, case-insensitive, OR-ed; no match is an
 * error), and `truncated: true` with no text above FETCH_TEXT_LIMIT_BYTES. A PDF
 * returns its hash, and with `save: true` is written to `_fetched\<host>\`, the only
 * thing this tool writes. A refused or failed fetch is a result, not an error.
 */
export async function sourcesFetch(
  args: { url?: unknown; match?: unknown; save?: unknown },
  seams: SourcesFetchSeams = {}
): Promise<Record<string, unknown>> {
  if (typeof args.url !== "string" || args.url === "") throw new ValidationError("sources__fetch.url must be a non-empty https URL");
  const terms = matchTerms(args.match);
  const outcome = await (seams.fetcher ?? sourcesFetcher).fetchSource(args.url);
  if (!outcome.ok) {
    const { ok: _ok, reason, hosts, ...refusal } = outcome;
    return { refused: reason, ...refusal, hosts_fetched: hosts };
  }
  const base = { url: outcome.url, status: outcome.status, size: outcome.bytes.byteLength, sha256: outcome.sha256 };

  if (isPdf(outcome.bytes)) {
    if (terms) throw new ValidationError(`sources__fetch.match applies only to an HTML page; ${outcome.final_url} returned a PDF`);
    return { kind: "pdf", ...base, saved_path: args.save === true ? saveFetchedPdf(fetchedRoot(seams), outcome) : null };
  }
  if (args.save === true) {
    throw new DataServerError(`${outcome.final_url} did not return a PDF; only a PDF is saved (nothing else is written to disk)`, "not_pdf");
  }

  const blocks = htmlBlocks(outcome.bytes.toString("utf-8"));
  const kept = terms ? blocks.filter((block) => terms.some((term) => block.toLowerCase().includes(term))) : blocks;
  if (terms && kept.length === 0) {
    throw new DataServerError(`no block of ${outcome.final_url} contains any of ${JSON.stringify(args.match)}`, "no_match");
  }
  const text = kept.join("\n");
  return {
    kind: "html",
    url: outcome.url,
    final_url: outcome.final_url,
    status: outcome.status,
    size: base.size,
    sha256: outcome.sha256,
    blocks_total: blocks.length,
    ...(terms ? { blocks_matched: kept.length } : {}),
    ...(Buffer.byteLength(text, "utf-8") > FETCH_TEXT_LIMIT_BYTES ? { truncated: true } : { text }),
  };
}
