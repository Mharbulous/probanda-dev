// Read-only skills-tree surface (MCP file-surface design §2.1-§2.2, §3).
//
// Serves `.claude/skills/**` over MCP so a Cowork session can follow a skill
// without a repo folder grant and without a FUSE-mounted read. Content arrives
// as text with no filesystem location, so `read` also returns the file's `dir`
// -- the base every relative cross-reference inside that file resolves against.
//
// `.claude/skills` is the only skills tree (the `.agents/skills` root was
// retired 2026-08-21). A legacy `.agents/skills/` prefix in a caller-supplied
// path is still accepted and means the same tree, so older skill text keeps
// resolving.
//
// Two copies of that tree can serve a path (#1002). The litigation .plugin
// ships each roster skill's full source tree under `skills/` plus
// `skills/shared/` (native trees, #1266; each SKILL.md carries a stamped
// preamble after its frontmatter); repo-root.ts's resolveShippedRoot() picks the install
// or a Coclerk checkout from the path's first segment alone, so a bundled skill
// never needs a checkout and never silently reads one. A plugin installed beside
// this one (`researcher`, `litigator`, `solicitor`) serves the folders it holds the
// same way. Every result reports `shipped_from`, the `plugin` the file came from
// with that plugin's `plugin_version`, and the running bundle's `build_stamp`.
//
// Roots are resolved lazily, per call -- never at startup. A missing root must
// surface as a clear `skills_root_missing` error on the call that needed it,
// not as a zero-tools startup crash (the failure mode a bundle reading
// ../package.json at startup previously produced).

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { BUILD_STAMP } from "../build-stamp.js";
import { DataServerError } from "../errors.js";
import {
  assertRelativeSyntax,
  canonicalRoot,
  resolveWithin,
  toPosixRelative,
} from "./scope.js";
import {
  bundledSkillFolders,
  installedPluginLabel,
  pluginVersion,
  resolveShippedRoot,
  siblingInstalls,
  type ShippedFrom,
  type ShippedRoot,
} from "../repo-root.js";

const rootCache = new Map<string, string>();

/** Canonical (realpath) form of the root a path is served from. */
function servedRoot(shipped: ShippedRoot): string {
  const cached = rootCache.get(shipped.root);
  if (cached) return cached;
  const canon = canonicalRoot(
    shipped.root,
    shipped.shipped_from === "install"
      ? `bundled skill source not found at ${shipped.root}; reinstall the plugin and fully restart`
      : `skills tree not found at ${shipped.root}; the repo has moved or COCLERK_REPO_ROOT is wrong`,
    "skills_root_missing"
  );
  rootCache.set(shipped.root, canon);
  return canon;
}

/**
 * resolveWithin, with an install-side `not_found` that names the install. A file
 * missing from a bundled skill is never looked for in a checkout, so the message
 * must say where it was looked for.
 */
function resolveServed(shipped: ShippedRoot, root: string, relative: string, label: string, original: string): string {
  try {
    return resolveWithin(root, relative, label);
  } catch (err) {
    if (shipped.shipped_from !== "install" || !(err instanceof DataServerError) || err.code !== "not_found") throw err;
    throw new DataServerError(
      `${label} not found: ${original} -- "${relative.split(/[\\/]/)[0]}" is served from ` +
        `${installedPluginLabel(shipped)}'s bundled skill source (${shipped.root}), which has no such file`,
      "not_found"
    );
  }
}

/**
 * `plugin` and `plugin_version` name the plugin a path was served from. A
 * checkout belongs to no plugin: `plugin` is null and `plugin_version` is the
 * running plugin's, as it always was.
 */
function provenance(
  shipped: ShippedRoot,
  installRoot?: string
): { plugin: string | null; plugin_version: string | null; build_stamp: string | null } {
  return {
    plugin: shipped.plugin,
    plugin_version: shipped.shipped_from === "install" ? shipped.plugin_version : pluginVersion(installRoot),
    build_stamp: BUILD_STAMP,
  };
}

/** Everything up to and including a `.claude/skills/` (or legacy `.agents/skills/`) segment. */
const SKILLS_PREFIX = /^.*[.](?:agents|claude)[\\/]+skills[\\/]+/i;

/**
 * Accept a cross-reference in whatever form it appears inside skill text, so the
 * agent following a served skill needs no path algorithm of its own -- it passes
 * the reference through and joins dir-relative ones to the `dir` we returned.
 *
 * Two normalizations, both scoped to this surface (repo-docs.ts keeps the
 * stricter raw screen):
 *
 *   1. Strip a repo-rooted or absolute `.claude/skills/` prefix, since a skill
 *      citing the tree explicitly is already rooted.
 *   2. Collapse `..` lexically, so `demo/stages/../shared/x.md` resolves. Note a
 *      `..` that escapes the tree does NOT collapse away -- `demo/../../x.md`
 *      normalizes to `..\x.md`, whose leading `..` assertRelativeSyntax still
 *      rejects. Interior traversal is permitted; escape is refused as before.
 */
export function normalizeSkillPath(relative: string): string {
  if (typeof relative !== "string" || relative === "") return relative;
  const stripped = relative.replace(SKILLS_PREFIX, "");
  return stripped === "" ? "" : pathWin32.normalize(stripped);
}

/**
 * Pick the tree-relative path to read. Without `from` this is just the
 * normalized reference. With `from` -- the `path` of the file the reference was
 * found in -- try the containing directory first, then the skill root, then the
 * tree root, and take the first that exists.
 *
 * Both conventions are load-bearing, so no instruction to authors can settle it:
 * a real skill once hit exactly this (responding-to-applications, retired
 * 2026-08-27 #374) -- one stage file cited `../shared/conventions.md` on line 3
 * and `shared/conventions.md` on line 16, meaning the same file. The
 * server absorbing that is what keeps an agent from reading a `not_found` as
 * "this file does not exist" and skipping a canonical grammar it needed.
 *
 * An explicit skills-tree prefix means the caller already wrote a
 * tree-rooted path, so `from` is not consulted for it.
 *
 * Each candidate is probed under the root its own first segment picks
 * (resolveShippedRoot), so `shared/x.md` cited from a checkout-served skill is
 * found in an install that bundles `shared/`. A candidate whose root cannot be
 * resolved simply does not exist here; the final path's own resolution reports
 * the missing checkout.
 */
function resolveReference(
  relative: string,
  env: NodeJS.ProcessEnv,
  installRoot: string | undefined,
  from?: string
): string {
  const normalized = normalizeSkillPath(relative);
  if (!from || typeof relative !== "string" || relative === "") return normalized;
  const stripped = relative.replace(SKILLS_PREFIX, "");
  if (stripped !== relative) return normalized;   // tree-rooted as written

  const anchor = normalizeSkillPath(from).split(pathWin32.sep).join("/");
  const slash = anchor.lastIndexOf("/");
  const bases = [...new Set([slash === -1 ? "" : anchor.slice(0, slash), anchor.split("/")[0], ""])];

  for (const base of bases) {
    const candidate = pathWin32.normalize(pathWin32.join(base, stripped));
    if (candidate.split(/[\\/]/)[0] === "..") continue;   // escapes this base
    let root: string;
    try {
      root = resolveShippedRoot(candidate, env, { installRoot }).root;
    } catch (err) {
      if (err instanceof DataServerError) continue;
      throw err;
    }
    if (existsSync(pathWin32.join(root, candidate))) return candidate;
  }
  return normalized;   // nothing existed — resolve as written, so the error names it
}

export interface SkillSourceRead {
  path: string;
  dir: string;
  size: number;
  sha256: string;
  content: string;
  shipped_from: ShippedFrom;
  /** The plugin the file came from; null for a checkout. */
  plugin: string | null;
  plugin_version: string | null;
  build_stamp: string | null;
  /** Present only on a `match` read, where `content` is a slice of the file. */
  blocks_matched?: number;
  blocks_total?: number;
}

/**
 * Split on blank lines, so `match` selects whole blocks rather than bare lines.
 *
 * The unit is what makes a partial read safe. `drafting-data/references/
 * schema.sql` is a sqlite_master dump, so one table's contract is scattered --
 * `CREATE TABLE "filings"`, its index, three revision triggers, and
 * `guard_filings_need_forum_ins` sixty lines further on, which RAISE(ABORT)s
 * the insert outright. Every one of those statements names the table, and each
 * is one blank-line-delimited block, so a block match returns the contract
 * whole. Matching *lines* would return `CREATE TABLE "filings" (` and then skip
 * straight to the index, because the twelve column lines and their four CHECK
 * constraints name no table -- a confidently wrong INSERT. Markdown paragraphs
 * divide the same way, so the one rule serves prose and DDL alike.
 *
 * Splitting and rejoining on "\n" leaves each line's trailing "\r" untouched,
 * so a CRLF file's blocks stay byte-faithful.
 */
function splitBlocks(content: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of content.split("\n")) {
    if (line.trim() === "") {
      if (current.length) blocks.push(current.join("\n"));
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current.join("\n"));
  return blocks;
}

export function skillSourceRead(
  relative: string,
  env?: NodeJS.ProcessEnv,
  from?: string,
  match?: string | string[],
  installRoot?: string
): SkillSourceRead {
  const e = env || process.env;
  const normalizedInput = resolveReference(relative, e, installRoot, from);
  assertRelativeSyntax(normalizedInput, "path");
  const shipped = resolveShippedRoot(normalizedInput, e, { installRoot });
  const root = servedRoot(shipped);
  const resolved = resolveServed(shipped, root, normalizedInput, "path", relative);

  const stats = statSync(resolved);
  if (stats.isDirectory()) {
    throw new DataServerError(
      `path is a directory, not a file: ${relative} (use skill_source__list)`,
      "not_found"
    );
  }

  const bytes = readFileSync(resolved);
  const path = toPosixRelative(root, resolved);
  const slash = path.lastIndexOf("/");
  const whole = bytes.toString("utf-8");

  // `size` and `sha256` always describe the whole file, never the slice, so a
  // matched read still identifies exactly what it was taken from.
  const base = {
    path,
    dir: slash === -1 ? "" : path.slice(0, slash),
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    shipped_from: shipped.shipped_from,
    ...provenance(shipped, installRoot),
  };

  if (match === undefined) return { ...base, content: whole };

  const terms = (Array.isArray(match) ? match : [match])
    .filter((term): term is string => typeof term === "string" && term !== "")
    .map((term) => term.toLowerCase());
  if (terms.length === 0) {
    throw new DataServerError(
      "`match` must be a non-empty string, or an array of them",
      "invalid_match"
    );
  }

  const blocks = splitBlocks(whole);
  const hits = blocks.filter((block) => {
    const lowered = block.toLowerCase();
    return terms.some((term) => lowered.includes(term));
  });

  // Never an empty success. A file that words the subject differently would
  // otherwise read as a file that is silent on it -- the expensive failure.
  if (hits.length === 0) {
    throw new DataServerError(
      `no block matched ${terms.map((term) => JSON.stringify(term)).join(" or ")} in ` +
        `${path} (${base.size} bytes, ${blocks.length} blocks). The file may word the ` +
        "subject differently; re-read without `match` rather than concluding it is silent.",
      "no_match"
    );
  }

  const newline = whole.includes("\r\n") ? "\r\n" : "\n";
  return {
    ...base,
    content: hits.join(newline + newline),
    blocks_matched: hits.length,
    blocks_total: blocks.length,
  };
}

export interface SkillSourceEntry {
  path: string;
  type: "file" | "dir";
  size: number | null;
  shipped_from: ShippedFrom;
  /** The plugin the entry came from; null for a checkout. */
  plugin: string | null;
}

export interface SkillSourceListing {
  entries: SkillSourceEntry[];
  /** Absent only at the tree root, whose entries can come from several sources. */
  shipped_from?: ShippedFrom;
  /** Absent only at the tree root, like `shipped_from`; there each entry names its own. */
  plugin?: string | null;
  /** The version of `plugin`; at the tree root and for a checkout, the running plugin's. */
  plugin_version: string | null;
  build_stamp: string | null;
}

export function skillSourceList(
  dir = "",
  recursive = false,
  env?: NodeJS.ProcessEnv,
  installRoot?: string
): SkillSourceListing {
  const e = env || process.env;
  // The `/` sentinel is matched before normalizing, since it would otherwise
  // normalize to a rooted `\` and be rejected. `.claude/skills/` strips to "",
  // which is the same request.
  const normalizedDir = dir === "/" ? "" : normalizeSkillPath(dir);
  const entries: SkillSourceEntry[] = [];
  let served: ShippedRoot | undefined;
  if (normalizedDir === "" || normalizedDir === ".") {
    listTreeRoot(recursive, e, installRoot, entries);
  } else {
    assertRelativeSyntax(normalizedDir, "dir");
    const shipped = resolveShippedRoot(normalizedDir, e, { installRoot });
    const root = servedRoot(shipped);
    const base = resolveServed(shipped, root, normalizedDir, "dir", dir);
    if (!statSync(base).isDirectory()) {
      throw new DataServerError(`dir is a file, not a directory: ${dir}`, "not_found");
    }
    walk(base, root, recursive, shipped, entries);
    served = shipped;
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (served) return { entries, shipped_from: served.shipped_from, ...provenance(served, installRoot) };
  return { entries, plugin_version: pluginVersion(installRoot), build_stamp: BUILD_STAMP };
}

/**
 * The tree root merges every source, in resolveShippedRoot's order: every folder
 * the install bundles, then each sibling install's folders, then whatever else a
 * checkout holds. A folder an earlier source served is skipped in a later one,
 * since those paths are never served from it (`shared/`, which every plugin
 * ships, is this install's own). With no checkout the installs' folders alone are
 * the answer; with neither, the checkout's failure stands.
 */
function listTreeRoot(
  recursive: boolean,
  env: NodeJS.ProcessEnv,
  installRoot: string | undefined,
  out: SkillSourceEntry[]
): void {
  const bundled = bundledSkillFolders(installRoot);
  if (bundled.length > 0) {
    const install = resolveShippedRoot(bundled[0], env, { installRoot });
    const root = servedRoot(install);
    walk(root, root, recursive, install, out);
  }
  const skip = new Set(bundled.map((name) => name.toLowerCase()));
  const unserved = (entry: SkillSourceEntry) => !skip.has(entry.path.split("/")[0].toLowerCase());

  for (const sibling of siblingInstalls(installRoot)) {
    const shipped: ShippedRoot = { root: sibling.skills, shipped_from: "install", plugin: sibling.name, plugin_version: sibling.version };
    const root = servedRoot(shipped);
    const fromSibling: SkillSourceEntry[] = [];
    walk(root, root, recursive, shipped, fromSibling);
    out.push(...fromSibling.filter(unserved));
    for (const name of bundledSkillFolders(sibling.installRoot)) skip.add(name.toLowerCase());
  }

  let checkout: ShippedRoot;
  let checkoutRoot: string;
  try {
    // An empty first segment is never bundled, so this is the checkout chain.
    checkout = resolveShippedRoot("", env, { installRoot });
    checkoutRoot = servedRoot(checkout);
  } catch (err) {
    if (bundled.length > 0 && err instanceof DataServerError && err.code === "skills_root_missing") return;
    throw err;
  }
  const fromCheckout: SkillSourceEntry[] = [];
  walk(checkoutRoot, checkoutRoot, recursive, checkout, fromCheckout);
  out.push(...fromCheckout.filter(unserved));
}

function walk(dirPath: string, root: string, recursive: boolean, shipped: ShippedRoot, out: SkillSourceEntry[]): void {
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const full = pathWin32.join(dirPath, entry.name);
    const isDir = entry.isDirectory();
    out.push({
      path: toPosixRelative(root, full),
      type: isDir ? "dir" : "file",
      size: isDir ? null : statSync(full).size,
      shipped_from: shipped.shipped_from,
      plugin: shipped.plugin,
    });
    if (isDir && recursive) walk(full, root, recursive, shipped, out);
  }
}
