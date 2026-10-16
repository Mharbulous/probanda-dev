// The build stamp (issue #452): tells a caller the running server predates the current build.
//
// scripts/bundle.mjs injects __LITIGATION_BUILD_STAMP__ via esbuild `define` -- a hash of the
// bundled code, so it changes exactly when the code does -- and writes the same value on the
// bundle's first line. The schema-version pair in submissionFormsBootstrap compares the database
// against the running code; this compares the running code against the repo's tracked bundle,
// which a long-lived server process never re-reads on its own. An installed copy is no reference:
// each install extracts to its own folder, so the file this process started from never changes.
// Its stamp only picks the one action an outdated server's note names (buildNote).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { INSTALL_ROOT, resolveRepoRoot } from "./repo-root.js";

declare const __LITIGATION_BUILD_STAMP__: string;

/** Null only in the unbundled tsc build/ output (the test suite), which esbuild never stamped.
 * Also reported on every skill_source__* result (files/skill-source.ts). */
export const BUILD_STAMP: string | null =
  typeof __LITIGATION_BUILD_STAMP__ === "undefined" ? null : __LITIGATION_BUILD_STAMP__;

const STAMP_LINE = /^\/\/ build-stamp: ([0-9a-f]{12})\r?\n/;

export interface BuildStampStatus {
  /** This process's own build stamp. */
  build_stamp: string | null;
  /** The stamp on the repo's tracked dist/litigation-mcp.js, read at call time. */
  current_build_stamp: string | null;
  /** True only when both stamps are known and differ. */
  server_outdated: boolean;
  /** Present when the server is outdated, or when no comparison could be made -- says which. */
  build_note?: string;
}

function noComparison(build_note: string): BuildStampStatus {
  return { build_stamp: BUILD_STAMP, current_build_stamp: null, server_outdated: false, build_note };
}

/** An outdated server's note: the build it runs and the repo's current one, then exactly one action.
 * `installed` is the stamp of the bundle in the install folder this server started from, or null when
 * that cannot be read or carries none: only an install already holding the current build needs no reinstall. */
export function buildNote(running: string, current: string, installed: string | null): string {
  const action = installed === current ? "Start a new session; the installed copy is current." : "Reinstall the legal plugin, then restart the app fully.";
  return `This server is running build ${running}; the repo's current build is ${current}. ${action}`;
}

/** The stamp line of `<install>/mcp/dist/litigation-mcp.js`, or null when unreadable or unstamped. */
export function installedStamp(): string | null {
  try {
    return STAMP_LINE.exec(readFileSync(join(INSTALL_ROOT, "mcp", "dist", "litigation-mcp.js"), "utf-8"))?.[1] ?? null;
  } catch {
    return null;
  }
}

export function buildStampStatus(env: NodeJS.ProcessEnv = process.env): BuildStampStatus {
  if (BUILD_STAMP === null) {
    return noComparison("This server runs unbundled code, which carries no build stamp -- no build comparison was made.");
  }

  let current: string | null;
  try {
    const repoRoot = resolveRepoRoot(env, { code: "repo_root_missing", subject: "the tracked litigation bundle" });
    const tracked = join(repoRoot, "source", "legal", "mcp", "dist", "litigation-mcp.js");
    current = STAMP_LINE.exec(readFileSync(tracked, "utf-8"))?.[1] ?? null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return noComparison(`No build comparison was made -- the repo's tracked litigation bundle could not be read: ${message}`);
  }

  if (current === null) {
    return noComparison("No build comparison was made -- the repo's tracked litigation bundle carries no build-stamp line.");
  }

  if (current === BUILD_STAMP) {
    return { build_stamp: BUILD_STAMP, current_build_stamp: current, server_outdated: false };
  }

  return {
    build_stamp: BUILD_STAMP,
    current_build_stamp: current,
    server_outdated: true,
    build_note: buildNote(BUILD_STAMP, current, installedStamp()),
  };
}
