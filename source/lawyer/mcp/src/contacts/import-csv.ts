// Reads a spreadsheet export of contacts (CSV with a header row, as Outlook writes it)
// into one neutral record per row. Columns are found by header name, never by position.

import { ValidationError } from "../errors.js";
import { emailKey, phoneDigits } from "../contact-match.js";

export interface IncomingAddress {
  label: string;
  street: string;
  city: string;
  region: string;
  postalCode: string;
}

/** One row of the file, with placeholders emptied. */
export interface Incoming {
  row: number;
  kind: "person" | "company";
  name: string;
  firstName: string;
  middleName: string;
  lastName: string;
  nickname: string;
  organization: string;
  jobTitle: string;
  emails: string[];
  phones: Array<{ label: string; value: string }>;
  addresses: IncomingAddress[];
  url: string;
  birthday: string;
  notes: string;
}

/** UTF-8 when the bytes are valid UTF-8, otherwise Windows-1252, which older exports use. */
export function decodeCsv(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return text.replace(/^﻿/, "");
}

/** The cells of each non-blank row. Quoted cells may hold commas, line breaks and doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') cell += text[++i];
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) rows.push([...row, cell]);
  return rows.filter((cells) => cells.some((value) => value.trim() !== ""));
}

const PLACEHOLDERS = new Set(["-", "null", "null null"]);
const PLACEHOLDER_BIRTHDAY = "1899-01-01";

const PHONE_COLUMNS: Array<[string, string]> = [
  ["mobile phone", "mobile"], ["business phone", "work"], ["business phone 2", "work"], ["home phone", "home"],
  ["home phone 2", "home"], ["company main phone", "main"], ["business fax", "work fax"], ["other phone", "other"],
  ["other fax", "other fax"], ["assistant's phone", "other"], ["car phone", "car"], ["callback", "other"],
];
const EMAIL_COLUMNS = ["e-mail address", "e-mail 2 address", "e-mail 3 address"];
const ADDRESS_COLUMNS: Array<[string, string]> = [["home", "home"], ["business", "work"], ["other", "other"]];
const NAME_COLUMNS = ["first name", "last name", "company", "name"];

/** The file's rows as records, and the rows left out because nothing in them names a contact. */
export function readContactRows(text: string): { rows: Incoming[]; skipped: Array<{ row: number; reason: string }> } {
  const [header, ...body] = parseCsv(text);
  const columns = new Map((header ?? []).map((name, index) => [name.trim().toLowerCase(), index]));
  if (!NAME_COLUMNS.some((name) => columns.has(name))) {
    throw new ValidationError("This file has no header row naming a First Name, Last Name, Company or Name column.");
  }
  const rows: Incoming[] = [];
  const skipped: Array<{ row: number; reason: string }> = [];
  body.forEach((cells, index) => {
    const row = index + 2; // the row number a spreadsheet shows, under the header
    const cell = (name: string): string => {
      const value = (cells[columns.get(name) ?? -1] ?? "").trim();
      return PLACEHOLDERS.has(value.toLowerCase()) ? "" : value;
    };
    const distinct = <T>(values: T[], key: (value: T) => string): T[] => {
      const seen = new Set<string>();
      return values.filter((value) => key(value) !== "" && !seen.has(key(value)) && Boolean(seen.add(key(value))));
    };
    const organization = cell("company");
    let firstName = cell("first name");
    const lastName = cell("last name");
    if (!firstName && !lastName && !organization) firstName = cell("name");
    const person = Boolean(firstName || lastName);
    if (!person && !organization) {
      skipped.push({ row, reason: "no name" });
      return;
    }
    const middleName = person ? cell("middle name") : "";
    const birthday = cell("birthday");
    rows.push({
      row,
      kind: person ? "person" : "company",
      name: person ? [firstName, middleName, lastName].filter(Boolean).join(" ") : organization,
      firstName, middleName, lastName,
      nickname: cell("nick name"),
      organization,
      jobTitle: cell("job title"),
      emails: distinct(EMAIL_COLUMNS.map(cell), emailKey),
      phones: distinct(PHONE_COLUMNS.map(([column, label]) => ({ label, value: cell(column) })), (phone) => phoneDigits(phone.value)),
      addresses: ADDRESS_COLUMNS.map(([column, label]) => ({
        label,
        street: cell(`${column} street`),
        city: cell(`${column} city`),
        region: cell(`${column} province`) || cell(`${column} state`),
        postalCode: cell(`${column} postal code`),
      })).filter((address) => address.street || address.city || address.postalCode),
      url: cell("web page"),
      birthday: /^\d{4}-\d{2}-\d{2}$/.test(birthday) && birthday !== PLACEHOLDER_BIRTHDAY ? birthday : "",
      notes: cell("notes"),
    });
  });
  return { rows, skipped };
}
