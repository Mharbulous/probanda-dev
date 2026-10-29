// A draft attached to a Milestone (ADR 0042) is a card in the board's strip, not a lane: its
// last-modified date, its file-naming registry code read through /file-naming's own name gate, and a
// badge counting its pending jobs, which a ticket_scope row naming `board_attachments:<id>` links to
// it. Opened, it shows the date only when the name's own date differs. board_card's attached lane
// prints the same fields.

import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { fetchProceeding } = await import("../build/submission/forms/query.js");
const { buildPreFilingBoardData } = await import("../build/submission/forms/render-work-board.js");
const { renderWorkBoardHtml } = await import("../build/submission/forms/workboard-shell.js");
const { attachedDrafts, withCodes } = await import("../build/submission/board-attachments.js");
const { submissionFormsBoardCard } = await import("../build/submission/matter-pages.js");

const GATE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", ".claude", "skills", "file-naming", "scripts", "name_gate.py");
const META = { revision: 1, matter: "L8470", client: "Larchmont", rendered: "2026-10-27 12:00" };
const CLIENT = { clientName: "Larchmont", clientNo: "8470", matterNo: "L8470" };
const LETTER = "2026-10-20 ET Client re award.md";
const REPLY = "2026-10-08 ZZQ Smith re hearing.md";

/** A matter with a pre-filing proceeding, a client letter and a reply attached, and a checkout whose
 * registry holds only ET and the made-up ZZQ, so a code reaches a card only through the registry. */
async function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "coclerk-attachment-cards-"));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
  const naming = join(dir, "checkout", ".claude", "skills", "file-naming");
  mkdirSync(join(naming, "scripts"), { recursive: true });
  mkdirSync(join(naming, "references"), { recursive: true });
  copyFileSync(GATE, join(naming, "scripts", "name_gate.py"));
  writeFileSync(join(naming, "references", "code-registry.md"), "| Code | Meaning |\n|---|---|\n| `ET` | Email to |\n| `ZZQ` | A code added for this test |\n");

  const matter = join(dir, "L8470 Larchmont");
  const draft = join(matter, "0. DRAFT");
  mkdirSync(join(matter, "0. CASE DATA"), { recursive: true });
  mkdirSync(draft, { recursive: true });
  writeFileSync(join(draft, LETTER), "Counsel's review: pending\n\nThe advice, never read.\n");
  writeFileSync(join(draft, REPLY), "A reply.\n");
  // The letter last changed on its name's own date; the reply long after.
  utimesSync(join(draft, LETTER), new Date(2026, 9, 20, 12), new Date(2026, 9, 20, 12));
  utimesSync(join(draft, REPLY), new Date(2026, 9, 25, 12), new Date(2026, 9, 25, 12));

  const dbPath = join(matter, "0. CASE DATA", "submission.sqlite");
  await freshSubmissionDb(dbPath);
  // Job 10 is Ready, 11 completed and 12 deleted, all linked to the letter; 13 is linked to neither.
  await submissionDataExecute(
    dbPath,
    `
    INSERT INTO proceedings (id, matter_reference, forum) VALUES (1, 'L8470 - Larchmont', NULL);
    INSERT INTO board_attachments (id, proceeding_id, filing_id, path, kind, attached_on)
      VALUES (1, 1, NULL, '0. DRAFT\\${LETTER}', 'client_letter', '2026-10-20'),
             (2, 1, NULL, '0. DRAFT\\${REPLY}', 'reply', '2026-10-08');
    INSERT INTO tickets (id, proceeding_id, title, intent, status, kind, billing_anchor, created, completed_at)
      VALUES (10, 1, 'Finish the award letter', 'Finish it.', 'queued', 'work', 'L8470', '2026-10-20T09:00', NULL),
             (11, 1, 'Pull the award', 'Pull it.', 'completed', 'work', 'L8470', '2026-10-20T09:01', '2026-10-21T09:00'),
             (12, 1, 'A mistake', 'None.', 'queued', 'work', 'L8470', '2026-10-20T09:02', NULL),
             (13, 1, 'Unrelated', 'Other work.', 'queued', 'work', 'L8470', '2026-10-20T09:03', NULL);
    UPDATE tickets SET deleted_at = '2026-10-21T09:00' WHERE id = 12;
    INSERT INTO ticket_scope (ticket_id, entity, entity_id)
      VALUES (10, 'board_attachments', 1), (11, 'board_attachments', 1), (12, 'board_attachments', 1), (13, 'facts', 1);
    `.trim()
  );
  return { dbPath, draft, checkout: join(dir, "checkout") };
}

/** Runs `fn` with the name gate reading the fixture's checkout, and the real one again after. */
function inCheckout(f, fn) {
  const before = process.env.COCLERK_REPO_ROOT;
  process.env.COCLERK_REPO_ROOT = f.checkout;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env.COCLERK_REPO_ROOT;
    else process.env.COCLERK_REPO_ROOT = before;
  }
}

/** Runs the Milestone page's drawing script against stand-in elements and returns its main element. */
function drawBoard(html) {
  class Node {
    constructor(tag) {
      Object.assign(this, { tag, children: [], attrs: {}, className: "", text: "", id: "", style: { setProperty() {} } });
    }
    set textContent(value) {
      this.text = String(value);
      this.children = [];
    }
    get textContent() {
      return this.text + this.children.map((c) => c.textContent).join("");
    }
    appendChild(child) {
      this.children.push(child);
      return child;
    }
    setAttribute(key, value) {
      this.attrs[key] = String(value);
    }
    addEventListener() {}
    all() {
      return this.children.flatMap((c) => [c, ...c.all()]);
    }
    querySelector(selector) {
      const match = selector.startsWith(".") ? (n) => n.className.split(" ").includes(selector.slice(1)) : (n) => n.tag === selector;
      return this.all().find(match) ?? null;
    }
  }
  const header = new Node("header");
  header.appendChild(new Node("h1"));
  header.appendChild(Object.assign(new Node("div"), { className: "meta" }));
  const main = new Node("main");
  main.appendChild(header);
  const document = {
    title: "",
    body: new Node("body"),
    querySelector: (selector) => (selector === "main" ? main : selector === "header" ? header : null),
    createElement: (tag) => new Node(tag),
    createTextNode: (text) => Object.assign(new Node("#text"), { text: String(text) }),
    addEventListener() {},
  };
  const line = html.split("\n").find((l) => l.startsWith("window.WORKBOARD = "));
  const script = html.split("<script>")[2].split("</script>")[0];
  runInNewContext(script, { window: { WORKBOARD: JSON.parse(line.slice("window.WORKBOARD = ".length, -1)) }, document });
  return main;
}

function drawn(f) {
  const section = buildPreFilingBoardData(f.dbPath, fetchProceeding(f.dbPath, 1), META);
  const attached = inCheckout(f, () => withCodes(attachedDrafts(f.dbPath, f.draft, section)));
  return { attached, main: drawBoard(renderWorkBoardHtml({ meta: META, sections: [section], strip: [], attached })) };
}

const card = (main, id) => main.all().find((n) => n.id === `attachment-${id}`);
const texts = (node) => node.all().map((n) => n.text).filter((s) => s !== "");

test("each attachment is a card in the strip, with no Attached lane, on a board with no Writing", async (t) => {
  const { main } = drawn(await fixture(t));
  const strip = main.querySelector(".writings");
  assert.ok(strip, "the strip draws for its attachments alone");
  assert.deepEqual(strip.children.map((n) => n.id), ["attachment-1", "attachment-2"]);
  assert.equal(main.all().some((n) => n.tag === "section" && n.id === "attached"), false, "no Attached lane");
});

test("a card's code comes from the registry: a code added there reaches the card", async (t) => {
  const { attached, main } = drawn(await fixture(t));
  assert.deepEqual(attached.map((a) => a.code), ["ET", "ZZQ"]);
  assert.equal(card(main, 2).querySelector(".label").text, "ZZQ");
});

test("the open card hides the modified date when it equals the name's date, and shows it otherwise", async (t) => {
  const { main } = drawn(await fixture(t));
  assert.equal(texts(card(main, 1)).includes("Modified 2026-10-20"), false);
  assert.equal(texts(card(main, 2)).includes("Modified 2026-10-25"), true);
  assert.equal(card(main, 1).querySelector(".date").text, "2026-10-20", "the closed card still leads with it");
});

test("pending jobs: only a linked live job counts, and the review line still shows", async (t) => {
  const { attached, main } = drawn(await fixture(t));
  assert.deepEqual(attached[0].jobs.map((j) => j.id), [10], "completed, deleted and unlinked jobs do not count");
  assert.equal(card(main, 1).querySelector(".badge").text, "1");
  assert.ok(texts(card(main, 1)).some((s) => s.startsWith("#10 Finish the award letter")));
  assert.ok(texts(card(main, 1)).includes("Counsel's review: pending"));
  assert.equal(card(main, 2).querySelector(".badge"), null, "no badge at zero");
  assert.ok(texts(card(main, 2)).includes("None."));
  assert.equal(texts(card(main, 1)).some((s) => s.includes("advice")), false, "nothing past the first line is read");
});

test("board_card's attached lane prints the card's fields", async (t) => {
  const f = await fixture(t);
  const { card: text } = inCheckout(f, () => submissionFormsBoardCard({ db_path: f.dbPath, proceeding_id: 1, lanes: ["attached"], draft_dir: f.draft }, CLIENT, META.rendered));
  assert.match(text, new RegExp(`^- attachment 1 · ET · 0\\. DRAFT\\\\${LETTER.replace(/\./g, "\\.")} · modified 2026-10-20 · review: pending · pending: #10$`, "m"));
  assert.match(text, /^- attachment 2 · ZZQ · .* · modified 2026-10-25 · pending: none$/m);
});

test("a linked job on another Writing's board of the proceeding still counts", async (t) => {
  const f = await fixture(t);
  // Writing 1 is the proceeding's lowest-id Writing, so it shows the proceeding's attachments; job 20 sits on Writing 2.
  await submissionDataExecute(
    f.dbPath,
    `
    UPDATE proceedings SET forum = 'CAN/BC/BCSC', court_or_centre = 'BC Supreme Court', file_number = 'S-1' WHERE id = 1;
    INSERT INTO filings (id, proceeding_id, kind, subkind, title) VALUES (1, 1, 'requisition_consent', 'consent', 'Consent Order Requisition'),
                                                                         (2, 1, 'requisition_consent', 'consent', 'Second Requisition');
    INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, kind, billing_anchor, created)
      VALUES (20, 1, 2, 'Cite the award', 'Cite it.', 'queued', 'work', 'L8470', '2026-10-22T09:00');
    INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (20, 'board_attachments', 2);
    `.trim()
  );
  const { card: text } = inCheckout(f, () => submissionFormsBoardCard({ db_path: f.dbPath, filing_id: 1, lanes: ["attached"], draft_dir: f.draft }, CLIENT, META.rendered));
  assert.match(text, /^- attachment 2 · ZZQ · .* · pending: #20$/m);
});

// Another party's filed documents (schema v81): kind 'opposing_filing', a path in the court-file folder.
// Each draws as the same card, with its state on disk; none is a client letter, so no review line is read.
test("another party's five filed documents are cards with their state on disk, in the page and in board_card", async (t) => {
  const f = await fixture(t);
  const matter = dirname(f.draft);
  mkdirSync(join(matter, "3. COURT FILE"), { recursive: true });
  const names = [
    "2026-10-20 RESP1 Application Response FILED.pdf",
    "2026-10-21 RESP2 Application Response FILED.pdf",
    "2026-10-20 AFF1 SmithJ AFFIRMED FILED.pdf",
    "2026-10-20 AFF2 JonesK AFFIRMED FILED.pdf",
    "2026-10-21 AFF3 LeeM AFFIRMED FILED.pdf",
  ];
  for (const name of names.slice(0, 4)) writeFileSync(join(matter, "3. COURT FILE", name), "Filed by the other side.\n"); // the fifth is not on disk
  await submissionDataExecute(
    f.dbPath,
    [
      ...names.map((n, i) => `INSERT INTO board_attachments (id, proceeding_id, filing_id, path, kind, attached_on) VALUES (${3 + i}, 1, NULL, '3. COURT FILE\\${n}', 'opposing_filing', '2026-10-29');`),
      `INSERT INTO board_attachments (id, proceeding_id, filing_id, path, kind, attached_on) VALUES (8, 1, NULL, '..\\elsewhere.pdf', 'opposing_filing', '2026-10-29');`,
    ].join("\n")
  );
  const { attached, main } = drawn(f);
  const opposing = attached.filter((a) => a.kind === "opposing_filing");
  assert.deepEqual(opposing.map((a) => a.state), ["present", "present", "present", "present", "missing", "outside"]);
  assert.ok(opposing.slice(0, 4).every((a) => /^\d{4}-\d{2}-\d{2}$/.test(a.modified) && a.review === null), "a present one shows its date and reads no review line");
  for (const a of opposing) assert.equal(card(main, a.id).querySelector(".label").text, a.code ?? "Opposing filing");
  assert.ok(texts(card(main, 7)).includes("Missing: nothing is at this path"));
  assert.ok(texts(card(main, 8)).includes("Not in the draft folder"));
  assert.equal(texts(card(main, 3)).some((s) => /review/i.test(s)), false, "no counsel's-review line on another party's document");

  const { card: text } = inCheckout(f, () => submissionFormsBoardCard({ db_path: f.dbPath, proceeding_id: 1, lanes: ["attached"], draft_dir: f.draft }, CLIENT, META.rendered));
  assert.match(text, /^- attachment 3 · [^·]+ · 3\. COURT FILE\\2026-10-20 RESP1 [^·]* · modified \d{4}-\d{2}-\d{2} · pending: none$/m);
  assert.match(text, /^- attachment 7 · [^·]+ · 3\. COURT FILE\\2026-10-21 AFF3 [^·]* · missing · pending: none$/m);
  assert.match(text, /^- attachment 8 · [^·]+ · \.\.\\elsewhere\.pdf · not in the draft folder · pending: none$/m);
  assert.doesNotMatch(text, /attachment [3-7] .*review:/);
});
