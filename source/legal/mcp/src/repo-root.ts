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
// Between the two sits the sibling lookup (four-plugin split, decision 1): a
// packaged install also serves a folder held by a `researcher`, `litigator` or
// `solicitor` plugin installed beside it. See siblingInstalls() below.
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
//   3. %APPDATA%\Coclerk\probanda.json -> optional "repo_root" key. Per-device
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
import { basename, dirname, join, resolve, win32 as pathWin32 } from "node:path";
import { fileURLToPath } from "node:url";

import { configPath } from "./config-path.js";
import { DataServerError } from "./errors.js";

/** A dir is a repo root iff it holds SKILLS_MARKER and at least one of CHECKOUT_MARKERS, as directories:
 *  `source/legal/mcp` marks a Probanda checkout, `plugins/dev-tools` a CoClerk checkout. */
const SKILLS_MARKER = join(".claude", "skills");
const CHECKOUT_MARKERS = [join("source", "legal", "mcp"), join("plugins", "dev-tools")] as const;

const SELF_DIR = dirname(fileURLToPath(import.meta.url));

/**
 * The installed plugin's root: two levels above the running bundle's own dir,
 * since the bundle lives at `<install>/mcp/dist/litigation-mcp.js`. In the repo
 * the same arithmetic, from `mcp/dist/` or the tsc `mcp/build/`, gives
 * `source/legal/`, which has no `skills/shared/` -- so dev runs and the test
 * suite fall through to the checkout chain unchanged.
 */
export const INSTALL_ROOT = resolve(SELF_DIR, "..", "..");

/** `<install>/skills` iff this is a packaged install: only the payload builder writes `skills/shared/`,
 *  so a checkout's `source/legal/` (no such dir) and a stale worktree's stub `skills/<name>/`
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
 * probanda.json a moment later. Keyed on everything a result could depend on. */
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
  /** `install` for this plugin's own install and for a sibling's alike; `plugin` tells them apart. */
  shipped_from: ShippedFrom;
  /** The plugin the root belongs to, from its manifest: `name` and `version`. Both null for a checkout. */
  plugin: string | null;
  plugin_version: string | null;
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
  return pluginManifest(installRoot).version;
}

/** `name` and `version` from an install's `.claude-plugin/plugin.json`; each null when it cannot be read. */
export function pluginManifest(installRoot: string): { name: string | null; version: string | null } {
  try {
    const manifest = JSON.parse(readFileSync(join(installRoot, ".claude-plugin", "plugin.json"), "utf-8"));
    return {
      name: typeof manifest?.name === "string" ? manifest.name : null,
      version: typeof manifest?.version === "string" ? manifest.version : null,
    };
  } catch {
    return { name: null, version: null };
  }
}

/** The only plugins whose installs may serve skill source beside this one, in lookup order. Any other
 *  manifest name is ignored, so a stale `probanda` left beside them can never serve a file. */
const SIBLING_PLUGINS = ["legal", "researcher", "litigator", "solicitor", "file-manager", "timekeeper"];

export interface SiblingInstall {
  /** The manifest `name`, never the folder name: a host may name the folder `plugin_<id>`. */
  name: string;
  version: string | null;
  installRoot: string;
  /** `<installRoot>/skills`. */
  skills: string;
}

/**
 * The sibling plugins installed beside this one, one per name. Candidates are the
 * folders beside the install root, and the folders two levels up (the
 * `claude plugin install` layout, `<marketplace>/<plugin>/<version>/`). Two levels
 * up is scanned only when the install root's folder is named after its own
 * manifest version, which marks that layout: in the desktop app's store two levels
 * up is the account folder, where the scan visited about 1,500 folders and took
 * 0.4 to 1 second on 2026-10-13. A folder
 * whose name starts with `.` is skipped at either level (`.staging/`). A candidate
 * counts only if its manifest parses with a name in SIBLING_PLUGINS and it holds
 * `skills/shared/`. When one name has several copies, the highest manifest
 * version wins, then the highest `~g<N>` folder suffix, then the newest change time.
 *
 * Scanned only from a packaged install. In a checkout or the test suite the own
 * root has no `skills/shared/`, so nothing is scanned: after the cutover the
 * repo's built `plugins/researcher/` would otherwise be picked up from
 * `source/legal/`, and a dev run would read built copies instead of source.
 *
 * Never cached: a host replaces these folders when it syncs, and the scan is a few
 * `readdir` calls and small JSON reads.
 */
export function siblingInstalls(installRoot: string = INSTALL_ROOT): SiblingInstall[] {
  if (installSkillsRoot(installRoot) === undefined) return [];
  const own = resolve(installRoot);
  const parent = dirname(own);
  const candidates = new Set(childDirs(parent));
  if (basename(own) === pluginManifest(own).version) {
    for (const branch of childDirs(dirname(parent))) {
      for (const dir of childDirs(branch)) candidates.add(dir);
    }
  }
  candidates.delete(own);

  const winners = new Map<string, { sibling: SiblingInstall; rank: number[][] }>();
  for (const dir of candidates) {
    const manifest = pluginManifest(dir);
    if (manifest.name === null || !SIBLING_PLUGINS.includes(manifest.name)) continue;
    const skills = installSkillsRoot(dir);
    if (skills === undefined) continue;
    const rank = [
      (manifest.version ?? "").split(".").map((part) => Number.parseInt(part, 10) || 0),
      [Number(/~g(\d+)$/.exec(basename(dir))?.[1] ?? 0)],
      [modifiedMs(dir)],
    ];
    const held = winners.get(manifest.name);
    if (!held || compareRank(rank, held.rank) > 0) {
      winners.set(manifest.name, { sibling: { name: manifest.name, version: manifest.version, installRoot: dir, skills }, rank });
    }
  }
  return SIBLING_PLUGINS.flatMap((name) => {
    const held = winners.get(name);
    return held ? [held.sibling] : [];
  });
}

/** The directories directly inside `dir` whose names do not start with `.`; none when it cannot be read. */
function childDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => join(dir, entry.name));
  } catch {
    return [];
  }
}

function modifiedMs(dir: string): number {
  try {
    return statSync(dir).mtimeMs;
  } catch {
    return 0;
  }
}

/** Compares two ranks key by key, each key number by number (a missing number counts as 0). */
function compareRank(a: number[][], b: number[][]): number {
  for (let key = 0; key < a.length; key++) {
    for (let i = 0; i < Math.max(a[key].length, b[key].length); i++) {
      const diff = (a[key][i] ?? 0) - (b[key][i] ?? 0);
      if (diff !== 0) return diff;
    }
  }
  return 0;
}

/** How an error names the install a root belongs to: the plugin by name when its manifest gave one. */
export function installedPluginLabel(shipped: ShippedRoot): string {
  if (shipped.plugin === null) return "this installed plugin";
  return `the installed plugin "${shipped.plugin}"${shipped.plugin_version ? ` ${shipped.plugin_version}` : ""}`;
}

/**
 * Which tree serves a skills-tree-relative path, decided by its FIRST SEGMENT
 * alone, never by whether the file exists. If `<install>/skills/<segment>/` exists
 * on a packaged install (`skills/shared/` present, native trees #1266), the install serves the path -- always, even when COCLERK_REPO_ROOT is set
 * and even when only the checkout has the file, so a file missing from a bundled
 * skill fails visibly instead of silently reading other bytes. Next, a sibling
 * install (siblingInstalls) that holds `skills/<segment>/` serves it, on the same
 * terms. Any other segment
 * falls back to a checkout found by resolveRepoRoot's chain; with none, the
 * chain's failure (default code `skills_root_missing`, never `not_found`, which a
 * wrapper retries forever) gains one line naming the roster the install holds
 * and the siblings found.
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
  if (bundle !== undefined && segment !== "" && segment !== "." && segment !== ".." && !segment.includes(":")) {
    if (isDirectory(join(bundle, segment))) {
      const own = pluginManifest(installRoot);
      return { root: bundle, shipped_from: "install", plugin: own.name, plugin_version: own.version };
    }
    for (const sibling of siblingInstalls(installRoot)) {
      if (isDirectory(join(sibling.skills, segment))) {
        return { root: sibling.skills, shipped_from: "install", plugin: sibling.name, plugin_version: sibling.version };
      }
    }
  }

  const code = request.code ?? "skills_root_missing";
  try {
    const repoRoot = resolveRepoRoot(env, { code, subject: request.subject ?? "the skills tree" });
    return { root: join(repoRoot, ".claude", "skills"), shipped_from: "checkout", plugin: null, plugin_version: null };
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
  const siblings = siblingInstalls(installRoot).map((sibling) => `${sibling.name} ${sibling.version ?? "(no version)"}`);
  const folder = segment ? `"${segment}"` : "this path's folder";
  return (
    `This installed plugin bundles skill source for: ${bundled.join(", ")}. ` +
    `${folder} is not among them. ` +
    (siblings.length
      ? `Plugins found installed beside this one: ${siblings.join(", ")}. None of them holds ${folder} either. `
      : "No other Probanda plugin (legal, researcher, litigator, solicitor, file-manager or timekeeper) was found installed beside this one. ") +
    `The plugin that holds ${folder} is not installed on this PC's copy of the plugins ` +
    "(in Cowork, that copy is the desktop app's store). Check for updates in the desktop app, then restart it."
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
          ? `${installedPluginLabel(shipped)}'s bundled skill source lacks it; reinstall the plugin and fully restart`
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
