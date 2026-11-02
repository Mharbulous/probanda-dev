// The page API: a node:http listener on 127.0.0.1 at a fixed port (token.ts pageApiPort, 47615 by
// default) through which a page opened from file:// writes. Three kinds of write: the Loose Threads
// page's Defer button (POST /seeds/<id>/defer, and /undefer), to the drafting database; the Past
// suggestions page's Withdraw button (POST /suggestions/<record id>/withdraw), which withdraws one
// suggestion this computer sent (../suggestions/send.ts); and a suggestion card's buttons and its
// mockup page's "Not like this" (POST /cards/<card id>/<state|submit|resolve|dismiss|restore|mockup|
// reject>, ../suggestions/card.ts), each completed here with no agent needed, so Submit and Dismiss
// work after the session that showed the card has ended. It also serves a card's page (GET
// /cards/<card id>?token=...), the link a card copy that cannot reach this listener offers. It opens a
// file in its default app (GET /files/open?path=...&token=..., ./open-file.ts), the Legal Research page's
// link to a memo or brief. And one read: the Arguments page asks which card a session pointed it at
// (POST /focus, ./focus.ts).
//
// index.ts starts it once the MCP transport is connected, and nothing it does reaches start():
// every listener error is logged to stderr and the MCP server carries on. The listener and every
// socket are unref'd, so it never keeps the process alive once stdio closes; it lives exactly as
// long as the data server process that owns it. Each open session runs its own data server, so the
// port is usually held already: on EADDRINUSE the listener logs one line and tries again every
// 15 s, so a surviving session's process takes the port over when the owner exits. Any other
// listen error is logged and the listener stays off.
//
// A write is accepted only with the token the render embedded for that db_path and proceeding, or for
// that suggestion (token.ts), so the listener never writes a database, or withdraws a suggestion, that a
// render did not name. A page opened from
// file:// sends `Origin: null`; responses echo it, and answer Chrome's Private Network Access
// preflight. Unlike housekeeping/server.ts, which starts lazily on port 0 and keeps tokens in
// memory, this listener holds no state of its own.

import { existsSync } from "node:fs";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import { basename, isAbsolute } from "node:path";

import { ValidationError } from "../errors.js";
import { pluginVersion } from "../repo-root.js";
import { setSeedDeferral, type SeedDeferralResult } from "../submission/forms/seed-deferral.js";
import {
  type CardDeps,
  cardEdits,
  dismissCard,
  readCardPage,
  readCardState,
  rejectMockup,
  requestMockup,
  resolvePrompt,
  restoreCard,
  submitCard,
} from "../suggestions/card.js";
import { escapeHtml, writePastSuggestionsPage } from "../suggestions/page.js";
import { type WithdrawOutcome, withdrawSuggestion } from "../suggestions/send.js";
import { readFocus } from "./focus.js";
import { openFile } from "./open-file.js";
import { pageApiCardTokenValid, pageApiFileTokenValid, pageApiPort, pageApiSuggestionTokenValid, pageApiTokenValid } from "./token.js";

const MAX_BODY = 4 * 1024;
/** A card's click carries the card's edited text. */
const MAX_CARD_BODY = 256 * 1024;
const RETRY_MS = 15_000;

const STATUS: Record<SeedDeferralResult["outcome"], number> = {
  deferred: 200,
  undeferred: 200,
  not_found: 404,
  wrong_proceeding: 409,
  not_open: 409,
  already: 409,
};

export interface PageApiOptions {
  /** Test seam: the wait between tries while the port is busy. */
  retryMs?: number;
  /** Test seam: where the listener's stderr lines go. */
  log?: (line: string) => void;
  /** Test seam: what the card routes read records, stop words and placeholders from, and send through. */
  card?: Omit<CardDeps, "env">;
  /** Test seam: what opens a file, so a test starts no app. */
  openFile?: (path: string) => Promise<void>;
}

export interface PageApi {
  port: number;
  /** Whether this process holds the port now. */
  listening(): boolean;
  /** Test seam: stops listening and stops retrying. */
  close(): Promise<void>;
}

/** Starts the listener, or its retries while the port is busy, settling once the first try has
 * bound or failed. Rejects only when probanda.json's page_api_port cannot be read; the caller logs that. */
export async function startPageApi(env: NodeJS.ProcessEnv = process.env, options: PageApiOptions = {}): Promise<PageApi> {
  const port = pageApiPort(env);
  const retryMs = options.retryMs ?? RETRY_MS;
  const log = options.log ?? ((line: string) => console.error(line));
  const startedAt = new Date().toISOString();
  let held = false;
  let stopped = false;
  let warnedBusy = false;
  let retry: NodeJS.Timeout | undefined;

  const server: Server = createServer((req, res) => {
    handle(req, res, env, startedAt, options).catch((err) => {
      if (!res.headersSent) json(req, res, 500, { error: err instanceof Error ? err.message : String(err) });
      else res.destroy();
    });
  });
  // Neither the listener nor a browser's keep-alive socket may hold the process open.
  server.on("connection", (socket) => socket.unref());
  server.on("listening", () => {
    held = true;
    server.unref();
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (stopped) return;
    if (err.code === "EADDRINUSE" && !held) {
      if (!warnedBusy) log(`[page-api] port ${port} busy, retrying`);
      warnedBusy = true;
      retry = setTimeout(() => {
        if (!stopped) server.listen(port, "127.0.0.1");
      }, retryMs);
      retry.unref();
      return;
    }
    log(`[page-api] listener off: ${err.message}`);
  });
  // Settles on the first try's outcome, bound or not, so a caller can read listening().
  await new Promise<void>((resolve) => {
    server.once("listening", () => resolve());
    server.once("error", () => resolve());
    server.listen(port, "127.0.0.1");
  });

  return {
    port,
    listening: () => held && server.listening,
    close: () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      if (!server.listening) return Promise.resolve();
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function handle(req: IncomingMessage, res: ServerResponse, env: NodeJS.ProcessEnv, startedAt: string, options: PageApiOptions): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      ...corsHeaders(req),
      "Access-Control-Allow-Methods": "GET, POST",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }
  if (url.pathname === "/health") {
    if (req.method !== "GET") return json(req, res, 405, { error: "Method not allowed" });
    return json(req, res, 200, { ok: true, pid: process.pid, started_at: startedAt, plugin_version: pluginVersion() });
  }
  if (url.pathname === "/focus") return focus(req, res, env);
  if (url.pathname === "/files/open") return openFileLink(req, res, env, url.searchParams.get("path"), url.searchParams.get("token"), options.openFile ?? openFile);
  const w = /^\/suggestions\/([0-9a-f-]{36})\/withdraw$/.exec(url.pathname);
  if (w) return withdraw(req, res, env, w[1]);
  const page = /^\/cards\/([0-9a-f-]{36})$/.exec(url.pathname);
  if (page) return cardPage(req, res, env, page[1], url.searchParams.get("token"));
  const c = /^\/cards\/([0-9a-f-]{36})\/(state|submit|resolve|dismiss|restore|mockup|reject)$/.exec(url.pathname);
  if (c) return cardClick(req, res, { ...options.card, env }, c[1], c[2] as CardRoute);
  const m = /^\/seeds\/([1-9]\d*)\/(defer|undefer)$/.exec(url.pathname);
  if (!m) return json(req, res, 404, { error: "Not found" });
  if (req.method !== "POST") return json(req, res, 405, { error: "Method not allowed" });

  let body: unknown;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    return json(req, res, 400, { error: `The request could not be read: ${(err as Error).message}` });
  }
  const posted = (typeof body === "object" && body !== null ? body : {}) as { db_path?: unknown; proceeding_id?: unknown; token?: unknown };
  const { db_path: dbPath, proceeding_id: proceedingId, token } = posted;
  if (typeof dbPath !== "string" || typeof proceedingId !== "number" || !Number.isInteger(proceedingId) || proceedingId <= 0) {
    return json(req, res, 400, { error: "The request must name db_path and a proceeding_id." });
  }
  if (typeof token !== "string" || !pageApiTokenValid(token, dbPath, proceedingId, env)) {
    return json(req, res, 403, { error: "This page's token does not match its database. Ask a Claude session to render the page again." });
  }
  if (!isAbsolute(dbPath) || !existsSync(dbPath)) {
    return json(req, res, 400, { error: `There is no drafting database at ${dbPath}.` });
  }
  const result = await setSeedDeferral({ db_path: dbPath, proceeding_id: proceedingId, seed_id: Number(m[1]), action: m[2] as "defer" | "undefer" }, env);
  json(req, res, STATUS[result.outcome], result);
}

/** The Arguments page asking which card a session last pointed it at (focus.ts), with its page's token. */
async function focus(req: IncomingMessage, res: ServerResponse, env: NodeJS.ProcessEnv): Promise<void> {
  if (req.method !== "POST") return json(req, res, 405, { error: "Method not allowed" });
  let body: unknown;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    return json(req, res, 400, { error: `The request could not be read: ${(err as Error).message}` });
  }
  const posted = (typeof body === "object" && body !== null ? body : {}) as { db_path?: unknown; proceeding_id?: unknown; token?: unknown; filing_ids?: unknown };
  const { db_path: dbPath, proceeding_id: proceedingId, token, filing_ids: filingIds } = posted;
  if (
    typeof dbPath !== "string" ||
    typeof proceedingId !== "number" ||
    !Array.isArray(filingIds) ||
    !filingIds.every((id) => typeof id === "number" && Number.isInteger(id) && id > 0)
  ) {
    return json(req, res, 400, { error: "The request must name db_path, a proceeding_id and filing_ids." });
  }
  if (typeof token !== "string" || !pageApiTokenValid(token, dbPath, proceedingId, env)) {
    return json(req, res, 403, { error: "This page's token does not match its database. Ask a Claude session to render the page again." });
  }
  json(req, res, 200, { focus: readFocus(dbPath, filingIds as number[], env) });
}

const WITHDRAW_STATUS: Record<WithdrawOutcome, number> = {
  withdrawn: 200,
  refused: 409,
  busy: 409,
  no_key: 503,
  unreachable: 502,
};

/** The Past suggestions page's Withdraw button. The reply carries only the outcome and the badge;
 * the page says the outcome in its own words, and the raw cause stays in the store. */
async function withdraw(req: IncomingMessage, res: ServerResponse, env: NodeJS.ProcessEnv, recordId: string): Promise<void> {
  if (req.method !== "POST") return json(req, res, 405, { error: "Method not allowed" });
  let body: unknown;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    return json(req, res, 400, { error: `The request could not be read: ${(err as Error).message}` });
  }
  const token = (typeof body === "object" && body !== null ? body : {}) as { token?: unknown };
  if (typeof token.token !== "string" || !pageApiSuggestionTokenValid(token.token, recordId, env)) {
    return json(req, res, 403, { error: "This page's token does not match this suggestion. Ask a Claude session for the page again." });
  }
  let result: { outcome: WithdrawOutcome; badge: string | null };
  try {
    result = await withdrawSuggestion(recordId, env);
  } catch (err) {
    if ((err as { code?: string }).code === "not_found") return json(req, res, 404, { error: "Not found" });
    throw err;
  }
  if (result.outcome === "withdrawn") {
    // The page file itself now shows the withdrawal too. Never fails the withdrawal.
    await writePastSuggestionsPage(env).catch(() => undefined);
  }
  json(req, res, WITHDRAW_STATUS[result.outcome], result);
}

/** A suggestion card's page, served on the port its buttons post to, so a card shown where it cannot
 * reach this listener links here. Served only with the card's token, checked as for a click. */
async function cardPage(req: IncomingMessage, res: ServerResponse, env: NodeJS.ProcessEnv, cardId: string, token: string | null): Promise<void> {
  if (req.method !== "GET") return json(req, res, 405, { error: "Method not allowed" });
  if (token === null || !pageApiCardTokenValid(token, cardId, env)) {
    return json(req, res, 403, { error: "This page's token does not match this suggestion. Ask a Claude session to show it again." });
  }
  let html: string;
  try {
    html = await readCardPage(cardId, env);
  } catch (err) {
    if ((err as { code?: string }).code === "not_found") return json(req, res, 404, { error: "Not found" });
    throw err;
  }
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  res.end(html);
}

/** A page's link to a file. It arrives as a new browser tab, so each answer is a short page in plain words.
 * Only a path whose token a render wrote is opened (token.ts), and the reply names only the file. */
async function openFileLink(req: IncomingMessage, res: ServerResponse, env: NodeJS.ProcessEnv, path: string | null, token: string | null, open: (path: string) => Promise<void>): Promise<void> {
  if (req.method !== "GET") return json(req, res, 405, { error: "Method not allowed" });
  if (path === null || token === null || !pageApiFileTokenValid(token, path, env)) {
    return filePage(res, 403, "This link does not match a file. Ask a Claude session to show the page again.");
  }
  const name = basename(path);
  if (!isAbsolute(path) || !existsSync(path)) return filePage(res, 404, `${name} is not in the law folder now.`);
  try {
    await open(path);
  } catch {
    return filePage(res, 500, `${name} could not be opened. Copy its path from the page to find it in File Explorer.`);
  }
  filePage(res, 200, `Opened ${name}. You can close this tab.`);
}

function filePage(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Probanda</title></head><body><p>${escapeHtml(message)}</p></body></html>`);
}

type CardRoute = "state" | "submit" | "resolve" | "dismiss" | "restore" | "mockup" | "reject";

/** A suggestion card's buttons, and its mockup page's "Not like this" (../suggestions/card.ts). Each is
 * completed here, whether or not an agent is waiting on the card. A reply carries only an outcome, the
 * card's status and the card's own text, which the page already shows; a raw cause stays in the store. */
async function cardClick(req: IncomingMessage, res: ServerResponse, deps: CardDeps, cardId: string, route: CardRoute): Promise<void> {
  if (req.method !== "POST") return json(req, res, 405, { error: "Method not allowed" });
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(await readBody(req, MAX_CARD_BODY));
    body = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch (err) {
    return json(req, res, 400, { error: `The request could not be read: ${(err as Error).message}` });
  }
  if (typeof body.token !== "string" || !pageApiCardTokenValid(body.token, cardId, deps.env)) {
    return json(req, res, 403, { error: "This page's token does not match this suggestion. Ask a Claude session to show it again." });
  }
  try {
    switch (route) {
      case "state":
        return json(req, res, 200, await readCardState(cardId, deps));
      case "submit":
        return json(req, res, 200, await submitCard(cardId, cardEdits(body.edits), deps));
      case "resolve":
        return json(req, res, 200, await resolvePrompt(cardId, body as Parameters<typeof resolvePrompt>[1], deps));
      case "dismiss":
        return json(req, res, 200, await dismissCard(cardId, deps));
      case "restore":
        return json(req, res, 200, await restoreCard(cardId, deps));
      case "mockup":
        return json(req, res, 200, await requestMockup(cardId, cardEdits(body.edits), deps));
      case "reject":
        return json(req, res, 200, await rejectMockup(cardId, body.mockup, body.reason, deps));
    }
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "not_found") return json(req, res, 404, { error: "Not found" });
    if (err instanceof ValidationError) return json(req, res, 400, { error: err.message });
    throw err;
  }
}

/** `Origin: null` (a page opened from file://) is echoed; every response answers Private Network Access. */
function corsHeaders(req: IncomingMessage): Record<string, string> {
  return {
    ...(req.headers.origin === "null" ? { "Access-Control-Allow-Origin": "null" } : {}),
    "Access-Control-Allow-Private-Network": "true",
    Vary: "Origin",
  };
}

function readBody(req: IncomingMessage, max: number = MAX_BODY): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        reject(new Error(`the request is larger than ${Math.round(max / 1024)} KB`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function json(req: IncomingMessage, res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    ...corsHeaders(req),
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}
