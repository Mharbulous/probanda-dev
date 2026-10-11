// Docs-tree surface (repo `docs/**` only): write one file, read one file.
//
// Lets a session deliver a dev-tool artifact -- an introspection E2E report
// foremost -- straight into the repo's docs tree without a folder grant, and
// read such a file back (a Cowork cycle ledger, algorithm-cycle design §7.4).
// Boundary rationale (practitioner decision, 2026-07-19): permission prompts
// guard irreversible, outward-facing, or privileged actions, and a docs/ write
// is none of these -- the tree is git-versioned and holds no client data.
// Matter files and code stay out of reach: every path resolves inside
// <repo>/docs, and there is no delete, move, or list on this surface.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { DataServerError } from "../errors.js";
import {
  assertRelativeSyntax,
  canonicalRoot,
  resolveWithin,
  toPosixRelative,
} from "./scope.js";
import { resolveRepoRoot } from "../repo-root.js";

const rootCache = new Map<string, string>();

/** Resolved lazily, per call -- same failure discipline as skillsRoot(). */
export function docsRoot(env: NodeJS.ProcessEnv = process.env): string {
  const repoRoot = resolveRepoRoot(env, { code: "docs_root_missing", subject: "the docs tree" });

  const cached = rootCache.get(repoRoot);
  if (cached) return cached;

  const target = pathWin32.join(repoRoot, "docs");
  const canon = canonicalRoot(
    target,
    `docs tree not found at ${target} (repo root ${repoRoot}); ` +
      "the repo has moved or COCLERK_REPO_ROOT is wrong",
    "docs_root_missing"
  );
  rootCache.set(repoRoot, canon);
  return canon;
}

export interface RepoDocsWrite {
  path: string;
  bytes: number;
  created: boolean;
}

export function repoDocsWrite(
  relative: string,
  content: string,
  overwrite = false,
  env?: NodeJS.ProcessEnv
): RepoDocsWrite {
  if (typeof content !== "string") {
    throw new DataServerError("content must be a string", "invalid_content");
  }

  const root = docsRoot(env);
  assertRelativeSyntax(relative, "path");
  const resolved = resolveWithin(root, relative, "path", false);

  const exists = existsSync(resolved);
  if (exists && statSync(resolved).isDirectory()) {
    throw new DataServerError(
      `path is a directory, not a file: ${relative}`,
      "invalid_path"
    );
  }
  if (exists && !overwrite) {
    throw new DataServerError(
      `file exists: docs/${toPosixRelative(root, resolved)} -- ` +
        "pass overwrite: true to replace it, or choose a new name",
      "exists"
    );
  }

  mkdirSync(pathWin32.dirname(resolved), { recursive: true });
  writeFileSync(resolved, content, "utf-8");

  return {
    path: toPosixRelative(root, resolved),
    bytes: Buffer.byteLength(content, "utf-8"),
    created: !exists,
  };
}

export interface RepoDocsRead {
  path: string;
  content: string;
}

export function repoDocsRead(relative: string, env?: NodeJS.ProcessEnv): RepoDocsRead {
  const root = docsRoot(env);
  assertRelativeSyntax(relative, "path");
  const resolved = resolveWithin(root, relative, "path");

  if (statSync(resolved).isDirectory()) {
    throw new DataServerError(
      `path is a directory, not a file: ${relative}`,
      "invalid_path"
    );
  }

  return {
    path: toPosixRelative(root, resolved),
    content: readFileSync(resolved, "utf-8"),
  };
}
