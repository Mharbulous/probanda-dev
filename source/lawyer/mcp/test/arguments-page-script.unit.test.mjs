// Runs the Arguments page's own script (templates/view-pages/arguments.js) against a minimal fake DOM:
// exactly two tabs, Arguments and Rebuttals; a tab's badges filter its cards; a statement opens or
// closes its number on both tabs at once; nothing is open on load; the Arguments heading counts
// the arguments with no rebuttal; and the Rebuttals strip shows each of them as a hollow button.

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

const card = (id, label, number, extra = {}) => ({ id, label, number, side: "ours", contention: "C" + id, where: null, tags: [], killed: false, law: [], facts: [], rebuts: [], rebutted_by: [], ...extra });
const DATA = {
  arguments: [card(1, "#1", 1), card(2, "#2", 2, { tags: ["No rebuttal"] }), card(3, "#3", 3, { killed: true, tags: ["Killed 2026-10-01"] })],
  rebuttals: [card(4, "#1.a", 1), card(5, "#1.b", 1), card(6, "#3", 3)],
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
      heading: node.children[0],
      radios: nodes.filter((n) => n.tagName === "input"),
      labels: nodes.filter((n) => n.tagName === "label"),
      cards,
      open: () => cards.flatMap((c, i) => (c.children[1].hidden ? [] : [i + 1])),
      shown: () => cards.flatMap((c, i) => (c.hidden ? [] : [i + 1])),
    };
  };
  const tab = (filter) => all.find((n) => n.attrs["data-filter"] === filter).fire("click");
  const tabs = () => all.filter((n) => n.attrs.role === "tab").map((n) => n.text);
  return { section, tab, tabs };
}

// A click on an unchecked radio checks it and fires change. On a checked one the label's click
// handler runs before the browser would re-check it.
function badge(s, n) {
  if (s.radios[n - 1].checked) return s.labels[n - 1].fire("click");
  s.radios.forEach((r, i) => (r.checked = i === n - 1));
  s.radios[n - 1].fire("change");
}
const title = (s, n) => s.cards[n - 1].children[0].fire("click");

test("the page has exactly two tabs, Arguments and Rebuttals, and opens on Arguments", () => {
  const page = load();
  assert.deepEqual(page.tabs(), ["Arguments", "Rebuttals"]);
  assert.equal(page.section("Arguments").node.hidden, false);
  assert.equal(page.section("Rebuttals").node.hidden, true);
  page.tab("rebuttals");
  assert.equal(page.section("Arguments").node.hidden, true);
  assert.equal(page.section("Rebuttals").node.hidden, false);
});

test("on load no badge is selected and every card is listed and closed, killed ones dimmed", () => {
  const s = load().section("Arguments");
  assert.deepEqual(s.radios.map((r) => r.checked), [false, false, false]);
  assert.deepEqual(s.labels.map((l) => l.text), ["1", "2", "3"]);
  assert.deepEqual(s.open(), []);
  assert.deepEqual(s.shown(), [1, 2, 3]);
  assert.deepEqual(s.cards.map((c) => c.className), ["arg ours", "arg ours", "arg ours killed"]);
});

test("a card carries its label and tags, and the Arguments heading counts those with no rebuttal", () => {
  const s = load().section("Arguments");
  const tags = (c) => [...c.walk()].filter((n) => n.className === "tag" || n.className === "tag flag").map((n) => n.text);
  assert.deepEqual(tags(s.cards[1]), ["Argument #2", "No rebuttal"]);
  const r = load().section("Rebuttals");
  assert.deepEqual(r.cards.map((c) => tags(c)[0]), ["Rebuttal #1.a", "Rebuttal #1.b", "Rebuttal #3"]);
  assert.deepEqual(r.labels.map((l) => l.text), ["1.a", "1.b", "3"], "the strip reads the cards' labels");
  assert.equal(s.heading.children.find((n) => n.className === "count").text, "1 with no rebuttal");
});

test("a badge filters the cards and never opens or closes one", () => {
  const s = load().section("Arguments");
  badge(s, 2);
  assert.deepEqual(s.shown(), [2]);
  assert.deepEqual(s.open(), []);
  title(s, 2);
  badge(s, 2);
  assert.deepEqual(s.shown(), [1, 2, 3]);
  assert.deepEqual(s.radios.map((r) => r.checked), [false, false, false]);
  assert.deepEqual(s.open(), [2]);
});

test("one open number links both tabs: Argument #1 opens Rebuttals #1.a and #1.b, and the reverse", () => {
  const { section } = load();
  const a = section("Arguments");
  const r = section("Rebuttals");
  title(a, 1);
  assert.deepEqual(a.open(), [1]);
  assert.deepEqual(r.open(), [1, 2]);
  title(r, 3);
  assert.deepEqual(r.open(), [3], "a rebuttal opens its own number");
  assert.deepEqual(a.open(), [3]);
  title(r, 3);
  assert.deepEqual(a.open(), []);
  assert.deepEqual(r.open(), []);
});

test("the Rebuttals strip has a hollow button for each argument with no rebuttal, which opens it on the Arguments tab", () => {
  const opposing = (id, label, number, extra) => card(id, label, number, { side: "opposing", ...extra });
  const page = load({
    arguments: [opposing(1, "#1", 1), opposing(2, "#2", 2, { tags: ["No rebuttal"] }), opposing(3, "#3", 3)],
    rebuttals: [card(4, "#1", 1), card(5, "#3", 3)],
  });
  page.tab("rebuttals");
  const r = page.section("Rebuttals");
  const strip = r.heading.children.find((n) => n.className === "picker").children.filter((n) => n.tagName !== "input");
  assert.deepEqual(strip.map((n) => [n.text, n.className]), [["1", ""], ["2", "hollow"], ["3", ""]]);
  strip[1].fire("click");
  const a = page.section("Arguments");
  assert.equal(a.node.hidden, false);
  assert.equal(r.node.hidden, true);
  assert.deepEqual(a.open(), [2]);
  assert.equal(a.cards[1].scrolled, true);
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

test("a new pointer switches to its tab and opens its number on both tabs, all cards listed", async () => {
  const { page, posted, poll, settle } = pointed([null, { id: "a", section: "rebuttals", number: 1, at: now() }]);
  await settle();
  assert.deepEqual(posted[0].body, { db_path: "D", proceeding_id: 1, token: "t", filing_ids: [5] });
  assert.equal(posted[0].url, "http://127.0.0.1:1/focus");
  await poll();
  const r = page.section("Rebuttals");
  assert.equal(page.section("Arguments").node.hidden, true);
  assert.equal(r.node.hidden, false);
  assert.deepEqual(r.open(), [1, 2]);
  assert.deepEqual(page.section("Arguments").open(), [1]);
  assert.equal(r.cards[0].scrolled, true);
});

test("the same pointer acts once, and a picker filter gives way to it", async () => {
  const pointer = { id: "a", section: "arguments", number: 2, at: now() };
  const { page, poll, settle } = pointed([null, pointer, pointer]);
  await settle();
  const s = page.section("Arguments");
  badge(s, 1);
  await poll();
  assert.deepEqual(s.shown(), [1, 2, 3]);
  assert.deepEqual(s.radios.map((r) => r.checked), [false, false, false]);
  assert.deepEqual(s.open(), [2]);
  title(s, 2);
  badge(s, 1);
  await poll();
  assert.deepEqual(s.open(), [], "a repeated pointer changes nothing");
  assert.deepEqual(s.shown(), [1]);
});

test("a pointer older than the page is left alone, and a failed poll changes nothing", async () => {
  const old = new Date(Date.now() - 60_000).toISOString();
  const { page, poll, settle } = pointed([{ id: "a", section: "rebuttals", number: 1, at: old }, new Error("off"), { id: "b", section: "arguments", number: 9, at: now() }]);
  await settle();
  assert.deepEqual(page.section("Rebuttals").open(), []);
  await poll();
  await poll();
  assert.deepEqual(page.section("Arguments").open(), [], "a number the page lacks is ignored");
  assert.equal(page.section("Arguments").node.hidden, false);
});
