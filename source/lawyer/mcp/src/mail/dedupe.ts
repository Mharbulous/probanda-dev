// The mail__dedupe_* tools: find duplicate emails and move an approved plan's copies to Trash.
// Tier 1 is copies byte-for-byte the same. Tier 2 is copies that share a Message-ID but differ,
// compared here and judged by the email-reader agent. Nothing but plan copies moves, only by
// the server's MOVE, and only to Trash. A server without MOVE or a Trash folder is still scanned,
// but gets no plan, so the scan only lists its copies.
//
// A call may not outlast a tool call's time limit and hashing a folder takes far longer, so the
// scan and the apply work in time-limited slices and save their progress between calls. The
// approval gate allows one successful mail__dedupe_apply per approval, so a later slice goes
// through mail__dedupe_apply_continue, which can continue a started plan and start nothing.
//
// A scan's files live under dedupe/<scan_id>/ in the mail state folder, so a new scan leaves every
// other scan and its plans alone. A scan saved by an older copy sits directly under dedupe/ and
// still reads. apply.json stays directly under dedupe/, because one plan moves at a time. A new scan
// removes each scan folder with nothing written in it for 7 days, since its comparison holds message
// text. The verdict ledger stays, so a removed scan's verdicts are still reused.
//
// The verdict ledger (verdicts.json in the mail state folder) keeps each tier 2 group's verdict by
// a hash of the account, the Message-ID and the copies' hashes, so a verdict is reused whichever
// skill judged the group first. It holds hashes, the verdict's one sentence and no message text.

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { defaultStateDir } from "../../../../mcp-shared/dpapi-store.js";
import { decodeWords, parseMime, type MimeParts } from "../correspondence/eml.js";
import { DataServerError, ValidationError } from "../errors.js";
import { isoDate, renderBody, stripBrackets, type BodyOptions } from "./body.js";
import { defaultImapFactory, draftsFolder, findFolder, folderMissing, requireCredential, trashFolder, withImap, type ImapClientLike } from "./imap.js";
import type { MailContext } from "./tools.js";

type Args = Record<string, unknown>;

const SLICE_MS = 20_000;
const CALL_TIMEOUT_MS = 120_000;
const MOVE_BATCH = 50;
const SAMPLE_COUNT = 5;
const SUBJECT_CAP = 120;
const HEADER_CAP = 500;
const DIFF_CAP = 8_000;
const DIFF_MAX_CELLS = 4_000_000;
const DIFF_CONTEXT = 2;
const PAGE_MAX_CHARS = 60_000;
const TEXT_BODY: BodyOptions = { format: "text", maxLength: Infinity, stripQuoted: false, stripInlineImages: false };
const SCAN_ID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const VERDICT_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const REASON_MAX = 300;
const ROLES = ["record", "extra", "duplicate", "draft"];
const BASES = ["comparison", "single_copy", "identical"];
const STATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Bump with the version in shared/mail-judging.md, the rules the reader agent judges by: a verdict
// made under older rules is ignored.
const RULES_VERSION = 1;

// --- state ---------------------------------------------------------------------------------

interface PlanCopy {
  folder: string;
  uid: number;
  uidvalidity: string;
  sha256: string;
}

interface Plan {
  tier: 1 | 2;
  scan_id: string;
  trash: string;
  remove: PlanCopy[];
  keep: PlanCopy[];
}

interface Entry {
  folder: string;
  uid: number;
  sha256: string;
  size: number;
  messageId?: string;
  date?: string;
  subject?: string;
}

interface FolderScan {
  folder: string;
  uidValidity: string;
  uids: number[];
  next: number;
}

interface FolderTally {
  folder: string;
  messages: number;
  without_message_id: number;
  groups: number;
  copies: number;
}

interface TierOneRow {
  folder: string;
  uid: number;
  date?: string;
  subject?: string;
  size: number;
}

interface ComparedCopy {
  copy_id: string;
  folder: string;
  uid: number;
  uidvalidity: string;
  sha256: string;
  date?: string;
  size: number;
  differing_headers: Record<string, string | null>;
  body_sha256: string;
  html_sha256?: string;
  attachments: { filename: string; size: number; sha256: string }[];
  other_parts: { type: string; size: number; sha256: string }[];
  // These four are absent from a scan saved by an older copy.
  x_unsent?: boolean;
  draft_flag?: boolean;
  in_drafts_folder?: boolean;
  auto_submitted?: string | null;
}

interface ComparedGroup {
  group_id: string;
  message_id: string;
  subject?: string;
  copies: ComparedCopy[];
  body_diffs: { from: string; to: string; diff: string; truncated: boolean }[];
  suggested_base?: string;
}

interface Verdict {
  mailbox: { keep: string[]; remove: string[] };
  roles: Record<string, string>;
  reason: string;
  basis: string;
  recorded_at: string;
  rules_version: number;
}

interface ScanState {
  scan_id: string;
  across: boolean;
  trash: string | null;
  // Absent from a scan saved by an older copy, which only began with MOVE and Trash confirmed.
  can_move?: boolean;
  // Absent from a scan saved by an older copy, whose files sit directly under dedupe/.
  own_folder?: boolean;
  drafts?: string | null;
  phase: "hashing" | "comparing" | "done";
  scans: FolderScan[];
  entries: Entry[];
  tallies: FolderTally[];
  rows: TierOneRow[];
  tier1: { groups: number; copies: number; bytes: number; plan_id: string | null };
  pending: { group_id: string; message_id: string; subject?: string; copies: Entry[] }[];
  nextGroup: number;
  compared: ComparedGroup[];
  unreadableGroups: number;
  unreadable_message_ids?: string[];
  groupCount: number;
}

interface ApplyState {
  plan_id: string;
  phase: "verifying" | "moving" | "done" | "stopped";
  checks: PlanCopy[];
  checked: number;
  queue: PlanCopy[];
  moved: { folder: string; uid: number; new_uid?: number }[];
  gone: { folder: string; uid: number }[];
  error?: string;
}

const mailStateDir = (): string => defaultStateDir(process.env, "mail");
const dedupeDir = (): string => join(mailStateDir(), "dedupe");
const scanDir = (state: ScanState): string => (state.own_folder ? join(dedupeDir(), state.scan_id) : dedupeDir());

function writeState(dir: string, name: string, text: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), text);
}

function readState(dir: string, name: string): string | undefined {
  try {
    return readFileSync(join(dir, name), "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

const saveScan = (state: ScanState): void => writeState(scanDir(state), "scan.json", JSON.stringify(state));
const saveApply = (state: ApplyState): void => writeState(dedupeDir(), "apply.json", JSON.stringify(state));

function loadJson<T>(dir: string, name: string): T | undefined {
  const text = readState(dir, name);
  return text ? (JSON.parse(text) as T) : undefined;
}

/** The scan with this id, in its own folder or, saved by an older copy, directly under dedupe/. */
function loadScan(scanId: unknown): ScanState | undefined {
  if (typeof scanId !== "string") return undefined;
  const own = SCAN_ID.test(scanId) ? loadJson<ScanState>(join(dedupeDir(), scanId), "scan.json") : undefined;
  if (own) return own;
  const older = loadJson<ScanState>(dedupeDir(), "scan.json");
  return older?.scan_id === scanId ? older : undefined;
}

export const sha256 = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");

/** Writes a plan as its own hash's preimage, so a plan changed on disk no longer has its id. */
function writePlan(plan: Plan, dir: string): string {
  const text = JSON.stringify(plan);
  writeState(dir, `tier${plan.tier}-plan.json`, text);
  return sha256(text);
}

function scanFolders(): string[] {
  try {
    return readdirSync(dedupeDir(), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(dedupeDir(), e.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function readPlan(planId: string): Plan | undefined {
  for (const dir of [dedupeDir(), ...scanFolders()]) {
    for (const tier of [1, 2]) {
      const text = readState(dir, `tier${tier}-plan.json`);
      if (text && sha256(text) === planId) return JSON.parse(text) as Plan;
    }
  }
  return undefined;
}

function lastWritten(path: string): number {
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return Math.max(stat.mtimeMs, ...readdirSync(path).map((name) => statSync(join(path, name)).mtimeMs));
}

/**
 * Removes each entry of a state folder that bears a name this server generates and has had nothing
 * written in it for 7 days. Any other name stays, and nothing in the mailbox changes. An entry that
 * is in use or already gone stays for the next prune, so this never stops the call that prunes.
 */
export function pruneOld(dir: string, ownName: RegExp): void {
  for (const name of readdirSync(dir)) {
    if (!ownName.test(name)) continue;
    const path = join(dir, name);
    try {
      if (Date.now() - lastWritten(path) > STATE_MAX_AGE_MS) rmSync(path, { recursive: true, force: true });
    } catch {
      continue;
    }
  }
}

// --- verdict ledger ------------------------------------------------------------------------

const ledgerPath = (): string => join(mailStateDir(), "verdicts.json");
const isLive = (v: Verdict): boolean => v.rules_version >= RULES_VERSION && Date.now() - Date.parse(v.recorded_at) <= VERDICT_MAX_AGE_MS;

/** The live verdicts. A ledger that cannot be parsed costs only a second judgment, so it reads as empty. */
function loadLedger(): Record<string, Verdict> {
  let parsed: Record<string, Verdict>;
  try {
    parsed = JSON.parse(readFileSync(ledgerPath(), "utf-8")) as Record<string, Verdict>;
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  return Object.fromEntries(Object.entries(parsed).filter(([, v]) => isLive(v)));
}

/** Written whole or not at all, through its own temp file. */
function saveLedger(ledger: Record<string, Verdict>): void {
  mkdirSync(mailStateDir(), { recursive: true });
  const temp = `${ledgerPath()}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(ledger));
  renameSync(temp, ledgerPath());
}

const ledgerAccount = (context: MailContext): string => (context.mail.credential ? `${context.mail.credential.username}@${context.mail.credential.host}` : "");

function verdictKey(account: string, group: ComparedGroup): string {
  const messageId = stripBrackets(group.message_id);
  return sha256(JSON.stringify([account, messageId, [...new Set(group.copies.map((c) => c.sha256))].sort()]));
}

const copyIds = (group: ComparedGroup, hashes: string[]): string[] => group.copies.filter((c) => hashes.includes(c.sha256)).map((c) => c.copy_id);

function priorVerdict(group: ComparedGroup, verdict: Verdict): unknown {
  return {
    keep: copyIds(group, verdict.mailbox.keep),
    remove: copyIds(group, verdict.mailbox.remove),
    roles: Object.fromEntries(group.copies.map((c) => [c.copy_id, verdict.roles[c.sha256]])),
    reason: verdict.reason,
    basis: verdict.basis,
  };
}

// --- shared steps --------------------------------------------------------------------------

export function connect<T>(context: MailContext, what: string, fn: (client: ImapClientLike) => Promise<T>): Promise<T> {
  return withImap(context.mail, context.imapFactory ?? defaultImapFactory, what, fn, context.mailTimeoutMs ?? CALL_TIMEOUT_MS);
}

/** True once this call has done some work and used its slice. */
export function sliceClock(context: MailContext): { tick: () => void; spent: () => boolean } {
  const started = Date.now();
  const sliceMs = context.mailSliceMs ?? SLICE_MS;
  let done = 0;
  return { tick: () => { done += 1; }, spent: () => done > 0 && Date.now() - started >= sliceMs };
}

const stale = (message: string): DataServerError => new DataServerError(message, "dedupe_stale");

async function requireTrashAndMove(client: ImapClientLike): Promise<string> {
  if (!client.capabilities.has("MOVE")) {
    throw new DataServerError(
      "duplicate removal moves copies only by the server's MOVE, which this mail server does not offer; nothing was changed",
      "mail_move_unsupported"
    );
  }
  const trash = await trashFolder(client);
  if (!trash) throw new DataServerError("no Trash folder was found, so nothing can be moved; nothing was changed", "mail_no_trash");
  return trash;
}

async function openReadOnly(client: ImapClientLike, folder: string): Promise<string> {
  const box = await client.mailboxOpen(folder, { readOnly: true });
  if (box.uidValidity === undefined) throw stale(`"${folder}" did not report its UIDVALIDITY, so its messages cannot be identified`);
  return String(box.uidValidity);
}

const cleanSubject = (subject: string | undefined): string | undefined => subject?.replace(/\s+/g, " ").trim().slice(0, SUBJECT_CAP);

// --- scan ----------------------------------------------------------------------------------

export async function dedupeScan(context: MailContext, args: Args): Promise<unknown> {
  const resume = args.scan_id as string | undefined;
  const folders = args.folders as string[] | undefined;
  if (resume !== undefined) {
    if (folders || args.all !== undefined || args.across_folders !== undefined) {
      throw new ValidationError("mail__dedupe_scan.scan_id resumes a scan, so it takes no other field");
    }
    const state = loadScan(resume);
    if (!state) throw replaced();
    if (state.phase === "done") return summary(context, state);
    return connect(context, "scanning for duplicate emails", (client) => runScan(client, context, state));
  }
  if (Boolean(folders) === (args.all === true)) throw new ValidationError("mail__dedupe_scan needs either folders or all: true");
  if (args.all === true && args.across_folders === true) {
    throw new ValidationError("mail__dedupe_scan.across_folders needs listed folders, because the first one listed is the one kept");
  }
  return connect(context, "scanning for duplicate emails", async (client) => {
    const trash = (await trashFolder(client)) ?? null;
    const list = await client.list();
    let targets: string[];
    if (folders) {
      targets = [];
      for (const name of folders) {
        const entry = findFolder(list, name);
        if (!entry) throw folderMissing(name);
        if (entry.flags?.has("\\Noselect")) throw new DataServerError(`"${name}" holds only folders, not messages`, "mail_not_selectable");
        if (entry.path === trash) throw new ValidationError(`"${name}" is the Trash folder, which is never deduplicated`);
        if (!targets.includes(entry.path)) targets.push(entry.path);
      }
    } else {
      targets = list.filter((f) => !f.flags?.has("\\Noselect") && f.path !== trash).map((f) => f.path);
    }
    const state: ScanState = {
      scan_id: randomUUID(),
      across: args.across_folders === true,
      trash,
      can_move: client.capabilities.has("MOVE") && trash !== null,
      own_folder: true,
      drafts: (await draftsFolder(client)) ?? null,
      phase: "hashing",
      scans: targets.map((folder) => ({ folder, uidValidity: "", uids: [], next: 0 })),
      entries: [],
      tallies: targets.map((folder) => ({ folder, messages: 0, without_message_id: 0, groups: 0, copies: 0 })),
      rows: [],
      tier1: { groups: 0, copies: 0, bytes: 0, plan_id: null },
      pending: [],
      nextGroup: 0,
      compared: [],
      unreadableGroups: 0,
      groupCount: 0,
    };
    saveScan(state);
    pruneOld(dedupeDir(), SCAN_ID);
    return runScan(client, context, state);
  });
}

const replaced = (): DataServerError =>
  new DataServerError("no finished scan on this computer has that id, so run a new scan", "dedupe_scan_replaced");

async function runScan(client: ImapClientLike, context: MailContext, state: ScanState): Promise<unknown> {
  const clock = sliceClock(context);
  if (state.phase === "hashing" && !(await hashFolders(client, state, clock))) return progress(state);
  if (state.phase === "comparing" && !(await compareGroups(client, state, clock))) return progress(state);
  return summary(context, state);
}

function progress(state: ScanState): unknown {
  saveScan(state);
  return {
    status: "scanning",
    scan_id: state.scan_id,
    phase: state.phase,
    messages_read: state.scans.reduce((sum, f) => sum + f.next, 0),
    messages_found: state.scans.reduce((sum, f) => sum + f.uids.length, 0),
    folders_left: state.scans.filter((f) => !f.uidValidity || f.next < f.uids.length).length,
    groups_compared: state.nextGroup,
    groups_to_compare: state.pending.length,
  };
}

/** Hashes one message at a time and keeps only its hash and metadata. False when the slice ran out. */
async function hashFolders(client: ImapClientLike, state: ScanState, clock: ReturnType<typeof sliceClock>): Promise<boolean> {
  for (const scan of state.scans) {
    if (scan.uidValidity && scan.next >= scan.uids.length) continue;
    if (clock.spent()) return false;
    const validity = await openReadOnly(client, scan.folder);
    if (!scan.uidValidity) {
      scan.uidValidity = validity;
      scan.uids = [...((await client.search({ all: true }, { uid: true })) || [])].sort((a, b) => a - b);
    } else if (scan.uidValidity !== validity) {
      throw stale(`"${scan.folder}" changed during the scan, so run a new scan`);
    }
    while (scan.next < scan.uids.length) {
      if (clock.spent()) return false;
      const uid = scan.uids[scan.next];
      const m = await client.fetchOne(String(uid), { uid: true, source: true, envelope: true, internalDate: true }, { uid: true });
      scan.next += 1;
      clock.tick();
      if (!m || !m.source) continue;
      const e = m.envelope ?? {};
      state.entries.push({
        folder: scan.folder,
        uid,
        sha256: sha256(m.source),
        size: m.source.length,
        messageId: e.messageId?.trim() || undefined,
        date: isoDate(e.date ?? m.internalDate),
        subject: cleanSubject(e.subject),
      });
    }
  }
  groupEntries(state);
  state.phase = "comparing";
  return true;
}

/** Tier 1 and the tier 2 groups, from the hashes. A message with no Message-ID stays out of both. */
function groupEntries(state: ScanState): void {
  const order = new Map(state.scans.map((s, i) => [s.folder, i]));
  const validity = new Map(state.scans.map((s) => [s.folder, s.uidValidity]));
  const tally = new Map(state.tallies.map((t) => [t.folder, t]));
  const scope = (e: Entry): string => (state.across ? "" : e.folder);
  const planCopy = (e: Entry): PlanCopy => ({ folder: e.folder, uid: e.uid, uidvalidity: validity.get(e.folder) as string, sha256: e.sha256 });
  // Keep the first folder listed, then the highest UID in it. Within one folder that is the highest UID.
  const keepFirst = (a: Entry, b: Entry): number => (order.get(a.folder) as number) - (order.get(b.folder) as number) || b.uid - a.uid;

  const identical = new Map<string, Entry[]>();
  for (const e of state.entries) {
    const count = tally.get(e.folder) as FolderTally;
    count.messages += 1;
    if (!e.messageId) {
      count.without_message_id += 1;
      continue;
    }
    const key = `${scope(e)}\0${e.sha256}`;
    identical.set(key, [...(identical.get(key) ?? []), e]);
  }

  const remove: PlanCopy[] = [];
  const keep: PlanCopy[] = [];
  const survivors: Entry[] = [];
  for (const copies of identical.values()) {
    const [kept, ...others] = copies.sort(keepFirst);
    survivors.push(kept);
    if (others.length === 0) continue;
    keep.push(planCopy(kept));
    state.tier1.groups += 1;
    (tally.get(kept.folder) as FolderTally).groups += 1;
    for (const e of others) {
      remove.push(planCopy(e));
      state.rows.push({ folder: e.folder, uid: e.uid, date: e.date, subject: e.subject, size: e.size });
      state.tier1.copies += 1;
      state.tier1.bytes += e.size;
      (tally.get(e.folder) as FolderTally).copies += 1;
    }
  }
  if (state.can_move !== false && remove.length > 0) {
    state.tier1.plan_id = writePlan({ tier: 1, scan_id: state.scan_id, trash: state.trash as string, remove, keep }, scanDir(state));
  }
  writeState(scanDir(state), "tier1-copies.txt", listText(state.rows));

  const sharing = new Map<string, Entry[]>();
  for (const e of survivors) {
    const key = `${scope(e)}\0${e.messageId}`;
    sharing.set(key, [...(sharing.get(key) ?? []), e]);
  }
  for (const copies of sharing.values()) {
    if (copies.length < 2) continue;
    copies.sort(keepFirst);
    state.pending.push({
      group_id: `g${state.pending.length + 1}`,
      message_id: copies[0].messageId as string,
      subject: copies[0].subject,
      copies,
    });
  }
  state.groupCount = state.pending.length;
  state.entries = [];
}

function listText(rows: TierOneRow[]): string {
  const clean = (value: string | number | undefined): string => String(value ?? "").replace(/[\t\r\n]+/g, " ");
  const lines = rows.map((r) => [r.folder, r.date, r.subject, r.size, r.uid].map(clean).join("\t"));
  return ["Folder\tDate\tSubject\tSize\tUID", ...lines, ""].join("\r\n");
}

// --- tier 2 comparison ---------------------------------------------------------------------

function normalizeBody(text: string): string {
  return text.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

export const normalizedBody = (parts: MimeParts): string => normalizeBody(renderBody(parts, TEXT_BODY).body);

const headerValue = (value: string): string => decodeWords(value).replace(/\s+/g, " ").trim();

export const isUnsent = (headers: Map<string, string>): boolean => headers.get("x-unsent")?.trim() === "1";

/** What marks a message as sent by a machine: the Auto-Submitted value, or the name of the header that does. Null when nothing does. */
export function autoSubmitted(headers: Map<string, string>): string | null {
  const value = headers.get("auto-submitted")?.trim();
  if (value && value.toLowerCase() !== "no") return value;
  for (const name of ["x-autoreply", "x-autorespond"]) if (headers.has(name)) return name;
  return headers.get("precedence")?.trim().toLowerCase() === "auto_reply" ? "auto_reply" : null;
}

type ReadCopy = { entry: Entry; parts: MimeParts; draftFlag: boolean };

/** Compares each pending group whole. False when the slice ran out. */
async function compareGroups(client: ImapClientLike, state: ScanState, clock: ReturnType<typeof sliceClock>): Promise<boolean> {
  while (state.nextGroup < state.pending.length) {
    if (clock.spent()) return false;
    const group = state.pending[state.nextGroup];
    const read: ReadCopy[] = [];
    let unreadable = false;
    let open: string | undefined;
    for (const entry of group.copies) {
      if (entry.folder !== open) {
        const scan = state.scans.find((s) => s.folder === entry.folder) as FolderScan;
        if ((await openReadOnly(client, entry.folder)) !== scan.uidValidity) {
          throw stale(`"${entry.folder}" changed during the scan, so run a new scan`);
        }
        open = entry.folder;
      }
      const m = await client.fetchOne(String(entry.uid), { uid: true, source: true, flags: true }, { uid: true });
      if (!m || !m.source) continue;
      try {
        read.push({ entry, parts: parseMime(m.source), draftFlag: Boolean(m.flags?.has("\\Draft")) });
      } catch {
        unreadable = true;
      }
    }
    state.nextGroup += 1;
    clock.tick();
    if (unreadable) {
      state.unreadableGroups += 1;
      state.unreadable_message_ids = [...(state.unreadable_message_ids ?? []), group.message_id];
    } else if (read.length > 1) state.compared.push(compareCopies(state, group, read));
  }
  writeState(scanDir(state), "comparison.json", JSON.stringify(state.compared));
  state.compared = [];
  state.pending = [];
  state.phase = "done";
  saveScan(state);
  return true;
}

function compareCopies(state: ScanState, group: ScanState["pending"][number], read: ReadCopy[]): ComparedGroup {
  const names = new Set(read.flatMap(({ parts }) => [...parts.headers.keys()]));
  const differing = [...names].filter((name) => {
    const values = new Set(read.map(({ parts }) => (parts.headers.has(name) ? headerValue(parts.headers.get(name) as string) : null)));
    return values.size > 1;
  });
  const copies = read.map(({ entry, parts, draftFlag }, i) => {
    const body = normalizedBody(parts);
    const html = parts.plain !== undefined && parts.html !== undefined ? normalizeBody(renderBody({ ...parts, plain: undefined }, TEXT_BODY).body) : undefined;
    const copy: ComparedCopy = {
      copy_id: `${group.group_id}-${i + 1}`,
      folder: entry.folder,
      uid: entry.uid,
      uidvalidity: (state.scans.find((s) => s.folder === entry.folder) as FolderScan).uidValidity,
      sha256: entry.sha256,
      date: entry.date,
      size: entry.size,
      differing_headers: Object.fromEntries(differing.map((name) => {
        const value = parts.headers.get(name);
        return [name, value === undefined ? null : headerValue(value).slice(0, HEADER_CAP)];
      })),
      body_sha256: sha256(body),
      ...(html === undefined ? {} : { html_sha256: sha256(html) }),
      attachments: parts.attachments.map((a) => ({ filename: a.name, size: a.size, sha256: a.sha256 })),
      other_parts: [
        ...(parts.rtf ? [{ type: "text/rtf", size: parts.rtf.length, sha256: sha256(parts.rtf) }] : []),
        ...parts.others,
      ],
      x_unsent: isUnsent(parts.headers),
      draft_flag: draftFlag,
      in_drafts_folder: entry.folder === state.drafts,
      auto_submitted: autoSubmitted(parts.headers),
    };
    return { copy, body };
  });
  // Every copy is compared with the longest body, the one most likely to hold all the others.
  const base = copies.reduce((best, c) => (c.body.length > best.body.length ? c : best));
  const body_diffs = copies
    .filter((c) => c !== base && c.copy.body_sha256 !== base.copy.body_sha256)
    .map((c) => ({ from: c.copy.copy_id, to: base.copy.copy_id, ...unifiedDiff(c.body.split("\n"), base.body.split("\n")) }));
  // The likely superset: the copy with the most lines no other copy holds, then the highest UID.
  const lines = copies.map((c) => new Set(c.body.split("\n")));
  const onlyHere = (i: number): number => [...lines[i]].filter((line) => !lines.some((other, j) => j !== i && other.has(line))).length;
  const ranked = copies.map((c, i) => ({ copy: c.copy, only: onlyHere(i) }));
  const suggested = ranked.reduce((best, r) => (r.only > best.only || (r.only === best.only && r.copy.uid > best.copy.uid) ? r : best));
  return { group_id: group.group_id, message_id: group.message_id, subject: group.subject, copies: copies.map((c) => c.copy), body_diffs, suggested_base: suggested.copy.copy_id };
}

/** A unified diff of two line lists, capped in length. Too long a stretch of change to diff comes back empty and truncated. */
function unifiedDiff(a: string[], b: string[]): { diff: string; truncated: boolean } {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const n = endA - start;
  const m = endB - start;
  if (n * m > DIFF_MAX_CELLS) return { diff: "", truncated: true };
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i * width + j] = a[start + i] === b[start + j]
        ? lcs[(i + 1) * width + j + 1] + 1
        : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }
  type Op = { mark: " " | "-" | "+"; line: string; aAt: number; bAt: number };
  const ops: Op[] = [];
  const contextFrom = Math.max(0, start - DIFF_CONTEXT);
  for (let k = contextFrom; k < start; k += 1) ops.push({ mark: " ", line: a[k], aAt: k, bAt: k });
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[start + i] === b[start + j]) {
      ops.push({ mark: " ", line: a[start + i], aAt: start + i, bAt: start + j });
      i += 1;
      j += 1;
    } else if (j < m && (i >= n || lcs[i * width + j + 1] >= lcs[(i + 1) * width + j])) {
      ops.push({ mark: "+", line: b[start + j], aAt: start + i, bAt: start + j });
      j += 1;
    } else {
      ops.push({ mark: "-", line: a[start + i], aAt: start + i, bAt: start + j });
      i += 1;
    }
  }
  for (let k = 0; k < DIFF_CONTEXT && endA + k < a.length; k += 1) ops.push({ mark: " ", line: a[endA + k], aAt: endA + k, bAt: endB + k });

  const out: string[] = [];
  const isChange = (op: Op): boolean => op.mark !== " ";
  for (let at = 0; at < ops.length; at += 1) {
    if (!isChange(ops[at])) continue;
    const first = Math.max(0, at - DIFF_CONTEXT);
    let last = at;
    for (let k = at; k < ops.length && k <= last + DIFF_CONTEXT * 2; k += 1) if (isChange(ops[k])) last = k;
    const hunk = ops.slice(first, Math.min(ops.length, last + DIFF_CONTEXT + 1));
    const aCount = hunk.filter((op) => op.mark !== "+").length;
    const bCount = hunk.filter((op) => op.mark !== "-").length;
    out.push(`@@ -${hunk[0].aAt + 1},${aCount} +${hunk[0].bAt + 1},${bCount} @@`, ...hunk.map((op) => `${op.mark}${op.line}`));
    at = Math.min(ops.length, last + DIFF_CONTEXT);
  }
  const diff = out.join("\n");
  return diff.length > DIFF_CAP ? { diff: diff.slice(0, DIFF_CAP), truncated: true } : { diff, truncated: false };
}

// --- replies -------------------------------------------------------------------------------

function summary(context: MailContext, state: ScanState): unknown {
  const ledger = loadLedger();
  const account = ledgerAccount(context);
  const groups = loadJson<ComparedGroup[]>(scanDir(state), "comparison.json") ?? [];
  return {
    status: "done",
    scan_id: state.scan_id,
    can_move: state.can_move !== false,
    trash_folder: state.trash,
    folders: state.tallies,
    tier1: {
      groups: state.tier1.groups,
      copies: state.tier1.copies,
      bytes: state.tier1.bytes,
      plan_id: state.tier1.plan_id,
      expected_count: state.tier1.copies,
      samples: state.rows.slice(0, SAMPLE_COUNT).map(({ folder, date, subject }) => ({ folder, date, subject })),
      list_path: join(scanDir(state), "tier1-copies.txt"),
    },
    tier2: {
      groups: state.groupCount - state.unreadableGroups,
      unreadable_groups: state.unreadableGroups,
      unreadable_message_ids: state.unreadable_message_ids ?? [],
      groups_without_verdict: groups.filter((g) => !ledger[verdictKey(account, g)]).length,
    },
  };
}

function finishedScan(scanId: unknown): ScanState {
  const state = loadScan(scanId);
  if (!state || state.phase !== "done") throw replaced();
  return state;
}

export function dedupeReadComparison(context: MailContext, args: Args): unknown {
  const state = finishedScan(args.scan_id);
  const view = (args.view as string | undefined) ?? "groups";
  const groups = loadJson<ComparedGroup[]>(scanDir(state), "comparison.json") ?? [];
  const ledger = loadLedger();
  const account = ledgerAccount(context);
  const verdictOf = (g: ComparedGroup): Verdict | undefined => ledger[verdictKey(account, g)];
  const items: unknown[] = view === "tier1_copies"
    ? state.rows
    : view === "group_list"
      ? groups.map((g) => ({
          group_id: g.group_id,
          subject: g.subject,
          date: g.copies[0]?.date,
          copies: g.copies.map(({ copy_id, folder, date, size }) => ({ copy_id, folder, date, size })),
        }))
      : view === "verdicts"
        ? groups.flatMap((g) => {
            const verdict = verdictOf(g);
            if (!verdict) return [];
            const kept = g.copies.filter((c) => verdict.mailbox.keep.includes(c.sha256));
            return [{
              group_id: g.group_id,
              remove: copyIds(g, verdict.mailbox.remove),
              reason: verdict.reason,
              has_unsent_draft_difference: kept.some((c) => verdict.roles[c.sha256] === "draft") && g.copies.some((c) => verdict.roles[c.sha256] !== "draft"),
            }];
          })
        : groups.map((g) => {
            const verdict = verdictOf(g);
            return {
              ...g,
              copies: g.copies.map(({ uidvalidity: _v, sha256: hash, ...c }) => ({ ...c, raw_sha256: hash })),
              ...(verdict ? { prior_verdict: priorVerdict(g, verdict) } : {}),
            };
          });
  const offset = (args.offset as number | undefined) ?? 0;
  const limit = (args.limit as number | undefined) ?? 20;
  const page: unknown[] = [];
  let chars = 0;
  for (const item of items.slice(offset, offset + limit)) {
    chars += JSON.stringify(item).length;
    if (page.length > 0 && chars > PAGE_MAX_CHARS) break;
    page.push(item);
  }
  const next = offset + page.length;
  return { view, total: items.length, items: page, next_offset: next < items.length ? next : null };
}

const badVerdict = (message: string): DataServerError => new DataServerError(message, "dedupe_bad_verdict");

const sameIds = (a: string[], b: string[]): boolean => {
  const [x, y] = [[...a].sort(), [...b].sort()];
  return x.length === y.length && x.every((id, i) => id === y[i]);
};

/** Keeps each group's verdict in the ledger. A refusal of any verdict records none of them. */
export function dedupeRecordVerdicts(context: MailContext, args: Args): unknown {
  const state = finishedScan(args.scan_id);
  requireCredential(context.mail);
  const account = ledgerAccount(context);
  const groups = new Map((loadJson<ComparedGroup[]>(scanDir(state), "comparison.json") ?? []).map((g) => [g.group_id, g]));
  const entries: [string, Verdict][] = [];
  const seen = new Set<string>();
  const verdicts = args.verdicts as { group_id: string; keep: string[]; remove: string[]; roles: Record<string, string>; reason: string; basis: string }[];
  for (const v of verdicts) {
    const group = groups.get(v.group_id);
    if (!group) throw new DataServerError(`group ${v.group_id} is not in the comparison`, "dedupe_not_in_comparison");
    if (seen.has(v.group_id)) throw new ValidationError(`mail__dedupe_record_verdicts.verdicts names group ${v.group_id} twice`);
    seen.add(v.group_id);
    if (v.keep.length === 0) throw new DataServerError(`the verdict would leave group ${v.group_id} with no copy`, "dedupe_no_copy_left");
    const ids = group.copies.map((c) => c.copy_id);
    if (!sameIds([...v.keep, ...v.remove], ids)) throw badVerdict(`the verdict on group ${v.group_id} must name each of its copies once, as kept or removed`);
    if (!sameIds(Object.keys(v.roles), ids)) throw badVerdict(`the verdict on group ${v.group_id} must give each of its copies a role`);
    const roles = Object.values(v.roles);
    if (roles.some((role) => !ROLES.includes(role))) throw badVerdict(`the verdict on group ${v.group_id} gives a role that does not exist`);
    if (!roles.every((role) => role === "draft") && roles.filter((role) => role === "record").length !== 1) {
      throw badVerdict(`the verdict on group ${v.group_id} must have exactly one record copy, unless every copy is a draft`);
    }
    if (!BASES.includes(v.basis)) throw badVerdict(`the verdict on group ${v.group_id} gives a basis that does not exist`);
    const reason = v.reason.trim();
    if (!reason || reason.length > REASON_MAX || /[\r\n]/.test(reason)) {
      throw badVerdict(`the verdict on group ${v.group_id} needs a reason of one line, at most ${REASON_MAX} characters`);
    }
    const hashOf = (id: string): string => (group.copies.find((c) => c.copy_id === id) as ComparedCopy).sha256;
    entries.push([verdictKey(account, group), {
      mailbox: { keep: v.keep.map(hashOf), remove: v.remove.map(hashOf) },
      roles: Object.fromEntries(Object.entries(v.roles).map(([id, role]) => [hashOf(id), role])),
      reason,
      basis: v.basis,
      recorded_at: new Date().toISOString(),
      rules_version: RULES_VERSION,
    }]);
  }
  saveLedger({ ...loadLedger(), ...Object.fromEntries(entries) });
  return { recorded: entries.length };
}

/** The copies each named group's verdict removes. A group whose verdict removes none adds nothing to the plan. */
function verdictRemovals(context: MailContext, groups: Map<string, ComparedGroup>, named: string[]): { group_id: string; remove: string[] }[] {
  const ledger = loadLedger();
  const account = ledgerAccount(context);
  return named.flatMap((group_id) => {
    const group = groups.get(group_id);
    if (!group) throw new DataServerError(`group ${group_id} is not in the comparison`, "dedupe_not_in_comparison");
    const verdict = ledger[verdictKey(account, group)];
    if (!verdict) throw new DataServerError(`group ${group_id} has no verdict`, "dedupe_no_verdict");
    const remove = copyIds(group, verdict.mailbox.remove);
    return remove.length ? [{ group_id, remove }] : [];
  });
}

export function dedupePlanTier2(context: MailContext, args: Args): unknown {
  const state = finishedScan(args.scan_id);
  if (state.can_move === false) {
    throw new DataServerError("this mail server offers no MOVE or has no Trash folder, so no plan can be made; nothing was changed", "mail_move_unsupported");
  }
  const fromVerdicts = args.from_verdicts === true;
  if (fromVerdicts !== (args.groups !== undefined) || fromVerdicts === (args.approved !== undefined)) {
    throw new ValidationError("mail__dedupe_plan_tier2 needs either approved, or from_verdicts: true with groups");
  }
  const groups = new Map((loadJson<ComparedGroup[]>(scanDir(state), "comparison.json") ?? []).map((g) => [g.group_id, g]));
  const notIn = (what: string): DataServerError => new DataServerError(`${what} is not in the comparison`, "dedupe_not_in_comparison");
  const remove: PlanCopy[] = [];
  const keep: PlanCopy[] = [];
  const samples: unknown[] = [];
  const seen = new Set<string>();
  const planCopy = ({ folder, uid, uidvalidity, sha256: hash }: ComparedCopy): PlanCopy => ({ folder, uid, uidvalidity, sha256: hash });
  const approved = fromVerdicts ? verdictRemovals(context, groups, args.groups as string[]) : (args.approved as { group_id: string; remove: string[] }[]);
  for (const { group_id, remove: wanted } of approved) {
    const group = groups.get(group_id);
    if (!group) throw notIn(`group ${group_id}`);
    if (seen.has(group_id)) throw new ValidationError(`mail__dedupe_plan_tier2.approved names group ${group_id} twice`);
    seen.add(group_id);
    const ids = new Set(wanted);
    for (const id of ids) if (!group.copies.some((c) => c.copy_id === id)) throw notIn(`copy ${id} of group ${group_id}`);
    const kept = group.copies.filter((c) => !ids.has(c.copy_id));
    if (kept.length === 0) throw new DataServerError(`the plan would leave group ${group_id} with no copy`, "dedupe_no_copy_left");
    keep.push(...kept.map(planCopy));
    for (const copy of group.copies.filter((c) => ids.has(c.copy_id))) {
      remove.push(planCopy(copy));
      if (samples.length < SAMPLE_COUNT) samples.push({ folder: copy.folder, date: copy.date, subject: group.subject });
    }
  }
  if (remove.length === 0) throw new DataServerError("the verdicts on those groups remove no copy, so there is nothing to plan", "dedupe_nothing_to_move");
  const plan_id = writePlan({ tier: 2, scan_id: state.scan_id, trash: state.trash as string, remove, keep }, scanDir(state));
  return { plan_id, expected_count: remove.length, groups: seen.size, samples };
}

// --- apply ---------------------------------------------------------------------------------

const moveReport = (state: ApplyState): Record<string, unknown> => {
  const byFolder = (rows: { folder: string; uid: number }[]): { folder: string; uids: number[] }[] => {
    const folders = new Map<string, number[]>();
    for (const { folder, uid } of rows) folders.set(folder, [...(folders.get(folder) ?? []), uid]);
    return [...folders].map(([folder, uids]) => ({ folder, uids }));
  };
  return { moved: byFolder(state.moved), already_gone: byFolder(state.gone), not_moved: state.queue.length };
};

function reply(state: ApplyState, trash: string): unknown {
  const counts = new Map<string, number>();
  for (const { folder } of state.moved) counts.set(folder, (counts.get(folder) ?? 0) + 1);
  return {
    status: state.phase,
    plan_id: state.plan_id,
    moved: state.moved.length,
    remaining: state.queue.length,
    already_gone: state.gone.length,
    trash_folder: trash,
    moved_by_folder: [...counts].map(([folder, count]) => ({ folder, count })),
  };
}

export function dedupeApply(context: MailContext, args: Args): Promise<unknown> {
  const planId = args.plan_id as string;
  const plan = readPlan(planId);
  if (!plan) throw new DataServerError("no saved plan has that id, or it was altered, so run a new scan", "dedupe_plan_not_found");
  if (args.expected_count !== plan.remove.length) {
    throw new DataServerError(`the plan moves ${plan.remove.length} copies, not ${String(args.expected_count)}; nothing was changed`, "dedupe_count_mismatch");
  }
  if (plan.remove.some((c) => c.folder === plan.trash)) throw stale("the plan names a copy in the Trash folder; nothing was changed");
  const last = loadJson<ApplyState>(dedupeDir(), "apply.json");
  if (last?.plan_id === planId) throw new DataServerError(`that plan was already started and is ${last.phase}`, "dedupe_plan_used");
  // Only a plan of the same scan holds this one back, so a move an ended session left unfinished
  // cannot block a new scan's plan, as it could not when a new scan blanked the old plans.
  if (last && (last.phase === "verifying" || last.phase === "moving") && readPlan(last.plan_id)?.scan_id === plan.scan_id) {
    throw new DataServerError("another plan is still moving; finish it first", "dedupe_plan_used");
  }
  const byFolderThenUid = (x: PlanCopy, y: PlanCopy): number => (x.folder < y.folder ? -1 : x.folder > y.folder ? 1 : x.uid - y.uid);
  const state: ApplyState = {
    plan_id: planId,
    phase: "verifying",
    checks: [...plan.remove, ...plan.keep].sort(byFolderThenUid),
    checked: 0,
    queue: [...plan.remove].sort(byFolderThenUid),
    moved: [],
    gone: [],
  };
  saveApply(state);
  return advance(context, plan, state);
}

export function dedupeApplyContinue(context: MailContext, args: Args): Promise<unknown> {
  const planId = args.plan_id as string;
  const state = loadJson<ApplyState>(dedupeDir(), "apply.json");
  if (state?.plan_id !== planId) throw new DataServerError("that plan was never started", "dedupe_not_started");
  if (state.phase === "stopped") {
    throw new DataServerError(`that plan stopped: ${state.error ?? "an earlier error"}`, "dedupe_stopped", moveReport(state));
  }
  const plan = readPlan(planId);
  if (!plan) throw new DataServerError("no saved plan has that id, or it was altered", "dedupe_plan_not_found", moveReport(state));
  if (state.phase === "done") return Promise.resolve(reply(state, plan.trash));
  return advance(context, plan, state);
}

/** One slice of a started plan. Any failure stops the plan and reports exactly what moved. */
function advance(context: MailContext, plan: Plan, state: ApplyState): Promise<unknown> {
  return connect(context, "moving duplicate emails to Trash", async (client) => {
    try {
      const trash = await requireTrashAndMove(client);
      if (trash !== plan.trash) throw stale(`the Trash folder is now "${trash}", not "${plan.trash}", so run a new scan`);
      const clock = sliceClock(context);
      if (state.phase === "verifying" && (await verifyCopies(client, state, clock))) state.phase = "moving";
      if (state.phase === "moving" && (await moveCopies(client, state, trash, clock))) state.phase = "done";
      saveApply(state);
      return reply(state, trash);
    } catch (error) {
      state.phase = "stopped";
      state.error = (error instanceof Error ? error.message : String(error)).split("\n")[0];
      saveApply(state);
      if (error instanceof DataServerError) throw new DataServerError(error.message, error.code, moveReport(state));
      throw new DataServerError(`mail: the move stopped: ${state.error}`, "mail_error", moveReport(state));
    }
  });
}

/** Every copy the plan moves or keeps must still be the message that was approved. False when the slice ran out. */
async function verifyCopies(client: ImapClientLike, state: ApplyState, clock: ReturnType<typeof sliceClock>): Promise<boolean> {
  let open: string | undefined;
  while (state.checked < state.checks.length) {
    if (clock.spent()) return false;
    const copy = state.checks[state.checked];
    if (copy.folder !== open) {
      if ((await openReadOnly(client, copy.folder)) !== copy.uidvalidity) {
        throw stale(`"${copy.folder}" changed since the scan, so its messages can no longer be identified; nothing was moved. Run a new scan`);
      }
      open = copy.folder;
    }
    const m = await client.fetchOne(String(copy.uid), { uid: true, source: true }, { uid: true });
    if (!m || !m.source || sha256(m.source) !== copy.sha256) {
      throw stale(`a message in "${copy.folder}" is gone or changed since the scan; nothing was moved. Run a new scan`);
    }
    state.checked += 1;
    clock.tick();
  }
  state.checks = [];
  return true;
}

/** Moves the queue a batch at a time, recording each batch before the next. False when the slice ran out. */
async function moveCopies(client: ImapClientLike, state: ApplyState, trash: string, clock: ReturnType<typeof sliceClock>): Promise<boolean> {
  let open: string | undefined;
  while (state.queue.length > 0) {
    if (clock.spent()) return false;
    const { folder, uidvalidity } = state.queue[0];
    if (folder !== open) {
      const box = await client.mailboxOpen(folder, { readOnly: false });
      if (String(box.uidValidity) !== uidvalidity) throw stale(`"${folder}" changed while copies were moving, so the move stopped`);
      open = folder;
    }
    const end = state.queue.findIndex((c, i) => i >= MOVE_BATCH || c.folder !== folder);
    const batch = state.queue.slice(0, end < 0 ? state.queue.length : end).map((c) => c.uid);
    try {
      await moveBatch(client, state, folder, batch, trash);
    } finally {
      saveApply(state);
    }
    clock.tick();
  }
  return true;
}

// Moves only by the server's MOVE. imapflow, on a server without MOVE, copies and then permanently
// removes the originals, so the check comes right before the call. What actually left the folder
// is read back from the server, including after a failed call.
async function moveBatch(client: ImapClientLike, state: ApplyState, folder: string, uids: number[], trash: string): Promise<void> {
  const range = uids.join(",");
  const present = new Set((await client.search({ uid: range }, { uid: true })) || []);
  const existing = uids.filter((u) => present.has(u));
  for (const uid of uids) if (!present.has(uid)) state.gone.push({ folder, uid });
  const settle = (stillThere: number[], newUids?: Map<number, number>): void => {
    const left = new Set(stillThere);
    for (const uid of existing) {
      if (!left.has(uid)) {
        const new_uid = newUids?.get(uid);
        state.moved.push({ folder, uid, ...(new_uid === undefined ? {} : { new_uid }) });
      }
    }
    state.queue = state.queue.filter((c) => !(c.folder === folder && uids.includes(c.uid) && !left.has(c.uid)));
  };
  if (existing.length === 0) {
    settle([]);
    return;
  }
  if (!client.capabilities.has("MOVE")) {
    settle(existing);
    throw new DataServerError("this mail server no longer offers MOVE, so the move stopped", "mail_move_unsupported");
  }
  let result: Awaited<ReturnType<ImapClientLike["messageMove"]>>;
  try {
    result = await client.messageMove(existing.join(","), trash, { uid: true });
  } catch (error) {
    const after = await client.search({ uid: existing.join(",") }, { uid: true }).catch(() => undefined);
    if (after) {
      settle([...after]);
      throw error;
    }
    settle(existing);
    throw new DataServerError(`the connection failed during a move, so up to ${existing.length} more copies from "${folder}" may be in Trash`, "mail_error");
  }
  const left = [...((await client.search({ uid: existing.join(",") }, { uid: true })) || [])];
  settle(left, result ? result.uidMap : undefined);
  if (!result || left.length > 0) throw new DataServerError(`the server did not move every message out of "${folder}"`, "mail_error");
}
