// The suggestion card's page (docs/Plans/2026-10-25_suggestion-design.md, decisions 6, 7, 9, 11, 13,
// 24 and 27). Its order, labels and fixed strings are built in here, never left to the agent
// (decision 11), and none names how Probanda works inside (shared/internals-confidentiality.md):
//
//   the origin cue ("Probanda noticed:" or "You suggested:"); the pain point; the items; the
//   "Show a mockup of this" link when any item is visual; the constraint and evidence lines, the raw
//   observation among them; the comment box with its grey placeholder; the line saying what Probanda
//   receives, with "Show technical details"; the line about Past suggestions; then Submit Suggestion
//   and Dismiss.
//
// The pain point, each item and each constraint or evidence line are editable in place, and emptying
// an item or a line removes it (decision 7). A block that holds words the practitioner did not use
// carries "our guess, edit if wrong" until it is edited (decisions 2 and 27). A removed identifier
// shows as its bracket, [client] to [amount], marked out in the text.
//
// The script posts every click to the page API on 127.0.0.1 (../page-api/server.ts) with the card's
// token, and every button shows what it did (decision 9): the status line reads "Sending...", then
// "Submitted ✓" or "Not sent, will retry" (decision 13), and the card stays open showing it. Every
// few seconds it reads the card's state: whether an agent is waiting (the mockup link is live, or
// greyed with "Open this suggestion again to see a mockup"), the mockup now on the card (shown in a
// frame sandboxed with no permissions), and any line a rejected mockup added.

import type { CardRecord } from "./card.js";

export const ORIGIN_CUE = { practitioner: "You suggested:", probanda: "Probanda noticed:" } as const;
export const GUESS_LABEL = "our guess, edit if wrong";
export const MOCKUP_LINK = "Show a mockup of this";
export const MOCKUP_LINK_NO_WAITER = "Open this suggestion again to see a mockup";
export const COMMENT_PLACEHOLDER = "Please don't name clients, matters, people or files.";
export const RECEIVES_LINE =
  "Probanda receives this from your account: what you see here, a technical write-up of it, and technical details about the Probanda software on this computer.";
export const SHOW_TECHNICAL = "Show technical details";
export const LATER_LINE = "You can see this later, with its status, under Past suggestions.";
export const SUBMIT = "Submit Suggestion";
export const DISMISS = "Dismiss";
export const RESTORE = "Restore Suggestion";
/** Decision 13's family: the check could not read every record source, so nothing was sent. */
export const NOT_CHECKED = "Not sent: Probanda could not check this against your records. Try again in a moment.";

const BRACKET = /\[(client|matter|person|document|file|date|amount)\]/g;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Text with each bracket marked out. */
function marked(text: string): string {
  return escapeHtml(text).replace(BRACKET, '<span class="bracket">[$1]</span>');
}

function guess(on: boolean): string {
  return on ? `<p class="guess">${GUESS_LABEL}</p>` : "";
}

function editable(text: string): string {
  return `<div class="text" contenteditable="true" spellcheck="true">${marked(text)}</div>`;
}

const KIND_LABEL = { constraint: "Constraint", evidence: "Evidence" } as const;

function contextLine(line: CardRecord["context_lines"][number]): string {
  return (
    `<li class="block line" data-part="context_lines" data-id="${escapeHtml(line.id)}">` +
    `<span class="kind">${KIND_LABEL[line.kind]}</span>${editable(line.text)}${guess(line.guess)}<div class="prompts"></div></li>`
  );
}

const STYLE =
  ":root{--bg:#fafafa;--fg:#222;--muted:#666;--line:#ccc;--accent:#2f5f8a;--warn:#a00;--card:#fff}" +
  "@media (prefers-color-scheme: dark){:root{--bg:#1e1e1e;--fg:#eee;--muted:#aaa;--line:#555;--accent:#8fb8e0;--warn:#f88;--card:#262626}}" +
  "body{font-family:system-ui,sans-serif;margin:0;padding:16px;background:var(--bg);color:var(--fg);line-height:1.45}" +
  "main{max-width:44rem;margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:1rem 1.25rem}" +
  ".origin{font-weight:600;margin:0 0 .5rem}" +
  ".text{white-space:pre-wrap;padding:.15rem .3rem;border-radius:3px;outline:none;border:1px dashed transparent}" +
  ".text:hover,.text:focus{border-color:var(--line)}" +
  ".pain .text{font-size:1.05rem}" +
  ".guess{margin:.1rem .3rem;color:var(--muted);font-size:.8rem;font-style:italic}" +
  ".items{padding-left:1.5rem}.items li{margin:.35rem 0}" +
  ".context{list-style:none;padding:0;margin:.75rem 0}.context li{margin:.3rem 0}" +
  ".kind{font-weight:600;font-size:.85rem;color:var(--muted);margin-right:.4rem}" +
  ".line .text{display:inline}" +
  ".bracket{border:1px solid var(--line);border-radius:3px;padding:0 .2em;font-family:ui-monospace,monospace;font-size:.9em;color:var(--accent)}" +
  ".link{background:none;border:none;padding:0;color:var(--accent);text-decoration:underline;cursor:pointer;font:inherit}" +
  ".link:disabled{color:var(--muted);text-decoration:none;cursor:default}" +
  ".mockup-frame{width:100%;height:20rem;border:1px solid var(--line);background:#fff;margin:.5rem 0}" +
  "textarea{width:100%;min-height:4rem;font:inherit;box-sizing:border-box;margin:.5rem 0}" +
  ".receives,.later{font-size:.9rem;color:var(--muted)}" +
  ".tech pre{white-space:pre-wrap;font-size:.8rem;border:1px solid var(--line);padding:.5rem}" +
  ".actions button{padding:.45rem 1.1rem;font-size:1rem;margin-right:.5rem}" +
  ".status{min-height:1.3em;font-weight:600}.status.error{color:var(--warn)}" +
  ".prompt{font-size:.9rem;margin:.2rem .3rem;color:var(--warn)}.prompt button{margin-left:.4rem;font-size:.85rem}" +
  ".prompt q{font-weight:600}" +
  "main.dismissed{opacity:.45}main.dismissed .text{pointer-events:none}" +
  "main.done .text{border-color:transparent}";

// The page's script. Its strings are the page's own; a reply is read only for its outcome and the
// card's own text.
const SCRIPT = `
(function () {
  var api = JSON.parse(document.getElementById("api").textContent);
  var base = "http://127.0.0.1:" + api.port + "/cards/" + encodeURIComponent(api.card);
  var main = document.querySelector("main");
  var statusLine = document.getElementById("status");
  var submit = document.getElementById("submit");
  var dismiss = document.getElementById("dismiss");
  var restore = document.getElementById("restore");
  var link = document.getElementById("mockup-link");
  var linkNote = document.getElementById("mockup-note");
  var frameBox = document.getElementById("mockup-box");
  var comment = document.getElementById("comment");
  var known = {};
  var shownMockup = null;
  var busy = false;
  var SAY = {
    sending: "Sending...",
    off: "This works while Claude is open on this computer. Open Claude, ask to see this suggestion again, and use it here.",
    failed: "That did not work. Try again, or ask Claude to show this suggestion again.",
    check: "Before this is sent, look at the marked text below.",
    refused: "Not sent: part of this suggestion is too long, or names someone or somewhere. Shorten it or take that out, then try again.",
    empty: "Say what the problem is before submitting.",
    unchecked: ${JSON.stringify(NOT_CHECKED)},
    dismissed: "Dismissed. Nothing was sent.",
    making: "Making a mockup..."
  };
  var KIND = {
    record: "This may name a client, matter, person or file:",
    email: "This is an email address:",
    path: "This names a file or folder:",
    date: "This is a date:",
    amount: "This is an amount:"
  };
  var LABEL = { constraint: "Constraint", evidence: "Evidence" };

  function say(text, error) { statusLine.textContent = text || ""; statusLine.className = error ? "status error" : "status"; }
  function post(path, body) {
    body = body || {};
    body.token = api.token;
    return fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); });
  }
  function textOf(el) { return (typeof el.innerText === "string" ? el.innerText : el.textContent).replace(/\\u00a0/g, " ").trim(); }
  function fill(el, text) {
    while (el.firstChild) el.removeChild(el.firstChild);
    var re = /\\[(client|matter|person|document|file|date|amount)\\]/g, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) el.appendChild(document.createTextNode(text.slice(last, m.index)));
      var span = document.createElement("span");
      span.className = "bracket";
      span.textContent = m[0];
      el.appendChild(span);
      last = m.index + m[0].length;
    }
    if (last < text.length) el.appendChild(document.createTextNode(text.slice(last)));
  }
  function blocks() { return Array.prototype.slice.call(document.querySelectorAll(".block")); }
  function blockFor(part, id) {
    if (part === "comment") return document.getElementById("comment-block");
    return blocks().filter(function (b) { return b.getAttribute("data-part") === part && (part === "pain_point" || b.getAttribute("data-id") === id); })[0];
  }
  function edits() {
    var out = { items: [], context_lines: [], lines_known: Object.keys(known), comment: comment.value.trim() };
    blocks().forEach(function (b) {
      var t = textOf(b.querySelector(".text"));
      var part = b.getAttribute("data-part");
      if (part === "pain_point") out.pain_point = t;
      else out[part].push({ id: b.getAttribute("data-id"), text: t });
    });
    return out;
  }
  function clearPrompts() { Array.prototype.forEach.call(document.querySelectorAll(".prompts"), function (p) { while (p.firstChild) p.removeChild(p.firstChild); }); }
  function redraw(b) {
    if (!b) return;
    var put = function (el, text) { if (el && textOf(el) !== text) fill(el, text); };
    put(document.querySelector('.block[data-part="pain_point"] .text'), b.pain_point);
    b.items.concat(b.context_lines).forEach(function (x) {
      var el = document.querySelector('.block[data-id="' + x.id + '"] .text');
      put(el, x.text);
    });
    if (comment.value.trim() !== b.comment) comment.value = b.comment;
  }
  function setButtons(on) { submit.disabled = !on; dismiss.disabled = !on; }
  function finish(status) {
    main.className = "done";
    submit.hidden = true;
    dismiss.hidden = true;
    Array.prototype.forEach.call(document.querySelectorAll(".text"), function (el) { el.setAttribute("contenteditable", "false"); });
    comment.disabled = true;
    if (link) link.hidden = true;
    if (linkNote) linkNote.textContent = "";
    clearPrompts();
    say(status, status !== "Submitted \\u2713");
  }
  function showPrompts(prompts) {
    clearPrompts();
    prompts.forEach(function (p) {
      var block = blockFor(p.part, p.id);
      if (!block) return;
      var line = document.createElement("p");
      line.className = "prompt";
      line.appendChild(document.createTextNode((KIND[p.kind] || KIND.record) + " "));
      var q = document.createElement("q");
      q.textContent = p.text;
      line.appendChild(q);
      var actions = p.offer === "remove_or_send_anyway" ? [["remove", "Remove"], ["send_anyway", "Send anyway"]] : [["remove", "Remove"]];
      actions.forEach(function (a) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = a[1];
        b.addEventListener("click", function () { answer(p, a[0], b); });
        line.appendChild(b);
      });
      block.querySelector(".prompts").appendChild(line);
    });
  }
  function handle(reply) {
    busy = false;
    var o = reply && reply.outcome;
    if (o === "sent" || o === "unsent") return finish(reply.status);
    if (o === "closed") {
      if (reply.state === "dismissed") return greyOut();
      if (reply.status) return finish(reply.status);
    }
    setButtons(true);
    if (o === "check" || o === "stale") { redraw(reply.blocks); showPrompts(reply.prompts); return say(SAY.check, true); }
    if (o === "refused") { redraw(reply.blocks); return say(SAY.refused, true); }
    if (o === "unchecked") { redraw(reply.blocks); return say(SAY.unchecked, true); }
    if (o === "empty") return say(SAY.empty, true);
    say(SAY.failed, true);
  }
  function failed() { busy = false; setButtons(true); say(SAY.failed, true); }
  function answer(p, action, button) {
    if (busy) return;
    busy = true;
    button.disabled = true;
    button.textContent = action === "remove" ? "Removing..." : "Sending...";
    setButtons(false);
    say(SAY.sending, false);
    post("/resolve", { part: p.part, id: p.id, start: p.start, end: p.end, action: action }).then(function (reply) {
      if (reply && reply.outcome !== "check" && reply.outcome !== "stale") clearPrompts();
      if (reply && reply.blocks) redraw(reply.blocks);
      handle(reply);
    }).catch(failed);
  }

  submit.addEventListener("click", function () {
    if (busy) return;
    busy = true;
    setButtons(false);
    clearPrompts();
    say(SAY.sending, false);
    post("/submit", { edits: edits() }).then(handle).catch(failed);
  });
  function greyOut() {
    main.className = "dismissed";
    submit.hidden = true;
    dismiss.hidden = true;
    restore.hidden = false;
    restore.disabled = false;
    say(SAY.dismissed, false);
  }
  dismiss.addEventListener("click", function () {
    if (busy) return;
    busy = true;
    setButtons(false);
    dismiss.textContent = "Dismissing...";
    post("/dismiss").then(function (reply) {
      busy = false;
      dismiss.textContent = ${JSON.stringify(DISMISS)};
      if (!reply || reply.outcome !== "dismissed") return handle(reply);
      try { window.close(); } catch (e) {}
      setTimeout(greyOut, 300);
    }).catch(function () { dismiss.textContent = ${JSON.stringify(DISMISS)}; failed(); });
  });
  restore.addEventListener("click", function () {
    restore.disabled = true;
    restore.textContent = "Restoring...";
    post("/restore").then(function (reply) {
      restore.textContent = ${JSON.stringify(RESTORE)};
      if (!reply || reply.outcome !== "restored") { restore.disabled = false; return handle(reply); }
      main.className = "";
      restore.hidden = true;
      submit.hidden = false;
      dismiss.hidden = false;
      setButtons(true);
      say("", false);
    }).catch(function () { restore.disabled = false; restore.textContent = ${JSON.stringify(RESTORE)}; say(SAY.failed, true); });
  });
  if (link) link.addEventListener("click", function () {
    link.disabled = true;
    linkNote.textContent = SAY.making;
    post("/mockup", { edits: edits() }).then(function (reply) { apply({ mockup_link: reply && reply.outcome }); }).catch(function () { link.disabled = false; linkNote.textContent = SAY.failed; });
  });

  function watch(b) {
    var t = b.querySelector(".text");
    t.addEventListener("input", function () {
      var g = b.querySelector(".guess");
      if (g) g.remove();
      var p = b.querySelector(".prompts");
      while (p.firstChild) p.removeChild(p.firstChild);
    });
    t.addEventListener("blur", function () {
      if (b.getAttribute("data-part") !== "pain_point" && textOf(t) === "") b.remove();
    });
  }
  blocks().forEach(function (b) { if (b.getAttribute("data-part") === "context_lines") known[b.getAttribute("data-id")] = true; watch(b); });
  comment.addEventListener("input", function () {
    var p = document.querySelector("#comment-block .prompts");
    while (p.firstChild) p.removeChild(p.firstChild);
  });

  function addLine(line) {
    known[line.id] = true;
    var li = document.createElement("li");
    li.className = "block line";
    li.setAttribute("data-part", "context_lines");
    li.setAttribute("data-id", line.id);
    var k = document.createElement("span");
    k.className = "kind";
    k.textContent = LABEL[line.kind];
    var t = document.createElement("div");
    t.className = "text";
    t.setAttribute("contenteditable", "true");
    fill(t, line.text);
    var p = document.createElement("div");
    p.className = "prompts";
    li.appendChild(k); li.appendChild(t); li.appendChild(p);
    document.getElementById("context").appendChild(li);
    watch(li);
  }
  function apply(state) {
    if (link) {
      var l = state.mockup_link;
      link.hidden = l === "hidden";
      link.disabled = l !== "available";
      link.textContent = l === "no_waiter" ? ${JSON.stringify(MOCKUP_LINK_NO_WAITER)} : ${JSON.stringify(MOCKUP_LINK)};
      linkNote.textContent = l === "requested" ? SAY.making : "";
    }
    if (state.context_lines) state.context_lines.forEach(function (line) { if (!known[line.id]) addLine(line); });
    if (state.mockup === undefined) return;
    var n = state.mockup ? state.mockup.n : null;
    if (n === shownMockup) return;
    shownMockup = n;
    while (frameBox.firstChild) frameBox.removeChild(frameBox.firstChild);
    if (state.mockup) {
      var f = document.createElement("iframe");
      f.className = "mockup-frame";
      f.setAttribute("sandbox", "");
      f.setAttribute("title", "Mockup");
      f.setAttribute("srcdoc", state.mockup.html);
      frameBox.appendChild(f);
    }
  }
  var first = true;
  function poll() {
    post("/state").then(function (state) {
      if (first) {
        first = false;
        if (state.state === "dismissed") greyOut();
        else if (state.state === "submitted" || state.state === "sending") finish(state.status || SAY.sending);
        else setButtons(true);
      } else if (state.state === "submitted" && !submit.hidden) {
        finish(state.status);
      } else if (state.state === "submitted" && state.status && statusLine.textContent !== state.status) {
        say(state.status, state.status !== "Submitted \\u2713");
      }
      apply(state);
    }).catch(function () {
      if (first) { first = false; say(SAY.off, true); if (link) link.disabled = true; }
    }).then(function () { setTimeout(poll, 3000); });
  }
  setButtons(false);
  if (link) link.disabled = true;
  poll();
})();
`;

/** The card's page for `card`, with the listener's port and the card's token. */
export function renderCardHtml(card: CardRecord, port: number, token: string): string {
  const visual = card.items.some((i) => i.visual);
  const pain =
    `<div class="block pain" data-part="pain_point" data-id="p">${editable(card.pain_point.text)}${guess(card.pain_point.guess)}<div class="prompts"></div></div>`;
  const items =
    `<ol class="items">${card.items.map((item) =>
      `<li class="block item" data-part="items" data-id="${escapeHtml(item.id)}">${editable(item.text)}${guess(item.guess)}<div class="prompts"></div></li>`
    ).join("")}</ol>`;
  const mockup = visual
    ? `<p class="mockup"><button type="button" class="link" id="mockup-link">${MOCKUP_LINK}</button> <span class="note" id="mockup-note"></span></p><div id="mockup-box"></div>`
    : '<div id="mockup-box"></div>';
  const observed = card.raw_observation.map((line) => `<li class="observed"><span class="kind">Observed</span><span class="fixed">${marked(line)}</span></li>`).join("");
  const context = `<ul class="context" id="context">${card.context_lines.map(contextLine).join("")}${observed}</ul>`;
  const commentBox =
    `<div id="comment-block"><textarea id="comment" aria-label="Comment" placeholder="${escapeHtml(COMMENT_PLACEHOLDER)}">${escapeHtml(card.comment)}</textarea><div class="prompts"></div></div>`;
  const tech =
    `<p class="receives">${escapeHtml(RECEIVES_LINE)}</p>` +
    `<details class="tech"><summary class="link">${SHOW_TECHNICAL}</summary><pre>${escapeHtml(JSON.stringify(card.environment_facts, null, 2))}</pre></details>`;
  const actions =
    `<p class="later">${escapeHtml(LATER_LINE)}</p>` +
    `<div class="actions"><button type="button" id="submit">${SUBMIT}</button><button type="button" id="dismiss">${DISMISS}</button>` +
    `<button type="button" id="restore" hidden>${RESTORE}</button></div><p class="status" id="status" role="status"></p>`;
  const api = JSON.stringify({ port, card: card.record_id, token }).replace(/</g, "\\u003c");
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<meta http-equiv="Content-Security-Policy" content="script-src 'unsafe-inline'; connect-src http://127.0.0.1:${port}; object-src 'none'; base-uri 'none'; form-action 'none'">` +
    `<title>Suggestion</title><style>${STYLE}</style></head><body><main>` +
    `<p class="origin">${ORIGIN_CUE[card.origin]}</p>` +
    pain + items + mockup + context + commentBox + tech + actions +
    `</main><script type="application/json" id="api">${api}</script><script>${SCRIPT}</script></body></html>`
  );
}
