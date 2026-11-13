// Builds a new vCard 3.0 card and works out add-only edits to an existing one. An edit
// works on the card's own text: every existing line stays as the server sent it, new lines
// go in before the end marker, and only the revision stamp is replaced. Nothing here
// sends anything.

import { emailKey, normalizeName, phoneDigits, postalKey } from "../contact-match.js";
import type { Incoming, IncomingAddress } from "./import-csv.js";
import { parseContact, parseLines, unescape } from "./vcard.js";

const escape = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");

const FOLD_AT = 75;

/** A long line folded as vCard requires: continuation lines start with one space. */
function fold(line: string, eol: string): string {
  const parts = [line.slice(0, FOLD_AT)];
  for (let at = FOLD_AT; at < line.length; at += FOLD_AT - 1) parts.push(" " + line.slice(at, at + FOLD_AT - 1));
  return parts.join(eol);
}

const PHONE_TYPES: Record<string, string> = {
  mobile: "type=CELL;type=VOICE",
  work: "type=WORK;type=VOICE",
  home: "type=HOME;type=VOICE",
  main: "type=MAIN",
  "work fax": "type=WORK;type=FAX",
  "other fax": "type=OTHER;type=FAX",
  car: "type=CAR",
  other: "type=OTHER;type=VOICE",
};

const emailLine = (value: string): string => `EMAIL;type=INTERNET:${escape(value)}`;
const phoneLine = (phone: { label: string; value: string }): string =>
  `TEL;${PHONE_TYPES[phone.label] ?? PHONE_TYPES.other}:${escape(phone.value)}`;
const addressLine = (a: IncomingAddress): string =>
  `ADR;type=${a.label.toUpperCase()}:;;${[a.street, a.city, a.region, a.postalCode, ""].map(escape).join(";")}`;

/** What identifies an address: its postal code, or its street and city when it has none. */
const addressKey = (a: { street?: string; city?: string; postalCode?: string }): string =>
  postalKey(a.postalCode ?? "") || normalizeName(`${a.street ?? ""} ${a.city ?? ""}`);

export interface Additions {
  /** New card lines, unfolded, in the order to add them. */
  lines: string[];
  /** What each line adds, in the practitioner's words. */
  added: string[];
  /** A value the row holds that differs from the card's. Never written. */
  conflicts: string[];
}

/** What a row would add to a card. A value the card already holds, in any format, adds nothing. */
export function additions(cardText: string, row: Incoming): Additions {
  const card = parseContact(cardText);
  const raw = parseLines(cardText);
  const out: Additions = { lines: [], added: [], conflicts: [] };
  const add = (line: string, what: string) => {
    out.lines.push(line);
    out.added.push(what);
  };

  const emails = new Set(card.emails.map((entry) => emailKey(entry.value)));
  for (const email of row.emails) if (!emails.has(emailKey(email))) add(emailLine(email), `email ${email}`);
  const phones = new Set(card.phones.map((entry) => phoneDigits(entry.value)));
  for (const phone of row.phones) if (!phones.has(phoneDigits(phone.value))) add(phoneLine(phone), `${phone.label} phone ${phone.value}`);
  const addresses = new Set(card.addresses.map(addressKey));
  for (const address of row.addresses) if (!addresses.has(addressKey(address))) add(addressLine(address), `${address.label} address`);

  const single = (what: string, held: string | undefined, wanted: string, line: string, same: (a: string, b: string) => boolean) => {
    if (!wanted) return;
    if (!held) add(line, what);
    else if (!same(held, wanted)) out.conflicts.push(`${what} differs`);
  };
  const sameText = (a: string, b: string) => normalizeName(a) === normalizeName(b);
  if (row.kind === "person") single("organization", card.organization, row.organization, `ORG:${escape(row.organization)};`, sameText);
  single("job title", card.jobTitle, row.jobTitle, `TITLE:${escape(row.jobTitle)}`, sameText);
  // A card that hides its year holds only the month and day.
  single("birthday", card.birthday, row.birthday, `BDAY;value=date:${row.birthday}`, (held, wanted) => wanted.endsWith(held.replace(/^--/, "")));
  single("note", card.notes, row.notes, `NOTE:${escape(row.notes)}`, (held, wanted) => held.includes(wanted.trim()));
  const held = (name: string) => raw.filter((line) => line.name === name).map((line) => unescape(line.value));
  single("web page", held("URL")[0], row.url, `URL:${escape(row.url)}`, (_, wanted) => held("URL").some((url) => url.replace(/\/$/, "") === wanted.replace(/\/$/, "")));
  single("nickname", held("NICKNAME")[0], row.nickname, `NICKNAME:${escape(row.nickname)}`, sameText);
  return out;
}

const END = /^END:VCARD[ \t]*\r?$/im;
const REV = /^REV[;:].*\r?\n/im;

/** The card with lines added before its end marker and its revision stamp replaced. Every other line is untouched. */
export function addLines(cardText: string, lines: string[], rev: string): string {
  const eol = cardText.includes("\r\n") ? "\r\n" : "\n";
  const text = cardText.replace(REV, "");
  const end = END.exec(text);
  if (!end) throw new Error("the card has no end marker");
  const added = [...lines, `REV:${rev}`].map((line) => fold(line, eol) + eol).join("");
  return text.slice(0, end.index) + added + text.slice(end.index);
}

/** A new card for a row. */
export function newCard(row: Incoming, uid: string, rev: string): string {
  const company = row.kind === "company";
  const head = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    "PRODID:-//Probanda//Contacts//EN",
    `N:${[row.lastName, row.firstName, row.middleName, "", ""].map(escape).join(";")}`,
    `FN:${escape(row.name)}`,
    ...(company ? [`ORG:${escape(row.organization)};`, "X-ABShowAs:COMPANY"] : []),
    `UID:${uid}`,
    "END:VCARD",
  ];
  return addLines(head.join("\r\n") + "\r\n", additions(head.join("\r\n"), row).lines, rev);
}

/** The properties of `before` that `after` no longer holds with the same value, by name. Stamps the server owns are ignored. */
export function lostProperties(before: string, after: string): string[] {
  const SERVER_OWNED = new Set(["REV", "PRODID", "VERSION"]);
  const kept = new Set(parseLines(after).map((line) => `${line.name}:${line.value}`));
  return [...new Set(parseLines(before)
    .filter((line) => !SERVER_OWNED.has(line.name) && !kept.has(`${line.name}:${line.value}`))
    .map((line) => line.name))];
}
