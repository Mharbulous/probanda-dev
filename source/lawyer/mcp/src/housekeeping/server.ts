// The /housekeeping approval page server (spec §B8.3).
//
// node:http on 127.0.0.1, port 0, started lazily by the first serve and unref'd, so it never
// keeps the process alive once stdio closes; the page stops working with the session that made
// it. Each serve mints a random per-run token carried in the URL and invalidates every earlier
// token for that matter in this process, so an old tab cannot approve rows a newer run proposed
// differently.
//
// Approve is checked in this order: the token in memory; a re-list of the run directories, which
// must show no run directory newer than this run, proposal or not (spec A4); a readable
// proposal.json; the posted rows, one `approve: true` entry per approved row id, each of which must
// be in proposal.json and not a `stuck` or `misfiled` row, which is information only (none at all
// is a valid approval: every row left as is); and approval.json,
// which must not exist yet -- it is created exclusively ("wx"), written, fsync'd and closed before
// the 200 reply. One already there, even unreadable, is never overwritten.
//
// The same listener serves named files read-only under /p/<token>/<name> (ADR 0033, 2026-10-02
// amendment): serveFiles grants one folder a fixed map of route names to file names, and nothing
// from the request enters a path. The token is minted on a folder's first serve and lasts as long
// as the process, so a tab the practitioner keeps open survives every later serve; each GET reads
// the file fresh, so a reload shows the latest write.

import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, realpathSync, statSync } from "node:fs";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { win32 as pathWin32 } from "node:path";

import { DataServerError } from "../errors.js";
import { zoneProblem } from "../files/zones.js";
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
  writeNewDurably,
} from "./run-dir.js";

interface Grant {
  matter: Matter;
  runId: string;
  runDir: string;
}

/** A folder's named files: route name -> file name inside `folder`. */
interface FileGrant {
  folder: string;
  files: Record<string, string>;
}

const MAX_BODY = 5 * 1024 * 1024;
const CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
/** The served pages carry inline style and script, load one same-origin script, and draw data: images. */
const FILE_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const FILE_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};
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

const grants = new Map<string, Grant>();
const fileGrants = new Map<string, FileGrant>();
let listening: Promise<{ server: Server; port: number }> | undefined;

export interface ServeResult {
  url: string;
  run_id: string;
  rows: number;
  /** The run is already approved: the page shows the approved state. */
  approved: boolean;
}

/** Serves `runId`'s page and returns its URL. Every earlier token for the matter stops working. */
export async function servePage(matterRoot: string, runId: string): Promise<ServeResult> {
  const matter = openMatter(matterRoot);
  const runDir = existingRunDir(matter, runId);
  const proposal = requireProposal(runDir, runId, matter.root);
  const newest = newestProposalRun(matter);
  if (newest !== runId) {
    throw new DataServerError(`run ${runId} is not the matter's newest run with a proposal (${newest}); serve that one`, "stale_run");
  }
  const { port } = await ensureListening();
  const key = matter.root.toLowerCase();
  for (const [token, grant] of grants) if (grant.matter.root.toLowerCase() === key) grants.delete(token);
  const token = randomBytes(24).toString("base64url");
  grants.set(token, { matter, runId, runDir });
  return { url: `http://127.0.0.1:${port}/h/${token}/`, run_id: runId, rows: proposal.rows.length, approved: readApproval(runDir, runId).approval !== null };
}

/**
 * Serves `files` (route name -> file name inside `folder`) read-only and returns the base link,
 * `http://127.0.0.1:<port>/p/<token>/`. One token per folder, minted on its first serve and kept
 * for the life of the process: a later serve of the same folder returns the same link.
 */
export async function serveFiles(folder: string, files: Record<string, string>): Promise<string> {
  const { port } = await ensureListening();
  const key = folder.toLowerCase();
  let token = [...fileGrants].find(([, grant]) => grant.folder.toLowerCase() === key)?.[0];
  if (token === undefined) {
    token = randomBytes(24).toString("base64url");
    fileGrants.set(token, { folder, files });
  }
  return `http://127.0.0.1:${port}/p/${token}/`;
}

/** Test seam: stops listening and forgets every token. */
export async function closePageServer(): Promise<void> {
  const current = listening;
  listening = undefined;
  grants.clear();
  fileGrants.clear();
  if (!current) return;
  const { server } = await current;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function ensureListening(): Promise<{ server: Server; port: number }> {
  listening ??= new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      handle(req, res).catch((err) => {
        if (!res.headersSent) send(res, 500, "application/json", JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        else res.destroy();
      });
    });
    // Neither the listener nor a browser's keep-alive socket may hold the process open.
    server.on("connection", (socket) => socket.unref());
    // The server never closes an idle keep-alive socket: with Node's 5 s default, a client could
    // send on it in the instant the server closed it, and the fetch or Approve POST failed (#153).
    // The client closes its own idle sockets, and closePageServer ends any left.
    server.keepAliveTimeout = 0;
    server.once("error", (err) => {
      listening = undefined;
      reject(err);
    });
    server.listen(0, "127.0.0.1", () => {
      server.unref();
      resolve({ server, port: (server.address() as AddressInfo).port });
    });
  });
  return listening;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const p = /^\/p\/([A-Za-z0-9_-]+)\/([^/]+)$/.exec(url.pathname);
  if (p) return servedFile(req, p[1], decodeURIComponent(p[2]), res);
  const m = /^\/h\/([A-Za-z0-9_-]+)(?:\/(approve|file\/([^/]+)))?\/?$/.exec(url.pathname);
  if (!m) return send(res, 404, "text/plain; charset=utf-8", "Not found");
  const grant = grants.get(m[1]);
  const route = m[2] === undefined ? "page" : m[2] === "approve" ? "approve" : "file";
  const method = route === "approve" ? "POST" : "GET";
  if (req.method !== method) return send(res, 405, "text/plain; charset=utf-8", "Method not allowed");
  if (!grant) {
    if (route === "approve") {
      return json(res, 410, { error: "This page is out of date: a newer run has started for this matter, or the Claude session has ended. Nothing was approved." });
    }
    return send(res, 410, "text/html; charset=utf-8", stalePage());
  }
  if (route === "page") return page(grant, res);
  if (route === "approve") return approve(grant, req, res);
  return file(grant, decodeURIComponent(m[3]), res);
}

function page(grant: Grant, res: ServerResponse): void {
  const { proposal, problem } = readProposal(grant.runDir, grant.runId, grant.matter.root);
  if (!proposal) {
    return send(res, 500, "text/html; charset=utf-8", simplePage("The page cannot be shown", `The proposal for this run cannot be read (${problem}). Go back to Claude.`));
  }
  send(res, 200, "text/html; charset=utf-8", renderApprovalPage(proposal, readApproval(grant.runDir, grant.runId).approval));
}

async function approve(grant: Grant, req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: unknown;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    return json(res, 400, { error: `The approval could not be read: ${(err as Error).message}` });
  }
  const posted = body as { run?: unknown; rows?: unknown };
  if (typeof body !== "object" || body === null || posted.run !== grant.runId) {
    return json(res, 400, { error: "The approval does not name this page's run." });
  }
  if (newerRun(grant.matter, grant.runId) !== null) {
    return json(res, 409, { error: "This page is out of date: a newer run has started for this matter. Nothing was approved." });
  }
  const { proposal, problem } = readProposal(grant.runDir, grant.runId, grant.matter.root);
  if (!proposal) {
    return json(res, 500, { error: `The proposal for this run cannot be read (${problem}). Nothing was approved. Go back to Claude.` });
  }
  const v = new Checker();
  validateEntries(v, posted.rows);
  if (v.problems.length) return json(res, 400, { error: `The approval is malformed: ${v.problems.join("; ")}` });
  const known = new Map(proposal.rows.map((r) => [r.row_id, r]));
  const ids = (posted.rows as Array<{ row_id: string }>).map((e) => e.row_id);
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) return json(res, 400, { error: `Unknown rows: ${unknown.join(", ")}. Nothing was approved.` });
  const shown = ids.filter((id) => {
    const kind = known.get(id)?.action?.kind;
    return kind !== undefined && INFORMATION_ONLY.includes(kind);
  });
  if (shown.length) {
    return json(res, 400, { error: `Rows ${shown.join(", ")} are shown for information only and cannot be approved. Nothing was approved.` });
  }

  const path = pathWin32.join(grant.runDir, APPROVAL);
  if (existsSync(path)) return json(res, 409, { error: savedApprovalError(grant) });
  const approval = { run_id: grant.runId, approved_at: new Date().toISOString(), rows: posted.rows };
  try {
    writeNewDurably(path, JSON.stringify(approval, null, 2) + "\n");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return json(res, 409, { error: savedApprovalError(grant) });
    throw err;
  }
  json(res, 200, { ok: true, run_id: grant.runId, rows: (posted.rows as unknown[]).length });
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
  if (!rel) return send(res, 404, "text/plain; charset=utf-8", "No such file on this page");
  let real: string;
  try {
    real = realpathSync.native(pathWin32.join(grant.matter.root, rel));
    if (!statSync(real).isFile()) throw new Error("not a file");
  } catch {
    return send(res, 404, "text/plain; charset=utf-8", "The file is no longer there");
  }
  const inside = pathWin32.relative(grant.matter.root, real);
  if (inside.startsWith("..") || pathWin32.isAbsolute(inside) || zoneProblem("run-files", real)) {
    return send(res, 403, "text/plain; charset=utf-8", "This file is not opened from the page");
  }
  const ext = pathWin32.extname(real).toLowerCase();
  const type = INLINE_TYPES[ext];
  const name = encodeURIComponent(pathWin32.basename(real));
  res.writeHead(200, {
    "Content-Type": type ?? "application/octet-stream",
    "Content-Disposition": `${type ? "inline" : "attachment"}; filename*=UTF-8''${name}`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  });
  createReadStream(real).on("error", () => res.destroy()).pipe(res);
}

/** One of a serveFiles grant's named files, read fresh. The path is the grant's own, never the request's. */
function servedFile(req: IncomingMessage, token: string, name: string, res: ServerResponse): void {
  const grant = fileGrants.get(token);
  if (!grant) {
    return send(res, 404, "text/html; charset=utf-8", simplePage("This link has expired", "It came from an earlier Claude session. Open the current link from the chat."));
  }
  if (req.method !== "GET") return send(res, 405, "text/plain; charset=utf-8", "Method not allowed");
  if (!Object.hasOwn(grant.files, name)) return send(res, 404, "text/plain; charset=utf-8", "Not found");
  const path = pathWin32.join(grant.folder, grant.files[name]);
  try {
    if (!statSync(path).isFile()) throw new Error("not a file");
  } catch {
    return send(res, 404, "text/plain; charset=utf-8", "Not found");
  }
  res.writeHead(200, {
    "Content-Type": FILE_TYPES[pathWin32.extname(path).toLowerCase()] ?? "application/octet-stream",
    "Content-Security-Policy": FILE_CSP,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  createReadStream(path).on("error", () => res.destroy()).pipe(res);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("the request is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  send(res, status, "application/json; charset=utf-8", JSON.stringify(body));
}

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, {
    "Content-Type": type,
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  res.end(body);
}
