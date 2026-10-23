// write_email addressed from case data (spec 2026-10-23, write_email addresses the email itself):
// to_service_list reads counsel of record on a proceeding's service list live from case data, each
// lawyer once, the first stored address in To and the rest in Cc, the client's side and the forum's
// own addressees left out; filing_id reads a saved Writing's recipients; the firm's
// cc_on_counsel_email people are copied; and an empty body writes a blank draft. The server is called
// directly. Invented names only, in temp directories.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";

import { codeOf } from "./helpers/housekeeping-fixture.mjs";
import { updateCaseData } from "./helpers/matter-data-fixture.mjs";
import { generalWritingFixture } from "./helpers/general-writing-fixture.mjs";

const { draftHarness } = await import("../build/submission/draft-harness.js");
const { upsert_firm_profile } = await import("../build/tools/practice/firm-profile.js");

const PYTHON = process.env.COCLERK_PYTHON || "python";
const NAME = "2026-10-23 EM counsel re dates";
const CARA = '"Cara Counsel" <cara@counsel.test>';

/** The general-Writing fixture's matter, made a matter folder, and a write_email call on it. */
async function matter(t) {
  const g = await generalWritingFixture(t);
  const root = dirname(dirname(g.dbPath));
  writeFileSync(join(root, "coclerk.json"), JSON.stringify({ schema_version: 5, matter_root: root, case_data_dir: dirname(g.dbPath) }));
  const caseData = (sql) => updateCaseData(dirname(g.dbPath), sql);
  const run = (extra = {}) =>
    draftHarness({ step: "write_email", matter_root: root, output_name: NAME, subject: "Hearing dates", db_path: g.dbPath, ...extra }, g.seams.env);
  return { g, root, caseData, run };
}

/** The draft's To, Cc and plain body, as Python's email parser reads them. */
function parsed(path) {
  const code = `import json, sys
from email import policy
from email.parser import BytesParser
with open(sys.argv[1], "rb") as f:
    m = BytesParser(policy=policy.default).parse(f)
print(json.dumps({"To": m["To"], "Cc": m["Cc"], "body": m.get_body(("plain",)).get_content()}))`;
  const res = spawnSync(PYTHON, ["-c", code, path], { encoding: "utf-8" });
  assert.equal(res.status, 0, res.stderr);
  return JSON.parse(res.stdout);
}

test("to_service_list addresses counsel on the service list, lawyer in To and the other stored addresses in Cc, never the client or the forum", async (t) => {
  const m = await matter(t);
  m.caseData("UPDATE parties SET lawyer_email = 'cara@counsel.test; para@counsel.test, asst@counsel.test' WHERE party_id = 2;");
  const result = m.run({ to_service_list: true, proceeding_id: 1, body: "Please confirm the dates." });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.deepEqual(result.addressed, { to: [CARA], cc: ["para@counsel.test", "asst@counsel.test"], not_addressed: [] });
  const eml = parsed(result.path);
  assert.equal(eml.To, "Cara Counsel <cara@counsel.test>");
  assert.equal(eml.Cc, "para@counsel.test, asst@counsel.test");
  assert.doesNotMatch(`${eml.To} ${eml.Cc}`, /ada@client\.test|Registrar/, "no client-side person and no forum addressee");
});

test("two parties with one counsel address that lawyer once; a party with no counsel email is reported, never guessed", async (t) => {
  const m = await matter(t);
  m.caseData(
    "INSERT INTO parties (party_id, name, lawyer_name, lawyer_email) VALUES (5, 'Cy Third', 'Cara Counsel', 'cara@counsel.test'); " +
      "INSERT INTO parties (party_id, name, lawyer_name, lawyer_email) VALUES (6, 'Dee Fourth', NULL, NULL);"
  );
  await m.g.execute(
    "INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, case_party_id) VALUES (5, 1, 'Cy Third', 'Respondent', 3, 0, 5), (6, 1, 'Dee Fourth', 'Respondent', 4, 0, 6); " +
      "INSERT INTO recipients (id, proceeding_id, name, capacity, email, address, party_id, ordinal) VALUES (4, 1, NULL, 'counsel for Cy Third', NULL, NULL, 5, 4), (5, 1, NULL, 'counsel for Dee Fourth', NULL, NULL, 6, 5);"
  );
  const result = m.run({ to_service_list: true, proceeding_id: 1 });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.deepEqual(result.addressed.to, [CARA]);
  assert.deepEqual(result.addressed.cc, []);
  assert.deepEqual(result.addressed.not_addressed, [{ name: "Dee Fourth", capacity: "counsel for Dee Fourth", reason: "case data holds no email for it" }]);
});

test("withdrawn counsel yields no address; with nobody left in To the step refuses no_recipients and writes nothing", async (t) => {
  const m = await matter(t);
  m.caseData("UPDATE parties SET lawyer_name = NULL, lawyer_email = NULL WHERE party_id = 2;");
  const result = m.run({ to_service_list: true, proceeding_id: 1 });
  assert.deepEqual([result.success, result.error], [false, "no_recipients"], JSON.stringify(result));
  assert.deepEqual(result.not_addressed.map((r) => r.name), ["Bert Other"]);
  assert.deepEqual(readdirSync(m.g.draft), []);
});

test("the firm's cc_on_counsel_email people are copied, the sender left out", async (t) => {
  const m = await matter(t);
  await upsert_firm_profile({ cc_on_counsel_email: ["st", "pe"] }, m.g.seams.env);
  const result = m.run({ to_service_list: true, proceeding_id: 1, cc: ["extra@other.test"] });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.deepEqual(result.addressed.to, [CARA]);
  assert.deepEqual(result.addressed.cc, ['"Sam Staff" <sam@fixture.test>', "extra@other.test"]);
  assert.equal(parsed(result.path).Cc, "Sam Staff <sam@fixture.test>, extra@other.test");

  // Typed addresses are not addressed from case data, so the firm copy is not added.
  const typed = m.run({ to: ["bert@other.test"], output_name: `${NAME} typed`, db_path: undefined });
  assert.equal(typed.success, true, JSON.stringify(typed));
  assert.equal(parsed(typed.path).Cc, null);
  assert.equal("addressed" in typed, false);
});

test("with two proceedings and none named, counsel across both are addressed once each, and the note says so", async (t) => {
  const m = await matter(t);
  m.caseData("UPDATE parties SET lawyer_name = 'Eve Counsel', lawyer_email = 'eve@law.test' WHERE party_id = 4;");
  await m.g.execute("INSERT INTO recipients (id, proceeding_id, name, capacity, email, address, party_id, ordinal) VALUES (6, 2, NULL, 'counsel for Bert Other', NULL, NULL, 4, 1);");
  const all = m.run({ to_service_list: true });
  assert.equal(all.success, true, JSON.stringify(all));
  assert.deepEqual(all.addressed.to, [CARA, '"Eve Counsel" <eve@law.test>']);
  assert.match(all.addressed.note, /all 3 proceedings/);
  const one = m.run({ to_service_list: true, proceeding_id: 1 });
  assert.deepEqual(one.addressed.to, [CARA]);
  assert.equal("note" in one.addressed, false);
});

test("filing_id addresses a saved Writing's to and cc recipients, and one with a Bcc is refused, writing nothing", async (t) => {
  const m = await matter(t);
  const { filing_id } = await m.g.createLetter();
  await m.g.recipient(filing_id, 1, "to");
  await m.g.recipient(filing_id, 3, "cc");
  const result = m.run({ filing_id });
  assert.equal(result.success, true, JSON.stringify(result));
  assert.deepEqual(result.addressed.to, [CARA]);
  assert.deepEqual(result.addressed.not_addressed, [{ name: "Dan Registrar", capacity: "the registry", reason: "case data holds no email for it" }]);

  await m.g.recipient(filing_id, 2, "bcc");
  assert.equal(codeOf(() => m.run({ filing_id, output_name: `${NAME} bcc` })), "bcc_unsupported");
  assert.deepEqual(readdirSync(m.g.draft).filter((n) => n.includes("bcc")), []);
});

test("a recipient source is refused with to, without matter_root, without db_path, or with both sources", async (t) => {
  const m = await matter(t);
  assert.throws(() => m.run({ to_service_list: true, to: ["x@other.test"] }), /to cannot be given with to_service_list/);
  assert.throws(() => m.run({ to_service_list: true, matter_root: undefined }), /to_service_list needs the matter: give matter_root/);
  assert.throws(() => m.run({ filing_id: 1, db_path: undefined }), /db_path, the matter's drafting database, is required with filing_id/);
  assert.throws(() => m.run({ to_service_list: true, filing_id: 1 }), /either to_service_list or filing_id/);
  assert.throws(() => m.run({ proceeding_id: 1, to: ["x@other.test"] }), /proceeding_id is read only with to_service_list/);
  assert.throws(() => m.run({ db_path: undefined }), /to must be a list of strings, at least 1/);
  assert.deepEqual(readdirSync(m.g.draft), []);
});

test("an omitted or empty body writes a blank draft", async (t) => {
  const m = await matter(t);
  for (const [i, body] of [undefined, ""].entries()) {
    const result = m.run({ to_service_list: true, proceeding_id: 1, body, output_name: `${NAME} ${i}` });
    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal(parsed(result.path).body.trim(), "");
  }
  const typed = m.run({ to: ["bert@other.test"], output_name: `${NAME} typed`, db_path: undefined });
  assert.equal(typed.success, true, JSON.stringify(typed));
});
