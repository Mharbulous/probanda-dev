// Checks the deployed items functions (items-write, items-sync, items-seed)
// against two fresh random tenants, then deletes both tenants' ledger rows.
//
//   node cloud/items/tools/check_items.mjs [--workdir <dir>]
//
// The secret key is the stored commons credential (the DPAPI file), loaded by
// the commons server's own config code. It is never printed. The cleanup runs
// the Supabase CLI (`db query --linked`) with --workdir set to the directory
// given, or a fresh temporary one, so no supabase/.temp lands in the repo.
// Prints one PASS or FAIL line per check and exits non-zero on any failure.

import { createHmac, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { register } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT_REF = "nbzkuhgiqscjkypedqff";
const CLI = process.env.SUPABASE_CLI_JS || join(homedir(), "tools/supabase-cli/node_modules/supabase/dist/supabase.js");
const workdirArg = process.argv.indexOf("--workdir");
const WORKDIR = workdirArg > 0 ? process.argv[workdirArg + 1] : mkdtempSync(join(tmpdir(), "items-check-"));

register("./ts-js-hook.mjs", import.meta.url);
const { loadLegalCommonsConfig } = await import(
  new URL("../../../source/research/commons-mcp/src/legal-commons/config.ts", import.meta.url).href
);
// The shell may hold a stale key; the stored file holds the working one.
const config = await loadLegalCommonsConfig({ ...process.env, LEGAL_COMMONS_SUPABASE_KEY: "", SUPABASE_SERVICE_ROLE_KEY: "" });
if (!config.staticKey) {
  console.error("No stored commons credential could be loaded. Nothing was checked.");
  process.exit(2);
}
const KEY = config.staticKey;
const BASE = `${config.supabaseUrl}/functions/v1`;

let failures = 0;
const bodies = [];
function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? ` (${detail})` : ""}`);
}

async function post(fn, body, key = KEY) {
  const headers = { "Content-Type": "application/json" };
  if (key !== null) headers.apikey = key;
  const res = await fetch(`${BASE}/${fn}`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  bodies.push(text);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, text, json };
}

// Field hashes: HMAC-SHA256 of each value's JSON under a test key, as the plugin will send them.
const hashKey = Buffer.from(randomUUID());
const hash = (value) => (value === null ? null : createHmac("sha256", hashKey).update(JSON.stringify(value)).digest("hex"));
const hashes = (fields) => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, hash(v)]));

const tenantA = randomUUID();
const tenantB = randomUUID();
const writeResponses = [];
async function write(body) {
  const r = await post("items-write", body);
  writeResponses.push(r);
  return r;
}

function clientMatterOps(clientId, matterId, n) {
  return [
    { op: "upsert", id: clientId, kind: "client", hashes: hashes({ name: `Test client ${n}`, client_num: `C${n}` }) },
    {
      op: "upsert", id: matterId, kind: "matter", state: "active", tags: { billable: true }, links: { client: clientId },
      hashes: hashes({ description: `Test matter ${n}`, file_number: `F${n}`, matt_num: `M${n}` }),
    },
  ];
}
const taskOp = (id, matterId, filing) => ({
  op: "create", id, kind: "task", state: "open", tags: { task_type: "client" },
  links: { matter: matterId, filing }, hashes: hashes({ description: `Test to-do ${id}` }),
});

async function run() {
  // 1. A saved write.
  const clientId = randomUUID();
  const matterId = randomUUID();
  const w1 = {
    tenant: tenantA, write_id: randomUUID(), store: "practice", tool: "upsert_client_matter", intent: {},
    ops: clientMatterOps(clientId, matterId, 1),
  };
  const r1 = await write(w1);
  check("1 saved write (upsert_client_matter)",
    r1.status === 200 && r1.json?.saved === true && r1.json.ops?.length === 2 &&
      r1.json.ops.every((o) => o.saved === true) && r1.json.ops[1].as === matterId && Number.isInteger(r1.json.seq),
    `status ${r1.status}`);

  // 2. A refused write: a second open to-do on the same matter and filing.
  const filing = `filing:${randomUUID()}`;
  const task1 = randomUUID();
  const task2 = randomUUID();
  const r2a = await write({ tenant: tenantA, write_id: randomUUID(), store: "practice", tool: "upsert_task", intent: {},
    ops: [taskOp(task1, matterId, filing)] });
  check("2a first open to-do saved", r2a.status === 200 && r2a.json?.saved === true, `status ${r2a.status}`);
  const w2b = { tenant: tenantA, write_id: randomUUID(), store: "practice", tool: "upsert_task", intent: {},
    ops: [taskOp(task2, matterId, filing)] };
  const r2b = await write(w2b);
  check("2b second open to-do refused with a question",
    r2b.status === 200 && r2b.json?.saved === false && typeof r2b.json.question === "string" &&
      r2b.json.question.endsWith("?") && r2b.json.question.includes(`{{item:${task1}}}`),
    `status ${r2b.status}`);

  // 3. A repeated write_id returns the stored result byte-identical.
  const r3a = await write(w1);
  check("3a repeated saved write_id returns the stored result byte-identical", r3a.status === 200 && r3a.text === r1.text);
  const r3b = await write(w2b);
  check("3b repeated refused write_id returns the stored result byte-identical", r3b.status === 200 && r3b.text === r2b.text);

  // 4. A wrong key and no key are refused with 401.
  const r4a = await post("items-write", w1, `sb_secret_${randomUUID().replaceAll("-", "")}`);
  check("4a wrong key refused with 401", r4a.status === 401, `status ${r4a.status}`);
  const r4b = await post("items-write", w1, null);
  check("4b no key refused with 401", r4b.status === 401, `status ${r4b.status}`);

  // Interface refusals: a body that is not JSON, and a write with no tenant.
  const rNotJson = await post("items-write", "{not json");
  writeResponses.push(rNotJson);
  check("4c body that is not JSON refused with a question",
    rNotJson.json?.saved === false && typeof rNotJson.json.question === "string", `status ${rNotJson.status}`);
  const rNoTenant = await write({ ...w1, tenant: undefined, write_id: randomUUID() });
  check("4d write with no tenant refused with a question",
    rNoTenant.json?.saved === false && typeof rNoTenant.json.question === "string", `status ${rNoTenant.status}`);
  const rSyncNoTenant = await post("items-sync", { store: "practice", since: 0 });
  check("4e sync with no tenant refused with a question",
    rSyncNoTenant.json?.saved === false && typeof rSyncNoTenant.json.question === "string", `status ${rSyncNoTenant.status}`);

  // 5. Every write response's top-level keys are a subset of saved, ops, seq, question.
  const allowed = new Set(["saved", "ops", "seq", "question"]);
  const badKeys = writeResponses.filter((r) => !r.json || Object.keys(r.json).some((k) => !allowed.has(k)));
  check(`5 write response keys within saved, ops, seq, question (${writeResponses.length} responses)`, badKeys.length === 0,
    `${badKeys.length} responses with other keys`);

  // 6. items-sync from 0 returns the items written, with their states, tags and links.
  const r6 = await post("items-sync", { tenant: tenantA, store: "practice", since: 0 });
  const items = Object.fromEntries((r6.json?.items ?? []).map((i) => [i.id, i]));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check("6 sync from 0 returns the items written with their states, tags and links",
    r6.status === 200 && r6.json.items.length === 3 && !items[task2] &&
      items[clientId]?.kind === "client" && items[clientId].state === null && same(items[clientId].links, {}) &&
      items[matterId]?.kind === "matter" && items[matterId].state === "active" &&
      same(items[matterId].tags, { billable: true }) && same(items[matterId].links, { client: clientId }) &&
      items[task1]?.kind === "task" && items[task1].state === "open" && same(items[task1].tags, { task_type: "client" }) &&
      same(items[task1].links, { filing, matter: matterId }) &&
      Object.values(items).every((i) => i.deleted === false) && r6.json.seq >= r2a.json.seq,
    `status ${r6.status}, ${r6.json?.items?.length} items`);

  // 7. items-seed on a second tenant: a clashing pair gets a question; a second seed is refused.
  const sClient = randomUUID();
  const sMatter = randomUUID();
  const sTask1 = randomUUID();
  const sTask2 = randomUUID();
  const sFiling = `filing:${randomUUID()}`;
  const strip = ({ op: _op, ...item }) => item;
  const seedItems = [
    ...clientMatterOps(sClient, sMatter, 2).map(strip),
    strip(taskOp(sTask1, sMatter, sFiling)),
    strip(taskOp(sTask2, sMatter, sFiling)),
  ];
  const r7a = await post("items-seed", { tenant: tenantB, store: "practice", items: seedItems });
  check("7a seed records the items and asks about the clashing pair",
    r7a.status === 200 && r7a.json?.seeded === 4 && r7a.json.questions?.length === 1 &&
      r7a.json.questions[0].id === sTask2 && r7a.json.questions[0].question.includes(`{{item:${sTask1}}}`),
    `status ${r7a.status}, seeded ${r7a.json?.seeded}, ${r7a.json?.questions?.length} questions`);
  const r7b = await post("items-seed", { tenant: tenantB, store: "practice", items: seedItems });
  check("7b second seed of the same tenant refused",
    r7b.status === 200 && r7b.json?.seeded === 0 && r7b.json.questions?.length === 1 && r7b.json.questions[0].id === null,
    `status ${r7b.status}`);
  const r7c = await post("items-sync", { tenant: tenantB, store: "practice", since: 0 });
  check("7c sync of the seeded tenant returns the four items", r7c.status === 200 && r7c.json?.items?.length === 4,
    `status ${r7c.status}`);

  // 9. Contacts (ADR 0009): a matter opened with a client contact, an affiliation, and a linked contact's delete.
  const cClient = randomUUID();
  const cMatter = randomUUID();
  const person = randomUUID();
  const role = randomUUID();
  const r9a = await write({ tenant: tenantA, write_id: randomUUID(), store: "practice", tool: "upsert_client_matter", intent: {},
    ops: [
      ...clientMatterOps(cClient, cMatter, 3),
      { op: "create", id: person, kind: "contact", tags: { entity: "person" }, hashes: hashes({ name: "Test person 3" }) },
      { op: "upsert", id: role, kind: "matter_role", tags: { role: "client" }, links: { matter: cMatter, contact: person },
        hashes: hashes({ from: "2026-10-16", case_proceeding_id: null }) },
    ] });
  check("9a matter opened with a client contact: contact and matter_role saved in the same write",
    r9a.status === 200 && r9a.json?.saved === true && r9a.json.ops?.length === 4 && r9a.json.ops.every((o) => o.saved === true) &&
      r9a.json.ops[2].as === person && r9a.json.ops[3].as === role,
    `status ${r9a.status}, ${r9a.text.slice(0, 200)}`);
  const org = randomUUID();
  const affiliation = randomUUID();
  const r9b = await write({ tenant: tenantA, write_id: randomUUID(), store: "practice", tool: "upsert_affiliation", intent: {},
    ops: [
      { op: "create", id: org, kind: "contact", tags: { entity: "organization" }, hashes: hashes({ name: "Test org 3" }) },
      { op: "upsert", id: affiliation, kind: "affiliation", links: { person, organization: org }, hashes: hashes({ from: null }) },
    ] });
  check("9b affiliation saved", r9b.status === 200 && r9b.json?.saved === true && r9b.json.ops?.[1]?.as === affiliation,
    `status ${r9b.status}, ${r9b.text.slice(0, 200)}`);
  const r9c = await write({ tenant: tenantA, write_id: randomUUID(), store: "practice", tool: "delete_contact", intent: {},
    ops: [{ op: "delete", id: person, kind: "contact" }] });
  check("9c delete of a contact still linked refused with a question",
    r9c.status === 200 && r9c.json?.saved === false && typeof r9c.json.question === "string" &&
      r9c.json.question.endsWith("?") && r9c.json.question.includes(`{{item:${person}}}`),
    `status ${r9c.status}, ${r9c.text.slice(0, 200)}`);
}

// The cleanup: delete both tenants' ledger rows, then count what remains.
function query(sqlText) {
  const res = spawnSync(process.execPath, [CLI, "db", "query", "--linked", "--project-ref", PROJECT_REF,
    "--workdir", WORKDIR, "--output-format", "json", sqlText], { encoding: "utf8" });
  if (res.status !== 0) throw new Error(`supabase db query exited ${res.status}: ${(res.stderr ?? "").trim().slice(0, 300)}`);
  return JSON.parse(res.stdout).rows;
}

function cleanup() {
  const ids = `('${tenantA}', '${tenantB}')`;
  query(`delete from ledger.item where tenant in ${ids};
delete from ledger.write_result where tenant in ${ids};
delete from ledger.tenant where tenant in ${ids};`);
  const [row] = query(`select
  (select count(*) from ledger.item where tenant in ${ids})::int as item,
  (select count(*) from ledger.write_result where tenant in ${ids})::int as write_result,
  (select count(*) from ledger.tenant where tenant in ${ids})::int as tenant`);
  check(`cleanup: no ledger rows remain for either test tenant (item ${row.item}, write_result ${row.write_result}, tenant ${row.tenant})`,
    row.item === 0 && row.write_result === 0 && row.tenant === 0);
}

try {
  await run();
} catch (err) {
  check("the sequence ran to the end", false, err.message);
} finally {
  // 8. A crude Commandment 6 guard: no reply states a rule in these words.
  const ruleWords = /\b(must|only|allowed|cannot|at most|at least|required)\b/i;
  const stating = bodies.filter((b) => ruleWords.test(b));
  check(`8 no reply uses a rule-stating word (${bodies.length} replies)`, stating.length === 0,
    stating.map((b) => b.match(ruleWords)[0]).join(", "));
  try {
    cleanup();
  } catch (err) {
    check("cleanup ran", false, err.message);
  }
}
process.exit(failures ? 1 : 0);
