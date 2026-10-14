// Runs the approval page's own script against a minimal fake DOM, to check the one-line rows,
// the Approve / Leave as is radio pair, the group boxes (spec §A2, §B7.2, §B7.5), and what it
// posts. No browser: the fake implements only what the script touches.

import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

const { renderApprovalPage } = await import("../build/housekeeping/page.js");

class Node {
  constructor(tag, doc) {
    this.tagName = tag;
    this.doc = doc;
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.style = {};
    this.className = "";
    this._text = "";
    this.checked = false;
    this.disabled = false;
    this._value = "";
  }
  appendChild(n) {
    n.parent = this;
    this.children.push(n);
    return n;
  }
  insertBefore(n, ref) {
    n.parent = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(n);
    else this.children.splice(i, 0, n);
    return n;
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === "type") this.type = String(v);
    if (k === "value") this._value = String(v);
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  fire(type) {
    for (const fn of this.listeners[type] ?? []) fn({ target: this });
  }
  focus() {}
  get textContent() {
    return this.tagName === "#text" ? this._text : this._text + this.children.map((c) => c.textContent).join("");
  }
  set textContent(t) {
    this.children = [];
    this._text = String(t);
  }
  get value() {
    return this._value;
  }
  set value(v) {
    this._value = v;
  }
  has(cls) {
    return (this.className || "").split(" ").includes(cls);
  }
  *walk() {
    yield this;
    for (const c of this.children) yield* c.walk();
  }
  find(pred) {
    for (const n of this.walk()) if (pred(n)) return n;
    return null;
  }
  findAll(pred) {
    return [...this.walk()].filter(pred);
  }
}

/** A row as the practitioner sees it: CSS arrows and dashes written in, bold spans in *stars*. */
function show(n) {
  if (n.tagName === "#text") return n._text;
  const inner = n._text + n.children.map(show).join("");
  if (n.has("dir") || n.has("dest-f")) return "*" + inner + "*";
  if (n.has("verb")) return " → " + inner;
  if (n.has("why")) return " — " + inner;
  if (n.has("aside")) return " " + inner;
  return inner;
}

function load(proposal, approval = null, { reply = { ok: true, body: { ok: true } } } = {}) {
  const html = renderApprovalPage(proposal, approval);
  const data = html.match(/<script type="application\/json" id="hk-data">([\s\S]*?)<\/script>/)[1];
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const doc = {};
  const app = new Node("main", doc);
  const body = new Node("body", doc);
  body.appendChild(app);
  Object.assign(doc, {
    body,
    getElementById: (id) => (id === "hk-data" ? { textContent: data } : id === "app" ? app : null),
    createElement: (tag) => new Node(tag, doc),
    createTextNode: (t) => Object.assign(new Node("#text", doc), { _text: String(t) }),
  });
  const posts = [];
  const sandbox = {
    document: doc,
    location: { pathname: "/h/token/" },
    window: { scrollTo() {} },
    setTimeout,
    fetch: (url, init) => {
      posts.push({ url, body: JSON.parse(init.body) });
      return Promise.resolve({ ok: reply.ok, json: () => Promise.resolve(reply.body) });
    },
  };
  vm.runInNewContext(script, sandbox);
  const card = (id) => body.find((n) => n.attrs.id === "row-" + id);
  const view = (id) => {
    const radios = card(id).findAll((n) => n.type === "radio");
    return { card: card(id), radios, ok: radios.find((n) => n.attrs.value === "ok"), leave: radios.find((n) => n.attrs.value === "leave") };
  };
  // A click on a radio checks it and fires change; the browser unchecks its partner itself.
  const pick = (id, which) => {
    const input = view(id)[which];
    input.checked = true;
    input.fire("change");
  };
  const group = (kind) => body.find((n) => n.attrs.id === "grp-" + kind);
  const groupBox = (kind) => group(kind).find((n) => n.type === "checkbox");
  // A click on a checkbox toggles it, then fires change.
  const clickGroup = (kind) => {
    const box = groupBox(kind);
    box.checked = !box.checked;
    box.fire("change");
  };
  const line = (id) => show(card(id).find((n) => n.has("what")));
  const button = body.find((n) => n.tagName === "button");
  const tally = () => body.find((n) => n.has("tally")).textContent;
  const message = () => button.parent.find((n) => n.has("msg")).textContent;
  return { html, body, view, pick, group, groupBox, clickGroup, line, button, tally, message, posts };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

const H = "a".repeat(64);
const base = (rows, header = {}) => ({
  run_id: "20260924-100000-aaaa",
  matter_root: "C:\\Matters\\Smith",
  created_at: "2026-09-24T20:40:13.000Z",
  header: { open_in_word: ["open.docx"], folders_not_looked_inside: ["Old stuff"], ...header },
  folders: [
    { path: "3. CORRESPONDENCE", exists: true },
    { path: "6. LAW", exists: true },
  ],
  draft_folder: "0. DRAFT",
  rows,
  rule_gaps: [],
});
const r = (id, action, extra) => ({
  row_id: id,
  current_path: id + ".pdf",
  hash: H,
  ingest_outcome: "ingested",
  source_ids: [],
  section: "offered",
  action,
  name_checks: [],
  notes: [],
  ...extra,
});
const NAME = "2026-01-05 LF Smith re Offer.pdf";

/** One row of every kind, shuffled against the page order, plus an ingested-only and a deferred row. */
const everyKind = () =>
  base(
    [
      r("stuck", { kind: "stuck", reason: "no naming rule for a bill of costs" }),
      r("file", { kind: "file", name: NAME, folder: "3. CORRESPONDENCE" }),
      r("rename", { kind: "rename", name: NAME }, { current_path: "3. CORRESPONDENCE\\rename.pdf" }),
      r("move", { kind: "move", folder: "5. COURT FILE#S-1" }),
      r("submove", { kind: "move", folder: "5. COURT FILE#S-1" }, { current_path: "3. CORRESPONDENCE\\submove.pdf" }),
      r("draft", { kind: "draft" }, { ingest_outcome: "none" }),
      r("dup", { kind: "duplicate" }, { ingest_outcome: "none", twin: { path: "x.pdf", ingested: true } }),
      r("brown", { kind: "misfiled", matter: "L998" }),
      r("scan", { kind: "unreadable" }, { ingest_outcome: "failed" }),
      r("new", { kind: "file", name: NAME, folder: "7. DISCOVERY\\LOD Plaintiff\\Jane Smith", create_folder: true }),
      r("photo", { kind: "move", folder: "3. CORRESPONDENCE", file_no_ingest: true }, { ingest_outcome: "none" }),
      r("q", { kind: "file", name: NAME, folder: "3. CORRESPONDENCE", answer: "Counterclaim" }, { ingest_outcome: "stopped" }),
      r("fin", { kind: "file", name: NAME, folder: "3. CORRESPONDENCE", final: true }, { ingest_outcome: "none" }),
      r("done", undefined, { section: "ingested_only", current_path: "6. LAW\\done.pdf", notes: ["stored as privileged"] }),
      r("later", undefined, { section: "deferred" }),
    ],
    { finished_line: "Finished 16 files you approved on 23 Sep. 2 could not be finished and are shown below." }
  );

test("every row is one line: the file, an arrow and the result, with no verb word (spec §A2, §B7.5)", () => {
  const page = load(everyKind());
  assert.equal(page.line("file"), "file.pdf → *3. CORRESPONDENCE\\*" + NAME);
  assert.equal(page.line("rename"), "*3. CORRESPONDENCE\\*rename.pdf → " + NAME);
  assert.equal(page.line("move"), "move.pdf → *5. COURT FILE#S-1*");
  assert.equal(page.line("submove"), "*3. CORRESPONDENCE\\*submove.pdf → *5. COURT FILE#S-1*");
  assert.equal(page.line("draft"), "draft.pdf → *0. DRAFT*");
  assert.equal(page.line("dup"), "dup.pdf → *TRASH*");
  assert.equal(page.line("brown"), "brown.pdf → *client matter L998*");
  assert.equal(page.line("scan"), "scan.pdf → TRY AGAIN NEXT RUN");
  assert.equal(page.line("stuck"), "stuck.pdf → LEAVE WHERE IT IS — no naming rule for a bill of costs");
  // Short notes follow the line only where they change what Approve does.
  assert.equal(page.line("new"), "new.pdf → *7. DISCOVERY\\LOD Plaintiff\\Jane Smith\\*" + NAME + " (new folder)");
  assert.equal(page.line("photo"), "photo.pdf → *3. CORRESPONDENCE* (filed without reading it into the case database)");
  assert.equal(page.line("q"), "q.pdf → *3. CORRESPONDENCE\\*" + NAME + " (read in with the answer: Counterclaim)");
  assert.equal(page.line("fin"), "fin.pdf → *3. CORRESPONDENCE\\*" + NAME + " (read in first)");

  // The current name is a link that opens the file; its folder, bold, sits outside the link.
  const link = page.view("rename").card.find((n) => n.tagName === "a");
  assert.equal(link.textContent, "rename.pdf");
  assert.equal(link.attrs.href, "/h/token/file/rename");
  // Folder paths bold, file names normal weight.
  assert.match(page.html, /\.dir\{font-weight:700\}/);
  assert.match(page.html, /\.dest-f\{font-weight:700\}/);

  // No verb word, no kind tag, and nothing but the radio pair and the group boxes to click.
  const text = page.body.textContent;
  assert.doesNotMatch(text, /-->|TO-->|name unchanged/);
  const tags = ["FILE", "RENAME", "MOVE", "DRAFT", "DUPLICATE", "MISFILED", "UNREADABLE", "STUCK"];
  assert.equal(page.body.find((n) => n.children.length === 0 && tags.includes(n.textContent.trim())), null);
  assert.equal(page.body.find((n) => n.has("tag")), null);
  assert.equal(page.body.findAll((n) => n.tagName === "select" || n.type === "text").length, 0);
});

test("groups come in the page order under their headings, each with a count and, where rows are decided, an Approve all / none box to its right (§B7.2)", () => {
  const page = load(everyKind());
  const sections = page.body.findAll((n) => n.tagName === "section");
  assert.deepEqual(
    sections.map((n) => n.attrs.id),
    ["grp-file", "grp-rename", "grp-move", "grp-draft", "grp-duplicate", "grp-misfiled", "grp-unreadable", "grp-stuck"]
  );
  const heads = sections.map((s) => s.find((n) => n.tagName === "h2").children.map((c) => c.textContent));
  assert.deepEqual(heads, [
    ["Rename and move", "4", "Approve all / none"],
    ["Rename", "1", "Approve all / none"],
    ["Move", "3", "Approve all / none"],
    ["Unfinished drafts", "1", "Approve all / none"],
    ["Duplicates", "1", "Approve all / none"],
    ["Mis-filed", "1"],
    ["Unreadable", "1", "Approve all / none"],
    ["Left where they are", "1"],
  ]);
  // The box comes before the words, inside the label right of the heading.
  const label = page.group("file").find((n) => n.tagName === "label");
  assert.equal(label.children[0].type, "checkbox");
  assert.equal(label.children[2].textContent, "Approve all / none");
  assert.match(page.html, /section\.grp>h2\{[^}]*font-weight:700/);
});

test("the header shows the matter, the run time and the three counts, then the finished, Word and folder lines", () => {
  const page = load(everyKind());
  const header = page.body.find((n) => n.tagName === "header");
  assert.equal(header.find((n) => n.tagName === "h1").textContent, "Housekeeping approvals");
  const meta = Object.fromEntries(header.find((n) => n.has("meta")).children.map((n) => [n.attrs["data-k"], n.textContent]));
  assert.equal(meta.matter, "Smith");
  assert.match(meta.run, /^2026-09-2[45] \d\d:\d\d$/);
  assert.equal(meta["to decide"], "11", "the two information-only rows are not counted");
  assert.equal(meta["ingested, nothing to approve"], "1");
  assert.equal(meta["left for the next run"], "1");
  assert.match(header.textContent, /Finished 16 files you approved on 23 Sep\./);
  assert.match(header.textContent, /Open in Word, skipped this run: open\.docx/);
  assert.match(header.textContent, /Folders not looked inside: Old stuff/);
  // The collapsed list at the bottom, each file with how it was stored.
  const details = page.body.find((n) => n.tagName === "details");
  assert.equal(show(details), "Ingested, nothing to approve (1)*6. LAW\\*done.pdf — stored as privileged");
});

test("every row to decide starts on Leave as is, one radio pair each, and Submit is enabled with nothing approved", () => {
  const page = load(everyKind());
  for (const id of ["file", "rename", "move", "draft", "dup", "scan"]) {
    const v = page.view(id);
    assert.equal(v.radios.length, 2, id);
    assert.equal(v.ok.attrs.name, v.leave.attrs.name, id);
    assert.equal(v.ok.parent.textContent, "Approve");
    assert.equal(v.leave.parent.textContent, "Leave as is");
    assert.equal(v.ok.checked, false, id);
    assert.equal(v.leave.checked, true, id);
    assert.equal(v.card.attrs["data-state"], "leave", id);
  }
  assert.equal(page.tally(), "0 approved11 left as is");
  assert.equal(page.button.textContent, "Submit");
  assert.equal(page.button.disabled, false);

  page.pick("file", "ok");
  assert.equal(page.view("file").ok.checked, true);
  assert.equal(page.view("file").leave.checked, false);
  assert.equal(page.view("file").card.attrs["data-state"], "ok");
  assert.equal(page.tally(), "1 approved10 left as is");
  page.pick("file", "leave");
  assert.equal(page.view("file").ok.checked, false);
  assert.equal(page.view("file").leave.checked, true);
  assert.equal(page.tally(), "0 approved11 left as is");
});

test("stuck and misfiled rows are information only: no radio pair, no group box, never counted or posted (decision of 2026-09-27)", async () => {
  const page = load(everyKind());
  for (const id of ["stuck", "brown"]) {
    assert.equal(page.view(id).radios.length, 0, id);
    assert.equal(page.view(id).card.find((n) => n.has("pick")), null, id);
  }
  // The line itself is unchanged.
  assert.equal(page.line("stuck"), "stuck.pdf → LEAVE WHERE IT IS — no naming rule for a bill of costs");
  assert.equal(page.line("brown"), "brown.pdf → *client matter L998*");
  for (const kind of ["stuck", "misfiled"]) {
    assert.equal(page.groupBox(kind), null, kind);
    assert.equal(page.group(kind).find((n) => n.tagName === "label"), null, kind);
  }
  // Every group with a box, all approved: the two information-only rows stay out of the tally and the post.
  for (const kind of ["file", "rename", "move", "draft", "duplicate", "unreadable"]) page.clickGroup(kind);
  assert.equal(page.tally(), "11 approved0 left as is");
  page.button.fire("click");
  await settle();
  const posted = page.posts[0].body.rows.map((e) => e.row_id);
  assert.equal(posted.length, 11);
  assert.equal(posted.includes("stuck") || posted.includes("brown"), false);
});

test("a group's box: a click approves every row unless all are approved, then sets them all to Leave as is; tick, dash or empty", () => {
  const page = load(base([r("a", { kind: "file", name: NAME, folder: "3. CORRESPONDENCE" }), r("b", { kind: "file", name: NAME.replace("Offer", "Costs"), folder: "3. CORRESPONDENCE" }), r("s", { kind: "unreadable" }, { ingest_outcome: "failed" })]));
  const all = page.groupBox("file");
  assert.equal(all.checked, false);
  assert.equal(all.indeterminate, false);

  page.pick("a", "ok");
  assert.equal(all.checked, false);
  assert.equal(all.indeterminate, true, "some approved: a dash");

  page.clickGroup("file");
  assert.equal(page.view("a").ok.checked, true);
  assert.equal(page.view("b").ok.checked, true, "a click from a mixed group approves every row");
  assert.equal(page.view("s").ok.checked, false, "another group is untouched");
  assert.equal(all.checked, true);
  assert.equal(all.indeterminate, false);
  assert.equal(page.tally(), "2 approved1 left as is");

  page.clickGroup("file");
  assert.equal(page.view("a").leave.checked, true, "a click when all are approved sets them all to Leave as is");
  assert.equal(page.view("b").leave.checked, true);
  assert.equal(all.checked, false);
  assert.equal(all.indeterminate, false);

  page.clickGroup("file");
  assert.equal(page.view("a").ok.checked, true, "a click from none approves every row");
  assert.equal(all.checked, true);
  page.pick("b", "leave");
  assert.equal(all.checked, false);
  assert.equal(all.indeterminate, true);
});

test("Submit with nothing approved posts rows: [] and the page turns read-only", async () => {
  const page = load(base([r("a", { kind: "file", name: NAME, folder: "3. CORRESPONDENCE" }), r("s", { kind: "stuck", reason: "why" })]));
  page.button.fire("click");
  await settle();
  assert.deepEqual(page.posts, [{ url: "/h/token/approve", body: { run: "20260924-100000-aaaa", rows: [] } }]);
  assert.equal(page.message(), "Approved. You can go back to Claude.");
  assert.equal(page.button.style.display, "none");
  assert.equal(page.view("a").ok.disabled, true);
});

test("Submit posts only the approved rows, each approve: true, in page order", async () => {
  const page = load(
    base([
      r("a", { kind: "file", name: NAME, folder: "3. CORRESPONDENCE" }),
      r("b", { kind: "unreadable" }, { ingest_outcome: "failed" }),
      r("c", { kind: "move", folder: "3. CORRESPONDENCE" }),
    ])
  );
  page.pick("c", "ok");
  page.pick("a", "ok");
  page.pick("b", "ok");
  page.pick("b", "leave");
  page.button.fire("click");
  await settle();
  assert.equal(page.posts.length, 1);
  assert.deepEqual(page.posts[0].body, {
    run: "20260924-100000-aaaa",
    rows: [
      { row_id: "a", approve: true },
      { row_id: "c", approve: true },
    ],
  });
  for (const id of ["a", "b", "c"]) {
    assert.equal(page.view(id).ok.disabled, true, id);
    assert.equal(page.view(id).leave.disabled, true, id);
  }
  assert.equal(page.groupBox("file").disabled, true);
  assert.match(page.body.textContent, /Approved\. You can go back to Claude\./);
});

test("a refused Submit shows the server's reason and can be pressed again", async () => {
  const page = load(base([r("a", { kind: "file", name: NAME, folder: "3. CORRESPONDENCE" })]), null, { reply: { ok: false, body: { error: "This page is out of date." } } });
  page.button.fire("click");
  await settle();
  assert.equal(page.message(), "This page is out of date.");
  assert.equal(page.button.disabled, false);
  assert.equal(page.view("a").ok.disabled, false);
  assert.doesNotMatch(page.body.textContent, /Approved\./);
});

test("an approved run renders read-only: approved rows on Approve, the rest on Leave as is", () => {
  const proposal = base([r("a", { kind: "file", name: NAME, folder: "3. CORRESPONDENCE" }), r("b", { kind: "move", folder: "3. CORRESPONDENCE" }), r("c", { kind: "move", folder: "6. LAW" })]);
  const page = load(proposal, { run_id: proposal.run_id, approved_at: "2026-09-24T21:00:00.000Z", rows: [{ row_id: "a", approve: true }] });
  assert.equal(page.view("a").ok.checked, true);
  assert.equal(page.view("b").leave.checked, true);
  assert.equal(page.view("c").leave.checked, true);
  for (const id of ["a", "b", "c"]) {
    assert.equal(page.view(id).ok.disabled, true, id);
    assert.equal(page.view(id).leave.disabled, true, id);
  }
  assert.equal(page.groupBox("file").disabled, true);
  assert.equal(page.groupBox("file").checked, true);
  assert.equal(page.groupBox("move").checked, false);
  assert.equal(page.button.style.display, "none");
  assert.equal(page.tally(), "1 approved2 left as is");
  assert.match(page.body.find((n) => n.tagName === "header").textContent, /Approved\. You can go back to Claude\./);
});

test("the page follows the shared palette and dark mode, with a sticky footer, and loads nothing from outside", () => {
  const { html } = load(everyKind());
  assert.match(html, /--paper:#F4FAF7/);
  assert.match(html, /@media \(prefers-color-scheme: dark\)\{:root:not\(\[data-theme="light"\]\)\{/);
  assert.match(html, /\.bar\{position:fixed;left:0;right:0;bottom:0/);
  assert.match(html, /\.verb::before\{content:"\\2192"\}/);
  assert.equal(/<(script|link|img)[^>]+(src|href)=/i.test(html), false);
  // The client script keeps the no-backticks ES5 string style.
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.equal(script.includes("`"), false);
  assert.equal(/=>|\blet\b|\bconst\b/.test(script), false);
});
