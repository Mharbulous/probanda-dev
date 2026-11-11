// Approve, Correct and Write off on the time review page (build plan slice 8): each act is saved to
// its block and shown, one block's approval leaves another flagged, the TimeCamp result shows on the
// card, and a day is clear only when it is judged with no flagged block. Every fixture is synthetic
// and nothing here calls TimeCamp: the session's TimeCamp write is out of this server's reach, so
// the tests report its outcome through time_review__record_timecamp.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { reviewDateClaim, reviewDateJudge } = await import("../build/time-pipeline/review-date.js");
const { timeReviewReadDay, timeReviewRecordTimecamp, timeReviewSaveEvidence, timeReviewStageDay } = await import("../build/time-review/tools.js");
const { GATE_SOURCES } = await import("../build/time-review/sources.js");
const { loadReviewModel, renderReviewPage } = await import("../build/time-review/page.js");
const { closeReviewPages, serveReviewPage, waitClick } = await import("../build/time-review/server.js");

const DAY = "2030-02-04";
const OTHER = "2030-02-05";

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
  const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), "coclerk-review-act-")));
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
const flaggedBlock = (n, extra = {}) => ({
  start: `0${n}:00`,
  end: `0${n}:30`,
  matter: "Synthetic Matter A",
  description: `Synthetic work ${n}`,
  matter_basis: "indirect_only",
  bill_basis: [],
  evidence: [{ source: "gcal_events", ref: "e1" }],
  ...extra,
});

/** A day of three flagged blocks and one auto-assigned, claimed and held (not yet judged). */
function stage(f, date = DAY) {
  const rows = [{ source: "gcal_events", id: "e1", summary: "Synthetic call" }];
  assert.equal(timeReviewSaveEvidence(date, sources, rows, f.seams).status, "saved");
  const claim = reviewDateClaim(date, "test:act", f.seams);
  const blocks = [flaggedBlock(1), flaggedBlock(2), flaggedBlock(3), flaggedBlock(4, { matter_basis: "evidence_names_matter" })];
  assert.equal(timeReviewStageDay(date, claim.token, blocks, f.seams).status, "staged");
  return claim.token;
}

const states = (f, date = DAY) => Object.fromEntries(timeReviewReadDay(date, f.seams).blocks.map((b) => [b.id, b.state]));
const block = (f, id) => timeReviewReadDay(id.slice(0, 10), f.seams).blocks.find((b) => b.id === id);

async function poster(f) {
  const served = await serveReviewPage(undefined, f.env);
  return (body) => fetch(`${served.url}click`, { method: "POST", body: JSON.stringify(body) });
}

test("Approve saves the act, who and when to the block and the page shows it", async (t) => {
  const f = await device(t);
  stage(f);
  const post = await poster(f);
  assert.equal((await post({ act: "approve", block: `${DAY}:001` })).status, 200);
  const saved = block(f, `${DAY}:001`);
  assert.equal(saved.state, "approved");
  assert.equal(saved.review.act, "approved");
  assert.equal(saved.review.by, "practitioner");
  assert.match(saved.review.at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(saved.timecamp.status, "pending");
  assert.match(renderReviewPage(loadReviewModel(f.seams), null), /Approved by practitioner at /);
});

test("Correct saves the new matter, description and times, keeps what they were, and shows both", async (t) => {
  const f = await device(t);
  stage(f);
  const post = await poster(f);
  const res = await post({ act: "correct", block: `${DAY}:002`, matter: "Synthetic Matter B", description: "Reviewed <b>synthetic</b> letter", start: "02:05", end: "02:40" });
  assert.equal(res.status, 200);
  const saved = block(f, `${DAY}:002`);
  assert.equal(saved.state, "corrected");
  assert.equal(saved.matter, "Synthetic Matter B");
  assert.equal(saved.description, "Reviewed <b>synthetic</b> letter");
  assert.equal(saved.start, "02:05");
  assert.equal(saved.end, "02:40");
  assert.deepEqual(saved.review.before, { matter: "Synthetic Matter A", description: "Synthetic work 2", start: "02:00", end: "02:30" });
  const page = renderReviewPage(loadReviewModel(f.seams), null);
  assert.match(page, /Corrected by practitioner at /);
  assert.match(page, /Was: Synthetic Matter A, 02:00 to 02:30, Synthetic work 2/);
  assert.ok(!page.includes("<b>synthetic</b>"));
  // A second correction still remembers the version the AI staged.
  await post({ act: "correct", block: `${DAY}:002`, matter: "Synthetic Matter B", description: "Again", start: "02:05", end: "02:40" });
  assert.equal(block(f, `${DAY}:002`).review.before.description, "Synthetic work 2");
});

test("Write off saves the reason and has no TimeCamp write", async (t) => {
  const f = await device(t);
  stage(f);
  const post = await poster(f);
  assert.equal((await post({ act: "write_off", block: `${DAY}:003`, reason: "   " })).status, 400);
  assert.equal(block(f, `${DAY}:003`).state, "flagged");
  assert.equal((await post({ act: "write_off", block: `${DAY}:003`, reason: "Synthetic goodwill" })).status, 200);
  const saved = block(f, `${DAY}:003`);
  assert.equal(saved.state, "written_off");
  assert.equal(saved.review.reason, "Synthetic goodwill");
  assert.equal(saved.timecamp, undefined);
  assert.match(renderReviewPage(loadReviewModel(f.seams), null), /Written off by practitioner at .* Reason: Synthetic goodwill/);
  assert.throws(() => timeReviewRecordTimecamp(`${DAY}:003`, "saved", undefined, f.seams), /no approval or correction/);
});

test("a refused click writes nothing and the session is not told of it", async (t) => {
  const f = await device(t);
  stage(f);
  const post = await poster(f);
  assert.equal((await post({ act: "approve" })).status, 400);
  assert.equal((await post({ act: "approve", block: `${DAY}:099` })).status, 400);
  assert.equal((await post({ act: "correct", block: `${DAY}:001`, matter: "Synthetic Matter B", description: "", start: "01:00", end: "01:30" })).status, 400);
  assert.deepEqual(Object.values(states(f)), ["flagged", "flagged", "flagged", "auto_assigned"]);
  assert.equal(block(f, `${DAY}:001`).review, undefined);
  assert.equal((await waitClick({ ...f.env, COCLERK_TIME_REVIEW_WAIT_MS: "50" })).status, "pending");
});

test("the waiting session is told which act was clicked on which block", async (t) => {
  const f = await device(t);
  stage(f);
  const post = await poster(f);
  await post({ act: "approve", block: `${DAY}:004` });
  const clicked = await waitClick({ ...f.env, COCLERK_TIME_REVIEW_WAIT_MS: "2000" });
  assert.deepEqual([clicked.status, clicked.act, clicked.block], ["clicked", "approve", `${DAY}:004`]);
});

test("an approval comes only from a click: no tool takes a state, and stage_day cannot pass one", async (t) => {
  const f = await device(t);
  const token = stage(f);
  assert.throws(() => timeReviewStageDay(DAY, token, [flaggedBlock(1, { state: "approved" })], f.seams), /code sets flags and state/);
  assert.throws(() => timeReviewStageDay(DAY, token, [flaggedBlock(1, { review: { act: "approved" } })], f.seams), /not a block field/);
  // Reporting a TimeCamp result on a block no click has approved is refused, and changes nothing.
  assert.throws(() => timeReviewRecordTimecamp(`${DAY}:001`, "saved", undefined, f.seams), /no approval or correction/);
  assert.equal(block(f, `${DAY}:001`).state, "flagged");
});

test("approving one block leaves another flagged", async (t) => {
  const f = await device(t);
  stage(f);
  const post = await poster(f);
  await post({ act: "approve", block: `${DAY}:001` });
  assert.deepEqual(states(f), { [`${DAY}:001`]: "approved", [`${DAY}:002`]: "flagged", [`${DAY}:003`]: "flagged", [`${DAY}:004`]: "auto_assigned" });
});

test("a day with one flagged block is not clear, and is clear once judged with none flagged", async (t) => {
  const f = await device(t);
  const token = stage(f);
  const post = await poster(f);
  // Not judged: not clear, even with every flagged block handled.
  await post({ act: "approve", block: `${DAY}:001` });
  await post({ act: "correct", block: `${DAY}:002`, matter: "Synthetic Matter B", description: "Fixed", start: "02:00", end: "02:30" });
  assert.equal(timeReviewReadDay(DAY, f.seams).clear, false);
  assert.equal(reviewDateJudge(DAY, token, f.seams).status, "judged");
  // Judged, one flagged block left: not clear.
  assert.equal(timeReviewReadDay(DAY, f.seams).clear, false);
  assert.equal(loadReviewModel(f.seams).clear[DAY], false);
  // Another day's blocks do not count for this one.
  stage(f, OTHER);
  await post({ act: "write_off", block: `${DAY}:003`, reason: "Synthetic" });
  assert.equal(timeReviewReadDay(DAY, f.seams).clear, true);
  assert.equal(loadReviewModel(f.seams).clear[DAY], true);
  assert.equal(timeReviewReadDay(OTHER, f.seams).clear, false);
  assert.match(renderReviewPage(loadReviewModel(f.seams), null), /id="review-clear">\{"2030-02-04":true,"2030-02-05":false\}/);
});

test("the TimeCamp result shows on the card: saved, unchanged, left alone, and a failed read-back", async (t) => {
  const f = await device(t);
  stage(f);
  const post = await poster(f);
  for (const n of ["001", "002", "003"]) await post({ act: "approve", block: `${DAY}:${n}` });
  const lineOf = (id) => {
    const page = renderReviewPage(loadReviewModel(f.seams), null);
    const card = page.slice(page.indexOf(`data-id="${id}"`));
    return /<p class="tc-text ([^"]*)">([^<]*)<\/p>/.exec(card).slice(1, 3);
  };
  assert.deepEqual(lineOf(`${DAY}:001`), ["", "Waiting for the session to write this to TimeCamp."]);
  timeReviewRecordTimecamp(`${DAY}:001`, "saved", undefined, f.seams);
  assert.deepEqual(lineOf(`${DAY}:001`), ["tc-saved", "Saved to TimeCamp."]);
  timeReviewRecordTimecamp(`${DAY}:002`, "staff_left_alone", undefined, f.seams);
  assert.match(lineOf(`${DAY}:002`)[1], /left as the staff member wrote it/);
  assert.throws(() => timeReviewRecordTimecamp(`${DAY}:003`, "error", "  ", f.seams), /needs the message/);
  timeReviewRecordTimecamp(`${DAY}:003`, "error", "Read-back showed a different note: <script>", f.seams);
  const [cls, text] = lineOf(`${DAY}:003`);
  assert.equal(cls, "tc-error");
  assert.match(text, /^TimeCamp error: Read-back showed a different note: &lt;script&gt;$/);
  assert.equal(block(f, `${DAY}:003`).state, "approved");
  // The page asks for the same lines again while it is open.
  const served = await serveReviewPage(undefined, f.env);
  const live = await (await fetch(`${served.url}state`)).json();
  assert.equal(live.blocks[`${DAY}:001`].timecamp_text, "Saved to TimeCamp.");
  assert.equal(live.blocks[`${DAY}:003`].timecamp_class, "tc-error");
  assert.equal(live.clear[DAY], false);
});

test("the page carries the three buttons on every card and no form that could submit", async (t) => {
  const f = await device(t);
  stage(f);
  const page = renderReviewPage(loadReviewModel(f.seams), null);
  assert.equal((page.match(/class="act-approve"/g) ?? []).length, 4);
  assert.equal((page.match(/class="act-correct-open"/g) ?? []).length, 4);
  assert.equal((page.match(/class="act-writeoff-open"/g) ?? []).length, 4);
  assert.ok(!/<form/i.test(page));
});
