// The address-book import's pure parts: reading a contacts CSV, working out add-only card
// edits, and sorting rows against the cards already held. Every name and number is invented.

import assert from "node:assert/strict";
import test from "node:test";

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
