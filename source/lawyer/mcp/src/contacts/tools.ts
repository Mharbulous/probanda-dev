// The contacts__* tools of the lawyer plugin's contacts-calendars-email server: CardDAV,
// signed in with the mail credential (src/dav/session.ts). The two here only read, with
// inputs and outputs matching the practitioner's own desktop extension's contacts_search
// and contacts_get, from which they are ported (MIT). The tools that change the address
// book are in write-tools.ts. Tool definitions live in src/schema/contacts.ts.

import { ValidationError } from "../errors.js";
import { getObject, requireDav, type DavContext } from "../dav/session.js";
import { readBook } from "./book.js";
import { parseContact, type Contact } from "./vcard.js";
import { contactsWriteTools } from "./write-tools.js";
import type { Tool } from "../tool-list.js";

type Args = Record<string, unknown>;

export const contactsTools: Tool<DavContext>[] = [
  { name: "contacts__search", handler: (args, context) => search(context, args) },
  { name: "contacts__get", handler: (args, context) => get(context, args) },
  ...contactsWriteTools,
];

type Listed = Omit<Contact, "isGroup"> & { url: string; etag?: string };

const summary = (c: Listed) => ({
  url: c.url,
  name: c.name,
  organization: c.organization,
  emails: c.emails.map((e) => e.value),
  phones: c.phones.map((p) => p.value),
});

function search(context: DavContext, args: Args): Promise<unknown> {
  const credential = requireDav(context.mail, "carddav");
  const limit = args.limit === undefined ? 50 : args.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1) {
    throw new ValidationError("contacts__search.limit must be an integer of at least 1");
  }
  const q = typeof args.query === "string" ? args.query.trim().toLowerCase() : undefined;
  const digits = q?.replace(/\D/g, "");
  return readBook(context, credential).then(({ cards }) => {
    const all: Listed[] = cards
      .map((c) => ({ url: c.url, etag: c.etag, ...parseContact(c.text) }))
      .filter((c) => !c.isGroup)
      .map(({ isGroup, ...c }) => c);
    const hits = all
      .filter((c) => {
        if (!q) return true;
        const hay = [c.name, c.organization, ...c.emails.map((e) => e.value)].filter(Boolean).join("\n").toLowerCase();
        if (hay.includes(q)) return true;
        return Boolean(digits && digits.length >= 3 && c.phones.some((p) => p.value.replace(/\D/g, "").includes(digits)));
      })
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
    return { total: hits.length, returned: Math.min(hits.length, limit), contacts: hits.slice(0, limit).map(summary) };
  });
}

async function get(context: DavContext, args: Args): Promise<unknown> {
  const credential = requireDav(context.mail, "carddav");
  if (typeof args.url !== "string" || !args.url) throw new ValidationError("contacts__get requires url");
  const url = args.url;
  const { text, etag } = await getObject(context, credential, "carddav", url);
  const { isGroup, ...c } = parseContact(text);
  return { url, etag, ...c };
}
