// The Legal Research page's script (templates/view-pages/legal-research.js) run over its fixture: the tab order,
// the memo sections, the case badges and one card open at a time. And the noting-up status rules
// (forms/note-up-status.ts). Every name is synthetic.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const { LEGAL_RESEARCH_FIXTURE } = await import("../build/board-fixtures/legal-research.js");
const { authorityNoteUp, statementNoteUp } = await import("../build/submission/forms/note-up-status.js");

const PAGE = readFileSync(new URL("../src/templates/view-pages/legal-research.js", import.meta.url), "utf-8");

/** Just enough DOM to run the script and fire its events. */
class Node {
  constructor(tag) {
    Object.assign(this, { tag, children: [], className: "", value: "", hidden: false, open: false, attrs: {}, listeners: {} });
  }
  get firstChild() {
    return this.children[0];
  }
  appendChild(c) {
    this.children.push(c);
    return c;
  }
  insertBefore(c, before) {
    this.children.splice(this.children.indexOf(before), 0, c);
    return c;
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  addEventListener(name, fn) {
    this.listeners[name] = fn;
  }
  fire(name) {
    this.listeners[name]();
  }
  all() {
    return [this, ...this.children.flatMap((c) => (c instanceof Node ? c.all() : []))];
  }
  text() {
    return [this.textContent ?? "", ...this.children.map((c) => (c instanceof Node ? c.text() : c.data))].join("");
  }
}

function drawn(data = LEGAL_RESEARCH_FIXTURE.data) {
  const board = new Node("div");
  const document = { createElement: (tag) => new Node(tag), createTextNode: (text) => ({ data: text }), querySelector: () => board };
  const localStorage = { getItem: () => "{}", setItem() {} };
  vm.runInNewContext(PAGE, { window: { VIEW_PAGE: { data } }, document, localStorage, JSON });
  const tabs = board.all().filter((n) => n.attrs.role === "tab");
  const bodies = board.all().filter((n) => n.className === "tab-body");
  return { tabs, body: (name) => bodies[tabs.findIndex((b) => b.textContent === name)] };
}
const cardsOf = (body) => body.all().filter((n) => n.className === "ticket");
const titleOf = (card) => card.all().find((n) => n.className === "title").textContent;

test("the tabs run Legal Memos, Propositions, Statutes, Cases, with Legal Memos first shown", () => {
  const { tabs, body } = drawn();
  assert.deepEqual(tabs.map((b) => b.textContent), ["Legal Memos", "Propositions", "Statutes", "Cases"]);
  assert.equal(body("Legal Memos").hidden, false);
  assert.equal(body("Cases").hidden, true);
});

test("Legal Memos runs Completed, In Progress, Shelved, Loose Threads, and a memo no job saved is a Loose Thread", () => {
  const { body } = drawn({
    ...LEGAL_RESEARCH_FIXTURE.data,
    memos: {
      memos: ["completed", "in_progress", "started", "shelved", "no_job"].map((status) => ({
        ...LEGAL_RESEARCH_FIXTURE.data.memos.memos[0],
        title: `memo ${status}`,
        status,
      })),
    },
  });
  const sections = body("Legal Memos").children.filter((n) => n.tag === "section");
  assert.deepEqual(sections.map((s) => s.children[0].textContent.trim()), ["Completed", "In Progress", "Shelved", "Loose Threads"]);
  assert.deepEqual(cardsOf(sections[3]).map(titleOf), ["memo started", "memo no_job"]);
  const chip = cardsOf(sections[0])[0].all().find((n) => n.textContent === "Completed");
  assert.equal(chip.className.includes("done"), false, "a completed memo is not muted");
});

test("a case shows its brief and note-up badges, with no dash when it has no brief", () => {
  const { body } = drawn();
  const cards = cardsOf(body("Cases"));
  const unbriefed = cards.find((c) => titleOf(c) === "Model Ltd. v. Dummy Corp.");
  assert.equal(unbriefed.text().includes("—"), false);
  assert.equal(unbriefed.all().some((n) => n.className === "ref"), false);
  const chips = (card) => card.all().filter((n) => String(n.className).startsWith("chip")).map((n) => n.textContent);
  assert.deepEqual(chips(unbriefed), ["Not briefed", "Not noted up"]);
  assert.deepEqual(chips(cards.find((c) => titleOf(c) === "Instance v. Pattern")), ["Briefed", "Noted up: negative treatment only"]);
});

for (const [tab, opened] of [["Cases", "Model Ltd. v. Dummy Corp."], ["Statutes", "Sale of Goods Act"]]) {
  test(`${tab}: an open card hides the rest of the tab, and closing it or Back brings back the list under its search`, () => {
    const { body } = drawn();
    const tabBody = body(tab);
    const cards = cardsOf(tabBody);
    const card = cards.find((c) => titleOf(c) === opened);
    const back = tabBody.children.find((n) => n.className === "back");
    const filters = tabBody.children.find((n) => n.className === "filters");
    const search = filters.children[0];
    const section = tabBody.children.find((n) => n.tag === "section" && n.all().includes(card));
    const shown = () => tabBody.children.filter((n) => n.tag === "section" && !n.hidden).flatMap((s) => cardsOf(s).filter((c) => !c.hidden).map(titleOf));
    assert.equal(back.hidden, true);
    assert.equal(tabBody.children[0], back, "Back sits above the list");

    card.open = true;
    card.fire("toggle");
    assert.deepEqual(shown(), [opened]);
    assert.equal(back.hidden, false);
    assert.equal(filters.hidden, true);
    assert.equal(section.hidden, false);
    assert.equal(section.children[0].hidden, true, "its heading is hidden");
    for (const other of tabBody.children.filter((n) => n.tag === "section" && n !== section)) assert.equal(other.hidden, true);

    card.open = false;
    card.fire("toggle");
    assert.equal(shown().length, cards.length);
    assert.equal(back.hidden, true);
    assert.equal(filters.hidden, false);
    assert.equal(section.children[0].hidden, false);

    // A search stays applied after Back, and the card's own late toggle event changes nothing.
    search.value = opened.toLowerCase();
    search.fire("input");
    card.open = true;
    card.fire("toggle");
    back.fire("click");
    assert.equal(card.open, false);
    assert.deepEqual(shown(), [opened]);
    assert.equal(filters.hidden, false);
    card.fire("toggle");
    assert.deepEqual(shown(), [opened]);
  });
}

test("the noting-up rules never claim more than the record proves", () => {
  assert.deepEqual(authorityNoteUp(null), { label: "Not noted up", noted: false });
  assert.deepEqual(authorityNoteUp("good_law"), { label: "Noted up: negative treatment only", noted: true });

  assert.equal(statementNoteUp("doctrine", null, null), null);
  assert.equal(statementNoteUp("case", null, null).label, "Not noted up");
  assert.equal(statementNoteUp("case", "overruled", null).label, "Case noted up: negative treatment only");
  for (const finished of ["current", "repealed", "archived"]) assert.equal(statementNoteUp("statute", null, finished).label, "Statute level: in-force check done");
  for (const open of [null, "not-found", "validation_unavailable"]) assert.equal(statementNoteUp("regulation", null, open).label, "Not noted up");
  assert.equal(statementNoteUp("rule", "good_law", null).label, "Not noted up", "a statute's level is its currency check");
});
