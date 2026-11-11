// Split, merge and their undo on the time review page (build plan slice 9). Every fixture is
// synthetic. The split path is shown to dispatch no reader and open no image: the page is served
// with no screenshot folder at all, and the module that splits imports nothing that could read a file
// or start an agent. Nothing here calls TimeCamp.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const { reviewDateClaim, reviewDateJudge } = await import("../build/time-pipeline/review-date.js");
const { timeReviewReadDay, timeReviewSaveEvidence, timeReviewStageDay } = await import("../build/time-review/tools.js");
const { GATE_SOURCES } = await import("../build/time-review/sources.js");
const { loadReviewModel, renderReviewPage } = await import("../build/time-review/page.js");
const { markIssued, mergeBlocks, redraftBlock, splitBlock, undoRestructure } = await import("../build/time-review/restructure.js");
const { closeReviewPages, serveReviewPage, waitClick } = await import("../build/time-review/server.js");

const DAY = "2030-03-04";
const here = dirname(fileURLToPath(import.meta.url));

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function device(t) {
  const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), "coclerk-review-restructure-")));
  const root = join(scratch, "0. CASE DATA");
  mkdirSync(root, { recursive: true });
  const config = join(scratch, "probanda.json");
  writeFileSync(config, JSON.stringify({ case_data_root: root, page_ports: { timekeeping: await freePort() } }));
  const env = { ...process.env, COCLERK_CONFIG_PATH: config };
  t.after(async () => {
    await closeReviewPages();
    rmSync(scratch, { recursive: true, force: true });
  });
  return { env, seams: { env } };
}

const sources = GATE_SOURCES.map((source) => ({ source, status: "fetched" }));
const rows = [
  { source: "gcal_events", id: "e1", summary: "Synthetic call" },
  // Local-time strings with no zone, so the clock the split reads is the same on any machine.
  { source: "syncopaid_captures", id: "cap1", capture_id: "cap1", captured_at: `${DAY}T09:10:00` },
  { source: "syncopaid_captures", id: "cap2", capture_id: "cap2", captured_at: `${DAY}T09:35:00` },
];
const block = (start, end, description, extra = {}) => ({
  start,
  end,
  matter: "Synthetic Matter A",
  description,
  matter_basis: "evidence_names_matter",
  bill_basis: [],
  evidence: [{ source: "gcal_events", ref: "e1" }],
  ...extra,
});

/** A claimed, not-yet-judged day: 001 09:00-10:00 (two screenshots), 002, 003 on matter A, 004 on matter B. */
function stage(f) {
  assert.equal(timeReviewSaveEvidence(DAY, sources, rows, f.seams).status, "saved");
  const claim = reviewDateClaim(DAY, "test:restructure", f.seams);
  const blocks = [
    block("09:00", "10:00", "Synthetic call about the letter", {
      evidence: [
        { source: "gcal_events", ref: "e1" },
        { source: "syncopaid_captures", ref: "cap1" },
        { source: "syncopaid_captures", ref: "cap2" },
      ],
    }),
    block("10:00", "10:30", "Synthetic review of the notice"),
    block("10:30", "11:00", "Synthetic note to file"),
    block("11:00", "12:00", "Synthetic work elsewhere", { matter: "Synthetic Matter B" }),
  ];
  assert.equal(timeReviewStageDay(DAY, claim.token, blocks, f.seams).status, "staged");
  return claim.token;
}

const day = (f) => timeReviewReadDay(DAY, f.seams);
const get = (f, id) => day(f).blocks.find((b) => b.id === id);
const id = (n) => `${DAY}:00${n}`;
const post = async (f, body) => {
  const served = await serveReviewPage(undefined, f.env);
  return fetch(`${served.url}click`, { method: "POST", body: JSON.stringify(body) });
};

test("Split at a screenshot makes two new flagged halves and keeps the original", async (t) => {
  const f = await device(t);
  stage(f);
  const before = get(f, id(1));
  const res = await post(f, { act: "split", block: id(1), capture: "cap2" });
  assert.equal(res.status, 200);
  const reply = await res.json();
  assert.deepEqual(reply.blocks, [id(5), id(6)]);

  const original = get(f, id(1));
  assert.deepEqual({ ...original, state: before.state }, before, "the original changes only its state");
  assert.equal(original.state, "split");

  const [a, b] = [get(f, id(5)), get(f, id(6))];
  assert.equal(a.state, "flagged");
  assert.equal(b.state, "flagged");
  assert.deepEqual([a.start, a.end, b.start, b.end], ["09:00", "09:35", "09:35", "10:00"]);
  assert.deepEqual(a.links, [{ role: "split_from", block: id(1) }]);
  assert.deepEqual(b.links, [{ role: "split_from", block: id(1) }]);
  assert.deepEqual(a.redraft?.status, "pending");
  assert.ok(a.flags.includes("split:redraft_pending") && a.flags.includes("bill:description_inferred"));
  // Each screenshot goes to the half it falls in; the calendar row goes to both.
  assert.deepEqual(a.evidence, [{ source: "gcal_events", ref: "e1" }, { source: "syncopaid_captures", ref: "cap1" }]);
  assert.deepEqual(b.evidence, [{ source: "gcal_events", ref: "e1" }, { source: "syncopaid_captures", ref: "cap2" }]);
  assert.equal(day(f).clear, false);
});

test("The waiting session is told of a split and redrafts both halves from the stored readings", async (t) => {
  const f = await device(t);
  stage(f);
  await post(f, { act: "split", block: id(1), capture: "cap2" });
  const click = await waitClick(f.env);
  assert.equal(click.status, "clicked");
  assert.equal(click.act, "split");
  assert.deepEqual(click.blocks, [id(5), id(6)]);

  // What the session reads to redraft: the day's evidence and the saved readings, no image.
  const read = day(f);
  assert.ok(read.evidence.rows.some((r) => r.capture_id === "cap2"));
  assert.deepEqual(Object.keys(read.readings).sort(), ["cap1", "cap2"]);

  const first = redraftBlock(id(5), "Synthetic Matter A", "Drafted the letter", f.seams);
  assert.equal(first.description, "Drafted the letter");
  assert.equal(first.state, "flagged");
  assert.equal(first.redraft.status, "done");
  assert.ok(!first.flags.includes("split:redraft_pending"));
  assert.throws(() => redraftBlock(id(5), "Synthetic Matter A", "Again", f.seams), /no redraft waiting/);
  assert.throws(() => redraftBlock(id(2), "Synthetic Matter A", "Not a half", f.seams), /no redraft waiting/);
  redraftBlock(id(6), "Synthetic Matter A", "Reviewed the reply", f.seams);
  assert.equal(get(f, id(6)).state, "flagged");
});

test("The split path opens no image and dispatches no reader", async (t) => {
  const f = await device(t);
  stage(f);
  // The page is served with no screenshot folder, so nothing could be opened, and the split succeeds.
  const served = await serveReviewPage(undefined, f.env);
  assert.equal(served.screenshots, false);
  const res = await fetch(`${served.url}click`, { method: "POST", body: JSON.stringify({ act: "split", block: id(1), capture: "cap1" }) });
  assert.equal(res.status, 200);
  // The module imports nothing that reads a file, starts a process or reaches an agent.
  for (const file of ["restructure.ts"]) {
    const source = readFileSync(join(here, "..", "src", "time-review", file), "utf8");
    const imports = [...source.matchAll(/from "([^"]+)";/g)].map((m) => m[1]);
    assert.ok(imports.length > 3);
    assert.ok(imports.every((m) => m.startsWith(".")), `${file} imports only local modules: ${imports.join(", ")}`);
    assert.ok(!/readFile|createReadStream|spawn|execSync|execFile|fetch\(|\.png/.test(source.replace(/\/\/.*$/gm, "")), `${file} reads no file`);
  }
});

test("A split is refused outside the block, for a screenshot it does not cite, and twice", async (t) => {
  const f = await device(t);
  stage(f);
  assert.throws(() => splitBlock(id(1), "nope", f.seams), /does not cite a screenshot/);
  assert.throws(() => splitBlock(id(2), "cap1", f.seams), /does not cite a screenshot/);
  assert.equal((await post(f, { act: "split", block: id(1) })).status, 400);
  splitBlock(id(1), "cap1", f.seams);
  assert.throws(() => splitBlock(id(1), "cap2", f.seams), /already split/);
  assert.equal(day(f).blocks.length, 6);
});

test("Merge joins descriptions with a semicolon by script into one new flagged block", async (t) => {
  const f = await device(t);
  stage(f);
  const before = [get(f, id(2)), get(f, id(3))];
  const res = await post(f, { act: "merge", blocks: [id(2), id(3)] });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).blocks, [id(5)]);

  const merged = get(f, id(5));
  assert.equal(merged.description, "Synthetic review of the notice; Synthetic note to file");
  assert.deepEqual([merged.start, merged.end, merged.matter], ["10:00", "11:00", "Synthetic Matter A"]);
  assert.equal(merged.state, "flagged");
  assert.ok(merged.flags.includes("merge:new_block"));
  assert.deepEqual(merged.evidence, [{ source: "gcal_events", ref: "e1" }], "the same row is cited once");
  assert.deepEqual(merged.links, []);
  for (const [i, original] of [id(2), id(3)].entries()) {
    const kept = get(f, original);
    assert.equal(kept.state, "merged");
    assert.deepEqual(kept.links, [{ role: "merged_into", block: id(5) }]);
    assert.deepEqual({ ...kept, state: before[i].state, links: before[i].links }, before[i]);
  }
  const click = await waitClick(f.env);
  assert.deepEqual([click.act, click.block], ["merge", id(5)]);
});

test("Merge refuses blocks that are not next to each other, of different matters, or already merged", async (t) => {
  const f = await device(t);
  stage(f);
  assert.throws(() => mergeBlocks([id(1), id(3)], f.seams), /next to each other/);
  assert.throws(() => mergeBlocks([id(3), id(4)], f.seams), /one matter only/);
  assert.throws(() => mergeBlocks([id(1)], f.seams), /between 2 and/);
  mergeBlocks([id(1), id(2)], f.seams);
  assert.throws(() => mergeBlocks([id(1), id(2)], f.seams), /already merged/);
  // The merged block can merge with the next one: the originals behind it do not count.
  const merged = mergeBlocks([id(5), id(3)], f.seams);
  assert.equal(get(f, merged.merged).description, "Synthetic call about the letter; Synthetic review of the notice; Synthetic note to file");
});

test("Unmerge returns the originals as they were, flagged, and removes the merged block", async (t) => {
  const f = await device(t);
  stage(f);
  await post(f, { act: "approve", block: id(2) });
  const before = [get(f, id(2)), get(f, id(3))];
  assert.equal(before[0].state, "approved");
  mergeBlocks([id(2), id(3)], f.seams);

  const res = await post(f, { act: "undo", block: id(5) });
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).blocks, [id(2), id(3)]);
  assert.equal(get(f, id(5)), undefined);
  for (const original of before) {
    // Equal to the original in every field but the state and its reason: the approval was for the other version.
    assert.deepEqual(get(f, original.id), { ...original, state: "flagged", flags: [...original.flags, "undo:merge"] });
  }
  // Undoing from an original does the same.
  mergeBlocks([id(2), id(3)], f.seams);
  assert.deepEqual(undoRestructure(id(3), f.seams).restored, [id(2), id(3)]);
  assert.equal(get(f, id(2)).state, "flagged");
});

test("Unsplit returns the original as it was, flagged, from either half", async (t) => {
  const f = await device(t);
  stage(f);
  const before = get(f, id(1));
  splitBlock(id(1), "cap2", f.seams);
  const undone = undoRestructure(id(6), f.seams);
  assert.deepEqual([undone.undone, undone.restored, undone.removed], ["split", [id(1)], [id(5), id(6)]]);
  assert.deepEqual(get(f, id(1)), { ...before, state: "flagged", flags: [...before.flags, "undo:split"] });
  assert.equal(get(f, id(5)), undefined);
  assert.equal(get(f, id(6)), undefined);
  // It can be split again, and the new halves take fresh ids.
  assert.deepEqual(splitBlock(id(1), "cap1", f.seams).halves, [id(5), id(6)]);
  assert.throws(() => undoRestructure(id(3), f.seams), /not part of a split or a merge/);
});

test("Undo is refused once the time is on an issued invoice, and nothing changes", async (t) => {
  const f = await device(t);
  stage(f);
  const merged = mergeBlocks([id(2), id(3)], f.seams).merged;
  const split = splitBlock(id(1), "cap2", f.seams).halves;
  markIssued([merged, split[0]], "SYNTH-1", f.seams);
  const snapshot = JSON.stringify(day(f).blocks);

  assert.throws(() => undoRestructure(merged, f.seams), /issued invoice SYNTH-1/);
  // From an original, the group is the same and is just as final.
  assert.throws(() => undoRestructure(id(2), f.seams), /issued invoice SYNTH-1/);
  assert.throws(() => undoRestructure(split[1], f.seams), /issued invoice SYNTH-1/);
  assert.throws(() => undoRestructure(id(1), f.seams), /issued invoice SYNTH-1/);
  assert.equal((await post(f, { act: "undo", block: merged })).status, 400);
  assert.equal(JSON.stringify(day(f).blocks), snapshot);
  // Nor can an issued block be split or merged again.
  assert.throws(() => splitBlock(split[0], "cap1", f.seams), /issued invoice/);
  assert.throws(() => mergeBlocks([merged, id(4)], f.seams), /issued invoice|one matter only/);
});

test("An original kept behind a split or merge takes no act", async (t) => {
  const f = await device(t);
  stage(f);
  mergeBlocks([id(2), id(3)], f.seams);
  const res = await post(f, { act: "approve", block: id(2) });
  assert.equal(res.status, 400);
  assert.equal(get(f, id(2)).state, "merged");
  assert.equal(get(f, id(2)).review, undefined);
});

test("The page shows the halves in time order with Split, Merge and Unsplit or Unmerge, and a split day is not clear", async (t) => {
  const f = await device(t);
  const token = stage(f);
  reviewDateJudge(DAY, token, f.seams);
  splitBlock(id(1), "cap2", f.seams);
  mergeBlocks([id(2), id(3)], f.seams);
  const model = loadReviewModel(f.seams);
  assert.deepEqual(model.blocks.map((b) => b.id), [id(1), id(5), id(6), id(2), id(7), id(3), id(4)]);
  assert.equal(model.clear[DAY], false);
  const html = renderReviewPage(model, null);
  assert.match(html, /class="act-split"/);
  assert.match(html, /class="act-merge"/);
  assert.match(html, /Unsplit/);
  assert.match(html, /Unmerge/);
  assert.match(html, /split from/);
  assert.match(html, /"live":false/);
});
