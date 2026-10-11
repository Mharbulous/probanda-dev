// Single resolution of the Coclerk repo root for every surface that needs it:
// the skills tree (files/skill-source.ts), the docs tree (files/repo-docs.ts),
// and the migration engines in the skills tree (below).
//
// Skill source is resolved install-first (#1002), by resolveShippedRoot() below.
// The litigation .plugin ships each roster skill's full source tree under
// `skills/` plus `skills/shared/` (native trees, #1266), so an installed plugin
// serves those folders -- skill_source__read/list and the three
// *MigrateScriptsDir resolvers -- with no checkout at all. Only a path whose first segment the install does not bundle
// falls through to the checkout chain described next. repo_docs__write and
// build-stamp.ts's outdated check stay on the chain alone.
//
// Nothing is baked at build time any more. A baked root is a per-build-machine
// literal in a tracked artifact: it churned the bundle on every rebuild and,
// on 2026-08-06, made every skill_source__*, repo_docs__write and
// application_* call fail outright on a second machine whose username differs
// from the one that last built the bundle.
//
// Resolution chain, first hit wins. Steps 1 and 3 are STATEMENTS -- a human
// said where the repo is -- so they are honoured verbatim, never
// marker-validated, and a bad value fails loudly downstream naming the path.
// Steps 2 and 4 are GUESSES -- marker-validated, and fall through silently on
// a miss. Never marker-validate a statement: several tests deliberately point
// COCLERK_REPO_ROOT at a tmpdir that does not hold the marker (e.g. a fixture
// with only .claude/skills, no source/ or plugins/), and that must keep working.
//
//   1. COCLERK_REPO_ROOT env var (explicit override).
//   2. Marker walk-up from this module's own location. Covers dev runs, the
//      tsc build/ output, and the test suite. In a packaged .plugin install
//      (extracted under an app-data session directory, no .git or
//      .claude/skills anywhere above it -- confirmed by inspection) this
//      correctly finds nothing and falls through.
//   3. %APPDATA%\Coclerk\coclerk.json -> optional "repo_root" key. Per-device
//      config that already exists for this purpose (see
//      practice/backend.ts's "case_data_root", which this mirrors).
//   4. Marker-validated probe of the conventional checkout location,
//      %USERPROFILE%\Git\Coclerk.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
// Platform-default `path`, deliberately NOT `path.win32`. This module handles
// only real, native, absolute HOST paths (import.meta.url, %APPDATA%,
// %USERPROFILE%) -- files/scope.ts's win32 grammar is for caller-supplied
// relative paths and must not be reused here.
import { dirname, join, resolve, win32 as pathWin32 } from "node:path";
import { fileURLToPath } from "node:url";

import { configPath } from "./config-path.js";
import { DataServerError } from "./errors.js";

/** A dir is a repo root iff it holds SKILLS_MARKER and at least one of CHECKOUT_MARKERS, as directories:
 *  `source/probanda/mcp` marks a probanda checkout, `plugins/dev-tools` a CoClerk checkout. */
const SKILLS_MARKER = join(".claude", "skills");
const CHECKOUT_MARKERS = [join("source", "probanda", "mcp"), join("plugins", "dev-tools")] as const;

const SELF_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * The installed plugin's root: two levels above the running bundle's own dir,
 * since the bundle lives at `<install>/mcp/dist/litigation-mcp.js`. In the repo
 * the same arithmetic, from `mcp/dist/` or the tsc `mcp/build/`, gives
 * `source/probanda/`, which has no `skills/shared/` -- so dev runs and the test
 * suite fall through to the checkout chain unchanged.
 */
export const INSTALL_ROOT = resolve(SELF_DIR, "..", "..");

/** `<install>/skills` iff this is a packaged install: only the payload builder writes `skills/shared/`,
 *  so a checkout's `source/probanda/` (no such dir) and a stale worktree's stub `skills/<name>/`
 *  dirs (no `shared/`) never count. Never key off `skills/` alone. */
function installSkillsRoot(installRoot: string): string | undefined {
  const dir = join(installRoot, "skills");
  return isDirectory(join(dir, "shared")) ? dir : undefined;
}

const AUTODETECT_OFF = new Set(["0", "false", "no", "off"]);

export type RepoRootCode = "repo_root_missing" | "skills_root_missing" | "docs_root_missing";

export interface RepoRootRequest {
  /** Failure code -- preserves each surface's existing, test-asserted code. */
  code: RepoRootCode;
  /** Named in the failure message: "the skills tree", "the docs tree", ... */
  subject: string;
  /** Test seam only: where the walk-up starts. Defaults to this module's dir. */
  startDir?: string;
}

/** Resolved lazily, per call -- never at startup. See files/skill-source.ts's
 * header comment for why: a missing root must surface as a clear per-call
 * error, not a zero-tools startup crash. */
export function resolveRepoRoot(
  env: NodeJS.ProcessEnv = process.env,
  request: RepoRootRequest
): string {
  if (env.COCLERK_REPO_ROOT) return env.COCLERK_REPO_ROOT;

  const found = autoDetect(env, request.startDir ?? SELF_DIR);
  if (found.root) return found.root;

  throw new DataServerError(missingMessage(request.subject, env, found.tried), request.code);
}

interface AutoDetectResult {
  root?: string;
  tried: string[];
}

/** Positive results only -- a cached negative would survive the user creating
 * coclerk.json a moment later. Keyed on everything a result could depend on. */
const cache = new Map<string, string>();

function autoDetect(env: NodeJS.ProcessEnv, startDir: string): AutoDetectResult {
  const tried: string[] = [];

  const flag = env.COCLERK_REPO_ROOT_AUTODETECT;
  if (typeof flag === "string" && AUTODETECT_OFF.has(flag.trim().toLowerCase())) {
    tried.push(`auto-detection disabled by COCLERK_REPO_ROOT_AUTODETECT=${flag}`);
    return { tried };
  }

  const cacheKey = `${startDir}\0${env.APPDATA ?? ""}\0${env.USERPROFILE ?? ""}\0${env.HOME ?? ""}\0${env.COCLERK_CONFIG_PATH ?? ""}`;
  const cached = cache.get(cacheKey);
  if (cached) return { root: cached, tried };

  const walked = walkUp(startDir);
  if (walked) return remember(cacheKey, walked, tried);
  tried.push(`walk-up from ${startDir} -- no ancestor holds ${SKILLS_MARKER} with ${CHECKOUT_MARKERS.join(" or ")}`);

  const cfgPath = configPath(env);
  const declared = readConfigRepoRoot(cfgPath, tried);
  if (declared) return remember(cacheKey, declared, tried);

  const probes = conventionalCandidates(env);
  for (const probe of probes) {
    if (isRepoRoot(probe)) return remember(cacheKey, probe, tried);
  }
  tried.push(
    probes.length
      ? `conventional location${probes.length > 1 ? "s" : ""} (${probes.join(", ")}) -- no match`
      : "conventional location -- neither USERPROFILE nor HOME is set"
  );

  return { tried };
}

function remember(cacheKey: string, root: string, tried: string[]): AutoDetectResult {
  cache.set(cacheKey, root);
  return { root, tried };
}

function isRepoRoot(dir: string): boolean {
  return isDirectory(join(dir, SKILLS_MARKER)) && CHECKOUT_MARKERS.some((marker) => isDirectory(join(dir, marker)));
}

function walkUp(startDir: string): string | undefined {
  let cursor = resolve(startDir);
  for (;;) {
    if (isRepoRoot(cursor)) return cursor;
    const parent = dirname(cursor);
    if (parent === cursor) return undefined;
    cursor = parent;
  }
}

function readConfigRepoRoot(cfgPath: string, tried: string[]): string | undefined {
  if (!existsSync(cfgPath)) {
    tried.push(`"repo_root" in ${cfgPath} -- file not found`);
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(cfgPath, "utf-8"));
  } catch (err) {
    tried.push(`"repo_root" in ${cfgPath} -- not valid JSON (${(err as Error).message})`);
    return undefined;
  }
  const value = (parsed as Record<string, unknown> | null)?.repo_root;
  if (typeof value === "string" && value !== "") return value;
  tried.push(`"repo_root" in ${cfgPath} -- key absent or empty`);
  return undefined;
}

function conventionalCandidates(env: NodeJS.ProcessEnv): string[] {
  const home = env.USERPROFILE || env.HOME || homedir();
  return home ? [join(home, "Git", "Coclerk")] : [];
}

export type ShippedFrom = "install" | "checkout";

export interface ShippedRoot {
  /** `<install>/skills` (native trees, #1266), or `<checkout>/.claude/skills` -- same relative layout. */
  root: string;
  shipped_from: ShippedFrom;
}

export interface ShippedRootRequest {
  /** Failure code when the path needs a checkout and none resolves. Default `skills_root_missing`. */
  code?: RepoRootCode;
  /** Named in that failure message. Default "the skills tree". */
  subject?: string;
  /** Test seam only: the install root. Defaults to two levels above this module's dir. */
  installRoot?: string;
}

/** The skill folders this install bundles, read from disk at call time -- never baked in. */
export function bundledSkillFolders(installRoot: string = INSTALL_ROOT): string[] {
  const dir = installSkillsRoot(installRoot);
  if (!dir) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * The running plugin's version, from `.claude-plugin/plugin.json` beside the
 * install root; null when it cannot be read. Read at call time only: a read
 * outside dist/ at startup is the zero-tools crash plugins/CLAUDE.md warns of.
 */
export function pluginVersion(installRoot: string = INSTALL_ROOT): string | null {
  try {
    const manifest = JSON.parse(readFileSync(join(installRoot, ".claude-plugin", "plugin.json"), "utf-8"));
    return typeof manifest?.version === "string" ? manifest.version : null;
  } catch {
    return null;
  }
}

/**
 * Which tree serves a skills-tree-relative path, decided by its FIRST SEGMENT
 * alone, never by whether the file exists. If `<install>/skills/<segment>/` exists
 * on a packaged install (`skills/shared/` present, native trees #1266), the install serves the path -- always, even when COCLERK_REPO_ROOT is set
 * and even when only the checkout has the file, so a file missing from a bundled
 * skill fails visibly instead of silently reading other bytes. Any other segment
 * falls back to a checkout found by resolveRepoRoot's chain; with none, the
 * chain's failure (default code `skills_root_missing`, never `not_found`, which a
 * wrapper retries forever) gains one line naming the roster the install holds.
 *
 * Confinement is the caller's job: this picks a root, and files/scope.ts's
 * assertRelativeSyntax/resolveWithin still bound every path served from it.
 */
export function resolveShippedRoot(
  relPath: string,
  env: NodeJS.ProcessEnv = process.env,
  request: ShippedRootRequest = {}
): ShippedRoot {
  const installRoot = request.installRoot ?? INSTALL_ROOT;
  const bundle = installSkillsRoot(installRoot);
  const segment = relPath.split(/[\\/]/)[0];
  // `.` and `..` name real directories (the bundle itself, the install root),
  // and a drive-qualified segment is not a folder name at all.
  if (bundle !== undefined && segment !== "" && segment !== "." && segment !== ".." && !segment.includes(":") && isDirectory(join(bundle, segment))) {
    return { root: bundle, shipped_from: "install" };
  }

  const code = request.code ?? "skills_root_missing";
  try {
    const repoRoot = resolveRepoRoot(env, { code, subject: request.subject ?? "the skills tree" });
    return { root: join(repoRoot, ".claude", "skills"), shipped_from: "checkout" };
  } catch (err) {
    if (!(err instanceof DataServerError) || err.code !== code) throw err;
    throw new DataServerError(`${err.message}\n\n${rosterLine(installRoot, segment)}`, code);
  }
}

function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function rosterLine(installRoot: string, segment: string): string {
  const bundled = bundledSkillFolders(installRoot);
  if (bundled.length === 0) {
    return `This plugin bundles no skill source (${join(installRoot, "skills", "shared")} not found), so every skill needs a Coclerk checkout.`;
  }
  return (
    `This installed plugin bundles skill source for: ${bundled.join(", ")}. ` +
    `${segment ? `"${segment}"` : "This path"} is not among them, so it needs a Coclerk checkout.`
  );
}

/**
 * `.claude/skills/case-data/references/scripts/` -- owns migrate_engine.py.
 *
 * Deliberately NOT the sibling `scripts/` dir: migrate_engine.py imports
 * `rebuild` and `resolve_paths`, which are bare sibling imports resolvable only
 * from here, and it reads migrations.sql/triggers.sql/queries.sql through
 * rebuild.read_ref(), which resolves `../` from rebuild.py's own __file__. One
 * PYTHONPATH entry, no sys.path munging.
 *
 * Served install-first (resolveShippedRoot): an install bundles case-data, so
 * it needs no checkout. `installRoot` is the same test seam.
 */
export function caseDataMigrateScriptsDir(env?: NodeJS.ProcessEnv, installRoot?: string): string {
  return migrateScriptsDir("case-data", env, installRoot);
}

/**
 * `.claude/skills/timecamping-data/references/scripts/` -- owns migrate_engine.py.
 *
 * Mirrors caseDataMigrateScriptsDir exactly, one directory over: the
 * /timecamping-data gatekeeper skill's migration engine, resolved the same
 * lazy, per-call way for the same reason (a missing root must surface as a
 * clear per-call error, not a zero-tools startup crash).
 */
export function timecampingDataMigrateScriptsDir(env?: NodeJS.ProcessEnv, installRoot?: string): string {
  return migrateScriptsDir("timecamping-data", env, installRoot);
}

/**
 * `.claude/skills/drafting-data/references/scripts/` -- owns migrate_engine.py.
 *
 * Same shape as the two above: the /drafting-data gatekeeper skill's
 * migration chain, schema, and every migration SQL statement stay in the
 * skills tree (issue 291 §6/§7), never embedded in this bundle -- only this
 * resolver and the thin driver in submission/migrate.ts are.
 */
export function submissionDataMigrateScriptsDir(env?: NodeJS.ProcessEnv, installRoot?: string): string {
  return migrateScriptsDir("drafting-data", env, installRoot);
}

/** `<skill>/references/scripts/`, install-first. Keeps the `repo_root_missing` code these resolvers always threw. */
function migrateScriptsDir(skill: string, env: NodeJS.ProcessEnv | undefined, installRoot: string | undefined): string {
  const shipped = resolveShippedRoot(`${skill}/references/scripts/migrate_engine.py`, env ?? process.env, {
    code: "repo_root_missing",
    subject: `the ${skill} maintenance scripts`,
    installRoot,
  });
  const dir = pathWin32.join(shipped.root, skill, "references", "scripts");
  if (!existsSync(pathWin32.join(dir, "migrate_engine.py"))) {
    throw new DataServerError(
      `migrate_engine.py not found under ${dir} -- ` +
        (shipped.shipped_from === "install"
          ? "this installed plugin's bundled skill source lacks it; reinstall the plugin and fully restart"
          : "the installed bundle predates this phase, or the repo has moved; reinstall the plugin and fully restart"),
      "repo_root_missing"
    );
  }
  return dir;
}

function missingMessage(subject: string, env: NodeJS.ProcessEnv, tried: string[]): string {
  const cfg = configPath(env);
  return [
    `cannot locate the Coclerk repo, which ${subject} lives in.`,
    "",
    "Tried, in order:",
    `  1. COCLERK_REPO_ROOT environment variable -- ${
      env.COCLERK_REPO_ROOT === "" ? "set but empty" : "not set"
    }`,
    ...tried.map((t, i) => `  ${i + 2}. ${t}`),
    "",
    "Fix either one, then fully restart the app (a restart alone is enough; no reinstall needed):",
    "  - set COCLERK_REPO_ROOT to your Coclerk checkout, or",
    `  - add a "repo_root" key to ${cfg}, set to the path of your Coclerk checkout`,
    '    (create the file if it does not exist; it may already hold "case_data_root").',
  ].join("\n");
}
