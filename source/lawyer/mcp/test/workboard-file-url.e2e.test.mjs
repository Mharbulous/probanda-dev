// The Work Board opened the way the practitioner opens it: double-clicked in Explorer, a file://
// load with no server behind it (docs/design/2026-09-14 work-board-local-only-design.md). The page
// is the filing's own Work Board page in its Writing's folder in 0. DRAFT (ADR 0033, 2026-10-05
// amendment; spec 2026-10-22), opened where the render wrote it; the Litigation Strategy is opened as a lone copy, so a page that still needed a sibling
// file would fail here. Drives
// an installed Chrome or Edge over the DevTools Protocol with Node's built-in WebSocket -- no
// browser-automation package, per the repo's no-external-packages rule. A machine with neither
// browser skips visibly, naming the paths it looked in.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import test, { after } from "node:test";

const { moveSeeds } = await import("./helpers/threads.mjs");
const { freshSubmissionDb } = await import("./helpers/template-db.mjs");
const { submissionDataExecute } = await import("../build/submission/backend.js");
const { submissionFormsBootstrap, submissionFormsRender } = await import("../build/submission/forms.js");
const { renderWorkBoardHtml } = await import("../build/submission/forms/workboard-shell.js");
const { submissionFormsBoardCard } = await import("../build/submission/matter-pages.js");
const { STATUS_FILE } = await import("../build/submission/render-job.js");
const { writeStatusFile } = await import("../build/status-file.js");
const { CLIENT, seedFilings, startChild } = await import("./fixtures/render-job-helpers.mjs");
const { sectionOf } = await import("./fixtures/forms-render-seeds.mjs");

// The background render job's locks and status mirrors (#589) stay out of the practitioner's %LOCALAPPDATA%.
process.env.COCLERK_SUBMISSION_LOCK_ROOT = mkdtempSync(join(tmpdir(), "coclerk-workboard-file-url-locks-"));
after(() => rmSync(process.env.COCLERK_SUBMISSION_LOCK_ROOT, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

const CANDIDATES = [
  ["Chrome", process.env.CHROME_PATH],
  ["Chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"],
  ["Chrome", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"],
  ["Chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
  ["Chrome", "/usr/bin/google-chrome"],
  ["Edge", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"],
  ["Edge", "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"],
  ["Edge", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
];
const BROWSERS = [...new Map(CANDIDATES.filter(([, path]) => path && existsSync(path)).reverse()).entries()].reverse();

// The column each category draws into.
const SECTION_OF = { ready: "ready", wip: "in-progress", waiting: "waiting-on", superseded: "superseded", completed: "completed", rejected: "rejected-angles" };

// The golden board data: the one fixture carrying Proposals in all three lanes.
const FIXTURE_BOARD = JSON.parse(readFileSync(new URL("./fixtures/work-board-data.json", import.meta.url), "utf-8"));

/** One filing's board data as its Work Board page holds it: the page's own meta, one section. */
const pageOf = (section) => ({
  meta: { revision: section.meta.revision, matter: section.meta.matter, client: section.meta.client, rendered: section.meta.rendered },
  sections: [section],
});

async function renderSeededBoard(dir) {
  mkdirSync(join(dir, "L7001 Ashgrove", "0. CASE DATA"), { recursive: true });
  const dbPath = join(dir, "L7001 Ashgrove", "0. CASE DATA", "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(
    dbPath,
    `
    INSERT INTO proceedings (id, matter_reference, forum, file_number, style_of_cause) VALUES (1, 'L7001 - Ashgrove', 'CAN/BC/BCSC', 'S-770011', 'Ashgrove Holdings v. Larch');
    INSERT INTO filings (id, proceeding_id, kind, subkind, round, title) VALUES (1, 1, 'notice_of_application', NULL, NULL, 'Notice of Application');
    INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created, completed_at)
      VALUES (1, 1, 1, 'Collect the lease', 'Get the signed lease into the file.', 'completed', 3, 'work', 'L7001|lease terms', '2026-09-01T09:00', '2026-09-01T10:00');
    INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
      VALUES (2, 1, 1, 'Draft the orders sought', 'Write Part 1 from the lease terms.', 'queued', 2, 'work', 'L7001|lease terms', '2026-09-01T09:05');
    INSERT INTO ticket_blocks (blocker_id, blocked_id) VALUES (1, 2);
    INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, locked_by, locked_at, plan_approved_at, created)
      VALUES (3, 1, 1, 'Swear the affidavit', 'Settle and swear the supporting affidavit.', 'wip', 1, 'work', 'L7001|lease terms', 'sess-b2', '2026-09-02T11:00', '2026-09-02T10:55', '2026-09-01T09:10');
    INSERT INTO ticket_steps (ticket_id, ordinal, text, done_at) VALUES (3, 1, 'Settle the draft', '2026-09-02T11:30');
    INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (3, 2, 'Book the commissioner');
    INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, created)
      VALUES (4, 1, 1, 'Cite-check the orders', 'Check every rule cited in Part 1.', 'queued', 0, 'work', 'L7001|lease terms', '2026-09-01T09:15');
    INSERT INTO ticket_blocks (blocker_id, blocked_id) VALUES (2, 4);
    INSERT INTO seeds (id, proceeding_id, filing_id, origin_ticket_id, created, surfaced_by, idea)
      VALUES (1, 1, 1, 3, '2026-09-02T11:40', 'noticed while settling the draft', 'Ask whether the guarantor should be served too.');
    `.trim()
  );
  await moveSeeds(dbPath);
  const draft = join(dir, "L7001 Ashgrove", "0. DRAFT");
  mkdirSync(draft, { recursive: true });
  const result = submissionFormsRender(dbPath, 1, { clientName: "Ashgrove Holdings", clientNo: "7001", matterNo: "L7001" }, "mockup", undefined, undefined, undefined, undefined, undefined, draft);
  const board = result.documents.find((doc) => doc.document_type === "Work_board");
  return { path: board.path, data: sectionOf(draft, 1), dbPath };
}

// The Litigation Strategy (#585, #871): two live filings, one retired, a ticket title that would close a
// script, and two to-dos, one pointing at filing 2.
const TODOS = {
  rows: [
    { id: "t-undated", description: "Report to the client", bf_date: null, filing_ref: null },
    { id: "t-pointed", description: "Settle the response </script><b>now</b>", bf_date: "2026-09-01", filing_ref: "filing:2" },
  ],
};

async function writeSeededMatterBoard(dir) {
  mkdirSync(join(dir, "L7001 Ashgrove", "0. CASE DATA"), { recursive: true });
  const dbPath = join(dir, "L7001 Ashgrove", "0. CASE DATA", "submission.sqlite");
  await freshSubmissionDb(dbPath);
  await submissionDataExecute(
    dbPath,
    `
    INSERT INTO proceedings (id, matter_reference, forum, file_number) VALUES (1, 'L7001 - Ashgrove', 'CAN/BC/BCSC', 'S-770011');
    INSERT INTO filings (id, proceeding_id, kind, subkind, round, title, retired_on, retirement_reason)
      VALUES (1, 1, 'notice_of_application', NULL, NULL, 'Notice of Application', NULL, NULL),
             (2, 1, 'application_response', NULL, NULL, 'Application Response', NULL, NULL),
             (3, 1, 'notice_of_application', NULL, NULL, 'Earlier Notice of Application', '2026-08-01', 'abandoned');
    INSERT INTO tickets (id, proceeding_id, filing_id, title, intent, status, priority, kind, billing_anchor, locked_by, locked_at, created)
      VALUES (1, 1, 1, 'Draft the orders </script><b>sought</b>', 'Part 1.', 'queued', 0, 'work', 'L7001', NULL, NULL, '2026-09-01T09:00'),
             (2, 1, 2, 'Settle the response', 'Settle it.', 'wip', 0, 'work', 'L7001', 'sess-b2', strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'), '2026-09-02T10:00');
    INSERT INTO seeds (id, proceeding_id, filing_id, created, surfaced_by, idea) VALUES (1, 1, NULL, '2026-09-02T11:40', 'noticed', 'Serve the guarantor too?');
    `.trim()
  );
  await moveSeeds(dbPath);
  const draft = join(dir, "L7001 Ashgrove", "0. DRAFT");
  mkdirSync(draft, { recursive: true });
  return submissionFormsBootstrap(dbPath, { clientName: "Ashgrove Holdings", clientNo: "7001", matterNo: "L7001" }, undefined, draft, TODOS).matter_board_path;
}

async function waitForDevToolsPort(profile, child) {
  const portFile = join(profile, "DevToolsActivePort");
  for (let waited = 0; waited < 30000; waited += 100) {
    if (child.exitCode !== null) throw new Error(`browser exited with code ${child.exitCode} before opening its debugging port`);
    if (existsSync(portFile)) {
      try {
        const port = readFileSync(portFile, "utf-8").split("\n")[0].trim();
        if (port !== "") return port;
      } catch (err) {
        // The browser can still hold the file open while it writes it (seen on the CI runner, #701).
        if (err.code !== "EBUSY") throw err;
      }
    }
    await sleep(100);
  }
  throw new Error("browser never wrote DevToolsActivePort");
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    const listeners = [];
    let nextId = 0;
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id === undefined) {
        for (const listener of listeners) listener(msg);
        return;
      }
      const call = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) call.reject(new Error(`${call.method}: ${msg.error.message}`));
      else call.resolve(msg.result);
    });
    ws.addEventListener("error", () => reject(new Error(`could not open the DevTools socket at ${url}`)));
    ws.addEventListener("open", () =>
      resolve({
        send(method, params = {}) {
          const id = ++nextId;
          ws.send(JSON.stringify({ id, method, params }));
          return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej, method }));
        },
        on(listener) {
          listeners.push(listener);
        },
        close() {
          ws.close();
        },
      })
    );
  });
}

async function withBrowser(executable, fn) {
  const profile = mkdtempSync(join(tmpdir(), "coclerk-workboard-browser-"));
  const child = spawn(
    executable,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "about:blank",
    ],
    { stdio: "ignore" }
  );
  try {
    const port = await waitForDevToolsPort(profile, child);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((target) => target.type === "page");
    assert.ok(page, "expected the browser to open one page target");
    const cdp = await connect(page.webSocketDebuggerUrl);
    try {
      return await fn(cdp);
    } finally {
      cdp.close();
    }
  } finally {
    if (child.exitCode === null) {
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill();
      await exited;
    }
    rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

/** Collects what a clean page must not produce, keeping apart the one failure a lone Litigation Strategy is
 * expected to log: its live-status sibling, workboard-status.js, is not there (#589). */
function watchPage(cdp) {
  const seen = { problems: [], statusErrors: [], statusRequests: 0 };
  cdp.on((msg) => {
    if (msg.method === "Runtime.exceptionThrown") {
      const details = msg.params.exceptionDetails;
      seen.problems.push(`exception: ${details.exception?.description ?? details.text}`);
    }
    if (msg.method === "Runtime.consoleAPICalled" && (msg.params.type === "error" || msg.params.type === "assert")) {
      seen.problems.push(`console.${msg.params.type}: ${msg.params.args.map((arg) => arg.value ?? arg.description).join(" ")}`);
    }
    if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
      if ((msg.params.entry.url ?? "").includes(STATUS_FILE)) seen.statusErrors.push(msg.params.entry.text);
      else seen.problems.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ""}`);
    }
    if (msg.method === "Network.requestWillBeSent") {
      if (!/^(file|data):/.test(msg.params.request.url)) seen.problems.push(`network: ${msg.params.request.url}`);
      if (msg.params.request.url.includes(STATUS_FILE)) seen.statusRequests++;
    }
  });
  return seen;
}

async function openFile(cdp, file) {
  for (const domain of ["Runtime", "Log", "Network", "Page"]) await cdp.send(`${domain}.enable`);
  const loaded = new Promise((resolve) => cdp.on((msg) => msg.method === "Page.loadEventFired" && resolve()));
  await cdp.send("Page.navigate", { url: pathToFileURL(file).href });
  await loaded;
}

async function evaluate(cdp, expression) {
  const { result } = await cdp.send("Runtime.evaluate", { returnByValue: true, expression: `JSON.stringify(${expression})` });
  return JSON.parse(result.value);
}

/** Polls the page every 100 ms; resolves with the elapsed ms once `expression` is truthy. */
async function waitForPage(cdp, expression, what, timeoutMs) {
  const started = Date.now();
  while (!(await evaluate(cdp, expression))) {
    if (Date.now() - started > timeoutMs) throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await sleep(100);
  }
  return Date.now() - started;
}

const JOB = `(() => { const job = document.querySelector("header .job"); return { hidden: job.hidden, stalled: job.classList.contains("stalled"), spinner: !!job.querySelector(".spinner"), text: job.textContent }; })()`;
const MOCKUPS = `Object.fromEntries([...document.querySelectorAll("article.filing")].map((a) => [a.dataset.filingId, a.querySelector(".mockups")?.textContent ?? null]))`;

/** Records, in the page's own clock, when the job indicator first matches `test` -- so a timing bound
 * measures the page, not how long a DevTools round trip takes on a loaded machine. */
const recordWhen = (name, test) =>
  `(() => { const job = document.querySelector("header .job"); const check = () => { if (window.${name} === null && (${test})) window.${name} = Date.now(); }; window.${name} = null; check(); new MutationObserver(check).observe(job, { attributes: true, childList: true }); return true; })()`;

const statusScript = (status) => `window.WORKBOARD_STATUS = ${JSON.stringify(status)};\n`;
const readStatusScript = (file) => JSON.parse(readFileSync(file, "utf-8").replace(/^window\.WORKBOARD_STATUS = /, "").replace(/;\n$/, ""));

// Goal card design §4.7: the server sends the retirement text finished, so the shell composes none.
test("the Work Board's shell composes no retirement text of its own", () => {
  const source = readFileSync(new URL("../src/templates/milestone/milestone.js", import.meta.url), "utf-8");
  assert.equal(source.includes("retirement of this Writing"), false);
});

// The statement of goals' card body: each child's class and text, and for the statement its rows,
// each row's indent and its cells.
const GOALS_BODY = `[...document.querySelectorAll("#goals .goals-body > *")].map((el) => el.classList.contains("statement")
  ? [el.className, el.textContent, [...el.querySelectorAll(".row")].map((r) => [r.style.marginLeft, [...r.children].map((c) => [c.className, c.textContent])])]
  : [el.className, el.textContent])`;
// A nested statement in the paralegal-posture syntax, with one line it does not recognise. The
// inferred form ends each goal with "?".
const CONFIRMED_STATEMENT = [
  "Goal 1: Obtain the order sought in the notice of application, with costs payable forthwith in any event of the cause.",
  "Goal 2, any one of:",
  "  Goal 2(a): Obtain an adjournment of the hearing to a date at least thirty days after the respondent's further affidavit is served.",
  "  or alternatively,",
  "  Goal 2(b), both of:",
  "    Goal 2(b)(i): Obtain leave to file a reply affidavit responding to the new evidence in the respondent's affidavit.",
  "    and",
  "    Goal 2(b)(ii): Obtain an order that the respondent pay the costs thrown away by the adjournment.",
  "  (see the attached note on timing)",
].join("\n");
const INFERRED_STATEMENT = CONFIRMED_STATEMENT.split("\n").map((l) => (/^ *Goal[^:]*: \S/.test(l) ? l.replace(/\.$/, "?") : l)).join("\n");
const statementRows = (inferred) => {
  const end = inferred ? "?" : ".";
  const connector = inferred ? "text" : "text connector";
  return [
    ["0em", [["label", "Goal 1:"], ["text", "Obtain the order sought in the notice of application, with costs payable forthwith in any event of the cause" + end]]],
    ["0em", [["label", "Goal 2, any one of:"], ["text", ""]]],
    ["1.5em", [["label", "Goal 2(a):"], ["text", "Obtain an adjournment of the hearing to a date at least thirty days after the respondent's further affidavit is served" + end]]],
    ["1.5em", [[connector, "or alternatively,"]]],
    ["1.5em", [["label", "Goal 2(b), both of:"], ["text", ""]]],
    ["3em", [["label", "Goal 2(b)(i):"], ["text", "Obtain leave to file a reply affidavit responding to the new evidence in the respondent's affidavit" + end]]],
    ["3em", [[connector, "and"]]],
    ["3em", [["label", "Goal 2(b)(ii):"], ["text", "Obtain an order that the respondent pay the costs thrown away by the adjournment" + end]]],
    ["1.5em", [["text", "  (see the attached note on timing)"]]],
  ];
};

if (BROWSERS.length === 0) {
  test("the Work Board and the Litigation Strategy open from disk in a browser", (t) => {
    t.skip(`no Chrome or Edge found; looked in: ${CANDIDATES.map(([, path]) => path).filter(Boolean).join("; ")} (or set CHROME_PATH)`);
  });
}

for (const [name, executable] of BROWSERS) {
  test(`the Work Board opens from disk in ${name} and draws every card`, { timeout: 120000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "coclerk-workboard-file-url-"));
    try {
      const { path: written, data, dbPath } = await renderSeededBoard(dir);

      await withBrowser(executable, async (cdp) => {
        const problems = [];
        cdp.on((msg) => {
          if (msg.method === "Runtime.exceptionThrown") {
            const details = msg.params.exceptionDetails;
            problems.push(`exception: ${details.exception?.description ?? details.text}`);
          }
          if (msg.method === "Runtime.consoleAPICalled" && (msg.params.type === "error" || msg.params.type === "assert")) {
            problems.push(`console.${msg.params.type}: ${msg.params.args.map((arg) => arg.value ?? arg.description).join(" ")}`);
          }
          if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
            problems.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ""}`);
          }
          if (msg.method === "Network.requestWillBeSent" && !/^(file|data):/.test(msg.params.request.url)) {
            problems.push(`network: ${msg.params.request.url}`);
          }
        });
        for (const domain of ["Runtime", "Log", "Network", "Page"]) await cdp.send(`${domain}.enable`);
        // A wide window: the board must still be one vertical list (practitioner, 2026-09-15).
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1800, height: 1000, deviceScaleFactor: 1, mobile: false });
        const loaded = new Promise((resolve) => cdp.on((msg) => msg.method === "Page.loadEventFired" && resolve()));
        await cdp.send("Page.navigate", { url: pathToFileURL(written).href });
        await loaded;

        const { result } = await cdp.send("Runtime.evaluate", {
          returnByValue: true,
          expression: `JSON.stringify({
            title: document.title,
            heading: document.querySelector("header h1").textContent,
            writingTitle: (() => { const next = document.querySelector("header h1").nextElementSibling; return next && next.className === "writing-title" ? next.textContent : null; })(),
            sectionHeads: document.querySelectorAll("h2.section-head").length,
            proceeding: [...document.querySelector("header .meta.proceeding").childNodes].map((n) => n.nodeType === Node.TEXT_NODE ? n.textContent : [n.className, n.dataset.k ?? null, n.textContent]),
            refs: [...document.querySelectorAll("details.ticket .ref")].map((r) => [r.closest("details").id, r.textContent]),
            cards: [...document.querySelectorAll("details.ticket")].map((d) => [d.closest("section").id, d.id]),
            collapsed: [...document.querySelectorAll("details.ticket > summary")].map((s) => {
              const progress = s.querySelector(".progress");
              const after = progress.lastChild;
              return {
                ref: s.querySelector(".ref").textContent,
                title: s.querySelector(".title").textContent,
                subtitles: [...s.querySelectorAll(".subtitle")].map((x) => x.textContent),
                chip: progress.querySelector(".chip").textContent,
                count: after.nodeType === Node.TEXT_NODE ? after.textContent : "",
              };
            }),
            seeds: [...document.querySelectorAll("details.seed")].map((d) => d.id),
            ideas: document.querySelector("#ideas") !== null,
            state: document.querySelector("#goal .head > .sentence + .lifecycle")?.textContent ?? null,
            first: document.querySelector(".board").firstElementChild.id,
            second: document.querySelector(".board").firstElementChild.nextElementSibling.id,
            sentence: document.querySelector("#goal .sentence")?.textContent ?? null,
            doneSteps: document.querySelectorAll("ol.steps li.done").length,
            nextStep: document.querySelector("ol.steps li.next")?.textContent ?? null,
            stylesheetApplied: getComputedStyle(document.querySelector("header h1")).fontWeight,
            viewport: innerWidth,
            sectionLefts: [...new Set([...document.querySelectorAll(".board > section")].map((s) => Math.round(s.getBoundingClientRect().left)))],
            cardLefts: [...new Set([...document.querySelectorAll("details.ticket, details.seed")].map((d) => Math.round(d.getBoundingClientRect().left)))],
            sideBySide: [...document.querySelectorAll(".stack")].some((stack) => {
              const tops = [...stack.children].map((c) => Math.round(c.getBoundingClientRect().top));
              return new Set(tops).size !== tops.length;
            }),
          })`,
        });
        const page = JSON.parse(result.value);

        assert.deepEqual(problems, [], "expected no console error, uncaught exception, failed load or network request");
        assert.equal(page.title, "Work Board — L7001");
        assert.equal(page.heading, "Work Board 1", "the heading names the page's number");
        assert.equal(page.writingTitle, "Notice of Application", "the Writing's title on its own line under the heading");
        assert.equal(page.sectionHeads, 0, "no heading under the header: the page heading names the one section");
        assert.deepEqual(
          page.proceeding,
          [["", null, "BCSC"], " · ", ["", "Court File No.", "S-770011"], " · ", ["", null, "Ashgrove Holdings v. Larch"]],
          "the proceeding line: venue, file number and style of proceeding, a dot between each two, and no state chip on a page with a Goal card"
        );
        assert.deepEqual(page.refs.sort(), data.tickets.map((t) => [`ticket-${t.id}`, `Job #${t.id}`]).sort(), "each card is referred to as Job #N");
        assert.deepEqual(
          page.cards.sort(),
          data.tickets.map((t) => [SECTION_OF[t.category], `ticket-${t.id}`]).sort(),
          "expected one card per ticket, each in its category's column"
        );
        // The mirror: each job line the session reads starts with its card's collapsed text, on
        // board_card's live lane or, for a Completed or Shelved job, which the live lane only counts,
        // on its own board_card lane.
        const lines = submissionFormsBoardCard({ db_path: dbPath, filing_id: 1, lanes: ["live", "completed", "rejected"] }).card.split("\n");
        assert.equal(page.collapsed.length, data.tickets.length);
        for (const c of page.collapsed) {
          const text = [`${c.ref} ${c.title}`, ...c.subtitles, c.chip + (c.count ? ` ${c.count}` : "")].join(" · ");
          assert.ok(lines.some((line) => line.startsWith(`- ${text}`)), `no job line starts with "- ${text}":\n${lines.join("\n")}`);
        }
        assert.deepEqual(page.cards.find(([, id]) => id === "ticket-2"), ["ready", "ticket-2"]);
        assert.deepEqual(page.cards.find(([, id]) => id === "ticket-4"), ["waiting-on", "ticket-4"]);
        // Loose threads are the matter's, on its one Loose Threads page: the Work Board neither draws nor counts them.
        assert.deepEqual(page.seeds, []);
        assert.equal(page.ideas, false);
        assert.equal(page.state, "Drafting");
        assert.equal(page.first, "goals", "the statement of goals' card is the board's first block");
        assert.equal(page.second, "goal", "the Completion Criteria card follows it, above the first lane");
        assert.equal(page.sentence, data.goal.sentence);
        assert.equal(page.doneSteps, 1);
        assert.equal(page.nextStep, "Book the commissioner");
        assert.equal(page.stylesheetApplied, "600", "expected the inline stylesheet to apply");
        assert.equal(page.viewport, 1800, "expected the wide viewport to apply");
        assert.equal(page.sectionLefts.length, 1, `expected every section in one column, found lefts ${page.sectionLefts}`);
        assert.equal(page.cardLefts.length, 1, `expected every card in one column, found lefts ${page.cardLefts}`);
        assert.equal(page.sideBySide, false, "expected no two cards side by side");
      });
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });

  // Design §13: the Shelved lane, drawn from the golden board data -- the one fixture carrying
  // Proposals in all three server-assigned lanes. The page draws no Proposed lane.
  test(`the Work Board draws its Shelved lane in ${name}`, { timeout: 120000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "coclerk-workboard-proposals-"));
    try {
      const data = {
        ...FIXTURE_BOARD,
        // A card string of null, which the golden no longer carries (its type declares no criteria).
        goal: { ...FIXTURE_BOARD.goal, text: null },
      };
      const page = join(dir, "Work Board.html");
      writeFileSync(page, renderWorkBoardHtml(pageOf(data)), "utf-8");

      await withBrowser(executable, async (cdp) => {
        const seen = watchPage(cdp);
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 1000, deviceScaleFactor: 1, mobile: false });
        await openFile(cdp, page);

        const lane = (id) => `(() => {
          const sec = document.querySelector("#${id}");
          return {
            count: sec.querySelector("h2 .count").textContent,
            cue: sec.querySelector("p.cue")?.textContent ?? null,
            tickets: [...sec.querySelectorAll("details.ticket")].map((d) => d.id),
            cards: [...sec.querySelectorAll(".proposal")].map((c) => ({
              head: c.querySelector(".head")?.textContent ?? null,
              lines: [...c.querySelectorAll("li")].map((li) => ({
                text: li.querySelector(".line").textContent,
                title: li.title,
                status: li.querySelector(".status")?.textContent ?? null,
              })),
            })),
          };
        })()`;
        const board = await evaluate(cdp, `({
          sections: [...document.querySelectorAll(".board > section")].map((s) => s.id),
          blocks: [...document.querySelector(".board").children].filter((b) => b.id).map((b) => b.id),
          goalsHead: [...document.querySelectorAll("#goals .head > span")].map((s) => [s.className, s.textContent]),
          goalsBody: ${GOALS_BODY},
          goalAbove: document.querySelector("#goal").getBoundingClientRect().bottom <= document.querySelector(".board > section").getBoundingClientRect().top,
          goalHead: [...document.querySelectorAll("#goal .head > span")].map((s) => [s.className, s.textContent]),
          proceedingRow: document.querySelector("header .meta.proceeding") !== null,
          cues: [...document.querySelectorAll("p.cue")].map((p) => p.closest("section").id),
          controls: document.querySelectorAll("input, button, [onclick]").length,
          rejected: ${lane("rejected-angles")},
        })`);

        assert.deepEqual(seen.problems, [], "expected no console error, uncaught exception, failed load or network request");
        assert.deepEqual(
          board.sections,
          ["ready", "in-progress", "bring-forward", "waiting-on", "completed", "rejected-angles", "superseded"],
          "the seven lists, in order"
        );
        assert.equal(board.controls, 0, "no line carries a checkbox, a red X, a Go button or any other control");
        // Goal card design §2.9: the card sits above the first lane. The fixture's card string is
        // null, so the sentence is drawn alone, with no placeholder in its place.
        assert.deepEqual(
          board.blocks,
          ["goals", "goal", "ready", "in-progress", "bring-forward", "waiting-on", "completed", "rejected-angles", "superseded"],
          "the statement of goals' card first, then the Completion Criteria card, then the seven lists"
        );
        assert.deepEqual(board.goalsHead, [["sentence", FIXTURE_BOARD.goals.description], ["label", "Goal"]], "closed: the description, labelled Goal");
        assert.deepEqual(board.goalsBody, [["none", "No statement of goals yet"]], "the golden carries no statement");
        assert.equal(board.goalAbove, true, "the Goal card sits above the first lane");
        assert.deepEqual(board.goalHead, [["sentence", FIXTURE_BOARD.goal.sentence], ["lifecycle", "Drafting"]], "the sentence, then the Writing's state as a pill");
        assert.equal(board.proceedingRow, false, "a page with a Goal card and a blank proceeding draws no proceeding line");

        // Shelved holds the shelved ticket and the directly shelved Proposal.
        assert.deepEqual(board.rejected.tickets, ["ticket-13"]);
        assert.deepEqual(board.rejected.cards.map((c) => c.lines.map((l) => l.text)), [["Draft a submission for the order: a reserved fallback order 🦵"]]);
        assert.equal(board.rejected.count, "2", "the shelved ticket and the shelved Proposal both count as cards");

        // One fixed cue under Shelved and nowhere else.
        assert.deepEqual(board.cues, ["rejected-angles"]);
        const restoreCue = "To shelve or restore an item, tell a session. Restore on a deleted job copies the instruction for you to paste.";
        assert.equal(board.rejected.cue, restoreCue);

        // Design §13: legible at a 268px card width, where a long line truncates with an ellipsis.
        // The glyph must survive that truncation -- it is the marker whose work the lane exists to
        // propose, and a single truncating span would let the ellipsis eat it. Measured rather than
        // eyeballed: the text clips, and every glyph still occupies width.
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: 407, height: 1000, deviceScaleFactor: 1, mobile: false });
        const narrow = await evaluate(cdp, `(() => {
          const lines = [...document.querySelectorAll("#rejected-angles .proposal li")];
          return {
            cardWidth: Math.round(document.querySelector("#rejected-angles .proposal ul.lines").getBoundingClientRect().width),
            clipped: lines.filter((li) => li.querySelector(".text").scrollWidth > li.querySelector(".text").clientWidth + 1).length,
            glyphless: lines.filter((li) => li.querySelector(".glyph").getBoundingClientRect().width === 0).map((li) => li.title),
            overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            total: lines.length,
          };
        })()`);

        assert.equal(narrow.cardWidth, 268, "the measured card content width these assertions are about");
        assert.equal(narrow.overflowX, false, "the board is one vertical list with no horizontal scroll");
        assert.ok(narrow.clipped > 0, `expected some line to truncate at 268px, else this proves nothing (of ${narrow.total})`);
        assert.deepEqual(narrow.glyphless, [], "every Proposal line keeps its marker when its text truncates");
      });
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });

  // A confirmed statement: the same rows, the connectors set apart, no caption. Laid out as rows, so a
  // label never wraps and a wrapped line returns to its text cell's edge, not the card's margin.
  test(`the Work Board draws a confirmed statement of goals as rows in ${name}`, { timeout: 120000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "coclerk-workboard-goals-"));
    try {
      const data = { ...FIXTURE_BOARD, goals: { description: FIXTURE_BOARD.goals.description, statement: CONFIRMED_STATEMENT, status: "confirmed" } };
      const page = join(dir, "goals.html");
      writeFileSync(page, renderWorkBoardHtml(pageOf(data)), "utf-8");

      await withBrowser(executable, async (cdp) => {
        const seen = watchPage(cdp);
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 1000, deviceScaleFactor: 1, mobile: false });
        await openFile(cdp, page);
        const read = await evaluate(cdp, `(() => {
          document.querySelector("#goals").open = true;
          const row = document.querySelector("#goals .row");
          return {
            body: ${GOALS_BODY},
            rowDisplay: getComputedStyle(row).display,
            labelWrap: getComputedStyle(row.querySelector(".label")).whiteSpace,
          };
        })()`);
        assert.deepEqual(seen.problems, [], "expected no console error, uncaught exception, failed load or network request");
        assert.deepEqual(read.body, [["statement", read.body[0][1], statementRows(false)]], "a confirmed statement has no caption, and its connectors carry the connector class");
        assert.equal(read.rowDisplay, "flex", "each line is a row of cells");
        assert.equal(read.labelWrap, "nowrap", "a label never wraps");
      });
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });

  // Goal card plan Phase 5: the Goal card and the server-composed ticket strings, drawn as given.
  // Injected here rather than in the shared fixture: a card string, one criterion in each state, a
  // ticket carrying a subtitle, and a superseded ticket carrying a reason and no pointer.
  test(`the Work Board draws the Goal card and the server's ticket strings as given in ${name}`, { timeout: 120000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "coclerk-workboard-goal-"));
    try {
      const reason = "Superseded: its marker no longer shows (2026-09-20)";
      const subtitle = "1 of 2 items no longer show their marker";
      const goal = { sentence: "Opening Submissions Package — Notice of Application, Vancouver Registry S-770011", state: "unmet", text: "Only your review remains. Every other drafting condition holds." };
      const criteria = [
        { id: "excerpts", text: "Every authority relied on has its excerpt", state: "unmet", outstanding: 2, items: ["first point of law", "second point of law"], source: "inventory" },
        { id: "noting-up", text: "Every authority is noted up", state: "met", outstanding: 0, items: ["shelved by you: a reserved point"], source: "inventory" },
        { id: "gate", text: "The pre-filing checks pass or are waived", state: "met", outstanding: 0, items: ["checks run on 2026-09-20", "step — WAIVED: reason"], source: "sqlite" },
      ];
      const goals = { description: FIXTURE_BOARD.goals.description, statement: INFERRED_STATEMENT, status: "inferred" };
      const ticket5 = FIXTURE_BOARD.tickets.find((t) => t.id === 5);
      const data = {
        ...FIXTURE_BOARD,
        goals,
        goal,
        criteria,
        tickets: [
          ...FIXTURE_BOARD.tickets.map((t) => (t.id === 2 ? { ...t, subtitle } : t)),
          { ...ticket5, id: 15, superseded_by: null, superseded_reason: reason },
        ],
      };
      const html = renderWorkBoardHtml(pageOf(data));
      for (const control of ["<input", "<button", "onclick"]) {
        assert.equal(html.includes(control), false, `expected no ${control} anywhere on the board`);
      }
      const page = join(dir, "Work Board.html");
      writeFileSync(page, html, "utf-8");

      await withBrowser(executable, async (cdp) => {
        const seen = watchPage(cdp);
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 1000, deviceScaleFactor: 1, mobile: false });
        await openFile(cdp, page);

        const read = `(() => {
          const card = document.querySelector("#goal");
          const style = getComputedStyle(card);
          const body = getComputedStyle(document.body);
          const visible = (node) => node.checkVisibility();
          return {
            tag: card.tagName,
            first: document.querySelector(".board").firstElementChild.id === "goals" && card.previousElementSibling.id === "goals",
            goalsBody: ${GOALS_BODY},
            open: card.open,
            head: [...card.querySelectorAll(".head > span")].map((s) => [s.className, s.textContent]),
            reversed: style.backgroundColor === body.color && style.color === body.backgroundColor,
            criteria: [...card.querySelectorAll("li.criterion")].map((li) => ({
              id: li.dataset.criterion,
              text: li.querySelector(".ctext").textContent,
              state: li.querySelector(".state").textContent,
              items: [...li.querySelectorAll("ul.items li")].map((i) => i.textContent),
              shown: visible(li),
              toggle: li.querySelector("details.items > summary")?.textContent ?? null,
              listShown: li.querySelector("ul.items") ? visible(li.querySelector("ul.items")) : null,
            })),
            controls: document.querySelectorAll("input, button, [onclick]").length,
            subtitles: [...document.querySelectorAll("details.ticket .subtitle")].map((s) => [s.closest("details").id, s.textContent]),
            reasons: [...document.querySelectorAll("details.ticket .reason")].map((r) => [r.closest("details").id, r.textContent]),
            supersededBy: [...document.querySelectorAll("details.ticket dt")].filter((dt) => dt.textContent === "Superseded by").map((dt) => [dt.closest("details").id, dt.nextElementSibling.textContent]),
          };
        })()`;
        const closed = await evaluate(cdp, read);
        assert.deepEqual(seen.problems, [], "expected no console error, uncaught exception, failed load or network request");
        assert.equal(closed.tag, "DETAILS", "expanded and collapsed by the native element alone");
        assert.equal(closed.first, true, "the Goal card sits under the statement of goals' card, above the first lane");
        assert.deepEqual(
          closed.goalsBody,
          [["caption", "Inferred, not confirmed"], ["statement", closed.goalsBody[1][1], statementRows(true)]],
          "an inferred statement is captioned as such and drawn as one row per line, labels in their own cell, 1.5em per level, no connector styling"
        );
        assert.equal(closed.goalsBody[1][2][8][1][0][1], "  (see the attached note on timing)", "an unrecognised line is one text cell, exactly as stored");
        assert.equal(closed.open, false, "the Goal card starts collapsed");
        assert.deepEqual(closed.head, [["sentence", goal.sentence], ["lifecycle", "Drafting"], ["text", goal.text]], "collapsed: the sentence, the state pill and the card string");
        assert.equal(closed.reversed, true, "the Goal card reverses the page's colours");
        assert.equal(closed.criteria.some((c) => c.shown), false, "collapsed: no criterion shows");
        assert.equal(closed.controls, 0);

        await evaluate(cdp, `(document.querySelector("#goal").open = true)`);
        const opened = await evaluate(cdp, read);
        assert.deepEqual(
          opened.criteria,
          [
            { id: "excerpts", text: criteria[0].text, state: "Unmet — 2", items: criteria[0].items, shown: true, toggle: "2 items are unmet", listShown: false },
            { id: "noting-up", text: criteria[1].text, state: "Met", items: criteria[1].items, shown: true, toggle: "0 items are unmet, 1 shelved", listShown: false },
            { id: "gate", text: criteria[2].text, state: "Met", items: criteria[2].items, shown: true, toggle: "Show 2 notes", listShown: false },
          ],
          "expanded: each criterion with its state and its count, its items behind a click"
        );

        // A criterion's item list opens on a click without closing the Goal card or an open ticket,
        // and printing opens every list, then afterprint puts each back.
        const lists = `[...document.querySelectorAll("#goal details.items")].map((d) => d.open)`;
        await evaluate(cdp, `(document.querySelector("#ticket-2").open = true)`);
        await evaluate(cdp, `(document.querySelector("#goal details.items > summary").click(), true)`);
        const clicked = await evaluate(cdp, read);
        assert.deepEqual(clicked.criteria.map((c) => c.listShown), [true, false, false], "the clicked list shows, the other stays hidden");
        assert.equal(clicked.open, true, "the Goal card stays open");
        assert.equal(await evaluate(cdp, `document.querySelector("#ticket-2").open`), true, "an open ticket stays open");
        await evaluate(cdp, `dispatchEvent(new Event("beforeprint"))`);
        assert.deepEqual(await evaluate(cdp, lists), [true, true, true], "printing opens every list");
        await evaluate(cdp, `dispatchEvent(new Event("afterprint"))`);
        assert.deepEqual(await evaluate(cdp, lists), [true, false, false], "afterprint restores each list");

        // Goal card design §4.7: the server's strings, drawn as given, and nothing where they are null.
        assert.deepEqual(opened.subtitles, [["ticket-2", subtitle]]);
        assert.deepEqual(opened.reasons, [["ticket-15", reason]]);
        // The pointer row stays the one surface for a job superseded by another job.
        assert.deepEqual(opened.supersededBy, [["ticket-5", `Job #${ticket5.superseded_by.id}`]]);
        assert.deepEqual(seen.problems, []);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });

  // A pre-filing board sends no goal: nothing is drawn in the Completion Criteria card's place.
  test(`the Work Board draws no Goal card when the data carries no goal in ${name}`, { timeout: 120000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "coclerk-workboard-nogoal-"));
    try {
      const data = { ...FIXTURE_BOARD };
      delete data.goal;
      delete data.criteria;
      const page = join(dir, "Work Board.html");
      writeFileSync(page, renderWorkBoardHtml(pageOf(data)), "utf-8");

      await withBrowser(executable, async (cdp) => {
        const seen = watchPage(cdp);
        await openFile(cdp, page);
        const board = await evaluate(cdp, `(() => {
          const first = document.querySelector(".board").firstElementChild;
          const row = document.querySelector("header .meta.proceeding");
          return {
            goal: document.querySelector("#goal") === null,
            firstId: first.id,
            nextTag: first.nextElementSibling.tagName,
            nextId: first.nextElementSibling.id,
            proceeding: row && [...row.childNodes].map((n) => (n.nodeType === Node.TEXT_NODE ? n.textContent : [n.className, n.textContent])),
          };
        })()`);
        assert.deepEqual(seen.problems, [], "expected no console error, uncaught exception, failed load or network request");
        assert.equal(board.goal, true, "no Goal card is drawn");
        assert.deepEqual(board.proceeding, [["chip", "Drafting"]], "with no Goal card the state is a chip on the proceeding line, drawn though the proceeding is blank");
        assert.equal(board.firstId, "goals", "the statement of goals' card is still the board's first block");
        assert.equal(board.nextTag, "SECTION", "the first lane follows it");
        assert.equal(board.nextId, "ready");
      });
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });

  // Each panel lists its jobs by job number, lowest first. The data keeps queue order (priority,
  // then id), which the summary's Dispatch rule reads, so the page sorts a copy and never the data.
  test(`the Work Board lists each panel's jobs by job number in ${name}`, { timeout: 120000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "coclerk-workboard-order-"));
    try {
      const base = FIXTURE_BOARD.tickets.find((t) => t.id === 7);
      const job = (id, category, priority = 0) => ({ ...base, id, category, priority });
      // Queue order (priority DESC, id), as the server emits it.
      const tickets = [
        job(32, "ready", 5), job(24, "ready"), job(25, "ready"), job(28, "ready"), job(29, "ready"), job(31, "ready"),
        job(40, "wip", 2), job(36, "wip"),
        job(50, "completed"),
        job(61, "rejected", 1), job(60, "rejected"),
      ];
      const data = { ...FIXTURE_BOARD, tickets };
      const page = join(dir, "Work Board.html");
      writeFileSync(page, renderWorkBoardHtml(pageOf(data)), "utf-8");

      await withBrowser(executable, async (cdp) => {
        const seen = watchPage(cdp);
        await openFile(cdp, page);
        const board = await evaluate(cdp, `(() => {
          const ids = (id) => [...document.querySelector("#" + id).querySelectorAll("details.ticket")].map((d) => d.id);
          return {
            ready: ids("ready"),
            wip: ids("in-progress"),
            completed: ids("completed"),
            waiting: ids("waiting-on"),
            waitingEmpty: document.querySelector("#waiting-on p.empty")?.textContent ?? null,
            rejected: ids("rejected-angles"),
            shelvedProposals: document.querySelectorAll("#rejected-angles .proposal").length,
            priority: document.querySelector("#ticket-32").dataset.priority,
            dataOrder: window.WORKBOARD.sections[0].tickets.map((t) => t.id),
          };
        })()`);
        assert.deepEqual(board.ready, ["ticket-24", "ticket-25", "ticket-28", "ticket-29", "ticket-31", "ticket-32"]);
        assert.deepEqual(board.wip, ["ticket-36", "ticket-40"]);
        assert.deepEqual(board.completed, ["ticket-50"], "a one-job panel");
        assert.deepEqual(board.waiting, [], "an empty panel draws no cards");
        assert.equal(board.waitingEmpty, "Nothing blocked.", "an empty panel still draws as before");
        assert.deepEqual(board.rejected, ["ticket-60", "ticket-61"]);
        assert.equal(board.shelvedProposals, 1, "the shelved Proposal is still drawn after the sorted tickets");
        assert.equal(board.priority, "5", "priority is still shown");
        assert.deepEqual(board.dataOrder, tickets.map((t) => t.id), "the embedded data keeps queue order");
        assert.deepEqual(seen.problems, [], "expected no console error, uncaught exception, failed load or network request");
      });
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });

  // A deleted job (schema v54, jobs-closeout.md §10a) is one struck red line among the Completed cards,
  // in job-number order, and counts toward nothing. Its Restore link only copies an instruction; the
  // click handler is read, not driven, since a clipboard round trip under parallel tests is unreliable.
  test(`the Work Board draws a deleted job as a struck line in Completed in ${name}`, { timeout: 120000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "coclerk-workboard-deleted-"));
    try {
      const base = FIXTURE_BOARD.tickets.find((t) => t.id === 7);
      const title = "Draft the orders sought";
      const data = {
        ...FIXTURE_BOARD,
        tickets: [{ ...base, id: 3, category: "completed" }, { ...base, id: 1, category: "completed" }],
        deleted: [{ id: 2, title }],
      };
      const page = join(dir, "Work Board.html");
      writeFileSync(page, renderWorkBoardHtml(pageOf(data)), "utf-8");

      await withBrowser(executable, async (cdp) => {
        const seen = watchPage(cdp);
        await openFile(cdp, page);
        const completed = await evaluate(cdp, `(() => {
          const sec = document.querySelector("#completed");
          const line = sec.querySelector("p.deleted");
          return {
            count: sec.querySelector("h2 .count").textContent,
            children: [...sec.querySelector(".stack").children].map((c) => c.tagName.toLowerCase() + (c.id ? "#" + c.id : "") + (c.className ? "." + c.className : "")),
            text: line.textContent,
            struck: line.querySelector("s").textContent,
            link: line.querySelector("a").textContent,
            elsewhere: document.querySelectorAll("p.deleted").length,
          };
        })()`);
        assert.deepEqual(seen.problems, [], "expected no console error, uncaught exception, failed load or network request");
        assert.deepEqual(completed.children, ["details#ticket-1.ticket", "p.deleted", "details#ticket-3.ticket"]);
        assert.equal(completed.text, `Job #2:  ${title} *DELETED* Restore`);
        assert.equal(completed.struck, `Job #2:  ${title}`, "the strike covers the job number and title only");
        assert.equal(completed.link, "Restore");
        assert.equal(completed.count, "2", "the lane counts its completed jobs, not the deleted line");
        assert.equal(completed.elsewhere, 1, "the deleted job is drawn in Completed and nowhere else");
      });
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });

  test(`the Litigation Strategy opens from disk in ${name} and draws every filing from a lone copy`, { timeout: 120000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "coclerk-matter-board-file-url-"));
    try {
      const written = await writeSeededMatterBoard(dir);
      const dataLine = readFileSync(written, "utf-8").split("\n").find((l) => l.startsWith("window.MATTER_BOARD = "));
      const data = JSON.parse(dataLine.slice("window.MATTER_BOARD = ".length, -1));
      const lone = join(dir, "lone", "Litigation Strategy.html");
      mkdirSync(join(dir, "lone"));
      copyFileSync(written, lone);

      await withBrowser(executable, async (cdp) => {
        const problems = [];
        const statusErrors = [];
        let statusRequests = 0;
        cdp.on((msg) => {
          if (msg.method === "Runtime.exceptionThrown") {
            const details = msg.params.exceptionDetails;
            problems.push(`exception: ${details.exception?.description ?? details.text}`);
          }
          if (msg.method === "Runtime.consoleAPICalled" && (msg.params.type === "error" || msg.params.type === "assert")) {
            problems.push(`console.${msg.params.type}: ${msg.params.args.map((arg) => arg.value ?? arg.description).join(" ")}`);
          }
          if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
            if ((msg.params.entry.url ?? "").includes(STATUS_FILE)) statusErrors.push(msg.params.entry.text);
            else problems.push(`log: ${msg.params.entry.text} ${msg.params.entry.url ?? ""}`);
          }
          if (msg.method === "Network.requestWillBeSent" && !/^(file|data):/.test(msg.params.request.url)) {
            problems.push(`network: ${msg.params.request.url}`);
          }
          if (msg.method === "Network.requestWillBeSent" && msg.params.request.url.includes(STATUS_FILE)) statusRequests++;
        });
        for (const domain of ["Runtime", "Log", "Network", "Page"]) await cdp.send(`${domain}.enable`);
        await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1800, height: 1000, deviceScaleFactor: 1, mobile: false });
        const loaded = new Promise((resolve) => cdp.on((msg) => msg.method === "Page.loadEventFired" && resolve()));
        await cdp.send("Page.navigate", { url: pathToFileURL(lone).href });
        await loaded;

        const { result } = await cdp.send("Runtime.evaluate", {
          returnByValue: true,
          expression: `JSON.stringify({
            title: document.title,
            sections: [...document.querySelectorAll(".board > section")].map((s) => s.id),
            todos: [...document.querySelectorAll("#todos li.todo")].map((li) => ({
              id: li.dataset.todoId,
              description: li.querySelector(".description").textContent,
              bf: li.querySelector(".bf")?.textContent ?? null,
              line: li.querySelector(".line")?.textContent ?? null,
            })),
            live: [...document.querySelectorAll("#filings article.filing")].map((a) => ({ id: Number(a.dataset.filingId), text: a.textContent })),
            retired: [...document.querySelectorAll("#retired details.retired")].map((d) => ({ id: Number(d.dataset.filingId), open: d.open, text: d.textContent })),
            stylesheetApplied: getComputedStyle(document.querySelector("header h1")).fontWeight,
            cardLefts: [...new Set([...document.querySelectorAll("article.filing, details.retired")].map((c) => Math.round(c.getBoundingClientRect().left)))],
          })`,
        });
        const page = JSON.parse(result.value);

        assert.deepEqual(problems, [], "expected no console error, uncaught exception, failed load or network request");
        assert.equal(page.title, "Litigation Strategy — L7001");
        assert.deepEqual(page.sections, ["todos", "filings", "retired"], "the to-dos lead, retired filings sit at the foot");

        // ADR 0021 D2, D5: a plain BF date, and the pointed filing's own line beneath its to-do.
        const lineOf = (id) => page.live.find((c) => c.id === id).text;
        assert.deepEqual(page.todos, [
          { id: "t-pointed", description: "Settle the response </script><b>now</b>", bf: "BF 2026-09-01", line: lineOf(2) },
          { id: "t-undated", description: "Report to the client", bf: null, line: null },
        ]);

        // D3: one line per filing -- name, lifecycle state, mockup status, jobs in progress.
        assert.deepEqual(page.live.map((c) => c.id), data.filings.filter((f) => !f.retired_on).map((f) => f.filing_id), "one line per live filing, in the data's order");
        assert.equal(lineOf(1), "Notice of Application · Drafting · Mockups not yet rendered · No jobs in progress");
        assert.equal(lineOf(2), "Application Response · Drafting · Mockups not yet rendered · 1 job in progress");
        assert.deepEqual(page.retired.map((r) => [r.id, r.open]), [[3, false]], "the retired filing is collapsed");
        assert.match(page.retired[0].text, /Retired 2026-08-01 — abandoned/);
        assert.equal(page.stylesheetApplied, "600", "expected the inline stylesheet to apply");
        assert.equal(page.cardLefts.length, 1, `expected every card in one column, found lefts ${page.cardLefts}`);

        // #589: a lone copy has no live-status sibling. Its one failed load stops polling for good and
        // hides the indicator, so the copy is a snapshot -- one expected error, never a second request.
        await sleep(5000);
        assert.equal(statusErrors.length, 1, `expected exactly one failed status load, saw ${JSON.stringify(statusErrors)}`);
        assert.equal(statusRequests, 1, "polling stops after the first failed load");
        assert.equal((await evaluate(cdp, JOB)).hidden, true, "the indicator stays hidden on a lone copy");
      });
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });

  test(`the Litigation Strategy shows the render job's progress in ${name}, then clears within 5 s of done`, { timeout: 120000 }, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "coclerk-matter-board-status-"));
    try {
      const board = await writeSeededMatterBoard(dir);
      const status = join(dirname(board), STATUS_FILE);
      const now = new Date().toISOString();
      const running = { job_id: "j", state: "running", started_at: now, updated_at: now, stall_after_ms: 60000, queued: [2], done: [], failed: [], current: 1 };
      assert.equal(writeStatusFile(status, statusScript(running)), null);

      await withBrowser(executable, async (cdp) => {
        const seen = watchPage(cdp);
        await openFile(cdp, board);
        await waitForPage(cdp, `(${JOB}).spinner`, "the spinner", 10000);
        const shown = await evaluate(cdp, JOB);
        assert.equal(shown.hidden, false);
        assert.equal(shown.stalled, false);
        assert.equal(shown.text, "Rendering mockups — 0 of 2");

        await evaluate(cdp, recordWhen("__clearedAt", "job.hidden"));
        const done = { ...running, state: "done", updated_at: new Date().toISOString(), queued: [], done: [1, 2], current: null };
        assert.equal(writeStatusFile(status, statusScript(done)), null);
        await waitForPage(cdp, "window.__clearedAt !== null", "the indicator to clear", 30000);
        const elapsed = (await evaluate(cdp, "window.__clearedAt")) - Date.parse(done.updated_at);
        assert.ok(elapsed <= 5000, `cleared ${elapsed} ms after done`);
        t.diagnostic(`${name}: indicator cleared ${elapsed} ms after done`);
        assert.deepEqual(await evaluate(cdp, MOCKUPS), { 1: "Mockups ready", 2: "Mockups ready" });
        assert.equal(await evaluate(cdp, `document.querySelector('li.todo[data-todo-id="t-pointed"] .line .mockups').textContent`), "Mockups ready", "the to-do's line for filing 2 follows the job too");

        assert.deepEqual(seen.problems, [], "expected no console error, uncaught exception, failed load or network request");
        assert.deepEqual(seen.statusErrors, [], "the status file loads every time");
      });
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });

  test(`the Litigation Strategy in ${name} says rendering may have stalled once its job is killed mid-run`, { timeout: 180000 }, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "coclerk-matter-board-stall-"));
    const dbPath = join(dir, "L7001 Ashgrove", "0. CASE DATA", "submission.sqlite");
    const draft = join(dir, "L7001 Ashgrove", "0. DRAFT");
    const status = join(draft, STATUS_FILE);
    const stallMs = 2000;
    let run;
    try {
      mkdirSync(dirname(dbPath), { recursive: true });
      await seedFilings(dbPath, 150);
      mkdirSync(draft, { recursive: true });
      run = startChild({ db_path: dbPath, ...CLIENT, draft_dir: draft }, { COCLERK_RENDER_STALL_MS: String(stallMs) });
      await run.next("bootstrapped");

      await withBrowser(executable, async (cdp) => {
        const seen = watchPage(cdp);
        await openFile(cdp, join(draft, "Litigation Strategy.html"));
        await waitForPage(cdp, `(${JOB}).spinner`, "the spinner while the job runs", 20000);

        const deadline = Date.now() + 60000;
        while (readStatusScript(status).done.length < 1 && Date.now() < deadline) await sleep(20);
        // A hard kill, as Cowork stops its server: no exit handler runs, so the status stays `running`.
        run.child.kill();
        const killedAt = Date.now();
        await evaluate(cdp, recordWhen("__stalledAt", 'job.classList.contains("stalled")'));
        await run.exited;
        const last = readStatusScript(status);
        assert.equal(last.state, "running", "killed mid-run: the job never wrote done");
        assert.ok(last.queued.length > 0, "killed mid-run: filings were still queued");

        // The page stalls once updated_at is older than the threshold, seen at its next 2 s poll.
        const bound = stallMs + 2000 + 1000;
        await waitForPage(cdp, "window.__stalledAt !== null", "the stall message", 60000);
        const stalledAfter = (await evaluate(cdp, "window.__stalledAt")) - Date.parse(last.updated_at);
        assert.ok(stalledAfter <= bound, `stall message ${stalledAfter} ms after the last heartbeat (bound ${bound} ms)`);
        t.diagnostic(`${name}: stall message ${stalledAfter} ms after the last heartbeat (killed ${killedAt - Date.parse(last.updated_at)} ms after it), ${last.done.length} of 150 filings done`);
        const shown = await evaluate(cdp, JOB);
        assert.equal(shown.text, "Rendering may have stalled — re-open the session to retry");
        assert.equal(shown.spinner, false);
        assert.deepEqual(seen.problems, [], "expected no console error, uncaught exception, failed load or network request");
        assert.deepEqual(seen.statusErrors, []);
      });
    } finally {
      if (run && run.child.exitCode === null) run.child.kill();
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });
}
