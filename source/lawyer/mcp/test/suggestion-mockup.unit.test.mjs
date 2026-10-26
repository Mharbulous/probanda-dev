// A suggestion mockup (suggestions/mockup.ts; docs/Plans/2026-10-25_suggestion-design.md, decisions
// 25 and 26): one self-contained page whose visible text is only the shipped placeholder text. The check
// fails on any <script>, <a href, <link, src= or http, on anything else that loads or runs, and on any
// text outside the placeholder set; the placeholder set itself holds nothing the date, amount, email or
// path patterns match; and the mockup page shows the checked bytes in a frame sandboxed with no
// permissions, with the "Not like this, because..." box.

import assert from "node:assert/strict";
import test from "node:test";

const { checkMockup, loadPlaceholders, renderMockupPage, visibleTexts } = await import("../build/suggestions/mockup.js");
const { findPatterns } = await import("../build/suggestions/crosscheck.js");

const PLACEHOLDERS = loadPlaceholders(process.env);

const GOOD = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Page title</title>' +
  "<style>body{font-family:Georgia,serif;background:white;color:black;align-content:start}" +
  "ol{padding-left:2em}.alt{font-style:italic}td{border:1px solid #ccc}</style></head>" +
  '<body><h1>Heading</h1><ol><li>First item</li><li class="alt">or alternatively</li><li>Second item</li></ol>' +
  '<table><tr><th colspan="2">Column one</th></tr><tr><td>1.</td><td>Lorem ipsum dolor sit amet.</td></tr></table>' +
  "<!-- a note for whoever reads the source --><p>Placeholder&nbsp;date</p></body></html>";

test("the placeholder set ships with the plugin and holds nothing the date, amount, email or path patterns match", () => {
  assert.ok(PLACEHOLDERS.length > 40);
  for (const line of PLACEHOLDERS) assert.deepEqual(findPatterns(line), [], line);
  assert.deepEqual(findPatterns(PLACEHOLDERS.join("\n")), []);
});

test("a page of placeholder text with inline styles passes", () => {
  assert.equal(checkMockup(GOOD, PLACEHOLDERS), null);
  assert.deepEqual(visibleTexts(GOOD), ["Page title", "Heading", "First item", "or alternatively", "Second item", "Column one", "1.", "Lorem ipsum dolor sit amet.", "Placeholder date"]);
});

test("the check fails on a script, a link, a src, an address, or anything else that loads or runs", () => {
  const body = (inner) => GOOD.replace("<h1>Heading</h1>", inner);
  const refused = {
    "<script>": body("<script>1</script>"),
    "<SCRIPT>": body("<SCRIPT type=module></SCRIPT>"),
    "<a href": body('<a href="#x">Label</a>'),
    "<link": GOOD.replace("<title>", '<link rel="stylesheet"><title>'),
    "src=": body('<p src="x">Label</p>'),
    "http": body('<p class="http">Label</p>'),
    "an image": body("<img>"),
    "an iframe": body("<iframe></iframe>"),
    "a form": body("<form><button>Button</button></form>"),
    "an svg": body("<svg></svg>"),
    "an event handler": body('<p onclick="x()">Label</p>'),
    "a url()": GOOD.replace("color:black", "background:url(x)"),
    "an import": GOOD.replace("<style>", "<style>@import 'x';"),
    "a title attribute": body('<p title="Quillfeather">Label</p>'),
    "a style that adds text": GOOD.replace(".alt{", ".alt::before{content:'Quillfeather'}.x{"),
    "over 1 MB": body(`<p>${"Label ".repeat(200_000)}</p>`),
    "empty": "",
  };
  for (const [what, html] of Object.entries(refused)) {
    assert.notEqual(checkMockup(html, PLACEHOLDERS), null, what);
  }
});

test("the check fails on any text outside the placeholder set, and never quotes it", () => {
  for (const text of ["Quillfeather Holdings", "First item and more", "Heading!", "3 March 2026", "$1,200", "a.person@example.com"]) {
    const problem = checkMockup(GOOD.replace("<h1>Heading</h1>", `<h1>${text}</h1>`), PLACEHOLDERS);
    assert.deepEqual(problem, { problem: "the mockup holds text that is not Probanda's placeholder text" }, text);
  }
  assert.notEqual(checkMockup(GOOD.replace("<title>Page title</title>", "<title>Draft</title>"), PLACEHOLDERS), null, "the title is visible text too");
  // Text hidden in markup reads as text: a pattern in a style is caught too.
  const amount = checkMockup(GOOD.replace("padding-left:2em", "padding-left:2em;margin:12,500px"), PLACEHOLDERS);
  assert.match(amount.problem, /amount/);
});

test("the mockup page shows the checked bytes in a frame with no permissions, under the visual items, with the rejection box", () => {
  const page = renderMockupPage({ cardId: "0b7c3a5e-1f2d-4c6b-9a8e-7d6c5b4a3f21", n: 2, html: GOOD, items: ["Put the numbers in their own column."], port: 47615, token: "t" });
  const frame = page.match(/<iframe[^>]*>/)[0];
  assert.match(frame, /sandbox=""/);
  const srcdoc = frame.match(/srcdoc="([^"]*)"/)[1].replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)));
  assert.equal(srcdoc, GOOD);
  assert.ok(page.indexOf("Put the numbers in their own column.") < page.indexOf("<iframe"));
  assert.ok(page.includes("Not like this, because..."));
  assert.ok(page.includes(`placeholder="Please don't name clients, matters, people or files."`));
});
