// The only code that changes the address book. It can create a card, replace a card's text
// and remove a card, each only under a condition the server checks: a create fails if a card
// is already at that address, and a replace or a remove fails if the card changed since it
// was read. Callers decide what to send (an add-only edit, a merge's backed-up loser); this
// file only sends it. No file outside src/contacts/ may import it (test/calendar-tools).

import { DataServerError, ValidationError } from "../errors.js";
import { permittedRequest, type CardPermit, type DavContext } from "../dav/session.js";
import type { MailCredential } from "../mail/config.js";

const WRITE = "PUT";
const REMOVE = "DELETE";

function permit(bookUrl: string): CardPermit {
  return {
    collectionUrl: bookUrl,
    check(method, headers) {
      const creating = headers.get("if-none-match") === "*" && !headers.has("if-match");
      const unchanged = Boolean(headers.get("if-match")) && headers.get("if-match") !== "*" && !headers.has("if-none-match");
      if (!(method === WRITE && (creating || unchanged)) && !(method === REMOVE && unchanged)) {
        throw new ValidationError(`Refusing a ${method} request: a contact card changes only under its condition.`);
      }
    },
  };
}

const CARD_TYPE = { "Content-Type": "text/vcard; charset=utf-8" };

function requireEtag(etag: string | null | undefined, url: string): string {
  if (!etag) throw new DataServerError(`The card at ${url} has no version mark, so it cannot be changed safely.`, "dav_stale");
  return etag;
}

function judge(status: number, url: string, what: string): void {
  if (status === 412) {
    throw new DataServerError(`The card at ${url} changed since it was read, so nothing was ${what}. Scan again.`, "dav_stale");
  }
  if (status < 200 || status >= 300) throw new DataServerError(`The card at ${url} was not ${what}: HTTP ${status}`, "dav_error");
}

/** Creates a card at a new address in the book. Fails with `dav_exists` when one is already there. */
export async function createCard(
  context: DavContext, credential: MailCredential, bookUrl: string, fileName: string, text: string
): Promise<{ url: string; etag: string | null }> {
  const url = bookUrl + fileName;
  const res = await permittedRequest(context, credential, url, { method: WRITE, headers: { ...CARD_TYPE, "If-None-Match": "*" }, body: text }, permit(bookUrl));
  if (res.status === 412) throw new DataServerError(`A card already exists at ${url}, so nothing was created.`, "dav_exists");
  judge(res.status, url, "created");
  return { url, etag: res.etag };
}

/** Replaces a card's text, only if the card is still the version `etag` names. */
export async function replaceCard(
  context: DavContext, credential: MailCredential, bookUrl: string, url: string, etag: string | null | undefined, text: string
): Promise<{ etag: string | null }> {
  const headers = { ...CARD_TYPE, "If-Match": requireEtag(etag, url) };
  const res = await permittedRequest(context, credential, url, { method: WRITE, headers, body: text }, permit(bookUrl));
  judge(res.status, url, "changed");
  return { etag: res.etag };
}

/** Removes a card, only if it is still the version `etag` names. The caller has saved a copy first. */
export async function removeCard(
  context: DavContext, credential: MailCredential, bookUrl: string, url: string, etag: string | null | undefined
): Promise<void> {
  const res = await permittedRequest(context, credential, url, { method: REMOVE, headers: { "If-Match": requireEtag(etag, url) } }, permit(bookUrl));
  judge(res.status, url, "removed");
}
