// The calendar__* tools (src/calendar/, src/dav/) against a fake CalDAV client and
// a fake fetch: no network, no real calendar and no real credential. Every value
// is fake, and the state folder is a temp one, so no test can write into the real
// credential file.

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";

const STATE_DIR = mkdtempSync(join(tmpdir(), "coclerk-calendar-tools-"));
const SAVED_LOCALAPPDATA = process.env.LOCALAPPDATA;
process.env.LOCALAPPDATA = STATE_DIR;
after(() => {
  if (SAVED_LOCALAPPDATA === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = SAVED_LOCALAPPDATA;
  rmSync(STATE_DIR, { recursive: true, force: true });
});

const { callTool, dispatchTool } = await import("../build/dispatch.js");

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const FAKE_PASSWORD = "fake-password-1111-not-real";
const MAIL_ONLY = { host: "imap.example.test", port: 993, secure: true, username: "someone", password: FAKE_PASSWORD };
const FAKE = {
  ...MAIL_ONLY,
  davUsername: "someone@example.test",
  caldavUrl: "https://caldav.example.test",
  carddavUrl: "https://contacts.example.test",
  timezone: "America/Vancouver",
};
const CAL_BASE = "https://p01-caldav.example.test/123/calendars/";
const WORK = { url: `${CAL_BASE}work/`, displayName: "Work", components: ["VEVENT"], calendarColor: "#ff0000" };
const HOME = { url: `${CAL_BASE}home/`, displayName: "Home", components: ["VEVENT", "VTODO"] };
const TASKS = { url: `${CAL_BASE}tasks/`, displayName: "Tasks", components: ["VTODO"] };

const ics = (...lines) => ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", ...lines, "END:VCALENDAR", ""].join("\r\n");

// Weekly at 10:00 Vancouver time from Mon 5 Oct 2026, five times; 12 Oct cancelled;
// 19 Oct moved to 14:00. 1 Nov 2026 ends daylight time, so 2 Nov is at -08:00.
const SERIES = ics(
  "BEGIN:VEVENT",
  "UID:series-1",
  "SUMMARY:Weekly call",
  "DTSTART;TZID=America/Vancouver:20261005T100000",
  "DTEND;TZID=America/Vancouver:20261005T110000",
  "RRULE:FREQ=WEEKLY;COUNT=5",
  "EXDATE;TZID=America/Vancouver:20261012T100000",
  "DESCRIPTION:Agenda",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:series-1",
  "RECURRENCE-ID;TZID=America/Vancouver:20261019T100000",
  "SUMMARY:Weekly call (moved)",
  "DTSTART;TZID=America/Vancouver:20261019T140000",
  "DTEND;TZID=America/Vancouver:20261019T150000",
  "END:VEVENT"
);

const ALL_DAY = ics(
  "BEGIN:VEVENT",
  "UID:allday-1",
  "SUMMARY:Holiday",
  "DTSTART;VALUE=DATE:20261012",
  "DTEND;VALUE=DATE:20261013",
  "TRANSP:TRANSPARENT",
  `DESCRIPTION:${"x".repeat(600)}`,
  "END:VEVENT"
);

function fakeDav({ objects = {}, refuse = [], fail } = {}) {
  const logins = [];
  const factory = async (login) => {
    logins.push({ kind: login.kind, serverUrl: login.serverUrl, username: login.username, secret: login.secret });
    if (refuse.includes(login.username)) {
      throw new Error(`Invalid credentials: PROPFIND returned 401 Unauthorized (sent ${login.secret})`);
    }
    return {
      async fetchCalendars() {
        return [WORK, HOME, TASKS];
      },
      async fetchCalendarObjects({ calendar }) {
        if (fail) throw fail;
        return objects[calendar.displayName] ?? [];
      },
      async fetchAddressBooks() {
        return [];
      },
      async fetchVCards() {
        return [];
      },
    };
  };
  return { factory, logins };
}

function context(dav, credential = FAKE, extra = {}) {
  return { practiceDb: {}, mail: { credential: credential && { ...credential } }, davClientFactory: dav.factory, ...extra };
}

async function errorOf(context_, name, args) {
  const result = await dispatchTool(context_, name, args);
  assert.equal(result.isError, true, result.content[0].text);
  return JSON.parse(result.content[0].text).error;
}

test("list_calendars returns the event calendars only", async () => {
  const result = await callTool(context(fakeDav()), "calendar__list_calendars", {});
  assert.deepEqual(result, {
    calendars: [
      { name: "Work", url: WORK.url, color: "#ff0000" },
      { name: "Home", url: HOME.url, color: undefined },
    ],
  });
});

test("list_events expands a series with an EXDATE and a moved occurrence, across the end of daylight time", async () => {
  const dav = fakeDav({ objects: { Work: [{ url: "/123/calendars/work/series-1.ics", etag: '"e1"', data: SERIES }] } });
  const result = await callTool(context(dav), "calendar__list_events", { start: "2026-10-01", end: "2026-11-02", calendars: ["work"] });
  assert.equal(result.timezone, "America/Vancouver");
  assert.equal(result.count, 4);
  assert.deepEqual(
    result.events.map((e) => [e.title, e.start, e.end, e.modifiedOccurrence]),
    [
      ["Weekly call", "2026-10-05T10:00:00-07:00", "2026-10-05T11:00:00-07:00", undefined],
      ["Weekly call (moved)", "2026-10-19T14:00:00-07:00", "2026-10-19T15:00:00-07:00", true],
      ["Weekly call", "2026-10-26T10:00:00-07:00", "2026-10-26T11:00:00-07:00", undefined],
      ["Weekly call", "2026-11-02T10:00:00-08:00", "2026-11-02T11:00:00-08:00", undefined],
    ]
  );
  const first = result.events[0];
  assert.equal(first.calendar, "Work");
  assert.equal(first.uid, "series-1");
  assert.equal(first.recurring, true);
  assert.equal(first.allDay, false);
  assert.equal(first.busy, true);
  assert.equal(first.url, `${CAL_BASE}work/series-1.ics`);
  assert.equal(first.etag, '"e1"');
  assert.equal("notes" in first, false, "notes only with includeNotes");
  assert.equal("_startMs" in first, false);
});

test("list_events reports an all-day event with bare dates, an exclusive end, and notes trimmed to 500", async () => {
  const dav = fakeDav({ objects: { Home: [{ url: `${CAL_BASE}home/allday-1.ics`, etag: '"e2"', data: ALL_DAY }] } });
  const result = await callTool(context(dav), "calendar__list_events", { start: "2026-10-12", end: "2026-10-12", includeNotes: true });
  assert.equal(result.count, 1);
  const [e] = result.events;
  assert.equal(e.allDay, true);
  assert.equal(e.start, "2026-10-12");
  assert.equal(e.end, "2026-10-13");
  assert.equal(e.busy, false);
  assert.equal(e.notes.length, 501);
  assert.ok(e.notes.endsWith("…"));

  const before = await callTool(context(dav), "calendar__list_events", { start: "2026-10-11", end: "2026-10-11" });
  assert.equal(before.count, 0, "an all-day event does not spill into the day before");
});

test("list_events skips an unreadable item with a warning and refuses an unknown calendar name", async () => {
  const dav = fakeDav({ objects: { Work: [{ url: `${CAL_BASE}work/bad.ics`, data: "BEGIN:VEVENT\r\nnot ical" }] } });
  const result = await callTool(context(dav), "calendar__list_events", { start: "2026-10-01", end: "2026-10-02" });
  assert.equal(result.count, 0);
  assert.match(result.warnings[0], /Skipped an item in "Work" that could not be read/);
  await assert.rejects(callTool(context(dav), "calendar__list_events", { start: "2026-10-01", end: "2026-10-02", calendars: ["Family"] }), /No calendar named "Family"/);
});

test("get_event reads the series by url, sending the sign-in only to the configured provider", async () => {
  const requests = [];
  const davFetch = async (url, init) => {
    requests.push({ url, init });
    return new Response(SERIES, { status: 200, headers: { etag: '"e9"' } });
  };
  const dav = fakeDav();
  const ctx = context(dav, FAKE, { davFetch });
  const url = `${CAL_BASE}work/series-1.ics`;
  const result = await callTool(ctx, "calendar__get_event", { url });
  assert.equal(result.url, url);
  assert.equal(result.etag, '"e9"');
  assert.equal(result.title, "Weekly call");
  assert.equal(result.start, "2026-10-05T10:00:00-07:00");
  assert.equal(result.recurrence, "FREQ=WEEKLY;COUNT=5");
  assert.equal(result.modifiedOccurrences, 1);
  assert.equal(result.excludedDates, 1);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].init.redirect, "error");
  const expected = "Basic " + Buffer.from(`someone@example.test:${FAKE_PASSWORD}`).toString("base64");
  assert.equal(requests[0].init.headers.Authorization, expected);

  for (const foreign of ["https://evil.example.com/x.ics", "http://p01-caldav.example.test/x.ics", "https://example.test.evil.com/x.ics", "not a url"]) {
    const error = await errorOf(ctx, "calendar__get_event", { url: foreign });
    assert.match(error.message, /Refusing to use|is not a valid URL/, foreign);
  }
  assert.equal(requests.length, 1, "no request goes to a refused url");
});

test("with a credential saved before the calendar fields, every calendar tool refuses dav_not_configured", async () => {
  const ctx = context({ factory: () => assert.fail("no sign-in may be attempted") }, MAIL_ONLY);
  for (const [name, args] of [
    ["calendar__list_calendars", {}],
    ["calendar__list_events", { start: "2026-10-01", end: "2026-10-02" }],
    ["calendar__get_event", { url: `${CAL_BASE}work/x.ics` }],
  ]) {
    const error = await errorOf(ctx, name, args);
    assert.equal(error.code, "dav_not_configured", name);
    assert.match(error.message, /^calendar not configured: run mail__configure_credential with the calendar fields/, name);
  }
});

test("sign-in tries the calendar username first, then the mail username, and keeps the session", async () => {
  const dav = fakeDav({ refuse: ["someone@example.test"] });
  const ctx = context(dav);
  await callTool(ctx, "calendar__list_calendars", {});
  await callTool(ctx, "calendar__list_calendars", {});
  assert.deepEqual(dav.logins.map((l) => [l.kind, l.serverUrl, l.username]), [
    ["caldav", "https://caldav.example.test", "someone@example.test"],
    ["caldav", "https://caldav.example.test", "someone"],
  ]);
});

test("a refused sign-in is dav_auth, a server failure dav_error, a stall dav_timeout, and none shows the password", async () => {
  const refused = await errorOf(context(fakeDav({ refuse: ["someone@example.test", "someone"] })), "calendar__list_calendars", {});
  assert.equal(refused.code, "dav_auth");
  assert.match(refused.message, /someone@example\.test: .*; someone: /);
  assert.equal(refused.message.includes(FAKE_PASSWORD), false);
  assert.match(refused.message, /\[redacted\]/);

  const failing = fakeDav({ fail: new Error(`Collection query failed: 500 Internal Server Error. Raw response: echo ${FAKE_PASSWORD}`) });
  const failed = await errorOf(context(failing), "calendar__list_events", { start: "2026-10-01", end: "2026-10-02" });
  assert.equal(failed.code, "dav_error");
  assert.equal(failed.message.includes(FAKE_PASSWORD), false);

  const stalled = fakeDav({ fail: Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }) });
  const timedOut = await errorOf(context(stalled), "calendar__list_events", { start: "2026-10-01", end: "2026-10-02" });
  assert.equal(timedOut.code, "dav_timeout");
});

test("configure_credential checks the calendar fields, and the page saves a failed service as not configured", async () => {
  const imap = {
    async connect() {},
    async logout() {},
    close() {},
    async status() {
      return { messages: 4, unseen: 1 };
    },
  };
  const dav = fakeDav();
  const contactsRefused = async (login) => {
    if (login.kind === "carddav") throw new Error("Invalid credentials: PROPFIND returned 401 Unauthorized");
    return dav.factory(login);
  };
  const ctx = { practiceDb: {}, mail: { credential: null }, imapFactory: () => imap, davClientFactory: contactsRefused };
  const base = { host: "imap.example.test", username: "someone" };

  const noZone = await errorOf(ctx, "mail__configure_credential", { ...base, caldav_url: "https://caldav.example.test" });
  assert.match(noZone.message, /caldav_url needs timezone/);
  const badZone = await errorOf(ctx, "mail__configure_credential", { ...base, caldav_url: "https://caldav.example.test", timezone: "Pacific Standard Time" });
  assert.match(badZone.message, /not an IANA time zone/);
  const plain = await errorOf(ctx, "mail__configure_credential", { ...base, carddav_url: "http://contacts.example.test" });
  assert.match(plain.message, /must be an https URL/);

  const started = await callTool(ctx, "mail__configure_credential", {
    ...base,
    dav_username: "someone@example.test",
    caldav_url: "https://caldav.example.test",
    carddav_url: "https://contacts.example.test",
    timezone: "America/Vancouver",
  });
  const form = await (await fetch(started.url)).text();
  assert.match(form, /Probanda mail connector/);
  assert.match(form, /https:\/\/caldav\.example\.test/);
  const saved = await (
    await fetch(started.url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: FAKE_PASSWORD }),
    })
  ).text();
  assert.match(saved, /Calendar: signed in\./);
  assert.match(saved, /Contacts: sign-in failed, so it was not saved/);
  assert.equal(saved.includes(FAKE_PASSWORD), false);
  assert.equal(ctx.mail.credential.caldavUrl, "https://caldav.example.test");
  assert.equal("carddavUrl" in ctx.mail.credential, false);

  const status = await callTool(ctx, "mail__configure_status", {});
  assert.equal(status.calendar_configured, true);
  assert.equal(status.contacts_configured, false);
  assert.match(status.dav_sign_in.contacts, /refused the sign-in/);
  assert.equal(JSON.stringify(status).includes(FAKE_PASSWORD), false);
});

test("no file under src/dav/, src/calendar/ or src/contacts/ writes to a calendar or address book", () => {
  const forbidden = [
    /\b(PUT|DELETE|PROPPATCH|MKCALENDAR|MKCOL|MOVE|COPY)\b/,
    /\b(create|update|delete)(CalendarObject|VCard|Object)\b/,
    /\bmake(Calendar|Collection)\b/,
  ];
  let scanned = 0;
  for (const dir of ["dav", "calendar", "contacts"]) {
    for (const file of readdirSync(join(SRC, dir)).filter((f) => f.endsWith(".ts"))) {
      scanned += 1;
      const text = readFileSync(join(SRC, dir, file), "utf-8");
      for (const pattern of forbidden) assert.equal(pattern.test(text), false, `${dir}/${file} matches ${pattern}`);
    }
  }
  assert.ok(scanned >= 6, `only ${scanned} files scanned`);
});
