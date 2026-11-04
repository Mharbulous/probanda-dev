// The Past suggestions page (docs/Plans/2026-10-25_suggestion-design.md, decisions 9, 11, 16 and 17;
// lifecycle plan Phase 2): `suggestions/Past suggestions.html` beside probanda.json, a file Probanda
// creates (Commandment 7) and the session shows only as a file card.
//
// For each suggestion this computer sent or tried to send, newest first, it shows the local copy
// word for word, read from the exact payload the store kept (store.ts): the pain point; each item with
// its status, reason and release as Probanda's Cloud last returned them; the brackets as they were on
// the card, in the text as stored; the constraint and evidence lines; the comment; the raw
// observation; the environment facts; and the mockup inside an iframe sandboxed with no permissions,
// its srcdoc the stored bytes. The technical write-up (specification.ts) shows on request, in a
// <details> that also explains its two safeguards in fixed words; a page written for one suggestion
// opens at that entry with the write-up shown. Each sentence shows with the kind of source it rests
// on, never a file path.
// Held drafts were never sent, and dismissed cards never appear (decision 9). Every label and fixed
// string is built in here (decision 11), and none names how Probanda works inside
// (shared/internals-confidentiality.md).
//
// Each entry not yet withdrawn has a Withdraw button. It writes through the data server's localhost
// listener (../page-api/server.ts), as the Loose Threads page's status button does: the page is opened
// from file://, posts the token embedded here for that suggestion, and the listener withdraws only a
// suggestion a render gave a token to. The page checks the listener on load and, when it does not
// answer, disables the buttons with one line saying why. The first click arms the button and the
// second withdraws; every click shows its outcome on the entry.

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { NotFoundError } from "../errors.js";
import { writeTextAtomic } from "../file-lock.js";
import { pageApiPort, pageApiSuggestionToken } from "../page-api/token.js";
import { type SuggestionRecord, type SuggestionStore, cardStatus, isSuggestion, loadStore, storeDir } from "./store.js";

export const PAST_SUGGESTIONS_FILE = "Past suggestions.html";

/** Decision 27's bracket categories, drawn as a marked span around the text as stored. */
const BRACKET = /\[(client|matter|person|document|file|date|amount)\]/g;

const ITEM_STATUS: Record<string, string> = {
  undecided: "Undecided",
  approved: "Approved",
  declined: "Declined",
  implemented: "Implemented",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function text(value: string): string {
  return escapeHtml(value).replace(BRACKET, '<span class="bracket">[$1]</span>');
}

function para(value: unknown): string {
  return typeof value === "string" ? `<p class="text">${text(value)}</p>` : "";
}

function section(heading: string, body: string): string {
  return body ? `<h3>${heading}</h3>${body}` : "";
}

type Payload = Record<string, unknown>;

function parsePayload(record: SuggestionRecord): Payload | null {
  if (record.payload === null) return null;
  try {
    const value = JSON.parse(record.payload);
    return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Payload) : null;
  } catch {
    return null;
  }
}

function itemStatusLine(record: SuggestionRecord, n: number): string {
  const item = record.items?.find((i) => i.item === n);
  if (!item || !item.status) return "";
  const label = item.status === "implemented" && item.implemented_in
    ? `Implemented in ${item.implemented_in}`
    : (ITEM_STATUS[item.status] ?? item.status);
  const reason = item.status !== "undecided" && item.reason ? ` · ${escapeHtml(item.reason)}` : "";
  return `<p class="item-status"><span class="label">${escapeHtml(label)}</span>${reason}</p>`;
}

function structuredItem(item: Payload): string {
  const list = (values: unknown, key?: string) =>
    Array.isArray(values) && values.length
      ? `<ul>${values.map((v) => `<li>${text(String(key && v && typeof v === "object" ? (v as Payload)[key] : v))}</li>`).join("")}</ul>`
      : "";
  return (
    section("The pain", para(item.pain)) +
    section("Where", para(item.where)) +
    section("What would show it is solved", para(item.done_test)) +
    section("What must stay true", list(item.constraints)) +
    section("Changes", list(item.changes, "change"))
  );
}

function items(record: SuggestionRecord, payload: Payload): string {
  const list = Array.isArray(payload.items) ? payload.items : [];
  if (list.length && list.every((i) => typeof i === "string")) {
    return `<ol class="items">${list.map((t, i) => `<li>${para(t)}${itemStatusLine(record, i + 1)}</li>`).join("")}</ol>`;
  }
  // Today's drafts send one structured entry per pain; the cloud keeps the pain point as item 1.
  const detail = list.filter((i): i is Payload => typeof i === "object" && i !== null).map((i) => `<div class="detail">${structuredItem(i)}</div>`).join("");
  return `<ol class="items"><li>${para(payload.pain_point ?? payload.body)}${itemStatusLine(record, 1)}${detail}</li></ol>`;
}

function contextLines(payload: Payload): string {
  if (!Array.isArray(payload.context_lines)) return "";
  const lines = payload.context_lines.filter((l): l is Payload => typeof l === "object" && l !== null);
  return lines.length
    ? `<ul class="context">${lines.map((l) => `<li><span class="kind">${l.kind === "constraint" ? "Constraint" : "Evidence"}</span> ${text(String(l.text ?? ""))}</li>`).join("")}</ul>`
    : "";
}

function frame(html: string, label: string): string {
  return `<iframe class="mockup" sandbox="" title="${escapeHtml(label)}" srcdoc="${escapeHtml(html)}"></iframe>`;
}

function badgeOf(record: SuggestionRecord): string {
  if (record.withdrawn_at !== null) return "Withdrawn";
  return record.state === "sent" ? (record.badge ?? "Submitted") : cardStatus(record);
}

// The technical write-up's fixed strings (decision 11): the two safeguards, in the present tense, and
// why a write-up is not there. None names how Probanda works inside.
export const WRITE_UP_SAFEGUARDS = [
  "Probanda writes this from what your card shows, the technical details and Probanda's own files. It does not read your documents, your conversations or your records about clients and matters.",
  "Before it is sent, a second check traces every sentence to your card, the technical details or Probanda's own files, and anything found in your records is taken out. If a sentence cannot be traced, or taking something out would leave the write-up incomplete, nothing is sent after your suggestion.",
] as const;

export const WRITE_UP_NOTES = {
  none: "No technical write-up was written for this suggestion.",
  writing: "The technical write-up was not finished, so none was sent with this suggestion.",
  waiting_to_send: "The technical write-up is kept on this computer and is sent after your suggestion.",
  sent: "This technical write-up was sent after your suggestion.",
  backstop_failed: "No technical write-up was sent with this suggestion: not every sentence of it could be traced to your card, the technical details or Probanda's own files.",
  incoherent: "No technical write-up was sent with this suggestion: words found in your records had to be taken out of it, and what was left was incomplete.",
  records_unreadable: "No technical write-up was sent with this suggestion: it could not be checked against your records.",
  refused: "No technical write-up was sent with this suggestion: Probanda did not accept it.",
  withdrawn: "No technical write-up was sent: this suggestion was withdrawn.",
} as const;

const SOURCE_LABEL = { card: "From your card", fact: "From the technical details", file: "From Probanda's own files" } as const;

function writeUpSentences(spec: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(spec);
  } catch {
    return `<p class="text">${text(spec)}</p>`;
  }
  const sentences = parsed !== null && typeof parsed === "object" && Array.isArray((parsed as Payload).sentences) ? ((parsed as Payload).sentences as Payload[]) : [];
  return `<ol class="spec">${sentences.map((s) => {
    const cites = Array.isArray(s.cites) ? (s.cites as Payload[]) : [];
    const kinds = [...new Set(cites.map((c) => (c.card !== undefined ? "card" : c.fact !== undefined ? "fact" : "file") as keyof typeof SOURCE_LABEL))];
    return `<li><p class="text">${text(String(s.text ?? ""))}</p><p class="note">${escapeHtml(kinds.map((k) => SOURCE_LABEL[k]).join(" · "))}</p></li>`;
  }).join("")}</ol>`;
}

function writeUpSection(record: SuggestionRecord): string {
  const w = record.write_up;
  const safeguards = `<h4>How the technical write-up is kept safe</h4><ul class="safeguards">${WRITE_UP_SAFEGUARDS.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>`;
  let note: string;
  let body = "";
  if (!w) note = WRITE_UP_NOTES.none;
  else if (w.state === "stands_alone") note = WRITE_UP_NOTES[w.reason ?? "backstop_failed"];
  else if (w.state === "sent" || w.state === "waiting_to_send") note = WRITE_UP_NOTES[w.state];
  else note = WRITE_UP_NOTES.writing;
  if (w && (w.state === "sent" || w.state === "waiting_to_send") && record.specification !== null) body = writeUpSentences(record.specification);
  return `<p class="note">${escapeHtml(note)}</p>${body}${safeguards}`;
}

function entry(record: SuggestionRecord, token: string, focused = false): string {
  const payload = parsePayload(record);
  const date = record.created_at.slice(0, 10);
  let body: string;
  if (payload === null) {
    body = '<p class="note">This suggestion was sent before this computer kept a copy of what was sent.</p>';
  } else {
    const previews = Array.isArray(payload.previews)
      ? payload.previews.filter((p): p is Payload => typeof p === "object" && p !== null && typeof p.html === "string")
        .map((p) => `<h4>${text(String(p.label ?? ""))}${p.chosen ? " (chosen)" : ""}</h4>${para(p.reason)}${frame(p.html as string, String(p.label ?? "Preview"))}`).join("")
      : "";
    const facts = payload.environment_facts !== undefined
      ? `<pre class="facts">${escapeHtml(JSON.stringify(payload.environment_facts, null, 2))}</pre>`
      : "";
    const writeUp = writeUpSection(record);
    body =
      section(payload.origin === "probanda" ? "Probanda noticed" : "You suggested", para(payload.pain_point ?? payload.body)) +
      section("Items", items(record, payload)) +
      section("Constraints and evidence", contextLines(payload)) +
      section("Your comment", para(payload.comment)) +
      section("What Probanda observed", para(payload.raw_observation)) +
      section("Technical details about Probanda on this computer", facts) +
      section("Mockup", typeof payload.mockup === "string" ? frame(payload.mockup, "Mockup") : "") +
      section("Previews", previews) +
      `<details class="write-up"${focused ? " open" : ""}><summary>Show the technical write-up</summary>${writeUp}</details>`;
  }
  const withdraw = record.withdrawn_at === null
    ? `<button type="button" class="withdraw" data-token="${escapeHtml(token)}">Withdraw</button>`
    : "";
  return (
    `<section class="entry" id="s-${escapeHtml(record.record_id)}" data-record="${escapeHtml(record.record_id)}">` +
    `<h2>${text(record.title)}</h2>` +
    `<p class="meta">Sent ${escapeHtml(date)} · <span class="badge">${escapeHtml(badgeOf(record))}</span></p>` +
    body +
    `<div class="actions">${withdraw}<p class="feedback" role="status"></p></div>` +
    "</section>"
  );
}

const STYLE =
  ":root{--bg:#fafafa;--fg:#222;--muted:#555;--line:#ddd;--accent:#2f5f8a;--warn:#a00}" +
  "@media (prefers-color-scheme: dark){:root{--bg:#1e1e1e;--fg:#eee;--muted:#aaa;--line:#444;--accent:#8fb8e0;--warn:#f88}}" +
  "body{font-family:system-ui,sans-serif;margin:0;padding:16px;background:var(--bg);color:var(--fg)}" +
  "main{max-width:48rem;margin:1rem auto}h1{font-size:1.5rem}h2{font-size:1.2rem;margin:0 0 .25rem}" +
  "h3{font-size:1rem;margin:1rem 0 .25rem}h4{font-size:.95rem;margin:.75rem 0 .25rem}" +
  ".entry{border-top:1px solid var(--line);padding:1rem 0}.meta,.note,.item-status{color:var(--muted);font-size:.9rem}" +
  ".badge{font-weight:600;color:var(--accent)}.item-status .label{font-weight:600}" +
  ".bracket{border:1px solid var(--line);border-radius:3px;padding:0 .2em;font-family:ui-monospace,monospace;font-size:.9em}" +
  ".text{white-space:pre-wrap}.kind{font-weight:600}.facts{white-space:pre-wrap;font-size:.8rem;border:1px solid var(--line);padding:.5rem;overflow-x:auto}" +
  ".mockup{width:100%;height:24rem;border:1px solid var(--line);background:#fff}" +
  "button{padding:.4rem 1rem;font-size:1rem}.feedback{min-height:1.2em;font-size:.9rem}.feedback.error{color:var(--warn)}";

// The page's script: checks the listener, then arms and posts each Withdraw button. Its strings are
// the page's own; the listener's reply is read only for its outcome.
const SCRIPT = `
(function () {
  var api = JSON.parse(document.getElementById("api").textContent);
  if (api.focus) {
    var focused = document.getElementById(api.focus);
    if (focused) focused.scrollIntoView();
  }
  var base = "http://127.0.0.1:" + api.port;
  var SAY = {
    withdrawn: "Withdrawn. Probanda no longer holds this suggestion.",
    refused: "Not withdrawn. Probanda does not hold this suggestion as one this computer sent.",
    unreachable: "Not withdrawn: Probanda could not be reached. Try again later.",
    no_key: "Not withdrawn: this computer has no Probanda key yet.",
    busy: "Not withdrawn: this suggestion is being sent. Try again in a minute.",
    off: "Withdraw works while Claude is open on this computer. Open Claude, ask for your past suggestions again, and use the new page.",
    failed: "Not withdrawn: something went wrong. Ask Claude for your past suggestions again, and use the new page."
  };
  var buttons = Array.prototype.slice.call(document.querySelectorAll("button.withdraw"));
  function say(entry, text, error) {
    var p = entry.querySelector(".feedback");
    p.textContent = text;
    p.className = error ? "feedback error" : "feedback";
  }
  buttons.forEach(function (b) { b.disabled = true; });
  var ctl = typeof AbortController === "function" ? new AbortController() : null;
  var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 2000);
  fetch(base + "/health", ctl ? { signal: ctl.signal } : {}).then(function (r) {
    clearTimeout(timer);
    if (!r.ok) throw new Error("health");
    buttons.forEach(function (b) { b.disabled = false; });
  }).catch(function () {
    var first = buttons[0];
    if (first) say(first.closest(".entry"), SAY.off, true);
  });
  buttons.forEach(function (b) {
    var armed = null;
    b.addEventListener("click", function () {
      var entry = b.closest(".entry");
      if (!armed) {
        b.textContent = "Click again to withdraw";
        say(entry, "Withdrawing deletes this suggestion from Probanda. This page keeps your copy.", false);
        armed = setTimeout(function () { armed = null; b.textContent = "Withdraw"; say(entry, "", false); }, 6000);
        return;
      }
      clearTimeout(armed);
      armed = null;
      b.disabled = true;
      b.textContent = "Withdrawing...";
      say(entry, "", false);
      fetch(base + "/suggestions/" + encodeURIComponent(entry.getAttribute("data-record")) + "/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: b.getAttribute("data-token") })
      }).then(function (r) { return r.json(); }).then(function (reply) {
        var outcome = reply && SAY[reply.outcome] ? reply.outcome : "failed";
        if (outcome === "withdrawn") {
          entry.querySelector(".badge").textContent = "Withdrawn";
          b.remove();
          say(entry, SAY.withdrawn, false);
          return;
        }
        b.disabled = false;
        b.textContent = "Withdraw";
        say(entry, SAY[outcome], true);
      }).catch(function () {
        b.disabled = false;
        b.textContent = "Withdraw";
        say(entry, SAY.failed, true);
      });
    });
  });
})();
`;

/** The page's HTML for `store`, with the listener's port and each entry's token. */
export function renderPastSuggestionsHtml(store: SuggestionStore, port: number, tokenFor: (recordId: string) => string, focus: string | null = null): string {
  const records = store.records.filter(isSuggestion).sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const body = records.length
    ? records.map((r) => entry(r, r.withdrawn_at === null ? tokenFor(r.record_id) : "", r.record_id === focus)).join("")
    : '<p class="note">No suggestions have been sent from this computer yet.</p>';
  const target = focus !== null && records.some((r) => r.record_id === focus) ? `s-${focus}` : null;
  const api = JSON.stringify({ port, focus: target }).replace(/</g, "\\u003c");
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<meta http-equiv="Content-Security-Policy" content="script-src 'unsafe-inline'; connect-src http://127.0.0.1:${port}; object-src 'none'; base-uri 'none'; form-action 'none'">` +
    `<title>Past suggestions</title><style>${STYLE}</style></head><body><main><h1>Past suggestions</h1>` +
    '<p class="note">What this computer sent to the Probanda team, word for word, and what has happened to each suggestion.</p>' +
    body +
    `</main><script type="application/json" id="api">${api}</script><script>${SCRIPT}</script></body></html>`
  );
}

export function pastSuggestionsPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(storeDir(env), PAST_SUGGESTIONS_FILE);
}

/** Writes the page from the store as it is now and returns its path. */
export async function writePastSuggestionsPage(env: NodeJS.ProcessEnv = process.env, options: { focus?: string } = {}): Promise<string> {
  const store = await loadStore(env);
  const path = pastSuggestionsPath(env);
  // A suggestion asked for by its record id opens at its entry, with its technical write-up shown.
  if (options.focus !== undefined && !store.records.some((r) => isSuggestion(r) && r.record_id === options.focus)) {
    throw new NotFoundError(`no suggestion ${options.focus} on this computer`, "not_found");
  }
  // On a new device /probanda-setup calls this first, to create the folder it connects.
  mkdirSync(dirname(path), { recursive: true });
  writeTextAtomic(path, renderPastSuggestionsHtml(store, pageApiPort(env), (id) => pageApiSuggestionToken(id, env), options.focus ?? null));
  return path;
}
