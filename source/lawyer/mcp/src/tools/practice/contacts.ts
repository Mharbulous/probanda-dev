// Contacts, affiliations and matter roles (ADR 0009, firm-wide contacts spec 4): one contact per
// person or organization the firm deals with, tied to organizations by affiliations and to
// matters by matter roles. Writes go through the one write sequence (practice/store.ts); the
// rules they must satisfy, and the vocabularies of entity and role, are Probanda's Cloud's.
// Reads and the two gap checks use practice.db and the matter's case data only.

import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { caseDataFolder } from "../../case/locate.js";
import { listCaseParties } from "../../case/list-parties.js";
import { NotFoundError, ValidationError } from "../../errors.js";
import { CASE_DATA_FOLDER } from "../../files/matter-root.js";
import { today } from "../../knowledge/common.js";
import { resolveCaseDataRoot } from "../../practice/matter-data-root.js";
import { flatten, rowsOf, type Item, type Row } from "../../practice/items.js";
import { canonicalJson, type OpSpec } from "../../practice/ops.js";
import type { PracticeStore } from "../../practice/store.js";
import { asString, loadClientsById, newId, normalizeMattNum, requireMatter } from "./shared.js";

export { today };

function rowOf(items: Map<string, Item>, id: string): Row {
  const item = items.get(id);
  if (!item) throw new NotFoundError(`Item ${id} is not in practice.db after the write`);
  return flatten(id, item);
}

function stringList(value: unknown, label: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new ValidationError(`${label} must be a list of strings`);
  }
  return value as string[];
}

function addressList(value: unknown, label: string): Record<string, unknown>[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((entry) => entry === null || typeof entry !== "object" || Array.isArray(entry))) {
    throw new ValidationError(`${label} must be a list of address objects`);
  }
  return value as Record<string, unknown>[];
}

/** One contact op from upsert_contact's fields. A new contact's lists start empty; an update changes only what it names. */
export function contactOp(fields: Record<string, unknown>, id: string, creating: boolean, label: string): OpSpec {
  const list = (value: unknown[] | undefined) => value ?? (creating ? [] : undefined);
  return {
    op: creating ? "create" : "update", id, kind: "contact",
    tags: { entity: fields.entity },
    data: {
      name: fields.name,
      emails: list(stringList(fields.emails, `${label}.emails`)),
      phones: list(stringList(fields.phones, `${label}.phones`)),
      addresses: list(addressList(fields.addresses, `${label}.addresses`)),
      other_names: list(stringList(fields.other_names, `${label}.other_names`)),
      carddav_url: fields.carddav_url,
      note: fields.note,
    },
  };
}

export async function upsert_contact(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<{ contact_id: string; created: boolean }> {
  const creating = !args.id;
  const id = creating ? newId() : String(args.id);
  if (!creating && store.items().get(id)?.kind !== "contact") throw new NotFoundError(`No contact ${id}`);
  await store.write("upsert_contact", {}, [contactOp(args, id, creating, "upsert_contact")]);
  return { contact_id: id, created: creating };
}

export async function upsert_affiliation(store: PracticeStore, args: Record<string, unknown>): Promise<Row> {
  const creating = !args.id;
  const { ops, items } = await store.write("upsert_affiliation", {}, [{
    op: creating ? "upsert" : "update", id: creating ? newId() : String(args.id), kind: "affiliation",
    links: { person: args.person_id as string | undefined, organization: args.organization_id as string | undefined },
    // `from` is part of the upsert key, so a new tie always sends it, null when not given.
    data: { from: creating ? args.from ?? null : args.from, to: args.to, title: args.title },
  }]);
  return rowOf(items, ops[0].as);
}

export async function upsert_matter_role(store: PracticeStore, args: Record<string, unknown>): Promise<Row> {
  const matterId = args.matt_num || args.matter_id ? requireMatter(store.items(), args).id : undefined;
  const creating = !args.id;
  const { ops, items } = await store.write("upsert_matter_role", {}, [{
    op: creating ? "upsert" : "update", id: creating ? newId() : String(args.id), kind: "matter_role",
    tags: { role: args.role },
    links: { matter: matterId, contact: args.contact_id as string | undefined },
    // `case_proceeding_id` is part of the upsert key, so a new role always sends it.
    data: {
      from: args.from, to: args.to, note: args.note, case_party_id: args.case_party_id,
      case_proceeding_id: creating ? args.case_proceeding_id ?? null : args.case_proceeding_id,
      from_source_id: args.from_source_id, to_source_id: args.to_source_id, unfiled: args.unfiled,
    },
  }]);
  return rowOf(items, ops[0].as);
}

// ---- contact_lookup ----

const CORPORATE_SUFFIX = /\s+(ltd|limited|inc|incorporated|llp|lp|llc|corp|corporation|co)$/;

/** A name with case, punctuation and trailing corporate suffixes ignored. */
export function normalizeName(value: unknown): string {
  let name = String(value ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  while (CORPORATE_SUFFIX.test(name)) name = name.replace(CORPORATE_SUFFIX, "");
  return name;
}

export function phoneDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function listOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

export async function contact_lookup(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<{ contacts: Row[]; near: Row[] }> {
  const byMatter = Boolean(args.matt_num || args.matter_id);
  if (!args.id && !args.query && !byMatter) throw new ValidationError("contact_lookup requires id, query or a matter ref");
  const items = store.items();
  const contacts = rowsOf(items, "contact");
  const affiliations = rowsOf(items, "affiliation");
  // With a matter ref, only that matter's roles, and only the contacts holding one.
  const matterId = byMatter ? requireMatter(items, args).id : null;
  const roles = rowsOf(items, "matter_role").filter((row) => matterId === null || row.matter_id === matterId);
  const matters = new Map(rowsOf(items, "matter").map((row) => [String(row.id), row]));
  const limit = typeof args.limit === "number" && args.limit > 0 ? Math.floor(args.limit) : 25;

  const query = String(args.query ?? "").toLowerCase();
  // A phone matches on its digits too, so 604.555.0199 is found by "555-0199".
  const queryDigits = query.replace(/\D/g, "");
  const found = (args.id
    ? contacts.filter((contact) => contact.id === String(args.id))
    : contacts.filter((contact) => !query ||
      [contact.name, ...listOf(contact.other_names), ...listOf(contact.emails), ...listOf(contact.phones)]
        .some((value) => typeof value === "string" && value.toLowerCase().includes(query)) ||
      (queryDigits.length >= 4 && listOf(contact.phones).some((phone) => phone.replace(/\D/g, "").includes(queryDigits))))
  ).filter((contact) => matterId === null || roles.some((row) => row.contact_id === contact.id)).slice(0, limit);
  if (!args.id && !query) return { contacts: found.map((contact) => withTies(contact, affiliations, roles, matters)), near: [] };

  // What a near contact may share with what was found, or with the query itself.
  const names = new Set(found.flatMap((contact) => [contact.name, ...listOf(contact.other_names)].map(normalizeName)));
  const emails = new Set(found.flatMap((contact) => listOf(contact.emails).map((email) => email.toLowerCase())));
  const phones = new Set(found.flatMap((contact) => listOf(contact.phones).map(phoneDigits)));
  if (query) {
    names.add(normalizeName(query));
    emails.add(query.trim());
    phones.add(phoneDigits(query));
  }
  names.delete("");
  phones.forEach((digits) => digits.length < 7 && phones.delete(digits));

  const foundIds = new Set(found.map((contact) => String(contact.id)));
  const near: Row[] = [];
  for (const contact of contacts) {
    if (foundIds.has(String(contact.id))) continue;
    const reasons: string[] = [];
    if ([contact.name, ...listOf(contact.other_names)].some((name) => names.has(normalizeName(name)))) reasons.push("same name");
    if (listOf(contact.emails).some((email) => emails.has(email.toLowerCase()))) reasons.push("shared email");
    if (listOf(contact.phones).some((phone) => phones.has(phoneDigits(phone)))) reasons.push("shared phone");
    if (reasons.length) near.push({ id: contact.id, name: contact.name, entity: contact.entity, reasons });
  }

  return { contacts: found.map((contact) => withTies(contact, affiliations, roles, matters)), near };
}

/** A found contact with its affiliations and its matter roles (with matt_num). */
function withTies(contact: Row, affiliations: Row[], roles: Row[], matters: Map<string, Row>): Row {
  return {
    ...contact,
    affiliations: affiliations.filter((row) => row.person_id === contact.id || row.organization_id === contact.id),
    roles: roles
      .filter((row) => row.contact_id === contact.id)
      .map((row) => ({ ...row, matt_num: matters.get(String(row.matter_id))?.matt_num ?? null })),
  };
}

// ---- contact_checks ----

/** A matter-data folder's leading matter number, read as /matter-data's parse_folder_name reads it. */
function folderMatterNum(name: string): string | null {
  const match = /^\s*((?:\d+\.)?[A-Za-z]?\d+[A-Za-z0-9.\-]*)\s+/.exec(name);
  return match ? normalizeMattNum(match[1]).replace(/[-.]+$/, "").toLowerCase() : null;
}

interface Unresolved {
  matter_id: string | null;
  matt_num: string | null;
  reason: string;
}

export interface MatterDataFolder {
  matter: Row;
  /** The folder holding the matter's main.sqlite. */
  folder: string;
  /** That folder's name, or the matter folder's name for a matter's own `0. CASE DATA`. */
  name: string;
}

/**
 * The matter-data folder of each of `matters` that has one, found by its matter number. A matter's
 * own `0. CASE DATA` folder (ADR 0013) comes first, as /matter-data resolves it; a matter not yet
 * relocated keeps its folder under the firm root. A matter that cannot be placed is passed to `miss`
 * with its reason (with no matter when the case data root itself cannot be found); a matter with no
 * matter-data folder is simply absent. Also read by the suggestion cross-check (suggestions/records.ts).
 */
export function matterDataFolders(
  store: PracticeStore,
  matters: Row[],
  miss: (matter: Row | null, reason: string) => void
): MatterDataFolder[] {
  let caseDataRoot: string;
  try {
    caseDataRoot = store.env.COCLERK_CASE_DATA_ROOT || resolveCaseDataRoot(store.env);
  } catch (err) {
    miss(null, `the case data root could not be found: ${(err as Error).message}`);
    return [];
  }
  const holding = (parent: string, sub: string) => readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(parent, entry.name, sub, "main.sqlite")))
    .map((entry) => ({ name: entry.name, folder: join(parent, entry.name, sub) }));
  const library = dirname(caseDataRoot);
  const inMatter = holding(library, CASE_DATA_FOLDER);
  const children = holding(caseDataRoot, "");
  const found: MatterDataFolder[] = [];
  for (const matter of matters) {
    if (!matter.matt_num) {
      miss(matter, "it has no matter number to find its matter-data folder by");
      continue;
    }
    const wanted = normalizeMattNum(matter.matt_num).toLowerCase();
    const own = inMatter.filter((entry) => folderMatterNum(entry.name) === wanted);
    const named = own.length ? own : children.filter((entry) => folderMatterNum(entry.name) === wanted);
    if (named.length > 1) miss(matter, `more than one matter-data folder starts with its matter number: ${named.map((entry) => entry.folder).join(", ")}`);
    else if (named.length === 1) found.push({ matter, folder: named[0].folder, name: named[0].name });
  }
  return found;
}

export async function contact_checks(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<{ matters_without_client: Row[]; parties_without_role: Row[]; unresolved: Unresolved[] }> {
  const items = store.items();
  const clients = loadClientsById(items);
  const roles = rowsOf(items, "matter_role");
  const one = args.matt_num || args.matter_id ? requireMatter(items, args) : null;
  const matters = (one ? [one.row] : rowsOf(items, "matter")).filter((matter) => matter.status !== "closed");
  const now = today();

  const matters_without_client = matters
    .filter((matter) => !roles.some((role) =>
      role.matter_id === matter.id && role.role === "client" && (!role.to || String(role.to) > now)))
    .map((matter) => ({
      matter_id: matter.id,
      matt_num: matter.matt_num ?? null,
      client_name: clients.get(String(matter.client_id))?.name ?? null,
    }));

  const unresolved: Unresolved[] = [];
  const miss = (matter: Row | null, reason: string) =>
    unresolved.push({ matter_id: matter ? String(matter.id) : null, matt_num: matter ? (matter.matt_num as string) ?? null : null, reason });

  // The matter-data folder of each matter check 2 reads.
  const folders: [Row, string][] = [];
  if (one) {
    if (args.matter_root) {
      try {
        folders.push([one.row, caseDataFolder(String(args.matter_root), store.env)]);
      } catch (err) {
        miss(one.row, `its matter-data folder could not be found from matter_root: ${(err as Error).message}`);
      }
    }
  } else if (matters.length) {
    folders.push(...matterDataFolders(store, matters, miss).map(({ matter, folder }) => [matter, folder] as [Row, string]));
  }

  const parties_without_role: Row[] = [];
  for (const [matter, folder] of folders) {
    const read = listCaseParties(folder, store.env);
    if (read.status === "unavailable") miss(matter, read.reason);
    if (read.status !== "ok") continue;
    for (const party of read.parties) {
      const covered = roles.some((role) => role.matter_id === matter.id && String(role.case_party_id) === String(party.party_id));
      if (covered) continue;
      parties_without_role.push({
        matter_id: matter.id,
        party_id: party.party_id,
        name: party.name,
        party_type: party.party_type,
        proceeding_ids: [...new Set(party.proceedings.map((entry) => entry.proceeding_id))],
        lawyer_name: party.lawyer_name,
        lawyer_firm: party.lawyer_firm,
      });
    }
  }

  return { matters_without_client, parties_without_role, unresolved };
}

// ---- merge_contact ----

interface Conflict {
  item: string;
  field: string;
  keep: unknown;
  spare: unknown;
}

function present(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

function same(a: unknown, b: unknown): boolean {
  return canonicalJson(a ?? null) === canonicalJson(b ?? null);
}

function union(...lists: unknown[]): unknown[] {
  const seen = new Map<string, unknown>();
  for (const list of lists) {
    for (const entry of Array.isArray(list) ? list : []) seen.set(canonicalJson(entry), seen.get(canonicalJson(entry)) ?? entry);
  }
  return [...seen.values()];
}

/**
 * The fields of `spare` to fill into `keep`: each set on spare only. A field both set
 * differently is a conflict instead.
 */
function fill(keepId: string, keep: Record<string, unknown>, spare: Record<string, unknown>, fields: string[], conflicts: Conflict[]): Record<string, unknown> {
  const filled: Record<string, unknown> = {};
  for (const field of fields) {
    if (present(keep[field]) && present(spare[field]) && !same(keep[field], spare[field])) {
      conflicts.push({ item: keepId, field, keep: keep[field], spare: spare[field] });
    } else if (!present(keep[field]) && present(spare[field])) {
      filled[field] = spare[field];
    }
  }
  return filled;
}

export async function merge_contact(
  store: PracticeStore,
  args: Record<string, unknown>
): Promise<{ merged: false; conflicts: Conflict[] } | { merged: true; contact_id: string; moved: number; combined: number }> {
  const keepId = asString(args.keep_id, "keep_id");
  const spareId = asString(args.spare_id, "spare_id");
  if (keepId === spareId) throw new ValidationError("keep_id and spare_id name the same contact");
  const items = store.items();
  const keep = items.get(keepId);
  const spare = items.get(spareId);
  if (keep?.kind !== "contact") throw new NotFoundError(`No contact ${keepId}`);
  if (spare?.kind !== "contact") throw new NotFoundError(`No contact ${spareId}`);

  const conflicts: Conflict[] = [];
  if (!same(keep.tags.entity, spare.tags.entity)) {
    conflicts.push({ item: keepId, field: "entity", keep: keep.tags.entity, spare: spare.tags.entity });
  }
  const spareName = present(spare.data.name) && spare.data.name !== keep.data.name ? [spare.data.name] : [];
  const ops: OpSpec[] = [{
    op: "update", id: keepId, kind: "contact",
    data: {
      emails: union(keep.data.emails, spare.data.emails),
      phones: union(keep.data.phones, spare.data.phones),
      addresses: union(keep.data.addresses, spare.data.addresses),
      other_names: union(keep.data.other_names, spare.data.other_names, spareName).filter((name) => name !== keep.data.name),
      ...fill(keepId, keep.data, spare.data, ["carddav_url", "note"], conflicts),
    },
  }];

  // Each matter role and affiliation of spare moves to keep, or is combined into the one keep
  // already holds with the same key.
  let moved = 0;
  let combined = 0;
  const linked = (kind: string, roles: string[]) =>
    [...items].filter(([, item]) => item.kind === kind && roles.some((role) => item.links[role] === spareId));
  const shift = (kind: string, keyLinks: string[], keyData: string[], fields: string[]) => {
    for (const [spareItemId, item] of linked(kind, keyLinks)) {
      const role = keyLinks.find((name) => item.links[name] === spareId) as string;
      const twin = [...items].find(([, other]) =>
        other.kind === kind && other.links[role] === keepId && same(other.tags, item.tags) &&
        keyLinks.every((name) => name === role || other.links[name] === item.links[name]) &&
        keyData.every((name) => same(other.data[name], item.data[name])));
      if (!twin) {
        ops.push({ op: "update", id: spareItemId, kind, links: { [role]: keepId } });
        moved++;
        continue;
      }
      const filled = fill(twin[0], twin[1].data, item.data, fields, conflicts);
      if (Object.keys(filled).length) ops.push({ op: "update", id: twin[0], kind, data: filled });
      ops.push({ op: "delete", id: spareItemId, kind });
      combined++;
    }
  };
  shift("matter_role", ["contact", "matter"], ["case_proceeding_id", "case_party_id", "from"],
    ["to", "note", "from_source_id", "to_source_id", "unfiled"]);
  shift("affiliation", ["person", "organization"], ["from"], ["to", "title"]);

  if (conflicts.length) return { merged: false, conflicts };
  ops.push({ op: "delete", id: spareId, kind: "contact" });
  await store.write("merge_contact", {}, ops);
  return { merged: true, contact_id: keepId, moved, combined };
}
