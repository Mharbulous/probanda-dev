// The time review page (build plan slice 7): the page built from a fixture day, its navigation, and
// the listener that serves it. Every fixture is synthetic: no real matter, client or date of work.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const { reviewDateClaim } = await import("../build/time-pipeline/review-date.js");
const { timePipelineSet } = await import("../build/time-pipeline/backend.js");
const { timeReviewSaveEvidence, timeReviewStageDay } = await import("../build/time-review/tools.js");
const { GATE_SOURCES } = await import("../build/time-review/sources.js");
const { loadReviewModel, renderReviewPage } = await import("../build/time-review/page.js");
const { closeReviewPages, serveReviewPage, waitClick } = await import("../build/time-review/server.js");
const { default: REVIEW_JS } = await import("../build/time-review/templates/review.js.js");

const HERE = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = join(HERE, "fixtures", "time-review-page.snapshot.html");
const DAY1 = "2030-01-02";
const DAY2 = "2030-01-03";
const CAPTURE = "cap-0001";

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

/** A scratch device: a config file naming a case data root and a free page port. */
async function device(t) {
  const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), "coclerk-review-page-")));
  const root = join(scratch, "0. CASE DATA");
  mkdirSync(root, { recursive: true });
  const config = join(scratch, "probanda.json");
  writeFileSync(config, JSON.stringify({ case_data_root: root, page_ports: { timekeeping: await freePort() } }));
  const env = { ...process.env, COCLERK_CONFIG_PATH: config };
  t.after(async () => {
    await closeReviewPages();
    rmSync(scratch, { recursive: true, force: true });
  });
  return { env, seams: { env }, scratch };
}

const sources = GATE_SOURCES.map((source) => ({ source, status: "fetched" }));
const rows1 = [
  { source: "gcal_events", id: "e1", summary: "Synthetic call with <b>Mr Example</b>", start: "09:00" },
  { source: "syncopaid_captures", id: "2030-01-02T09:05:00Z", capture_id: CAPTURE, window_title: "Synthetic window" },
];

function block(overrides = {}) {
  return {
    start: "09:00",
    end: "09:30",
    matter: "Synthetic Matter A",
    description: "Synthetic work",
    matter_basis: "evidence_names_matter",
    bill_basis: [],
    evidence: [{ source: "gcal_events", ref: "e1" }],
    ...overrides,
  };
}

function stageDay(f, date, rows, blocks) {
  assert.equal(timeReviewSaveEvidence(date, sources, rows, f.seams).status, "saved");
  const claim = reviewDateClaim(date, "test:page", f.seams);
  assert.equal(claim.status, "claimed");
  assert.equal(timeReviewStageDay(date, claim.token, blocks, f.seams).status, "staged");
}

/** Two days, three matters-worth of blocks: flagged and unflagged on both matters. */
function fixtureDays(f) {
  stageDay(f, DAY1, rows1, [
    block(),
    block({
      start: "09:30",
      end: "10:15",
      matter: "Synthetic Matter B",
      description: "Inferred <script>alert(1)</script> work",
      matter_basis: "indirect_only",
      bill_basis: ["description_inferred"],
      evidence: [
        { source: "syncopaid_captures", ref: "2030-01-02T09:05:00Z" },
        { source: "gcal_events", ref: "e9" },
      ],
    }),
    block({ start: "10:15", end: "11:00", matter: "Synthetic Matter A", description: "More work", matter_basis: "no_evidence", bill_basis: ["no_evidence"], evidence: [] }),
  ]);
  stageDay(f, DAY2, [{ source: "gcal_events", id: "e2", summary: "Another synthetic call" }], [block({ start: "13:00", end: "13:30", matter: "Synthetic Matter B", matter_basis: "no_evidence", bill_basis: [], evidence: [] }), block({ start: "14:00", end: "14:10", matter: "Synthetic Matter A", matter_basis: "presumption", evidence: [{ source: "gcal_events", ref: "e2" }] })]);
  const reading = { kind: "capture_reading", capture_id: CAPTURE, read_at: "2030-01-02T18:00:00.000Z", reading: { on_screen: "A synthetic letter draft", identifiers: [], unchanged: false, unreadable: false }, answers: [{ asked: "Which file?", answer: "A synthetic file" }] };
  timePipelineSet("item", `capture_reading:${CAPTURE}`, JSON.stringify(reading), { expect_absent: true }, f.env);
}

test("the page built from a fixture day matches the stored snapshot", async (t) => {
  const f = await device(t);
  fixtureDays(f);
  const page = renderReviewPage(loadReviewModel(f.seams), "/t/ID/img/");
  if (process.env.UPDATE_SNAPSHOT === "1" || !existsSync(SNAPSHOT)) {
    mkdirSync(dirname(SNAPSHOT), { recursive: true });
    writeFileSync(SNAPSHOT, page);
  }
  assert.equal(page, readFileSync(SNAPSHOT, "utf-8"));
  // Text from the store never reaches the page as markup.
  assert.ok(!page.includes("<script>alert"));
  assert.ok(!page.includes("<b>Mr Example"));
  assert.match(page, /Synthetic letter draft|synthetic letter draft/);
  assert.match(page, /A synthetic file/);
  assert.match(page, /\/t\/ID\/img\/cap-0001/);
});

test("the page is the same text every time it is built from the same store", async (t) => {
  const f = await device(t);
  fixtureDays(f);
  assert.equal(renderReviewPage(loadReviewModel(f.seams), null), renderReviewPage(loadReviewModel(f.seams), null));
  assert.ok(!renderReviewPage(loadReviewModel(f.seams), null).includes("<img"));
});

// The script is loaded as a function body so a test can call the pure navigation it defines.
const nav = new Function(`${REVIEW_JS}\nreturn { nextId, firstOnDate };`)();

const items = [
  { id: "1", date: DAY1, matter: "A", flagged: false },
  { id: "2", date: DAY1, matter: "B", flagged: true },
  { id: "3", date: DAY1, matter: "A", flagged: true },
  { id: "4", date: DAY2, matter: "B", flagged: true },
  { id: "5", date: DAY2, matter: "A", flagged: false },
];

test("Next flagged goes to the next flagged block across all matters", () => {
  assert.equal(nav.nextId(items, "1", "", true, 1), "2");
  assert.equal(nav.nextId(items, "2", "", true, 1), "3");
  assert.equal(nav.nextId(items, "4", "", true, 1), null);
});

test("Next flagged honours the matter filter", () => {
  assert.equal(nav.nextId(items, "1", "A", true, 1), "3");
  assert.equal(nav.nextId(items, "3", "A", true, 1), null);
  assert.equal(nav.nextId(items, "1", "B", true, 1), "2");
  assert.equal(nav.nextId(items, "2", "B", true, 1), "4");
  // The block on screen need not belong to the filtered matter.
  assert.equal(nav.nextId(items, "2", "A", true, 1), "3");
});

test("Previous and Next step through blocks in order within the filter", () => {
  assert.equal(nav.nextId(items, "3", "", false, -1), "2");
  assert.equal(nav.nextId(items, "5", "A", false, -1), "3");
  assert.equal(nav.nextId(items, "1", "", false, -1), null);
  assert.equal(nav.nextId(items, "3", "A", false, 1), "5");
  assert.equal(nav.nextId(items, "5", "", false, 1), null);
  assert.equal(nav.nextId(items, null, "B", false, 1), "2");
});

test("the date picker lands on the day's first block that passes the filter", () => {
  assert.equal(nav.firstOnDate(items, DAY2, ""), "4");
  assert.equal(nav.firstOnDate(items, DAY2, "A"), "5");
  assert.equal(nav.firstOnDate(items, "2031-01-01", ""), null);
});

test("the template is the same script the page carries, and the page has the controls", async (t) => {
  const f = await device(t);
  fixtureDays(f);
  const page = renderReviewPage(loadReviewModel(f.seams), null);
  assert.ok(page.includes(REVIEW_JS));
  for (const id of ["date-picker", "matter-filter", "prev", "next", "next-flagged"]) assert.ok(page.includes(`id="${id}"`), id);
  // Slice 8 adds Approve, Correct and Write off; Split and Merge wait for slice 9.
  for (const label of ["Approve", "Correct", "Write off"]) assert.ok(page.replace(REVIEW_JS, "").includes(`>${label}</button>`), label);
  assert.ok(!/Split|Merge/.test(page.replace(REVIEW_JS, "")));
});

test("building the page calls no model and reads no file", () => {
  const source = readFileSync(join(HERE, "..", "build", "time-review", "page.js"), "utf-8");
  const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(imports.length > 0);
  for (const name of imports) {
    assert.ok(!/^node:(fs|child_process|net|http|https)|anthropic|openai|fetch/i.test(name), `page.js imports ${name}`);
  }
  assert.ok(!/\bfetch\(|readFileSync|createReadStream|spawn|execSync|execFile/.test(source));
});

test("the listener serves the page, a screenshot on request and a click, and refuses what it must", async (t) => {
  const f = await device(t);
  fixtureDays(f);
  const screens = join(f.scratch, "syncopaid-screens");
  mkdirSync(screens);
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  writeFileSync(join(screens, `${CAPTURE}.png`), png);
  writeFileSync(join(f.scratch, "secret.png"), "secret");

  await assert.rejects(serveReviewPage(join(f.scratch, "elsewhere"), f.env), /syncopaid-screens/);
  const served = await serveReviewPage(screens, f.env);
  assert.equal(served.screenshots, true);
  assert.equal(served.blocks, 5);
  assert.match(served.url, /^http:\/\/127\.0\.0\.1:\d+\/t\/[A-Za-z0-9_-]{32}\/$/);

  const page = await fetch(served.url);
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-security-policy"), /default-src 'none'/);
  const body = await page.text();
  assert.ok(body.includes(`img/${CAPTURE}`));

  const image = await fetch(`${served.url}img/${CAPTURE}`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  assert.equal((await fetch(`${served.url}img/..%2Fsecret`)).status, 404);
  assert.equal((await fetch(`${served.url}img/secret`)).status, 404);
  assert.equal((await fetch(`${served.url}img/missing-cap`)).status, 404);

  // A click is saved, read once, and gone.
  const post = (body) => fetch(`${served.url}click`, { method: "POST", body: JSON.stringify(body) });
  assert.equal((await post({ act: "ping", block: `${DAY1}:001` })).status, 200);
  assert.equal((await post({ act: "Bad Act" })).status, 400);
  assert.equal((await post({ act: "ping", block: "nope" })).status, 400);
  const clicked = await waitClick({ ...f.env, COCLERK_TIME_REVIEW_WAIT_MS: "2000" });
  assert.equal(clicked.status, "clicked");
  assert.equal(clicked.act, "ping");
  assert.equal(clicked.block, `${DAY1}:001`);
  const again = await waitClick({ ...f.env, COCLERK_TIME_REVIEW_WAIT_MS: "50" });
  assert.equal(again.status, "pending");

  // Serving again drops the old link and any unread click.
  assert.equal((await post({ act: "stale_one" })).status, 200);
  const second = await serveReviewPage(undefined, f.env);
  assert.equal(second.screenshots, false);
  assert.equal((await fetch(served.url)).status, 410);
  assert.equal((await waitClick({ ...f.env, COCLERK_TIME_REVIEW_WAIT_MS: "50" })).status, "pending");
  assert.ok(!(await (await fetch(second.url)).text()).includes("<img"));
  assert.equal((await fetch(`${second.url}img/${CAPTURE}`)).status, 404);
});
