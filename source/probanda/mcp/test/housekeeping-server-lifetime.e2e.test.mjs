// The approval page server must never keep the process alive: once stdio closes, the data
// server exits and the page stops working with the session that made it (spec §B8.3).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const HERE = dirname(fileURLToPath(import.meta.url));
const url = (...parts) => JSON.stringify(pathToFileURL(join(HERE, ...parts)).href);

test("a process that served a page, and fetched it over a keep-alive socket, still exits on its own", () => {
  const code = `
    const f = await import(${url("helpers", "housekeeping-fixture.mjs")});
    const { writeRunFile } = await import(${url("..", "build", "housekeeping", "run-files.js")});
    const { servePage } = await import(${url("..", "build", "housekeeping", "server.js")});
    const { mkdirSync } = await import("node:fs");
    const m = f.matterFixture({ "a.pdf": "a" });
    const run = "20260924-100000-aaaa";
    mkdirSync(f.runDir(m, run), { recursive: true });
    const row = f.row(m, "a.pdf", { action: { kind: "file", name: "2026-01-05 LF Smith re A.pdf", folder: "3. CORRESPONDENCE" } });
    writeRunFile(m.root, run, "proposal.json", JSON.stringify(f.proposalFor(m, run, [row])));
    const { url } = await servePage(m.root, run);
    const res = await fetch(url, { headers: { connection: "keep-alive" } });
    await res.text();
    m.cleanup();
    console.log("served " + res.status);
  `;
  const started = Date.now();
  const out = spawnSync(process.execPath, ["--input-type=module", "-e", code], { encoding: "utf-8", timeout: 15_000 });
  assert.equal(out.error, undefined, "the child did not exit on its own");
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /served 200/);
  assert.ok(Date.now() - started < 10_000);
});
