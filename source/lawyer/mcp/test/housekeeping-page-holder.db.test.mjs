import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import test from "node:test";

import { matterFixture, pageDeviceConfig, proposalFor, row, runDir } from "./helpers/housekeeping-fixture.mjs";

// When another process holds the file-manager page port, serve_page reads its /health: a
// Probanda holder on another build gets a warning, anything else fails naming page_ports.
process.env.COCLERK_CONFIG_PATH = await pageDeviceConfig();
const PORT = JSON.parse(readFileSync(process.env.COCLERK_CONFIG_PATH, "utf-8")).page_ports["file-manager"];

const { writeRunFile } = await import("../build/housekeeping/run-files.js");
const { closePageServer, servePage } = await import("../build/housekeeping/server.js");

const RUN = "20260924-100000-aaaa";
const LETTER = "2026-01-05 LF Smith re Settlement.pdf";

function servableMatter() {
  const m = matterFixture({ [LETTER]: "letter bytes" });
  mkdirSync(runDir(m, RUN), { recursive: true });
  const rows = [row(m, LETTER, { row_id: "r1", action: { kind: "move", folder: "3. CORRESPONDENCE" } })];
  writeRunFile(m.root, RUN, "proposal.json", JSON.stringify(proposalFor(m, RUN, rows)));
  return m;
}

/** Holds the page port with `handler` until the returned close is called. */
async function holder(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  return () => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  };
}

function health(body) {
  return (req, res) => {
    if (req.url !== "/health") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body));
  };
}

const probanda = (build_stamp) => ({ bundle: "file-manager", pid: 1, build_stamp, plugin_version: "1.0.0", kinds: ["housekeeping"] });

async function serveWhileHeld(handler) {
  const m = servableMatter();
  const release = await holder(handler);
  try {
    return await servePage(m.root, RUN);
  } finally {
    await closePageServer();
    await release();
    m.cleanup();
  }
}

test("a Probanda holder on another build gives the older_holder warning", async () => {
  const served = await serveWhileHeld(health(probanda("0123456789ab")));
  assert.equal(served.warning, "older_holder");
  assert.match(served.url, new RegExp(`^http://127\\.0\\.0\\.1:${PORT}/h/`));
});

test("a Probanda holder on this process's build gives no warning", async () => {
  // The unbundled test build carries no stamp, so a holder reporting null runs the same build.
  const served = await serveWhileHeld(health(probanda(null)));
  assert.equal("warning" in served, false);
});

test("a holder that is not Probanda fails naming page_ports", async () => {
  await assert.rejects(
    serveWhileHeld((_req, res) => res.writeHead(404).end("no")),
    (err) => err.code === "page_port_taken" && /page_ports/.test(err.message),
  );
  await assert.rejects(
    serveWhileHeld(health({ ok: true })),
    (err) => err.code === "page_port_taken" && /page_ports/.test(err.message),
  );
});

test("a holder that never answers fails within about a second", async () => {
  const sockets = new Set();
  const hung = createTcpServer((socket) => sockets.add(socket));
  await new Promise((resolve) => hung.listen(PORT, "127.0.0.1", resolve));
  const m = servableMatter();
  const started = Date.now();
  try {
    await assert.rejects(servePage(m.root, RUN), (err) => err.code === "page_port_taken" && /page_ports/.test(err.message));
    assert.ok(Date.now() - started < 2_500, `took ${Date.now() - started} ms`);
  } finally {
    await closePageServer();
    for (const s of sockets) s.destroy();
    await new Promise((resolve) => hung.close(resolve));
    m.cleanup();
  }
});

test("a free port gives no warning", async () => {
  const m = servableMatter();
  try {
    const served = await servePage(m.root, RUN);
    assert.equal("warning" in served, false);
  } finally {
    await closePageServer();
    m.cleanup();
  }
});
