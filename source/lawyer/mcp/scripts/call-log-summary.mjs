// Summarises the data server's tool-call timing log (src/call-log.ts): the slowest tools and phases,
// the calls in each session, and the gaps between one call's end and the next call's start in the same
// session, a rough measure of model time.
//
//   node scripts/call-log-summary.mjs                 the last 7 days, as text
//   node scripts/call-log-summary.mjs --days 14       a longer window
//   node scripts/call-log-summary.mjs --json          the same summary as JSON, for a skill
//   node scripts/call-log-summary.mjs --dir <folder>  another log folder (default: the server's own)
//
// A gap longer than IDLE_MS is counted as idle (the practitioner away), not model time.

import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const IDLE_MS = 10 * 60_000;
const FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

/** Every record in `dir` from the last `days` days, oldest first. Unreadable lines are skipped. */
export function readRecords(dir, days, now = new Date()) {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  const records = [];
  let names = [];
  try {
    names = readdirSync(dir).filter((n) => FILE.test(n)).sort();
  } catch {
    return records;
  }
  for (const name of names) {
    for (const line of readFileSync(join(dir, name), "utf-8").split("\n")) {
      try {
        const r = JSON.parse(line);
        if (r.t >= since) records.push(r);
      } catch {
        // A blank or torn line.
      }
    }
  }
  return records.sort((a, b) => a.t.localeCompare(b.t));
}

const round = (n) => Math.round(n * 10) / 10;
const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((s, v) => s + v, 0);
  return { n: sorted.length, total_ms: round(total), p50_ms: quantile(sorted, 0.5), p95_ms: quantile(sorted, 0.95), max_ms: sorted.at(-1) ?? 0 };
}

export function summarize(records) {
  const byTool = new Map();
  const byPhase = new Map();
  const bySession = new Map();
  for (const r of records) {
    if (!byTool.has(r.tool)) byTool.set(r.tool, { ms: [], refused: 0, error: 0 });
    const tool = byTool.get(r.tool);
    tool.ms.push(r.ms);
    if (r.outcome === "refused" || r.outcome === "error") tool[r.outcome] += 1;
    for (const p of r.phases ?? []) {
      if (p.phase === "total") continue;
      const key = `${r.tool} ${p.phase}`;
      if (!byPhase.has(key)) byPhase.set(key, []);
      byPhase.get(key).push(p.ms);
    }
    if (!bySession.has(r.session)) bySession.set(r.session, []);
    bySession.get(r.session).push(r);
  }

  const tools = [...byTool].map(([tool, v]) => ({ tool, ...stats(v.ms), refused: v.refused, error: v.error }))
    .sort((a, b) => b.total_ms - a.total_ms);
  const phases = [...byPhase].map(([phase, ms]) => ({ phase, ...stats(ms) }))
    .sort((a, b) => b.total_ms - a.total_ms);

  const sessions = [...bySession].map(([session, calls]) => {
    const gaps = [];
    let idle = 0;
    for (let i = 1; i < calls.length; i++) {
      const gap = Date.parse(calls[i].t) - (Date.parse(calls[i - 1].t) + calls[i - 1].ms);
      if (gap > IDLE_MS) idle += 1;
      else gaps.push(Math.max(0, gap));
    }
    const server = calls.reduce((s, c) => s + c.ms, 0);
    const g = stats(gaps);
    return {
      session, start: calls[0].t, calls: calls.length, server_ms: round(server),
      gap_ms: g.total_ms, gap_p50_ms: g.p50_ms, gap_max_ms: g.max_ms, idle_gaps: idle,
      builds: [...new Set(calls.map((c) => c.build))],
    };
  }).sort((a, b) => a.start.localeCompare(b.start));

  const server_ms = round(sessions.reduce((s, x) => s + x.server_ms, 0));
  const gap_ms = round(sessions.reduce((s, x) => s + x.gap_ms, 0));
  return {
    calls: records.length,
    sessions: sessions.length,
    server_ms,
    gap_ms,
    server_share: server_ms + gap_ms ? Math.round((100 * server_ms) / (server_ms + gap_ms)) / 100 : null,
    tools,
    phases: phases.slice(0, 15),
    by_session: sessions,
  };
}

function table(rows, columns) {
  const widths = columns.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c]).length)));
  const line = (cells) => cells.map((v, i) => String(v).padEnd(widths[i])).join("  ");
  return [line(columns), ...rows.map((r) => line(columns.map((c) => r[c])))].join("\n");
}

export function render(summary) {
  const s = (ms) => `${round(ms / 1000)} s`;
  return [
    `${summary.calls} calls in ${summary.sessions} sessions. Server time ${s(summary.server_ms)}, time between calls ${s(summary.gap_ms)}` +
      (summary.server_share === null ? "." : ` (server ${Math.round(summary.server_share * 100)}%).`),
    "",
    "Slowest tools (by total time):",
    table(summary.tools.slice(0, 15), ["tool", "n", "total_ms", "p50_ms", "p95_ms", "max_ms", "refused", "error"]),
    "",
    "Slowest reported phases:",
    summary.phases.length ? table(summary.phases, ["phase", "n", "total_ms", "p50_ms", "max_ms"]) : "(none)",
    "",
    `Sessions (gaps over ${IDLE_MS / 60_000} min count as idle):`,
    table(summary.by_session, ["start", "calls", "server_ms", "gap_ms", "gap_p50_ms", "gap_max_ms", "idle_gaps"]),
  ].join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const opt = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const dir = opt("--dir") ?? join(process.env.LOCALAPPDATA || homedir(), "Coclerk", "call-log");
  const summary = summarize(readRecords(dir, Number(opt("--days") ?? 7)));
  console.log(args.includes("--json") ? JSON.stringify(summary, null, 2) : render(summary));
}
