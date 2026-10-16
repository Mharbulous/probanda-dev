// The contacts__* tools of the practice data server: read-only CardDAV, signed
// in with the mail credential (src/dav/session.ts). No tool creates, changes or
// deletes a contact. Inputs and outputs match the practitioner's own desktop
// extension's contacts_search and contacts_get, from which this is ported (MIT).
// Tool definitions live in schema-gen.ts.

import { DataServerError, ValidationError } from "../errors.js";
import { absolute, getObject, requireDav, runDav, type DavContext } from "../dav/session.js";
import { parseContact, type Contact } from "./vcard.js";

type Args = Record<string, unknown>;

export function callContactsTool(context: DavContext, name: string, args: Args): Promise<unknown> {
  switch (name) {
    case "contacts__search":
      return search(context, args);
    case "contacts__get":
      return get(context, args);
    default:
      throw new ValidationError(`Unknown tool "${name}"`);
  }
}

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
  return runDav(context, credential, "carddav", "reading contacts", async (client) => {
    const books = await client.fetchAddressBooks();
    if (books.length === 0) throw new DataServerError("contacts: no address book found for this account.", "dav_error");
    const book = books[0];
    const cards = await client.fetchVCards({ addressBook: book });
    const all: Listed[] = cards
      .filter((c) => c.data?.includes("BEGIN:VCARD"))
      .map((c) => ({ url: absolute(c.url, book.url), etag: c.etag, ...parseContact(c.data as string) }))
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
