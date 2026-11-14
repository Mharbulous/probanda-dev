// Finds cards in the address book that are the same contact, and works out the one card a
// group merges into: the kept card's own text with every detail the others hold and it
// lacks. Fixed rules only (src/contact-match.ts). Nothing here sends anything.

import { createHash } from "node:crypto";

import { emailKey, matchKeys, matchReasons, normalizeName, PHONE_EXTENSION, phoneDigits, postalKey, type MatchKeys } from "../contact-match.js";
import type { Card } from "./import-classify.js";
import { addLines, escape } from "./vcard-edit.js";
import { parseContact, parseLines, unescape, type Contact, type Line } from "./vcard.js";

interface Raw {
  raw: string;
  line: Line;
}

/** A card's lines, unfolded, each with its parsed form. */
function rawLines(text: string): Raw[] {
  return text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/).flatMap((raw) => {
    const [line] = parseLines(raw);
    return line ? [{ raw, line }] : [];
  });
}

// Lines that identify the card itself, which a merge never carries over.
const OWN = new Set(["BEGIN", "END", "VERSION", "PRODID", "REV", "UID", "X-ABUID"]);
// Properties a card holds once, and the word the practitioner knows each by.
const SINGLE: Record<string, string> = {
  FN: "name", N: "name", ORG: "organization", TITLE: "job title", BDAY: "birthday", PHOTO: "photo", NICKNAME: "nickname", NOTE: "note",
  "X-ABSHOWAS": "kind",
};

/** Case and punctuation ignored, but not a corporate suffix: "Acme Ltd." and "Acme Inc." stay different. */
const plain = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * What makes two lines of the same property the same value, whatever their format. Stricter
 * than the rules that group cards: a value judged held is not carried over, so a near-copy
 * kept is the safe side.
 */
function valueKey(line: Line): string {
  const value = unescape(line.value);
  switch (line.name) {
    case "EMAIL": return emailKey(value);
    case "TEL": {
      const digits = phoneDigits(value);
      return digits ? `${digits}x${(PHONE_EXTENSION.exec(value)?.[0] ?? "").replace(/\D/g, "")}` : value;
    }
    case "ADR": {
      // PO box, extended address, street, city and postal code together: one postal code holds many addresses.
      const parts = line.value.split(";");
      return [0, 1, 2, 3].map((index) => plain(unescape(parts[index] ?? ""))).concat(postalKey(parts[5] ?? "")).join("|");
    }
    case "URL": return value.replace(/\/$/, "").toLowerCase();
    case "FN": case "ORG": return plain(value);
    case "N": case "TITLE": case "NICKNAME": return normalizeName(value);
    default: return line.value;
  }
}

const removeProperty = (text: string, name: string): string =>
  text.replace(new RegExp(`^${name}[;:].*(?:\\r?\\n[ \\t].*)*\\r?\\n`, "im"), "");

/**
 * `keepText` with what `other` holds and it lacks. A property a card holds once merges only
 * when the two agree or one is empty; otherwise it is a conflict, settled by `choices`
 * (the practitioner's word for the property -> the address of the card whose value stays).
 * Two different notes are joined.
 */
function mergeInto(keepText: string, other: Card, choices: Record<string, string>): { text: string; conflicts: string[]; added: number } {
  const keep = rawLines(keepText);
  const held = new Set(keep.map(({ line }) => `${line.name}:${valueKey(line)}`));
  const single = new Map(keep.filter(({ line }) => line.name in SINGLE).map((entry) => [entry.line.name, entry]));
  let nextItem = Math.max(0, ...keep.map(({ line }) => Number(/^item(\d+)$/i.exec(line.group ?? "")?.[1] ?? 0))) + 1;
  let text = keepText;
  const add: string[] = [];
  const conflicts = new Set<string>();

  // A labelled detail is several lines sharing a group name, carried over together.
  const units = new Map<string, Raw[]>();
  rawLines(other.text).forEach((entry, index) => {
    const key = entry.line.group ?? `#${index}`;
    units.set(key, [...(units.get(key) ?? []), entry]);
  });
  for (const unit of units.values()) {
    const primary = unit.find(({ line }) => !line.name.startsWith("X-AB")) ?? unit[0];
    const name = primary.line.name;
    if (OWN.has(name)) continue;
    if (name in SINGLE) {
      const mine = single.get(name);
      if (!mine) add.push(...unit.map((entry) => entry.raw));
      else if (name === "X-ABSHOWAS" || valueKey(mine.line) === valueKey(primary.line)) continue;
      else if (name === "NOTE") {
        const [a, b] = [unescape(mine.line.value), unescape(primary.line.value)];
        if (a.includes(b)) continue;
        text = removeProperty(text, name);
        add.push(b.includes(a) ? primary.raw : `NOTE:${escape(`${a}\n\n${b}`)}`);
      } else if (choices[SINGLE[name]] === other.url) {
        text = removeProperty(text, name);
        add.push(primary.raw);
      } else if (choices[SINGLE[name]] === undefined) conflicts.add(SINGLE[name]);
      continue;
    }
    if (held.has(`${name}:${valueKey(primary.line)}`)) continue;
    held.add(`${name}:${valueKey(primary.line)}`);
    const group = primary.line.group === undefined ? undefined : `item${nextItem++}`;
    add.push(...unit.map((entry) => (group ? entry.raw.replace(/^[^.:;]+\./, `${group}.`) : entry.raw)));
  }
  return { text: add.length ? addLines(text, add, "") : text, conflicts: [...conflicts], added: add.length };
}

export type GroupClass = "exact" | "mergeable" | "needs_choice" | "possible";

export interface Group {
  group_id: string;
  /** exact: the others hold nothing the kept card lacks. possible: the same name, but not provably the same contact. */
  class: GroupClass;
  members: Array<Card & { contact: Contact }>;
  /** The member that holds the most, kept unless the practitioner picks another. */
  keep: string;
  conflicts: string[];
}

/** The merged card for a group, keeping `keepUrl`. `rev` stamps it when anything was added. */
export function mergeGroup(
  members: Card[], keepUrl: string, choices: Record<string, string>, rev: string
): { text: string; conflicts: string[]; added: number } {
  const keep = members.find((card) => card.url === keepUrl) as Card;
  let text = keep.text;
  let added = 0;
  const conflicts = new Set<string>();
  for (const other of members.filter((card) => card.url !== keepUrl)) {
    const merged = mergeInto(text, other, choices);
    text = merged.text;
    added += merged.added;
    merged.conflicts.forEach((conflict) => conflicts.add(conflict));
  }
  return { text: added ? addLines(text, [], rev) : text, conflicts: [...conflicts], added };
}

const shares = (a: Set<string>, b: Set<string>): boolean => [...a].some((value) => b.has(value));
const within = (a: Set<string>, b: Set<string>): boolean => [...a].every((value) => b.has(value));

/** Every set of two or more cards that share a name and a kind (person or company). */
export function findGroups(cards: Card[]): Group[] {
  const entries = cards.map((card) => ({ ...card, contact: parseContact(card.text) })).filter((entry) => !entry.contact.isGroup).map((entry) => {
    const { contact } = entry;
    const company = !contact.firstName && !contact.lastName;
    const keys: MatchKeys = matchKeys({
      names: company ? [contact.name, contact.organization] : [contact.name, `${contact.firstName ?? ""} ${contact.lastName ?? ""}`],
      emails: contact.emails.map((value) => value.value),
      phones: contact.phones.map((value) => value.value),
      postals: contact.addresses.map((address) => address.postalCode ?? ""),
    });
    return { ...entry, company, keys, size: rawLines(entry.text).length };
  });
  type Entry = (typeof entries)[number];

  // Cards joined by a shared name, however many names a card has.
  const sets: Entry[][] = [];
  for (const entry of entries) {
    const joined = sets.filter((set) => set.some((other) => other.company === entry.company && shares(other.keys.names, entry.keys.names)));
    const merged = [...joined.flat(), entry];
    joined.forEach((set) => sets.splice(sets.indexOf(set), 1));
    sets.push(merged);
  }
  // The same contact: a shared detail, or one card's details all held by the other. A card
  // with no email, phone or postal code is held by every namesake, so it proves nothing.
  const same = (a: Entry, b: Entry): boolean => {
    const details = (keys: MatchKeys, other: MatchKeys) =>
      keys.emails.size + keys.phones.size + keys.postals.size > 0 &&
      within(keys.emails, other.emails) && within(keys.phones, other.phones) && within(keys.postals, other.postals);
    return matchReasons(a.keys, b.keys).length > 1 || details(a.keys, b.keys) || details(b.keys, a.keys);
  };
  return sets.filter((set) => set.length > 1).map((set) => {
    const members = [...set].sort((a, b) => a.url.localeCompare(b.url));
    const keep = [...members].sort((a, b) => b.size - a.size)[0].url;
    const proven = members.every((a) => members.every((b) => a === b || same(a, b)));
    const { conflicts, added } = mergeGroup(members, keep, {}, "");
    return {
      group_id: createHash("sha256").update(members.map((member) => member.url).join("\n")).digest("hex").slice(0, 12),
      class: !proven ? "possible" : conflicts.length ? "needs_choice" : added ? "mergeable" : "exact",
      members: members.map(({ url, etag, text, contact }) => ({ url, etag, text, contact })),
      keep,
      conflicts,
    };
  });
}
