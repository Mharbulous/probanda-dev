// The address-book import's pure parts: reading a contacts CSV, working out add-only card
// edits, and sorting rows against the cards already held. Every name and number is invented.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

// The state folder is a temp one, so no test writes a backup into the real one.
const STATE_DIR = mkdtempSync(join(tmpdir(), "coclerk-contacts-write-"));
const SAVED_LOCALAPPDATA = process.env.LOCALAPPDATA;
process.env.LOCALAPPDATA = STATE_DIR;
after(() => {
  if (SAVED_LOCALAPPDATA === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = SAVED_LOCALAPPDATA;
  rmSync(STATE_DIR, { recursive: true, force: true });
});

const server = await import("../build/contacts-calendars-email-dispatch.js");
const { approved } = await import("./approved-call.mjs");
const callTool = approved(server.callContactsCalendarsEmailTool);
const dispatchTool = approved(server.dispatchContactsCalendarsEmailTool);
const { createCard, removeCard, replaceCard } = await import("../build/contacts/card-write.js");
const { permittedRequest } = await import("../build/dav/session.js");

const { decodeCsv, parseCsv, readContactRows } = await import("../build/contacts/import-csv.js");
const { additions, addLines, lostProperties, newCard } = await import("../build/contacts/vcard-edit.js");
const { classify } = await import("../build/contacts/import-classify.js");
const { parseContact } = await import("../build/contacts/vcard.js");

const HEADER = '"First Name","Last Name","Company","Job Title","E-mail Address","Mobile Phone","Business Phone","Business Postal Code","Business Street","Business City","Birthday","Notes","Name"';
const csv = (...lines) => [HEADER, ...lines].join("\r\n") + "\r\n";
const rowsOf = (...lines) => readContactRows(csv(...lines)).rows;

const card = (url, lines) => ({
  url, etag: `"${url}-1"`,
  text: ["BEGIN:VCARD", "VERSION:3.0", ...lines, "REV:2020-01-01T00:00:00Z", `UID:${url}`, "END:VCARD", ""].join("\r\n"),
});
const person = (url, first, last, extra = []) => card(url, [`N:${last};${first};;;`, `FN:${first} ${last}`, ...extra]);
const company = (url, name, extra = []) => card(url, ["N:;;;;", `FN:${name}`, `ORG:${name};`, "X-ABShowAs:COMPANY", ...extra]);
const classes = (result) => result.outcomes.map((outcome) => outcome.class);

test("a CSV is read by header name, with quoted commas, doubled quotes and line breaks inside a cell", () => {
  assert.deepEqual(parseCsv('a,"b, ""c""\r\nd"\r\n\r\n,,\r\ne,f'), [["a", 'b, "c"\r\nd'], ["e", "f"]]);
  assert.equal(decodeCsv(Uint8Array.from([0xef, 0xbb, 0xbf, 0x61])), "a");
  assert.equal(decodeCsv(Uint8Array.from([0x52, 0x65, 0x6e, 0xe9])), "René"); // Windows-1252
  assert.throws(() => readContactRows('"Colour","Size"\r\n"red","9"\r\n'), /no header row/);
});

test("placeholders read as empty, a company-only row is a company, and a row naming nobody is left out", () => {
  const { rows, skipped } = readContactRows(csv(
    '"","","Harbour Example LLP","","","+16045550101","","","","","1899-01-01","","null null"',
    '"Ada","Sample","Harbour Example LLP","Partner","Ada@Example.test","604-555-0102","604-555-0102","V6C 2T5","1 Sample St","Vancouver","1980-02-03","-",""',
    '"","","","","","604-555-0103","","","","","","","null null"',
  ));
  assert.deepEqual(skipped, [{ row: 4, reason: "no name" }]);
  assert.deepEqual([rows[0].kind, rows[0].name, rows[0].birthday, rows[0].phones], ["company", "Harbour Example LLP", "", [{ label: "mobile", value: "+16045550101" }]]);
  assert.deepEqual([rows[1].kind, rows[1].name, rows[1].birthday, rows[1].notes], ["person", "Ada Sample", "1980-02-03", ""]);
  assert.deepEqual(rows[1].phones, [{ label: "mobile", value: "604-555-0102" }], "the same number in two columns is one phone");
  assert.equal(rows[1].addresses[0].postalCode, "V6C 2T5");
});

test("an edit adds only what the card lacks, leaves every existing line as it was, and reports a differing value", () => {
  const held = person("a", "Ada", "Sample", [
    "item1.TEL;type=pref:(604) 555-0102", "item1.X-ABLabel:_$!<Other>!$_", "TITLE:Associate",
    "PHOTO;ENCODING=b;TYPE=JPEG:AAAA\r\n BBBB", "X-CUSTOM:kept",
  ]);
  const [row] = rowsOf('"Ada","Sample","Harbour Example LLP","Partner","ada@example.test","+1 604 555 0102","604-555-0199 x12","","","","","Met at a seminar; call first",""');
  const { lines, added, conflicts } = additions(held.text, row);
  assert.deepEqual(lines, [
    "EMAIL;type=INTERNET:ada@example.test", "TEL;type=WORK;type=VOICE:604-555-0199 x12",
    "ORG:Harbour Example LLP;", "NOTE:Met at a seminar\\; call first",
  ]);
  assert.deepEqual(added, ["email ada@example.test", "work phone 604-555-0199 x12", "organization", "note"]);
  assert.deepEqual(conflicts, ["job title differs"]);

  const edited = addLines(held.text, lines, "2026-11-12T00:00:00Z");
  const before = held.text.split("\r\n").filter((line) => !line.startsWith("REV"));
  for (const line of before) assert.ok(edited.split("\r\n").includes(line), `kept: ${line}`);
  assert.match(edited, /NOTE:Met at a seminar\\; call first\r\nREV:2026-11-12T00:00:00Z\r\nEND:VCARD\r\n$/);
  assert.equal(edited.match(/^REV/gm).length, 1);
  assert.deepEqual(lostProperties(held.text, edited), []);
  assert.deepEqual(lostProperties(held.text, edited.replace("X-CUSTOM:kept\r\n", "")), ["X-CUSTOM"]);
  assert.deepEqual(additions(edited, row).lines, [], "a second pass adds nothing");
});

test("a new card holds the row's details, and a long line is folded", () => {
  const [row] = rowsOf(`"","","Harbour Example LLP","","info@harbour.example","","604-555-0101","V6C 2T5","1 Sample St, Suite 2","Vancouver","","${"long note ".repeat(12)}",""`);
  const text = newCard(row, "uid-1", "2026-11-12T00:00:00Z");
  assert.ok(text.split("\r\n").every((line) => line.length <= 75));
  const contact = parseContact(text);
  assert.deepEqual([contact.name, contact.organization, contact.firstName, contact.uid], ["Harbour Example LLP", "Harbour Example LLP", undefined, "uid-1"]);
  assert.deepEqual(contact.phones, [{ label: "work", value: "604-555-0101", preferred: undefined }]);
  assert.deepEqual([contact.addresses[0].street, contact.addresses[0].postalCode], ["1 Sample St, Suite 2", "V6C 2T5"]);
  assert.equal(contact.notes, "long note ".repeat(12).trim());
  assert.match(text, /X-ABShowAs:COMPANY/);
});

test("rows sort into new, add-only, unchanged and ambiguous, and a shared office line proves nothing", () => {
  const cards = [
    person("ada", "Ada", "Sample", ["TEL;type=CELL:604-555-0102"]),
    person("ben", "Ben", "Sample", ["TEL;type=WORK:604-555-0101", "EMAIL:ben@example.test"]),
    person("cy", "Cy", "Sample", ["TEL;type=WORK:604-555-0101"]),
    person("dee", "Dee", "Sample", ["TEL;type=CELL:604-555-0104"]),
    company("harbour", "Harbour Example Ltd.", ["TEL;type=MAIN:604-555-0101"]),
    card("group", ["N:Clients;;;;", "FN:Clients", "X-ADDRESSBOOKSERVER-KIND:group"]),
  ];
  const result = classify(rowsOf(
    '"Ada","Sample","","","ada@example.test","(604) 555-0102","","","","","","",""', // same name and phone: add the email
    '"Ada","Sample","","","","16045550102","","","","","","",""',                    // nothing to add
    '"","","Harbour Example LLP","","","","604-555-0101","","","","","",""',          // company, same name once suffixes go
    '"Eve","Sample","","","","","604-555-0101","","","","","",""',                    // an office line three contacts hold
    '"Dee","Other","","","","604-555-0104","","","","","","",""',                     // one person's own number, another name
    '"Fay","Sample","","","ben@example.test","","","","","","","",""',                // another name's email
    '"Ben","Sample","","","","604-555-0177","","","","","","",""',                    // same name, no shared detail
    '"Clients","","","","","","","","","","","",""',                                  // a group card is not a contact
    '"Eve","Sample","","","eve@example.test","","604-555-0101","","","","","",""',    // the same new person, later in the file
  ), cards);
  assert.deepEqual(classes(result), ["add_only", "unchanged", "unchanged", "new", "ambiguous", "ambiguous", "ambiguous", "new", "duplicate_row"]);
  assert.deepEqual(result.outcomes.filter((outcome) => outcome.class === "ambiguous").map((outcome) => [outcome.reason, outcome.candidates]), [
    ["shares a phone with a different name", ["Dee Sample"]],
    ["shares an email with a different name", ["Ben Sample"]],
    ["same name, no shared detail", ["Ben Sample"]],
  ]);
  assert.deepEqual(result.updates, [{ url: "ada", etag: '"ada-1"', lines: ["EMAIL;type=INTERNET:ada@example.test"], rows: [2] }]);
  assert.deepEqual(result.creates.map((entry) => [entry.row, entry.lines]), [[5, ["EMAIL;type=INTERNET:eve@example.test"]], [9, []]]);
});

test("a second run of the same file, after the first is applied, writes nothing", () => {
  const rows = rowsOf(
    '"Ada","Sample","","Partner","ada@example.test","604-555-0102","","V6C 2T5","1 Sample St","Vancouver","1980-02-03","A note",""',
    '"","","Harbour Example LLP","","","","604-555-0101","","","","","",""',
    '"Gil","Sample","","","","","","","","","","",""',
    '"Ada","Sample","","","","","604-555-0188","V6C2T5","","","","",""',
  );
  const first = classify(rows, [person("ada", "Ada", "Sample", ["TEL;type=CELL:604-555-0102"])]);
  assert.deepEqual(classes(first), ["add_only", "new", "new", "add_only"]);
  const applied = [
    ...first.updates.map((update) => ({ url: update.url, text: addLines(person("ada", "Ada", "Sample", ["TEL;type=CELL:604-555-0102"]).text, update.lines, "r") })),
    ...first.creates.map((create) => ({ url: `new-${create.row}`, text: addLines(newCard(create.incoming, `u${create.row}`, "r"), create.lines, "r") })),
  ];
  const second = classify(rows, applied);
  assert.deepEqual(classes(second), ["unchanged", "unchanged", "unchanged", "unchanged"]);
  assert.deepEqual([second.creates, second.updates], [[], []]);
});

// --- writing: a fake address book that checks each request's condition, as the server does ---

const FAKE = { host: "imap.example.test", port: 993, secure: true, username: "someone", password: "fake-password-3333-not-real", carddavUrl: "https://contacts.example.test" };
const BOOK = "https://contacts.example.test/123/carddavhome/card/";

function fakeBook(initial = {}, { rewrite = (text) => text } = {}) {
  const store = new Map(Object.entries(initial).map(([name, text]) => [BOOK + name, { text, etag: '"1"' }]));
  const sent = [];
  const davFetch = async (url, init) => {
    const headers = new Headers(init.headers);
    sent.push([init.method, url.replace(BOOK, ""), headers.get("if-match") ?? headers.get("if-none-match") ?? ""]);
    const held = store.get(url);
    if (init.method === "GET") {
      return held ? new Response(held.text, { status: 200, headers: { etag: held.etag } }) : new Response("", { status: 404 });
    }
    if (headers.get("if-none-match") === "*" ? held : !held || held.etag !== headers.get("if-match")) return new Response("", { status: 412 });
    if (init.method === "DELETE") store.delete(url);
    else store.set(url, { text: rewrite(init.body), etag: `"${Number((held?.etag ?? '"0"').slice(1, -1)) + 1}"` });
    return new Response(null, { status: 204 });
  };
  const davClientFactory = async () => ({
    fetchCalendars: async () => [],
    fetchCalendarObjects: async () => [],
    fetchAddressBooks: async () => [{ url: BOOK }],
    fetchVCards: async () => [...store].map(([url, held]) => ({ url, etag: held.etag, data: held.text })),
  });
  return { store, sent, context: { practiceDb: {}, mail: { credential: { ...FAKE } }, davClientFactory, davFetch } };
}

const ADA = person("ada", "Ada", "Sample", ["TEL;type=CELL:604-555-0102"]).text;

test("a create, a replace and a remove each go out under their condition, and a changed card stops them", async () => {
  const { store, sent, context } = fakeBook({ "ada.vcf": ADA });
  const credential = context.mail.credential;
  const made = await createCard(context, credential, BOOK, "new.vcf", ADA);
  assert.equal(made.url, `${BOOK}new.vcf`);
  await assert.rejects(createCard(context, credential, BOOK, "ada.vcf", ADA), { code: "dav_exists" });
  await replaceCard(context, credential, BOOK, `${BOOK}ada.vcf`, '"1"', ADA + "X");
  await assert.rejects(replaceCard(context, credential, BOOK, `${BOOK}ada.vcf`, '"1"', ADA), { code: "dav_stale" });
  await assert.rejects(removeCard(context, credential, BOOK, `${BOOK}ada.vcf`, '"1"'), { code: "dav_stale" });
  await removeCard(context, credential, BOOK, `${BOOK}ada.vcf`, '"2"');
  assert.deepEqual([...store.keys()], [`${BOOK}new.vcf`]);
  assert.deepEqual(sent, [
    ["PUT", "new.vcf", "*"], ["PUT", "ada.vcf", "*"], ["PUT", "ada.vcf", '"1"'], ["PUT", "ada.vcf", '"1"'],
    ["DELETE", "ada.vcf", '"1"'], ["DELETE", "ada.vcf", '"2"'],
  ]);
});

test("nothing is sent without a condition, to anything but a card in the address book, or under a permit that refuses", async () => {
  const { sent, context } = fakeBook({ "ada.vcf": ADA });
  const credential = context.mail.credential;
  for (const etag of [undefined, null, ""]) {
    await assert.rejects(replaceCard(context, credential, BOOK, `${BOOK}ada.vcf`, etag, ADA), { code: "dav_stale" });
    await assert.rejects(removeCard(context, credential, BOOK, `${BOOK}ada.vcf`, etag), { code: "dav_stale" });
  }
  await assert.rejects(replaceCard(context, credential, BOOK, `${BOOK}ada.vcf`, "*", ADA), /changes only under its condition/);
  const open = { collectionUrl: BOOK, check() {} };
  for (const url of [
    BOOK, `${BOOK}sub/ada.vcf`, `${BOOK}ada.ics`, `${BOOK}ada.vcf?x=1`, "https://contacts.example.test/123/calendars/work/e.ics",
    "https://contacts.example.test/123/carddavhome/other/ada.vcf", "https://elsewhere.example.test/123/carddavhome/card/ada.vcf",
  ]) {
    await assert.rejects(permittedRequest(context, credential, url, { method: "PUT", headers: {} }, open), /Refusing/, url);
  }
  const closed = { collectionUrl: BOOK, check: () => { throw new Error("Refusing: not permitted"); } };
  await assert.rejects(permittedRequest(context, credential, `${BOOK}ada.vcf`, { method: "PUT", headers: {} }, closed), /not permitted/);
  assert.deepEqual(sent, []);
});

test("the write probe creates, changes, backs up and removes one test card, and names what the server dropped", async () => {
  const { store, sent, context } = fakeBook({ "ada.vcf": ADA }, { rewrite: (text) => text.replace(/^X-PROBANDA-PROBE:.*\r\n/m, "") });
  const result = await callTool(context, "contacts__write_probe", {});
  assert.deepEqual([result.can_write, result.removed, result.altered_on_create, result.altered_on_update], [true, true, ["X-PROBANDA-PROBE"], []]);
  assert.deepEqual(sent.map(([method]) => method), ["PUT", "GET", "PUT", "GET", "DELETE", "GET"]);
  assert.deepEqual([...store.keys()], [`${BOOK}ada.vcf`], "only the test card came and went");
  assert.ok(result.backup_path.startsWith(STATE_DIR) && existsSync(result.backup_path));
  assert.match(readFileSync(result.backup_path, "utf-8"), /FN:ZZ Probanda test - safe to remove/);
});

test("a server that refuses writes fails the probe with its answer, and a probe stopped part-way names the test card", async () => {
  const refusing = fakeBook();
  refusing.context.davFetch = async () => new Response("", { status: 403 });
  const refused = JSON.parse((await dispatchTool(refusing.context, "contacts__write_probe", {})).content[0].text).error;
  assert.match(refused.message, /was not created: HTTP 403/);

  const partial = fakeBook();
  const fetch = partial.context.davFetch;
  let writes = 0;
  partial.context.davFetch = async (url, init) => (init.method === "PUT" && ++writes === 2 ? new Response("", { status: 500 }) : fetch(url, init));
  const stopped = JSON.parse((await dispatchTool(partial.context, "contacts__write_probe", {})).content[0].text).error;
  assert.match(stopped.message, /stopped part-way: .*HTTP 500.*"ZZ Probanda test - safe to remove" may remain/);
});

// --- the import tools, end to end against the fake address book ---

const errorOf = async (context, name, args) => {
  const result = await dispatchTool(context, name, args);
  assert.equal(result.isError, true, result.content[0].text);
  return JSON.parse(result.content[0].text).error;
};

function csvFile(...lines) {
  const path = join(mkdtempSync(join(STATE_DIR, "csv-")), "contacts.csv");
  writeFileSync(path, csv(...lines), "utf-8");
  return path;
}

const IMPORT_ROWS = [
  '"Ada","Sample","","","ada@example.test","604-555-0102","","","","","","",""',
  '"","","Harbour Example LLP","","","","604-555-0101","","","","1899-01-01","","null null"',
  '"Gil","Sample","","","gil@example.test","","","","","","","",""',
  '"Ada","Other","","","","604-555-0102","","","","","","",""',
];

test("a scan writes nothing, an approved plan adds the new contacts and details, and a second scan finds nothing to do", async () => {
  const { store, sent, context } = fakeBook({ "ada.vcf": ADA });
  const path = csvFile(...IMPORT_ROWS);
  const scan = await callTool(context, "contacts__import_scan", { path });
  assert.deepEqual(scan.counts, { new: 2, add_only: 1, unchanged: 0, duplicate_row: 0, ambiguous: 1, left_out: 0 });
  assert.deepEqual([scan.rows, scan.create_count, scan.update_count], [4, 2, 1]);
  assert.deepEqual(scan.ambiguous.map((row) => [row.row, row.name, row.reason]), [[5, "Ada Other", "shares a phone with a different name"]]);
  assert.match(readFileSync(scan.report_path, "utf-8"), /row 2: Ada Sample - add to the existing contact: email ada@example\.test\r\nrow 3: Harbour Example LLP - new contact/);
  assert.deepEqual([sent, store.size], [[], 1], "the scan sent nothing");
  const page = await callTool(context, "contacts__read_report", { report_path: scan.report_path, offset: 1, limit: 2 });
  assert.deepEqual([page.total, page.offset, page.next_offset], [4, 1, 3]);
  assert.match(page.lines[0], /^row 3: Harbour Example LLP - new contact/);
  assert.equal((await callTool(context, "contacts__read_report", { report_path: scan.report_path, offset: 3 })).next_offset, undefined);
  assert.equal((await errorOf(context, "contacts__read_report", { report_path: join(STATE_DIR, "elsewhere.txt") })).message.includes("report_path must be"), true);

  assert.match((await errorOf(context, "contacts__import_apply", { plan_id: scan.plan_id, create_count: 3, update_count: 1 })).message, /must be the plan's: 2 and 1/);
  assert.equal((await errorOf(context, "contacts__import_apply_continue", { plan_id: scan.plan_id })).code, "contacts_plan_not_started");
  const applied = await callTool(context, "contacts__import_apply", { plan_id: scan.plan_id, create_count: 2, update_count: 1 });
  assert.deepEqual([applied.status, applied.created, applied.updated, applied.remaining, applied.stopped], ["done", 2, 1, 0, []]);
  assert.equal(store.size, 3);
  assert.match(store.get(`${BOOK}ada.vcf`).text, /TEL;type=CELL:604-555-0102\r\n(.*\r\n)*EMAIL;type=INTERNET:ada@example\.test\r\nREV:/);
  assert.ok(sent.every(([method]) => method !== "DELETE"));
  assert.equal((await errorOf(context, "contacts__import_apply", { plan_id: scan.plan_id, create_count: 2, update_count: 1 })).code, "contacts_plan_started");

  const again = await callTool(context, "contacts__import_scan", { path });
  assert.deepEqual([again.create_count, again.update_count, again.counts.unchanged, again.counts.ambiguous], [0, 0, 3, 1]);
  assert.match((await errorOf(context, "contacts__import_apply", { plan_id: again.plan_id, create_count: 0, update_count: 0 })).message, /changes nothing/);
});

test("a long plan runs over several calls, and a stopped run continues without writing anything twice", async () => {
  const { store, sent, context } = fakeBook({ "ada.vcf": ADA });
  context.contactsBudgetMs = 0;
  const scan = await callTool(context, "contacts__import_scan", { path: csvFile(...IMPORT_ROWS) });
  const first = await callTool(context, "contacts__import_apply", { plan_id: scan.plan_id, create_count: 2, update_count: 1 });
  assert.deepEqual([first.status, first.created, first.remaining], ["writing", 1, 2]);
  // The second create reaches the server, then the call dies before its result is recorded.
  const fetch = context.davFetch;
  let gets = 0;
  context.davFetch = async (url, init) => (init.method === "GET" && ++gets === 1 ? Promise.reject(new Error("connection lost")) : fetch(url, init));
  assert.equal((await errorOf(context, "contacts__import_apply_continue", { plan_id: scan.plan_id })).code, "dav_error");
  assert.equal(store.size, 3, "the card was created before the call died");
  for (let i = 0; i < 2; i++) await callTool(context, "contacts__import_apply_continue", { plan_id: scan.plan_id });
  const last = await callTool(context, "contacts__import_apply_continue", { plan_id: scan.plan_id });
  assert.deepEqual([last.status, last.created, last.updated, last.stopped_count], ["done", 2, 1, 0]);
  assert.equal(store.size, 3);
  assert.equal(sent.filter(([method, , condition]) => method === "PUT" && condition !== "*").length, 1, "the existing card was changed once");
});

test("a contact that changed or went since the scan is left as it is and listed, and a card the server altered is named", async () => {
  const { store, context } = fakeBook({ "ada.vcf": ADA, "gil.vcf": person("gil", "Gil", "Sample", ["EMAIL:gil@example.test"]).text });
  const scan = await callTool(context, "contacts__import_scan", { path: csvFile(
    '"Ada","Sample","","","ada@example.test","604-555-0102","","","","","","",""',
    '"Gil","Sample","","","gil@example.test","604-555-0105","","","","","","",""',
  ) });
  assert.equal(scan.update_count, 2);
  store.set(`${BOOK}ada.vcf`, { text: ADA.replace("END:VCARD", "NOTE:edited on the phone\r\nEND:VCARD"), etag: '"9"' });
  store.delete(`${BOOK}gil.vcf`);
  const applied = await callTool(context, "contacts__import_apply", { plan_id: scan.plan_id, create_count: 0, update_count: 2 });
  assert.deepEqual([applied.status, applied.updated, applied.stopped], ["done", 0, [
    { name: "Ada Sample", why: "changed since the scan, so it was left as it is" },
    { name: "Gil Sample", why: "no longer in the address book" },
  ]]);
  assert.match(store.get(`${BOOK}ada.vcf`).text, /NOTE:edited on the phone/);
  assert.doesNotMatch(store.get(`${BOOK}ada.vcf`).text, /ada@example\.test/);

  const altering = fakeBook({}, { rewrite: (text) => text.replace(/^TEL.*\r\n/m, "") });
  const plan = await callTool(altering.context, "contacts__import_scan", { path: csvFile('"Hal","Sample","","","","604-555-0106","","","","","","",""') });
  const result = await callTool(altering.context, "contacts__import_apply", { plan_id: plan.plan_id, create_count: 1, update_count: 0 });
  assert.deepEqual(result.stopped, [{ name: "Hal Sample", why: "added, but the address book holds it differently (TEL)" }]);
});

test("the practitioner's decision settles an ambiguous row, as a new contact or as an existing one, and no other row", async () => {
  const { store, context } = fakeBook({ "ada.vcf": ADA });
  const path = csvFile(
    '"Ada","Other","","","","604-555-0102","","","","","","",""',
    '"Ada","Sample","","","","604-555-0177","","","","","","",""',
    '"Gil","Sample","","","","","","","","","","",""',
  );
  const scan = await callTool(context, "contacts__import_scan", { path });
  assert.deepEqual([scan.counts.ambiguous, scan.create_count, scan.update_count], [2, 1, 0]);
  const decided = await callTool(context, "contacts__import_scan", { path, decisions: { 2: "new", 3: `${BOOK}ada.vcf`, 4: `${BOOK}ada.vcf` } });
  assert.deepEqual([decided.counts.ambiguous, decided.create_count, decided.update_count], [0, 2, 1]);
  await callTool(context, "contacts__import_apply", { plan_id: decided.plan_id, create_count: 2, update_count: 1 });
  assert.equal(store.size, 3);
  assert.match(store.get(`${BOOK}ada.vcf`).text, /TEL;type=CELL;type=VOICE:604-555-0177/);
  assert.match((await errorOf(context, "contacts__import_scan", { path: join(STATE_DIR, "missing.csv") })).message, /Could not read a file/);
});

// --- merging duplicate cards ---

// Each fixture card's UID is its short name, so the group card names ben1 by it.
const DUPLICATES = {
  "ada1.vcf": person("ada1", "Ada", "Sample", ["TEL;type=CELL:604-555-0102", "EMAIL:ada@example.test"]).text,
  "ada2.vcf": person("ada2", "Ada", "Sample", ["TEL;type=CELL:(604) 555-0102"]).text,
  "ben1.vcf": person("ben1", "Ben", "Sample", ["TEL;type=WORK:604-555-0110", "NOTE:First note"]).text,
  "ben2.vcf": person("ben2", "Ben", "Sample", [
    "TEL;type=WORK:+1 604 555 0110", "item1.TEL:604-555-0111", "item1.X-ABLabel:Cottage", "EMAIL:ben@example.test",
    "NOTE:Second note", "X-CUSTOM:carried", "PHOTO;ENCODING=b:AAAA",
  ]).text,
  "cy1.vcf": person("cy1", "Cy", "Sample", ["EMAIL:cy@example.test", "TITLE:Associate", "TEL:604-555-0120"]).text,
  "cy2.vcf": person("cy2", "Cy", "Sample", ["EMAIL:cy@example.test", "TITLE:Partner"]).text,
  "dee1.vcf": person("dee1", "Dee", "Sample", ["TEL:604-555-0130"]).text,
  "dee2.vcf": person("dee2", "Dee", "Sample", ["TEL:604-555-0131"]).text,
  "eve.vcf": person("eve", "Eve", "Sample", ["TEL:604-555-0140"]).text,
  "team.vcf": card("team", ["N:Team;;;;", "FN:Team", "X-ADDRESSBOOKSERVER-KIND:group", "X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:ben1"]).text,
};
const short = (url) => url.replace(BOOK, "");
const groupOf = (scan, name) => scan.groups.find((group) => group.contacts[0].name === name).group_id;

test("a merge scan sorts same-name contacts into exact, mergeable, needs a choice and possible, and sends nothing", async () => {
  const { sent, context } = fakeBook(DUPLICATES);
  const scan = await callTool(context, "contacts__merge_scan", {});
  assert.deepEqual(scan.counts, { exact: 1, mergeable: 1, needs_choice: 1, possible: 1 });
  assert.deepEqual(scan.groups.map((group) => [group.class, group.contacts.map((c) => c.name), short(group.keep), group.conflicts]), [
    ["exact", ["Ada Sample", "Ada Sample"], "ada1.vcf", []],
    ["mergeable", ["Ben Sample", "Ben Sample"], "ben2.vcf", []],
    ["needs_choice", ["Cy Sample", "Cy Sample"], "cy1.vcf", ["job title"]],
    ["possible", ["Dee Sample", "Dee Sample"], "dee1.vcf", []],
  ]);
  assert.match(readFileSync(scan.report_path, "utf-8"), /\(needs_choice: job title differ\)\r\n  keep Cy Sample \| cy@example\.test, 604-555-0120/);
  assert.deepEqual(sent, []);
});

test("an approved merge backs up every card first, writes the union into the kept card, and only then removes the other", async () => {
  const { store, sent, context } = fakeBook(DUPLICATES);
  const scan = await callTool(context, "contacts__merge_scan", {});
  assert.match((await errorOf(context, "contacts__merge_plan", { groups: [{ group_id: groupOf(scan, "Cy Sample") }] })).message, /differ on job title/);
  assert.equal((await errorOf(context, "contacts__merge_plan", { groups: [{ group_id: "0123456789ab" }] })).code, "contacts_plan_stale");
  const plan = await callTool(context, "contacts__merge_plan", { groups: [
    { group_id: groupOf(scan, "Ada Sample") },
    { group_id: groupOf(scan, "Ben Sample"), keep: `${BOOK}ben1.vcf` },
    { group_id: groupOf(scan, "Cy Sample"), choices: { "job title": `${BOOK}cy2.vcf` } },
  ] });
  assert.deepEqual([plan.group_count, plan.remove_count], [3, 3]);
  assert.deepEqual([sent, store.size], [[], 10], "planning sent nothing");
  assert.match((await errorOf(context, "contacts__merge_apply", { plan_id: plan.plan_id, group_count: 3, remove_count: 2 })).message, /must be the plan's: 3 and 3/);

  // Each removal must find its card's backup already on disk.
  const folder = join(STATE_DIR, "Coclerk", "contacts", "backups", `${new Date().toISOString().slice(0, 10)}_${plan.plan_id}`);
  const fetch = context.davFetch;
  context.davFetch = async (url, init) => {
    if (init.method === "DELETE") assert.ok(existsSync(join(folder, short(url))), `backed up before removal: ${url}`);
    return fetch(url, init);
  };
  const applied = await callTool(context, "contacts__merge_apply", { plan_id: plan.plan_id, group_count: 3, remove_count: 3 });
  assert.deepEqual([applied.status, applied.merged, applied.removed, applied.stopped, applied.backup_dir], ["done", 3, 3, [], folder]);
  assert.deepEqual([...store.keys()].map(short).sort(), ["ada1.vcf", "ben1.vcf", "cy1.vcf", "dee1.vcf", "dee2.vcf", "eve.vcf", "team.vcf"]);

  const ben = store.get(`${BOOK}ben1.vcf`).text;
  for (const line of ["TEL;type=WORK:604-555-0110", "item1.TEL:604-555-0111", "item1.X-ABLabel:Cottage", "EMAIL:ben@example.test", "X-CUSTOM:carried", "PHOTO;ENCODING=b:AAAA", "UID:ben1"]) {
    assert.ok(ben.split("\r\n").includes(line), `merged card holds: ${line}`);
  }
  assert.equal(ben.match(/^(item1\.)?TEL/gm).length, 2, "the same number in another format is not added twice");
  assert.match(ben, /NOTE:First note\\n\\nSecond note\r\n/);
  assert.equal(ben.match(/^NOTE/gm).length, 1);
  assert.match(store.get(`${BOOK}cy1.vcf`).text, /TITLE:Partner\r\n/);
  assert.doesNotMatch(store.get(`${BOOK}cy1.vcf`).text, /Associate/);
  assert.equal(store.get(`${BOOK}ada1.vcf`).text, DUPLICATES["ada1.vcf"], "an exact duplicate leaves the kept card untouched");
  for (const name of ["ben1.vcf", "ben2.vcf"]) assert.equal(readFileSync(join(folder, name), "utf-8"), DUPLICATES[name]);
  assert.equal(sent.filter(([method]) => method === "DELETE").length, 3);
});

test("a contact group the removed card was in gains the kept card, and a removed card is put back from its backup once", async () => {
  const { store, context } = fakeBook(DUPLICATES);
  const scan = await callTool(context, "contacts__merge_scan", {});
  const plan = await callTool(context, "contacts__merge_plan", { groups: [{ group_id: groupOf(scan, "Ben Sample") }] });
  const applied = await callTool(context, "contacts__merge_apply", { plan_id: plan.plan_id, group_count: 1, remove_count: 1 });
  assert.equal(store.has(`${BOOK}ben1.vcf`), false);
  assert.match(store.get(`${BOOK}team.vcf`).text, /MEMBER:urn:uuid:ben1\r\n(.*\r\n)*X-ADDRESSBOOKSERVER-MEMBER:urn:uuid:ben2\r\n/);

  assert.equal((await errorOf(context, "contacts__restore_card", { name: "Nobody Here" })).code, "contacts_backup_not_found");
  // The merge test before this one also removed a Ben Sample, so the name alone is not enough.
  assert.match((await errorOf(context, "contacts__restore_card", { name: "Ben Sample" })).message, /More than one removed contact has that name/);
  assert.match((await errorOf(context, "contacts__restore_card", { name: "Ben Sample", path: join(STATE_DIR, "elsewhere.vcf") })).message, /must be a backup file/);
  const path = join(applied.backup_dir, "ben1.vcf");
  assert.match((await errorOf(context, "contacts__restore_card", { name: "Ada Sample", path })).message, /not the name of the contact in that backup/);
  const restored = await callTool(context, "contacts__restore_card", { name: "ben sample", path });
  assert.deepEqual([restored.name, restored.altered], ["Ben Sample", []]);
  assert.equal(store.get(restored.url).text, DUPLICATES["ben1.vcf"]);
  assert.equal((await errorOf(context, "contacts__restore_card", { name: "Ben Sample", path })).code, "contacts_already_present");
});

test("a card that changed after the plan is never removed, and a long merge runs over several calls", async () => {
  const { store, context } = fakeBook(DUPLICATES);
  const scan = await callTool(context, "contacts__merge_scan", {});
  const plan = await callTool(context, "contacts__merge_plan", { groups: ["Ben Sample", "Ada Sample", "Dee Sample"].map((name) => ({ group_id: groupOf(scan, name) })) });
  store.set(`${BOOK}ben1.vcf`, { text: DUPLICATES["ben1.vcf"].replace("First note", "Edited on the phone"), etag: '"7"' });
  store.set(`${BOOK}ada1.vcf`, { text: DUPLICATES["ada1.vcf"], etag: '"7"' });
  context.contactsBudgetMs = 0;
  const first = await callTool(context, "contacts__merge_apply", { plan_id: plan.plan_id, group_count: 3, remove_count: 3 });
  assert.deepEqual([first.status, first.remaining], ["writing", 2]);
  await callTool(context, "contacts__merge_apply_continue", { plan_id: plan.plan_id });
  const last = await callTool(context, "contacts__merge_apply_continue", { plan_id: plan.plan_id });
  assert.deepEqual([last.status, last.merged, last.removed, last.stopped_count], ["done", 2, 2, 1]);
  assert.match(last.stopped[0].why, /^Ben Sample changed since the scan, so it was left as it is/);
  assert.match(store.get(`${BOOK}ben1.vcf`).text, /Edited on the phone/);
  assert.equal(store.has(`${BOOK}ada2.vcf`), false, "an exact duplicate goes: nothing is written to the kept card, so its change does not matter");
  assert.equal(store.has(`${BOOK}dee2.vcf`), false, "a possible group merges when the practitioner names it");
  assert.match(store.get(`${BOOK}dee1.vcf`).text, /TEL:604-555-0131/);
});
