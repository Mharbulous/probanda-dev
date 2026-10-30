// Runs the Arguments page's own script (templates/view-pages/arguments.js) against a minimal fake DOM:
// a section's number badges filter its cards, its statements open and close them (one open per
// section), neither changes the other, nothing is open on load, and the All tab leaves Killed out.

import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";

const { default: script } = await import("../build/templates/view-pages/arguments.js.js");

class Node {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attrs = {};
    this.listeners = {};
    this.className = "";
    this.hidden = false;
    this.checked = false;
    const classes = new Set();
    this.classList = { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: (c) => classes.has(c) };
  }
  set textContent(t) {
    this.text = String(t);
  }
  appendChild(n) {
    n.parent = this;
    this.children.push(n);
    return n;
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return this.attrs[k] ?? null;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ??= []).push(fn);
  }
  fire(type, extra = {}) {
    for (const fn of this.listeners[type] ?? []) fn({ target: this, preventDefault() {}, ...extra });
  }
  focus() {}
  scrollIntoView() {
    this.scrolled = true;
  }
  *walk() {
    yield this;
    for (const c of this.children) yield* c.walk();
  }
}

const arg = (id, kind) => ({ id, kind, contention: "C" + id, where: "", law: [], facts: [], rebuts: [] });
const DATA = {
  submissions: [arg(1, "submission"), arg(2, "submission"), arg(3, "killed")],
  counter_arguments: [{ key: "raised:1", kind: "raised", text: "X", source: null, linked: [] }],
};

function load(data = DATA, extra = {}) {
  const board = new Node("div");
  const document = { createElement: (tag) => new Node(tag), querySelector: () => board };
  vm.runInNewContext(script, { window: { VIEW_PAGE: { data } }, document, localStorage: { getItem: () => null, setItem() {} }, ...extra });
  const all = [...board.walk()];
  const section = (heading) => {
    const node = all.find((n) => n.tagName === "section" && n.children[0].text === heading);
    const nodes = [...node.walk()];
    const cards = nodes.filter((n) => n.tagName === "article");
    return {
      node,
      radios: nodes.filter((n) => n.tagName === "input"),
      labels: nodes.filter((n) => n.tagName === "label"),
      cards,
      open: () => cards.flatMap((c, i) => (c.children[1].hidden ? [] : [i + 1])),
      shown: () => cards.flatMap((c, i) => (c.hidden ? [] : [i + 1])),
    };
  };
  const tab = (filter) => all.find((n) => n.attrs["data-filter"] === filter).fire("click");
  return { section, tab };
}

// A click on an unchecked radio checks it and fires change. On a checked one the label's click
// handler runs before the browser would re-check it.
function badge(s, n) {
  if (s.radios[n - 1].checked) return s.labels[n - 1].fire("click");
  s.radios.forEach((r, i) => (r.checked = i === n - 1));
  s.radios[n - 1].fire("change");
}
const title = (s, n) => s.cards[n - 1].children[0].fire("click");

test("on load no badge is selected and every card is listed and closed", () => {
  const s = load().section("Submissions");
  assert.deepEqual(s.radios.map((r) => r.checked), [false, false]);
  assert.deepEqual(s.open(), []);
  assert.deepEqual(s.shown(), [1, 2]);
});

test("a badge filters the cards and never opens or closes one", () => {
  const s = load().section("Submissions");
  badge(s, 2);
  assert.deepEqual(s.shown(), [2]);
  assert.deepEqual(s.open(), []);
  title(s, 2);
  badge(s, 2);
  assert.deepEqual(s.shown(), [1, 2]);
  assert.deepEqual(s.radios.map((r) => r.checked), [false, false]);
  assert.deepEqual(s.open(), [2]);
});

test("a statement opens or closes its card, one per section, and never changes the badge", () => {
  const { section } = load();
  const s = section("Submissions");
  const c = section("Counter-arguments");
  title(c, 1);
  title(s, 1);
  assert.deepEqual(s.radios.map((r) => r.checked), [false, false]);
  title(s, 2);
  assert.deepEqual(s.open(), [2]);
  assert.deepEqual(c.open(), [1]);
  badge(s, 1);
  assert.deepEqual(s.open(), [2], "an open card hidden by the filter stays open");
  title(s, 2);
  assert.deepEqual(s.open(), []);
});

test("All shows Submissions always, other sections only with cards, and never Killed", () => {
  const page = load();
  assert.equal(page.section("Submissions").node.hidden, false);
  assert.equal(page.section("Counter-arguments").node.hidden, false);
  assert.equal(page.section("Rebuttals").node.hidden, true);
  assert.equal(page.section("Killed").node.hidden, true);
  page.tab("killed");
  assert.equal(page.section("Killed").node.hidden, false);
  assert.equal(page.section("Submissions").node.hidden, true);
  const empty = load({ submissions: [], counter_arguments: [] });
  assert.equal(empty.section("Submissions").node.hidden, false);
});

// The session's pointer (drafting_forms__focus_view_page): the page asks the listener, and each poll's
// answer comes from `answers` in turn. Polls are run by hand, so nothing loops.
function pointed(answers) {
  const api = { port: 1, db_path: "D", proceeding_id: 1, token: "t", filing_ids: [5] };
  const posted = [];
  let next = null;
  const fetch = (url, init) => {
    posted.push({ url, body: JSON.parse(init.body) });
    const answer = answers.shift();
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve({ ok: true, json: () => Promise.resolve({ focus: answer }) });
  };
  const page = load({ ...DATA, api }, { fetch, setTimeout: (fn) => (next = fn) });
  const settle = () => new Promise((r) => setImmediate(r));
  const poll = async () => {
    const fn = next;
    next = null;
    fn();
    await settle();
  };
  return { page, posted, poll, settle };
}
const now = () => new Date().toISOString();

test("a new pointer switches to its section's tab and opens its card, all cards listed", async () => {
  const { page, posted, poll, settle } = pointed([null, { id: "a", section: "counter", number: 1, at: now() }]);
  await settle();
  assert.deepEqual(posted[0].body, { db_path: "D", proceeding_id: 1, token: "t", filing_ids: [5] });
  assert.equal(posted[0].url, "http://127.0.0.1:1/focus");
  await poll();
  const c = page.section("Counter-arguments");
  assert.equal(page.section("Submissions").node.hidden, true);
  assert.equal(c.node.hidden, false);
  assert.deepEqual(c.open(), [1]);
  assert.equal(c.cards[0].scrolled, true);
});

test("the same pointer acts once, and a picker filter gives way to it", async () => {
  const pointer = { id: "a", section: "submissions", number: 2, at: now() };
  const { page, poll, settle } = pointed([null, pointer, pointer]);
  await settle();
  const s = page.section("Submissions");
  badge(s, 1);
  await poll();
  assert.deepEqual(s.shown(), [1, 2]);
  assert.deepEqual(s.radios.map((r) => r.checked), [false, false]);
  assert.deepEqual(s.open(), [2]);
  title(s, 2);
  badge(s, 1);
  await poll();
  assert.deepEqual(s.open(), [], "a repeated pointer changes nothing");
  assert.deepEqual(s.shown(), [1]);
});

test("a pointer older than the page is left alone, and a failed poll changes nothing", async () => {
  const old = new Date(Date.now() - 60_000).toISOString();
  const { page, poll, settle } = pointed([{ id: "a", section: "counter", number: 1, at: old }, new Error("off"), { id: "b", section: "submissions", number: 9, at: now() }]);
  await settle();
  assert.deepEqual(page.section("Counter-arguments").open(), []);
  await poll();
  await poll();
  assert.deepEqual(page.section("Submissions").open(), [], "a number the page lacks is ignored");
  assert.equal(page.section("Submissions").node.hidden, false);
});
