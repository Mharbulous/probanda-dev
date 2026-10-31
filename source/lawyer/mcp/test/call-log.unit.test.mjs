// The tool-call timing log (src/call-log.ts, docs/ADRs/0016-tool-call-timing-log.md): a call is
// recorded, no argument or reply content is stored, retention and the size cap prune, the setting turns
// it off, and a log that cannot be written never fails the call. Also its reader's summary.

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { withCallLog, callLogDir, maskPhase, prune } = await import("../build/call-log.js");
const { dispatchTool } = await import("../build/dispatch.js");
const { summarize, readRecords } = await import("../scripts/call-log-summary.mjs");

const SECRET = "Smith v Jones";
const NAMES = new Set(["drafting_forms__open_session", "matter_data__query"]);
const settled = () => new Promise((resolve) => setImmediate(() => setImmediate(resolve)));
const okReply = (body) => ({ content: [{ type: "text", text: JSON.stringify(body, null, 2) }] });

function sandbox(settings = {}) {
  const root = mkdtempSync(join(tmpdir(), "call-log-"));
  const config = join(root, "probanda.json");
  writeFileSync(config, JSON.stringify(settings));
  return { root, env: { LOCALAPPDATA: root, APPDATA: root, COCLERK_CONFIG_PATH: config, CLAUDE_CODE_SESSION_ID: "s-1" } };
}

function records(env) {
  const dir = callLogDir(env);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => readFileSync(join(dir, f), "utf-8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)));
}

test("a call is recorded with its tool, time, outcome, size, phases, build and hashed session", async () => {
  const { env } = sandbox();
  const reply = okReply({ ok: true, timings: [{ phase: "schema_check", ms: 1.5 }, { phase: "total", ms: 9 }] });
  const call = withCallLog(async () => reply, NAMES, env);
  assert.equal(await call("drafting_forms__open_session", {}), reply);
  await settled();
  const [r, ...rest] = records(env);
  assert.equal(rest.length, 0);
  assert.equal(r.tool, "drafting_forms__open_session");
  assert.equal(r.outcome, "ok");
  assert.equal(r.bytes, Buffer.byteLength(reply.content[0].text));
  assert.ok(typeof r.ms === "number" && r.ms >= 0);
  assert.ok(!Number.isNaN(Date.parse(r.t)));
  assert.deepEqual(r.phases, [{ phase: "schema_check", ms: 1.5 }, { phase: "total", ms: 9 }]);
  assert.ok("build" in r);
  assert.match(r.session, /^[0-9a-f]{16}$/);
  assert.notEqual(r.session, "s-1");
});

test("no argument, reply content, path or unknown tool name reaches the log", async () => {
  const { env } = sandbox();
  const reply = okReply({
    party: SECRET,
    path: `C:\\Users\\x\\0. CASE DATA\\${SECRET}`,
    timings: [{ phase: `open: write ${SECRET}.md`, ms: 2 }, { phase: `write Notice of ${SECRET}.md`, ms: 3 }, { phase: `${SECRET}`, ms: 1 }],
  });
  const call = withCallLog(async () => reply, NAMES, env);
  await call("drafting_forms__open_session", { matter_root: `C:\\${SECRET}`, sql: `SELECT '${SECRET}'` });
  await call("smith_v_jones__secret", { note: SECRET });
  await settled();
  const text = readdirSync(callLogDir(env)).map((f) => readFileSync(join(callLogDir(env), f), "utf-8")).join("");
  for (const leak of ["Smith", "Jones", "CASE DATA", "SELECT", "secret", "Users"]) assert.ok(!text.includes(leak), `log holds ${leak}`);
  const [first, second] = records(env);
  assert.deepEqual(first.phases, [{ phase: "open: write *", ms: 2 }, { phase: "write *", ms: 3 }, { phase: "*", ms: 1 }]);
  assert.equal(second.tool, "unknown");
  assert.deepEqual(Object.keys(first).sort(), ["build", "bytes", "ms", "outcome", "phases", "session", "t", "tool"]);
});

test("maskPhase keeps code-written phase names and cuts anything else to its verb", () => {
  assert.equal(maskPhase("bootstrap (before migrate): schema_check"), "bootstrap (before migrate): schema_check");
  assert.equal(maskPhase("move case-data mockups"), "move case-data mockups");
  assert.equal(maskPhase("render Witness statements"), "render *");
  assert.equal(maskPhase("Ms. Smith"), "*");
});

test("a tool's refusal is refused, a fault is error, and both keep only the error code", async () => {
  const { env } = sandbox();
  const call = withCallLog((name, args) => dispatchTool({}, name, args), new Set(["matter_data__query"]), env);
  const refused = await call("matter_data__query", { matter_root: 1 });
  assert.equal(refused.isError, true);
  const throwing = withCallLog(async () => { throw new Error(SECRET); }, NAMES, env);
  await assert.rejects(throwing("matter_data__query", {}));
  await settled();
  const [a, b] = records(env);
  assert.equal(a.outcome, "refused");
  assert.match(a.code, /^[a-z_]+$/);
  assert.equal(b.outcome, "error");
  assert.ok(!JSON.stringify(records(env)).includes("Smith"));
});

test("retention deletes files older than 14 days, and the size cap deletes the oldest, never today's", () => {
  const dir = mkdtempSync(join(tmpdir(), "call-log-prune-"));
  const put = (day, bytes) => writeFileSync(join(dir, `${day}.jsonl`), "x".repeat(bytes));
  put("2026-10-01", 10);
  put("2026-10-17", 10);
  put("2026-10-20", 400);
  put("2026-10-25", 400);
  put("2026-10-31", 900);
  writeFileSync(join(dir, "notes.txt"), "kept");
  prune(dir, "2026-10-31", 1000);
  assert.deepEqual(readdirSync(dir).sort(), ["2026-10-31.jsonl", "notes.txt"]);
  prune(dir, "2026-10-31", 10);
  assert.ok(existsSync(join(dir, "2026-10-31.jsonl")), "today's file is never pruned");
});

test("the size cap keeps the newest days that fit", () => {
  const dir = mkdtempSync(join(tmpdir(), "call-log-cap-"));
  for (const day of ["2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]) writeFileSync(join(dir, `${day}.jsonl`), "x".repeat(300));
  prune(dir, "2026-10-31", 700);
  assert.deepEqual(readdirSync(dir).sort(), ["2026-10-30.jsonl", "2026-10-31.jsonl"]);
});

test('"timing_log": false turns the log off', async () => {
  const { env } = sandbox({ timing_log: false });
  const dispatch = async () => okReply({ ok: true });
  assert.equal(withCallLog(dispatch, NAMES, env), dispatch);
  await withCallLog(dispatch, NAMES, env)("matter_data__query", {});
  await settled();
  assert.equal(existsSync(callLogDir(env)), false);
});

test("a log that cannot be written never fails or slows the call", async () => {
  const { root, env } = sandbox();
  const blocker = join(root, "not-a-folder");
  writeFileSync(blocker, "");
  const reply = okReply({ ok: true });
  const call = withCallLog(async () => reply, NAMES, { ...env, LOCALAPPDATA: blocker });
  assert.equal(await call("matter_data__query", {}), reply);
  await settled();
  assert.equal(statSync(blocker).isFile(), true);
});

test("the summary ranks tools, groups sessions and measures the gaps between calls", () => {
  const at = (s) => new Date(Date.UTC(2026, 9, 31, 9, 0, s)).toISOString();
  const recs = [
    { t: at(0), tool: "drafting_forms__open_session", ms: 3000, outcome: "ok", bytes: 10, build: "b", session: "A",
      phases: [{ phase: "open: matter_pages", ms: 1700 }, { phase: "total", ms: 3000 }] },
    { t: at(10), tool: "matter_data__query", ms: 100, outcome: "ok", bytes: 5, build: "b", session: "A" },
    { t: at(20), tool: "matter_data__query", ms: 300, outcome: "refused", code: "data_error", bytes: 5, build: "b", session: "A" },
    { t: at(5), tool: "matter_data__query", ms: 200, outcome: "ok", bytes: 5, build: "b", session: "B" },
  ];
  const s = summarize(recs);
  assert.equal(s.calls, 4);
  assert.equal(s.sessions, 2);
  assert.equal(s.tools[0].tool, "drafting_forms__open_session");
  assert.equal(s.tools[1].refused, 1);
  assert.equal(s.phases[0].phase, "drafting_forms__open_session open: matter_pages");
  const a = s.by_session.find((x) => x.session === "A");
  assert.equal(a.calls, 3);
  assert.equal(a.server_ms, 3400);
  assert.equal(a.gap_ms, 7000 + 9900);
  assert.equal(s.server_share, Math.round((100 * 3600) / (3600 + 16900)) / 100);
});

test("the reader skips torn lines and files outside the window", () => {
  const dir = mkdtempSync(join(tmpdir(), "call-log-read-"));
  const now = new Date("2026-10-31T12:00:00Z");
  writeFileSync(join(dir, "2026-10-31.jsonl"), `${JSON.stringify({ t: "2026-10-31T11:00:00.000Z", ms: 1, session: "A", tool: "x" })}\n{"t":"2026-10-31T11:0`);
  writeFileSync(join(dir, "2026-10-01.jsonl"), `${JSON.stringify({ t: "2026-10-01T11:00:00.000Z", ms: 1, session: "A", tool: "x" })}\n`);
  assert.equal(readRecords(dir, 7, now).length, 1);
});
