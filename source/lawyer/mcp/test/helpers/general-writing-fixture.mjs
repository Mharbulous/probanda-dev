// A general-Writing fixture for writing-creation.db.test.mjs and render-general.db.test.mjs (plan
// Phase 14). The shipped layer is the checkout (no installRoot), so the BCSC venue kinds resolve
// from /draft's real tree, while the _NoVenue letter files live only in the firm overlay of a
// temporary case data root, under a fixture jurisdiction (FX) the shipped tree does not hold,
// because /draft ships its own _NoVenue files under CAN/BC and a shipped file shadows an overlay
// copy at the same path. process.env.APPDATA points at that root for the test's duration, so
// the render path's default environment finds the overlay, the firm roster and this machine's
// `person`; each test restores it.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { writePartiesOfRecord } from "./matter-data-fixture.mjs";
import { knowledgeFile, knowledgeFixture } from "./knowledge-fixture.mjs";

const { freshSubmissionDb, submissionDbAt } = await import("./template-db.mjs");
const { submissionDataExecute, submissionDataQuery, submissionDataWrite } = await import("../../build/submission/backend.js");
const { submissionDataCreateWriting } = await import("../../build/submission/forms/layout-snapshot.js");

export const NO_VENUE_TREE = { country: "CAN", jurisdiction: "FX", venue: "_NoVenue" };
export const BCSC_TREE = { country: "CAN", jurisdiction: "BC", venue: "BCSC" };

const DOCS = "draft/CAN/FX/_NoVenue/Documents";
export const LETTER_FILE = `${DOCS}/letter-to-opposing-counsel.md`;
export const PARTY_LETTER_FILE = `${DOCS}/letter-to-opposing-party.md`;
export const MEMO_FILE = `${DOCS}/internal-memo.md`;
export const SOURCE_FILE = "draft/CAN/FX/_NoVenue/Sources/conduct.md";

export const PASSAGES = {
  "R-title": "A letter to another party's counsel names its subject.",
  "R-body": "A lawyer's correspondence with other counsel is courteous and made in good faith.",
};

/** A learned source record in the shape knowledge-sidecar-read.unit.test.mjs uses, holding both passages. */
export function sourceRecord(passages = PASSAGES) {
  return `---
page_url: https://fixture.test/conduct
accessed: 2026-09-20
checked: 2026-09-20
currency_marker_pattern: 'Fixture Code \\(as amended ([A-Z][a-z]+ \\d{1,2}, \\d{4})\\)'
currency_marker: September 1, 2020
fetch_note: fixture
items:
  - rule_ref: R-title
    passage: "${passages["R-title"]}"
  - rule_ref: R-body
    passage: "${passages["R-body"]}"
---
# Fixture conduct excerpt
`;
}

export const LEARNED_FRONT = `learned_by: agent
accessed: 2026-09-20
matter: L0000
reviewed_by:
reviewed_on:
sources:
  - ../Sources/conduct.md`;

/** The same file vetted: no learned_by, so it is never tagged unverified and never refused. */
export const VETTED_FRONT = `accessed: 2026-09-20
sources:
  - ../Sources/conduct.md`;

const part = (source, extra = {}) => ({ heading: null, heading_numbering: "none", paragraph_numbering: "none", source, ...extra });

export const LETTER_BLOCK = {
  renderer: "general",
  needs_forum_parts: false,
  folder_code: "LTR",
  title: { value: "Letter to opposing counsel", rule_ref: "R-title" },
  exhibit_numbering: "writing",
  letterhead: true,
  goal_criteria: ["primary-authority", "excerpts", "noting-up", "open-items", "counsel-review"],
  parts: [
    part("addressee"),
    { heading: "Re", heading_numbering: "none", paragraph_numbering: "restart", source: "slot:body", rule_ref: "R-body" },
    part("literal", { text: "Without prejudice." }),
    part("sender"),
    part("signature-block"),
  ],
};

const PARTY_LETTER_BLOCK = {
  renderer: "general",
  needs_forum_parts: false,
  folder_code: "LTR",
  title: "Letter to opposing party",
  exhibit_numbering: "writing",
  parts: [part("addressee"), part("slot:body"), part("signature-block")],
};

/** A vetted internal memo using every DB-backed projection, each heading numbering, and a
 * `restart` part followed by a `continue` one. */
export const MEMO_BLOCK = {
  renderer: "general",
  needs_forum_parts: false,
  folder_code: "MEM",
  title: "Internal memo",
  exhibit_numbering: "writing",
  parts: [
    { heading: "Parties", heading_numbering: "part-roman", paragraph_numbering: "none", source: "parties" },
    { heading: "Orders sought", heading_numbering: "part-arabic", paragraph_numbering: "none", source: "orders-sought" },
    { heading: "Background", heading_numbering: "letter", paragraph_numbering: "restart", source: "slot:background" },
    { heading: "Legal basis", heading_numbering: "letter", paragraph_numbering: "continue", source: "legal-basis" },
    { heading: "Material relied on", heading_numbering: "none", paragraph_numbering: "none", source: "material-relied-on" },
  ],
};

const alias = (name) => ({ name, source: "agent", ref: "L0000", recorded: "2026-09-20" });

const KINDS = {
  kinds: [
    {
      file: "letter-to-opposing-counsel",
      name: "Letter to opposing counsel",
      recipient: "opposing-counsel",
      aliases: [alias("letter_to_opposing_counsel"), alias("demand letter")],
    },
    {
      file: "letter-to-opposing-party",
      name: "Letter to opposing party",
      recipient: "opposing-party",
      aliases: [alias("letter_to_opposing_party"), alias("demand letter")],
    },
    {
      file: "internal-memo",
      name: "Internal memo",
      recipient: "internal",
      aliases: [alias("internal_memo")],
    },
  ],
};

/** A general type printing the caption, then its body (plan Phase 16): the same block serves a
 * venue, where the caption reads its venue.md, and _NoVenue, where creation refuses it. */
export const CAPTIONED_BLOCK = {
  renderer: "general",
  needs_forum_parts: false,
  folder_code: "NTE",
  title: "Captioned note",
  exhibit_numbering: "writing",
  parts: [part("caption"), part("slot:body")],
};

/** Puts CAPTIONED_BLOCK in the overlay under `venue` (a venue folder of CAN/BC, or _NoVenue with
 * recipient internal) as kind `captioned_note`, beside that folder's other local kinds. */
export function installCaptionedNote(g, venue) {
  const docs = venue === "_NoVenue" ? DOCS : `draft/CAN/BC/${venue}/Documents`;
  const row = { file: "captioned-note", name: "Captioned note", aliases: [alias("captioned_note")] };
  g.f.local(`${docs}/kinds.local.json`, venue === "_NoVenue" ? { kinds: [...KINDS.kinds, { ...row, recipient: "internal" }] } : { kinds: [row] });
  g.f.local(`${docs}/captioned-note.md`, knowledgeFile(null, CAPTIONED_BLOCK));
}

const ROSTER = [
  { key: "pe", name: "Pat Example", designation: "Barrister & Solicitor", role: "lawyer", email: "pat@fixture.test", direct_line: "604-555-0100", closing: "Yours truly,", initials: "PE", active: true },
  { key: "st", name: "Sam Staff", designation: "Legal Assistant", role: "staff", email: "sam@fixture.test", direct_line: "604-555-0101", closing: "Regards,", initials: "SS", active: true },
];

// Proceeding 1 has no forum, 2 is in the BC Supreme Court, 3 in the BC Court of Appeal. Recipient
// 2 is the client's own party; recipient 3 is no party's. No proceeding has a file number, so each
// party is linked by case_party_id to its case data (party/counsel SSOT), which a party-linked
// recipient prints, holding no name, email or address of its own (schema v43): Bert Other's counsel
// is Cara Counsel, and Ada Client has none, so her recipient prints her own name with the email case
// data holds for her.
const SEED = `
INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L0000', NULL), (2, 'L0000', 'CAN/BC/BCSC'), (3, 'L0000', 'CAN/BC/BCCA');
INSERT INTO parties (id, proceeding_id, name, role, ordinal, is_client, case_party_id) VALUES
  (1, 1, 'Ada Client', 'Claimant', 1, 1, 1),
  (2, 1, 'Bert Other', 'Respondent', 2, 0, 2),
  (3, 2, 'Ada Client', 'Plaintiff', 1, 1, 3),
  (4, 2, 'Bert Other', 'Defendant', 2, 0, 4);
INSERT INTO recipients (id, proceeding_id, name, capacity, email, address, party_id, ordinal) VALUES
  (1, 1, NULL, 'counsel for Bert Other', NULL, NULL, 2, 1),
  (2, 1, NULL, 'the client', NULL, NULL, 1, 2),
  (3, 1, 'Dan Registrar', 'the registry', NULL, '800 Smithe Street', NULL, 3);
`;

export const GENERAL_WRITING_CASE_DATA = {
  parties: [
    { id: 1, name: "Ada Client", counsel_email: "ada@client.test" },
    { id: 2, name: "Bert Other", counsel_name: "Cara Counsel", counsel_email: "cara@counsel.test" },
    { id: 3, name: "Ada Client" },
    { id: 4, name: "Bert Other" },
  ],
};

/**
 * A migrated database seeded as above, with its case data beside it, the overlay holding both _NoVenue letter files, the
 * internal memo and the letters' source record, and a firm roster with `pe` (lawyer) and `st` (staff). `person` is this
 * machine's roster key, or null for none; `front` and `block` replace the counsel letter's. `version`
 * migrates the database to exactly that schema version instead, for a test of a later hop.
 */
export async function generalWritingFixture(t, { person = "pe", front = LEARNED_FRONT, block = LETTER_BLOCK, version } = {}) {
  const f = knowledgeFixture(t);
  const appData = f.seams.env.APPDATA;
  const saved = process.env.APPDATA;
  process.env.APPDATA = appData;
  t.after(() => {
    if (saved === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = saved;
  });
  const setPerson = (key) =>
    writeFileSync(join(appData, "Coclerk", "coclerk.json"), JSON.stringify({ case_data_root: f.caseRoot, ...(key ? { person: key } : {}) }));
  setPerson(person);
  const firmDir = join(f.caseRoot, "_practice", "firm");
  mkdirSync(firmDir, { recursive: true });
  writeFileSync(join(firmDir, "firm.json"), JSON.stringify({ firm_name: "Fixture Law LLP", roster: ROSTER }));
  f.local(`${DOCS}/kinds.local.json`, KINDS);
  f.local(LETTER_FILE, knowledgeFile(front, block));
  f.local(PARTY_LETTER_FILE, knowledgeFile(null, PARTY_LETTER_BLOCK));
  f.local(MEMO_FILE, knowledgeFile(null, MEMO_BLOCK));
  f.local(SOURCE_FILE, sourceRecord());

  const dbPath = join(f.scratch, "submission.sqlite");
  if (version === undefined) await freshSubmissionDb(dbPath);
  else submissionDbAt(dbPath, version);
  await submissionDataExecute(dbPath, SEED);
  writePartiesOfRecord(f.scratch, GENERAL_WRITING_CASE_DATA);
  const seams = { env: { ...process.env, APPDATA: appData } };
  const query = (sql, params = []) => submissionDataQuery(dbPath, sql, params).rows;
  const confirm = (filingId) => submissionDataWrite(dbPath, "UPDATE filings SET authority_confirmed_on = '2026-09-27' WHERE id = ?", [filingId]);
  return {
    f,
    dbPath,
    seams,
    firmJson: join(firmDir, "firm.json"),
    setPerson,
    query,
    revision: () => Number(query("SELECT value FROM db_meta WHERE key = 'revision'")[0].value),
    execute: (sql) => submissionDataExecute(dbPath, sql),
    create: (args) => submissionDataCreateWriting({ db_path: dbPath, title: "Letter to Cara", ...args }, seams),
    /** The counsel letter, on proceeding 1 unless `args` says otherwise. */
    createLetter: async ({ unconfirmed = false, ...args } = {}) => {
      const created = await submissionDataCreateWriting(
        { db_path: dbPath, title: "Letter to Cara", proceeding_id: 1, tree: NO_VENUE_TREE, kind: "letter_to_opposing_counsel", recipient: "opposing-counsel", ...args },
        seams
      );
      // letters.md records the authority confirmation as the letter is written (#1231); `unconfirmed`
      // leaves it NULL, as on a Writing drafted before schema v40.
      if (!unconfirmed) await confirm(created.filing_id);
      return created;
    },
    confirm,
    prose: (filingId, slot, text) => submissionDataWrite(dbPath, "INSERT INTO filing_prose (filing_id, slot, text) VALUES (?, ?, ?)", [filingId, slot, text]),
    recipient: (filingId, recipientId, role, ordinal = 1) =>
      submissionDataWrite(dbPath, "INSERT INTO filing_recipients (filing_id, recipient_id, role, ordinal) VALUES (?, ?, ?, ?)", [filingId, recipientId, role, ordinal]),
  };
}
