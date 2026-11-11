// The time review page's server (build plan slice 7), on the local-page listener
// (../local-page/listener.ts) as /housekeeping's approval page is, on its own fixed port
// (probanda.json `page_ports.timekeeping`, 47617 by default): each bundle answers its own routes only.
//
// The page is at /t/<link id>/. The id is a link record beside probanda.json (../local-page/links.ts)
// naming the screenshot folder, so no folder path reaches the URL. Nothing is kept in memory:
// whichever process on the device holds the port resolves the link from disk. Each serve drops every
// earlier link, so an old tab stops working, and clears clicks left over from the earlier page.
//
// Screenshots: the page's <img> points at /t/<id>/img/<capture id>, and this listener reads
// `<capture id>.png` from the served `syncopaid-screens` folder when the browser asks. The PNGs are
// the ones the screenshot reader already uses; the listener decrypts nothing and writes no file
// (the CLI that decrypts writes its own output file, so decrypting on request would add a copy).
//
// A click is a POST to /t/<id>/click, saved as a `page_click:` record in the store (the same store
// every process reads), and time_review__wait_click returns the oldest. Slice 7 has no action
// buttons, so nothing on the page posts one yet.

import { randomBytes } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { win32 as pathWin32 } from "node:path";

import { BUILD_STAMP } from "../build-stamp.js";
import { DataServerError, ValidationError } from "../errors.js";
import { deviceLink, dropLinks, resolveLink, sweepLinks } from "../local-page/links.js";
import { type PageListener, probeHolder, startPageListener } from "../local-page/listener.js";
import { STRICT_CSP, file as sendFile, html, json, readBody, text } from "../local-page/reply.js";
import { waitFor } from "../local-page/wait.js";
import { pythonTimeoutMs } from "../python-timeout.js";
import { pluginVersion } from "../repo-root.js";
import { timePipelineDelete, timePipelineList, timePipelineWriteIf } from "../time-pipeline/backend.js";
import { loadReviewModel, renderReviewPage } from "./page.js";
import { NAMESPACE } from "./records.js";

const KIND = "time-review";
const CLICK_PREFIX = "page_click:";
const SCREENS_FOLDER = "syncopaid-screens";
const IMAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const ACT = /^[a-z_]{1,40}$/;
const BLOCK = /^\d{4}-\d{2}-\d{2}:\d{3}$/;
const MAX_BODY = 4 * 1024;
const REPLY = { csp: STRICT_CSP };

export const WAIT_TIMEOUT_MS = 45_000;
const POLL_MS = 1_000;

interface Target {
  screens_dir: string | null;
  serve: string;
}

let listener: Promise<PageListener> | undefined;

export interface ServeResult {
  url: string;
  /** Whether screenshots are served: false when no screenshot folder was given. */
  screenshots: boolean;
  blocks: number;
  /** Another process on another build holds the port, so it, not this one, answers the link. */
  warning?: "older_holder";
}

export interface ReviewPagesOptions {
  log?: (line: string) => void;
  retryMs?: number;
}

export function startReviewPages(env: NodeJS.ProcessEnv = process.env, options: ReviewPagesOptions = {}): Promise<PageListener> {
  if (!listener) {
    const starting = (async () => {
      sweepLinks(env);
      return startPageListener({
        bundle: "timekeeping",
        port: "fixed",
        routes: [
          { method: "GET", kind: KIND, path: /^\/t\/([A-Za-z0-9_-]+)\/?$/, handle: (_req, res, m) => withTarget(m[1], env, res, (t) => page(t, m[1], env, res)) },
          { method: "GET", kind: KIND, path: /^\/t\/([A-Za-z0-9_-]+)\/img\/([^/]+)\/?$/, handle: (_req, res, m) => withTarget(m[1], env, res, (t) => image(t, decodeId(m[2]), res)) },
          { method: "POST", kind: KIND, path: /^\/t\/([A-Za-z0-9_-]+)\/click\/?$/, handle: (req, res, m) => withTarget(m[1], env, res, () => click(m[1], req, res, env)) },
        ],
        env,
        about: { build_stamp: BUILD_STAMP, plugin_version: pluginVersion() },
        log: options.log,
        retryMs: options.retryMs,
      });
    })();
    listener = starting;
    starting.catch(() => {
      if (listener === starting) listener = undefined;
    });
  }
  return listener;
}

/** The screenshot folder as the page may serve it: absolute, an existing folder named
 * `syncopaid-screens`, the one folder the screenshot reader reads from. */
function checkScreensDir(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !pathWin32.isAbsolute(raw)) {
    throw new ValidationError("time_review__serve_page: screens_dir must be the absolute path of the syncopaid-screens folder");
  }
  const real = existsSync(raw) && statSync(raw).isDirectory() ? realpathSync.native(raw) : null;
  if (real === null || pathWin32.basename(real).toLowerCase() !== SCREENS_FOLDER) {
    throw new ValidationError(`time_review__serve_page: screens_dir must be an existing folder named ${SCREENS_FOLDER}`);
  }
  return real;
}

/** Serves the page and returns its URL. Every earlier link and unread click stops counting. */
export async function serveReviewPage(screensDirIn: unknown, env: NodeJS.ProcessEnv = process.env): Promise<ServeResult> {
  const screens = checkScreensDir(screensDirIn);
  const pages = await startReviewPages(env);
  const { port } = pages;
  const failure = pages.holding() ? null : pages.failure();
  if (failure) {
    throw new DataServerError(
      `the page listener cannot listen on port ${port} (${failure.message}); set another port for "timekeeping" under page_ports in probanda.json`,
      "page_port_taken",
    );
  }
  const warning = pages.holding() ? null : await holderWarning(port);
  dropLinks(KIND, () => true, env);
  clearClicks(env);
  const target: Target = { screens_dir: screens, serve: randomBytes(9).toString("base64url") };
  const id = deviceLink(KIND, JSON.stringify(target), env);
  const served: ServeResult = { url: `http://127.0.0.1:${port}/t/${id}/`, screenshots: screens !== null, blocks: loadReviewModel({ env }).blocks.length };
  return warning ? { ...served, warning } : served;
}

async function holderWarning(port: number): Promise<"older_holder" | null> {
  const holder = await probeHolder(port, "timekeeping");
  if (holder.kind === "none") return null;
  if (holder.kind === "other") {
    throw new DataServerError(
      `port ${port} is held by a program that is not a Probanda timekeeping page listener (${holder.reason}); set another port for "timekeeping" under page_ports in probanda.json`,
      "page_port_taken",
    );
  }
  return holder.build_stamp === BUILD_STAMP ? null : "older_holder";
}

/** Test seam: stops this process's listener. Link records stay on disk. */
export async function closeReviewPages(): Promise<void> {
  const current = listener;
  listener = undefined;
  if (!current) return;
  let started: PageListener;
  try {
    started = await current;
  } catch {
    return;
  }
  await started.close();
}

function parseTarget(raw: string | null): Target | null {
  if (raw === null) return null;
  try {
    const t = JSON.parse(raw) as Partial<Target> | null;
    return t !== null && typeof t === "object" && (t.screens_dir === null || typeof t.screens_dir === "string") ? (t as Target) : null;
  } catch {
    return null;
  }
}

function withTarget(id: string, env: NodeJS.ProcessEnv, res: ServerResponse, then: (target: Target) => void | Promise<void>): void | Promise<void> {
  const target = parseTarget(resolveLink(KIND, id, env));
  if (target) return then(target);
  html(res, 410, "<!doctype html><meta charset=\"utf-8\"><title>Out of date</title><p>This page is out of date: a newer one has been served, or the link is more than 30 days old. Ask Claude for the page again.</p>", REPLY);
}

const decodeId = (raw: string): string => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
};

function page(target: Target, id: string, env: NodeJS.ProcessEnv, res: ServerResponse): void {
  const model = loadReviewModel({ env });
  html(res, 200, renderReviewPage(model, target.screens_dir === null ? null : `/t/${id}/img/`), REPLY);
}

/** Streams one screenshot PNG from the served folder, and nothing else. */
function image(target: Target, captureId: string, res: ServerResponse): void {
  if (target.screens_dir === null || !IMAGE_ID.test(captureId)) return text(res, 404, "No such screenshot", REPLY);
  let real: string;
  try {
    real = realpathSync.native(pathWin32.join(target.screens_dir, `${captureId}.png`));
    if (!statSync(real).isFile()) throw new Error("not a file");
  } catch {
    return text(res, 404, "The screenshot is not in the folder", REPLY);
  }
  const inside = pathWin32.relative(target.screens_dir, real);
  if (inside.startsWith("..") || pathWin32.isAbsolute(inside) || pathWin32.dirname(real).toLowerCase() !== target.screens_dir.toLowerCase()) {
    return text(res, 403, "This file is not served", REPLY);
  }
  sendFile(res, real, pathWin32.basename(real), "image/png");
}

async function click(id: string, req: IncomingMessage, res: ServerResponse, env: NodeJS.ProcessEnv): Promise<void> {
  let body: { act?: unknown; block?: unknown };
  try {
    body = JSON.parse(await readBody(req, MAX_BODY)) as typeof body;
  } catch (err) {
    return json(res, 400, { error: `The click could not be read: ${(err as Error).message}` }, REPLY);
  }
  if (typeof body !== "object" || body === null || typeof body.act !== "string" || !ACT.test(body.act)) {
    return json(res, 400, { error: "The click names no act." }, REPLY);
  }
  if (body.block !== undefined && (typeof body.block !== "string" || !BLOCK.test(body.block))) {
    return json(res, 400, { error: "The click names a block that is not a block id." }, REPLY);
  }
  const clicked_at = new Date().toISOString();
  const key = `${CLICK_PREFIX}${clicked_at}:${randomBytes(4).toString("hex")}`;
  const record = { kind: "page_click", link: id, act: body.act, block: body.block ?? null, clicked_at };
  const saved = timePipelineWriteIf(NAMESPACE, key, JSON.stringify(record), { expect_absent: true }, env);
  if ("stale" in saved) return json(res, 409, { error: "The click could not be saved. Try again." }, REPLY);
  json(res, 200, { ok: true }, REPLY);
}

function clearClicks(env: NodeJS.ProcessEnv): void {
  for (const item of timePipelineList(NAMESPACE, CLICK_PREFIX, env).items) timePipelineDelete(NAMESPACE, item.key, env, item.sha256);
}

export type WaitClickResult =
  | { status: "clicked"; act: string; block: string | null; clicked_at: string }
  | { status: "pending"; waited_ms: number };

/** Returns the oldest unread click and consumes it, or `pending` when the budget runs out. The
 * session calls it again until a click arrives. The poll is a timer, never a blocking sleep: the
 * page listener on this event loop keeps answering while a wait is in flight. */
export async function waitClick(env: NodeJS.ProcessEnv = process.env): Promise<WaitClickResult> {
  const budget = pythonTimeoutMs(env, WAIT_TIMEOUT_MS, "COCLERK_TIME_REVIEW_WAIT_MS");
  const outcome = await waitFor<WaitClickResult>(
    () => {
      const [oldest] = timePipelineList(NAMESPACE, CLICK_PREFIX, env).items;
      if (!oldest) return undefined;
      try {
        timePipelineDelete(NAMESPACE, oldest.key, env, oldest.sha256);
      } catch (err) {
        // Another waiting session took this click first: look again.
        if (err instanceof DataServerError && err.code === "stale_write") return undefined;
        throw err;
      }
      const record = JSON.parse(oldest.value) as { act: string; block: string | null; clicked_at: string };
      return { status: "clicked", act: record.act, block: record.block, clicked_at: record.clicked_at };
    },
    { budgetMs: budget, pollMs: POLL_MS },
  );
  return "value" in outcome ? outcome.value : { status: "pending", waited_ms: outcome.waited_ms };
}
