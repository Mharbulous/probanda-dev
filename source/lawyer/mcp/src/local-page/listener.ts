// The one node:http listener every local page uses, on 127.0.0.1.
//
// A "fixed" listener binds its bundle's port (ports.ts). Every Claude session runs its own copy of
// each bundle, so the port is often held already: on EADDRINUSE it logs one line and tries again
// every 3 s, so a surviving process takes the port over when the holder exits. Whichever process
// holds the port answers every session's links, so a route must read its state from disk only.
// An "ephemeral" listener takes a port the OS picks.
//
// The listener and every socket are unref'd, so it never keeps the process alive once stdio
// closes. The server never closes an idle keep-alive socket: with Node's 5 s default, a client
// could send on it in the instant the server closed it, and the request failed (#153).
//
// Routes match by method (or any method, "*") and a regex on the path; a path that matches some route under another
// method gets 405, and no match gets 404. A route that throws gets one JSON 500. GET /health is
// built in: { bundle, pid, build_stamp, plugin_version, kinds }, or the `health` body when given.
// probeHolder reads another process's /health, for a caller whose fixed port is held.
//
// A `cors` listener serves pages opened from file:// (the page API): OPTIONS on any path gets the
// 204 preflight, and every reply the listener itself makes (/health, 404, 405, 500) is JSON
// carrying the CORS and Private Network Access headers (reply.ts corsHeaders).

import { type IncomingMessage, type Server, type ServerResponse, createServer, get } from "node:http";
import type { AddressInfo } from "node:net";

import { type PageBundle, pagePort } from "./ports.js";
import { corsHeaders, json, text } from "./reply.js";

export interface PageRoute {
  /** "*" takes every method, for a page that answers each one itself. */
  method: "GET" | "POST" | "*";
  path: RegExp;
  /** What the route serves, as /health reports it. */
  kind: string;
  handle(req: IncomingMessage, res: ServerResponse, match: RegExpExecArray, url: URL): void | Promise<void>;
}

export interface PageListenerOptions {
  bundle: PageBundle | "timecamp" | "mail";
  port: "fixed" | "ephemeral";
  routes: PageRoute[];
  env: NodeJS.ProcessEnv;
  /** What /health reports about the running code. */
  about: { build_stamp: string | null; plugin_version: string | null };
  /** Where the listener's stderr lines go. */
  log?: (line: string) => void;
  /** Test seam: the wait between tries while a fixed port is busy. */
  retryMs?: number;
  /** /health's body in place of the built-in one. */
  health?: () => Record<string, unknown>;
  /** Answer pages opened from file:// (see the header). */
  cors?: true;
  /** What starts each log line; `[<bundle> pages]` by default. */
  logTag?: string;
}

export interface PageListener {
  port: number;
  /** Whether this process holds the port now. */
  holding(): boolean;
  /** Stops listening and stops retrying. */
  close(): Promise<void>;
}

const RETRY_MS = 3_000;

/** Starts the listener, settling once the first try has bound or failed. Rejects when a fixed
 * port cannot be read from probanda.json, or an ephemeral listen fails. */
export async function startPageListener(options: PageListenerOptions): Promise<PageListener> {
  const fixed = options.port === "fixed";
  const wanted = fixed ? pagePort(options.bundle as PageBundle, options.env) : 0;
  const log = options.log ?? ((line: string) => console.error(line));
  const retryMs = options.retryMs ?? RETRY_MS;
  const tag = options.logTag ?? `[${options.bundle} pages]`;
  let held = false;
  let stopped = false;
  let warnedBusy = false;
  let retry: NodeJS.Timeout | undefined;

  const server: Server = createServer((req, res) => {
    route(req, res, options).catch((err) => {
      if (!res.headersSent) json(res, 500, { error: err instanceof Error ? err.message : String(err) }, options.cors ? { cors: req } : {});
      else res.destroy();
    });
  });
  server.on("connection", (socket) => socket.unref());
  server.keepAliveTimeout = 0;
  server.on("listening", () => {
    held = true;
    server.unref();
  });

  const first = await new Promise<Error | null>((resolve) => {
    server.once("listening", () => resolve(null));
    server.once("error", (err) => resolve(err));
    server.listen(wanted, "127.0.0.1");
  });
  if (first && !fixed) throw first;
  server.on("error", (err: NodeJS.ErrnoException) => onError(err));
  if (first) onError(first as NodeJS.ErrnoException);

  function onError(err: NodeJS.ErrnoException): void {
    if (stopped) return;
    if (err.code === "EADDRINUSE" && !held) {
      if (!warnedBusy) log(`${tag} port ${wanted} busy, retrying`);
      warnedBusy = true;
      retry = setTimeout(() => {
        if (!stopped) server.listen(wanted, "127.0.0.1");
      }, retryMs);
      retry.unref();
      return;
    }
    log(`${tag} listener off: ${err.message}`);
  }

  return {
    port: fixed ? wanted : (server.address() as AddressInfo).port,
    holding: () => held && server.listening,
    close: () => {
      stopped = true;
      if (retry) clearTimeout(retry);
      if (!server.listening) return Promise.resolve();
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** What answers GET /health on a port this process does not hold: nothing; another process's
 * listener for `bundle`, with its build; or something else, with why it is not one. */
export type PortHolder =
  | { kind: "none" }
  | { kind: "probanda"; build_stamp: string | null; plugin_version: string | null }
  | { kind: "other"; reason: string };

/** Reads the holder's /health, giving up after `timeoutMs` so a hung holder cannot stall the caller. */
export function probeHolder(port: number, bundle: string, timeoutMs = 1_000): Promise<PortHolder> {
  return new Promise((resolve) => {
    // A fresh socket each time: a pooled one may belong to a holder that has since exited.
    const req = get({ host: "127.0.0.1", port, path: "/health", timeout: timeoutMs, agent: false }, (res) => {
      let body = "";
      res.setEncoding("utf-8");
      res.on("data", (chunk: string) => (body += chunk));
      res.on("end", () => resolve(holderFrom(res.statusCode, body, bundle)));
      res.on("error", (err) => resolve({ kind: "other", reason: err.message }));
    });
    req.on("timeout", () => req.destroy(new Error(`no answer within ${timeoutMs} ms`)));
    req.on("error", (err: NodeJS.ErrnoException) => resolve(err.code === "ECONNREFUSED" ? { kind: "none" } : { kind: "other", reason: err.message }));
  });
}

function holderFrom(status: number | undefined, body: string, bundle: string): PortHolder {
  if (status !== 200) return { kind: "other", reason: `/health answered ${status}` };
  let h: Record<string, unknown> | null;
  try {
    h = JSON.parse(body) as Record<string, unknown> | null;
  } catch {
    return { kind: "other", reason: "/health is not JSON" };
  }
  const stringOrNull = (v: unknown) => v === null || typeof v === "string";
  if (h?.bundle !== bundle || !stringOrNull(h.build_stamp) || !stringOrNull(h.plugin_version)) {
    return { kind: "other", reason: `/health does not describe a ${bundle} page listener` };
  }
  return { kind: "probanda", build_stamp: h.build_stamp as string | null, plugin_version: h.plugin_version as string | null };
}

async function route(req: IncomingMessage, res: ServerResponse, options: PageListenerOptions): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const fail = (status: number, message: string) => (options.cors ? json(res, status, { error: message }, { cors: req }) : text(res, status, message));
  if (options.cors && req.method === "OPTIONS") {
    res.writeHead(204, { ...corsHeaders(req), "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type" });
    res.end();
    return;
  }
  if (url.pathname === "/health") {
    if (req.method !== "GET") return fail(405, "Method not allowed");
    const kinds = [...new Set(options.routes.map((r) => r.kind))];
    const body = options.health ? options.health() : { bundle: options.bundle, pid: process.pid, ...options.about, kinds };
    return json(res, 200, body, options.cors ? { cors: req } : {});
  }
  let pathMatched = false;
  for (const r of options.routes) {
    const match = r.path.exec(url.pathname);
    if (!match) continue;
    pathMatched = true;
    if (r.method === "*" || req.method === r.method) return r.handle(req, res, match, url);
  }
  if (pathMatched) return fail(405, "Method not allowed");
  fail(404, "Not found");
}
