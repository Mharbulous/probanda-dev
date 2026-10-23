import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { classifyPaths, documentTypes, expandGlob, folder_map, folderMapPath, globsFor, set_folder_map } = await import(
  "../build/tools/practice/folder-map.js"
);

const ENTRY = {
  key: "pe",
  name: "Pat Example",
  designation: "Barrister & Solicitor",
  role: "lawyer",
  email: "pat@example.com",
  direct_line: "555-0100",
  closing: "Yours truly,",
  initials: "PE",
};

// A case data root under a temporary APPDATA with a firm roster of two, as practice-firm-profile does.
function fixture(t, { person = "pe" } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), "coclerk-folder-map-"));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const appData = join(scratch, "appdata");
  const root = join(scratch, "0. CASE DATA");
  mkdirSync(join(appData, "Probanda"), { recursive: true });
  mkdirSync(join(root, "_practice", "firm"), { recursive: true });
  writeFileSync(
    join(root, "_practice", "firm", "firm.json"),
    JSON.stringify({ firm_name: "Example Law", roster: [ENTRY, { ...ENTRY, key: "jd", initials: "JD" }] })
  );
  const config = { version: 1, case_data_root: root, ...(person ? { person } : {}) };
  writeFileSync(join(appData, "Probanda", "probanda.json"), JSON.stringify(config));
  return { scratch, root, env: { APPDATA: appData } };
}

const ONE_TO_MANY_MANY_TO_ONE = [
  { type: "court_filings", folders: ["Court*", "Appeal\\Filed"] },
  { type: "client_communications", folders: ["Client"] },
  { type: "retainer_and_billing", folders: ["Client"] },
  { type: "correspondence_opposing_counsel", folders: ["Letters"] },
  { type: "work_product", folders: ["Letters"] },
  { type: "drafts", folders: ["Working"] },
  { type: "raw_intake", folders: ["Working"] },
  { type: "authorities", folders: ["Law"] },
];

test("the glossary is read from shared/document-types.md, with its flags", () => {
  const types = documentTypes();
  const byId = new Map(types.map((t) => [t.id, t]));
  assert.deepEqual(byId.get("drafts").flags, ["never_ingest"]);
  assert.deepEqual(byId.get("client_communications").flags, ["privileged_by_default"]);
  assert.deepEqual(byId.get("authorities").flags, ["authority"]);
  assert.deepEqual(byId.get("court_filings").flags, []);
  assert.equal(types.length, 17);
});

test("no person on this machine is the no-map case", async (t) => {
  const { env } = fixture(t, { person: null });
  const result = await folder_map({}, env);
  assert.equal(result.status, "no_map");
  assert.equal(result.person, null);
  assert.ok(result.document_types.length > 0);
});

test("a person with no map file is the no-map case, never another person's map", async (t) => {
  const { env } = fixture(t);
  const other = folderMapPath(env, "jd");
  mkdirSync(join(other, ".."), { recursive: true });
  writeFileSync(other, JSON.stringify({ entries: [{ type: "court_filings", folders: ["Court*"] }] }));
  const result = await folder_map({ paths: ["Court\\a.pdf"] }, env);
  assert.equal(result.status, "no_map");
  assert.equal(result.person, "pe");
  assert.equal(result.paths, undefined);
});

test("set_folder_map writes this person's file, and folder_map reads it back", async (t) => {
  const { env, root } = fixture(t);
  const written = await set_folder_map({ entries: ONE_TO_MANY_MANY_TO_ONE }, env);
  assert.equal(written.written, join(root, "_practice", "firm", "folder-maps", "pe.json"));
  assert.deepEqual(JSON.parse(readFileSync(written.written, "utf-8")).entries, ONE_TO_MANY_MANY_TO_ONE);
  const read = await folder_map({ types: ["court_filings", "searches"] }, env);
  assert.equal(read.status, "ok");
  assert.deepEqual(read.folders, { court_filings: ["Court*", "Appeal\\Filed"], searches: [] });
});

test("one type may live in many folders, and one folder may serve many types", async (t) => {
  const { env } = fixture(t);
  await set_folder_map({ entries: ONE_TO_MANY_MANY_TO_ONE }, env);
  const { paths } = await folder_map(
    {
      paths: [
        "Court File#S-1\\2024-01-02 NOCC.pdf",
        "court\\sub\\order.pdf",
        "Appeal\\Filed\\factum.pdf",
        "Appeal\\notes.pdf",
        "Client\\retainer.pdf",
        "Letters\\2024-01-03 LT OC.pdf",
        "Working\\scan.pdf",
        "Law\\case.pdf",
        "loose.pdf",
        "Court",
      ],
    },
    env
  );
  const by = Object.fromEntries(paths.map((p) => [p.path, p]));
  assert.deepEqual(by["Court File#S-1\\2024-01-02 NOCC.pdf"].types, ["court_filings"]);
  assert.deepEqual(by["court\\sub\\order.pdf"].types, ["court_filings"], "case-insensitive, any depth");
  assert.deepEqual(by["Appeal\\Filed\\factum.pdf"].types, ["court_filings"], "a two-segment glob");
  assert.deepEqual(by["Appeal\\notes.pdf"].types, []);
  assert.deepEqual(by["Client\\retainer.pdf"], {
    path: "Client\\retainer.pdf",
    types: ["client_communications", "retainer_and_billing"],
    never_ingest: false,
    privileged: true,
    authority: false,
  });
  assert.deepEqual(by["Letters\\2024-01-03 LT OC.pdf"].types, ["correspondence_opposing_counsel", "work_product"]);
  assert.equal(by["Letters\\2024-01-03 LT OC.pdf"].privileged, false);
  assert.equal(by["Working\\scan.pdf"].never_ingest, true);
  assert.equal(by["Law\\case.pdf"].authority, true);
  assert.deepEqual(by["loose.pdf"].types, []);
  assert.equal(by["loose.pdf"].never_ingest, false, "an unmapped file carries no flag");
  assert.deepEqual(by["Court"].types, [], "a folder glob holds what is inside the folder, not the folder itself");
});

test("a flag holds only when every type of the folder carries it", () => {
  const types = documentTypes();
  const entries = [
    { type: "client_communications", folders: ["Mixed"] },
    { type: "correspondence_opposing_counsel", folders: ["Mixed"] },
  ];
  const [mixed] = classifyPaths(entries, types, ["Mixed\\a.pdf"]);
  assert.equal(mixed.privileged, false);
  assert.deepEqual(globsFor(entries, ["client_communications", "correspondence_opposing_counsel"]), ["Mixed"]);
});

test("set_folder_map refuses a bad map and writes nothing", async (t) => {
  const { env } = fixture(t);
  const cases = {
    "an unknown type": [{ type: "not_a_type", folders: ["A"] }],
    "a repeated type": [{ type: "drafts", folders: ["A"] }, { type: "drafts", folders: ["B"] }],
    "no folders": [{ type: "drafts", folders: [] }],
    "an absolute glob": [{ type: "drafts", folders: ["C:\\Matters\\A"] }],
    "a leading separator": [{ type: "drafts", folders: ["\\A"] }],
    "a parent segment": [{ type: "drafts", folders: ["A\\..\\B"] }],
    "an unknown field": [{ type: "drafts", folders: ["A"], note: "x" }],
  };
  for (const [label, entries] of Object.entries(cases)) {
    await assert.rejects(set_folder_map({ entries }, env), undefined, label);
  }
  assert.equal(existsSync(folderMapPath(env, "pe")), false);
});

test("set_folder_map refuses when this machine names no person", async (t) => {
  const { env, root } = fixture(t, { person: null });
  await assert.rejects(set_folder_map({ entries: [{ type: "drafts", folders: ["A"] }] }, env), /names no person/);
  assert.equal(existsSync(join(root, "_practice", "firm", "folder-maps")), false);
});

test("expandGlob lists the existing folders a glob matches", (t) => {
  const { scratch } = fixture(t);
  const matter = join(scratch, "matter");
  for (const dir of ["Court File#S-1", "Court File#S-2", "Appeal\\Filed", "Letters"]) mkdirSync(join(matter, dir), { recursive: true });
  writeFileSync(join(matter, "Court notes.pdf"), "x");
  assert.deepEqual(expandGlob(matter, "court*"), [join(matter, "Court File#S-1"), join(matter, "Court File#S-2")]);
  assert.deepEqual(expandGlob(matter, "Appeal\\Filed"), [join(matter, "Appeal", "Filed")]);
  assert.deepEqual(expandGlob(matter, "Missing*"), []);
});
