// The background render job (#589; decisions and acceptance in #588): started by bootstrap through
// the tool dispatch, one filing per turn, a host-local lock with takeover and fencing, and a status
// file written temp-then-rename. The browser side of the same status is in workboard-file-url.e2e.test.mjs.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs,{ existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import { startFakeCloud } from "./helpers/fake-cloud.mjs";

// Every lock and status mirror this file creates lands here, never in the practitioner's %LOCALAPPDATA%.
const LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-render-job-locks-"));
process.env.COCLERK_SUBMISSION_LOCK_ROOT = LOCK_ROOT;
after(() => rmSync(LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const { submissionDataExecute } = await import("../build/submission/backend.js");
const { callTool } = await import("../build/dispatch.js");
const { awaitBackgroundJobs, backgroundJobStatus, writeStatusFile, STATUS_FILE } = await import("../build/submission/render-job.js");
const { hostLocalPath } = await import("../build/submission/lock.js");
const { CLIENT, seedFilings, startChild } = await import("./fixtures/render-job-helpers.mjs");
const { createDispatchContext } = await import("../build/index.js");
const writes = await import("../build/tools/practice/writes.js");
const { readBoardData } = await import("./fixtures/forms-render-seeds.mjs");
const { VIEW_PAGES } = await import("../build/submission/view-pages.js");

async function matter(count, { draft = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-render-job-"));
  // Every render writes into the matter's 0. DRAFT beside the db's 0. CASE DATA; `draft` says whether the test passes draft_dir.
  mkdirSync(join(dir, "L7001 Ashgrove", "0. CASE DATA"), { recursive: true });
  const dbPath = join(dir, "L7001 Ashgrove", "0. CASE DATA", "submission.sqlite");
  await seedFilings(dbPath, count);
  const matterDraft = join(dir, "L7001 Ashgrove", "0. DRAFT");
  mkdirSync(matterDraft);
  const draftDir = draft ? matterDraft : undefined;
  return {
    dir,
    dbPath,
    draftDir,
    matterDraft,
    lockFile: hostLocalPath(dbPath, "render-job.lock"),
    mirrorFile: hostLocalPath(dbPath, "render-job.status.json"),
    cleanup: () => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }),
  };
}

const bootstrap = (dbPath, args = CLIENT) => callTool({}, "drafting_forms__bootstrap", { db_path: dbPath, ...args });
const render = (dbPath, filingId, args = CLIENT) =>
  callTool({}, "drafting_forms__render", { db_path: dbPath, filing_id: filingId, documents: ["Work_board"], ...args });
const readMirror = (m) => JSON.parse(readFileSync(m.mirrorFile, "utf-8"));
const readPage = (file) => JSON.parse(readFileSync(file, "utf-8").replace(/^window\.WORKBOARD_STATUS = /, "").replace(/;\n$/, ""));
/** The Litigation Strategy's page data, read off its one data line. */
const readTodoList = (file) => {
  const line = readFileSync(file, "utf-8").split("\n").find((l) => l.startsWith("window.MATTER_BOARD = "));
  return JSON.parse(line.slice("window.MATTER_BOARD = ".length, -1));
};

/** Waits, a turn at a time, until `predicate` holds -- interleaving with the job's own turns. */
async function until(predicate, what, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function sleeper() {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 120000)"], { stdio: "ignore" });
  return child;
}

async function deadPid() {
  const child = spawn(process.execPath, ["-e", ""], { stdio: "ignore" });
  await new Promise((resolve) => child.once("exit", resolve));
  return child.pid;
}

function plantLock(m, pid, jobId = "held-elsewhere") {
  writeFileSync(m.lockFile, JSON.stringify({ job_id: jobId, pid, started_at: new Date().toISOString(), db_path: m.dbPath }));
}

test("bootstrap's job renders each stale filing once, skips fresh and retired ones, releases its lock, and rewrites both pages", async (t) => {
  const m = await matter(4, { draft: true });
  // The to-dos come from the practice database, reached through the dispatch as a session reaches it.
  const practicePath = join(tmpdir(), `coclerk-render-job-practice-${randomUUID()}.db`);
  t.after(() => rmSync(practicePath, { force: true }));
  const context = await createDispatchContext({ ...process.env, ...(await startFakeCloud(t)).env, COCLERK_DB_PATH: practicePath });
  await writes.upsert_client_matter(context.practiceDb, { client_num: "C-7001", name: "Ashgrove Holdings", matt_num: "L7001", file_number: "F-7001" });
  await writes.upsert_task(context.practiceDb, { task_type: "client", matt_num: "L7001", description: "Settle the first notice", next_nudge_date: "2026-09-20", filing_ref: "filing:1" });
  try {
    // Retire first: the write bumps the revision, which would make an earlier render stale.
    await submissionDataExecute(m.dbPath, "UPDATE filings SET retired_on = '2026-09-01', retirement_reason = 'abandoned' WHERE id = 4");
    await render(m.dbPath, 2);

    const first = await callTool(context, "drafting_forms__bootstrap", { db_path: m.dbPath, ...CLIENT, draft_dir: m.draftDir });
    assert.equal(first.background_job.state, "running");
    assert.deepEqual([first.background_job.current, ...first.background_job.queued].sort(), [1, 3]);
    assert.ok(existsSync(join(m.draftDir, STATUS_FILE)), "the first status is written before bootstrap returns");
    const bootstrapTodos = readTodoList(first.matter_board_path).todos;
    assert.deepEqual(bootstrapTodos.map((x) => x.description), ["Settle the first notice"]);

    const [summary] = await awaitBackgroundJobs();
    assert.deepEqual(summary.rendered.sort(), [1, 3]);
    assert.deepEqual(summary.failed, []);
    assert.equal(existsSync(m.lockFile), false, "the lock is released");
    assert.equal(readMirror(m).state, "done");
    assert.equal(readPage(join(m.draftDir, STATUS_FILE)).state, "done");

    // #1365 A7: after each filing the job rewrote the matter's pages from database state -- a Work Board
    // page per live filing (ADR 0033, 2026-10-05 amendment), and the Litigation Strategy with the to-dos
    // bootstrap read, which the job cannot read itself; its lines now show the filings the job
    // rendered as fresh.
    assert.deepEqual(first.milestone_paths.map((p) => p.filing_id).sort(), [1, 2, 3], "every live filing has a page; the retired one none");
    for (const { filing_id, path } of first.milestone_paths) {
      assert.deepEqual(readBoardData(path).sections.map((s) => s.meta.filing_id), [filing_id], `${path} holds its filing's section alone`);
    }
    const todoList = readTodoList(first.matter_board_path);
    assert.deepEqual(todoList.todos, bootstrapTodos, "the job's Litigation Strategy carries the to-dos bootstrap recorded");
    assert.deepEqual(
      todoList.filings.filter((f) => !f.retired_on).map((f) => [f.filing_id, f.render_state]).sort(),
      [[1, "fresh"], [2, "fresh"], [3, "fresh"]],
      "rewritten after the job's renders"
    );

    const again = await bootstrap(m.dbPath);
    assert.deepEqual(again.filings.filter((f) => !f.retired_on).map((f) => f.render_state), ["fresh", "fresh", "fresh"]);
    assert.equal(again.background_job.state, "done", "nothing stale: the job finishes at once");
    assert.deepEqual(again.background_job.queued, []);
  } finally {
    m.cleanup();
  }
});

test("without all three client fields the job queues nothing, and still replaces a killed job's status", async () => {
  const m = await matter(2, { draft: true });
  try {
    const leftover = { job_id: "killed", state: "running", started_at: "2026-09-15T10:00:00.000Z", updated_at: "2026-09-15T10:00:01.000Z", stall_after_ms: 60000, queued: [2], done: [], failed: [], current: 1 };
    writeFileSync(join(m.draftDir, STATUS_FILE), `window.WORKBOARD_STATUS = ${JSON.stringify(leftover)};\n`);

    const result = await bootstrap(m.dbPath, { client_name: "Ashgrove Holdings", draft_dir: m.draftDir });
    assert.equal(result.background_job.state, "done");
    assert.equal(result.background_job.current, null);
    assert.deepEqual(result.background_job.queued, []);
    assert.equal(readPage(join(m.draftDir, STATUS_FILE)).state, "done", "the leftover running status is replaced");
    // #1365 A4: bootstrap records the to-dos it drew for the job in the Drafting records; nothing else is there.
    assert.deepEqual(readdirSync(join(m.draftDir, "Drafting records")), ["matter-pages-state.json"], "nothing was rendered");
  } finally {
    m.cleanup();
  }
});

test("a filing that fails to render is recorded, the rest still render, and the job never rejects", async () => {
  const m = await matter(3);
  const rejections = [];
  const onRejection = (reason) => rejections.push(reason);
  process.on("unhandledRejection", onRejection);
  try {
    // A kind no type file in the venue's kinds index lists composes to no filler.
    await submissionDataExecute(m.dbPath, "UPDATE filings SET kind = 'no_such_kind' WHERE id = 2");
    await bootstrap(m.dbPath);
    const [summary] = await awaitBackgroundJobs();
    assert.deepEqual(summary.rendered.sort(), [1, 3], JSON.stringify(summary));
    assert.equal(summary.failed.length, 1);
    assert.equal(summary.failed[0].filing_id, 2);
    assert.match(summary.failed[0].error, /no row lists kind "no_such_kind"/);
    assert.equal(existsSync(m.lockFile), false, "the lock is released after a failure");
    assert.equal(readMirror(m).state, "done");
    assert.deepEqual(rejections, []);
  } finally {
    process.off("unhandledRejection", onRejection);
    m.cleanup();
  }
});

test("a second bootstrap while the job runs joins it, and every stale filing renders exactly once", async () => {
  const m = await matter(6);
  try {
    const first = await bootstrap(m.dbPath);
    const second = await bootstrap(m.dbPath);
    assert.equal(first.background_job.joined, undefined);
    assert.equal(second.background_job.joined, true);
    assert.equal(second.background_job.job_id, first.background_job.job_id, "the joiner reports the holder's job");

    const summaries = await awaitBackgroundJobs();
    assert.equal(summaries.length, 1, "one job ran");
    assert.deepEqual(summaries[0].rendered.sort(), [1, 2, 3, 4, 5, 6]);
  } finally {
    m.cleanup();
  }
});

test("fencing: a job whose lock was taken over renders and writes nothing more", async () => {
  const m = await matter(8, { draft: true });
  try {
    const started = await bootstrap(m.dbPath, { ...CLIENT, draft_dir: m.draftDir });
    await until(() => (backgroundJobStatus(m.dbPath).done ?? []).length >= 1, "the first filing");
    plantLock(m, process.pid, "the-new-holder");
    const mirrorAtTakeover = readFileSync(m.mirrorFile, "utf-8");
    const pageAtTakeover = readFileSync(join(m.draftDir, STATUS_FILE), "utf-8");

    const [summary] = await awaitBackgroundJobs();
    assert.equal(summary.job_id, started.background_job.job_id);
    assert.ok(summary.rendered.length < 8, `the old holder stopped (rendered ${summary.rendered})`);
    assert.equal(readFileSync(m.mirrorFile, "utf-8"), mirrorAtTakeover, "no status write after the takeover");
    assert.equal(readFileSync(join(m.draftDir, STATUS_FILE), "utf-8"), pageAtTakeover);
    assert.equal(JSON.parse(readFileSync(m.lockFile, "utf-8")).job_id, "the-new-holder", "the new holder's lock is left alone");
  } finally {
    m.cleanup();
  }
});

test("a lock left by this process with no job behind it is taken over at once", async () => {
  const m = await matter(1);
  try {
    plantLock(m, process.pid);
    const result = await bootstrap(m.dbPath);
    assert.equal(result.background_job.joined, undefined);
    assert.notEqual(result.background_job.job_id, "held-elsewhere");
    await awaitBackgroundJobs();
  } finally {
    m.cleanup();
  }
});

test("a lock whose process is gone is taken over at once", async () => {
  const m = await matter(1);
  try {
    plantLock(m, await deadPid());
    const result = await bootstrap(m.dbPath);
    assert.equal(result.background_job.joined, undefined);
    const [summary] = await awaitBackgroundJobs();
    assert.deepEqual(summary.rendered, [1]);
  } finally {
    m.cleanup();
  }
});

test("a lock held by a live process is joined, not taken over, and nothing renders here", async () => {
  const m = await matter(2);
  const holder = sleeper();
  try {
    plantLock(m, holder.pid);
    const result = await bootstrap(m.dbPath);
    assert.equal(result.background_job.joined, true);
    assert.equal(result.background_job.job_id, "held-elsewhere");
    assert.deepEqual(await awaitBackgroundJobs(), []);
    const records = join(m.matterDraft, "Drafting records");
    assert.deepEqual(existsSync(records) ? readdirSync(records).filter((name) => name.startsWith("render-manifest-")) : [], [], "nothing rendered");
  } finally {
    holder.kill();
    m.cleanup();
  }
});

test("a pid this process may not open (EPERM) counts as alive", { skip: process.platform !== "win32" && "Windows pid 4 is System" }, async () => {
  const m = await matter(1);
  try {
    plantLock(m, 4);
    const result = await bootstrap(m.dbPath);
    assert.equal(result.background_job.joined, true);
  } finally {
    m.cleanup();
  }
});

test("a live holder whose heartbeat is older than three stall thresholds is taken over", async () => {
  const m = await matter(1);
  const holder = sleeper();
  const saved = process.env.COCLERK_RENDER_STALL_MS;
  process.env.COCLERK_RENDER_STALL_MS = "1000";
  try {
    plantLock(m, holder.pid);
    const old = new Date(Date.now() - 10_000);
    utimesSync(m.lockFile, old, old);
    const result = await bootstrap(m.dbPath);
    assert.equal(result.background_job.joined, undefined);
    assert.equal(result.background_job.stall_after_ms, 1000);
    await awaitBackgroundJobs();
  } finally {
    if (saved === undefined) delete process.env.COCLERK_RENDER_STALL_MS;
    else process.env.COCLERK_RENDER_STALL_MS = saved;
    holder.kill();
    m.cleanup();
  }
});

test("a foreground render of a queued filing takes it off the job's hands", async () => {
  const m = await matter(4);
  try {
    await bootstrap(m.dbPath);
    const rendered = await render(m.dbPath, 4);
    assert.ok(rendered.background_job.done.includes(4), "the render's response already counts it done");
    const [summary] = await awaitBackgroundJobs();
    assert.deepEqual(summary.rendered.sort(), [1, 2, 3]);
    assert.ok(summary.done.includes(4));
  } finally {
    m.cleanup();
  }
});

test("a foreground render with other client fields leaves the filing to the job", async () => {
  const m = await matter(3);
  try {
    await bootstrap(m.dbPath);
    await render(m.dbPath, 3, { ...CLIENT, client_name: "Someone Else" });
    const [summary] = await awaitBackgroundJobs();
    assert.deepEqual(summary.rendered.sort(), [1, 2, 3], "not fresh under the job's stamp, so the job renders it");
  } finally {
    m.cleanup();
  }
});

test("background_job reports stalled and aborted from the mirror, and idle when there is none", async () => {
  const m = await matter(1);
  try {
    assert.deepEqual(backgroundJobStatus(m.dbPath), { state: "idle" });
    const base = { job_id: "j", started_at: "2026-09-16T10:00:00.000Z", stall_after_ms: 1000, queued: [], done: [], failed: [], current: 1 };
    writeFileSync(m.mirrorFile, JSON.stringify({ ...base, state: "running", updated_at: new Date().toISOString() }));
    assert.equal(backgroundJobStatus(m.dbPath).state, "aborted", "running with no lock is a job killed outright");
    plantLock(m, process.pid, "j");
    assert.equal(backgroundJobStatus(m.dbPath).state, "running");
    writeFileSync(m.mirrorFile, JSON.stringify({ ...base, state: "running", updated_at: new Date(Date.now() - 5000).toISOString() }));
    assert.equal(backgroundJobStatus(m.dbPath).state, "stalled");
  } finally {
    m.cleanup();
  }
});

test("a graceful exit mid-job marks the status aborted and releases the lock", async () => {
  const m = await matter(30, { draft: true });
  try {
    const run = startChild({ db_path: m.dbPath, ...CLIENT, draft_dir: m.draftDir, exit_after: 1 });
    await run.next("exiting");
    const { code } = await run.exited;
    assert.equal(code, 0);
    assert.equal(readMirror(m).state, "aborted");
    assert.equal(readPage(join(m.draftDir, STATUS_FILE)).state, "aborted");
    assert.equal(existsSync(m.lockFile), false);
  } finally {
    m.cleanup();
  }
});

// Brief acceptance: two concurrent bootstraps on one matter, total renders equal to the stale
// filings, not double -- here as two real server processes released together over a dead holder's
// lock, so they also race each other's takeover. Both run with no model credential in their
// environment (brief D4), and the board flow ends with the page status done.
test("two processes bootstrapping one matter at once render each stale filing exactly once, with no API key", { timeout: 120000 }, async () => {
  const m = await matter(40, { draft: true });
  const go = join(m.dir, "go");
  try {
    plantLock(m, await deadPid());
    const runs = [1, 2].map(() => startChild({ db_path: m.dbPath, ...CLIENT, draft_dir: m.draftDir, go_file: go }));
    await new Promise((resolve) => setTimeout(resolve, 500));
    writeFileSync(go, "");
    const settled = await Promise.all(runs.map((run) => run.next("settled")));
    const rendered = settled.flatMap((s) => s.summaries.flatMap((summary) => summary.rendered)).sort((a, b) => a - b);
    assert.deepEqual(rendered, Array.from({ length: 40 }, (_, i) => i + 1), "every stale filing rendered exactly once");
    const joined = (await Promise.all(runs.map((run) => run.next("bootstrapped")))).filter((b) => b.background_job.joined);
    assert.ok(joined.length <= 1);
    assert.equal(readPage(join(m.draftDir, STATUS_FILE)).state, "done");
    const names = readdirSync(m.draftDir, { recursive: true }).map(String);
    const boards = Array.from({ length: 40 }, (_, i) => join(`Notice of Application ${i + 1}`, "Work Board.html"));
    const views = Array.from({ length: 40 }, (_, i) => VIEW_PAGES.map((page) => join(`Notice of Application ${i + 1}`, `${page.name}.html`))).flat();
    assert.deepEqual(names.filter((name) => name.endsWith(".html")).sort(), [...boards, ...views, "Litigation Strategy.html", "Loose Threads.html"].sort(), "a Work Board page and the view pages per filing, the Litigation Strategy and the Loose Threads page, and no other page file");
    assert.deepEqual(names.filter((name) => name.endsWith(".tmp")), [], "no temp file left behind");
    for (const [i, name] of boards.entries()) {
      assert.deepEqual(readBoardData(join(m.draftDir, name)).sections.map((s) => s.meta.filing_id), [i + 1], `${name} parses, its filing's section alone`);
    }
    for (const run of runs) assert.equal((await run.exited).code, 0, run.stderr());
    assert.deepEqual(readdirSync(LOCK_ROOT).filter((name) => name.endsWith(".break")), [], "no removal claim left behind");
  } finally {
    m.cleanup();
  }
});

// #588 acceptance 6: OneDrive holds a synced file open while it uploads, and a rename over it fails
// until it lets go. A PowerShell handle opened with no sharing stands in for the sync client. With
// `release`, the hold lasts until that file exists instead of for `ms`, and `released` is written
// once the handle is closed.
function holdFile(path, ms, { release, released } = {}) {
  const q = (p) => `'${p.replace(/'/g, "''")}'`;
  const wait = release ? `while (-not (Test-Path ${q(release)})) { Start-Sleep -Milliseconds 10 }` : `Start-Sleep -Milliseconds ${ms}`;
  const done = released ? `; [IO.File]::WriteAllText(${q(released)}, '')` : "";
  const script = `$f = [IO.File]::Open(${q(path)}, 'Open', 'Read', 'None'); [Console]::Out.WriteLine('held'); [Console]::Out.Flush(); ${wait}; $f.Close()${done}`;
  const child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: ["ignore", "pipe", "inherit"] });
  const held = new Promise((resolve, reject) => {
    child.stdout.on("data", (chunk) => String(chunk).includes("held") && resolve());
    child.once("exit", (code) => reject(new Error(`PowerShell exited (${code}) before holding ${path}`)));
  });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  return { held, exited };
}

test("a status write waits out a short hold on its target and gives up cleanly on a long one", { skip: process.platform !== "win32" && "Windows sharing modes" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-render-job-hold-"));
  const signals = mkdtempSync(join(tmpdir(), "coclerk-render-job-signals-"));
  const release = join(signals, "release");
  const released = join(signals, "released");
  try {
    const target = join(dir, STATUS_FILE);
    writeFileSync(target, "before\n");

    // A timed hold raced the retry budget: on the 2-core CI runner a 200 ms hold outlasted 40 x 50 ms
    // in 4 of 100 runs (#701, #1252), because the holder process was not scheduled to close in time.
    // So the hold ends only after a rename has been refused: the first refusal signals the holder and
    // blocks until it confirms the handle is closed. writeStatusFile blocks this thread between
    // attempts, so the signal has to come from inside its rename call.
    const short = holdFile(target, 0, { release, released });
    await short.held;
    const realRename = fs.renameSync;
    let refused = 0;
    fs.renameSync = (from, to) => {
      try {
        return realRename(from, to);
      } catch (err) {
        if (["EPERM", "EBUSY", "EACCES"].includes(err.code) && refused++ === 0) {
          writeFileSync(release, "");
          for (const deadline = Date.now() + 30_000; !existsSync(released) && Date.now() < deadline; ) {
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
          }
        }
        throw err;
      }
    };
    syncBuiltinESMExports();
    let shortCode;
    try {
      shortCode = writeStatusFile(target, "after\n", { attempts: 40, delayMs: 50 });
    } finally {
      fs.renameSync = realRename;
      syncBuiltinESMExports();
    }
    assert.ok(refused >= 1, "the write was refused at least once while the hold was in effect");
    assert.ok(existsSync(released), "the holder confirmed the release within 30 s");
    assert.equal(shortCode, null, "retried until the hold ended");
    assert.equal(readFileSync(target, "utf-8"), "after\n");
    await short.exited;

    const long = holdFile(target, 2000);
    await long.held;
    const code = writeStatusFile(target, "never\n", { attempts: 10, delayMs: 50 });
    assert.ok(["EPERM", "EBUSY", "EACCES"].includes(code), `expected a sharing error, got ${code}`);
    await long.exited;
    assert.equal(readFileSync(target, "utf-8"), "after\n", "the target is unchanged");
    assert.deepEqual(readdirSync(dir), [STATUS_FILE], "no temp file is left behind");
  } finally {
    writeFileSync(release, ""); // A failure before the first refusal would otherwise leave the holder waiting forever.
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    rmSync(signals, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

test("a status write that exhausts its retries is reported on background_job", { skip: process.platform !== "win32" && "Windows sharing modes" }, async () => {
  const m = await matter(1, { draft: true });
  try {
    const page = join(m.draftDir, STATUS_FILE);
    writeFileSync(page, "held\n");
    const hold = holdFile(page, 3000);
    await hold.held;
    const result = await bootstrap(m.dbPath, { ...CLIENT, draft_dir: m.draftDir });
    assert.equal(result.background_job.write_error?.target, page);
    await awaitBackgroundJobs();
    await hold.exited;
  } finally {
    m.cleanup();
  }
});
