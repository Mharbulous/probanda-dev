// The mail__* tools (src/mail/tools.ts) against a fake IMAP client: no network,
// no real mailbox and no real credential. Every value is fake, and the state
// folder is a temp one, so no test can write into the real credential file.

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

test("with no credential every mail tool but the two configure tools refuses mail_not_configured", async (t) => {
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
    mail__find_email_by_message_id: { message_id: "<x@example.test>" },
    mail__find_thread_messages: { uid: 1 },
    mail__save_draft: { eml_path: eml },
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

test("no file under src/mail/, src/dav/, src/calendar/ or src/contacts/ calls an IMAP write, opens a folder writable, or puts the password in a message", () => {
  const forbidden = [
    "messageDelete", "messageMove", "messageCopy", "messageFlagsAdd", "messageFlagsRemove", "messageFlagsSet",
    "mailboxCreate", "mailboxDelete", "mailboxRename",
  ];
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
    for (const m of text.matchAll(/mailboxOpen\(([^)]*)\)/g)) {
      opens += 1;
      assert.match(m[1], /readOnly: true/, `${file}: mailboxOpen(${m[1]}) is not read-only`);
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
});

test("the contacts-calendars-email server lists the eleven mail tools and the five calendar and contacts tools, and the data and files servers none", () => {
  const mail = buildContactsCalendarsEmailToolDefinitions().map((t) => t.name).filter((n) => n.startsWith("mail__")).sort();
  assert.deepEqual(mail, [
    "mail__configure_credential",
    "mail__configure_status",
    "mail__download_attachment",
    "mail__find_email_by_message_id",
    "mail__find_thread_messages",
    "mail__folder_status",
    "mail__get_email",
    "mail__get_latest_emails",
    "mail__list_folders",
    "mail__save_draft",
    "mail__search_emails",
  ]);
  const dav = buildContactsCalendarsEmailToolDefinitions().filter((t) => /^(calendar|contacts)__/.test(t.name));
  assert.deepEqual(dav.map((t) => t.name).sort(), [
    "calendar__get_event",
    "calendar__list_calendars",
    "calendar__list_events",
    "contacts__get",
    "contacts__search",
  ]);
  for (const t of dav) assert.equal(t.annotations?.readOnlyHint, true, t.name);
  assert.equal(buildContactsCalendarsEmailToolDefinitions().length, 16);
  assert.deepEqual(buildToolDefinitions().filter((t) => /^(mail|calendar|contacts)__/.test(t.name)), []);
  assert.deepEqual(buildFileManagerToolDefinitions().filter((t) => /^(mail|calendar|contacts)__/.test(t.name)), []);
});
