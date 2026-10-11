// Coverage for the tracked dist/ bundles that no other test touches. This is
// the gap that let a stale build-machine-specific repo root ship undetected
// in litigation-mcp.js on 2026-08-06: no test imported dist/ at all, so a
// baked C:\Users\<name>\... literal from whichever machine last ran `npm run
// bundle` could sit there indefinitely.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test, { after } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP_ROOT = resolve(HERE, "..");
const REPO_ROOT = resolve(MCP_ROOT, "..", "..", "..");
const LITIGATION_BUNDLE = join(MCP_ROOT, "dist", "litigation-mcp.js");
const CANLII_BUNDLE = join(MCP_ROOT, "..", "canlii-mcp", "dist", "canlii-mcp.js");

// A spawned bundle's bootstrap starts the background render job (#589): keep its locks and status
// mirrors out of the practitioner's %LOCALAPPDATA%. Every spawned server inherits process.env.
process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-bundle-contract-locks-"));
after(() => rmSync(process.env.COCLERK_SUBMISSION_LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { resolveRepoRoot } = await import("../build/repo-root.js");
const { buildToolDefinitions } = await import("../build/schema-gen.js");

// Backslash-only for the drive form: `[A-Za-z]:[\\/]` would also match `p:/`
// inside an ordinary `http://` URL string. Nothing in these bundles should
// legitimately contain a Windows drive-qualified path or a *nix home path --
// every host path is resolved at runtime, never embedded at build time. The drive letter must stand
// alone: pdf.js's message text "error:\n" is a word, not a drive (direct_mode.py's HOST_PATH matches).
const HOST_PATH = /(?<![A-Za-z0-9_])[A-Za-z]:\\|\/(?:home|Users)\/[A-Za-z0-9._-]+\//g;

// Issue #452: the build stamp. scripts/bundle.mjs hashes the bundle with a placeholder in the
// stamp's place, then writes the hash over the placeholder -- so the stamp changes exactly when
// the bundled code does, and a no-change rebuild leaves the tracked file byte-identical.
const STAMP_PLACEHOLDER = "__LITIGATION_BUILD_STAMP_PLACEHOLDER__";
const STAMP_LINE = /^\/\/ build-stamp: ([0-9a-f]{12})\r?\n/;

test("no tracked dist bundle contains an absolute host path or an unsubstituted define", () => {
  for (const bundle of [LITIGATION_BUNDLE, CANLII_BUNDLE]) {
    const text = readFileSync(bundle, "utf-8");
    const hits = text.match(HOST_PATH) ?? [];
    assert.deepEqual(hits, [], `${bundle} bakes a host path: ${hits.join(", ")}`);
    assert.equal(
      text.includes("__COCLERK_REPO_ROOT__"),
      false,
      `${bundle} has an unsubstituted __COCLERK_REPO_ROOT__ define`,
    );
    assert.equal(
      text.includes(STAMP_PLACEHOLDER),
      false,
      `${bundle} has an unsubstituted build-stamp placeholder`,
    );
  }
});

function bundleStamp(text) {
  const match = STAMP_LINE.exec(text);
  assert.ok(match, "expected the bundle to open with a // build-stamp: line");
  return match[1];
}

test("the tracked litigation bundle's build stamp is the hash of its own placeholder form", () => {
  const text = readFileSync(LITIGATION_BUNDLE, "utf-8").replace(/\r\n/g, "\n");
  const stamp = bundleStamp(text);
  const placeholderForm = text.replaceAll(stamp, STAMP_PLACEHOLDER);
  const expected = createHash("sha256").update(placeholderForm).digest("hex").slice(0, 12);
  assert.equal(stamp, expected, "the stamp does not match the bundle's content -- rebuild with npm run bundle");
});

/** A per-matter database holding only an empty db_meta -- bootstrap's migration_required refusal,
 * which reports the build stamp without needing a migrated schema. */
function unstampedSubmissionDb() {
  const dbDir = mkdtempSync(join(tmpdir(), "coclerk-build-stamp-db-"));
  const dbPath = join(dbDir, "submission.sqlite");
  const python = process.env.COCLERK_PYTHON || "python";
  const created = spawnSync(
    python,
    [
      "-c",
      "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('CREATE TABLE db_meta (key TEXT PRIMARY KEY, value TEXT)'); c.commit(); c.close()",
      dbPath,
    ],
    { encoding: "utf-8" },
  );
  if (created.status !== 0) throw new Error(`fixture Python failed: ${created.stderr}`);
  return { dbPath, cleanup: () => rmSync(dbDir, { recursive: true, force: true }) };
}

async function bootstrap(client, dbPath) {
  const result = await client.callTool({ name: "drafting_forms__bootstrap", arguments: { db_path: dbPath } });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  return JSON.parse(result.content[0].text);
}

test("the dist-only bundle's bootstrap reports its build stamp, matching the repo's tracked bundle", async () => {
  const stamp = bundleStamp(readFileSync(LITIGATION_BUNDLE, "utf-8"));
  const db = unstampedSubmissionDb();
  try {
    await withDistOnlyServer({ ...process.env, COCLERK_REPO_ROOT: REPO_ROOT }, async (client) => {
      const parsed = await bootstrap(client, db.dbPath);
      assert.equal(parsed.migration_required, true, "schema-version fields behave as before");
      assert.equal(parsed.build_stamp, stamp);
      assert.equal(parsed.current_build_stamp, stamp);
      assert.equal(parsed.server_outdated, false);
      assert.equal(parsed.build_note, undefined);
    });
  } finally {
    db.cleanup();
  }
});

test("a server spawned before a rebuild reports server_outdated from its bootstrap response alone", async () => {
  const stamp = bundleStamp(readFileSync(LITIGATION_BUNDLE, "utf-8"));
  const repoRoot = mkdtempSync(join(tmpdir(), "coclerk-build-stamp-repo-"));
  const trackedBundle = join(repoRoot, "source", "probanda", "mcp", "dist", "litigation-mcp.js");
  mkdirSync(dirname(trackedBundle), { recursive: true });
  copyFileSync(LITIGATION_BUNDLE, trackedBundle);
  // Bootstrap reads the schema version through the drafting-data migration scripts.
  const submissionSkill = join(".claude", "skills", "drafting-data");
  cpSync(join(REPO_ROOT, submissionSkill), join(repoRoot, submissionSkill), { recursive: true });
  const db = unstampedSubmissionDb();
  try {
    await withDistOnlyServer({ ...process.env, COCLERK_REPO_ROOT: repoRoot }, async (client) => {
      assert.equal((await bootstrap(client, db.dbPath)).server_outdated, false, "before the rebuild");

      // The rebuild lands while this server process keeps running its old code.
      writeFileSync(trackedBundle, "// build-stamp: 0123456789ab\n");
      const parsed = await bootstrap(client, db.dbPath);
      assert.equal(parsed.build_stamp, stamp);
      assert.equal(parsed.current_build_stamp, "0123456789ab");
      assert.equal(parsed.server_outdated, true);
      assert.match(parsed.build_note, new RegExp(`${stamp}.*0123456789ab`));
      assert.equal(parsed.migration_required, true, "schema-version fields behave as before");
    });
  } finally {
    db.cleanup();
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

/**
 * Spawns `dist/litigation-mcp.js` copied ALONE into a marker-free tmpdir --
 * nothing else from the repo is present, and the tmpdir's own ancestry (under
 * the OS temp root) holds no repo marker either. This is the same shape as an
 * extracted .plugin install: no .git, no .claude/skills, anywhere above the
 * running file.
 */
async function withDistOnlyServer(env, fn) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-dist-only-"));
  const bundleCopy = join(dir, "litigation-mcp.js");
  copyFileSync(LITIGATION_BUNDLE, bundleCopy);

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bundleCopy],
    cwd: dir,
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: "bundle-contract-test", version: "0.0.0" });
  let stderr = "";
  transport.stderr?.on("data", (d) => (stderr += d));
  try {
    await client.connect(transport);
    await fn(client);
  } catch (err) {
    if (stderr) err.message += `\n--- child stderr ---\n${stderr}`;
    throw err;
  } finally {
    await client.close().catch(() => {});
    // Retried: on Windows the server's Python query sidecar inherits `dir` as its cwd and outlives
    // close() until it reads EOF, and an EBUSY thrown from this finally would replace the test's own
    // assertion error. The promise `rm` is required: `rmSync` ignores maxRetries for EBUSY on the
    // directory itself and throws at once.
    await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

test("the dist-only bundle completes an MCP handshake and registers every tool", async () => {
  await withDistOnlyServer(
    { ...process.env, COCLERK_REPO_ROOT: REPO_ROOT },
    async (client) => {
      const { tools } = await client.listTools();
      assert.equal(tools.length, buildToolDefinitions().length);
    },
  );
});

// #591's acceptance: no model call anywhere in session entry. The packaged bundle runs
// open_session from a matter folder to a bootstrapped session with every model-provider
// credential stripped from its environment -- a model call would have nothing to authenticate with.
test("the dist-only bundle opens a session from a matter folder with no model API key present", async () => {
  const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
  const base = mkdtempSync(join(tmpdir(), "coclerk-open-session-bundle-"));
  const matterRoot = join(base, "L9999 Test Matter");
  const caseDataDir = join(base, "0. CASE DATA", "L9999 Test Matter");
  mkdirSync(matterRoot, { recursive: true });
  mkdirSync(caseDataDir, { recursive: true });
  writeFileSync(
    join(matterRoot, "coclerk.json"),
    JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: caseDataDir }),
  );
  await freshSubmissionDb(join(caseDataDir, "submission.sqlite"));

  const env = { ...process.env, COCLERK_REPO_ROOT: REPO_ROOT, COCLERK_DB_PATH: join(base, "practice.db") };
  for (const key of Object.keys(env)) {
    if (/^(ANTHROPIC|CLAUDE|OPENAI)/i.test(key)) delete env[key];
  }
  try {
    await withDistOnlyServer(env, async (client) => {
      const result = await client.callTool({ name: "drafting_forms__open_session", arguments: { matter_root: matterRoot } });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.migration_required, false);
      assert.deepEqual(parsed.filings, []);
      assert.match(parsed.session_token, /^sess-/);
      assert.equal(parsed.matter_lookup.matt_num, "L9999");
    });
  } finally {
    rmSync(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

// The submissions merge's own "done" bar: the folded drafting_data__ surface
// answers through the actual packaged bundle, not just the build/ output.
test("the dist-only bundle's submission query tool runs against an empty per-matter database", async () => {
  const dbDir = mkdtempSync(join(tmpdir(), "coclerk-submission-empty-db-"));
  const dbPath = join(dbDir, "submission.sqlite");
  const python = process.env.COCLERK_PYTHON || "python";
  const created = spawnSync(
    python,
    ["-c", "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.close()", dbPath],
    { encoding: "utf-8" },
  );
  if (created.status !== 0) throw new Error(`fixture Python failed: ${created.stderr}`);
  try {
    await withDistOnlyServer(
      { ...process.env, COCLERK_REPO_ROOT: REPO_ROOT },
      async (client) => {
        const result = await client.callTool({
          name: "drafting_data__query",
          arguments: { db_path: dbPath, sql: "SELECT 1 AS ok" },
        });
        assert.notEqual(result.isError, true, JSON.stringify(result));
        const parsed = JSON.parse(result.content[0].text);
        assert.deepEqual(parsed.rows, [{ ok: 1 }]);
      },
    );
  } finally {
    rmSync(dbDir, { recursive: true, force: true });
  }
});

// The law-folder extractors are bundled, not host packages: the packaged bundle reads a text-layer
// PDF and a .doc with no host Python, and pdf.js (which warns with console.log on load) leaves stdout,
// the JSON-RPC channel, clean -- a stray line there would surface as a transport error.
test("the dist-only bundle extracts a 6. LAW PDF and .doc with no host Python, keeping stdout clean", async () => {
  const { docBytes, pdfBytes } = await import("./helpers/synthetic-docs.mjs");
  const matter = mkdtempSync(join(tmpdir(), "coclerk-lawtext-bundle-"));
  writeFileSync(join(matter, "coclerk.json"), "{}\n");
  mkdirSync(join(matter, "0. DRAFT"));
  const law = join(matter, "6. LAW", "Issue");
  mkdirSync(law, { recursive: true });
  const lines = Array.from({ length: 40 }, (_, i) => `Placeholder bundled line ${i} of the text layer.`).join("\n");
  writeFileSync(join(law, "decision.pdf"), pdfBytes([lines], { compress: true }));
  writeFileSync(join(law, "older.doc"), docBytes([{ text: "Placeholder older decision\r", unicode: false }]));
  try {
    await withDistOnlyServer(
      { ...process.env, COCLERK_REPO_ROOT: REPO_ROOT, COCLERK_PYTHON: join(matter, "no-such-python.exe") },
      async (client) => {
        const transportErrors = [];
        client.onerror = (err) => transportErrors.push(err);
        const result = await client.callTool({
          name: "research_filing__law_folder_text",
          arguments: { matter_root: matter, destination_dir: law },
        });
        assert.notEqual(result.isError, true, JSON.stringify(result));
        const rows = Object.fromEntries(JSON.parse(result.content[0].text).files.map((row) => [row.file, row]));
        assert.equal(rows["decision.pdf"].status, "ok", rows["decision.pdf"].reason);
        assert.equal(rows["older.doc"].status, "ok", rows["older.doc"].reason);
        await client.listTools();
        assert.deepEqual(transportErrors, []);
      },
    );
  } finally {
    rmSync(matter, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

test("the dist-only bundle resolves the repo with no COCLERK_REPO_ROOT set, the way a packaged install must", async (t) => {
  // This is the exact failure mode reproduced live on Device B (2026-08-06):
  // a packaged .plugin has no repo above it, so only steps 3/4 of the
  // resolution chain can find it. Skip on a checkout the chain genuinely
  // can't reach, rather than assuming every machine matches the convention.
  const probeEnv = { ...process.env };
  delete probeEnv.COCLERK_REPO_ROOT;
  let reachable;
  try {
    reachable = resolveRepoRoot(probeEnv, {
      code: "skills_root_missing",
      subject: "the skills tree",
      startDir: tmpdir(),
    });
  } catch {
    reachable = undefined;
  }
  if (reachable !== REPO_ROOT) {
    t.skip(
      "this checkout is not reachable from a packaged location with the current env -- " +
        `set "repo_root" in %APPDATA%\\Coclerk\\coclerk.json to ${REPO_ROOT}, or set COCLERK_REPO_ROOT`,
    );
    return;
  }

  const childEnv = { ...process.env };
  delete childEnv.COCLERK_REPO_ROOT;
  await withDistOnlyServer(childEnv, async (client) => {
    const result = await client.callTool({
      name: "skill_source__read",
      arguments: { path: "case-data/SKILL.md" },
    });
    assert.notEqual(result.isError, true, JSON.stringify(result));
  });
});
