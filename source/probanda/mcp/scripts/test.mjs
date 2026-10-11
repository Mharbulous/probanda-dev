// Tiered test runner (rules: test/README.md).
//
//   node scripts/test.mjs            all three tiers
//   node scripts/test.mjs unit       one or more named tiers
//   COCLERK_TEST_NO_BUDGETS=1        report over-budget files and tests without failing the run (CI:
//                                    the budgets are tuned to the local machine, not a 2-core runner)
//
// A file's tier is its filename suffix. Each file runs as its own `node --test` child so its wall
// time can be measured; the run fails on any test failure, or when a file or test exceeds its tier's budget.
// Expects a current build/ (package.json "test" runs tsc and the bundle first).

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEST_DIR = join(ROOT, "test");

// concurrency: files run at once. fileBudgetMs / testBudgetMs: the most one file / one test may
// take, measured in its tier. db budgets a test, not a file: a file's time grows with its test count.
// At concurrency 8 a db test runs about 2.5x slower than alone, with spikes to 25 s (2026-09-19).
const TIERS = {
  unit: { concurrency: Math.max(availableParallelism() - 1, 1), fileBudgetMs: 5_000, testBudgetMs: Infinity },
  db: { concurrency: 8, fileBudgetMs: Infinity, testBudgetMs: 30_000 },
  e2e: { concurrency: 1, fileBudgetMs: Infinity, testBudgetMs: Infinity },
};

const files = readdirSync(TEST_DIR).filter((f) => f.endsWith(".test.mjs"));
const tierOf = (f) => f.match(/\.(\w+)\.test\.mjs$/)?.[1];
const untiered = files.filter((f) => !(tierOf(f) in TIERS));
if (untiered.length) {
  console.error(`test files without a tier suffix (.unit/.db/.e2e.test.mjs): ${untiered.join(", ")}`);
  process.exit(1);
}

const requested = process.argv.slice(2);
for (const t of requested) {
  if (!(t in TIERS)) {
    console.error(`unknown tier "${t}"; expected one of: ${Object.keys(TIERS).join(", ")}`);
    process.exit(1);
  }
}
const tiers = requested.length ? requested : Object.keys(TIERS);

// Every backend reads COCLERK_PYTHON first; the pythoncore install starts faster than the
// WindowsApps python stub. Set before anything imports a backend, which reads it at load.
if (!process.env.COCLERK_PYTHON && process.env.LOCALAPPDATA) {
  const base = join(process.env.LOCALAPPDATA, "Python");
  const cores = existsSync(base) ? readdirSync(base).filter((d) => d.startsWith("pythoncore-")) : [];
  cores.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const python = cores.length && join(base, cores.at(-1), "python.exe");
  if (python && existsSync(python)) process.env.COCLERK_PYTHON = python;
}

// Build the migrated template once, so test processes copy it rather than race to build it.
if (tiers.some((t) => t !== "unit")) {
  const { submissionTemplate } = await import("../test/helpers/template-db.mjs");
  await submissionTemplate();
}

function runFile(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, ["--test", "--test-reporter=tap", join("test", file)], { cwd: ROOT, env: process.env });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => {
      const count = (label) => Number(output.match(new RegExp(`^# ${label} (\\d+)`, "m"))?.[1] ?? 0);
      // Each top-level TAP test line is followed by its YAML block, which opens with duration_ms.
      const tests = [...output.matchAll(/^(?:not )?ok \d+ - (.*)\r?\n  ---\r?\n  duration_ms: ([\d.]+)/gm)].map((m) => ({ name: m[1], ms: Number(m[2]) }));
      resolve({ file, ms: Date.now() - started, code, pass: count("pass"), fail: count("fail"), tests, output });
    });
  });
}

async function runTier(tier) {
  const { concurrency } = TIERS[tier];
  const queue = files.filter((f) => tierOf(f) === tier);
  const results = [];
  const started = Date.now();
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) results.push({ tier, ...(await runFile(queue.shift())) });
    })
  );
  const pass = results.reduce((n, r) => n + r.pass, 0);
  const fail = results.reduce((n, r) => n + r.fail, 0);
  console.log(`${tier}: ${results.length} files, ${pass} passed, ${fail} failed, ${((Date.now() - started) / 1000).toFixed(1)} s (concurrency ${concurrency})`);
  return results;
}

const results = [];
for (const tier of tiers) results.push(...(await runTier(tier)));

const failed = results.filter((r) => r.code !== 0);
for (const r of failed) console.log(`\n--- ${r.file} failed (exit ${r.code}) ---\n${r.output}`);

console.log("\nslowest files:");
for (const r of [...results].sort((a, b) => b.ms - a.ms).slice(0, 5)) console.log(`  ${(r.ms / 1000).toFixed(1).padStart(6)} s  ${r.file}`);

const enforceBudgets = process.env.COCLERK_TEST_NO_BUDGETS !== "1";
const over = [];
for (const r of results) {
  const { fileBudgetMs, testBudgetMs } = TIERS[r.tier];
  if (!r.tests.length && r.pass + r.fail) over.push(`${r.file}: no test durations found in its TAP output, so its tests cannot be budgeted`);
  if (r.ms > fileBudgetMs) over.push(`${r.file} took ${(r.ms / 1000).toFixed(1)} s, ${r.tier} file budget is ${fileBudgetMs / 1000} s`);
  for (const t of r.tests) {
    if (t.ms > testBudgetMs) over.push(`${r.file} "${t.name}" took ${(t.ms / 1000).toFixed(1)} s, ${r.tier} test budget is ${testBudgetMs / 1000} s`);
  }
}
for (const line of over) console.log(`over budget${enforceBudgets ? "" : " (not enforced)"}: ${line} (see test/README.md)`);

const pass = results.reduce((n, r) => n + r.pass, 0);
const fail = results.reduce((n, r) => n + r.fail, 0);
console.log(`\ntotal: ${pass} passed, ${fail} failed, ${failed.length} files failed, ${over.length} over budget${enforceBudgets ? "" : " (not enforced)"}`);
process.exit(failed.length || (enforceBudgets && over.length) ? 1 : 0);
