// Records what every practice read tool answers for one practice.db, and compares two
// such records (migration steps 3 and 7 of docs/Plans/2026-10-14_practice-db-conversion.md).
//
//   node scripts/practice_read_snapshot.mjs snapshot <bundle.js> <practice.db> <out.json>
//   node scripts/practice_read_snapshot.mjs compare <before.json> <after.json>
//
// snapshot starts the bundle as an MCP server over stdio, with COCLERK_DB_PATH set to the
// file, and calls each read tool the plan lists: matter_lookup and read_signals for every
// matter, trust_summary, wip_hours, ar_data, open_tasks, active_deadlines (default and every
// include flag), time_entries_query, invoices_query, court_calendar_coverage,
// court_calendar_days, rule_overlay, manage_payment_in_flight query, and config_status.
// It writes no practice data, so the server is given a throwaway lock folder.
//
// compare exits 0 when the two agree up to the differences the plan's "Tool shapes" and
// step 5 allow, and prints every other difference:
//   - owner_id is gone from every row;
//   - read_signals no longer returns policies;
//   - a tag, state or link that is null is now omitted;
//   - rows are ordered by created_at then id (arrays are compared in a fixed order);
//   - the 1000-row caps are gone (a before array of exactly 1000 rows need only be within the after one);
//   - config_status gains cloud_credential and pending_writes.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PREFIX = "practice_data__";
const CAP = 1000;
// The fields that hold a tag, a state or a link in the item form: each is omitted now when null.
const OMITTABLE = new Set([
  "billable", "task_type", "anchor_type", "deadline_type", "source_type", "review_flag", "signal_key",
  "status_category", "amending_reg", "status", "state", "cleared", "client_id", "matter_id", "anchor_id", "filing_ref",
]);

// ---------------------------------------------------------------------------
// A minimal MCP client over stdio: newline-delimited JSON-RPC.
// ---------------------------------------------------------------------------

function startServer(bundle, dbPath, lockRoot) {
  const child = spawn(process.execPath, [bundle], {
    env: { ...process.env, COCLERK_DB_PATH: dbPath, COCLERK_SUBMISSION_LOCK_ROOT: lockRoot },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const waiting = new Map();
  let nextId = 1;
  let buffer = "";
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined && waiting.has(message.id)) {
        waiting.get(message.id)(message);
        waiting.delete(message.id);
      }
    }
  });
  const exited = new Promise((resolveExit) => child.on("exit", (code) => resolveExit(code)));
  exited.then((code) => {
    for (const settle of waiting.values()) settle({ error: { message: `the server exited (${code}): ${stderr.slice(-500)}` } });
    waiting.clear();
  });

  function send(message) {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }
  async function request(method, params) {
    const id = nextId++;
    const reply = await new Promise((settle) => {
      waiting.set(id, settle);
      send({ jsonrpc: "2.0", id, method, params });
    });
    if (reply.error) throw new Error(`${method}: ${reply.error.message}`);
    return reply.result;
  }
  return {
    request,
    notify: (method, params) => send({ jsonrpc: "2.0", method, params }),
    async close() {
      child.stdin.end();
      const timer = setTimeout(() => child.kill(), 5000);
      await exited;
      clearTimeout(timer);
    },
  };
}

async function snapshot(bundle, dbPath, outPath) {
  const lockRoot = mkdtempSync(join(tmpdir(), "practice-snapshot-locks-"));
  const server = startServer(resolve(bundle), resolve(dbPath), lockRoot);
  try {
    await server.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "practice-read-snapshot", version: "1" },
    });
    server.notify("notifications/initialized", {});
    const { tools } = await server.request("tools/list", {});
    const names = new Set(tools.map((tool) => tool.name));

    const calls = [];
    async function call(tool, args = {}) {
      const name = PREFIX + tool;
      if (!names.has(name)) throw new Error(`the bundle has no tool ${name}`);
      const reply = await server.request("tools/call", { name, arguments: args });
      const text = reply.content?.[0]?.text ?? "";
      let result;
      try {
        result = JSON.parse(text);
      } catch {
        result = text;
      }
      calls.push({ tool, args, error: reply.isError === true, result });
      return result;
    }

    const matters = (await call("trust_summary")).rows ?? [];
    await call("wip_hours");
    await call("ar_data");
    await call("open_tasks");
    await call("active_deadlines");
    await call("active_deadlines", { include_occurred: true, include_notified: true, include_dismissed: true, include_met: true });
    await call("time_entries_query");
    await call("invoices_query");
    await call("court_calendar_coverage");
    await call("court_calendar_days");
    await call("rule_overlay");
    await call("manage_payment_in_flight", { action: "query" });
    await call("config_status");
    for (const matter of matters) {
      await call("matter_lookup", { matter_id: matter.id });
      await call("read_signals", { matter_id: matter.id });
    }
    writeFileSync(outPath, `${JSON.stringify({ bundle: resolve(bundle), db: resolve(dbPath), taken_at: new Date().toISOString(), calls }, null, 2)}\n`);
    const errors = calls.filter((c) => c.error).length;
    console.log(`${calls.length} calls recorded to ${outPath} (${matters.length} matters, ${errors} errors).`);
  } finally {
    await server.close();
    rmSync(lockRoot, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// compare
// ---------------------------------------------------------------------------

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** owner_id dropped, null tags/states/links dropped, arrays put in one fixed order. */
function normalize(value) {
  if (Array.isArray(value)) {
    const items = value.map(normalize);
    const rows = items.length > 0 && items.every((item) => item !== null && typeof item === "object" && "id" in item);
    const key = rows ? (item) => `${item.created_at ?? ""}\u0000${item.id}` : canonical;
    return items.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  }
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === "owner_id") continue;
      if (v === null && OMITTABLE.has(k)) continue;
      out[k] = normalize(v);
    }
    return out;
  }
  return value;
}

function diff(before, after, path, out) {
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length === CAP && after.length > CAP) {
      const present = new Set(after.map(canonical));
      const lost = before.filter((item) => !present.has(canonical(item)));
      if (lost.length) out.push(`${path}: ${lost.length} of the ${CAP} capped rows are not in the uncapped answer`);
      return;
    }
    if (before.length !== after.length) {
      out.push(`${path}: ${before.length} rows before, ${after.length} after`);
      return;
    }
    before.forEach((item, i) => diff(item, after[i], `${path}[${i}]`, out));
    return;
  }
  const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (isObject(before) && isObject(after)) {
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!(k in after)) out.push(`${path}.${k}: gone (was ${canonical(before[k])})`);
      else if (!(k in before)) out.push(`${path}.${k}: new (${canonical(after[k])})`);
      else diff(before[k], after[k], `${path}.${k}`, out);
    }
    return;
  }
  if (canonical(before) !== canonical(after)) out.push(`${path}: ${canonical(before)} before, ${canonical(after)} after`);
}

function label(call) {
  return `${call.tool}(${canonical(call.args)})`;
}

function compare(beforePath, afterPath) {
  const load = (path) => new Map(JSON.parse(readFileSync(path, "utf8")).calls.map((call) => [label(call), call]));
  const before = load(beforePath);
  const after = load(afterPath);
  const differences = [];
  for (const name of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(name);
    const a = after.get(name);
    if (!b || !a) {
      differences.push(`${name}: only in the ${b ? "before" : "after"} snapshot`);
      continue;
    }
    let bResult = b.result;
    let aResult = a.result;
    if (b.tool === "read_signals" && bResult && typeof bResult === "object") {
      const { policies: _policies, ...rest } = bResult;
      bResult = rest;
    }
    if (a.tool === "config_status" && aResult && typeof aResult === "object") {
      const { cloud_credential: _credential, pending_writes: _pending, ...rest } = aResult;
      aResult = rest;
    }
    if (b.error !== a.error) differences.push(`${name}: ${b.error ? "an error" : "an answer"} before, ${a.error ? "an error" : "an answer"} after`);
    diff(normalize(bResult), normalize(aResult), name, differences);
  }
  for (const line of differences) console.log(line);
  console.log(`${before.size} calls compared: ${differences.length} difference(s) beyond those the plan allows.`);
  return differences.length === 0;
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === "snapshot" && rest.length === 3) {
  await snapshot(...rest);
} else if (mode === "compare" && rest.length === 2) {
  process.exitCode = compare(...rest) ? 0 : 1;
} else {
  console.error("usage: practice_read_snapshot.mjs snapshot <bundle.js> <practice.db> <out.json>\n" +
    "       practice_read_snapshot.mjs compare <before.json> <after.json>");
  process.exitCode = 2;
}
