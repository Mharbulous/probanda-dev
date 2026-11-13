// Reads the practitioner's address book: the first one the account holds, and every card in it.

import { DataServerError } from "../errors.js";
import { absolute, runDav, type DavContext } from "../dav/session.js";
import type { MailCredential } from "../mail/config.js";
import type { Card } from "./import-classify.js";

export function readBook(context: DavContext, credential: MailCredential): Promise<{ bookUrl: string; cards: Card[] }> {
  return runDav(context, credential, "carddav", "reading contacts", async (client) => {
    const books = await client.fetchAddressBooks();
    if (books.length === 0) throw new DataServerError("contacts: no address book found for this account.", "dav_error");
    const book = books[0];
    const cards = await client.fetchVCards({ addressBook: book });
    return {
      bookUrl: book.url,
      cards: cards
        .filter((c) => c.data?.includes("BEGIN:VCARD"))
        .map((c) => ({ url: absolute(c.url, book.url), etag: c.etag, text: c.data as string })),
    };
  });
}
