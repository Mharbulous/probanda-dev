// Sorts each row of a contacts file against the cards already in the address book, by
// fixed rules (src/contact-match.ts). No judgement: a row that could be a duplicate, and
// is not provably the same contact, is ambiguous and is written nowhere.

import { matchKeys, matchReasons, type MatchKeys } from "../contact-match.js";
import type { Incoming } from "./import-csv.js";
import { additions, addLines, newCard } from "./vcard-edit.js";
import { parseContact } from "./vcard.js";

/** A card as the server holds it. */
export interface Card {
  url: string;
  etag?: string;
  text: string;
}

export type Outcome =
  | { row: number; name: string; class: "new" }
  | { row: number; name: string; class: "add_only"; url: string; added: string[]; conflicts: string[] }
  | { row: number; name: string; class: "unchanged"; url: string; conflicts: string[] }
  | { row: number; name: string; class: "duplicate_row"; of_row: number }
  | { row: number; name: string; class: "ambiguous"; reason: string; candidates: string[] };

export interface Classified {
  outcomes: Outcome[];
  /** Rows to create, each with the later rows of the file folded into it. */
  creates: Array<{ row: number; incoming: Incoming; lines: string[] }>;
  /** Lines to add to an existing card, from every row that matched it. */
  updates: Array<{ url: string; etag?: string; lines: string[]; rows: number[] }>;
}

/** One contact a row can match: a card on the server, or an earlier row of the file that will become one. */
interface Known {
  company: boolean;
  name: string;
  text: string;
  keys: MatchKeys;
  card?: Card;
  row?: number;
  lines: string[];
  rows: number[];
}

function known(text: string, source: { card?: Card; row?: number }): Known | undefined {
  const contact = parseContact(text);
  if (contact.isGroup) return undefined;
  const company = !contact.firstName && !contact.lastName;
  return {
    company,
    name: contact.name,
    text,
    keys: matchKeys({
      names: company ? [contact.name, contact.organization] : [contact.name, `${contact.firstName ?? ""} ${contact.lastName ?? ""}`],
      emails: contact.emails.map((entry) => entry.value),
      phones: contact.phones.map((entry) => entry.value),
      postals: contact.addresses.map((address) => address.postalCode ?? ""),
    }),
    ...source,
    lines: [],
    rows: [],
  };
}

const shares = (a: Set<string>, b: Set<string>): boolean => [...a].some((value) => b.has(value));

export function classify(rows: Incoming[], cards: Card[]): Classified {
  const pool = cards.map((card) => known(card.text, { card })).filter((entry): entry is Known => entry !== undefined);
  const outcomes: Outcome[] = [];
  for (const row of rows) {
    const fresh = known(newCard(row, "", ""), { row: row.row }) as Known;
    const ambiguous = (reason: string, candidates: Known[]) =>
      outcomes.push({ row: row.row, name: row.name, class: "ambiguous", reason, candidates: [...new Set(candidates.map((entry) => entry.name))] });

    const sameName = pool.filter((entry) => entry.company === fresh.company && shares(entry.keys.names, fresh.keys.names));
    // The same contact: the same name, and either a shared detail or nothing in the row the card lacks.
    const same = sameName.filter((entry) => matchReasons(entry.keys, fresh.keys).length > 1 || additions(entry.text, row).lines.length === 0);
    if (same.length > 1) ambiguous("more than one contact matches", same);
    else if (same.length === 1) {
      const entry = same[0];
      const { lines, added, conflicts } = additions(entry.text, row);
      if (lines.length) {
        entry.text = addLines(entry.text, lines, "");
        entry.keys = (known(entry.text, {}) as Known).keys;
        entry.lines.push(...lines);
        entry.rows.push(row.row);
      }
      if (entry.card === undefined) outcomes.push({ row: row.row, name: row.name, class: "duplicate_row", of_row: entry.row as number });
      else if (lines.length) outcomes.push({ row: row.row, name: row.name, class: "add_only", url: entry.card.url, added, conflicts });
      else outcomes.push({ row: row.row, name: row.name, class: "unchanged", url: entry.card.url, conflicts });
    } else if (sameName.length) ambiguous("same name, no shared detail", sameName);
    else {
      const byEmail = pool.filter((entry) => shares(entry.keys.emails, fresh.keys.emails));
      // A number one other person holds may be this person under another name. A number a
      // company holds, or that several contacts share, is an office line and proves nothing.
      const byPhone = fresh.company ? [] : pool.filter((entry) => !entry.company &&
        [...fresh.keys.phones].some((phone) => entry.keys.phones.has(phone) && pool.filter((other) => other.keys.phones.has(phone)).length === 1));
      if (byEmail.length) ambiguous("shares an email with a different name", byEmail);
      else if (byPhone.length) ambiguous("shares a phone with a different name", byPhone);
      else {
        pool.push(fresh);
        outcomes.push({ row: row.row, name: row.name, class: "new" });
      }
    }
  }
  const byRow = new Map(rows.map((row) => [row.row, row]));
  return {
    outcomes,
    creates: pool.filter((entry) => entry.card === undefined)
      .map((entry) => ({ row: entry.row as number, incoming: byRow.get(entry.row as number) as Incoming, lines: entry.lines })),
    updates: pool.filter((entry) => entry.card !== undefined && entry.lines.length > 0)
      .map((entry) => ({ url: (entry.card as Card).url, etag: (entry.card as Card).etag, lines: entry.lines, rows: entry.rows })),
  };
}
