// #1365 A2: two server processes rendering one matter at once. Every page write is a rename-replace
// from a temp file named for its process, so the later rename wins and nothing ever sees half a page:
// afterwards there is one of each page, both parse, and no temp file or numbered copy is left.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import test, { after } from "node:test";

// Every lock and status mirror the children create lands here, never in the practitioner's %LOCALAPPDATA%.
process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-matter-pages-e2e-locks-"));
after(() => rmSync(process.env.COCLERK_SUBMISSION_LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { seededDbFixture, seedVaniacProceeding, readBoardData, ASHBOURNE, draftFolder } = await import("./fixtures/forms-render-seeds.mjs");
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");

const CHILD = fileURLToPath(new URL("./fixtures/matter-pages-child.mjs", import.meta.url));
const TEMP_OR_NUMBERED = /\.tmp$|-\d+\.html$/;

function startChild(options) {
  const child = spawn(process.execPath, [CHILD, JSON.stringify(options)], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
  const events = () => stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  return {
    child,
    exited,
    events,
    stderr: () => stderr,
    async next(event, timeoutMs = 60000) {
      for (const deadline = Date.now() + timeoutMs; !events().some((e) => e.event === event); await sleep(10)) {
        if (child.exitCode !== null) throw new Error(`child exited (${child.exitCode}) before "${event}": ${stderr}`);
        if (Date.now() > deadline) throw new Error(`timed out waiting for "${event}"`);
      }
    },
  };
}

test("two processes rendering one matter at once leave one of each page, both whole, and no temp file or numbered copy", { timeout: 180000 }, async () => {
  const f = seededDbFixture();
  const runs = [];
  try {
    await freshSubmissionDb(f.dbPath);
    await seedVaniacProceeding(f.dbPath);
    const { draft, leaf } = draftFolder(f);
    const go = join(f.dir, "go");

    for (let i = 0; i < 2; i++) runs.push(startChild({ db_path: f.dbPath, filing_id: 1, client: ASHBOURNE, draft_dir: draft, go_file: go, times: 5 }));
    await Promise.all(runs.map((run) => run.next("ready")));
    writeFileSync(go, "");
    const codes = await Promise.all(runs.map((run) => run.exited));

    for (const [i, run] of runs.entries()) {
      assert.equal(codes[i], 0, `child ${i + 1}: ${JSON.stringify(run.events())} ${run.stderr()}`);
      assert.equal(run.events().filter((e) => e.event === "rendered").length, 5, `child ${i + 1} rendered five times`);
    }
    // No render here starts a background job, so its status file is allowed but not expected.
    assert.deepEqual(
      readdirSync(draft).filter((name) => name !== "workboard-status.js"),
      ["Drafting records", "Litigation Strategy.html", "Loose Threads.html", "Opening Submissions Package"]
    );
    assert.deepEqual(
      readdirSync(leaf).filter((name) => name.endsWith(".html")),
      ["Arguments.html", "Legal Memos.html", "Material Facts.html", "Milestone.html", "Procedural History.html"]
    );
    assert.deepEqual(readdirSync(draft, { recursive: true }).filter((name) => TEMP_OR_NUMBERED.test(name)), [], "no temp file and no numbered copy");
    assert.deepEqual(readdirSync(dirname(f.dbPath)).filter((name) => /mockups|\.tmp$/.test(name)), [], "nor beside the database");

    assert.deepEqual(readBoardData(join(leaf, "Milestone.html")).sections.map((s) => s.meta.filing_id), [1], "the Milestone page parses");
    const todoList = readFileSync(join(draft, "Litigation Strategy.html"), "utf-8");
    assert.ok(todoList.includes("data-matter-board-shell"), "the Litigation Strategy carries its marker");
    const lines = todoList.split("\n").filter((line) => line.startsWith("window.MATTER_BOARD = "));
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0].slice("window.MATTER_BOARD = ".length, -1)).filings.map((x) => x.filing_id), [1], "the Litigation Strategy parses");
  } finally {
    for (const run of runs) if (run.child.exitCode === null) run.child.kill();
    await Promise.all(runs.map((run) => run.exited));
    rmSync(f.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
