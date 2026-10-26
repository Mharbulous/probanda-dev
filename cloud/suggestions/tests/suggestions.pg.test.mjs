// The Suggestion Box's SQL (cloud/suggestions/suggestions.sql) against a
// throwaway Postgres 16 cluster: the migration of rows saved under the
// previous schema, idempotence, and every transition of every function.
//
//   node --test cloud/suggestions/tests/suggestions.pg.test.mjs
//
// It needs the Postgres 16 server binaries in /usr/lib/postgresql/16/bin and
// root, to run them as the postgres user. The cluster lives in a fresh folder
// under /tmp, listens only on a unix socket there, and is stopped and removed
// when the test ends. It touches no other database and needs no network.
//
// The previous schema is the file as it stood at PREVIOUS_COMMIT, the last
// commit before items existed, so this test keeps proving the migration after
// the new file is committed.

import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DECLINE_CATEGORIES } from "../../legal-commons/supabase/functions/suggestion-set-status/shape.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..");
const BIN = "/usr/lib/postgresql/16/bin";
const PREVIOUS_COMMIT = "bf91f66117f2045a37d9233bfe11bbaa4bb128e8";
const KEY_A = "a".repeat(64);
const KEY_B = "b".repeat(64);
const LEGACY_REASON = "Decided before reasons were recorded";

let dir;
let port;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port: p } = server.address();
      server.close(() => resolve(p));
    });
  });
}

const asPostgres = (command) => execFileSync("su", ["postgres", "-c", command], { stdio: "pipe" });

// SQL goes in on stdin, so a large value is not limited by the argument size.
function psql(args, input = "", db = "postgres") {
  return execFileSync(`${BIN}/psql`, ["-X", "-q", "-At", "-h", dir, "-p", String(port), "-U", "postgres",
    "-d", db, "-v", "ON_ERROR_STOP=1", ...args], { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] }).trim();
}

const q = (sql) => psql(["-f", "-"], sql);
const j = (sql) => JSON.parse(q(sql));
const apply = (file) => psql(["-f", file]);
const fails = (sql, pattern) => assert.throws(() => q(sql), pattern);
const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
const json = (v) => `${lit(JSON.stringify(v))}::jsonb`;

const badge = (id) => q(`select suggestions.badge('${id}')`);
const items = (id) => j(`select suggestions.items_of('${id}', true)`);
const submit = (key, p) => q(`select suggestions.submit(${lit(key)}, ${json(p)})`);
const setItem = (id, item, status, reason, category = null) =>
  j(`select suggestions.set_item_status('${id}', ${item}, ${lit(status)}, ${lit(reason)}, ${lit(category)})`);
const setAll = (id, status, issue = null, reason = null, category = null) =>
  j(`select suggestions.set_all_items('${id}', ${lit(status)}, ${issue ?? "null"}, ${lit(reason)}, ${lit(category)})`);
const recordIssue = (id, issue) => j(`select suggestions.record_issue('${id}', ${issue ?? "null"})`);
const open = (id, issue = null) => j(`select suggestions.open_for_review('${id}', ${issue ?? "null"})`);
const implemented = (id, item, release) => j(`select suggestions.mark_implemented('${id}', ${item}, ${lit(release)})`);
const attach = (key, id, spec, backstop) =>
  j(`select suggestions.attach_specification(${lit(key)}, '${id}', ${lit(spec)}, ${backstop === null ? "null" : json(backstop)})`);
const withdraw = (key, id) => j(`select suggestions.withdraw(${lit(key)}, '${id}')`);
const statusFor = (key, ids, everyone = false) =>
  j(`select suggestions.status_for_key(${lit(key)}, array[${ids.map((id) => `'${id}'`).join(",")}]::uuid[], ${everyone})`);
const row = (id) => j(`select coalesce((select to_jsonb(s) from suggestions.suggestion s where suggestion_id = '${id}'), 'null'::jsonb)`);
const refused = (code) => ({ saved: false, refusal: code });

const BASIC = { title: "A title", body: "The pain and the change", source: "user", plugin_version: "0.5.0" };

const newSuggestion = (texts, key = KEY_A) => submit(key, { ...BASIC, item_texts: texts });

before(async () => {
  dir = fs.mkdtempSync("/tmp/sugg-pg-");
  fs.chmodSync(dir, 0o700);
  execFileSync("chown", ["postgres:postgres", dir]);
  port = await freePort();
  asPostgres(`${BIN}/initdb -D ${dir}/data -A trust -U postgres --no-sync`);
  asPostgres(`${BIN}/pg_ctl -D ${dir}/data -w -l ${dir}/log -o "-k ${dir} -p ${port} -c listen_addresses=''" start`);
  q("create role anon nologin; create role authenticated nologin;");
  fs.writeFileSync(path.join(dir, "previous.sql"),
    execFileSync("git", ["-C", REPO, "show", `${PREVIOUS_COMMIT}:cloud/suggestions/suggestions.sql`]));
  fs.chmodSync(path.join(dir, "previous.sql"), 0o644);
});

after(() => {
  if (!dir) return;
  try {
    asPostgres(`${BIN}/pg_ctl -D ${dir}/data -w -m fast stop`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const NEW_SQL = path.join(REPO, "cloud", "suggestions", "suggestions.sql");
const legacy = {};

describe("the migration from the previous schema", () => {
  test("legacy rows in every old status read back as one item each", () => {
    apply(path.join(REPO, "cloud", "access", "access.sql"));
    apply(path.join(dir, "previous.sql"));
    q(`insert into access.install_key (key_hash, label, scopes) values
      ('${KEY_A}', 'machine A', '{suggestions:write}'), ('${KEY_B}', 'machine B', '{suggestions:write}')`);
    for (const status of ["new", "approved", "approved in part", "rejected"]) {
      legacy[status] = q(`insert into suggestions.suggestion (title, body, source, plugin_version, status, issue_number, triaged_at, items)
        values ('Legacy ${status}', 'Body of ${status}', 'user', '0.4.0', '${status}',
          ${status === "new" ? "null, null" : "7, now()"}, ${status === "new" ? `'[{"pain":"p"}]'` : "null"})
        returning suggestion_id`);
    }
    apply(NEW_SQL);
    apply(NEW_SQL);

    const expected = {
      "new": { status: "submitted", item: "undecided", reason: null, category: null, badge: "Submitted" },
      "approved": { status: "under review", item: "approved", reason: LEGACY_REASON, category: null, badge: "Approved" },
      "approved in part": { status: "under review", item: "approved", reason: LEGACY_REASON, category: null, badge: "Approved" },
      "rejected": { status: "under review", item: "declined", reason: LEGACY_REASON, category: "not recorded", badge: "Declined" },
    };
    for (const [old, want] of Object.entries(expected)) {
      const id = legacy[old];
      assert.equal(row(id).status, want.status, old);
      assert.deepEqual(items(id), [{
        item: 1, text: `Body of ${old}`, status: want.item, reason: want.reason, category: want.category, implemented_in: null,
      }], old);
      assert.equal(badge(id), want.badge, old);
    }
    assert.deepEqual(row(legacy.new).items, [{ pain: "p" }], "the earlier structured items are kept");
    assert.equal(row(legacy.approved).issue_number, 7);
    assert.equal(row(legacy.new).sender_key_hash, null);
  });

  test("the old statuses are no longer accepted, and the default is submitted", () => {
    fails(`update suggestions.suggestion set status = 'approved in part' where suggestion_id = '${legacy.new}'`, /suggestion_status_check/);
    fails(`update suggestions.suggestion set status = 'new' where suggestion_id = '${legacy.new}'`, /suggestion_status_check/);
    const id = q(`insert into suggestions.suggestion (title, body, source, plugin_version) values ('t', 'b', 'llm', '1.0.0') returning suggestion_id`);
    assert.equal(row(id).status, "submitted");
    q(`delete from suggestions.suggestion where suggestion_id = '${id}'`);
  });

  test("a legacy decided suggestion refuses the old whole-suggestion form again", () => {
    assert.deepEqual(setAll(legacy.approved, "rejected"), refused("decided"));
  });

  test("the decline categories agree with the shape module's", () => {
    assert.deepEqual(j("select to_jsonb(suggestions.decline_categories())"), DECLINE_CATEGORIES);
    assert.ok(DECLINE_CATEGORIES.includes("not enough detail"));
    assert.ok(DECLINE_CATEGORIES.includes("already works as asked"));
    assert.ok(DECLINE_CATEGORIES.includes("already suggested"));
    assert.ok(!DECLINE_CATEGORIES.includes("not recorded"));
  });
});

describe("submit", () => {
  test("with none of the new fields it saves as before, with one item from the body", () => {
    const id = submit(KEY_A, BASIC);
    const r = row(id);
    assert.equal(r.status, "submitted");
    assert.equal(r.title, "A title");
    assert.equal(r.sender_key_hash, KEY_A);
    assert.equal(r.items, null);
    assert.equal(r.origin, null);
    assert.deepEqual(items(id), [{ item: 1, text: BASIC.body, status: "undecided", reason: null, category: null, implemented_in: null }]);
    assert.equal(badge(id), "Submitted");
  });

  test("the earlier structured items and previews still save, with one item from the body", () => {
    const structured = [{ pain: "p", where: "w", done_test: "d", constraints: [], changes: [{ change: "c", origin: "lawyer" }] }];
    const previews = [{ label: "L", chosen: true, html: "<p>x</p>" }];
    const id = submit(KEY_A, { ...BASIC, skill: "draft", items: structured, previews });
    assert.deepEqual(row(id).items, structured);
    assert.deepEqual(row(id).previews, previews);
    assert.equal(row(id).skill, "draft");
    assert.equal(items(id).length, 1);
  });

  test("the project secret's submit records no sender", () => {
    assert.equal(row(submit(null, BASIC)).sender_key_hash, null);
  });

  test("every new field saves, and item texts become items in order", () => {
    const p = {
      ...BASIC, item_texts: ["First change", "Second change", "Third change"], origin: "probanda",
      fingerprint: { plugin: "lawyer", version: "0.5.0", skill: "draft", kind: "slow tool" },
      raw_observation: "tool x took 40000 tokens", environment_facts: { host: "Code", os: "linux" },
      comment: "A comment", mockup_html: "<p style=\"color:black\">Mockup</p>",
      context_lines: [{ kind: "constraint", text: "No nested boxes" }, { kind: "evidence", text: "The list is white on green" }],
    };
    const id = submit(KEY_A, p);
    const r = row(id);
    for (const key of ["origin", "fingerprint", "raw_observation", "environment_facts", "comment", "mockup_html", "context_lines"]) {
      assert.deepEqual(r[key], p[key], key);
    }
    assert.deepEqual(items(id).map((i) => [i.item, i.text, i.status]),
      [[1, "First change", "undecided"], [2, "Second change", "undecided"], [3, "Third change", "undecided"]]);
  });

  test("the table refuses what its checks forbid", () => {
    fails(`select suggestions.submit(null, ${json({ ...BASIC, origin: "someone" })})`, /suggestion_origin_check/);
    fails(`select suggestions.submit(null, ${json({ ...BASIC, mockup_html: "x".repeat(1_000_001) })})`, /suggestion_mockup_html_check/);
    fails(`select suggestions.submit(null, ${json({ ...BASIC, title: null })})`, /suggestion_content_check/);
    fails(`select suggestions.submit('${"c".repeat(64)}', ${json(BASIC)})`, /foreign key/);
    for (const bad of [
      [], {}, [{ kind: "note", text: "x" }], [{ kind: "evidence" }], [{ kind: "evidence", text: 3 }],
      [{ kind: "evidence", text: "x", status: "approved" }], ["evidence"], Array(21).fill({ kind: "evidence", text: "x" }),
    ]) {
      fails(`select suggestions.submit(null, ${json({ ...BASIC, context_lines: bad })})`, /suggestion_context_lines_check/);
    }
  });
});

describe("recording the issue", () => {
  test("intake records the issue without changing the status, again for the same issue", () => {
    const id = newSuggestion(["One"]);
    assert.deepEqual(recordIssue(id, 61), { saved: true, suggestion_id: id, status: "submitted", issue_number: 61, badge: "Submitted" });
    assert.equal(row(id).status, "submitted");
    assert.equal(row(id).triaged_at, null);
    assert.equal(recordIssue(id, 61).saved, true);
    assert.deepEqual(recordIssue(id, 62), refused("issue"));
    assert.equal(row(id).issue_number, 61);
    assert.deepEqual(recordIssue(id, 0), refused("issue"));
    assert.deepEqual(recordIssue(id, null), refused("issue"));
    assert.deepEqual(recordIssue("00000000-0000-0000-0000-000000000000", 1), refused("unknown"));
    open(id);
    assert.equal(recordIssue(id, 61).status, "under review", "an open suggestion keeps its status");
    assert.deepEqual(open(id, 70), refused("issue"));
  });
});

describe("opening for review", () => {
  test("submitted becomes under review, with its issue, and may be opened again", () => {
    const id = newSuggestion(["One"]);
    assert.deepEqual(open(id, 12), { saved: true, suggestion_id: id, status: "under review", issue_number: 12, badge: "Under Review" });
    assert.ok(row(id).triaged_at);
    assert.equal(open(id, 12).saved, true);
    assert.equal(open(id).saved, true);
    assert.equal(row(id).issue_number, 12);
    assert.deepEqual(open(id, 13), refused("issue"));
  });

  test("without an issue it records none, and a later open records one", () => {
    const id = newSuggestion(["One"]);
    assert.equal(open(id).issue_number, null);
    assert.equal(open(id, 5).issue_number, 5);
  });

  test("an unknown id or a bad issue is refused", () => {
    assert.deepEqual(open("00000000-0000-0000-0000-000000000000", 1), refused("unknown"));
    assert.deepEqual(open(newSuggestion(["One"]), 0), refused("issue"));
  });
});

describe("deciding one item", () => {
  test("approve and decline need a reason, and a decline a category", () => {
    const id = newSuggestion(["One", "Two", "Three"]);
    assert.deepEqual(setItem(id, 1, "approved", null), refused("reason"));
    assert.deepEqual(setItem(id, 1, "approved", "   "), refused("reason"));
    assert.deepEqual(setItem(id, 1, "approved", "two\nlines"), refused("reason"));
    assert.deepEqual(setItem(id, 1, "approved", "x".repeat(201)), refused("reason"));
    assert.deepEqual(setItem(id, 2, "declined", null, "not enough detail"), refused("reason"));
    assert.deepEqual(setItem(id, 2, "declined", "Too vague"), refused("category"));
    assert.deepEqual(setItem(id, 2, "declined", "Too vague", "not recorded"), refused("category"));
    assert.deepEqual(setItem(id, 2, "declined", "Too vague", "made up"), refused("category"));
    assert.deepEqual(setItem(id, 1, "approved", "Good idea", "not enough detail"), refused("category"));
    assert.deepEqual(setItem(id, 1, "implemented", "Shipped"), refused("status"));
    assert.deepEqual(setItem(id, 1, "undecided", "Back"), refused("status"));
    assert.deepEqual(setItem(id, 9, "approved", "Good idea"), refused("item"));
    assert.deepEqual(setItem("00000000-0000-0000-0000-000000000000", 1, "approved", "Good idea"), refused("unknown"));
    assert.equal(row(id).status, "submitted", "a refused write changes nothing");
    assert.equal(badge(id), "Submitted");
  });

  test("deciding opens the suggestion, the badge follows each decision, and a decision is never overwritten", () => {
    const id = newSuggestion(["One", "Two", "Three"]);
    assert.deepEqual(setItem(id, 1, "approved", "  Good idea  "),
      { saved: true, suggestion_id: id, item: 1, status: "approved", badge: "Under Review" });
    assert.equal(row(id).status, "under review");
    assert.equal(items(id)[0].reason, "Good idea");
    assert.equal(setItem(id, 2, "declined", "Too vague to act on", "not enough detail").badge, "Under Review");
    assert.equal(items(id)[1].category, "not enough detail");
    assert.equal(setItem(id, 3, "approved", "Worth doing").badge, "Approved (2 of 3)");
    assert.deepEqual(setItem(id, 1, "declined", "Changed my mind", "cost outweighs benefit"), refused("decided"));
    assert.deepEqual(setItem(id, 2, "approved", "Changed my mind"), refused("decided"));
  });

  test("the badge reads Approved when every item is approved, Declined when every one is declined", () => {
    const approved = newSuggestion(["One", "Two"]);
    setItem(approved, 1, "approved", "Yes");
    setItem(approved, 2, "approved", "Yes");
    assert.equal(badge(approved), "Approved");
    const declined = newSuggestion(["One", "Two"]);
    setItem(declined, 1, "declined", "It does this today", "already works as asked");
    setItem(declined, 2, "declined", "Asked before", "already suggested");
    assert.equal(badge(declined), "Declined");
  });

  test("the item table itself refuses an inconsistent row", () => {
    const id = newSuggestion(["One"]);
    fails(`update suggestions.item set status = 'declined', reason = 'r' where suggestion_id = '${id}'`, /item_check/);
    fails(`update suggestions.item set status = 'approved' where suggestion_id = '${id}'`, /item_check/);
    fails(`update suggestions.item set status = 'implemented', reason = 'r' where suggestion_id = '${id}'`, /item_check/);
  });
});

describe("marking implemented", () => {
  test("only an approved item, with a release; the badge names each plugin's latest release", () => {
    const id = newSuggestion(["One", "Two", "Three", "Four"]);
    setItem(id, 1, "approved", "Yes");
    setItem(id, 2, "approved", "Yes");
    setItem(id, 3, "declined", "No", "outside what Probanda does");
    assert.deepEqual(implemented(id, 4, "lawyer 0.4.2"), refused("not approved"), "undecided");
    setItem(id, 4, "approved", "Yes");
    assert.deepEqual(implemented(id, 3, "lawyer 0.4.2"), refused("not approved"), "declined");
    assert.deepEqual(implemented(id, 1, "Lawyer 0.4.2"), refused("release"));
    assert.deepEqual(implemented(id, 1, "lawyer 0.4"), refused("release"));
    assert.deepEqual(implemented(id, 1, null), refused("release"));
    assert.deepEqual(implemented(id, 9, "lawyer 0.4.2"), refused("item"));
    assert.deepEqual(implemented(id, 1, "lawyer 0.9.1"),
      { saved: true, suggestion_id: id, item: 1, status: "implemented", badge: "Approved (3 of 4)" });
    assert.equal(items(id)[0].reason, "Fixed in lawyer 0.9.1");
    assert.equal(items(id)[0].implemented_in, "lawyer 0.9.1");
    assert.equal(implemented(id, 1, "lawyer 0.9.1").saved, true, "the same release again is saved");
    assert.deepEqual(implemented(id, 1, "lawyer 0.9.2"), refused("not approved"), "another release is refused");
    implemented(id, 2, "lawyer 0.10.0");
    assert.equal(badge(id), "Approved (3 of 4)");
    assert.equal(implemented(id, 4, "researcher 0.3.0").badge, "Implemented in lawyer 0.10.0 and researcher 0.3.0");
  });

  test("Implemented in one plugin when every item is approved and shipped", () => {
    const id = newSuggestion(["One"]);
    setItem(id, 1, "approved", "Yes");
    assert.equal(implemented(id, 1, "file-manager 1.2.3").badge, "Implemented in file-manager 1.2.3");
  });
});

describe("the old whole-suggestion form", () => {
  test("approved, approved in part and rejected apply to every item", () => {
    const a = newSuggestion(["One", "Two"]);
    assert.deepEqual(setAll(a, "approved", 21), { saved: true, suggestion_id: a, status: "under review", badge: "Approved" });
    assert.deepEqual(items(a).map((i) => [i.status, i.reason, i.category]),
      [["approved", LEGACY_REASON, null], ["approved", LEGACY_REASON, null]]);
    assert.equal(row(a).issue_number, 21);
    assert.ok(row(a).triaged_at);

    const part = newSuggestion(["One"]);
    assert.equal(setAll(part, "approved in part", null, "Partly useful").badge, "Approved");
    assert.equal(items(part)[0].reason, "Partly useful");

    const r = newSuggestion(["One", "Two"]);
    assert.equal(setAll(r, "rejected").badge, "Declined");
    assert.deepEqual(items(r).map((i) => i.category), ["not recorded", "not recorded"]);
    const rc = newSuggestion(["One"]);
    setAll(rc, "rejected", null, "Asked before", "already suggested");
    assert.equal(items(rc)[0].category, "already suggested");
  });

  test("it is refused once any item is decided, or for a bad status, reason or category", () => {
    const id = newSuggestion(["One", "Two"]);
    setItem(id, 1, "approved", "Yes");
    assert.deepEqual(setAll(id, "rejected"), refused("decided"));
    assert.equal(items(id)[1].status, "undecided", "nothing changed");
    const fresh = newSuggestion(["One"]);
    assert.deepEqual(setAll(fresh, "new"), refused("status"));
    assert.deepEqual(setAll(fresh, "declined"), refused("status"));
    assert.deepEqual(setAll(fresh, "approved", null, "  "), refused("reason"));
    assert.deepEqual(setAll(fresh, "approved", null, null, "already suggested"), refused("category"));
    assert.deepEqual(setAll(fresh, "rejected", null, null, "not recorded"), refused("category"));
    assert.deepEqual(setAll(fresh, "approved", 0), refused("issue"));
    open(fresh, 3);
    assert.deepEqual(setAll(fresh, "approved", 4), refused("issue"));
    assert.equal(setAll(fresh, "approved", 3).saved, true);
    assert.deepEqual(setAll("00000000-0000-0000-0000-000000000000", "approved"), refused("unknown"));
  });
});

describe("status by key", () => {
  test("the sending key reads its own, another key reads nothing, a legacy row is read by any key", () => {
    const mine = newSuggestion(["One", "Two"], KEY_A);
    setItem(mine, 1, "declined", "Asked before", "already suggested");
    const theirs = newSuggestion(["One"], KEY_B);
    const unknown = "00000000-0000-0000-0000-000000000000";
    const read = statusFor(KEY_A, [mine, theirs, legacy.rejected, unknown]);
    assert.deepEqual(read.map((s) => s.suggestion_id).sort(), [mine, legacy.rejected].sort());
    const m = read.find((s) => s.suggestion_id === mine);
    assert.equal(m.status, "under review");
    assert.equal(m.badge, "Under Review");
    assert.ok(m.triaged_at);
    assert.deepEqual(m.items, [
      { item: 1, status: "declined", reason: "Asked before", category: "already suggested", implemented_in: null },
      { item: 2, status: "undecided", reason: null, category: null, implemented_in: null },
    ]);
    assert.ok(!("text" in m.items[0]), "no item text goes back");
    assert.deepEqual(statusFor(KEY_B, [mine]), []);
    assert.deepEqual(statusFor(null, [mine]), []);
    assert.deepEqual(statusFor(null, [mine, theirs], true).length, 2);
  });
});

describe("attaching a specification", () => {
  test("once, by the sending key only, and never after withdrawal", () => {
    const id = newSuggestion(["One"], KEY_A);
    assert.deepEqual(attach(KEY_B, id, "Spec", { passed: true }), refused("unknown"));
    assert.deepEqual(attach(null, id, "Spec", { passed: true }), refused("unknown"));
    assert.deepEqual(attach(KEY_A, id, "", { passed: true }), refused("specification"));
    assert.deepEqual(attach(KEY_A, id, "Spec", null), refused("backstop"));
    assert.deepEqual(attach(KEY_A, id, "Spec", { passed: true }), { saved: true, suggestion_id: id });
    assert.equal(row(id).specification, "Spec");
    assert.deepEqual(row(id).backstop_result, { passed: true });
    assert.deepEqual(attach(KEY_A, id, "Spec again", { passed: true }), refused("attached"));
    assert.equal(row(id).specification, "Spec");

    const triaged = newSuggestion(["One"], KEY_A);
    open(triaged, 30);
    withdraw(KEY_A, triaged);
    assert.deepEqual(attach(KEY_A, triaged, "Spec", { passed: true }), refused("unknown"));
  });
});

describe("withdrawal", () => {
  test("before triage the row and its items are gone", () => {
    const id = newSuggestion(["One", "Two"], KEY_A);
    assert.deepEqual(withdraw(KEY_B, id), refused("unknown"));
    assert.deepEqual(withdraw(null, id), refused("unknown"));
    assert.deepEqual(withdraw(KEY_A, id), { saved: true, suggestion_id: id, tombstone: false });
    assert.equal(row(id), null);
    assert.equal(q(`select count(*) from suggestions.item where suggestion_id = '${id}'`), "0");
    assert.deepEqual(withdraw(KEY_A, id), refused("unknown"));
  });

  test("after triage only a tombstone of id, issue number and status stays", () => {
    const id = submit(KEY_A, {
      ...BASIC, item_texts: ["One", "Two"], comment: "c", origin: "practitioner", mockup_html: "<p>m</p>",
      context_lines: [{ kind: "evidence", text: "e" }],
      environment_facts: { host: "Cowork" },
    });
    attach(KEY_A, id, "Spec", { passed: true });
    open(id, 44);
    setItem(id, 1, "approved", "Yes");
    assert.deepEqual(withdraw(KEY_A, id), { saved: true, suggestion_id: id, tombstone: true });
    const kept = Object.fromEntries(Object.entries(row(id)).filter(([, v]) => v !== null));
    assert.deepEqual(kept, { suggestion_id: id, status: "withdrawn", issue_number: 44 });
    assert.equal(q(`select count(*) from suggestions.item where suggestion_id = '${id}'`), "0");
    assert.equal(badge(id), "Withdrawn");
    assert.deepEqual(withdraw(KEY_A, id), refused("unknown"));
    assert.deepEqual(statusFor(KEY_A, [id]), [], "a tombstone names no sender");
    assert.deepEqual(open(id, 44), refused("withdrawn"));
    assert.deepEqual(setItem(id, 2, "approved", "Yes"), refused("withdrawn"));
    assert.deepEqual(setAll(id, "approved"), refused("withdrawn"));
    assert.deepEqual(implemented(id, 1, "lawyer 0.4.2"), refused("withdrawn"));
    fails(`update suggestions.suggestion set title = 'back' where suggestion_id = '${id}'`, /suggestion_tombstone_check/);
  });

  test("a submitted suggestion whose issue intake recorded leaves a tombstone", () => {
    const id = newSuggestion(["One"], KEY_A);
    recordIssue(id, 50);
    assert.equal(row(id).status, "submitted");
    assert.equal(withdraw(KEY_A, id).tombstone, true);
    assert.deepEqual(Object.fromEntries(Object.entries(row(id)).filter(([, v]) => v !== null)),
      { suggestion_id: id, status: "withdrawn", issue_number: 50 });
    assert.deepEqual(recordIssue(id, 50), refused("withdrawn"));
  });

  test("a suggestion under review with no issue recorded is deleted outright", () => {
    const id = newSuggestion(["One", "Two"], KEY_A);
    setItem(id, 1, "approved", "Yes");
    assert.equal(row(id).status, "under review");
    assert.deepEqual(withdraw(KEY_A, id), { saved: true, suggestion_id: id, tombstone: false });
    assert.equal(row(id), null);
    assert.equal(q(`select count(*) from suggestions.item where suggestion_id = '${id}'`), "0");
  });
});

describe("the maintainer's list", () => {
  test("filters on status and returns the new columns and the items with their text, never the sender", () => {
    const list = j(`select suggestions.list('submitted')`);
    assert.ok(list.length > 0);
    assert.ok(list.every((s) => s.status === "submitted" && s.badge === "Submitted"));
    assert.ok(list.every((s) => !("sender_key_hash" in s)));
    const all = j("select suggestions.list()");
    const withNew = all.find((s) => s.origin === "probanda");
    assert.equal(withNew.item_list.length, 3);
    assert.equal(withNew.item_list[0].text, "First change");
    assert.deepEqual(withNew.context_lines.map((l) => l.kind), ["constraint", "evidence"]);
    for (const key of ["fingerprint", "raw_observation", "environment_facts", "comment", "context_lines", "mockup_html", "specification", "backstop_result"]) {
      assert.ok(key in withNew, key);
    }
    assert.ok(j("select suggestions.list('withdrawn')").every((s) => s.status === "withdrawn" && s.badge === "Withdrawn"));
    assert.ok(j("select suggestions.list('under review')").length > 0);
  });
});

describe("a fresh apply", () => {
  test("access.sql then the new file, twice, on an empty database", () => {
    q("create database fresh");
    psql(["-f", path.join(REPO, "cloud", "access", "access.sql")], "", "fresh");
    psql(["-f", NEW_SQL], "", "fresh");
    psql(["-f", NEW_SQL], "", "fresh");
    const id = psql(["-f", "-"], `select suggestions.submit(null, ${json(BASIC)})`, "fresh");
    assert.equal(psql(["-f", "-"], `select suggestions.badge('${id}')`, "fresh"), "Submitted");
    assert.equal(psql(["-f", "-"], `select count(*) from suggestions.item where suggestion_id = '${id}'`, "fresh"), "1");
  });
});

describe("idempotence over live data", () => {
  test("applying the file again changes nothing, tombstones and decisions included", () => {
    const before = q("select md5(string_agg(to_jsonb(s)::text, '' order by suggestion_id)) from suggestions.suggestion s") +
      q("select md5(string_agg(to_jsonb(i)::text, '' order by suggestion_id, item)) from suggestions.item i");
    apply(NEW_SQL);
    const after = q("select md5(string_agg(to_jsonb(s)::text, '' order by suggestion_id)) from suggestions.suggestion s") +
      q("select md5(string_agg(to_jsonb(i)::text, '' order by suggestion_id, item)) from suggestions.item i");
    assert.equal(after, before);
    assert.equal(q("select has_schema_privilege('anon', 'suggestions', 'usage')"), "f");
    assert.equal(q("select has_function_privilege('authenticated', 'suggestions.withdraw(text, uuid)', 'execute')"), "f");
    assert.equal(q("select has_function_privilege('public', 'suggestions.badge(uuid)', 'execute')"), "f");
  });
});
