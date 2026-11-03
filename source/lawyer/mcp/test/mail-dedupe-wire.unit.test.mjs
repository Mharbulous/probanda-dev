// The mail__dedupe_* tools through the real ImapFlow, against a small IMAP server on loopback,
// because a fake client cannot see the wire. Folder names with spaces, slashes, parentheses and
// non-ASCII characters must reach the server correctly quoted and encoded. Synthetic data only.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

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

function imapServer() {
  const wire = [];
  const boxes = new Map([[SPACED, new Set([5, 6])], [NON_ASCII[1], new Set([7, 8])], [TRASH, new Set()]]);
  const unquote = (name) => name.replace(/^"|"$/g, "").replace(/\\(.)/g, "$1");
  const server = createServer((socket) => {
    let open;
    let buffered = "";
    socket.write("* OK [CAPABILITY IMAP4rev1 MOVE UIDPLUS] ready\r\n");
    socket.on("error", () => {});
    socket.on("data", (chunk) => {
      buffered += chunk.toString("latin1");
      let end;
      while ((end = buffered.indexOf("\r\n")) >= 0) {
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        const [, tag, command, rest = ""] = /^(\S+) (\S+)(?: (.*))?$/.exec(line) ?? [];
        if (!tag) continue;
        wire.push(line);
        const done = (text = "done") => socket.write(`${tag} OK ${text}\r\n`);
        const verb = command.toUpperCase();
        if (verb === "CAPABILITY") {
          socket.write("* CAPABILITY IMAP4rev1 MOVE UIDPLUS\r\n");
          done();
        } else if (verb === "LOGIN") {
          done("[CAPABILITY IMAP4rev1 MOVE UIDPLUS] signed in");
        } else if (verb === "LIST" || verb === "LSUB") {
          // An empty pattern asks only for the separator, and `INBOX` is its own question.
          if (/ ""$/.test(rest)) socket.write(`* ${verb} (\\Noselect) "/" ""\r\n`);
          else if (/ "\*"$/.test(rest)) {
            for (const name of boxes.keys()) {
              socket.write(`* ${verb} (\\HasNoChildren${name === TRASH ? " \\Trash" : ""}) "/" "${name}"\r\n`);
            }
          }
          done();
        } else if (verb === "EXAMINE" || verb === "SELECT") {
          open = unquote(rest);
          socket.write(`* ${boxes.get(open).size} EXISTS\r\n* OK [UIDVALIDITY 42] ok\r\n* OK [UIDNEXT 100] ok\r\n* FLAGS ()\r\n`);
          done(`[${verb === "EXAMINE" ? "READ-ONLY" : "READ-WRITE"}] opened`);
        } else if (verb === "UID" && /^SEARCH/i.test(rest)) {
          const asked = /UID ([\d,]+)/i.exec(rest)?.[1]?.split(",").map(Number);
          const uids = [...boxes.get(open)].filter((u) => !asked || asked.includes(u));
          socket.write(`* SEARCH${uids.map((u) => ` ${u}`).join("")}\r\n`);
          done();
        } else if (verb === "UID" && /^FETCH/i.test(rest)) {
          const uid = Number(/^FETCH (\d+)/i.exec(rest)[1]);
          if (boxes.get(open).has(uid)) {
            socket.write(`* 1 FETCH (UID ${uid} ENVELOPE ${ENVELOPE} INTERNALDATE "02-Nov-2026 10:00:00 +0000" BODY[] {${MESSAGE.length}}\r\n`);
            socket.write(MESSAGE);
            socket.write(")\r\n");
          }
          done();
        } else if (verb === "UID" && /^MOVE/i.test(rest)) {
          const [, range] = /^MOVE (\S+) /i.exec(rest);
          for (const uid of range.split(",").map(Number)) boxes.get(open).delete(uid);
          done("moved");
        } else if (verb === "LOGOUT") {
          socket.write("* BYE bye\r\n");
          done();
          socket.end();
        } else {
          done();
        }
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, wire, boxes, port: server.address().port })));
}

test("folder names reach the server quoted and encoded, on the read-only scan and on the move", async (t) => {
  const { server, wire, boxes, port } = await imapServer();
  t.after(() => server.close());
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
