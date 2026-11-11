// The blocks export (build plan slice 11): the staged blocks of a range of days go to a file that
// /vet-billable-time's blocks_export.py reads, and the block ids in that file are the ones an issued
// invoice locks. Every fixture is synthetic.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { reviewDateClaim, reviewDateJudge, reviewDateRejudge, reviewDateStatus } = await import("../build/time-pipeline/review-date.js");
const { timeReviewReadDay, timeReviewSaveEvidence, timeReviewStageDay } = await import("../build/time-review/tools.js");
const { timeReviewExportBlocks } = await import("../build/time-review/export.js");
const { GATE_SOURCES } = await import("../build/time-review/sources.js");
const { markIssued, mergeBlocks, splitBlock, undoRestructure } = await import("../build/time-review/restructure.js");

const sources = GATE_SOURCES.map((source) => ({ source, status: "fetched" }));
const rows = [{ source: "gcal_events", id: "e1", summary: "Synthetic call" }];
const block = (start, end, description) => ({
  start,
  end,
  matter: "Synthetic Matter A",
  description,
  matter_basis: "evidence_names_matter",
  bill_basis: [],
  evidence: [{ source: "gcal_events", ref: "e1" }],
});

function device(t) {
  const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), "coclerk-review-export-")));
  const root = join(scratch, "0. CASE DATA");
  mkdirSync(root, { recursive: true });
  const config = join(scratch, "probanda.json");
  writeFileSync(config, JSON.stringify({ case_data_root: root }));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  return { scratch, seams: { env: { ...process.env, COCLERK_CONFIG_PATH: config } } };
}

function stage(f, date, blocks) {
  assert.equal(timeReviewSaveEvidence(date, sources, rows, f.seams).status, "saved");
  const claim = reviewDateClaim(date, "test:export", f.seams);
  assert.equal(timeReviewStageDay(date, claim.token, blocks, f.seams).status, "staged");
}

test("The export holds each day that has blocks, in date order, and leaves the others out", (t) => {
  const f = device(t);
  stage(f, "2030-03-05", [block("09:00", "09:30", "Synthetic call")]);
  stage(f, "2030-03-04", [block("09:00", "10:00", "Synthetic review"), block("10:00", "10:30", "Synthetic note")]);
  const out = join(f.scratch, "nested", "blocks.json");
  const reply = timeReviewExportBlocks("2030-03-03", "2030-03-06", out, f.seams);
  assert.deepEqual([reply.days, reply.blocks], [2, 3]);

  const file = JSON.parse(readFileSync(out, "utf-8"));
  assert.deepEqual(file.days.map((d) => d.date), ["2030-03-04", "2030-03-05"]);
  assert.deepEqual(file.days[0].blocks.map((b) => b.id), ["2030-03-04:001", "2030-03-04:002"]);
  // A staged day that is not judged is not clear, and the file says so.
  assert.equal(file.days[0].clear, false);
  assert.deepEqual(file.days[0].blocks[0], timeReviewReadDay("2030-03-04", f.seams).blocks[0]);
  assert.equal(file.days[0].evidence, undefined, "the evidence rows stay out of the file");
});

test("A bad range or path is refused and writes nothing", (t) => {
  const f = device(t);
  const out = join(f.scratch, "blocks.json");
  assert.throws(() => timeReviewExportBlocks("2030-03-06", "2030-03-04", out, f.seams), /after to/);
  assert.throws(() => timeReviewExportBlocks("2030-3-4", "2030-03-04", out, f.seams), /not a date/);
  assert.throws(() => timeReviewExportBlocks("2030-01-01", "2032-01-01", out, f.seams), /at most/);
  assert.throws(() => timeReviewExportBlocks("2030-03-04", "2030-03-05", "", f.seams), /out_path/);
});

test("Blocks taken from the export and marked issued can no longer be undone, split or merged", (t) => {
  const f = device(t);
  const date = "2030-03-04";
  const captured = [
    ...rows,
    { source: "syncopaid_captures", id: "cap1", capture_id: "cap1", captured_at: `${date}T09:10:00` },
    { source: "syncopaid_captures", id: "cap2", capture_id: "cap2", captured_at: `${date}T09:35:00` },
  ];
  assert.equal(timeReviewSaveEvidence(date, sources, captured, f.seams).status, "saved");
  const claim = reviewDateClaim(date, "test:export", f.seams);
  const first = block("09:00", "10:00", "Synthetic call");
  first.evidence = [...first.evidence, { source: "syncopaid_captures", ref: "cap1" }, { source: "syncopaid_captures", ref: "cap2" }];
  const staged = [first, block("10:00", "10:30", "Synthetic review"), block("10:30", "11:00", "Synthetic note")];
  assert.equal(timeReviewStageDay(date, claim.token, staged, f.seams).status, "staged");
  const merged = mergeBlocks([`${date}:002`, `${date}:003`], f.seams).merged;
  const halves = splitBlock(`${date}:001`, "cap2", f.seams).halves;

  // The blocks an invoice rests on are the live ones in the export: not the originals kept behind a merge or split.
  const out = join(f.scratch, "blocks.json");
  timeReviewExportBlocks(date, date, out, f.seams);
  const live = JSON.parse(readFileSync(out, "utf-8")).days[0].blocks.filter((b) => b.state !== "merged" && b.state !== "split").map((b) => b.id);
  assert.deepEqual(live.sort(), [merged, ...halves].sort());

  // Before issue they can be undone.
  assert.ok(undoRestructure(merged, f.seams));
  const again = mergeBlocks([`${date}:002`, `${date}:003`], f.seams).merged;
  markIssued([again, ...halves], "SYNTH-1", f.seams);

  assert.throws(() => undoRestructure(again, f.seams), /issued invoice SYNTH-1/);
  assert.throws(() => undoRestructure(halves[0], f.seams), /issued invoice SYNTH-1/);
  assert.throws(() => splitBlock(halves[0], "cap1", f.seams), /issued invoice/);
  assert.throws(() => mergeBlocks([halves[0], halves[1]], f.seams), /issued invoice/);
  // The export still shows the block as issued.
  timeReviewExportBlocks(date, date, out, f.seams);
  const issued = JSON.parse(readFileSync(out, "utf-8")).days[0].blocks.find((b) => b.id === again);
  assert.equal(issued.issued.invoice_number, "SYNTH-1");
});

test("A date judged in chat, with no blocks, can be judged once more to build them; a staged date cannot", (t) => {
  const f = device(t);
  const chat = "2030-03-04";
  // Judged before the page existed: a claim and a judge, and no block.
  const first = reviewDateClaim(chat, "bill:one", f.seams);
  assert.equal(reviewDateJudge(chat, first.token, f.seams).status, "judged");
  assert.equal(reviewDateRejudge("2030-03-09", "bill:two", f.seams).status, "not_judged");

  const again = reviewDateRejudge(chat, "bill:two", f.seams);
  assert.equal(again.status, "claimed");
  // While it is open for the second judgment, another run finds it held, and the date reads as unjudged.
  assert.equal(reviewDateClaim(chat, "bill:three", f.seams).status, "held");
  assert.equal(reviewDateStatus([chat], f.seams).dates[0].status, "in_progress");

  assert.equal(timeReviewSaveEvidence(chat, sources, rows, f.seams).status, "saved");
  assert.equal(timeReviewStageDay(chat, again.token, [block("09:00", "10:00", "Synthetic call")], f.seams).status, "staged");
  assert.equal(reviewDateJudge(chat, again.token, f.seams).status, "judged");

  // Staged and judged now: the date has blocks, so it is never opened again.
  const refused = reviewDateRejudge(chat, "bill:four", f.seams);
  assert.deepEqual([refused.status, refused.blocks], ["has_blocks", 1]);
  assert.equal(timeReviewReadDay(chat, f.seams).blocks.length, 1);
});
