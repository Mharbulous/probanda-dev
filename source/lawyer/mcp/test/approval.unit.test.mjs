// The approval a gated tool checks itself (src/approval/gate.ts): the hook's proof, the approval
// page and its click, and agreement with the approval hook (source/skills/shared/scripts/approval_gate.py)
// on the sentences and the proof. The device secret is a scratch one.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const SCRATCH = mkdtempSync(join(tmpdir(), "probanda-approval-"));
const SAVED = { APPDATA: process.env.APPDATA, COCLERK_CONFIG_PATH: process.env.COCLERK_CONFIG_PATH };
process.env.APPDATA = SCRATCH;
delete process.env.COCLERK_CONFIG_PATH;
const SECRET = Buffer.alloc(32, 7);
mkdirSync(join(SCRATCH, "Probanda"), { recursive: true });
writeFileSync(join(SCRATCH, "Probanda", "page-api.secret"), SECRET);
after(() => {
  for (const [key, value] of Object.entries(SAVED)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(SCRATCH, { recursive: true, force: true });
});

const { canonicalJson, gated, proofFor } = await import("../build/approval/gate.js");
const { APPROVAL_TOOLS, firstLine, warning } = await import("../build/approval/acts.js");

const SHARED_SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "skills", "shared", "scripts");
const SAMPLES = {
  "mail__dedupe_apply": { plan_id: "ab12", expected_count: 4 },
  "contacts__write_probe": {},
  "contacts__import_apply": { plan_id: "cd34", create_count: 12, update_count: 3 },
  "contacts__merge_apply": { plan_id: "ef56", group_count: 2, remove_count: 3 },
  "contacts__restore_card": { name: "Ben  Sample", path: "D:\\cards\\b.vcf" },
};

/** One request to the approval page; resolves {status, body}. */
function send(url, { method = "GET", body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers, agent: false }, (res) => {
      let text = "";
      res.setEncoding("utf-8");
      res.on("data", (chunk) => (text += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: text }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

const nonceOf = (html) => /const nonce="([0-9a-f]+)"/.exec(html)[1];
const click = (url, nonce, extra = {}) => send(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: new URL(url).origin, ...extra },
  body: JSON.stringify({ nonce }),
});

test("the sentences and the proof agree with the approval hook's", () => {
  assert.deepEqual([...APPROVAL_TOOLS].sort(), Object.keys(SAMPLES).sort());
  const script = [
    "import json, sys",
    `sys.path.insert(0, ${JSON.stringify(SHARED_SCRIPTS)})`,
    "import approval_gate as g",
    "samples, secret = json.loads(sys.stdin.read()), bytes.fromhex(sys.argv[1])",
    "out = {}",
    "for tool, args in samples.items():",
    "    name = 'mcp__plugin_lawyer_contacts-calendars-email__' + tool",
    "    out[tool] = {'first_line': g.first_line(name, args), 'refusal': g.refusal(name, args, '0' * 64, 'x'),",
    "                 'proof': g.proof(g.own_check(name), args, secret)}",
    "print(json.dumps(out))",
  ].join("\n");
  // The machine's own APPDATA: Windows' python launcher keeps its settings there.
  const env = { ...process.env, APPDATA: SAVED.APPDATA };
  if (SAVED.APPDATA === undefined) delete env.APPDATA;
  const python = JSON.parse(execFileSync(process.env.COCLERK_PYTHON || "python", ["-c", script, SECRET.toString("hex")],
    { input: JSON.stringify(SAMPLES), encoding: "utf-8", env }));
  for (const [tool, args] of Object.entries(SAMPLES)) {
    assert.equal(firstLine(tool, args), python[tool].first_line, tool);
    assert.ok(python[tool].refusal.includes(warning(tool)), `${tool}: warning`);
    assert.equal(proofFor(tool, args, process.env), python[tool].proof, `${tool}: proof`);
  }
  assert.equal(canonicalJson({ b: [1, "é"], a: { d: null, c: true } }), '{"a":{"c":true,"d":null},"b":[1,"é"]}');
});

test("a call runs with the hook's proof for exactly its arguments, which the tool never sees", async () => {
  const runs = [];
  const tool = gated("contacts__import_apply", async (args) => (runs.push(args), { done: true }));
  const args = { plan_id: "p1", create_count: 1, update_count: 0 };
  assert.deepEqual(await tool.handler({ ...args, approval_proof: proofFor("contacts__import_apply", args, process.env) }), { done: true });
  assert.deepEqual(runs, [args]);
  const wrong = await tool.handler({ ...args, create_count: 2, approval_proof: proofFor("contacts__import_apply", args, process.env) });
  assert.equal(wrong.status, "approval_needed", "a proof for other arguments is no approval");
  const otherTool = await tool.handler({ ...args, approval_proof: proofFor("contacts__merge_apply", args, process.env) });
  assert.equal(otherTool.status, "approval_needed", "a proof for another tool is no approval");
  assert.equal(runs.length, 1);
});

test("without a proof the tool changes nothing until Approve is clicked on its page, once per click", async () => {
  const runs = [];
  const tool = gated("contacts__restore_card", async (args) => (runs.push(args), { restored: args.name }));
  const needed = await tool.handler({ name: "Ben Sample" });
  assert.equal(needed.status, "approval_needed");
  assert.match(needed.url, /^http:\/\/127\.0\.0\.1:\d+\/approve\/[0-9a-f]{48}$/);
  assert.deepEqual(runs, []);

  const page = await send(needed.url);
  assert.equal(page.status, 200);
  assert.ok(page.body.includes("This step: put the contact Ben Sample back in the address book"));
  const nonce = nonceOf(page.body);

  assert.equal((await click(needed.url, "0".repeat(48))).status, 403, "a wrong value");
  assert.equal((await click(needed.url, nonce, { Origin: "https://example.test" })).status, 403, "another site");
  assert.equal((await click(needed.url, nonce, { "Content-Type": "text/plain" })).status, 403, "a plain form post");
  assert.equal((await click(needed.url, nonce, { Host: "evil.test" })).status, 403, "another host name");
  assert.deepEqual(runs, []);

  assert.equal((await click(needed.url, nonce)).status, 200);
  assert.equal((await send(needed.url)).status, 404, "a used link is gone");
  assert.equal((await tool.handler({ name: "Ada Sample" })).status, "approval_needed", "the click approves only its own call");
  assert.deepEqual(await tool.handler({ name: "Ben Sample" }), { restored: "Ben Sample" });
  assert.equal((await tool.handler({ name: "Ben Sample" })).status, "approval_needed", "a click is used once");
  assert.equal(runs.length, 1);
});

test("only the newest page link works, and a click is kept when the approved call fails", async () => {
  let fail = true;
  const tool = gated("contacts__write_probe", async () => {
    if (fail) throw new Error("the server did not answer");
    return { can_write: true };
  });
  const first = await tool.handler({});
  const second = await tool.handler({});
  assert.equal((await send(first.url)).status, 404);
  assert.equal((await click(second.url, nonceOf((await send(second.url)).body))).status, 200);
  await assert.rejects(tool.handler({}), /did not answer/);
  fail = false;
  assert.deepEqual(await tool.handler({}), { can_write: true });
});
