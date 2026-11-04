// Path scoping for the host-side file surface (MCP file-surface design §5).
//
// Every file tool in this server resolves a caller-supplied relative path
// against a root and must prove the result still sits inside that root. The
// check sequence below is ordered deliberately -- each step closes a distinct
// hole, and the real boundary is step 3 (post-resolution containment), not the
// syntactic screen in step 1.
//
// Threat model: a confused agent, not a concurrent local attacker with
// filesystem write access -- such an attacker already owns the SQLite files and
// the repo, so the realpath/open TOCTOU race is out of scope.

import { realpathSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { DataServerError } from "../errors.js";

export class PathOutOfScopeError extends DataServerError {
  constructor(message: string) {
    super(message, "path_out_of_scope");
  }
}

const DRIVE_PREFIX = /^[A-Za-z]:/;

/**
 * Step 1 -- pre-resolution syntactic rejection. Defense in depth: this catches
 * the obvious cases early and with a clear message, but it is NOT the boundary.
 * An adversarial path that slips through here is still caught by step 3.
 */
export function assertRelativeSyntax(relative: string, label: string): void {
  if (typeof relative !== "string" || relative.length === 0) {
    throw new PathOutOfScopeError(`${label} must be a non-empty relative path`);
  }
  if (relative.includes("\0")) {
    throw new PathOutOfScopeError(`${label} contains a NUL byte`);
  }
  if (DRIVE_PREFIX.test(relative)) {
    throw new PathOutOfScopeError(`${label} must be relative, not a drive-qualified path: ${relative}`);
  }
  if (relative.startsWith("\\\\") || relative.startsWith("//")) {
    throw new PathOutOfScopeError(`${label} must be relative, not a UNC path: ${relative}`);
  }
  if (relative.startsWith("/") || relative.startsWith("\\")) {
    throw new PathOutOfScopeError(`${label} must be relative, not rooted: ${relative}`);
  }
  const segments = relative.split(/[\\/]+/);
  if (segments.some((s) => s === "..")) {
    throw new PathOutOfScopeError(`${label} must not contain a '..' segment: ${relative}`);
  }
}

/**
 * Resolve `root` itself through realpath so junctions/symlinks/8.3 short names
 * in the root are normalized once, up front. Everything else compares against
 * this canonical form.
 */
export function canonicalRoot(
  root: string,
  missingMessage: string,
  code = "skills_root_missing"
): string {
  try {
    return realpathSync.native(root);
  } catch {
    throw new DataServerError(missingMessage, code);
  }
}

/**
 * Steps 2 and 3 -- join, resolve through realpath, then prove containment.
 *
 * `realpathSync.native` is what makes this safe: a junction planted inside the
 * tree that points at C:\Windows resolves to its true target, which then fails
 * the containment check. A purely syntactic check would not catch it. It also
 * expands 8.3 short names (`PRIVIL~1` -> `privileged`), which plain
 * `realpathSync` leaves in place.
 *
 * Containment is case-folded because Windows paths are case-insensitive by
 * default, and the separator is appended to the root before comparison so that
 * a sibling directory named `Coclerk-evil` cannot pass a `Coclerk` prefix test.
 *
 * `mustExist: false` supports the write case, where the leaf may not exist yet:
 * the deepest existing ancestor is resolved and the remainder re-appended.
 */
export function resolveWithin(
  canonRoot: string,
  relative: string,
  label: string,
  mustExist = true
): string {
  const joined = pathWin32.join(canonRoot, relative);

  let resolved: string;
  if (mustExist) {
    try {
      resolved = realpathSync.native(joined);
    } catch {
      throw new DataServerError(`${label} not found: ${relative}`, "not_found");
    }
  } else {
    resolved = resolveDeepestExisting(joined);
  }

  assertContained(canonRoot, resolved, label, relative);
  return resolved;
}

/** Resolve the deepest existing ancestor and re-append the unresolved tail. */
function resolveDeepestExisting(target: string): string {
  const tail: string[] = [];
  let cursor = target;

  for (;;) {
    try {
      const base = realpathSync.native(cursor);
      return tail.length ? pathWin32.join(base, ...tail.reverse()) : base;
    } catch {
      const parent = pathWin32.dirname(cursor);
      if (parent === cursor) {
        // Walked to the drive root without finding anything that exists.
        return pathWin32.normalize(target);
      }
      tail.push(pathWin32.basename(cursor));
      cursor = parent;
    }
  }
}

export function isContained(canonRoot: string, resolved: string): boolean {
  const needle = resolved.toLowerCase();
  const prefix = (canonRoot.endsWith(pathWin32.sep) ? canonRoot : canonRoot + pathWin32.sep)
    .toLowerCase();

  return needle === canonRoot.toLowerCase() || needle.startsWith(prefix);
}

export function assertContained(
  canonRoot: string,
  resolved: string,
  label: string,
  original: string
): void {
  if (!isContained(canonRoot, resolved)) {
    throw new PathOutOfScopeError(
      `${label} resolves outside its permitted root (${original} -> ${resolved})`
    );
  }
}

/** Normalize a caller path to forward slashes for stable return values. */
export function toPosixRelative(canonRoot: string, resolved: string): string {
  return pathWin32.relative(canonRoot, resolved).split(pathWin32.sep).join("/");
}
