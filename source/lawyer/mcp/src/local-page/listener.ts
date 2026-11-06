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
// Routes match by method and a regex on the path; a path that matches some route under another
// method gets 405, and no match gets 404. A route that throws gets one JSON 500. GET /health is
// built in: { bundle, pid, build_stamp, plugin_version, kinds }.

import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { type PageBundle, pagePort } from "./ports.js";
import { json, text } from "./reply.js";

export interface PageRoute {
  method: "GET" | "POST";
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
  const tag = `[${options.bundle} pages]`;
  let held = false;
  let stopped = false;
  let warnedBusy = false;
  let retry: NodeJS.Timeout | undefined;

  const server: Server = createServer((req, res) => {
    route(req, res, options).catch((err) => {
      if (!res.headersSent) json(res, 500, { error: err instanceof Error ? err.message : String(err) });
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

async function route(req: IncomingMessage, res: ServerResponse, options: PageListenerOptions): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/health") {
    if (req.method !== "GET") return text(res, 405, "Method not allowed");
    const kinds = [...new Set(options.routes.map((r) => r.kind))];
    return json(res, 200, { bundle: options.bundle, pid: process.pid, ...options.about, kinds });
  }
  let pathMatched = false;
  for (const r of options.routes) {
    const match = r.path.exec(url.pathname);
    if (!match) continue;
    pathMatched = true;
    if (req.method === r.method) return r.handle(req, res, match, url);
  }
  if (pathMatched) return text(res, 405, "Method not allowed");
  text(res, 404, "Not found");
}
