// The mail__dedupe_* tools and mail__move_messages through the real ImapFlow, against a small IMAP
// server on loopback, because a fake client cannot see the wire. Folder names with spaces, slashes,
// parentheses and non-ASCII characters must reach the server correctly quoted and encoded, and a move
// without MOVE must remove only the UIDs it copied. Synthetic data only.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

import { imapServer } from "./helpers/imap-server.mjs";

const STATE_DIR = mkdtempSync(join(tmpdir(), "coclerk-mail-dedupe-wire-"));
const SAVED_LOCALAPPDATA = process.env.LOCALAPPDATA;
process.env.LOCALAPPDATA = STATE_DIR;
after(() => {
  if (SAVED_LOCALAPPDATA === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = SAVED_LOCALAPPDATA;
  rmSync(STATE_DIR, { recursive: true, force: true });
});

const { callContactsCalendarsEmailTool: callTool } = await import("../build/contacts-calendars-email-dispatch.js");

const MESSAGE = Buffer.from([
  "Message-ID: <wire@example.test>",
  "From: sender@example.test",
  "Subject: Wire",
  "Date: Mon, 02 Nov 2026 10:00:00 +0000",
  "",
  "Synthetic body",
  "",
].join("\r\n"));
const ENVELOPE = '("Mon, 02 Nov 2026 10:00:00 +0000" "Wire" NIL NIL NIL NIL NIL NIL NIL "<wire@example.test>")';

// [readable name, the name as the server knows it in modified UTF-7]
const SPACED = "1. OPEN FILES/Example v. Sample L000 (old)";
const NON_ASCII = ["Résumé", "R&AOk-sum&AOk-"];
const TRASH = "Deleted Messages";

function server(capabilities) {
  const boxes = new Map([[SPACED, new Set([5, 6])], [NON_ASCII[1], new Set([7, 8])], [TRASH, new Set()]]);
  return imapServer({ capabilities, boxes, trash: TRASH, messageOf: () => ({ raw: MESSAGE, envelope: ENVELOPE }) });
}

test("folder names reach the server quoted and encoded, on the read-only scan and on the move", async (t) => {
  const { server: listener, wire, boxes, port } = await server();
  t.after(() => listener.close());
  const context = { practiceDb: {}, mail: { credential: { host: "127.0.0.1", port, secure: false, username: "someone", password: "fake-password-0000-not-real" } } };

  let scan = await callTool(context, "mail__dedupe_scan", { folders: [SPACED, NON_ASCII[0]] });
  while (scan.status === "scanning") scan = await callTool(context, "mail__dedupe_scan", { scan_id: scan.scan_id });
  assert.equal(scan.status, "done");
  assert.deepEqual(scan.folders.map((f) => [f.folder, f.messages, f.copies]), [[SPACED, 2, 1], [NON_ASCII[0], 2, 1]]);
  assert.equal(scan.trash_folder, TRASH);
  assert.ok(wire.some((l) => l.endsWith(`EXAMINE "${SPACED}"`)), wire.join("\n"));
  assert.ok(wire.some((l) => new RegExp(`EXAMINE "?${NON_ASCII[1].replace(/[&-]/g, "\\$&")}"?$`).test(l)), wire.join("\n"));
  assert.equal(wire.some((l) => /\b(SELECT|UID MOVE|STORE|EXPUNGE|CLOSE)\b/i.test(l)), false, "the scan changes nothing");

  let reply = await callTool(context, "mail__dedupe_apply", { plan_id: scan.tier1.plan_id, expected_count: 2 });
  while (reply.status !== "done") reply = await callTool(context, "mail__dedupe_apply_continue", { plan_id: scan.tier1.plan_id });
  assert.equal(reply.moved, 2);
  assert.ok(wire.some((l) => l.endsWith(`SELECT "${SPACED}"`)), wire.join("\n"));
  assert.ok(wire.some((l) => /UID MOVE 5 "Deleted Messages"$/.test(l)), wire.join("\n"));
  assert.ok(wire.some((l) => /UID MOVE 7 "Deleted Messages"$/.test(l)), wire.join("\n"));
  assert.deepEqual([...boxes.get(SPACED)], [6]);
  assert.deepEqual([...boxes.get(NON_ASCII[1])], [8]);
  assert.equal(wire.some((l) => /\b(STORE|EXPUNGE|COPY)\b/i.test(l)), false, "only MOVE is used");
});

test("on a server with UIDPLUS and no MOVE, like iCloud, the scan finishes with nothing but reads on the wire", async (t) => {
  const { server: listener, wire, boxes, port } = await server("IMAP4rev1 UIDPLUS");
  t.after(() => listener.close());
  const context = { practiceDb: {}, mail: { credential: { host: "127.0.0.1", port, secure: false, username: "someone", password: "fake-password-0000-not-real" } } };

  let scan = await callTool(context, "mail__dedupe_scan", { folders: [SPACED, NON_ASCII[0]] });
  while (scan.status === "scanning") scan = await callTool(context, "mail__dedupe_scan", { scan_id: scan.scan_id });
  assert.equal(scan.status, "done");
  assert.equal(scan.can_move, false);
  assert.equal(scan.trash_folder, TRASH);
  assert.equal(scan.tier1.plan_id, null);
  assert.equal(scan.tier1.copies, 2);
  assert.ok(wire.some((l) => l.endsWith(`EXAMINE "${SPACED}"`)), wire.join("\n"));
  assert.equal(wire.some((l) => /\b(SELECT|COPY|STORE|EXPUNGE|MOVE)\b/i.test(l)), false, wire.join("\n"));
  assert.deepEqual([...boxes.get(SPACED)], [5, 6]);
  assert.deepEqual([...boxes.get(NON_ASCII[1])], [7, 8]);
});

test("a move without MOVE copies, flags and removes only its own UIDs, and never sends a bare EXPUNGE", async (t) => {
  const { server: listener, wire, boxes, port } = await server("IMAP4rev1 UIDPLUS");
  t.after(() => listener.close());
  const context = { practiceDb: {}, mail: { credential: { host: "127.0.0.1", port, secure: false, username: "someone", password: "fake-password-0000-not-real" } } };

  const result = await callTool(context, "mail__move_messages", { folder: SPACED, uids: [5], destination: TRASH });
  assert.deepEqual(result.moved, [{ uid: 5, newUid: 105 }]);
  assert.deepEqual(result.notMoved, []);
  assert.deepEqual([...boxes.get(SPACED)], [6]);
  assert.deepEqual([...boxes.get(TRASH)], [105]);

  const steps = [/UID COPY 5 "Deleted Messages"$/, /UID STORE 5 \+FLAGS/, /UID EXPUNGE 5$/].map((step) => wire.findIndex((l) => step.test(l)));
  assert.ok(steps.every((at, i) => at >= 0 && (i === 0 || at > steps[i - 1])), wire.join("\n"));
  assert.equal(wire.some((l) => /^\S+ EXPUNGE\b/i.test(l) || /\bUID MOVE\b/i.test(l)), false, wire.join("\n"));
});
