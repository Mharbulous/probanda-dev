// The time review page (build plan slice 7): a fixed template filled from the store. No model draws,
// lays out or reads it, and building it opens no image: a screenshot is an <img> whose file the
// page listener serves when the browser asks (server.ts). The Approve, Correct and Write off buttons
// post to the listener, which saves the act to the block (act.ts); building the page writes nothing.

import { timePipelineGet, timePipelineList } from "../time-pipeline/backend.js";
import { dayIsClear } from "./act.js";
import { BLOCK_PREFIX, type BlockRecord, type DayEvidenceRecord, NAMESPACE, readDayEvidence } from "./records.js";
import type { ReviewDateSeams } from "../time-pipeline/review-date.js";
import CSS from "./templates/review.css.js";
import HTML from "./templates/review.html.js";
import JS from "./templates/review.js.js";

/** What a saved screenshot reading holds (`capture_reading` record, slice 3). Shown as it was saved. */
export interface CaptureReading {
  reading?: Record<string, unknown>;
  answers?: unknown[];
}

export interface ReviewModel {
  blocks: BlockRecord[];
  evidence: Record<string, DayEvidenceRecord | null>;
  readings: Record<string, CaptureReading | undefined>;
  /** Per date: judged, with no flagged block. */
  clear: Record<string, boolean>;
}

const SHOT_SOURCE = "syncopaid_captures";
const ID_FIELDS = ["id", "native_id", "capture_id", "entry_id"];
const MAX_FIELDS = 8;
const MAX_VALUE = 200;

/** Reads every staged block, the evidence of the days they are on and the saved reading of each
 * screenshot they cite. Writes nothing and opens no file. */
export function loadReviewModel(seams: ReviewDateSeams = {}): ReviewModel {
  const env = seams.env ?? process.env;
  const blocks = (timePipelineList(NAMESPACE, BLOCK_PREFIX, env).items.map((item) => JSON.parse(item.value)) as BlockRecord[]).sort(byTime);
  const evidence: ReviewModel["evidence"] = {};
  for (const date of new Set(blocks.map((b) => b.date))) evidence[date] = readDayEvidence(date, seams);
  const readings: ReviewModel["readings"] = {};
  for (const block of blocks) {
    for (const ref of block.evidence) {
      if (ref.source !== SHOT_SOURCE) continue;
      const id = captureId(evidence[block.date], ref.ref);
      if (id in readings) continue;
      const { value } = timePipelineGet(NAMESPACE, `capture_reading:${id}`, env);
      readings[id] = value === null ? undefined : (JSON.parse(value) as CaptureReading);
    }
  }
  const clear: ReviewModel["clear"] = {};
  for (const date of new Set(blocks.map((b) => b.date))) clear[date] = dayIsClear(date, blocks, seams);
  return { blocks, evidence, readings, clear };
}

/** The line a card shows for what the click recorded, or "". */
export function reviewText(block: BlockRecord): string {
  const r = block.review;
  if (!r) return "";
  if (r.act === "approved") return `Approved by ${r.by} at ${r.at}.`;
  if (r.act === "corrected") return `Corrected by ${r.by} at ${r.at}. Was: ${r.before?.matter ?? ""}, ${r.before?.start ?? ""} to ${r.before?.end ?? ""}, ${r.before?.description ?? ""}`;
  return `Written off by ${r.by} at ${r.at}. Reason: ${r.reason ?? ""}`;
}

/** The line a card shows for the TimeCamp write, with the class that colours it. */
export function timecampLine(block: BlockRecord): { text: string; cls: string } {
  const t = block.timecamp;
  if (!t) return { text: "", cls: "" };
  switch (t.status) {
    case "saved":
      return { text: "Saved to TimeCamp.", cls: "tc-saved" };
    case "unchanged":
      return { text: "TimeCamp already held this matter and description.", cls: "tc-saved" };
    case "staff_left_alone":
      return { text: "Staff entry: its TimeCamp note was left as the staff member wrote it.", cls: "" };
    case "error":
      return { text: `TimeCamp error: ${t.message ?? "the write did not go through"}`, cls: "tc-error" };
    default:
      return { text: "Waiting for the session to write this to TimeCamp.", cls: "" };
  }
}

/** Days in order, and within a day by start time, then id: a split's new halves sit where their
 * time is, not at the end of the day. */
function byTime(a: BlockRecord, b: BlockRecord): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const x = startValue(a.start);
  const y = startValue(b.start);
  if (x !== y && Number.isFinite(x - y)) return x - y;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function startValue(text: string): number {
  const clock = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const instant = Date.parse(text);
  return Number.isFinite(instant) ? instant : Number.POSITIVE_INFINITY;
}

export const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** The evidence row a block's reference points at, or null. */
function rowFor(day: DayEvidenceRecord | null | undefined, source: string, ref: string): Record<string, unknown> | null {
  const row = day?.rows.find((r) => r.source === source && ID_FIELDS.some((f) => r[f] !== undefined && String(r[f]) === ref));
  return row ?? null;
}

/** The id a screenshot's file and saved reading go by: the row's capture id, else the reference. */
export function captureId(day: DayEvidenceRecord | null | undefined, ref: string): string {
  const row = rowFor(day, SHOT_SOURCE, ref);
  return row && typeof row.capture_id === "string" && row.capture_id !== "" ? row.capture_id : ref;
}

function shortText(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}…` : text;
}

function fieldRows(row: Record<string, unknown>): string {
  const fields = Object.entries(row)
    .filter(([name, value]) => name !== "source" && value !== null && value !== undefined && value !== "")
    .slice(0, MAX_FIELDS);
  return fields.map(([name, value]) => `<tr><th>${escapeHtml(name)}</th><td>${escapeHtml(shortText(value))}</td></tr>`).join("");
}

/** Minutes from start to end when both read as HH:MM or as dates, else null. */
export function minutesBetween(start: string, end: string): number | null {
  const clock = /^(\d{1,2}):(\d{2})$/;
  const a = clock.exec(start);
  const b = clock.exec(end);
  if (a && b) {
    const span = Number(b[1]) * 60 + Number(b[2]) - (Number(a[1]) * 60 + Number(a[2]));
    return span >= 0 ? span : null;
  }
  const span = (Date.parse(end) - Date.parse(start)) / 60000;
  return Number.isFinite(span) && span >= 0 ? Math.round(span) : null;
}

const label = (token: string): string => token.replace(/_/g, " ");

function readingHtml(reading: CaptureReading | undefined): string {
  if (!reading) return `<p class="reading none">No saved reading.</p>`;
  const parts = Object.entries(reading.reading ?? {})
    .map(([name, value]) => `<tr><th>${escapeHtml(label(name))}</th><td>${escapeHtml(shortText(value))}</td></tr>`)
    .join("");
  const answers = (reading.answers ?? []).map((a) => `<tr><th>answer</th><td>${escapeHtml(shortText(a))}</td></tr>`).join("");
  return `<table class="rows reading">${parts}${answers}</table>`;
}

function cardHtml(block: BlockRecord, model: ReviewModel, imgBase: string | null, matters: string[]): string {
  const day = model.evidence[block.date];
  const minutes = minutesBetween(block.start, block.end);
  const shots: string[] = [];
  const rows: string[] = [];
  for (const ref of block.evidence) {
    const row = rowFor(day, ref.source, ref.ref);
    if (ref.source === SHOT_SOURCE) {
      const id = captureId(day, ref.ref);
      const image = imgBase === null ? "" : `<img src="${escapeHtml(imgBase)}${encodeURIComponent(id)}" alt="Screenshot ${escapeHtml(id)}" loading="lazy">`;
      shots.push(`<div class="shot" data-capture="${escapeHtml(id)}" hidden><div>${image}</div>${readingHtml(model.readings[id])}</div>`);
    } else {
      rows.push(
        `<h3 class="src">${escapeHtml(label(ref.source))}: ${escapeHtml(ref.ref)}</h3>` +
          (row ? `<table class="rows">${fieldRows(row)}</table>` : `<p class="none">This row is not in the day's saved evidence.</p>`)
      );
    }
  }
  const slideshow =
    shots.length === 0
      ? ""
      : `<h2>Screenshots</h2><div class="shots"><div class="shot-bar"><button type="button" class="shot-prev">&larr;</button><span class="shot-count"></span><button type="button" class="shot-next">&rarr;</button>${block.state === "merged" || block.state === "split" ? "" : `<button type="button" class="act-split">Split here</button>`}</div>${shots.join("")}</div>`;
  const evidence = rows.length === 0 && shots.length === 0 ? `<p class="none">No evidence is cited for this block.</p>` : rows.join("");
  const flags = block.flags.length === 0 ? "" : `<ul class="flags">${block.flags.map((f) => `<li>${escapeHtml(label(f))}</li>`).join("")}</ul>`;
  const duration = minutes === null ? "" : ` (${minutes} min)`;
  const links = block.links.length === 0 ? "" : `<p class="times">${block.links.map((l) => `${escapeHtml(label(l.role))} ${escapeHtml(l.block)}`).join("; ")}</p>`;
  const tc = timecampLine(block);
  return (
    `<article class="card" data-id="${escapeHtml(block.id)}" data-date="${escapeHtml(block.date)}" data-matter="${escapeHtml(block.matter)}" hidden>` +
    `<div class="top"><span class="matter">${escapeHtml(block.matter)}</span><span class="state state-${escapeHtml(block.state)}">${escapeHtml(label(block.state))}</span></div>` +
    `<div class="times">${escapeHtml(block.date)} ${escapeHtml(block.start)} to ${escapeHtml(block.end)}${duration}</div>` +
    `<p class="desc">${escapeHtml(block.description)}</p>${flags}${links}` +
    actionsHtml(block, matters, undoable(block, model.blocks)) +
    `<p class="review-text">${escapeHtml(reviewText(block))}</p>` +
    `<p class="tc-text ${tc.cls}">${escapeHtml(tc.text)}</p>` +
    `<h2>Evidence</h2>${evidence}${slideshow}</article>`
  );
}

/** Whether the block is part of a split or merge that Undo can reverse: an original kept behind a
 * new block, or one of the new blocks. */
function undoable(block: BlockRecord, all: BlockRecord[]): boolean {
  if (block.state === "merged" || block.state === "split") return true;
  if (block.links.some((l) => l.role === "split_from")) return true;
  return all.some((o) => o.links.some((l) => l.role === "merged_into" && l.block === block.id));
}

function undoLabel(block: BlockRecord): string {
  const split = block.state === "split" || block.links.some((l) => l.role === "split_from");
  return split ? "Unsplit" : "Unmerge";
}

/** The buttons and the two small forms they open. The forms are plain elements, never
 * <form>s: the page's policy forbids form submission, and the script posts the click itself. */
function actionsHtml(block: BlockRecord, matters: string[], undo: boolean): string {
  const options = (matters.includes(block.matter) ? matters : [block.matter, ...matters])
    .map((m) => `<option value="${escapeHtml(m)}"${m === block.matter ? " selected" : ""}>${escapeHtml(m)}</option>`)
    .join("");
  // An original kept behind a split or merge takes no act: act on the new block, or undo.
  const off = block.state === "merged" || block.state === "split" ? " disabled" : "";
  return (
    `<div class="acts"><button type="button" class="act-approve"${off}>Approve</button>` +
    `<button type="button" class="act-correct-open"${off}>Correct</button>` +
    `<button type="button" class="act-writeoff-open"${off}>Write off</button>` +
    `<button type="button" class="act-merge"${off}>Merge with next</button>` +
    `<button type="button" class="act-undo"${undo ? "" : " disabled"}>${escapeHtml(undoLabel(block))}</button></div>` +
    `<div class="edit edit-correct" hidden>` +
    `<label>Matter<select class="f-matter">${options}</select></label>` +
    `<label>Description<textarea class="f-description" rows="3">${escapeHtml(block.description)}</textarea></label>` +
    `<label>Start<input class="f-start" type="text" value="${escapeHtml(block.start)}"></label>` +
    `<label>End<input class="f-end" type="text" value="${escapeHtml(block.end)}"></label>` +
    `<div class="edit-buttons"><button type="button" class="correct-save">Save correction</button><button type="button" class="correct-cancel">Cancel</button></div></div>` +
    `<div class="edit edit-writeoff" hidden>` +
    `<label>Reason<input class="f-reason" type="text" maxlength="200"></label>` +
    `<div class="edit-buttons"><button type="button" class="writeoff-save">Write off this block</button><button type="button" class="writeoff-cancel">Cancel</button></div></div>` +
    `<p class="act-note" role="status"></p>`
  );
}

/** Replaces each `{{NAME}}` once, with plain text (no `$` patterns). */
function fill(template: string, parts: Record<string, string>): string {
  return template.replace(/\{\{([A-Z]+)\}\}/g, (_all, name: string) => parts[name] ?? "");
}

/** JSON safe inside a script element. */
const scriptJson = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(new RegExp(String.fromCharCode(0x2028), "g"), "\\u2028")
    .replace(new RegExp(String.fromCharCode(0x2029), "g"), "\\u2029");

/** The page, whole. Pure: the same model and image base always give the same text. `imgBase` is
 * the URL prefix a screenshot's id is appended to, or null when no screenshot folder is served. */
export function renderReviewPage(model: ReviewModel, imgBase: string | null): string {
  const dates = [...new Set(model.blocks.map((b) => b.date))];
  const matters = [...new Set(model.blocks.map((b) => b.matter))].sort();
  const index = model.blocks.map((b) => ({ id: b.id, date: b.date, matter: b.matter, flagged: b.state === "flagged", live: b.state !== "merged" && b.state !== "split" }));
  const cards = model.blocks.length === 0 ? `<p class="none">No day has staged blocks yet.</p>` : model.blocks.map((b) => cardHtml(b, model, imgBase, matters)).join("\n");
  return fill(HTML, {
    CSS,
    JS,
    DATES: dates.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join(""),
    MATTERS: [`<option value="">All matters</option>`, ...matters.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`)].join(""),
    CARDS: cards,
    INDEX: scriptJson(index),
    CLEAR: scriptJson(model.clear),
  });
}
