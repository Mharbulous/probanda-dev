// ADR 0009, firm-wide contacts spec 4: contacts, affiliations and matter roles as practice items,
// the client roles written with a matter, contact_lookup's near matches, the two gap checks, and
// merge_contact, which deletes no information. The cloud's rules are tested in cloud/items/tests/;
// the fake cloud here follows them only as far as these tests need.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { writePartiesOfRecord } from "./helpers/matter-data-fixture.mjs";
import { startFakeCloud } from "./helpers/fake-cloud.mjs";

const { PracticeStore } = await import("../build/practice/store.js");
const reads = await import("../build/tools/practice/reads.js");
const writes = await import("../build/tools/practice/writes.js");
const contacts = await import("../build/tools/practice/contacts.js");
const { render_practice_board } = await import("../build/tools/practice/practice-board.js");
const { pagesPreview } = await import("../build/pages/preview.js");

async function setup(t, label, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), `coclerk-contacts-${label}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cloud = await startFakeCloud(t);
  const store = new PracticeStore({ ...process.env, ...cloud.env, COCLERK_DB_PATH: join(dir, `${randomUUID()}.db`), ...env });
  return { cloud, store, dir };
}

const matter = (store, num, extra = {}) =>
  writes.upsert_client_matter(store, { client_num: `C-${num}`, name: `Client ${num}`, matt_num: num, file_number: `F-${num}`, ...extra });

const person = (store, name, extra = {}) => contacts.upsert_contact(store, { entity: "person", name, ...extra });

test("a contact, an affiliation and a matter role are written, and an update changes only what it names", async (t) => {
  const { store } = await setup(t, "writes");
  const { matter_id } = await matter(store, "L101");
  const jane = await person(store, "Jane Lawyer", { emails: ["jane@firm.example"] });
  assert.equal(jane.created, true);
  const firm = await contacts.upsert_contact(store, { entity: "organization", name: "Firm LLP" });
  const tie = await contacts.upsert_affiliation(store, { person_id: jane.contact_id, organization_id: firm.contact_id, from: "2020-01-01", title: "Partner" });
  assert.deepEqual([tie.person_id, tie.organization_id, tie.title], [jane.contact_id, firm.contact_id, "Partner"]);
  const again = await contacts.upsert_affiliation(store, { person_id: jane.contact_id, organization_id: firm.contact_id, from: "2020-01-01" });
  assert.equal(again.id, tie.id, "the same tie is one affiliation");

  const role = await contacts.upsert_matter_role(store, { matt_num: "L101", contact_id: jane.contact_id, role: "opposing_counsel", case_party_id: 2 });
  assert.deepEqual([role.matter_id, role.contact_id, role.role, role.case_party_id], [matter_id, jane.contact_id, "opposing_counsel", 2]);
  const twice = await contacts.upsert_matter_role(store, { matt_num: "L101", contact_id: jane.contact_id, role: "opposing_counsel" });
  assert.equal(twice.id, role.id, "proposing the same role twice is one role");
  const other = await contacts.upsert_matter_role(store, { matt_num: "L101", contact_id: jane.contact_id, role: "opposing_counsel", case_proceeding_id: 7 });
  assert.notEqual(other.id, role.id, "the same role in a proceeding of its own is a second role");

  await contacts.upsert_contact(store, { id: jane.contact_id, phones: ["604-555-0101"] });
  const [stored] = store.rows("contact").filter((row) => row.id === jane.contact_id);
  assert.deepEqual([stored.name, stored.emails, stored.phones], ["Jane Lawyer", ["jane@firm.example"], ["604-555-0101"]]);
});

test("a contact's data leaves the machine only as hashes; its entity and a role's role are tags", async (t) => {
  const { store, cloud } = await setup(t, "hashes");
  await matter(store, "L102");
  const { contact_id } = await person(store, "Private Person", { emails: ["private@example.com"] });
  await contacts.upsert_matter_role(store, { matt_num: "L102", contact_id, role: "client" });
  const sent = JSON.stringify(cloud.writes());
  assert.doesNotMatch(sent, /Private Person|private@example\.com/);
  const [contactOp] = cloud.writes().at(-2).ops;
  assert.deepEqual(contactOp.tags, { entity: "person" });
  assert.match(contactOp.hashes.name, /^[0-9a-f]{64}$/);
  assert.deepEqual(cloud.writes().at(-1).ops[0].tags, { role: "client" });
});

test("upsert_client_matter with client_contacts writes the new contact and its client role in the same write", async (t) => {
  const { store, cloud } = await setup(t, "client-contacts");
  const existing = await person(store, "Joint Client");
  const before = cloud.writes().length;
  const result = await matter(store, "L103", { client_contacts: [{ contact_id: existing.contact_id }, { entity: "organization", name: "Client Holdings Ltd." }] });
  assert.equal(cloud.writes().length, before + 1, "one write");
  assert.equal(result.matter_created, true);
  assert.equal(result.client_role_ids.length, 2);
  assert.equal(result.question, undefined);
  const roles = store.rows("matter_role");
  assert.deepEqual(roles.map((row) => [row.matter_id, row.role]), [[result.matter_id, "client"], [result.matter_id, "client"]]);
  assert.ok(roles.every((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.from)));
  assert.ok(store.rows("contact").some((row) => row.name === "Client Holdings Ltd." && row.entity === "organization"));
  assert.deepEqual((await contacts.contact_checks(store, { matt_num: "L103" })).matters_without_client, []);
});

test("a matter created without client_contacts asks who the client is, and check 1 reports it", async (t) => {
  const { store } = await setup(t, "no-client");
  const result = await matter(store, "L104");
  assert.deepEqual([result.client_role_ids, result.question], [[], "Who is the client on this matter?"]);
  const again = await matter(store, "L104");
  assert.equal(again.question, undefined, "an update does not ask");
  assert.deepEqual((await contacts.contact_checks(store, {})).matters_without_client,
    [{ matter_id: result.matter_id, matt_num: "L104", client_name: "Client L104" }]);
});

test("check 1 skips a closed matter and counts only a client role that has not ended", async (t) => {
  const { store } = await setup(t, "check1");
  await matter(store, "L105", { status: "closed" });
  const open = await matter(store, "L106");
  const { contact_id } = await person(store, "Former Client");
  await contacts.upsert_matter_role(store, { matt_num: "L106", contact_id, role: "client", from: "2020-01-01", to: "2021-01-01" });
  assert.deepEqual((await contacts.contact_checks(store, {})).matters_without_client.map((row) => row.matter_id), [open.matter_id]);
});

test("contact_lookup finds by name, email or phone and lists likely duplicates as near", async (t) => {
  const { store } = await setup(t, "lookup");
  await matter(store, "L107");
  const acme = await contacts.upsert_contact(store, { entity: "organization", name: "Acme Holdings Ltd.", phones: ["+1 (604) 555-0199"] });
  const acme2 = await contacts.upsert_contact(store, { entity: "organization", name: "ACME HOLDINGS INC" });
  const sharer = await person(store, "Reception Desk", { phones: ["604.555.0199"] });
  await person(store, "Unrelated Person");
  await contacts.upsert_matter_role(store, { matt_num: "L107", contact_id: acme.contact_id, role: "opposing_party" });

  const byName = await contacts.contact_lookup(store, { query: "acme holdings ltd" });
  assert.deepEqual(byName.contacts.map((row) => row.id), [acme.contact_id]);
  assert.deepEqual(byName.contacts[0].roles.map((row) => [row.matt_num, row.role]), [["L107", "opposing_party"]]);
  assert.deepEqual(byName.near.map((row) => [row.id, row.reasons]).sort(),
    [[acme2.contact_id, ["same name"]], [sharer.contact_id, ["shared phone"]]].sort());

  const byPhone = await contacts.contact_lookup(store, { query: "555-0199" });
  assert.deepEqual(byPhone.contacts.map((row) => row.id).sort(), [acme.contact_id, sharer.contact_id].sort());
  const byId = await contacts.contact_lookup(store, { id: acme2.contact_id });
  assert.deepEqual(byId.near.map((row) => row.id), [acme.contact_id]);
  await assert.rejects(contacts.contact_lookup(store, {}), /requires id or query/);
});

test("check 2 lists each matter-data party no matter role points to, by the matter-data folder named for the matter", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "coclerk-contacts-root-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { store } = await setup(t, "check2", { COCLERK_CASE_DATA_ROOT: root });
  const folder = join(root, "L108 Smith v Jones");
  mkdirSync(folder);
  writePartiesOfRecord(folder, {
    proceedings: [{ id: 1, file_number: "S-1" }, { id: 2, file_number: "CA-2" }],
    parties: [
      { id: 1, name: "Sam Smith", of_record: [[1, "plaintiff"]] },
      { id: 2, name: "Jo Jones", counsel_name: "Y. Counsel", counsel_firm: "Y LLP", of_record: [[1, "defendant"], [2, "respondent"]] },
    ],
  });
  const { matter_id } = await matter(store, "L108");
  const { contact_id } = await person(store, "Sam Smith");
  await contacts.upsert_matter_role(store, { matt_num: "L108", contact_id, role: "client", case_party_id: 1, case_proceeding_id: 1 });

  const result = await contacts.contact_checks(store, {});
  assert.deepEqual(result.parties_without_role, [{
    matter_id, party_id: 2, name: "Jo Jones", party_type: null, proceeding_ids: [1, 2], lawyer_name: "Y. Counsel", lawyer_firm: "Y LLP",
  }]);
  assert.deepEqual(result.unresolved, []);

  // A second folder with case data for the same matter number is never guessed between.
  const second = join(root, "L108- Smith v Jones appeal");
  mkdirSync(second);
  writePartiesOfRecord(second, { parties: [{ id: 1, name: "Sam Smith" }] });
  const twice = await contacts.contact_checks(store, {});
  assert.deepEqual(twice.parties_without_role, []);
  assert.deepEqual(twice.unresolved.map((row) => [row.matter_id, row.matt_num]), [[matter_id, "L108"]]);
  assert.match(twice.unresolved[0].reason, /more than one matter-data folder/);
});

test("check 2 finds a matter's own 0. CASE DATA folder (ADR 0013) ahead of an old one under the firm root", async (t) => {
  const library = mkdtempSync(join(tmpdir(), "coclerk-contacts-library-"));
  t.after(() => rmSync(library, { recursive: true, force: true }));
  const root = join(library, "0. CASE DATA");
  mkdirSync(root);
  const { store } = await setup(t, "check2-in-matter", { COCLERK_CASE_DATA_ROOT: root });
  const own = join(library, "L112 Smith v Jones", "0. CASE DATA");
  mkdirSync(own, { recursive: true });
  writePartiesOfRecord(own, { parties: [{ id: 1, name: "Sam Smith" }, { id: 2, name: "Jo Jones" }] });
  // The old copy relocate leaves in place is not a second candidate.
  const old = join(root, "L112 Smith v Jones");
  mkdirSync(old);
  writePartiesOfRecord(old, { parties: [{ id: 1, name: "Sam Smith" }] });
  const { matter_id } = await matter(store, "L112");
  const { contact_id } = await person(store, "Sam Smith");
  await contacts.upsert_matter_role(store, { matt_num: "L112", contact_id, role: "client", case_party_id: 1 });

  const result = await contacts.contact_checks(store, {});
  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(result.parties_without_role.map((row) => [row.matter_id, row.party_id, row.name]), [[matter_id, 2, "Jo Jones"]]);
});

test("merge_contact combines lists, keeps the spare's name, moves and combines its roles, and deletes the spare", async (t) => {
  const { store } = await setup(t, "merge");
  await matter(store, "L109");
  await matter(store, "L110");
  const keep = await person(store, "John Smith", { emails: ["john@a.example"], note: "Prefers email" });
  const spare = await person(store, "J. Smith", { emails: ["john@a.example", "js@b.example"], phones: ["604-555-0100"] });
  const firm = await contacts.upsert_contact(store, { entity: "organization", name: "Smith Law" });
  await contacts.upsert_matter_role(store, { matt_num: "L109", contact_id: keep.contact_id, role: "opposing_counsel" });
  const twin = await contacts.upsert_matter_role(store, { matt_num: "L109", contact_id: spare.contact_id, role: "opposing_counsel", case_party_id: 4 });
  const other = await contacts.upsert_matter_role(store, { matt_num: "L110", contact_id: spare.contact_id, role: "expert" });
  const tie = await contacts.upsert_affiliation(store, { person_id: spare.contact_id, organization_id: firm.contact_id, title: "Associate" });

  const result = await contacts.merge_contact(store, { keep_id: keep.contact_id, spare_id: spare.contact_id });
  assert.deepEqual(result, { merged: true, contact_id: keep.contact_id, moved: 2, combined: 1 });

  assert.ok(!store.items().has(spare.contact_id), "the spare is gone");
  assert.ok(!store.items().has(twin.id), "the spare's twin role is combined into keep's");
  const [kept] = store.rows("contact").filter((row) => row.id === keep.contact_id);
  assert.deepEqual([kept.name, kept.emails, kept.phones, kept.other_names, kept.note],
    ["John Smith", ["john@a.example", "js@b.example"], ["604-555-0100"], ["J. Smith"], "Prefers email"]);
  const roles = store.rows("matter_role");
  assert.ok(roles.every((row) => row.contact_id === keep.contact_id));
  assert.deepEqual(roles.filter((row) => row.role === "opposing_counsel").map((row) => row.case_party_id), [4], "the twin's case_party_id fills keep's role");
  assert.ok(roles.some((row) => row.id === other.id));
  const [moved] = store.rows("affiliation").filter((row) => row.id === tie.id);
  assert.equal(moved.person_id, keep.contact_id);
  assert.deepEqual((await contacts.contact_lookup(store, { query: "J. Smith" })).contacts.map((row) => row.id), [keep.contact_id]);
});

test("merge_contact writes nothing when the two contacts or their combined roles differ, and names each difference", async (t) => {
  const { store, cloud } = await setup(t, "merge-conflict");
  await matter(store, "L111");
  const keep = await person(store, "Ann Lee", { note: "Met at CLE" });
  const spare = await person(store, "Ann Lee", { note: "Referred by Bob" });
  await contacts.upsert_matter_role(store, { matt_num: "L111", contact_id: keep.contact_id, role: "client", from: "2024-01-01" });
  const spareRole = await contacts.upsert_matter_role(store, { matt_num: "L111", contact_id: spare.contact_id, role: "client", from: "2024-03-01" });
  const org = await contacts.upsert_contact(store, { entity: "organization", name: "Ann Lee Ltd." });
  const before = cloud.writes().length;

  const result = await contacts.merge_contact(store, { keep_id: keep.contact_id, spare_id: spare.contact_id });
  assert.equal(result.merged, false);
  assert.deepEqual(result.conflicts.map((c) => [c.field, c.keep, c.spare]).sort(),
    [["from", "2024-01-01", "2024-03-01"], ["note", "Met at CLE", "Referred by Bob"]]);
  assert.equal(cloud.writes().length, before, "nothing left the machine");
  assert.ok(store.items().has(spare.contact_id) && store.items().has(spareRole.id));

  const entity = await contacts.merge_contact(store, { keep_id: org.contact_id, spare_id: keep.contact_id });
  assert.deepEqual(entity.conflicts.find((c) => c.field === "entity"), { item: org.contact_id, field: "entity", keep: "organization", spare: "person" });
});

test("the cloud's refusal of a contact write comes back as its question, with nothing pending", async (t) => {
  const { store, cloud } = await setup(t, "refusal");
  const { contact_id } = await person(store, "Named Person");
  cloud.refuse = (write) => write.tool === "upsert_contact" ? `What is the name of {{item:${contact_id}}}?` : undefined;
  await assert.rejects(contacts.upsert_contact(store, { id: contact_id, name: null }), (err) => {
    assert.match(err.message, /What is the name of .*"Named Person"\?/);
    return true;
  });
  assert.equal(store.pendingCount(), 0);
  assert.equal(store.rows("contact")[0].name, "Named Person");
});

test("an old copy's reads are the same with contacts, affiliations and matter roles in the store", async (t) => {
  const { store, dir } = await setup(t, "old-copy");
  await matter(store, "L112");
  await writes.insert_time_entry(store, { matt_num: "L112", entry_date: "2026-10-01", hours: 1.5, description: "Draft" });
  await writes.upsert_task(store, { matt_num: "L112", task_type: "client", description: "Call client", deadline_date: "2026-10-20" });
  const readAll = async () => {
    const board = await render_practice_board(store);
    assert.equal(dirname(board.work_board_path), dir, "the Work Board goes beside the store's own practice.db (#124)");
    delete board.work_board_path;
    return {
      lookup: (await reads.matter_lookup(store, { matt_num: "L112" })).rows.map(({ updated_at, ...row }) => row),
      ar: await reads.ar_data(store),
      board,
    };
  };
  const before = await readAll();
  const preview = await pagesPreview({ page: "Work Board", data: "real" }, store);
  assert.equal(dirname(preview.path), dir, "the real-data Work Board preview goes beside the store's own practice.db (#124)");

  const { contact_id } = await person(store, "Client Person");
  const firm = await contacts.upsert_contact(store, { entity: "organization", name: "Client Co" });
  await contacts.upsert_affiliation(store, { person_id: contact_id, organization_id: firm.contact_id });
  await contacts.upsert_matter_role(store, { matt_num: "L112", contact_id, role: "client" });

  assert.deepEqual(await readAll(), before);
});
