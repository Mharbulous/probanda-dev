// drafting_forms__read_message: /draft's reply route reads a .msg or .eml with its highlights.
// Every message is synthetic (helpers/msg-fixture.mjs); temp directories only, never a live matter.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { bin, lzfuLiterals, message, str } from "./helpers/msg-fixture.mjs";

const { readMessage, parseMessage } = await import("../build/correspondence/message.js");
const { decompressRtf } = await import("../build/correspondence/lzfu.js");
const { callTool } = await import("../build/dispatch.js");

const ARBITRATOR = { fromName: "Arbitrator Example", fromAddress: "arbitrator@example.test" };

const NATIVE_RTF =
  "{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0 Calibri;}}" +
  "{\\colortbl ;\\red255\\green255\\blue0;\\red0\\green255\\blue0;}" +
  "\\pard Counsel, please address {\\highlight1 the costs of the adjournment} and " +
  "{\\highlight2 whether the expert\\rquote s report is admitted} in your reply.\\par}";

const ENCAPSULATED_RTF =
  "{\\rtf1\\ansi\\ansicpg1252\\fromhtml1 \\deff0{\\fonttbl{\\f0\\fswiss Arial;}}" +
  "{\\*\\htmltag19 <html>}{\\*\\htmltag34 <body>}\\htmlrtf {\\pard\\plain \\htmlrtf0 " +
  "{\\*\\htmltag64 <p>}Please confirm {\\*\\htmltag84 <span style='background:yellow;mso-highlight:yellow'>}" +
  "the hearing length{\\*\\htmltag92 </span>} and {\\*\\htmltag84 <span style='mso-highlight:lime'>}" +
  "the order of witnesses{\\*\\htmltag92 </span>}.{\\*\\htmltag72 </p>}\\htmlrtf \\par }\\htmlrtf0 " +
  "{\\*\\htmltag58 </body>}{\\*\\htmltag27 </html>}}";

function matter(t) {
  const base = mkdtempSync(join(tmpdir(), "coclerk-read-message-"));
  t.after(() => rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const root = join(base, "L0000 Matter");
  for (const dir of ["0. DRAFT", "3. CORRESPONDENCE", "5. TRIBUNAL", "TRASH", "privileged"]) mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, "coclerk.json"), JSON.stringify({ schema_version: 5, case_data_dir: join(base, "case data") }));
  const outside = join(base, "Elsewhere");
  mkdirSync(outside);
  return { root: realpathSync.native(root), outside: realpathSync.native(outside) };
}

const nativeMsg = (sent = "2026-10-05T16:00:00Z", who = ARBITRATOR) =>
  message({ ...who, subject: "Re: Hearing", sent, to: [["Counsel One", "one@example.test"]], body: Object.fromEntries([bin(0x1009, lzfuLiterals(NATIVE_RTF))]) });

test("read_message: a .msg's native RTF highlights come back verbatim, with Word's colour names", () => {
  const m = parseMessage(nativeMsg(), ".msg");
  assert.equal(m.from, "Arbitrator Example <arbitrator@example.test>");
  assert.deepEqual(m.to, ["Counsel One <one@example.test>"]);
  assert.equal(m.subject, "Re: Hearing");
  assert.equal(m.sent, "2026-10-05T16:00:00.000Z");
  assert.equal(m.highlight_source, "rtf");
  assert.deepEqual(m.highlights, [
    { text: "the costs of the adjournment", colour: "yellow" },
    { text: "whether the expert’s report is admitted", colour: "bright green" },
  ]);
  assert.match(m.body, /^Counsel, please address the costs of the adjournment and whether/);
});

test("read_message: HTML encapsulated in a .msg's RTF gives its span highlights; the plain body is preferred for text", () => {
  const msg = message({
    ...ARBITRATOR,
    subject: "Hearing length",
    sent: "2026-10-05T17:00:00Z",
    body: Object.fromEntries([str(0x1000, "Please confirm the hearing length and the order of witnesses."), bin(0x1009, lzfuLiterals(ENCAPSULATED_RTF))]),
  });
  const m = parseMessage(msg, ".msg");
  assert.equal(m.body, "Please confirm the hearing length and the order of witnesses.");
  assert.equal(m.highlight_source, "html");
  assert.deepEqual(m.highlights, [
    { text: "the hearing length", colour: "yellow" },
    { text: "the order of witnesses", colour: "bright green" },
  ]);
});

test("read_message: a .msg's HTML body (PR_HTML) is read for highlights; block backgrounds are not highlights", () => {
  const html =
    "<html><head><style>p{margin:0}</style></head><body><table><tr><td style='background:#ffff00'>Signature box</td></tr></table>" +
    "<p>Counsel should address <span style=\"background-color: rgb(0, 255, 255)\">the late affidavit</span> &amp; <mark>costs</mark>.</p></body></html>";
  const msg = message({ ...ARBITRATOR, subject: "Late affidavit", sent: "2026-10-05T18:00:00Z", body: Object.fromEntries([bin(0x1013, Buffer.from(html, "utf-8"))]) });
  const m = parseMessage(msg, ".msg");
  assert.deepEqual(m.highlights, [
    { text: "the late affidavit", colour: "turquoise" },
    { text: "costs", colour: "yellow" },
  ]);
  assert.match(m.body, /Counsel should address the late affidavit & costs\./);
});

test("read_message: an .eml is parsed through MIME, quoted-printable and RFC 2047", () => {
  const eml = [
    "From: =?utf-8?Q?Arbitre_=C3=89xample?= <arbitrator@example.test>",
    "To: \"One, Counsel\" <one@example.test>, two@example.test",
    "Subject: =?utf-8?B?UmU6IEhlYXJpbmcg4oCUIGxlbmd0aA==?=",
    "Date: Mon, 05 Oct 2026 09:30:00 -0700",
    "MIME-Version: 1.0",
    'Content-Type: multipart/alternative; boundary="b1"',
    "",
    "--b1",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "Please address the =C3=A9vidence.",
    "--b1",
    'Content-Type: text/html; charset="utf-8"',
    "Content-Transfer-Encoding: quoted-printable",
    "",
    "<p>Please address <span style=3D\"background:yellow\">the =C3=A9vidence</span>.</p>",
    "--b1--",
    "",
  ].join("\r\n");
  const m = parseMessage(Buffer.from(eml, "latin1"), ".eml");
  assert.equal(m.from, "Arbitre Éxample <arbitrator@example.test>");
  assert.deepEqual(m.to, ["One, Counsel <one@example.test>", "two@example.test"]);
  assert.equal(m.subject, "Re: Hearing — length");
  assert.equal(m.sent, "2026-10-05T16:30:00.000Z");
  assert.equal(m.body.trim(), "Please address the évidence.");
  assert.deepEqual(m.highlights, [{ text: "the évidence", colour: "yellow" }]);
});

test("read_message: from picks the newest message, never one in 0. DRAFT, TRASH or privileged", async (t) => {
  const f = matter(t);
  writeFileSync(join(f.root, "3. CORRESPONDENCE", "older.msg"), nativeMsg("2026-10-01T10:00:00Z"));
  writeFileSync(join(f.root, "5. TRIBUNAL", "newest.msg"), nativeMsg("2026-10-05T16:00:00Z"));
  for (const dir of ["0. DRAFT", "TRASH", "privileged"]) writeFileSync(join(f.root, dir, "later.msg"), nativeMsg("2026-10-06T09:00:00Z"));
  writeFileSync(join(f.root, "3. CORRESPONDENCE", "other.msg"), nativeMsg("2026-10-06T08:00:00Z", { fromName: "Someone Else", fromAddress: "else@example.test" }));
  writeFileSync(join(f.root, "3. CORRESPONDENCE", "broken.msg"), Buffer.from("not a compound file"));

  const result = await callTool({}, "drafting_forms__read_message", { matter_root: f.root, from: "ARBITRATOR@example" });
  assert.equal(result.path, "5. TRIBUNAL\\newest.msg");
  assert.equal(result.highlights.length, 2);
  assert.deepEqual(result.other_candidates.map((c) => c.path), ["3. CORRESPONDENCE\\older.msg"]);
  assert.equal(result.scan_truncated, false);
  assert.throws(() => readMessage({ matter_root: f.root, from: "nobody" }), (err) => err.code === "no_match");
});

test("read_message: path is confined to the matter and its readable folders", async (t) => {
  const f = matter(t);
  writeFileSync(join(f.root, "3. CORRESPONDENCE", "a.msg"), nativeMsg());
  writeFileSync(join(f.root, "TRASH", "b.msg"), nativeMsg());
  writeFileSync(join(f.outside, "c.msg"), nativeMsg());
  writeFileSync(join(f.root, "3. CORRESPONDENCE", "d.pdf"), "%PDF-1.4");

  assert.equal(readMessage({ matter_root: f.root, path: "3. CORRESPONDENCE\\a.msg" }).subject, "Re: Hearing");
  assert.equal(readMessage({ matter_root: f.root, path: join(f.root, "3. CORRESPONDENCE", "a.msg") }).path, "3. CORRESPONDENCE\\a.msg");
  assert.throws(() => readMessage({ matter_root: f.root, path: join(f.outside, "c.msg") }), (err) => err.code === "path_out_of_scope");
  assert.throws(() => readMessage({ matter_root: f.root, path: "..\\Elsewhere\\c.msg" }), (err) => err.code === "path_out_of_scope");
  assert.throws(() => readMessage({ matter_root: f.root, path: "TRASH\\b.msg" }), (err) => err.code === "path_out_of_scope");
  assert.throws(() => readMessage({ matter_root: f.root, path: "3. CORRESPONDENCE\\d.pdf" }), (err) => err.code === "unsupported_extension");
  assert.throws(() => readMessage({ matter_root: f.root }), /exactly one of path or from/);
  await assert.rejects(callTool({}, "drafting_forms__read_message", { matter_root: f.root, path: "x.msg", folder: "y" }), /unknown field "folder"/);
});

test("lzfu: the [MS-OXRTFCP] worked example decompresses", () => {
  const compressed = Buffer.from(
    "2d0000002b0000004c5a4675f1c5c7a703000a00726370673132354232" + "0af32068656c090020627705b06c647d0a800fa0",
    "hex"
  );
  assert.equal(decompressRtf(compressed).toString("latin1"), "{\\rtf1\\ansi\\ansicpg1252\\pard hello world}\r\n");
});
