// The page API: a node:http listener on 127.0.0.1 at a fixed port (token.ts pageApiPort, 47615 by
// default) through which a matter page opened from file:// writes to the drafting database. Today
// one write: the Loose Threads page's Defer button (POST /seeds/<id>/defer, and /undefer).
//
// index.ts starts it once the MCP transport is connected, and nothing it does reaches start():
// every listener error is logged to stderr and the MCP server carries on. The listener and every
// socket are unref'd, so it never keeps the process alive once stdio closes; it lives exactly as
// long as the data server process that owns it. Each open session runs its own data server, so the
// port is usually held already: on EADDRINUSE the listener logs one line and tries again every
// 15 s, so a surviving session's process takes the port over when the owner exits. Any other
// listen error is logged and the listener stays off.
//
// A write is accepted only with the token the render embedded for that db_path and proceeding
// (token.ts), so the listener never writes a database a render did not name. A page opened from
// file:// sends `Origin: null`; responses echo it, and answer Chrome's Private Network Access
// preflight. Unlike housekeeping/server.ts, which starts lazily on port 0 and keeps tokens in
// memory, this listener holds no state of its own.

import { existsSync } from "node:fs";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import { isAbsolute } from "node:path";

import { pluginVersion } from "../repo-root.js";
import { setSeedDeferral, type SeedDeferralResult } from "../submission/forms/seed-deferral.js";
import { pageApiPort, pageApiTokenValid } from "./token.js";

const MAX_BODY = 4 * 1024;
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
    handle(req, res, env, startedAt).catch((err) => {
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

async function handle(req: IncomingMessage, res: ServerResponse, env: NodeJS.ProcessEnv, startedAt: string): Promise<void> {
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

/** `Origin: null` (a page opened from file://) is echoed; every response answers Private Network Access. */
function corsHeaders(req: IncomingMessage): Record<string, string> {
  return {
    ...(req.headers.origin === "null" ? { "Access-Control-Allow-Origin": "null" } : {}),
    "Access-Control-Allow-Private-Network": "true",
    Vary: "Origin",
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("the request is larger than 4 KB"));
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
