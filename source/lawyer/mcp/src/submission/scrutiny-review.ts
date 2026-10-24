// /draft's scrutiny review package: step scrutiny_review of drafting_forms__draft_harness (ADR 0036).
//
// One call assembles what a "Review scrutiny finding: " job presents. The statement and the
// research lawyer's finding come from /drafting-data's statement_for_review.py, which opens the
// drafting database read-only. The authority's own file comes from /matter-data's
// resolve_authority_source.py (case/authority-source.ts), found hash-first and converted to PDF by
// Word into a host-local cache. verify-law's diff_excerpt.py checks the stored excerpt word for word
// against that PDF, and show-me's highlight_pages.py cuts two highlighted extracts, each a PDF plus
// a PNG per page, into <matter>\0. DRAFT\Scrutiny review\statement <id>\, a disposable projection.
//
// This file orchestrates only: no table or column name appears here. The scripts pass data through
// files in a per-call temp folder, removed at the end. Nothing writes the drafting database, and the
// stored excerpt never leaves the server.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { win32 as pathWin32 } from "node:path";

import { authorityPdfCacheDir, resolveAuthoritySource, type AuthoritySource } from "../case/authority-source.js";
import { DataServerError, ValidationError } from "../errors.js";
import { PathOutOfScopeError, resolveWithin } from "../files/scope.js";
import { zoneProblem } from "../files/zones.js";
import { pythonDriverFile } from "../python-driver.js";
import { runPythonDriver } from "../python-spawn.js";
import { READ_TIMEOUT_MS } from "../python-timeout.js";
import { installedPluginLabel, resolveShippedRoot } from "../repo-root.js";
import { publishDraftTarget } from "./publish-host.js";

/** Each highlight or verbatim-check run. */
const CLI_TIMEOUT_MS = 15_000;
/** Past this when a resolver returns, the remaining runs could outlast the Cowork bridge's 60 s. */
const BUDGET_MS = 30_000;
const PRESENTATION_FOLDER = "Scrutiny review";
/** The only names this step writes, and so the only files it deletes. */
const OWN_FILE = /^((proposed )?(1 cited|2 context) - .+\.(pdf|png)|3 finding - .+\.txt)(\.tmp)?$/i;
const PINPOINT_PARAGRAPH = /paras?\.?\s*(\d+)/i;
/** A finding's "para N", "paras N, M", "paras N and M" and "paras N-M" lists. */
const FINDING_PARAS = /\bparas?\.?\s*(\d+(?:\s*(?:,\s*(?:and\s+)?|and\s+|[-–]\s*)\d+)*)/gi;
/** diff_excerpt.py's exit code when the excerpt is not in the source. */
const EXIT_NOT_FOUND = 2;
/** diff_excerpt.py opcodes whose `ours` is a whole excerpt part, or its opening words. */
const PART_TEXT_OPS = new Set(["not_found", "order"]);
const MODEL_ONLY_NOTE = "for the gatekeeper write only; never paste into chat (show-me rule 9)";

// Runs one skill script as a command line and reports its exit code and output, so a non-zero exit
// is data, not an error. With count_pages it also gives that PDF's page count. The script's own
// timeout sits under the spawn's, so the script is killed here, not left holding scratch files.
const CLI_DRIVER = String.raw`
import json, subprocess, sys

request = json.loads(sys.stdin.read())
try:
    done = subprocess.run([sys.executable, request["script"], *request["args"]], capture_output=True,
                          encoding="utf-8", errors="replace", stdin=subprocess.DEVNULL,
                          timeout=request["timeout_s"])
    result = {"exit": done.returncode, "stdout": done.stdout, "stderr": done.stderr}
except subprocess.TimeoutExpired:
    result = {"exit": 1, "stdout": "", "stderr": "timed out"}
if request.get("count_pages"):
    from pypdf import PdfReader
    result["page_count"] = len(PdfReader(request["count_pages"]).pages)
sys.stdout.write(json.dumps(result))
`.trim();

export interface ScrutinyProposal {
  /** A drafting authorities row of the statement's proceeding. */
  authority_id?: number;
  pinpoint?: string;
  /** The start and end words of a new excerpt, cut from the source. */
  span?: { start: string; end: string };
}

export interface ScrutinyReviewArgs {
  step: string;
  matter_root: string;
  db_path?: string;
  statement_id?: number;
  /** Paragraph numbers to paint in the context extract. Omitted, they are derived from the finding. */
  context_paras?: number[];
  /** A file the practitioner named, absolute or relative to the matter folder. */
  source_path?: string;
  proposed?: ScrutinyProposal;
}

interface Authority {
  id: number;
  title: string;
  citation: string | null;
  kind: string;
}

interface StatementRead {
  status: "ok" | "no_excerpt" | "not_found" | "proposed_authority_not_found";
  detail?: string;
  statement: { id: number; proposition: string | null; authority: Authority; pinpoint: string | null; verification: string };
  excerpt: string | null;
  finding: string | null;
  answer_file_named: string | null;
  proposed_authority?: Authority;
}

interface CliResult {
  exit: number;
  stdout: string;
  stderr: string;
  page_count?: number;
}

interface Refusal {
  success: false;
  error: string;
  detail: string;
  [key: string]: unknown;
}

interface Painted {
  spec: string;
  yellow: number;
  yellow_runs?: number;
  orange: number;
  pages: string;
}

interface Extract {
  pdf: string;
  pngs: string[];
  pages: number[];
  painted: Painted[];
}

type CitedExtract = Extract & { crossed_page_break: boolean; margin_band_words: string[]; excerpt_not_painted?: string; para_not_painted?: string };

/** One package, current or proposed: what the response shows and the files to publish. */
interface Package {
  source: Record<string, unknown>;
  /** The source as a PDF: the file itself, or its conversion in the cache. */
  pdf: string;
  verbatim: Record<string, unknown>;
  cited: CitedExtract;
  context: Extract;
  files: { from: string; name: string }[];
  proposedExcerpt: string | null;
}

interface Context {
  env: NodeJS.ProcessEnv;
  installRoot?: string;
  root: string;
  caseData: string;
  folder: string;
  scratch: string;
  sourcePath?: string;
  contextParas: number[];
  /** True when contextParas were derived from the finding rather than given. */
  contextParasDerived: boolean;
  /** Derived paragraphs the highlight script could not find, dropped from the context extract. */
  parasNotFound: Set<number>;
  started: number;
  scripts: { diff: string; highlight: string };
  partial: Record<string, unknown>;
}

/** A resolved source, and the verbatim check of the stored excerpt against it. */
interface Resolved {
  source: Record<string, unknown>;
  pdf: string;
  verbatim?: Record<string, unknown>;
}

interface PackageSpec {
  /** "" for the current package, "proposed " for the proposal. */
  prefix: string;
  authority: Authority;
  paragraph: number | null;
  excerptFile: string;
  span?: { start: string; end: string };
  /** The current package's resolution, reused when the proposal keeps its authority. */
  resolved?: Resolved;
}

/** Runs step scrutiny_review: the review package for one statement of law. */
export function scrutinyReview(args: ScrutinyReviewArgs, env: NodeJS.ProcessEnv = process.env, installRoot?: string): unknown {
  const started = Date.now();
  const input = validated(args);
  const target = publishDraftTarget(args.matter_root, input.dbPath, env);
  const folder = resolveWithin(target.draft, pathWin32.join(PRESENTATION_FOLDER, `statement ${input.statementId}`), "the scrutiny review folder", false);
  const foreign = foreignEntries(folder);
  const sourcePath = input.sourcePath === undefined ? undefined : confineMatterFile(target.root, input.sourcePath, "source_path");
  const scripts = {
    statement: skillScript(["drafting-data", "references", "scripts", "statement_for_review.py"], env, installRoot),
    diff: skillScript(["verify-law", "scripts", "diff_excerpt.py"], env, installRoot),
    highlight: skillScript(["show-me", "scripts", "highlight_pages.py"], env, installRoot),
  };

  const read = runPythonDriver({
    label: "scrutiny review statement read (statement_for_review.py)",
    driver: scripts.statement,
    payload: JSON.stringify({ db_path: input.dbPath, statement_id: input.statementId, proposed_authority_id: input.proposed?.authority_id ?? null }),
    env,
    timeoutMs: READ_TIMEOUT_MS,
    extraEnv: { PYTHONDONTWRITEBYTECODE: "1" },
  }) as StatementRead;
  if (read.status === "not_found") return refusal("statement_not_found", read.detail ?? `no statement ${input.statementId}`);
  if (read.status === "proposed_authority_not_found") return refusal("proposed_authority_not_found", read.detail ?? "");
  if (read.status === "no_excerpt") {
    return refusal("no_excerpt", `statement ${input.statementId} has no stored excerpt, so there is nothing to check against the source.`);
  }
  const statement = { ...read.statement, pinpoint_paragraph: paragraphOf(read.statement.pinpoint) };
  const finding = { text: read.finding, answer_file: answerFile(target.root, read.answer_file_named) };
  const derived = input.contextParas === undefined ? findingParas(read.finding, statement.pinpoint_paragraph) : undefined;

  const scratch = mkdtempSync(pathWin32.join(tmpdir(), "coclerk-scrutiny-"));
  try {
    const excerptFile = pathWin32.join(scratch, "excerpt.txt");
    writeFileSync(excerptFile, read.excerpt ?? "", "utf-8");
    const ctx: Context = {
      env,
      installRoot,
      root: target.root,
      caseData: target.caseData,
      folder,
      scratch,
      sourcePath,
      contextParas: input.contextParas ?? derived ?? [],
      contextParasDerived: derived !== undefined,
      parasNotFound: new Set(),
      started,
      scripts,
      partial: { statement, finding },
    };

    const current = buildPackage(ctx, { prefix: "", authority: statement.authority, paragraph: statement.pinpoint_paragraph, excerptFile });
    if ("success" in current) return current;

    // A finding that names no answer file gets a file of its own, as plain text, beside the extracts.
    let findingFile: string | undefined;
    if (finding.answer_file === null && finding.text !== null) {
      const name = `${pathWin32.basename(current.cited.pdf, ".pdf").replace(/^1 cited/, "3 finding")}.txt`;
      const from = pathWin32.join(scratch, "finding.txt");
      writeFileSync(from, finding.text, "utf-8");
      current.files.push({ from, name });
      findingFile = pathWin32.join(folder, name);
    }

    let proposal: Package | undefined;
    if (input.proposed) {
      const authority = read.proposed_authority ?? statement.authority;
      const built = buildPackage(ctx, {
        prefix: "proposed ",
        authority,
        paragraph: paragraphOf(input.proposed.pinpoint ?? statement.pinpoint),
        excerptFile,
        span: input.proposed.span,
        resolved: authority.id === statement.authority.id ? current : undefined,
      });
      if ("success" in built) return { ...built, detail: `the proposal: ${built.detail}` };
      proposal = built;
    }

    publish(folder, [...current.files, ...(proposal?.files ?? [])]);
    return {
      success: true,
      statement,
      finding: findingFile === undefined ? finding : { ...finding, file: findingFile },
      source: current.source,
      verbatim: current.verbatim,
      extracts: { folder, cited: current.cited, context: current.context },
      ...(derived !== undefined ? { context_paras_derived: derived } : {}),
      ...(ctx.parasNotFound.size > 0 ? { context_paras_not_found: [...ctx.parasNotFound].sort((a, b) => a - b) } : {}),
      ...(foreign.length > 0 ? { foreign_files: foreign } : {}),
      ...(proposal
        ? {
            proposed: {
              source: proposal.source,
              verbatim: proposal.verbatim,
              extracts: { folder, cited: proposal.cited, context: proposal.context },
              model_only: { note: MODEL_ONLY_NOTE, proposed_excerpt: proposal.proposedExcerpt },
            },
          }
        : {}),
      elapsed_ms: Date.now() - started,
    };
  } finally {
    try {
      rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } catch {
      // A scratch file still held open must not mask the call's own result or error.
    }
  }
}

function validated(args: ScrutinyReviewArgs): { dbPath: string; statementId: number; contextParas?: number[]; sourcePath?: string; proposed?: ScrutinyProposal } {
  const field = (key: string) => `drafting_forms__draft_harness.${key}`;
  if (typeof args.db_path !== "string" || args.db_path === "") throw new ValidationError(`${field("db_path")} is required for step scrutiny_review`);
  if (!isPositiveInteger(args.statement_id)) throw new ValidationError(`${field("statement_id")} must be a positive integer for step scrutiny_review`);
  const contextParas = args.context_paras;
  if (contextParas !== undefined && (!Array.isArray(contextParas) || !contextParas.every(isPositiveInteger))) {
    throw new ValidationError(`${field("context_paras")} must be a list of paragraph numbers`);
  }
  if (args.source_path !== undefined && (typeof args.source_path !== "string" || args.source_path === "")) {
    throw new ValidationError(`${field("source_path")} must be a file path`);
  }
  const proposed = args.proposed;
  if (proposed !== undefined) {
    const { authority_id, pinpoint, span } = proposed;
    const valid =
      (authority_id === undefined || isPositiveInteger(authority_id)) &&
      (pinpoint === undefined || (typeof pinpoint === "string" && pinpoint !== "")) &&
      (span === undefined || (typeof span === "object" && span !== null && nonEmpty(span.start) && nonEmpty(span.end))) &&
      (authority_id !== undefined || pinpoint !== undefined || span !== undefined);
    if (!valid) {
      throw new ValidationError(`${field("proposed")} takes at least one of authority_id (an authority id), pinpoint (text) and span ({start, end}, words)`);
    }
  }
  return { dbPath: args.db_path, statementId: args.statement_id as number, contextParas, sourcePath: args.source_path, proposed };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function refusal(error: string, detail: string, extra: Record<string, unknown> = {}): Refusal {
  return { success: false, error, detail, ...extra };
}

/** The first paragraph number a pinpoint names ("para 16", "paras. 16-18"), else null. */
function paragraphOf(pinpoint: string | null): number | null {
  const match = pinpoint === null ? null : PINPOINT_PARAGRAPH.exec(pinpoint);
  return match ? Number(match[1]) : null;
}

/** Every paragraph number the finding cites, ranges expanded, de-duplicated and sorted, less the pinpoint paragraph. */
function findingParas(finding: string | null, pinpoint: number | null): number[] {
  const found = new Set<number>();
  for (const list of (finding ?? "").matchAll(FINDING_PARAS)) {
    for (const [, from, to] of list[1].matchAll(/(\d+)(?:\s*[-–]\s*(\d+))?/g)) {
      const a = Number(from);
      const b = to === undefined ? a : Number(to);
      for (let n = Math.min(a, b); n <= Math.max(a, b); n++) found.add(n);
    }
  }
  if (pinpoint !== null) found.delete(pinpoint);
  return [...found].sort((x, y) => x - y);
}

/** Entries of the statement folder this step did not write. */
function foreignEntries(folder: string): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => !(entry.isFile() && OWN_FILE.test(entry.name)))
    .map((entry) => entry.name);
}

/** A path inside the matter, outside any TRASH, 0. CASE DATA, privileged or disclosed folder. */
function confineMatterFile(root: string, given: string, label: string): string {
  const absolute = pathWin32.isAbsolute(given) ? given : pathWin32.join(root, given);
  let canonical: string;
  try {
    canonical = realpathSync.native(absolute);
  } catch {
    canonical = pathWin32.normalize(absolute);
  }
  const relative = pathWin32.relative(root, canonical);
  if (relative === "" || relative.split(pathWin32.sep)[0] === ".." || pathWin32.isAbsolute(relative)) {
    throw new PathOutOfScopeError(`${label} must lie inside the matter folder ${root}: ${given}`);
  }
  const resolved = resolveWithin(root, relative, label, false);
  if (zoneProblem("write", resolved)) {
    throw new PathOutOfScopeError(`${label} lies in TRASH, 0. CASE DATA or a privileged or disclosed folder: ${given}`);
  }
  return resolved;
}

function answerFile(root: string, named: string | null): { named: string; path: string; exists: boolean } | null {
  if (named === null) return null;
  const path = confineMatterFile(root, named, "the answer file the finding names");
  return { named, path, exists: existsSync(path) };
}

/** A skill's script, install-first, in the shape of draft-harness.ts's writeEmlPath. */
function skillScript(rel: string[], env: NodeJS.ProcessEnv, installRoot?: string): string {
  const shipped = resolveShippedRoot(rel.join("/"), env, { code: "repo_root_missing", subject: `the ${rel[0]} scripts`, installRoot });
  const path = pathWin32.join(shipped.root, ...rel);
  if (!existsSync(path)) {
    throw new DataServerError(
      `${rel[rel.length - 1]} not found at ${path} -- ` +
        (shipped.shipped_from === "install"
          ? `${installedPluginLabel(shipped)}'s bundled skill source lacks it; reinstall the plugin and fully restart`
          : "the installed bundle predates this step, or the repo has moved; reinstall the plugin and fully restart"),
      "repo_root_missing"
    );
  }
  return path;
}

function runCli(ctx: Context, script: string, args: string[], countPages?: string): CliResult {
  return runPythonDriver({
    label: `scrutiny review ${pathWin32.basename(script)}`,
    driver: pythonDriverFile("scrutiny-review-cli-driver", CLI_DRIVER),
    payload: JSON.stringify({ script, args, count_pages: countPages ?? null, timeout_s: (CLI_TIMEOUT_MS - 2_000) / 1000 }),
    env: ctx.env,
    timeoutMs: CLI_TIMEOUT_MS,
    extraEnv: { PYTHONDONTWRITEBYTECODE: "1" },
  }) as CliResult;
}

/** Resolves, checks and cuts one package. A refusal is returned, never thrown. */
function buildPackage(ctx: Context, spec: PackageSpec): Package | Refusal {
  const resolved = spec.resolved ?? resolve(ctx, spec.authority);
  if ("success" in resolved) return resolved;
  const { source, pdf } = resolved;

  const proposedFile = pathWin32.join(ctx.scratch, "proposed.txt");
  let verbatim = spec.span ? undefined : resolved.verbatim ?? verbatimCheck(ctx, spec.excerptFile, pdf);
  const cited = citedExtract(ctx, spec, pdf, proposedFile);
  if ("success" in cited) return cited;
  if (spec.span) verbatim = verbatimCheck(ctx, proposedFile, pdf);
  const context = contextExtract(ctx, spec, pdf, cited, spec.span ? proposedFile : spec.excerptFile);
  if ("success" in context) return context;

  return {
    source,
    pdf,
    verbatim: verbatim as Record<string, unknown>,
    cited: cited.extract,
    context: context.extract,
    files: [...cited.files, ...context.files],
    proposedExcerpt: spec.span ? readFileSync(proposedFile, "utf-8").replace(/\r?\n$/, "") : null,
  };
}

function resolve(ctx: Context, authority: Authority): Resolved | Refusal {
  const found: AuthoritySource = resolveAuthoritySource(
    { caseDataDir: ctx.caseData, matterRoot: ctx.root, citation: authority.citation ?? "", sourcePath: ctx.sourcePath, cacheDir: authorityPdfCacheDir(ctx.env) },
    ctx.env,
    ctx.installRoot
  );
  const cite = `${authority.title}${authority.citation ? `, ${authority.citation}` : ""}`;
  if (found.status === "authority_ambiguous") {
    return refusal("authority_ambiguous", `more than one stored authority matches ${cite}`, { candidates: found.candidates });
  }
  if (found.status === "unresolved") {
    const source = {
      tried: found.tried,
      searched: found.searched,
      search_truncated: found.search_truncated,
      skipped_cloud_only: found.skipped_cloud_only,
      unreadable: found.unreadable,
    };
    return refusal("source_unresolved", `${cite}: ${found.reason}`, { partial: { ...ctx.partial, source } });
  }
  if (found.status !== "ok") return refusal(found.status, `${cite}: ${found.detail}`);
  // The converted PDF's cache path stays the server's own business.
  const { status: _status, pdf, ...source } = found;
  if (Date.now() - ctx.started > BUDGET_MS) {
    return refusal("budget_exceeded", "the converted source is cached; call again", { partial: { ...ctx.partial, source } });
  }
  return { source, pdf };
}

/**
 * diff_excerpt.py's JSON without the source passage text or the stored excerpt's text, plus its exit
 * code. A not_found or order opcode carries a whole excerpt part, or its opening words, as `ours`, and
 * so does every opcode of an excerpt or part the source does not hold; each of those gives its word
 * count as `ours_words` instead. Word-level opcodes of a found excerpt stay as they are.
 */
function verbatimCheck(ctx: Context, excerptFile: string, pdf: string): Record<string, unknown> {
  const run = runCli(ctx, ctx.scripts.diff, ["--excerpt-file", excerptFile, "--source", pdf]);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(run.stdout) as Record<string, unknown>;
  } catch {
    return { exit: run.exit, error: run.stderr.trim() };
  }
  const { source_window: _window, parts, opcodes, ...rest } = parsed;
  const missing = new Set((opcodes as Opcode[]).filter((op) => op.op === "not_found").map((op) => op.part));
  const strippedParts = Array.isArray(parts)
    ? parts.map((part) => {
        const { source_window: _partWindow, opcodes: partOpcodes, ...kept } = part as Record<string, unknown>;
        return { ...kept, opcodes: withheld(partOpcodes as Opcode[], missing.has(kept.index)) };
      })
    : parts;
  return { exit: run.exit, ...rest, opcodes: withheld(opcodes as Opcode[], run.exit === EXIT_NOT_FOUND), parts: strippedParts };
}

interface Opcode {
  op: string;
  part?: unknown;
  ours: string;
  [key: string]: unknown;
}

/** The opcodes with `ours` replaced by its word count where it would carry the excerpt's text. */
function withheld(opcodes: Opcode[], all: boolean): Opcode[] {
  return opcodes.map((op) => {
    if (!all && !PART_TEXT_OPS.has(op.op)) return op;
    return { ...op, ours: "", ours_words: op.ours.split(/\s+/).filter((word) => word !== "" && word !== "...").length };
  });
}

interface Cut {
  extract: CitedExtract;
  files: { from: string; name: string }[];
  firstPage: number;
  lastPage: number;
  pageCount: number;
}

function citedExtract(ctx: Context, spec: PackageSpec, pdf: string, proposedFile: string): Cut | Refusal {
  const dir = pathWin32.join(ctx.scratch, `${spec.prefix}cited`);
  const base = [pdf, "--out", pathWin32.join(dir, "extract.pdf"), "--preview", dir];
  const excerpt = ["--excerpt", spec.excerptFile];
  const para = spec.paragraph === null ? [] : ["--para", String(spec.paragraph), "yellow"];
  const span = spec.span ? ["--span", spec.span.start, spec.span.end, "yellow", "--excerpt-out", proposedFile] : [];

  let run = runCli(ctx, ctx.scripts.highlight, [...base, ...excerpt, ...para, ...span], pdf);
  const pageCount = run.page_count ?? 0;
  let excerptNotPainted: string | undefined;
  let paraNotPainted: string | undefined;
  if (run.exit !== 0) {
    const failed = failedSpecs(run.stdout);
    if (failed.size === 1 && failed.has("excerpt") && para.length + span.length > 0) {
      excerptNotPainted = failed.get("excerpt");
      run = runCli(ctx, ctx.scripts.highlight, [...base, ...para, ...span]);
    } else if (failed.size === 1 && para.length > 0 && failed.has(`para ${spec.paragraph} yellow`)) {
      paraNotPainted = failed.get(`para ${spec.paragraph} yellow`);
      run = runCli(ctx, ctx.scripts.highlight, [...base, ...excerpt, ...span]);
    }
    if (run.exit !== 0) return refusal("highlight_failed", `cited extract: ${outputOf(run)}`);
  }

  const pages = writtenPages(run.stdout);
  const painted = paintedSpecs(run.stdout);
  const stem =
    `${spec.prefix}1 cited - ${pathSafe(spec.authority.title)} - p${pages[0]}${pages.length > 1 ? `-${pages[pages.length - 1]}` : ""}` +
    (spec.paragraph !== null && paraNotPainted === undefined ? ` para ${spec.paragraph}` : "");
  const { extract, files } = extractFiles(ctx, dir, stem, run.stdout, pages, painted);
  return {
    extract: {
      ...extract,
      crossed_page_break: /, crossed page break(,|$)/m.test(run.stdout),
      margin_band_words: [...run.stdout.matchAll(/, margin band: (.*)$/gm)].flatMap((m) => m[1].split(" ")),
      ...(excerptNotPainted === undefined ? {} : { excerpt_not_painted: excerptNotPainted }),
      ...(paraNotPainted === undefined ? {} : { para_not_painted: paraNotPainted }),
    },
    files,
    firstPage: pages[0],
    lastPage: pages[pages.length - 1],
    pageCount,
  };
}

// A context_paras paragraph off the cited pages and their neighbours fails the windowed run, so the
// run is repeated once without --pages and covers the pages the specs land on (`widened: true`).
// When that fails too and the paragraphs were derived from the finding, which may cite another
// case's paragraphs, each paragraph the script reports FAILED (absent, or its marker ambiguous) is
// dropped and recorded in ctx.parasNotFound, and the run is repeated once more with the rest, or,
// with none left, as a run with no context_paras. When a run on the pinpoint paragraph alone fails
// on that paragraph only, it is repeated in the same window painting the excerpt instead, and the
// extract carries the script's reason as para_not_painted.
function contextExtract(ctx: Context, spec: PackageSpec, pdf: string, cited: Cut, excerptFile: string): { extract: Extract & { widened?: true; para_not_painted?: string }; files: { from: string; name: string }[] } | Refusal {
  const dir = pathWin32.join(ctx.scratch, `${spec.prefix}context`);
  const first = Math.max(1, cited.firstPage - 1);
  const last = Math.min(cited.pageCount || cited.lastPage, cited.lastPage + 1);
  const fallback = spec.paragraph === null ? [] : [spec.paragraph];
  const out = (paras: number[]) => [
    "--out",
    pathWin32.join(dir, "extract.pdf"),
    "--preview",
    dir,
    ...(paras.length > 0 ? paras.flatMap((n) => ["--para", String(n), "yellow"]) : ["--excerpt", excerptFile]),
  ];
  const windowed = (paras: number[]) => runCli(ctx, ctx.scripts.highlight, [pdf, "--pages", `${first}-${last}`, ...out(paras)]);
  let usedFallback = ctx.contextParas.length === 0;
  let run = windowed(ctx.contextParas.length > 0 ? ctx.contextParas : fallback);
  let widened = false;
  if (run.exit !== 0 && ctx.contextParas.length > 0) {
    run = runCli(ctx, ctx.scripts.highlight, [pdf, ...out(ctx.contextParas)]);
    widened = true;
    if (run.exit !== 0 && ctx.contextParasDerived) {
      const failed = failedSpecs(run.stdout);
      const missing = ctx.contextParas.filter((n) => failed.has(`para ${n} yellow`));
      if (missing.length > 0) {
        for (const n of missing) ctx.parasNotFound.add(n);
        const rest = ctx.contextParas.filter((n) => !missing.includes(n));
        usedFallback = rest.length === 0;
        run = rest.length > 0 ? runCli(ctx, ctx.scripts.highlight, [pdf, ...out(rest)]) : windowed(fallback);
        widened = rest.length > 0;
      }
    }
  }
  let paraNotPainted: string | undefined;
  if (run.exit !== 0 && usedFallback && fallback.length > 0) {
    const failed = failedSpecs(run.stdout);
    if (failed.size === 1 && failed.has(`para ${spec.paragraph} yellow`)) {
      paraNotPainted = failed.get(`para ${spec.paragraph} yellow`);
      run = windowed([]);
    }
  }
  if (run.exit !== 0) return refusal("highlight_failed", `context extract: ${outputOf(run)}`);
  const pages = writtenPages(run.stdout);
  const stem = `${spec.prefix}2 context - ${pathSafe(spec.authority.title)} - pp${pages[0]}-${pages[pages.length - 1]}`;
  const { extract, files } = extractFiles(ctx, dir, stem, run.stdout, pages, paintedSpecs(run.stdout));
  return {
    extract: {
      ...extract,
      ...(widened ? { widened: true as const } : {}),
      ...(paraNotPainted === undefined ? {} : { para_not_painted: paraNotPainted }),
    },
    files,
  };
}

/** The extract's final paths in the statement folder, and the scratch files to publish there. */
function extractFiles(ctx: Context, dir: string, stem: string, stdout: string, pages: number[], painted: Painted[]): { extract: Extract; files: { from: string; name: string }[] } {
  const files = [{ from: pathWin32.join(dir, "extract.pdf"), name: `${stem}.pdf` }];
  for (const match of stdout.matchAll(/^preview: (.*-p(\d+)\.png)$/gm)) {
    files.push({ from: match[1], name: `${stem}-p${match[2]}.png` });
  }
  const at = (name: string) => pathWin32.join(ctx.folder, name);
  return { extract: { pdf: at(files[0].name), pngs: files.slice(1).map((f) => at(f.name)), pages, painted }, files };
}

/** Spec label -> reason, for each spec the script reports FAILED. */
function failedSpecs(stdout: string): Map<string, string> {
  const failed = new Map<string, string>();
  for (const match of stdout.matchAll(/^(excerpt|para \d+ \w+|span .*?): FAILED, (.*)$/gm)) failed.set(match[1], match[2]);
  return failed;
}

function paintedSpecs(stdout: string): Painted[] {
  const painted: Painted[] = [];
  for (const match of stdout.matchAll(/^(excerpt|para \d+ \w+|span .*?): found, (.*)$/gm)) {
    const counts = match[2];
    const excerpt = /^(\d+) tokens painted yellow in (\d+) runs, (\d+) tokens painted orange, pages (\S+?)(,|$)/.exec(counts);
    if (excerpt) {
      painted.push({ spec: match[1], yellow: Number(excerpt[1]), yellow_runs: Number(excerpt[2]), orange: Number(excerpt[3]), pages: excerpt[4] });
      continue;
    }
    const single = /^(\d+) tokens painted (yellow|orange), pages (\S+?)(,|$)/.exec(counts);
    if (single) {
      painted.push({ spec: match[1], yellow: single[2] === "yellow" ? Number(single[1]) : 0, orange: single[2] === "orange" ? Number(single[1]) : 0, pages: single[3] });
    }
  }
  return painted;
}

/** The source pages the script wrote, first to last. */
function writtenPages(stdout: string): number[] {
  const match = /^written: .* \(source pages (\d+)-(\d+)\)$/m.exec(stdout);
  if (!match) throw new DataServerError(`highlight_pages.py reported no pages written: ${stdout.trim()}`);
  const pages: number[] = [];
  for (let n = Number(match[1]); n <= Number(match[2]); n++) pages.push(n);
  return pages;
}

function outputOf(run: CliResult): string {
  return [run.stdout.trim(), run.stderr.trim()].filter(Boolean).join("\n");
}

/** forms.ts's sanitizeForPath: the characters a Windows file name cannot hold become "_". */
function pathSafe(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim();
}

/** Replaces this step's own files in the statement folder, each written through a temp name. */
function publish(folder: string, files: { from: string; name: string }[]): void {
  mkdirSync(folder, { recursive: true });
  for (const entry of readdirSync(folder)) {
    if (OWN_FILE.test(entry)) unlinkSync(pathWin32.join(folder, entry));
  }
  for (const file of files) {
    const final = pathWin32.join(folder, file.name);
    copyFileSync(file.from, `${final}.tmp`);
    renameSync(`${final}.tmp`, final);
  }
}
