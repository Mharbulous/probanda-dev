// The text of this computer's own records that the suggestion cross-check builds its tokens from
// (docs/Plans/2026-10-25_suggestion-design.md, decision 8), by the six record sources it names:
//
//   client          practice data: each client's name and client number
//   matter          practice data: each matter's description, file number and matter number;
//                   case data: each proceeding's court file number and style of cause
//   contact         practice data: each contact's name, other names, emails, phones and addresses;
//                   case data: each party's name, counsel and counsel's firm
//   folder_name     practice data: each matter's folder; the folder map's folders; the name of each
//                   matter's case data folder
//   document_title  case data: each document's title
//   file_name       case data: each document's file name
//
// Everything here is client information. It is read on this computer, held in memory for one check,
// and never logged, stored or sent (Commandment 3). A source that cannot be read is reported by its
// state only, never with the error text, which can hold a path.

import type { PracticeStore } from "../practice/store.js";
import { rowsOf, type Row } from "../practice/items.js";
import { listCaseRecordNames, type CaseRecordNames } from "../case/list-record-names.js";
import { matterDataFolders, type MatterDataFolder } from "../tools/practice/contacts.js";
import { readFirmProfile } from "../tools/practice/firm-profile.js";
import { readFolderMap } from "../tools/practice/folder-map.js";

export const RECORD_SOURCES = ["client", "matter", "contact", "folder_name", "document_title", "file_name"] as const;
export type RecordSource = (typeof RECORD_SOURCES)[number];

/** read: every record of the source was read; none: the source holds no record; partial: some could
 * not be read; unavailable: none could be read. */
export type SourceState = "read" | "none" | "partial" | "unavailable";

export interface RecordTexts {
  texts: Record<RecordSource, string[]>;
  states: Record<RecordSource, SourceState>;
  /** The firm's own name, whose words are never tokens; null when the firm profile cannot be read. */
  firmName: string | null;
}

/** Test seams. Each defaults to the real read. */
export interface RecordSeams {
  firmName?: (env: NodeJS.ProcessEnv) => string | null;
  folderMapFolders?: (env: NodeJS.ProcessEnv) => string[] | null;
  matterFolders?: (store: PracticeStore, matters: Row[], miss: (matter: Row | null) => void) => MatterDataFolder[];
  listNames?: (folders: string[], env: NodeJS.ProcessEnv) => CaseRecordNames[];
}

/** Every string inside a value, however deeply nested. */
function leaves(value: unknown, into: string[]): string[] {
  if (typeof value === "string") {
    if (value.trim()) into.push(value);
  } else if (typeof value === "number" && Number.isFinite(value)) {
    into.push(String(value));
  } else if (Array.isArray(value)) {
    for (const item of value) leaves(item, into);
  } else if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) leaves(item, into);
  }
  return into;
}

function fields(rows: Row[], names: string[]): string[] {
  const out: string[] = [];
  for (const row of rows) for (const name of names) leaves(row[name], out);
  return out;
}

function defaultFirmName(env: NodeJS.ProcessEnv): string | null {
  try {
    return readFirmProfile(env).firm_name;
  } catch {
    return null;
  }
}

/** The folder map's folders, [] when this machine has none, null when it cannot be read. */
function defaultFolderMapFolders(env: NodeJS.ProcessEnv): string[] | null {
  try {
    const map = readFolderMap(env);
    return map.status === "ok" ? map.entries.flatMap((entry) => entry.folders) : [];
  } catch {
    return null;
  }
}

export async function readRecordTexts(store: PracticeStore, env: NodeJS.ProcessEnv = store.env, seams: RecordSeams = {}): Promise<RecordTexts> {
  const texts = Object.fromEntries(RECORD_SOURCES.map((s) => [s, [] as string[]])) as Record<RecordSource, string[]>;
  const failed = new Set<RecordSource>();

  let matters: Row[] = [];
  try {
    const items = store.items();
    const clients = rowsOf(items, "client");
    matters = rowsOf(items, "matter");
    const contacts = rowsOf(items, "contact");
    texts.client.push(...fields(clients, ["name", "client_num"]));
    texts.matter.push(...fields(matters, ["description", "file_number", "matt_num"]));
    texts.contact.push(...fields(contacts, ["name", "other_names", "emails", "phones", "addresses"]));
    texts.folder_name.push(...fields(matters, ["folder"]));
  } catch {
    // Without the practice records there is no matter list, so no case data can be found either.
    for (const source of RECORD_SOURCES) failed.add(source);
  }

  const mapFolders = (seams.folderMapFolders ?? defaultFolderMapFolders)(env);
  if (mapFolders === null) failed.add("folder_name");
  else texts.folder_name.push(...mapFolders);

  // Case data: every matter's folder, closed matters included, read in one spawn.
  const caseSources = ["matter", "contact", "folder_name", "document_title", "file_name"] as const;
  if (matters.length) {
    let missed = false;
    const folders = (seams.matterFolders ?? ((s, m, miss) => matterDataFolders(s, m, (matter) => miss(matter))))(store, matters, () => {
      missed = true;
    });
    if (missed) for (const source of caseSources) failed.add(source);
    texts.folder_name.push(...folders.map((folder) => folder.name));
    const names = (seams.listNames ?? listCaseRecordNames)(folders.map((folder) => folder.folder), env);
    for (const result of names) {
      if (result.status === "unavailable") {
        for (const source of caseSources) failed.add(source);
      } else if (result.status === "ok") {
        texts.document_title.push(...result.titles);
        texts.file_name.push(...result.file_names);
        texts.matter.push(...result.matter);
        texts.contact.push(...result.parties);
      }
    }
  }

  const states = Object.fromEntries(RECORD_SOURCES.map((source) => {
    const state: SourceState = failed.has(source)
      ? (texts[source].length ? "partial" : "unavailable")
      : texts[source].length ? "read" : "none";
    return [source, state];
  })) as Record<RecordSource, SourceState>;
  return { texts, states, firmName: (seams.firmName ?? defaultFirmName)(env) };
}
