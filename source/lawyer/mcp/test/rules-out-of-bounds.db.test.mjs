// Out of bounds on the real /draft map (rules-DAG plan step 7.4; spec §4.6). A scripted session
// holds a job, works it, then jumps out of bounds. rules__move returns the instruction to spawn
// rules-improviser, which an MCP tool cannot do itself; the script stands in for the agent with
// its output contract (plugins/litigation/agents/rules-improviser.md §4), and records the rules
// with rules__provisional. They come back tagged provisional and carry no override edge, a rule
// that tries to carry one is refused, and the visit, with its summary, is listed by
// rules__lifecycle. That a provisional rule in a node file is refused is the `lint-provisional`
// fixture's case in rules-dag.lint.unit.test.mjs.

import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute, submissionDataQuery } = await import("../build/submission/backend.js");
const { callTool, dispatchTool } = await import("../build/dispatch.js");

const DRAFT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "source", "skills", "draft");

// No step reads the practitioner's coclerk.json: a scratch config for the whole file.
const scratch = mkdtempSync(join(tmpdir(), "coclerk-rules-oob-config-"));
writeFileSync(join(scratch, "coclerk.json"), JSON.stringify({ case_data_root: scratch }));
process.env.COCLERK_CONFIG_PATH = join(scratch, "coclerk.json");
test.after(() => rmSync(scratch, { recursive: true, force: true }));

/** A checkout holding a copy of the real /draft skill: SKILL.md, references and node map. */
function checkout(t) {
  const root = mkdtempSync(join(tmpdir(), "coclerk-rules-oob-"));
  const skill = join(root, "source", "skills", "draft");
  mkdirSync(join(skill, "references"), { recursive: true });
  mkdirSync(join(skill, "rules", "nodes"), { recursive: true });
  copyFileSync(join(DRAFT, "SKILL.md"), join(skill, "SKILL.md"));
  for (const e of readdirSync(join(DRAFT, "references"), { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith(".md")) copyFileSync(join(DRAFT, "references", e.name), join(skill, "references", e.name));
  }
  for (const name of readdirSync(join(DRAFT, "rules", "nodes"))) copyFileSync(join(DRAFT, "rules", "nodes", name), join(skill, "rules", "nodes", name));
  const before = process.env.COCLERK_REPO_ROOT;
  process.env.COCLERK_REPO_ROOT = root;
  t.after(() => {
    if (before === undefined) delete process.env.COCLERK_REPO_ROOT;
    else process.env.COCLERK_REPO_ROOT = before;
    rmSync(root, { recursive: true, force: true });
  });
}

/** A migrated drafting database whose job 1 is held by `token`, and the /draft checkout. */
async function matter(t, token) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-rules-oob-db-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const dbPath = join(dir, "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(
    dbPath,
    `INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8470 - Larchmont', 'CAN/BC/BCSC');
     INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, locked_by, locked_at)
       VALUES (1, 1, 'Job one', 'Do it.', 'wip', 'work', 'L8470|x', '2026-10-01T09:00', '${token}', '2026-10-09T10:00');`
  );
  checkout(t);
  return dbPath;
}

const TOKEN = "oob-1";
const SUMMARY = "Asked to email the registry a copy of the filed affidavit.";
// What rules-improviser returns for that turn, in its output contract.
const IMPROVISED = [
  { id: "oob.send-email", door: "one-way", act: "send an email", text: "Show the practitioner the email and its recipient, and wait for a yes before sending it." },
  { id: "oob.attach-copy", door: "two-way", act: "attach a file", text: "Say which file was attached." },
];

const query = (dbPath, sql, params = []) => submissionDataQuery(dbPath, sql, params).rows;
const move = (dbPath, to, facts) => callTool({}, "rules__move", { db_path: dbPath, session_token: TOKEN, to, ...(facts ? { facts } : {}) });
const provisional = (dbPath, rules, turnSummary = SUMMARY, token = TOKEN) =>
  callTool({}, "rules__provisional", { db_path: dbPath, session_token: token, turn_summary: turnSummary, rules });
const attr = (xml, tag, name) => new RegExp(`<${tag}[^>]* ${name}="([^"]*)"`).exec(xml)?.[1];
const refused = (pattern) => (err) => {
  assert.match(err.message, pattern);
  return true;
};

test("a scripted session jumps out of bounds, records the improviser's rules, and gets them back provisional with no override edge", async (t) => {
  const dbPath = await matter(t, TOKEN);
  await move(dbPath, "draft/session", { unattended: false, host: "cowork" });
  await move(dbPath, "draft/job/work");

  const away = await move(dbPath, "out_of_bounds");
  assert.equal(attr(away, "position", "path"), "draft draft/out-of-bounds");
  assert.equal(attr(away, "improvise", "from_path"), "draft draft/session draft/job draft/job/work");
  assert.match(attr(away, "improvise", "instruction"), /^No mapped position fits this turn\. Spawn the rules-improviser agent .*rules__provisional/);
  const [visit] = query(dbPath, "SELECT id, turn_summary, provisional_rules FROM out_of_bounds_visit");
  assert.equal(attr(away, "improvise", "visit"), String(visit.id));
  assert.equal(visit.turn_summary, null);
  assert.equal(visit.provisional_rules, null);
  // A stay is not a new visit, so it asks for nothing.
  assert.doesNotMatch(await move(dbPath, "out_of_bounds"), /<improvise/);

  const served = await provisional(dbPath, IMPROVISED);
  assert.equal(
    served,
    [
      `<rules position="draft/out-of-bounds" branch="main" serve="provisional" visit="${visit.id}">`,
      `  <position path="draft draft/out-of-bounds"/>`,
      `  <rule id="oob.send-email" provisional="true" by="rules-improviser" door="one-way" act="send an email">`,
      "Show the practitioner the email and its recipient, and wait for a yes before sending it.",
      "  </rule>",
      `  <rule id="oob.attach-copy" provisional="true" by="rules-improviser" door="two-way" act="attach a file">`,
      "Say which file was attached.",
      "  </rule>",
      "</rules>",
    ].join("\n")
  );
  assert.doesNotMatch(served, /overrides|reason=/);

  const [stored] = query(dbPath, "SELECT turn_summary, provisional_rules FROM out_of_bounds_visit WHERE id = ?", [visit.id]);
  assert.equal(stored.turn_summary, SUMMARY);
  assert.deepEqual(JSON.parse(stored.provisional_rules), IMPROVISED);
  // Provisional rules never enter the serve log.
  assert.equal(query(dbPath, "SELECT COUNT(*) AS n FROM rule_served WHERE rule_id LIKE 'oob.%'")[0].n, 0);

  const lifecycle = await callTool({}, "rules__lifecycle", { db_path: dbPath });
  const [, visits] = /<out_of_bounds>\n([\s\S]*?)\n {4}<\/out_of_bounds>/.exec(lifecycle);
  const [{ visited_at }] = query(dbPath, "SELECT visited_at FROM out_of_bounds_visit WHERE id = ?", [visit.id]);
  assert.equal(
    visits,
    `      <visit id="${visit.id}" from_path="draft draft/session draft/job draft/job/work" visited_at="${visited_at}" summary="${SUMMARY}" rules="2"/>`
  );
});

test("a provisional rule carrying an override edge, or any field beyond the four, is refused and nothing is stored", async (t) => {
  const dbPath = await matter(t, TOKEN);
  await move(dbPath, "draft/session");
  await move(dbPath, "out_of_bounds");
  for (const field of [{ overrides: "draft.shelve.never-offer", reason: "x" }, { replaces: "draft.open.then-opening" }, { when: "job_held:true" }]) {
    await assert.rejects(
      provisional(dbPath, [{ ...IMPROVISED[0], ...field }]),
      refused(/rules\[0\] has .*; a provisional rule has only id, door, act and text, and carries no override edges$/)
    );
  }
  await assert.rejects(provisional(dbPath, [{ ...IMPROVISED[0], id: "draft.job.x" }]), refused(/rules\[0\]\.id 'draft\.job\.x' must be oob\.<kebab-slug>/));
  await assert.rejects(provisional(dbPath, [{ ...IMPROVISED[0], door: "revolving" }]), refused(/rules\[0\]\.door must be one of: one-way, two-way/));
  await assert.rejects(provisional(dbPath, [IMPROVISED[0], IMPROVISED[0]]), refused(/rules\[1\]\.id 'oob\.send-email' is given twice/));
  await assert.rejects(provisional(dbPath, Array(7).fill(IMPROVISED[1])), refused(/holds 7 rules; the improviser writes at most 6/));
  await assert.rejects(provisional(dbPath, IMPROVISED, " "), refused(/turn_summary must say/));
  assert.deepEqual(query(dbPath, "SELECT turn_summary, provisional_rules FROM out_of_bounds_visit"), [{ turn_summary: null, provisional_rules: null }]);
});

test("rules are recorded once per visit, only out of bounds, and an empty set is a record", async (t) => {
  const dbPath = await matter(t, TOKEN);
  await move(dbPath, "draft/session");
  await assert.rejects(provisional(dbPath, IMPROVISED), refused(/position is draft\/session, not out of bounds; rules__move to out_of_bounds first/));
  await assert.rejects(provisional(dbPath, IMPROVISED, SUMMARY, "oob-none"), refused(/position is not set, not out of bounds/));

  await move(dbPath, "out_of_bounds");
  const empty = await provisional(dbPath, []);
  assert.doesNotMatch(empty, /<rule /);
  // An improviser that failed still leaves the gap logged: its summary, and no rules.
  assert.deepEqual(query(dbPath, "SELECT turn_summary, provisional_rules FROM out_of_bounds_visit"), [{ turn_summary: SUMMARY, provisional_rules: "[]" }]);
  await assert.rejects(provisional(dbPath, IMPROVISED), refused(/already has its provisional rules; a new set needs a new visit/));

  // Leaving and coming back is a new visit, which takes its own rules.
  await move(dbPath, "draft/session");
  const again = await move(dbPath, "out_of_bounds");
  const [, second] = query(dbPath, "SELECT id FROM out_of_bounds_visit ORDER BY id");
  assert.equal(attr(again, "improvise", "visit"), String(second.id));
  assert.match(await provisional(dbPath, IMPROVISED), new RegExp(`visit="${second.id}"`));
});

test("a session taking the job over after the detour never receives the provisional rules", async (t) => {
  const dbPath = await matter(t, TOKEN);
  await move(dbPath, "draft/session");
  await move(dbPath, "draft/job/work");
  await move(dbPath, "out_of_bounds");
  await provisional(dbPath, IMPROVISED);

  await callTool({}, "rules__move", { db_path: dbPath, session_token: "oob-2", to: "draft/session" });
  await submissionDataExecute(dbPath, "UPDATE tickets SET locked_by = 'oob-2' WHERE id = 1;");
  const takeover = await callTool({}, "rules__move", { db_path: dbPath, session_token: "oob-2", to: "takeover" });
  assert.equal(attr(takeover, "position", "path"), "draft draft/session draft/job draft/job/work");
  assert.match(attr(takeover, "takeover", "note"), /went out of bounds from draft draft\/session draft\/job draft\/job\/work .*not served/);
  assert.doesNotMatch(takeover, /oob\.|provisional/);
});

test("a move more than one edge from the current path asks for rules-reorienter; a nearer move, up and out of bounds do not", async (t) => {
  const dbPath = await matter(t, TOKEN);
  const REORIENT = /<reorient /;
  assert.doesNotMatch(await move(dbPath, "draft/session"), REORIENT, "a first move");
  assert.doesNotMatch(await move(dbPath, "draft/job"), REORIENT);
  assert.doesNotMatch(await move(dbPath, "draft/job/work"), REORIENT);
  assert.doesNotMatch(await move(dbPath, "up"), REORIENT);
  await move(dbPath, "draft/job/work");
  const sideways = await move(dbPath, "draft/outline");
  assert.equal(attr(sideways, "position", "path"), "draft draft/session draft/outline");
  assert.doesNotMatch(sideways, REORIENT, "one edge from the path, though sideways");

  const jump = await move(dbPath, "draft/job/change");
  assert.equal(attr(jump, "position", "path"), "draft draft/session draft/job draft/job/work draft/job/change");
  assert.equal(attr(jump, "reorient", "from_path"), "draft draft/session draft/outline");
  assert.match(attr(jump, "reorient", "instruction"), /^This move was more than one edge from the path you were on\. Spawn the rules-reorienter agent in the background /);

  const away = await move(dbPath, "out_of_bounds");
  assert.match(away, /<improvise /);
  assert.doesNotMatch(away, REORIENT);
});

test("dispatchTool serves the provisional rules as raw XML, not JSON", async (t) => {
  const dbPath = await matter(t, TOKEN);
  await move(dbPath, "draft/session");
  await move(dbPath, "out_of_bounds");
  const result = await dispatchTool({}, "rules__provisional", { db_path: dbPath, session_token: TOKEN, turn_summary: SUMMARY, rules: IMPROVISED });
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /^<rules position="draft\/out-of-bounds" branch="main" serve="provisional"/);
});
