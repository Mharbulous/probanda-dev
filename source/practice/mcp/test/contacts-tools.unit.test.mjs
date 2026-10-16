// The contacts__* tools (src/contacts/, src/dav/) against a fake CardDAV client
// and a fake fetch: no network, no real address book and no real credential.
// Every value is fake.

import assert from "node:assert/strict";
import test from "node:test";

const { callTool, dispatchTool } = await import("../build/dispatch.js");

const FAKE_PASSWORD = "fake-password-2222-not-real";
const MAIL_ONLY = { host: "imap.example.test", port: 993, secure: true, username: "someone", password: FAKE_PASSWORD };
const FAKE = { ...MAIL_ONLY, davUsername: "someone@example.test", carddavUrl: "https://contacts.example.test" };
const BOOK = { url: "https://p01-contacts.example.test/123/carddavhome/card/" };

const vcard = (...lines) => ["BEGIN:VCARD", "VERSION:3.0", ...lines, "END:VCARD", ""].join("\r\n");

const ALICE = vcard(
  "UID:alice-1",
  "N:Example;Alice;Q;Dr.;K.C.",
  "FN:Dr. Alice Example",
  "ORG:Example LLP;Litigation",
  "TITLE:Partner",
  "item1.EMAIL;type=INTERNET;type=pref:alice@example.test",
  "item1.X-ABLabel:_$!<Other>!$_",
  "EMAIL;type=INTERNET;type=WORK:alice.work@example.test",
  "TEL;type=CELL;type=VOICE;type=pref:(604) 555-0101",
  "ADR;type=WORK:;Suite 1;1 Main St;Vancouver;BC;V6B 1A1;Canada",
  "BDAY;X-APPLE-OMIT-YEAR=1604:1604-03-15",
  "NOTE:Line one\\nLine two",
);
const BOB = vcard("UID:bob-1", "N:Sample;Bob;;;", "FN:Bob Sample", "TEL;type=WORK:604-555-0199");
const GROUP = vcard("UID:group-1", "FN:Clients", "X-ADDRESSBOOKSERVER-KIND:group");

// With `reach`, sign-in sends one signed-in PROPFIND to the address book's host, as
// tsdav's discovery would, so that host is trusted afterwards.
function fakeDav({ reach = false } = {}) {
  const logins = [];
  const factory = async (login) => {
    logins.push(login.username);
    if (reach) await login.fetch(BOOK.url, { method: "PROPFIND", headers: { Authorization: "Basic ZmFrZTpmYWtl" } });
    return {
      async fetchCalendars() {
        return [];
      },
      async fetchCalendarObjects() {
        return [];
      },
      async fetchAddressBooks() {
        return [BOOK];
      },
      async fetchVCards() {
        return [
          { url: "/123/carddavhome/card/bob-1.vcf", etag: '"b"', data: BOB },
          { url: "/123/carddavhome/card/alice-1.vcf", etag: '"a"', data: ALICE },
          { url: "/123/carddavhome/card/group-1.vcf", etag: '"g"', data: GROUP },
        ];
      },
    };
  };
  return { factory, logins };
}

const context = (dav, credential = FAKE, extra = {}) => ({ practiceDb: {}, mail: { credential: { ...credential } }, davClientFactory: dav.factory, ...extra });

async function errorOf(context_, name, args) {
  const result = await dispatchTool(context_, name, args);
  assert.equal(result.isError, true, result.content[0].text);
  return JSON.parse(result.content[0].text).error;
}

test("search lists contacts alphabetically, leaves out groups, and matches name, email or phone digits", async () => {
  const dav = fakeDav();
  const all = await callTool(context(dav), "contacts__search", {});
  assert.deepEqual(all, {
    total: 2,
    returned: 2,
    contacts: [
      { url: `${BOOK.url}bob-1.vcf`, name: "Bob Sample", organization: undefined, emails: [], phones: ["604-555-0199"] },
      {
        url: `${BOOK.url}alice-1.vcf`,
        name: "Dr. Alice Example",
        organization: "Example LLP",
        emails: ["alice@example.test", "alice.work@example.test"],
        phones: ["(604) 555-0101"],
      },
    ],
  });
  for (const query of ["ALICE", "alice.work@", "example llp", "6045550101", "555 0101"]) {
    const hit = await callTool(context(dav), "contacts__search", { query });
    assert.deepEqual(hit.contacts.map((c) => c.name), ["Dr. Alice Example"], query);
  }
  const limited = await callTool(context(dav), "contacts__search", { limit: 1 });
  assert.equal(limited.total, 2);
  assert.equal(limited.returned, 1);
  assert.deepEqual(dav.logins.slice(0, 1), ["someone@example.test"]);
});

test("get reads one contact in full by url", async () => {
  const requests = [];
  const davFetch = async (url, init) => {
    if (init.method === "PROPFIND") return new Response("", { status: 207 });
    requests.push({ url, init });
    return new Response(ALICE, { status: 200, headers: { etag: '"a2"' } });
  };
  const url = `${BOOK.url}alice-1.vcf`;
  const result = await callTool(context(fakeDav({ reach: true }), FAKE, { davFetch }), "contacts__get", { url });
  assert.deepEqual(result, {
    url,
    etag: '"a2"',
    uid: "alice-1",
    name: "Dr. Alice Example",
    prefix: "Dr.",
    firstName: "Alice",
    middleName: "Q",
    lastName: "Example",
    suffix: "K.C.",
    organization: "Example LLP",
    department: "Litigation",
    jobTitle: "Partner",
    emails: [
      { label: "other", value: "alice@example.test", preferred: true },
      { label: "work", value: "alice.work@example.test", preferred: undefined },
    ],
    phones: [{ label: "cell", value: "(604) 555-0101", preferred: true }],
    addresses: [
      {
        label: "work",
        preferred: undefined,
        poBox: undefined,
        extended: "Suite 1",
        street: "1 Main St",
        city: "Vancouver",
        region: "BC",
        postalCode: "V6B 1A1",
        country: "Canada",
      },
    ],
    birthday: "--03-15",
    notes: "Line one\nLine two",
  });
  assert.equal(requests[0].init.redirect, "error");
});

test("get refuses a url off the configured contacts server and the hosts reached while signing in", async () => {
  const davFetch = () => assert.fail("no request may be sent");
  const ctx = context(fakeDav(), FAKE, { davFetch });
  for (const url of ["https://contacts.evil.test/x.vcf", "https://example.test.evil.com/x.vcf", "https://other.example.test/x.vcf", `${BOOK.url}x.vcf`]) {
    const error = await errorOf(ctx, "contacts__get", { url });
    assert.match(error.message, /Refusing to use/, url);
  }
});

test("with a credential saved before the contacts fields, both contacts tools refuse dav_not_configured", async () => {
  const ctx = context({ factory: () => assert.fail("no sign-in may be attempted") }, MAIL_ONLY);
  for (const [name, args] of [["contacts__search", {}], ["contacts__get", { url: `${BOOK.url}x.vcf` }]]) {
    const error = await errorOf(ctx, name, args);
    assert.equal(error.code, "dav_not_configured", name);
    assert.match(error.message, /^contacts not configured: run mail__configure_credential/, name);
  }
});

test("a server error on get is dav_error and never shows the password", async () => {
  const davFetch = async (url, init) => {
    if (init.method === "PROPFIND") return new Response("", { status: 207 });
    throw new Error(`socket hang up after ${FAKE_PASSWORD}`);
  };
  const error = await errorOf(context(fakeDav({ reach: true }), FAKE, { davFetch }), "contacts__get", { url: `${BOOK.url}alice-1.vcf` });
  assert.equal(error.code, "dav_error");
  assert.equal(error.message.includes(FAKE_PASSWORD), false);
});
