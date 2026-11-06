// The /housekeeping approval page server (spec §B8.3).
//
// The page is served by the file-manager bundle's local-page listener (../local-page/listener.ts)
// on its fixed port (probanda.json `page_ports`, 47616 by default), bound at boot by
// file-manager-index.ts and on the first serve if boot did not. The URL is /h/<link id>/, the id
// a link record beside probanda.json (../local-page/links.ts) naming the matter, the run and the
// serve, so no client folder name reaches the URL. Nothing is kept in memory: whichever process
// on the device holds the port, before or after a tool-server restart, resolves the link from
// disk. Each serve deletes every earlier link for that matter, so an old tab cannot approve rows a
// newer run proposed differently, and a link whose record is gone, or whose matter or run
// directory no longer opens, is out of date.
//
// When another process holds the port, a serve reads its /health (detect and warn, no takeover):
// a file-manager listener on another build adds `warning: "older_holder"` to the result, and
// anything that does not answer as one fails `page_port_taken`, naming probanda.json `page_ports`.
// A bind that failed for any reason but a busy port (EACCES, say) fails `page_port_taken` too.
//
// Approve is checked in this order: the link record; a re-list of the run directories, which
// must show no run directory newer than this run, proposal or not (spec A4); a readable
// proposal.json; the posted rows, one `approve: true` entry per approved row id, each of which must
// be in proposal.json and not a `stuck` or `misfiled` row, which is information only (none at all
// is a valid approval: every row left as is); and approval.json,
// which must not exist yet -- it is created exclusively ("wx"), written, fsync'd and closed before
// the 200 reply. One already there, even unreadable, is never overwritten.

import { randomBytes } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { win32 as pathWin32 } from "node:path";

import { BUILD_STAMP } from "../build-stamp.js";
import { DataServerError } from "../errors.js";
import { zoneProblem } from "../files/zones.js";
import { writeNewDurably } from "../local-page/durable.js";
import { deviceLink, dropLinks, resolveLink, sweepLinks } from "../local-page/links.js";
import { type PageListener, type PageRoute, probeHolder, startPageListener } from "../local-page/listener.js";
import { STRICT_CSP, file as sendFile, html, json, readBody, text } from "../local-page/reply.js";
import { pluginVersion } from "../repo-root.js";
import { renderApprovalPage, simplePage, stalePage } from "./page.js";
import { Checker, INFORMATION_ONLY, validateEntries } from "./proposal.js";
import {
  APPROVAL,
  type Matter,
  existingRunDir,
  newerRun,
  newestProposalRun,
  openMatter,
  readApproval,
  readProposal,
  requireProposal,
} from "./run-dir.js";

interface Grant {
  matter: Matter;
  runId: string;
  runDir: string;
}

/** What a link record's target holds. `serve` tells one serve of a run from the next. */
interface Target {
  matter_root: string;
  run_id: string;
  serve: string;
}

const KIND = "housekeeping";
const MAX_BODY = 5 * 1024 * 1024;
const REPLY = { csp: STRICT_CSP };
const INLINE_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".csv": "text/plain; charset=utf-8",
  ".eml": "text/plain; charset=utf-8",
};

let listener: Promise<PageListener> | undefined;

export interface ServeResult {
  url: string;
  run_id: string;
  rows: number;
  /** The run is already approved: the page shows the approved state. */
  approved: boolean;
  /** Another process on another build holds the port, so it, not this one, answers the link. */
  warning?: "older_holder";
}

export interface HousekeepingPagesOptions {
  log?: (line: string) => void;
  retryMs?: number;
}

/** Starts this process's page listener once: bound at boot, or by the first serve. Records older
 * than 30 days are swept first. The routes read link records through `env`. */
export function startHousekeepingPages(env: NodeJS.ProcessEnv = process.env, options: HousekeepingPagesOptions = {}): Promise<PageListener> {
  if (!listener) {
    const starting = (async () => {
      sweepLinks(env);
      return startPageListener({
        bundle: "file-manager",
        port: "fixed",
        routes: routes(env),
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

/** Serves `runId`'s page and returns its URL. Every earlier link for the matter stops working. */
export async function servePage(matterRoot: string, runId: string, env: NodeJS.ProcessEnv = process.env): Promise<ServeResult> {
  const matter = openMatter(matterRoot);
  const runDir = existingRunDir(matter, runId);
  const proposal = requireProposal(runDir, runId, matter.root);
  const newest = newestProposalRun(matter);
  if (newest !== runId) {
    throw new DataServerError(`run ${runId} is not the matter's newest run with a proposal (${newest}); serve that one`, "stale_run");
  }
  const pages = await startHousekeepingPages(env);
  const { port } = pages;
  const failure = pages.holding() ? null : pages.failure();
  if (failure) {
    throw new DataServerError(
      `the page listener cannot listen on port ${port} (${failure.message}); set another port for "file-manager" under page_ports in probanda.json`,
      "page_port_taken",
    );
  }
  const warning = pages.holding() ? null : await holderWarning(port);
  const key = matter.root.toLowerCase();
  dropLinks(KIND, (target) => parseTarget(target)?.matter_root.toLowerCase() === key, env);
  const target: Target = { matter_root: matter.root, run_id: runId, serve: randomBytes(9).toString("base64url") };
  const id = deviceLink(KIND, JSON.stringify(target), env);
  const served: ServeResult = { url: `http://127.0.0.1:${port}/h/${id}/`, run_id: runId, rows: proposal.rows.length, approved: readApproval(runDir, runId).approval !== null };
  return warning ? { ...served, warning } : served;
}

/** Another process holds the port: "older_holder" when it is this bundle's listener on another
 * build, null on this build or when it has just let go. Anything else answering there fails. */
async function holderWarning(port: number): Promise<"older_holder" | null> {
  const holder = await probeHolder(port, "file-manager");
  if (holder.kind === "none") return null;
  if (holder.kind === "other") {
    throw new DataServerError(
      `port ${port} is held by a program that is not a Probanda file-manager page listener (${holder.reason}); ` +
        `set another port for "file-manager" under page_ports in probanda.json`,
      "page_port_taken",
    );
  }
  return holder.build_stamp === BUILD_STAMP ? null : "older_holder";
}

/** Test seam: stops this process's listener. Link records stay on disk. */
export async function closePageServer(): Promise<void> {
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

function routes(env: NodeJS.ProcessEnv): PageRoute[] {
  return [
    { method: "GET", kind: KIND, path: /^\/h\/([A-Za-z0-9_-]+)\/?$/, handle: (_req, res, m) => withGrant(m[1], env, res, "page", (g) => page(g, res)) },
    { method: "POST", kind: KIND, path: /^\/h\/([A-Za-z0-9_-]+)\/approve\/?$/, handle: (req, res, m) => withGrant(m[1], env, res, "approve", (g) => approve(g, req, res)) },
    {
      method: "GET",
      kind: KIND,
      path: /^\/h\/([A-Za-z0-9_-]+)\/file\/([^/]+)\/?$/,
      handle: (_req, res, m) => withGrant(m[1], env, res, "file", (g) => file(g, decodeURIComponent(m[2]), res)),
    },
  ];
}

function parseTarget(text: string): Target | null {
  try {
    const t = JSON.parse(text) as Partial<Target> | null;
    return typeof t?.matter_root === "string" && typeof t.run_id === "string" ? (t as Target) : null;
  } catch {
    return null;
  }
}

/** The link's matter and run, opened from disk now, or null when the link is out of date. */
function grantFor(id: string, env: NodeJS.ProcessEnv): Grant | null {
  const raw = resolveLink(KIND, id, env);
  const target = raw === null ? null : parseTarget(raw);
  if (!target) return null;
  try {
    const matter = openMatter(target.matter_root);
    return { matter, runId: target.run_id, runDir: existingRunDir(matter, target.run_id) };
  } catch {
    return null;
  }
}

function withGrant(id: string, env: NodeJS.ProcessEnv, res: ServerResponse, route: "page" | "approve" | "file", then: (grant: Grant) => void | Promise<void>): void | Promise<void> {
  const grant = grantFor(id, env);
  if (grant) return then(grant);
  if (route === "approve") {
    return json(res, 410, { error: "This page is out of date: a newer run has been served for this matter, or the link is more than 30 days old. Nothing was approved." }, REPLY);
  }
  html(res, 410, stalePage(), REPLY);
}

function page(grant: Grant, res: ServerResponse): void {
  const { proposal, problem } = readProposal(grant.runDir, grant.runId, grant.matter.root);
  if (!proposal) {
    return html(res, 500, simplePage("The page cannot be shown", `The proposal for this run cannot be read (${problem}). Go back to Claude.`), REPLY);
  }
  html(res, 200, renderApprovalPage(proposal, readApproval(grant.runDir, grant.runId).approval), REPLY);
}

async function approve(grant: Grant, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: unknown;
  try {
    body = JSON.parse(await readBody(req, MAX_BODY));
  } catch (err) {
    return json(res, 400, { error: `The approval could not be read: ${(err as Error).message}` }, REPLY);
  }
  const posted = body as { run?: unknown; rows?: unknown };
  if (typeof body !== "object" || body === null || posted.run !== grant.runId) {
    return json(res, 400, { error: "The approval does not name this page's run." }, REPLY);
  }
  if (newerRun(grant.matter, grant.runId) !== null) {
    return json(res, 409, { error: "This page is out of date: a newer run has started for this matter. Nothing was approved." }, REPLY);
  }
  const { proposal, problem } = readProposal(grant.runDir, grant.runId, grant.matter.root);
  if (!proposal) {
    return json(res, 500, { error: `The proposal for this run cannot be read (${problem}). Nothing was approved. Go back to Claude.` }, REPLY);
  }
  const v = new Checker();
  validateEntries(v, posted.rows);
  if (v.problems.length) return json(res, 400, { error: `The approval is malformed: ${v.problems.join("; ")}` }, REPLY);
  const known = new Map(proposal.rows.map((r) => [r.row_id, r]));
  const ids = (posted.rows as Array<{ row_id: string }>).map((e) => e.row_id);
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) return json(res, 400, { error: `Unknown rows: ${unknown.join(", ")}. Nothing was approved.` }, REPLY);
  const shown = ids.filter((id) => {
    const kind = known.get(id)?.action?.kind;
    return kind !== undefined && INFORMATION_ONLY.includes(kind);
  });
  if (shown.length) {
    return json(res, 400, { error: `Rows ${shown.join(", ")} are shown for information only and cannot be approved. Nothing was approved.` }, REPLY);
  }

  const path = pathWin32.join(grant.runDir, APPROVAL);
  if (existsSync(path)) return json(res, 409, { error: savedApprovalError(grant) }, REPLY);
  const approval = { run_id: grant.runId, approved_at: new Date().toISOString(), rows: posted.rows };
  try {
    writeNewDurably(path, JSON.stringify(approval, null, 2) + "\n");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return json(res, 409, { error: savedApprovalError(grant) }, REPLY);
    throw err;
  }
  json(res, 200, { ok: true, run_id: grant.runId, rows: (posted.rows as unknown[]).length }, REPLY);
}

/** Why a second Approve is refused: the run is approved, or its saved approval is unreadable. */
function savedApprovalError(grant: Grant): string {
  return readApproval(grant.runDir, grant.runId).approval
    ? "This run is already approved. Go back to Claude."
    : "The approval already saved for this run is unreadable, so nothing was changed. Go back to Claude.";
}

/** Opens a row's file for the practitioner. Never a firewall-zone file. */
function file(grant: Grant, rowId: string, res: ServerResponse): void {
  const { proposal } = readProposal(grant.runDir, grant.runId, grant.matter.root);
  const row = proposal?.rows.find((r) => r.row_id === rowId);
  const rel = row?.current_path;
  if (!rel) return text(res, 404, "No such file on this page", REPLY);
  let real: string;
  try {
    real = realpathSync.native(pathWin32.join(grant.matter.root, rel));
    if (!statSync(real).isFile()) throw new Error("not a file");
  } catch {
    return text(res, 404, "The file is no longer there", REPLY);
  }
  const inside = pathWin32.relative(grant.matter.root, real);
  if (inside.startsWith("..") || pathWin32.isAbsolute(inside) || zoneProblem("run-files", real)) {
    return text(res, 403, "This file is not opened from the page", REPLY);
  }
  sendFile(res, real, pathWin32.basename(real), INLINE_TYPES[pathWin32.extname(real).toLowerCase()]);
}
