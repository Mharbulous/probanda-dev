// The mail__* tools (src/mail/tools.ts) against a fake IMAP client: no network,
// no real mailbox and no real credential. Every value is fake, and the state
// folder is a temp one, so no test can write into the real credential file.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";

const STATE_DIR = mkdtempSync(join(tmpdir(), "coclerk-mail-tools-"));
const SAVED_LOCALAPPDATA = process.env.LOCALAPPDATA;
process.env.LOCALAPPDATA = STATE_DIR;
after(() => {
  if (SAVED_LOCALAPPDATA === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = SAVED_LOCALAPPDATA;
  rmSync(STATE_DIR, { recursive: true, force: true });
});

const { callContactsCalendarsEmailTool: callTool, dispatchContactsCalendarsEmailTool: dispatchTool } = await import("../build/contacts-calendars-email-dispatch.js");
const { buildToolDefinitions, buildFileManagerToolDefinitions, buildContactsCalendarsEmailToolDefinitions } = await import("../build/schema-gen.js");
const { credentialPath } = await import("../build/mail/config.js");

const MAIL_SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "mail");
const FAKE_PASSWORD = "fake-password-0000-not-real";
const FAKE = { host: "imap.example.test", port: 993, secure: true, username: "someone", password: FAKE_PASSWORD };

// The same synthetic message as correspondence-message.unit.test.mjs's .eml test.
const EML = [
  "From: =?utf-8?Q?Arbitre_=C3=89xample?= <arbitrator@example.test>",
  "To: \"One, Counsel\" <one@example.test>, two@example.test",
  "Subject: =?utf-8?B?UmU6IEhlYXJpbmcg4oCUIGxlbmd0aA==?=",
  "Date: Mon, 05 Oct 2026 09:30:00 -0700",
  "Message-ID: <draft-1@example.test>",
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

function tempDir(t, prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const asyncList = (items) => (async function* () { yield* items; })();

// A scripted IMAP client that records every call. Methods not overridden answer
// with empty results.
function fakeClient(script = {}) {
  const calls = [];
  const record = (name, ...args) => calls.push({ name, args });
  const client = {
    calls,
    capabilities: script.capabilities ?? new Map(),
    names: () => calls.map((c) => c.name),
    async connect() { record("connect"); },
    async logout() { record("logout"); },
    close() { record("close"); },
    async list() { record("list"); return script.folders ?? []; },
    async status(path, query) { record("status", path, query); return script.status ?? { messages: 0, unseen: 0 }; },
    async mailboxOpen(path, options) { record("mailboxOpen", path, options); return { exists: script.exists ?? 0 }; },
    fetch(range, query, options) { record("fetch", range, query, options); return script.fetch ? script.fetch(range, query) : asyncList([]); },
    async fetchOne(seq, query, options) { record("fetchOne", seq, query, options); return script.fetchOne?.(seq, query); },
    async search(query, options) { record("search", query, options); return script.search ?? []; },
    async download(range, part, options) { record("download", range, part, options); return script.download(range, part); },
    async append(path, content, flags) { record("append", path, content, flags); return { destination: path, uid: 77 }; },
    async mailboxCreate(path) { record("mailboxCreate", path); return { path, created: true }; },
    async mailboxRename(path, newPath) { record("mailboxRename", path, newPath); return { path, newPath }; },
    async messageMove(range, destination, options) { record("messageMove", range, destination, options); return false; },
  };
  return Object.assign(client, script.methods ?? {});
}

function context(client, credential = FAKE, extra = {}) {
  return { practiceDb: {}, mail: { credential: credential && { ...credential } }, imapFactory: () => client, ...extra };
}

async function errorOf(context_, name, args) {
  const result = await dispatchTool(context_, name, args);
  assert.equal(result.isError, true, result.content[0].text);
  return JSON.parse(result.content[0].text).error;
}

test("list_folders with a prefix returns only that tree and counts every folder", async () => {
  const client = fakeClient({
    folders: [
      { path: "INBOX", specialUse: "\\Inbox", flags: new Set() },
      { path: "3. OPEN  FILES", flags: new Set(["\\Noselect"]) },
      { path: "3. OPEN  FILES/L1234 Example", flags: new Set() },
      { path: "3. OPEN FILES single space", flags: new Set() },
      { path: "Sent Messages", specialUse: "\\Sent", flags: new Set() },
    ],
  });
  const result = await callTool(context(client), "mail__list_folders", { prefix: "3. open  files" });
  assert.deepEqual(result, {
    folders: [
      { name: "3. OPEN  FILES", specialUse: undefined, selectable: false },
      { name: "3. OPEN  FILES/L1234 Example", specialUse: undefined, selectable: true },
    ],
    total: 5,
    returned: 2,
  });
  assert.deepEqual(client.names(), ["connect", "list", "logout"]);
});

// A server that refuses every folder but its one real one, as an IMAP server refuses a name it does not hold.
function refusingClient(folders, real) {
  const refuse = (path) => {
    if (path !== real) throw Object.assign(new Error("Command failed"), { responseText: "Mailbox does not exist" });
  };
  return fakeClient({
    folders,
    methods: {
      async mailboxOpen(path) { refuse(path); return { exists: 0 }; },
      async status(path) { refuse(path); return { messages: 0, unseen: 0 }; },
    },
  });
}

const MATTER_FOLDERS = [
  { path: "1. OPEN FILES", delimiter: "/", flags: new Set(["\\Noselect"]) },
  { path: "1. OPEN FILES/L1234 Example", delimiter: "/", flags: new Set() },
  { path: "2. CLOSED FILES/L1234 Example", delimiter: "/", flags: new Set() },
  { path: "1. OPEN FILES/L5678 Other", delimiter: "/", flags: new Set() },
];

test("a folder named by its leaf is refused with its full name, on every read that names a folder", async () => {
  const folders = MATTER_FOLDERS.filter((f) => !f.path.startsWith("2."));
  for (const [tool, args] of [
    ["mail__search_emails", {}],
    ["mail__folder_status", {}],
    ["mail__get_latest_emails", {}],
    ["mail__get_email", { uid: 1 }],
    ["mail__find_thread_messages", { uid: 1 }],
  ]) {
    const error = await errorOf(context(refusingClient(folders, "1. OPEN FILES/L1234 Example")), tool, { ...args, folder: "L1234 Example" });
    assert.equal(error.code, "mail_not_found", tool);
    assert.equal(error.message, 'no folder named "L1234 Example"; folders with that last segment: "1. OPEN FILES/L1234 Example"', tool);
  }
});

test("a leaf name that two folders share names both and searches neither", async () => {
  const client = refusingClient(MATTER_FOLDERS, "1. OPEN FILES/L1234 Example");
  const error = await errorOf(context(client), "mail__search_emails", { folder: "l1234  example" });
  assert.equal(error.code, "mail_not_found");
  assert.match(error.message, /"1\. OPEN FILES\/L1234 Example", "2\. CLOSED FILES\/L1234 Example"$/);
  assert.equal(client.names().includes("search"), false);
});

test("a wrong parent gets the full name; a name no folder ends in gets no guess", async () => {
  const wrongParent = await errorOf(context(refusingClient(MATTER_FOLDERS, "x")), "mail__search_emails", { folder: "OPEN/L5678 Other" });
  assert.match(wrongParent.message, /"1\. OPEN FILES\/L5678 Other"$/);
  const unknown = await errorOf(context(refusingClient(MATTER_FOLDERS, "x")), "mail__search_emails", { folder: "L9999" });
  assert.deepEqual([unknown.code, unknown.message], ["mail_not_found", 'no folder named "L9999"; take the exact name from mail__list_folders']);
});

test("a listed folder the server still refuses keeps the server's own error, and so does a failed list", async () => {
  const listed = await errorOf(context(refusingClient(MATTER_FOLDERS, "x")), "mail__search_emails", { folder: "1. OPEN FILES/L5678 Other" });
  assert.equal(listed.code, "mail_error");
  assert.match(listed.message, /Mailbox does not exist/);

  const client = refusingClient(MATTER_FOLDERS, "x");
  client.list = async () => { throw new Error("connection lost"); };
  const noList = await errorOf(context(client), "mail__search_emails", { folder: "L1234 Example" });
  assert.equal(noList.code, "mail_error");
  assert.match(noList.message, /Mailbox does not exist/);
});

test("search_emails builds the search criteria and returns the ingest shape", async () => {
  const message = (uid, iso, cc) => ({
    uid,
    envelope: {
      date: new Date(iso),
      subject: `Subject ${uid}`,
      messageId: `<m${uid}@example.test>`,
      from: [{ name: "Sender Example", address: "sender@example.test" }],
      to: [{ address: "to@example.test" }],
      cc,
    },
    flags: new Set(["\\Seen"]),
    size: 100 + uid,
  });
  const client = fakeClient({
    search: [3, 1, 2],
    fetch: () => asyncList([message(1, "2026-10-05T10:00:00Z", []), message(2, "2026-10-05T12:00:00Z", [{ address: "cc@example.test" }]), message(3, "2026-10-04T09:00:00Z")]),
  });
  const result = await callTool(context(client), "mail__search_emails", {
    folder: "Sent Messages",
    from: "sender",
    since: "2026-10-04",
    before: "2026-10-07",
    limit: 500,
  });
  const search = client.calls.find((c) => c.name === "search");
  assert.deepEqual(search.args, [
    { from: "sender", since: new Date(Date.UTC(2026, 9, 4)), before: new Date(Date.UTC(2026, 9, 7)) },
    { uid: true },
  ]);
  assert.deepEqual(client.calls.find((c) => c.name === "mailboxOpen").args, ["Sent Messages", { readOnly: true }]);
  const fetch = client.calls.find((c) => c.name === "fetch");
  assert.deepEqual(fetch.args[0], [1, 2, 3]);
  assert.equal(fetch.args[1].source, false);
  assert.equal(result.totalFound, 3);
  assert.equal(result.returned, 3);
  assert.deepEqual(result.messages.map((m) => m.uid), [2, 1, 3]);
  assert.deepEqual(result.messages[1], {
    uid: 1,
    folder: "Sent Messages",
    date: "2026-10-05T10:00:00.000Z",
    from: "Sender Example <sender@example.test>",
    to: ["to@example.test"],
    subject: "Subject 1",
    messageId: "<m1@example.test>",
    seen: true,
    size: 101,
  });
  assert.equal("cc" in result.messages[1], false);
  assert.deepEqual(result.messages[0].cc, ["cc@example.test"]);

  const all = fakeClient();
  await callTool(context(all), "mail__search_emails", {});
  assert.deepEqual(all.calls.find((c) => c.name === "search").args[0], { all: true });
  await assert.rejects(callTool(context(fakeClient()), "mail__search_emails", { since: "2026-02-31" }), /since must be a date/);
});

test("get_email with strip_quoted and strip_inline_images returns only the newest message's text", async () => {
  const source = [
    "From: Example Sender <sender@example.test>",
    "To: someone@example.test",
    "Subject: Re: Hearing",
    "Date: Mon, 05 Oct 2026 09:30:00 -0700",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Newest reply text.",
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAE=",
    "Signature Line",
    "",
    "On Sun, Oct 4, 2026 at 8:00 AM Earlier Writer <earlier@example.test> wrote:",
    "> The earlier message.",
    "> data:image/png;base64,AAAA",
    "",
  ].join("\r\n");
  const client = fakeClient({
    fetchOne: () => ({
      uid: 5,
      source: Buffer.from(source, "utf-8"),
      flags: new Set(["\\Seen"]),
      envelope: { messageId: "<r5@example.test>", subject: "Re: Hearing", from: [{ address: "sender@example.test" }], to: [{ address: "someone@example.test" }] },
      bodyStructure: { type: "text/plain", part: "1" },
    }),
  });
  const result = await callTool(context(client), "mail__get_email", { uid: 5, strip_quoted: true, strip_inline_images: true });
  assert.equal(result.body, "Newest reply text.\n\nSignature Line");
  assert.equal(result.body.includes("data:image"), false);
  assert.equal(result.strippedQuoted, true);
  assert.equal(result.strippedInlineImages, 1);
  assert.deepEqual(result.attachments, []);
  assert.deepEqual(result.cc, []);
  assert.equal(result.messageId, "<r5@example.test>");
  assert.deepEqual(client.calls.find((c) => c.name === "mailboxOpen").args, ["INBOX", { readOnly: true }]);
});

test("a call the server never answers fails mail_timeout within the timeout and closes the connection", async () => {
  const never = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) };
  const client = fakeClient({ exists: 5, fetch: () => never });
  const started = Date.now();
  const error = await errorOf(context(client, FAKE, { mailTimeoutMs: 50 }), "mail__get_latest_emails", {});
  assert.equal(error.code, "mail_timeout");
  assert.match(error.message, /did not answer within 50 ms .*connection was closed/);
  assert.ok(client.names().includes("close"));
  assert.ok(Date.now() - started < 2000);
});

test("with no credential every mail tool that opens a connection on its first call refuses mail_not_configured", async (t) => {
  const dir = tempDir(t, "coclerk-mail-unconfigured-");
  const eml = join(dir, "draft.eml");
  writeFileSync(eml, EML, "latin1");
  const ctx = { practiceDb: {}, mail: { credential: null }, imapFactory: () => assert.fail("no connection may be opened") };
  const calls = {
    mail__list_folders: {},
    mail__folder_status: {},
    mail__get_latest_emails: {},
    mail__search_emails: {},
    mail__get_email: { uid: 1 },
    mail__download_attachment: { uid: 1, index: 0, save_dir: dir },
    mail__save_message: { uid: 1, save_dir: dir },
    mail__list_headers: { folder: "INBOX" },
    mail__find_email_by_message_id: { message_id: "<x@example.test>" },
    mail__find_thread_messages: { uid: 1 },
    mail__save_draft: { eml_path: eml },
    mail__create_folder: { name: "Sorted" },
    mail__rename_folder: { folder: "Sorted", new_name: "Filed" },
    mail__move_messages: { folder: "INBOX", uids: [1], destination: "Sorted" },
    mail__dedupe_scan: { all: true },
  };
  for (const [name, args] of Object.entries(calls)) {
    const error = await errorOf(ctx, name, args);
    assert.equal(error.code, "mail_not_configured", name);
    assert.match(error.message, /mail__configure_credential/, name);
  }
  const status = await callTool(ctx, "mail__configure_status", {});
  assert.deepEqual(status, {
    configured: false,
    host: null,
    port: null,
    username: null,
    from_address: null,
    password_set: false,
    dav_username: null,
    caldav_url: null,
    carddav_url: null,
    timezone: null,
    calendar_configured: false,
    contacts_configured: false,
  });
});

test("configure_credential refuses a password argument, so a password never passes through a tool call", async () => {
  const ctx = context(fakeClient(), null);
  const error = await errorOf(ctx, "mail__configure_credential", { host: "imap.example.test", username: "someone", password: FAKE_PASSWORD });
  assert.match(error.message, /unknown field "password"/);
  assert.equal(error.message.includes(FAKE_PASSWORD), false);
  assert.equal(ctx.mail.credential, null);
});

const postSecret = (url, secret) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ secret }) });

test("the sign-in page saves nothing on a refused sign-in, saves on a good one, and never shows the password", async () => {
  const refused = fakeClient({
    methods: {
      async connect() {
        throw Object.assign(new Error("Command failed"), { authenticationFailed: true, responseText: "Authentication failed." });
      },
    },
  });
  const previous = { ...FAKE, username: "earlier" };
  const ctx = context(refused, previous);
  const args = { host: "imap.example.test", username: "someone" };
  const started = await callTool(ctx, "mail__configure_credential", args);
  assert.equal(started.status, "awaiting_password");
  assert.match(started.url, /^http:\/\/127\.0\.0\.1:\d+\/mail\/[0-9a-f]{48}$/);
  assert.deepEqual(ctx.mail.credential, previous, "nothing changes until the page is used");

  const form = await fetch(started.url);
  assert.equal(form.status, 200);
  const formHtml = await form.text();
  assert.match(formHtml, /imap\.example\.test:993/);
  assert.match(formHtml, /type="password" name="secret"/);

  const refusedPage = await (await postSecret(started.url, FAKE_PASSWORD)).text();
  assert.match(refusedPage, /Not saved: .*refused the sign-in/);
  assert.equal(refusedPage.includes(FAKE_PASSWORD), false);
  assert.deepEqual(ctx.mail.credential, previous);
  assert.equal(existsSync(credentialPath(process.env)), false);

  const ok = fakeClient({ status: { messages: 12, unseen: 3 } });
  const fresh = context(ok, null);
  const second = await callTool(fresh, "mail__configure_credential", { ...args, from_address: "someone@example.test" });
  assert.equal((await fetch(started.url)).status, 404, "a newer link retires the older one");
  const savedPage = await (await postSecret(second.url, FAKE_PASSWORD)).text();
  assert.match(savedPage, /Signed in\. 12 messages in the inbox\./);
  assert.equal(savedPage.includes(FAKE_PASSWORD), false);
  assert.deepEqual(fresh.mail.credential, { ...FAKE, fromAddress: "someone@example.test" });
  assert.deepEqual(ok.calls.find((c) => c.name === "status").args, ["INBOX", { messages: true, unseen: true }]);
  assert.equal((await fetch(second.url)).status, 404, "a successful save spends the link");

  const status = await callTool(fresh, "mail__configure_status", {});
  assert.equal(status.password_set, true);
  assert.equal(JSON.stringify(status).includes(FAKE_PASSWORD), false);
});

test("the sign-in page hints at the Apple ID exactly when an iCloud host has a username outside icloud.com, me.com and mac.com", async () => {
  const hint = /iCloud Mail signs in with your Apple ID/;
  const pageFor = async (host, username) => {
    const started = await callTool(context(fakeClient(), null), "mail__configure_credential", { host, username });
    return (await fetch(started.url)).text();
  };
  assert.match(await pageFor("imap.mail.me.com", "name@example.com"), hint);
  assert.match(await pageFor("IMAP.mail.me.com", "name"), hint);
  for (const username of ["name@icloud.com", "name@me.com", "Name@Mac.com"]) {
    assert.doesNotMatch(await pageFor("imap.mail.me.com", username), hint, username);
  }
  assert.doesNotMatch(await pageFor("imap.example.test", "name@example.com"), hint);
});

test("save_draft appends the .eml to Drafts with \\Draft and \\Seen and writes nothing else", async (t) => {
  const dir = tempDir(t, "coclerk-mail-draft-");
  const eml = join(dir, "draft.eml");
  writeFileSync(eml, EML, "latin1");
  const client = fakeClient({
    folders: [
      { path: "INBOX", flags: new Set() },
      { path: "Drafts", specialUse: "\\Drafts", flags: new Set() },
    ],
  });
  const result = await callTool(context(client), "mail__save_draft", { eml_path: eml });
  assert.deepEqual(result, { saved: true, folder: "Drafts", uid: 77, messageId: "<draft-1@example.test>" });
  const appends = client.calls.filter((c) => c.name === "append");
  assert.equal(appends.length, 1);
  assert.equal(appends[0].args[0], "Drafts");
  assert.deepEqual(appends[0].args[1], readFileSync(eml));
  assert.deepEqual(appends[0].args[2], ["\\Draft", "\\Seen"]);
  assert.deepEqual(client.names(), ["connect", "list", "append", "logout"]);

  const notMail = join(dir, "notes.eml");
  writeFileSync(notMail, "just some words\r\n\r\nno headers here");
  const error = await errorOf(context(fakeClient()), "mail__save_draft", { eml_path: notMail });
  assert.equal(error.code, "not_a_message");
});

test("download_attachment writes the part under save_dir, never overwrites, and refuses a missing save_dir", async (t) => {
  const dir = tempDir(t, "coclerk-mail-attach-");
  const structure = {
    type: "multipart/mixed",
    childNodes: [
      { part: "1", type: "text/plain" },
      { part: "2", type: "text/plain", disposition: "attachment", dispositionParameters: { filename: "notes.txt" }, size: 11 },
    ],
  };
  const script = () => ({
    fetchOne: () => ({ uid: 9, bodyStructure: structure }),
    download: () => ({ content: Readable.from([Buffer.from("hello "), Buffer.from("world")]) }),
  });
  const first = fakeClient(script());
  const one = await callTool(context(first), "mail__download_attachment", { uid: 9, filename: "notes.txt", save_dir: dir });
  assert.equal(one.path, join(dir, "notes.txt"));
  assert.equal(readFileSync(one.path, "utf-8"), "hello world");
  assert.equal(one.size, 11);
  assert.deepEqual(first.calls.find((c) => c.name === "download").args, ["9", "2", { uid: true }]);

  const two = await callTool(context(fakeClient(script())), "mail__download_attachment", { uid: 9, index: 0, save_dir: dir });
  assert.equal(two.path, join(dir, "notes (1).txt"));
  assert.deepEqual(readdirSync(dir).sort(), ["notes (1).txt", "notes.txt"]);
  assert.equal(readFileSync(one.path, "utf-8"), "hello world");

  const missing = await errorOf(context(fakeClient(script())), "mail__download_attachment", { uid: 9, index: 0, save_dir: join(dir, "no-such-folder") });
  assert.match(missing.message, /save_dir must be the absolute path of an existing folder/);
});

test("list_headers hashes the bytes the server sent, and saves them under the same hash", async (t) => {
  const dir = tempDir(t, "coclerk-mail-list-");
  const source = Buffer.from(EML, "latin1");
  const client = fakeClient({
    fetchOne: () => ({ uid: 9, source, flags: new Set(), envelope: { messageId: "<draft-1@example.test>" } }),
    search: [9],
    methods: { async mailboxOpen() { return { exists: 1, uidValidity: 5n, uidNext: 10 }; } },
  });
  const listed = await callTool(context(client), "mail__list_headers", { folder: "INBOX" });
  const { messages: [m], uidValidity, uidNext } = JSON.parse(readFileSync(listed.list_path, "utf-8"));
  assert.deepEqual([uidValidity, uidNext], ["5", 10]);
  assert.equal(m.raw_sha256, createHash("sha256").update(source).digest("hex"));
  assert.equal(m.size, source.length);
  const saved = await callTool(context(client), "mail__save_message", { uid: 9, save_dir: dir });
  assert.equal(saved.sha256, m.raw_sha256);
});

test("save_message writes the message's stored bytes, reports their sha256, never overwrites, and refuses a missing save_dir", async (t) => {
  const dir = tempDir(t, "coclerk-mail-save-");
  const source = Buffer.from(EML, "latin1");
  const script = () => ({
    fetchOne: () => ({ uid: 9, source, envelope: { messageId: "<m9@example.test>", subject: "Re: Smith/Jones: costs" } }),
  });
  const first = fakeClient(script());
  const one = await callTool(context(first), "mail__save_message", { uid: 9, save_dir: dir });
  assert.equal(one.path, join(dir, "Re_ Smith_Jones_ costs.eml"));
  assert.equal(one.filename, "Re_ Smith_Jones_ costs.eml");
  assert.ok(readFileSync(one.path).equals(source), "the saved file is the stored message, byte for byte");
  assert.equal(one.size, source.length);
  assert.equal(one.sha256, createHash("sha256").update(readFileSync(one.path)).digest("hex"));
  assert.equal(one.messageId, "<m9@example.test>");
  assert.deepEqual(first.calls.find((c) => c.name === "mailboxOpen").args, ["INBOX", { readOnly: true }]);

  const two = await callTool(context(fakeClient(script())), "mail__save_message", { uid: 9, save_dir: dir });
  assert.equal(two.filename, "Re_ Smith_Jones_ costs (1).eml");
  assert.ok(readFileSync(one.path).equals(source), "the first copy is untouched");

  const unnamed = fakeClient({ fetchOne: () => ({ uid: 4, source, envelope: {} }) });
  assert.equal((await callTool(context(unnamed), "mail__save_message", { uid: 4, save_dir: dir })).filename, "message-4.eml");

  const gone = await errorOf(context(fakeClient()), "mail__save_message", { uid: 5, save_dir: dir });
  assert.equal(gone.code, "mail_not_found");
  const missing = await errorOf(context(fakeClient(script())), "mail__save_message", { uid: 9, save_dir: join(dir, "no-such-folder") });
  assert.match(missing.message, /mail__save_message\.save_dir must be the absolute path of an existing folder/);
});

const FOLDERS = [
  { path: "INBOX", specialUse: "\\Inbox", delimiter: "/", flags: new Set() },
  { path: "Clients", delimiter: "/", flags: new Set() },
  { path: "Clients/Example", delimiter: "/", flags: new Set() },
  { path: "Deleted Items", specialUse: "\\Trash", delimiter: "/", flags: new Set() },
  { path: "Archive", specialUse: "\\Archive", delimiter: "/", flags: new Set() },
  { path: "Group", delimiter: "/", flags: new Set(["\\Noselect"]) },
];

// A source folder holding `uids`, on a server with `caps`. The move takes
// messages out of it; search reports what is still there. `copyReply` overrides
// what the copy step answers, from the UIDs it copied.
function mailboxClient(uids, caps, copyReply) {
  const box = new Set(uids);
  const pick = (range) => String(range).split(",").map(Number).filter((u) => box.has(u));
  const client = fakeClient({ folders: FOLDERS, capabilities: new Map(caps.map((c) => [c, true])) });
  return Object.assign(client, {
    box,
    async search(query, options) { client.calls.push({ name: "search", args: [query, options] }); return pick(query.uid); },
    async messageMove(range, destination, options) {
      client.calls.push({ name: "messageMove", args: [range, destination, options] });
      const moved = pick(range);
      for (const u of moved) box.delete(u);
      return { destination, uidMap: new Map(moved.map((u) => [u, u + 100])) };
    },
    async messageCopy(range, destination, options) {
      client.calls.push({ name: "messageCopy", args: [range, destination, options] });
      const copied = pick(range);
      return copyReply ? copyReply(copied, destination) : { destination, uidMap: new Map(copied.map((u) => [u, u + 100])) };
    },
    async messageDelete(range, options) {
      client.calls.push({ name: "messageDelete", args: [range, options] });
      for (const u of pick(range)) box.delete(u);
      return true;
    },
  });
}

const writableOpens = (client) => client.calls.filter((c) => c.name === "mailboxOpen" && c.args[1].readOnly === false);

test("move_messages with MOVE takes only the named UIDs out of the folder and reports the missing one", async () => {
  const client = mailboxClient([1, 2, 3, 4, 5], ["MOVE", "UIDPLUS"]);
  const result = await callTool(context(client), "mail__move_messages", { folder: "INBOX", uids: [4, 2, 9, 2], destination: "Deleted Items" });
  assert.deepEqual([...client.box].sort(), [1, 3, 5]);
  assert.deepEqual(result, {
    folder: "INBOX",
    destination: "Deleted Items",
    moved: [{ uid: 2, newUid: 102 }, { uid: 4, newUid: 104 }],
    notFound: [9],
    notMoved: [],
  });
  assert.deepEqual(client.calls.find((c) => c.name === "messageMove").args, ["2,4", "Deleted Items", { uid: true }]);
  assert.equal(writableOpens(client).length, 1);
});

test("move_messages without MOVE copies, then removes only the named UIDs, including into Trash", async () => {
  for (const destination of ["Clients", "Deleted Items"]) {
    const client = mailboxClient([1, 2, 3, 4, 5], ["UIDPLUS"]);
    const result = await callTool(context(client), "mail__move_messages", { folder: "INBOX", uids: [4, 2, 9, 2], destination });
    assert.deepEqual([...client.box].sort(), [1, 3, 5]);
    assert.deepEqual(result, {
      folder: "INBOX",
      destination,
      moved: [{ uid: 2, newUid: 102 }, { uid: 4, newUid: 104 }],
      notFound: [9],
      notMoved: [],
    });
    assert.deepEqual(client.calls.find((c) => c.name === "messageCopy").args, ["2,4", destination, { uid: true }]);
    assert.deepEqual(client.calls.find((c) => c.name === "messageDelete").args, ["2,4", { uid: true }]);
    assert.ok(client.names().indexOf("messageCopy") < client.names().indexOf("messageDelete"));
    assert.equal(client.names().includes("messageMove"), false);
  }
});

test("move_messages without MOVE leaves every source in place when the copy fails or is not confirmed", async () => {
  for (const [label, reply] of [
    ["refused", () => false],
    ["no COPYUID", (_copied, destination) => ({ destination })],
    ["partial COPYUID", (_copied, destination) => ({ destination, uidMap: new Map([[1, 101]]) })],
  ]) {
    const client = mailboxClient([1, 2], ["UIDPLUS"], reply);
    const error = await errorOf(context(client), "mail__move_messages", { folder: "INBOX", uids: [1, 2], destination: "Clients" });
    assert.equal(error.code, "mail_error", label);
    assert.deepEqual(client.box, new Set([1, 2]), label);
    assert.equal(client.names().includes("messageDelete"), false, label);
    assert.equal(client.names().includes("messageMove"), false, label);
  }
});

test("move_messages refuses a server with neither MOVE nor UIDPLUS before changing anything", async () => {
  const client = mailboxClient([1, 2], []);
  const error = await errorOf(context(client), "mail__move_messages", { folder: "INBOX", uids: [1], destination: "Clients" });
  assert.equal(error.code, "mail_move_unsupported");
  assert.deepEqual(client.box, new Set([1, 2]));
  assert.equal(writableOpens(client).length, 0);
  for (const name of ["messageMove", "messageCopy", "messageDelete"]) assert.equal(client.names().includes(name), false, name);
});

test("move_messages refuses a missing or folder-only destination, the same folder, and bad UIDs, before any write", async () => {
  for (const [args, code] of [
    [{ folder: "INBOX", uids: [1], destination: "Nowhere" }, "mail_not_found"],
    [{ folder: "INBOX", uids: [1], destination: "Group" }, "mail_not_selectable"],
    [{ folder: "inbox", uids: [1], destination: "INBOX" }, "validation_error"],
    [{ folder: "INBOX", uids: [], destination: "Clients" }, "validation_error"],
    [{ folder: "INBOX", uids: [0], destination: "Clients" }, "validation_error"],
    [{ folder: "INBOX", uids: [7], destination: "Clients" }, "mail_not_found"],
  ]) {
    const client = mailboxClient([1], ["MOVE"]);
    const error = await errorOf(context(client), "mail__move_messages", args);
    if (code !== "validation_error") assert.equal(error.code, code, JSON.stringify(args));
    else assert.match(error.message, /mail__move_messages\./, JSON.stringify(args));
    assert.deepEqual(client.box, new Set([1]));
    assert.equal(client.names().includes("messageMove"), false);
  }
});

test("create_folder makes a top-level folder or a subfolder and refuses a taken name or a missing parent", async () => {
  const top = fakeClient({ folders: FOLDERS });
  assert.deepEqual(await callTool(context(top), "mail__create_folder", { name: "Duplicates" }), { created: true, path: "Duplicates" });
  assert.deepEqual(top.names(), ["connect", "list", "mailboxCreate", "logout"]);

  const sub = fakeClient({ folders: FOLDERS });
  assert.deepEqual(await callTool(context(sub), "mail__create_folder", { name: "Other", parent: "Clients" }), { created: true, path: "Clients/Other" });

  for (const [args, code] of [
    [{ name: "Example", parent: "Clients" }, "mail_folder_exists"],
    [{ name: "x", parent: "Nowhere" }, "mail_not_found"],
  ]) {
    const client = fakeClient({ folders: FOLDERS });
    assert.equal((await errorOf(context(client), "mail__create_folder", args)).code, code);
    assert.equal(client.names().includes("mailboxCreate"), false);
  }
  const nested = await errorOf(context(fakeClient({ folders: FOLDERS })), "mail__create_folder", { name: "a/b" });
  assert.match(nested.message, /pass parent to create a subfolder/);
});

test("rename_folder renames an ordinary folder and refuses INBOX, a special-use folder and a taken name", async () => {
  const client = fakeClient({ folders: FOLDERS });
  assert.deepEqual(await callTool(context(client), "mail__rename_folder", { folder: "Clients/Example", new_name: "Clients/Closed" }), {
    renamed: true,
    from: "Clients/Example",
    to: "Clients/Closed",
  });
  assert.deepEqual(client.calls.find((c) => c.name === "mailboxRename").args, ["Clients/Example", "Clients/Closed"]);

  for (const [folder, newName, code] of [
    ["INBOX", "Old inbox", "mail_protected_folder"],
    ["inbox", "Old inbox", "mail_protected_folder"],
    ["Deleted Items", "Bin", "mail_protected_folder"],
    ["Archive", "Old", "mail_protected_folder"],
    ["Clients", "Archive", "mail_folder_exists"],
    ["Nowhere", "Somewhere", "mail_not_found"],
  ]) {
    const refused = fakeClient({ folders: FOLDERS });
    assert.equal((await errorOf(context(refused), "mail__rename_folder", { folder, new_name: newName })).code, code, folder);
    assert.equal(refused.names().includes("mailboxRename"), false, folder);
  }
});

test("no file under src/mail/, src/dav/, src/calendar/ or src/contacts/ deletes a folder, flags mail, names expunge, copies or removes a message outside mail__move_messages, opens a folder writable outside the moves, or puts the password in a message", () => {
  const forbidden = ["mailboxDelete", "messageFlagsAdd", "messageFlagsRemove", "messageFlagsSet"];
  const once = ["messageMove", "mailboxCreate", "mailboxRename", "messageCopy", "messageDelete"];
  const calls = Object.fromEntries(once.map((n) => [n, []]));
  let writable = 0;
  const mailFiles = readdirSync(MAIL_SRC).filter((f) => f.endsWith(".ts"));
  assert.ok(mailFiles.includes("tools.ts") && mailFiles.includes("imap.ts"), `src/mail/ holds ${mailFiles.join(", ")}`);
  const files = [
    ...mailFiles.map((f) => join(MAIL_SRC, f)),
    ...["dav", "calendar", "contacts"].flatMap((d) =>
      readdirSync(join(MAIL_SRC, "..", d)).filter((f) => f.endsWith(".ts")).map((f) => join(MAIL_SRC, "..", d, f))
    ),
  ];
  let opens = 0;
  let literals = 0;
  for (const file of files) {
    const text = readFileSync(file, "utf-8");
    for (const name of forbidden) assert.equal(text.includes(name), false, `${file} names ${name}`);
    assert.equal(/expunge/i.test(text), false, `${file} names expunge`);
    for (const name of once) for (const m of text.matchAll(new RegExp(`\\.${name}\\(`, "g"))) calls[name].push({ file, index: m.index, text });
    for (const m of text.matchAll(/mailboxOpen\(([^)]*)\)/g)) {
      if (m[1].includes("options:")) continue; // the ImapClientLike declaration
      opens += 1;
      if (/readOnly: false/.test(m[1])) writable += 1;
      else assert.match(m[1], /readOnly: true/, `${file}: mailboxOpen(${m[1]}) is not read-only`);
    }
    const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const literal of code.match(/`(?:\\.|[^`\\])*`/g) ?? []) {
      literals += 1;
      assert.equal(/password/i.test(literal), false, `${file}: a template literal names the password: ${literal}`);
    }
  }
  // Not vacuous: the scan saw the folder opens and the message templates.
  assert.ok(opens >= 5, `only ${opens} mailboxOpen calls found`);
  assert.ok(literals >= 30, `only ${literals} template literals found`);
  assert.equal(writable, 2, "only mail__move_messages and the one move step behind mail__dedupe_apply and mail__dedupe_apply_continue open a folder writable");
  for (const name of ["mailboxCreate", "mailboxRename", "messageCopy", "messageDelete"]) {
    assert.equal(calls[name].length, 1, `${name} is called ${calls[name].length} times`);
    assert.ok(calls[name][0].file.endsWith("tools.ts"), `${name} is called outside tools.ts`);
  }
  assert.deepEqual(calls.messageMove.map((c) => basename(c.file)).sort(), ["dedupe.ts", "tools.ts"], "messageMove is called once each in tools.ts and dedupe.ts");
  // Each move follows its own MOVE check, so imapflow never falls back to copy and remove.
  for (const move of calls.messageMove) {
    const fn = move.text.slice(move.text.lastIndexOf("function ", move.index), move.index);
    assert.match(fn, basename(move.file) === "tools.ts" ? /capabilities\.has\("MOVE"\)\s*\?\s*await client$/ : /if \(!client\.capabilities\.has\("MOVE"\)\)/, move.file);
  }
  for (const t of buildContactsCalendarsEmailToolDefinitions()) assert.doesNotMatch(t.name, /delete|expunge|purge/i);
});

test("the contacts-calendars-email server lists the twenty-two mail tools and the five calendar and contacts tools, and the data and files servers none", () => {
  const mail = buildContactsCalendarsEmailToolDefinitions().map((t) => t.name).filter((n) => n.startsWith("mail__")).sort();
  assert.deepEqual(mail, [
    "mail__configure_credential",
    "mail__configure_status",
    "mail__create_folder",
    "mail__dedupe_apply",
    "mail__dedupe_apply_continue",
    "mail__dedupe_plan_tier2",
    "mail__dedupe_read_comparison",
    "mail__dedupe_record_verdicts",
    "mail__dedupe_scan",
    "mail__download_attachment",
    "mail__find_email_by_message_id",
    "mail__find_thread_messages",
    "mail__folder_status",
    "mail__get_email",
    "mail__get_latest_emails",
    "mail__list_folders",
    "mail__list_headers",
    "mail__move_messages",
    "mail__rename_folder",
    "mail__save_draft",
    "mail__save_message",
    "mail__search_emails",
  ]);
  for (const name of ["mail__create_folder", "mail__rename_folder", "mail__move_messages"]) {
    const t = buildContactsCalendarsEmailToolDefinitions().find((d) => d.name === name);
    assert.match(t.description, /Writes to the mailbox\. No Probanda tool permanently deletes mail or deletes a folder\./, name);
  }
  const dav = buildContactsCalendarsEmailToolDefinitions().filter((t) => /^(calendar|contacts)__/.test(t.name));
  assert.deepEqual(dav.map((t) => t.name).sort(), [
    "calendar__get_event",
    "calendar__list_calendars",
    "calendar__list_events",
    "contacts__get",
    "contacts__search",
    "contacts__write_probe",
  ]);
  // Every calendar tool only reads. The contacts tools named here change the address book,
  // each behind the practitioner's approval; no other tool may.
  const writers = ["contacts__write_probe"];
  for (const t of dav) assert.equal(t.annotations?.readOnlyHint === true, !writers.includes(t.name), t.name);
  assert.equal(buildContactsCalendarsEmailToolDefinitions().length, 28);
  assert.deepEqual(buildToolDefinitions().filter((t) => /^(mail|calendar|contacts)__/.test(t.name)), []);
  assert.deepEqual(buildFileManagerToolDefinitions().filter((t) => /^(mail|calendar|contacts)__/.test(t.name)), []);
});
