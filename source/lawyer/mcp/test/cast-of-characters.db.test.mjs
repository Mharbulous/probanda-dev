// Cast of Characters spec 7: the test matter T512, with a party with counsel, a self-represented
// party, a witness with a contact, an expert, a client_other_counsel contact recorded from an email,
// a proposed role, a tribunal member, a public body and an ended role. Every name is invented. The
// model is asserted, never the page: no test reads a page (shared/html-pages.md).

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { startFakeCloud } from "./helpers/fake-cloud.mjs";
import { writeCaseData } from "./helpers/matter-data-fixture.mjs";

const { PracticeStore } = await import("../build/practice/store.js");
const writes = await import("../build/tools/practice/writes.js");
const contacts = await import("../build/tools/practice/contacts.js");
const { readCastModel, render_cast_of_characters } = await import("../build/cast/cast-write.js");

const SEED = `
INSERT INTO proceedings (proceeding_id, court, file_number) VALUES (1, 'BCSC', 'S-000512');
INSERT INTO parties (party_id, name, party_type, lawyer_name, lawyer_firm, lawyer_email, lawyer_phone, address, service_address_filed_date)
VALUES (1, 'Alan Wei Park', 'individual', 'Pat Counsel', 'Example Law LLP', 'pat@examplelaw.example', '604-555-0100', '900-555 Sample St, Vancouver BC', '2026-03-01'),
       (2, 'Grace Liu', 'individual', 'Sample Counsel B', 'Sample Law Corp.', 'counsel.b@example.com', '604-555-0177', '400-222 Sample Ave, Vancouver BC', '2026-04-01'),
       (3, 'The Owners, Strata Plan EPS0000', 'other', NULL, NULL, NULL, NULL, NULL, NULL);
INSERT INTO proceeding_parties (proceeding_id, party_id, role) VALUES (1, 1, 'plaintiff'), (1, 2, 'defendant'), (1, 3, 'defendant');
INSERT INTO witnesses (witness_id, name, witness_type, field_of_expertise, retained_by_party_id)
VALUES (1, 'Jordan Kim', 'fact', NULL, NULL), (2, 'Dr. Sample Air-Quality', 'expert', 'Air quality', 1);
INSERT INTO proceeding_witnesses (proceeding_id, witness_id, called_by_party_id) VALUES (1, 1, 1);
INSERT INTO tribunal_members (tribunal_member_id, name, capacity, tribunal_body, proceeding_id, notes)
VALUES (1, 'Justice Sample', 'judge', 'Supreme Court of BC', 1, 'Consent injunction order, 2026-08-31');
INSERT INTO participant_aliases (party_id, of_counsel, witness_id, tribunal_member_id, alias_text, alias_kind, approved_on)
VALUES (1, 0, NULL, NULL, 'ParkA', 'file_code', '2026-11-01'), (1, 0, NULL, NULL, 'Wei Park', 'spelling', '2026-11-01'),
       (NULL, 0, 1, NULL, 'KimJ', 'file_code', '2026-11-01'), (2, 1, NULL, NULL, 'CounselB', 'file_code', '2026-11-01');
`;

async function t512(t) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-cast-"));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const matterRoot = join(base, "T512 Maple Grove");
  const caseDataDir = join(base, "0. CASE DATA", "T512 Maple Grove");
  mkdirSync(join(matterRoot, "0. DRAFT"), { recursive: true });
  mkdirSync(caseDataDir, { recursive: true });
  writeFileSync(join(matterRoot, "coclerk.json"), JSON.stringify({ schema_version: 5, matter_root: matterRoot, case_data_dir: caseDataDir }), "utf-8");
  writeCaseData(caseDataDir, SEED);

  const cloud = await startFakeCloud(t);
  const store = new PracticeStore({ ...process.env, ...cloud.env, COCLERK_DB_PATH: join(base, `${randomUUID()}.db`) });
  await writes.upsert_client_matter(store, { client_num: "C-512", name: "Maple Grove Dental Inc.", matt_num: "T512", file_number: "F-512" });
  const person = async (name, extra = {}) => (await contacts.upsert_contact(store, { entity: "person", name, ...extra })).contact_id;
  const org = async (name, extra = {}) => (await contacts.upsert_contact(store, { entity: "organization", name, ...extra })).contact_id;
  const role = (contact_id, r, extra = {}) => contacts.upsert_matter_role(store, { matt_num: "T512", contact_id, role: r, ...extra });

  const park = await person("Alan Wei Park", { emails: ["alan@mapleexample.example"], phones: ["778-555-0101"], note: "Proposed peace bond: no contact with Bo Lin." });
  const clinic = await org("Maple Grove Dental Inc.");
  await contacts.upsert_affiliation(store, { person_id: park, organization_id: clinic, title: "Director" });
  await role(park, "client", { case_party_id: 1 });
  const liu = await person("Grace Liu");
  await role(liu, "opposing_party", { case_party_id: 2 });
  const b = await person("Sample Counsel B", { emails: ["counsel.b@example.com"], phones: ["604-555-0188"] });
  await role(b, "opposing_counsel", { case_party_id: 2, from: "2026-09-15" });
  const e = await person("Sample Counsel E", { emails: ["counsel.e@example.com"] });
  await role(e, "opposing_counsel", { case_party_id: 2, from: "2026-04-01", to: "2026-09-15" });
  const strata = await org("The Owners, Strata Plan EPS0000", { emails: ["council@strata.example"] });
  await role(strata, "opposing_party", { case_party_id: 3 });
  const insurer = await org("Sample Mutual");
  await role(insurer, "insurer", { for_case_party_id: 3 });
  const adjuster = await person("Sample Adjuster");
  await contacts.upsert_affiliation(store, { person_id: adjuster, organization_id: insurer });
  await role(adjuster, "adjuster");
  const kim = await person("Jordan Kim", { emails: ["jordan@mapleexample.example"] });
  await role(kim, "witness", { case_witness_id: 1, note: "Cc on client email, 2026-11-02" });
  const expert = await person("Dr. Sample Air-Quality", { emails: ["expert@example.com"], phones: ["604-555-0140"] });
  await role(expert, "expert", { case_witness_id: 2, note: "Engagement letter" });
  const defender = await person("Sam Defender", { emails: ["sam@defender.example"] });
  await role(defender, "client_other_counsel", { for_case_party_id: 1, note: "Client email, 2026-11-02, Peace bond", privileged_source: true });
  const pi = await org("Sample Investigations Ltd.", { emails: ["pi@example.com"] });
  const proposedRole = await role(pi, "investigator", { for_case_party_id: 1, status: "proposed", note: "Your email, 2026-11-04" });
  const rcmp = await org("Richmond RCMP", { phones: ["604-555-0199"] });
  await role(rcmp, "public_body", { note: "Police file card" });
  const bylaws = await org("City Community Bylaws", { emails: ["bylaws@example.com"] });
  await role(bylaws, "public_body", { to: "2026-06-30", note: "Letter" });
  return { store, matterRoot, proposedRole };
}

const entries = (model, tab) => model.tabs.find((x) => x.id === tab).sections.map((s) => [s.title, s.entries.map((e) => e.name)]);
const find = (model, tab, name) => model.tabs.find((x) => x.id === tab).sections.flatMap((s) => s.entries).find((e) => e.name === name);

test("T512: each entry is on the right tab, section and side, with its flags, related people and copy instructions", async (t) => {
  const { store, matterRoot, proposedRole } = await t512(t);
  const { model, client } = await readCastModel(store, matterRoot, "T512");
  assert.equal(client, "Maple Grove Dental Inc.");
  assert.deepEqual(model.tabs.map((x) => x.label), ["Service List", "Litigants", "Witnesses", "Public Bodies"]);
  assert.deepEqual(model.notes, []);

  assert.deepEqual(entries(model, "svc"), [
    ["Plaintiffs", ["Pat Counsel"]],
    ["Defendants", ["Sample Counsel B", "Sample Counsel E", "The Owners, Strata Plan EPS0000"]],
  ]);
  const counselB = find(model, "svc", "Sample Counsel B");
  assert.equal(counselB.code, "CounselB");
  assert.deepEqual(counselB.flags, ["conflict"], "the contact's phone differs from counsel of record");
  assert.match(counselB.actions[0].instruction, /^Was a notice of change filed for Grace Liu on T512\?/);
  const former = find(model, "svc", "Sample Counsel E");
  assert.equal(former.former, true, "the ended counsel role is a former entry");
  const strataSvc = find(model, "svc", "The Owners, Strata Plan EPS0000");
  assert.deepEqual([strataSvc.pills[0].text, strataSvc.flags], ["Self-represented", ["gap"]]);
  assert.equal(model.serviceEmails, "pat@examplelaw.example; counsel.b@example.com; council@strata.example");
  assert.match(model.serviceTable.split("\n")[0], /^For\tCounsel or party\tFirm/);

  assert.deepEqual(entries(model, "lit"), [
    ["Plaintiffs", ["Alan Wei Park"]],
    ["Defendants", ["Grace Liu", "The Owners, Strata Plan EPS0000"]],
  ]);
  const parkCard = find(model, "lit", "Alan Wei Park");
  assert.deepEqual(parkCard.pills.map((p) => p.text), ["Plaintiff", "Client", "Director", "Privileged source"]);
  assert.deepEqual(parkCard.flags, ["priv"], "the other counsel came from a client email");
  assert.equal(parkCard.counsel[0].value, "Pat Counsel, Example Law LLP (Service List)");
  assert.match(parkCard.counsel[1].value, /^Sam Defender, sam@defender\.example\. Not on the Service List\.$/);
  assert.deepEqual([parkCard.counsel[1].source, parkCard.counsel[1].privileged], ["Client email, 2026-11-02, Peace bond", true]);
  assert.deepEqual(parkCard.related, ["Director of Maple Grove Dental Inc."]);
  assert.deepEqual(parkCard.notes, ["Proposed peace bond: no contact with Bo Lin."]);
  assert.ok(parkCard.search.includes("parka") && parkCard.search.includes("wei park"), "search holds the file code and the alias");
  assert.deepEqual(find(model, "lit", "Grace Liu").flags, [], "a represented party is reached through counsel");
  assert.deepEqual(find(model, "lit", "The Owners, Strata Plan EPS0000").related, ["Insurer: Sample Mutual · adjuster Sample Adjuster"]);

  assert.deepEqual(entries(model, "wit"), [
    ["Plaintiffs' Witnesses", ["Jordan Kim", "Sample Investigations Ltd."]],
    ["Defendants' Witnesses", []],
    ["Expert Witnesses", ["Dr. Sample Air-Quality"]],
  ]);
  const kimCard = find(model, "wit", "Jordan Kim");
  assert.deepEqual([kimCard.code, kimCard.flags, kimCard.email], ["KimJ", ["gap"], "jordan@mapleexample.example"]);
  const piCard = find(model, "wit", "Sample Investigations Ltd.");
  assert.deepEqual([piCard.proposed, piCard.side, piCard.flags], [true, "P", ["unc", "gap"]]);
  assert.deepEqual(piCard.actions.map((a) => a.label), ["Confirm", "Not a character", "Merge with…", "Missing details"]);
  assert.equal(piCard.actions[0].instruction, `Confirm Sample Investigations Ltd. as Private investigator on T512 (matter role ${proposedRole.id}).`);
  assert.deepEqual(find(model, "wit", "Dr. Sample Air-Quality").pills.map((p) => p.text), ["Plaintiffs' expert", "Air quality"]);

  assert.deepEqual(entries(model, "dec"), [
    ["Court", ["Justice Sample"]],
    ["Enforcement & Public Bodies", ["City Community Bylaws", "Richmond RCMP"]],
  ]);
  const judge = find(model, "dec", "Justice Sample");
  assert.deepEqual([judge.side, judge.flags, judge.appearances[0].value], ["N", [], "Consent injunction order, 2026-08-31"]);
  assert.equal(find(model, "dec", "City Community Bylaws").former, true, "an ended public-body role is a former entry");

  const all = model.tabs.flatMap((x) => x.sections.flatMap((s) => s.entries)).map((e) => e.name);
  for (const hidden of ["Sam Defender", "Sample Mutual", "Sample Adjuster"]) assert.ok(!all.includes(hidden), `${hidden} is not a card of its own`);
});

test("T512: the render tool writes the page beside Loose Threads, returns counts only, and refuses a file it did not write", async (t) => {
  const { store, matterRoot } = await t512(t);
  const out = await render_cast_of_characters(store, { matt_num: "T512", matter_root: matterRoot });
  assert.equal(out.cast_of_characters_path, join(matterRoot, "0. DRAFT", "Cast of Characters.html"));
  assert.ok(existsSync(out.cast_of_characters_path));
  assert.deepEqual(Object.keys(out), ["cast_of_characters_path", "counts"]);
  assert.deepEqual(out.counts.tabs, { "Service List": 3, Litigants: 3, Witnesses: 3, "Public Bodies": 2 });
  assert.deepEqual(out.counts.flagged, { unconfirmed: 1, missing_details: 4, conflicting_details: 1, privileged_source: 1 });
  const again = await render_cast_of_characters(store, { matt_num: "T512", matter_root: matterRoot });
  assert.equal(again.cast_of_characters_path, out.cast_of_characters_path, "its own page is overwritten");

  writeFileSync(out.cast_of_characters_path, "<!doctype html><p>someone else's page</p>", "utf-8");
  await assert.rejects(render_cast_of_characters(store, { matt_num: "T512", matter_root: matterRoot }), /refusing to overwrite .*Cast of Characters\.html/);
});
