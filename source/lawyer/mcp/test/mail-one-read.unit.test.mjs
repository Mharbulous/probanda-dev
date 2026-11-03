// The tools behind one read of each email: mail__list_headers, the verdict ledger and
// mail__save_message's staging, through the real ImapFlow against a loopback IMAP server. Invented
// messages on .test domains only, and the state folder is a temp one. A proxy on the machine, such as
// antivirus mail scanning, may add a header to what reaches the client on loopback, so no test here
// compares a hash with the bytes it served: mail-tools.unit.test.mjs does that through a fake client.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test, { after } from "node:test";

import { imapServer } from "./helpers/imap-server.mjs";

const STATE_DIR = mkdtempSync(join(tmpdir(), "coclerk-mail-one-read-"));
const SAVED_LOCALAPPDATA = process.env.LOCALAPPDATA;
process.env.LOCALAPPDATA = STATE_DIR;
after(() => {
  if (SAVED_LOCALAPPDATA === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = SAVED_LOCALAPPDATA;
  rmSync(STATE_DIR, { recursive: true, force: true });
});

const { callContactsCalendarsEmailTool: callTool, dispatchContactsCalendarsEmailTool: dispatchTool } = await import("../build/contacts-calendars-email-dispatch.js");

const TRASH = "Deleted Messages";
const DRAFTS = "Drafts";
const hash = (data) => createHash("sha256").update(data).digest("hex");
const SHA256 = /^[0-9a-f]{64}$/;

function message({ id, subject = "Production", body = "We agree to the dates.", headers = [] }) {
  return Buffer.from([
    ...(id ? [`Message-ID: <${id}>`] : []),
    "From: Opposing Counsel <opp.counsel@example-llp.test>",
    "To: lawyer@firm.example.test",
    `Subject: ${subject}`,
    "Date: Mon, 02 Nov 2026 10:00:00 +0000",
    ...headers,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
    "",
  ].join("\r\n"));
}

const entry = (raw, flags = "") => {
  const text = raw.toString("latin1");
  const get = (name) => new RegExp(`^${name}: (.*)$`, "mi").exec(text.split("\r\n\r\n")[0])?.[1];
  const q = (value) => (value ? `"${value}"` : "NIL");
  const from = '(("Opposing Counsel" NIL "opp.counsel" "example-llp.test"))';
  return {
    raw,
    flags,
    envelope: `(${q(get("Date"))} ${q(get("Subject"))} ${from} NIL NIL NIL NIL NIL ${q(get("In-Reply-To"))} ${q(get("Message-ID"))})`,
  };
};

// Each folder maps a UID to the entry of one message.
async function mailbox(t, folders, capabilities = "IMAP4rev1 MOVE UIDPLUS") {
  const all = { [TRASH]: {}, ...folders };
  const boxes = new Map(Object.entries(all).map(([name, msgs]) => [name, new Set(Object.keys(msgs).map(Number))]));
  const running = await imapServer({ capabilities, boxes, trash: TRASH, drafts: DRAFTS, messageOf: (uid, folder) => all[folder][uid] });
  t.after(() => running.server.close());
  return {
    ...running,
    context: (extra = {}) => ({
      practiceDb: {},
      mail: { credential: { host: "127.0.0.1", port: running.port, secure: false, username: "someone", password: "fake-password-0000-not-real" } },
      ...extra,
    }),
  };
}

async function errorOf(ctx, name, args) {
  const result = await dispatchTool(ctx, name, args);
  assert.equal(result.isError, true, result.content[0].text);
  return JSON.parse(result.content[0].text).error;
}

async function scanToEnd(ctx, args) {
  let reply = await callTool(ctx, "mail__dedupe_scan", args);
  while (reply.status === "scanning") reply = await callTool(ctx, "mail__dedupe_scan", { scan_id: reply.scan_id });
  return reply;
}

const page = (reply) => JSON.parse(readFileSync(reply.list_path, "utf-8"));

// --- mail__list_headers --------------------------------------------------------------------------

test("list_headers writes its page to a file, returns no message data, opens read-only and marks nothing", async (t) => {
  const reply = message({ id: "reply@example-llp.test", headers: ["In-Reply-To: <parent@firm.example.test>", "References: <root@firm.example.test> <parent@firm.example.test>"] });
  const auto = message({ id: "ooo@example-llp.test", subject: "Automatic reply", headers: ["Auto-Submitted: auto-replied"] });
  const draft = message({ id: "draft@firm.example.test", headers: ["X-Unsent: 1"] });
  const box = await mailbox(t, { Listed: { 3: entry(reply, "\\Seen"), 4: entry(auto), 5: entry(draft, "\\Draft") } });
  const result = await callTool(box.context(), "mail__list_headers", { folder: "Listed" });
  assert.deepEqual(Object.keys(result), ["list_path", "count", "next_uid", "done"]);
  assert.equal(result.count, 3);
  assert.equal(result.next_uid, null);
  assert.equal(result.done, true);
  assert.ok(result.list_path.startsWith(join(STATE_DIR, "Coclerk", "mail")));

  const listed = page(result);
  assert.equal(listed.folder, "Listed");
  assert.equal(listed.uidValidity, "42");
  assert.equal(listed.uidNext, 100);
  const [first, second, third] = listed.messages;
  assert.equal(first.uid, 3);
  assert.equal(first.message_id, "reply@example-llp.test");
  assert.equal(first.in_reply_to, "parent@firm.example.test");
  assert.deepEqual(first.references, ["root@firm.example.test", "parent@firm.example.test"]);
  assert.match(first.raw_sha256, SHA256);
  assert.ok(first.size >= reply.length);
  assert.equal(first.subject, "Production");
  assert.match(first.from, /opp\.counsel@example-llp\.test/);
  assert.deepEqual(first.flags, ["\\Seen"]);
  assert.match(first.body_sha256, /^[0-9a-f]{64}$/);
  assert.equal(first.has_attachments, false);
  assert.equal(first.x_unsent, false);
  assert.equal(first.auto_submitted, null);
  assert.equal(second.auto_submitted, "auto-replied");
  assert.equal(third.x_unsent, true);
  assert.deepEqual(third.flags, ["\\Draft"]);
  assert.equal(JSON.stringify(listed).includes("We agree to the dates"), false, "the page holds no body");

  assert.ok(box.wire.some((l) => /EXAMINE "?Listed"?$/.test(l)), box.wire.join("\n"));
  assert.ok(box.wire.some((l) => /BODY\.PEEK\[\]/.test(l)), box.wire.join("\n"));
  assert.equal(box.wire.some((l) => /\b(SELECT|STORE|COPY|MOVE|EXPUNGE|CLOSE)\b/i.test(l)), false, box.wire.join("\n"));
});

test("a message with no Message-ID is listed with a null id, and its byte-identical copy lists with the same hash (T10, D7)", async (t) => {
  const noId = message({ id: null });
  const box = await mailbox(t, { NoIds: { 1: entry(noId), 2: entry(noId), 3: entry(message({ id: null, body: "A different message." })) } });
  const { messages } = page(await callTool(box.context(), "mail__list_headers", { folder: "NoIds" }));
  assert.deepEqual(messages.map((m) => m.message_id), [null, null, null]);
  assert.equal(messages[0].raw_sha256, messages[1].raw_sha256);
  assert.notEqual(messages[0].raw_sha256, messages[2].raw_sha256);
});

test("a message that cannot be parsed is listed, marked unreadable, with no body hash", async (t) => {
  const unreadable = Buffer.from("X-Only: this\r\n\r\nno usual headers\r\n");
  const box = await mailbox(t, { Broken: { 1: { raw: unreadable, envelope: "(NIL NIL NIL NIL NIL NIL NIL NIL NIL NIL)" } } });
  const { messages: [m] } = page(await callTool(box.context(), "mail__list_headers", { folder: "Broken" }));
  assert.equal(m.unreadable, true);
  assert.equal(m.body_sha256, null);
  assert.match(m.raw_sha256, SHA256);
});

test("a listing cut by its slice or its limit resumes at next_uid and misses nothing", async (t) => {
  const folder = Object.fromEntries([11, 12, 15, 19].map((uid) => [uid, entry(message({ id: `m${uid}@example-llp.test` }))]));
  const box = await mailbox(t, { Sliced: folder, Limited: folder });

  for (const [name, args, ctx] of [["Sliced", {}, box.context({ mailSliceMs: 0 })], ["Limited", { limit: 2 }, box.context()]]) {
    const seen = [];
    let reply = await callTool(ctx, "mail__list_headers", { folder: name, ...args });
    const firstPath = reply.list_path;
    assert.equal(reply.done, false, name);
    let calls = 1;
    for (;;) {
      seen.push(...page(reply).messages.map((m) => m.uid));
      if (reply.done) break;
      reply = await callTool(ctx, "mail__list_headers", { folder: name, uid_from: reply.next_uid, ...args });
      calls += 1;
    }
    assert.deepEqual(seen, [11, 12, 15, 19], name);
    assert.ok(calls > 1, name);
    assert.notEqual(reply.list_path, firstPath, name);
    assert.equal(page(await callTool(box.context(), "mail__list_headers", { folder: name, uid_from: 15 })).messages[0].uid, 15, name);
  }
});

test("a second listing reuses the hashes and fetches no body, and another UIDVALIDITY starts afresh", async (t) => {
  const raw = message({ id: "cached@example-llp.test" });
  const box = await mailbox(t, { Cached: { 1: entry(raw, "\\Seen") } });
  const first = await callTool(box.context(), "mail__list_headers", { folder: "Cached" });
  const before = page(first).messages[0];
  box.wire.length = 0;
  const second = page(await callTool(box.context(), "mail__list_headers", { folder: "Cached" })).messages[0];
  assert.deepEqual(second, before);
  assert.ok(box.wire.some((l) => /UID FETCH 1 /.test(l)), box.wire.join("\n"));
  assert.equal(box.wire.some((l) => /BODY/.test(l)), false, box.wire.join("\n"));

  const cacheFolder = join(STATE_DIR, "Coclerk", "mail", "hash-cache");
  const cacheText = readdirSync(cacheFolder).map((f) => readFileSync(join(cacheFolder, f), "utf-8")).join("");
  for (const text of ["Production", "opp.counsel", "We agree"]) assert.equal(cacheText.includes(text), false, text);
  assert.ok(readdirSync(cacheFolder).every((f) => f.endsWith("-42.json")), "the cache is keyed by UIDVALIDITY");
});

test("an empty folder, or a uid_from past its last message, is a finished empty page", async (t) => {
  const box = await mailbox(t, { Empty: {}, Partial: { 1: entry(message({ id: "a@example-llp.test" })) } });
  for (const args of [{ folder: "Empty" }, { folder: "Partial", uid_from: 2 }]) {
    const reply = await callTool(box.context(), "mail__list_headers", args);
    assert.deepEqual([reply.count, reply.next_uid, reply.done], [0, null, true], args.folder);
    assert.deepEqual(page(reply).messages, [], args.folder);
  }
});

// --- the verdict ledger --------------------------------------------------------------------------

const delivered = message({ id: "copied@example-llp.test", body: "We agree to the dates.\r\nSee you there." });
const banner = message({ id: "copied@example-llp.test", body: "CAUTION: This email originated from outside.\r\nWe agree to the dates.\r\nSee you there." });

async function judged(t, folders, capabilities) {
  const box = await mailbox(t, folders, capabilities);
  const ctx = box.context();
  const scan = await scanToEnd(ctx, { folders: ["Matter"] });
  const { items: [group] } = await callTool(ctx, "mail__dedupe_read_comparison", { scan_id: scan.scan_id });
  return { box, ctx, scan, group };
}

const verdictOn = (group, overrides = {}) => {
  const [one, two] = group.copies.map((c) => c.copy_id);
  return { group_id: group.group_id, keep: [one], remove: [two], roles: { [one]: "record", [two]: "duplicate" }, reason: "The second copy adds only a transport banner.", basis: "comparison", ...overrides };
};

test("a comparison copy carries its new fields, and suggested_base is the copy with the lines no other holds", async (t) => {
  const draft = message({ id: "copied@example-llp.test", body: "We agree to the dates.", headers: ["X-Unsent: 1", "Auto-Submitted: auto-generated"] });
  const box = await mailbox(t, { Matter: { 1: entry(delivered), 2: entry(banner, "\\Draft") }, [DRAFTS]: { 1: entry(draft), 2: entry(delivered) } });
  const ctx = box.context();
  const scan = await scanToEnd(ctx, { folders: ["Matter", DRAFTS] });
  assert.equal(scan.tier2.groups_without_verdict, 2);
  const { items } = await callTool(ctx, "mail__dedupe_read_comparison", { scan_id: scan.scan_id });
  const inMatter = items.find((g) => g.copies[0].folder === "Matter");
  const [plain, flagged] = [inMatter.copies.find((c) => c.uid === 1), inMatter.copies.find((c) => c.uid === 2)];
  assert.match(plain.raw_sha256, SHA256);
  assert.notEqual(plain.raw_sha256, flagged.raw_sha256);
  assert.equal(plain.draft_flag, false);
  assert.equal(flagged.draft_flag, true);
  assert.equal(plain.in_drafts_folder, false);
  assert.equal(inMatter.suggested_base, flagged.copy_id);
  assert.equal("sha256" in plain, false);

  const inDrafts = items.find((g) => g.copies[0].folder === DRAFTS);
  const unsent = inDrafts.copies.find((c) => c.uid === 1);
  assert.equal(unsent.in_drafts_folder, true);
  assert.equal(unsent.x_unsent, true);
  assert.equal(unsent.auto_submitted, "auto-generated");
});

test("suggested_base falls to the highest UID when no copy holds a line of its own", async (t) => {
  const first = message({ id: "same@example-llp.test" });
  const second = message({ id: "same@example-llp.test", headers: ["X-Mailer: Two"] });
  const { group } = await judged(t, { Matter: { 4: entry(first), 9: entry(second) } });
  assert.equal(group.suggested_base, group.copies.find((c) => c.uid === 9).copy_id);
});

test("a recorded verdict is a hit for a later scan of the same copies, whichever scan made it, and a miss once the copies differ (T15)", async (t) => {
  const { box, ctx, scan, group } = await judged(t, { Matter: { 1: entry(delivered), 2: entry(banner) } });
  assert.equal(group.prior_verdict, undefined);
  assert.deepEqual(await callTool(ctx, "mail__dedupe_record_verdicts", { scan_id: scan.scan_id, verdicts: [verdictOn(group)] }), { recorded: 1 });

  const ledger = readFileSync(join(STATE_DIR, "Coclerk", "mail", "verdicts.json"), "utf-8");
  for (const text of ["copied@example-llp.test", "someone", "We agree", "Production"]) assert.equal(ledger.includes(text), false, text);
  const stored = Object.values(JSON.parse(ledger)).at(-1);
  const [keptHash, goneHash] = group.copies.map((c) => c.raw_sha256);
  assert.deepEqual(stored.mailbox, { keep: [keptHash], remove: [goneHash] });
  assert.deepEqual(stored.roles, { [keptHash]: "record", [goneHash]: "duplicate" });
  assert.equal(stored.rules_version, 1);
  assert.equal(readdirSync(dirname(join(STATE_DIR, "Coclerk", "mail", "verdicts.json"))).some((f) => f.endsWith(".tmp")), false);

  const second = await scanToEnd(ctx, { folders: ["Matter"] });
  assert.notEqual(second.scan_id, scan.scan_id);
  assert.equal(second.tier2.groups_without_verdict, 0);
  const { items: [hit] } = await callTool(ctx, "mail__dedupe_read_comparison", { scan_id: second.scan_id });
  const [one, two] = hit.copies.map((c) => c.copy_id);
  assert.deepEqual(hit.prior_verdict, { keep: [one], remove: [two], roles: { [one]: "record", [two]: "duplicate" }, reason: verdictOn(group).reason, basis: "comparison" });
  const { items: [shown] } = await callTool(ctx, "mail__dedupe_read_comparison", { scan_id: second.scan_id, view: "verdicts" });
  assert.deepEqual(shown, { group_id: hit.group_id, remove: [two], reason: verdictOn(group).reason, has_unsent_draft_difference: false });
  assert.equal(box.wire.some((l) => /\b(SELECT|STORE|MOVE|EXPUNGE)\b/i.test(l)), false, box.wire.join("\n"));

  // Another account's mailbox holding the same bytes has no verdict.
  const elsewhere = box.context();
  elsewhere.mail.credential.username = "another";
  assert.equal((await callTool(elsewhere, "mail__dedupe_scan", { scan_id: second.scan_id })).tier2.groups_without_verdict, 1);

  // A third copy is a different set of copies, so the verdict no longer answers for the group.
  const third = message({ id: "copied@example-llp.test", body: "A third wording." });
  const changed = await judged(t, { Matter: { 1: entry(delivered), 2: entry(banner), 3: entry(third) } });
  assert.equal(changed.group.prior_verdict, undefined);
  assert.equal(changed.scan.tier2.groups_without_verdict, 1);
});

test("a verdict under older rules, or more than 365 days old, is ignored and pruned on the next write", async (t) => {
  const ledgerPath = join(STATE_DIR, "Coclerk", "mail", "verdicts.json");
  for (const stale of [{ rules_version: 0 }, { recorded_at: "2020-01-01T00:00:00.000Z" }]) {
    const body = `${stale.rules_version ?? "age"} of the unjudged`;
    const a = message({ id: "old@example-llp.test", body });
    const b = message({ id: "old@example-llp.test", body: `${body}, again` });
    const { ctx, scan, group } = await judged(t, { Matter: { 1: entry(a), 2: entry(b) } });
    await callTool(ctx, "mail__dedupe_record_verdicts", { scan_id: scan.scan_id, verdicts: [verdictOn(group)] });
    const saved = JSON.parse(readFileSync(ledgerPath, "utf-8"));
    const key = Object.keys(saved).find((k) => saved[k].roles[group.copies[0].raw_sha256]);
    Object.assign(saved[key], stale);
    writeFileSync(ledgerPath, JSON.stringify(saved));
    assert.equal((await callTool(ctx, "mail__dedupe_scan", { scan_id: scan.scan_id })).tier2.groups_without_verdict, 1);

    await callTool(ctx, "mail__dedupe_record_verdicts", { scan_id: scan.scan_id, verdicts: [verdictOn(group)] });
    assert.notEqual(JSON.parse(readFileSync(ledgerPath, "utf-8"))[key].recorded_at, "2020-01-01T00:00:00.000Z");
  }
});

test("record_verdicts refuses a bad verdict, and a refusal records none of the call's verdicts", async (t) => {
  const { ctx, scan, group } = await judged(t, { Matter: { 1: entry(message({ id: "bad@example-llp.test", body: "One" })), 2: entry(message({ id: "bad@example-llp.test", body: "Two" })) } });
  const [one, two] = group.copies.map((c) => c.copy_id);
  const record = (verdicts, scan_id = scan.scan_id) => errorOf(ctx, "mail__dedupe_record_verdicts", { scan_id, verdicts });
  const cases = [
    ["a group not in the scan", { group_id: "g99" }, "dedupe_not_in_comparison"],
    ["no copy kept", { keep: [], remove: [one, two] }, "dedupe_no_copy_left"],
    ["a copy left out", { keep: [one], remove: [] }, "dedupe_bad_verdict"],
    ["a copy not in the group", { keep: [one, "g99-1"], remove: [two] }, "dedupe_bad_verdict"],
    ["a copy named twice", { keep: [one, one], remove: [two] }, "dedupe_bad_verdict"],
    ["a copy kept and removed", { keep: [one, two], remove: [two] }, "dedupe_bad_verdict"],
    ["a copy with no role", { roles: { [one]: "record" } }, "dedupe_bad_verdict"],
    ["no record copy", { roles: { [one]: "extra", [two]: "duplicate" } }, "dedupe_bad_verdict"],
    ["two record copies", { roles: { [one]: "record", [two]: "record" } }, "dedupe_bad_verdict"],
    ["a role that does not exist", { roles: { [one]: "record", [two]: "trash" } }, "dedupe_bad_verdict"],
    ["a basis that does not exist", { basis: "hunch" }, "dedupe_bad_verdict"],
    ["an empty reason", { reason: "  " }, "dedupe_bad_verdict"],
    ["a reason of two lines", { reason: "One.\nTwo." }, "dedupe_bad_verdict"],
    ["a long reason", { reason: "x".repeat(301) }, "dedupe_bad_verdict"],
  ];
  for (const [what, overrides, code] of cases) assert.equal((await record([verdictOn(group, overrides)])).code, code, what);
  assert.equal((await record([verdictOn(group)], "nope")).code, "dedupe_scan_replaced");
  assert.match((await record([verdictOn(group), verdictOn(group)])).message, /names group .* twice/);
  assert.equal((await record([verdictOn(group), verdictOn(group, { group_id: "g99" })])).code, "dedupe_not_in_comparison");
  const { items } = await callTool(ctx, "mail__dedupe_read_comparison", { scan_id: scan.scan_id, view: "verdicts" });
  assert.deepEqual(items, [], "nothing was recorded");

  const reply = await callTool(ctx, "mail__dedupe_record_verdicts", {
    scan_id: scan.scan_id,
    verdicts: [verdictOn(group, { keep: [one, two], remove: [], roles: { [one]: "draft", [two]: "draft" } })],
  });
  assert.equal(reply.recorded, 1, "a group of only drafts needs no record copy");
  const { items: [shown] } = await callTool(ctx, "mail__dedupe_read_comparison", { scan_id: scan.scan_id, view: "verdicts" });
  assert.equal(shown.has_unsent_draft_difference, false, "with no delivered copy nothing differs from what was sent");
});

test("the verdicts view says when a kept draft differs from what was sent", async (t) => {
  const { ctx, scan, group } = await judged(t, { Matter: { 1: entry(message({ id: "sent@example-llp.test", body: "Sent text" })), 2: entry(message({ id: "sent@example-llp.test", body: "Edited before sending", headers: ["X-Unsent: 1"] })) } });
  const [one, two] = group.copies.map((c) => c.copy_id);
  await callTool(ctx, "mail__dedupe_record_verdicts", { scan_id: scan.scan_id, verdicts: [verdictOn(group, { keep: [one, two], remove: [], roles: { [one]: "record", [two]: "draft" } })] });
  const { items: [shown] } = await callTool(ctx, "mail__dedupe_read_comparison", { scan_id: scan.scan_id, view: "verdicts" });
  assert.equal(shown.has_unsent_draft_difference, true);
  assert.deepEqual(shown.remove, []);
});

test("plan_tier2 builds from the verdicts, moves exactly their copies, and refuses a group with no verdict or nothing to move", async (t) => {
  const a = entry(message({ id: "plan@example-llp.test", body: "One" }));
  const b = entry(message({ id: "plan@example-llp.test", body: "Two" }));
  const c = entry(message({ id: "other@example-llp.test", body: "Three" }));
  const d = entry(message({ id: "other@example-llp.test", body: "Four" }));
  const box = await mailbox(t, { Matter: { 1: a, 2: b, 3: c, 4: d } });
  const ctx = box.context();
  const scan = await scanToEnd(ctx, { folders: ["Matter"] });
  const { items } = await callTool(ctx, "mail__dedupe_read_comparison", { scan_id: scan.scan_id });
  const [plan, other] = [items.find((g) => g.message_id.includes("plan@")), items.find((g) => g.message_id.includes("other@"))];
  const plans = (args) => errorOf(ctx, "mail__dedupe_plan_tier2", { scan_id: scan.scan_id, ...args });

  assert.equal((await plans({ from_verdicts: true, groups: [plan.group_id] })).code, "dedupe_no_verdict");
  assert.equal((await plans({ from_verdicts: true, groups: ["g99"] })).code, "dedupe_not_in_comparison");
  for (const args of [{}, { from_verdicts: true }, { groups: [plan.group_id] }, { from_verdicts: true, groups: [plan.group_id], approved: [{ group_id: plan.group_id, remove: ["x"] }] }]) {
    assert.match((await plans(args)).message, /either approved, or from_verdicts/);
  }

  const [keeper, goner] = [plan.copies.find((x) => x.uid === 2).copy_id, plan.copies.find((x) => x.uid === 1).copy_id];
  const [o1, o2] = other.copies.map((x) => x.copy_id);
  await callTool(ctx, "mail__dedupe_record_verdicts", {
    scan_id: scan.scan_id,
    verdicts: [
      verdictOn(plan, { keep: [keeper], remove: [goner], roles: { [keeper]: "record", [goner]: "duplicate" } }),
      verdictOn(other, { keep: [o1, o2], remove: [], roles: { [o1]: "record", [o2]: "extra" } }),
    ],
  });
  assert.equal((await plans({ from_verdicts: true, groups: [other.group_id] })).code, "dedupe_nothing_to_move");

  const made = await callTool(ctx, "mail__dedupe_plan_tier2", { scan_id: scan.scan_id, from_verdicts: true, groups: [plan.group_id, other.group_id] });
  assert.equal(made.expected_count, 1);
  assert.equal(made.groups, 1);
  let moved = await callTool(ctx, "mail__dedupe_apply", { plan_id: made.plan_id, expected_count: 1 });
  while (moved.status !== "done") moved = await callTool(ctx, "mail__dedupe_apply_continue", { plan_id: made.plan_id });
  assert.deepEqual([...box.boxes.get("Matter")].sort(), [2, 3, 4]);
  assert.ok(box.wire.some((l) => /UID MOVE 1 "Deleted Messages"$/.test(l)), box.wire.join("\n"));
});

test("on a server with no MOVE, like iCloud, verdicts are kept and listed, no plan is made and nothing changes (T15)", async (t) => {
  const { box, ctx, scan, group } = await judged(t, { Matter: { 1: entry(message({ id: "icloud@example-llp.test", body: "One" })), 2: entry(message({ id: "icloud@example-llp.test", body: "Two" })) } }, "IMAP4rev1 UIDPLUS");
  assert.equal(scan.can_move, false);
  await callTool(ctx, "mail__dedupe_record_verdicts", { scan_id: scan.scan_id, verdicts: [verdictOn(group)] });
  const { items: [shown] } = await callTool(ctx, "mail__dedupe_read_comparison", { scan_id: scan.scan_id, view: "verdicts" });
  assert.equal(shown.remove.length, 1);
  assert.equal((await errorOf(ctx, "mail__dedupe_plan_tier2", { scan_id: scan.scan_id, from_verdicts: true, groups: [group.group_id] })).code, "mail_move_unsupported");
  assert.deepEqual([...box.boxes.get("Matter")].sort(), [1, 2]);
  assert.equal(box.wire.some((l) => /\b(SELECT|COPY|STORE|EXPUNGE|MOVE)\b/i.test(l)), false, box.wire.join("\n"));
});

test("a group that cannot be read is named in the scan's reply by its Message-ID, for the run to hold it back (D12)", async (t) => {
  const unreadable = { raw: Buffer.from("Message-ID: <broken@example-llp.test>\r\nX-Only: this\r\n\r\nbody\r\n"), envelope: '(NIL NIL NIL NIL NIL NIL NIL NIL NIL "<broken@example-llp.test>")' };
  const box = await mailbox(t, { Matter: { 1: entry(message({ id: "broken@example-llp.test" })), 2: unreadable } });
  const scan = await scanToEnd(box.context(), { folders: ["Matter"] });
  assert.equal(scan.tier2.unreadable_groups, 1);
  assert.deepEqual(scan.tier2.unreadable_message_ids, ["<broken@example-llp.test>"]);
});

// --- mail__save_message --------------------------------------------------------------------------

test("save_message with staging writes under today's dated folder, with the file name made safe and never overwriting", async (t) => {
  const raw = message({ id: "save@example-llp.test" });
  const box = await mailbox(t, { Matter: { 1: entry(raw) } });
  const ctx = box.context();
  const first = await callTool(ctx, "mail__save_message", { folder: "Matter", uid: 1, staging: true, filename: "2026-11-02 1000 Re: Production [abcd1234].eml" });
  assert.equal(basename(dirname(dirname(first.path))), "mail-staging");
  assert.match(basename(dirname(first.path)), /^\d{8}$/);
  assert.equal(first.filename, "2026-11-02 1000 Re_ Production [abcd1234].eml");
  assert.ok(readFileSync(first.path).includes("We agree to the dates."));
  assert.equal(first.sha256, hash(readFileSync(first.path)));
  const second = await callTool(ctx, "mail__save_message", { folder: "Matter", uid: 1, staging: true, filename: "2026-11-02 1000 Re: Production [abcd1234].eml" });
  assert.equal(second.filename, "2026-11-02 1000 Re_ Production [abcd1234] (1).eml");

  const unnamed = await callTool(ctx, "mail__save_message", { folder: "Matter", uid: 1, staging: true });
  assert.equal(unnamed.filename, "Production.eml");
  for (const [given, expected] of [["..\\..\\escape.eml", "escape.eml"], ["CON.eml", "_CON.eml"], ["..", "message-1.eml"]]) {
    assert.equal((await callTool(ctx, "mail__save_message", { folder: "Matter", uid: 1, staging: true, filename: given })).filename, expected);
  }
  assert.equal(box.wire.some((l) => /\b(SELECT|STORE|COPY|MOVE|EXPUNGE)\b/i.test(l)), false, box.wire.join("\n"));
});

test("save_message takes save_dir or staging, not both or neither, and filename works with save_dir", async (t) => {
  const box = await mailbox(t, { Matter: { 1: entry(message({ id: "both@example-llp.test" })) } });
  const ctx = box.context();
  const dir = mkdtempSync(join(tmpdir(), "coclerk-save-named-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.match((await errorOf(ctx, "mail__save_message", { folder: "Matter", uid: 1 })).message, /either save_dir or staging/);
  assert.match((await errorOf(ctx, "mail__save_message", { folder: "Matter", uid: 1, staging: true, save_dir: dir })).message, /either save_dir or staging/);
  const saved = await callTool(ctx, "mail__save_message", { folder: "Matter", uid: 1, save_dir: dir, filename: "Named.eml" });
  assert.equal(saved.path, join(dir, "Named.eml"));
});

test("a staging save removes this server's dated folders older than 7 days and nothing else", async (t) => {
  const box = await mailbox(t, { Matter: { 1: entry(message({ id: "prune@example-llp.test" })) } });
  const root = join(STATE_DIR, "Coclerk", "mail-staging");
  const dated = (days) => {
    const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  };
  const old = join(root, dated(9));
  const recent = join(root, dated(5));
  const other = join(root, "keep me");
  for (const dir of [old, recent, other]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "x.eml"), "x");
  }
  await callTool(box.context(), "mail__save_message", { folder: "Matter", uid: 1, staging: true });
  assert.equal(existsSync(old), false);
  assert.ok(existsSync(join(recent, "x.eml")));
  assert.ok(existsSync(join(other, "x.eml")));
});
