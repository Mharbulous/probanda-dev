// The mail__* tools of the lawyer plugin's data server (docs/Plans/2026-10-15_imap-mail.md,
// step 4): IMAP reads, save_message and download_attachment, which write a read
// message or part to a local folder, save_draft, which only appends to a folder, three
// organizing writes: create_folder, rename_folder and move_messages, and the dedupe_* tools
// (dedupe.ts), whose apply tools move only the copies of an approved plan to Trash. No tool
// sends, permanently deletes a message or a folder, flags or marks read. Every read opens its
// folder read-only. Tool definitions live in schema-gen.ts.

import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, win32 as pathWin32 } from "node:path";

import { DataServerError, ValidationError } from "../errors.js";
import { parseMime } from "../correspondence/eml.js";
import { pdfPages } from "../files/extract/pdf.js";
import {
  attachmentList,
  formatAddress,
  formatAddresses,
  isoDate,
  renderBody,
  summarize,
  type AttachmentEntry,
  type BodyFormat,
  type BodyOptions,
  type MessageSummary,
  type RenderedBody,
} from "./body.js";
import { persistMailCredential, type MailCredential, type MailState } from "./config.js";
import { dedupeApply, dedupeApplyContinue, dedupePlanTier2, dedupeReadComparison, dedupeScan } from "./dedupe.js";
import {
  DEFAULT_TIMEOUT_MS,
  defaultImapFactory,
  draftsFolder,
  findFolder,
  folderMissing,
  runImap,
  sentFolder,
  withImap,
  type FolderEntry,
  type ImapClientFactory,
  type ImapClientLike,
} from "./imap.js";
import { servePasswordPage, type CredentialFields, type DavResult, type SaveOutcome } from "./page.js";
import { probeDav, type DavContext } from "../dav/session.js";
import { isValidTimeZone } from "../dav/tz.js";
import type { Tool } from "../tool-list.js";

/** The part of the dispatch context the mail tools read. */
export interface MailContext extends DavContext {
  mail: MailState;
  // Tests inject a fake client and a short timeout; the server uses neither.
  imapFactory?: ImapClientFactory;
  mailTimeoutMs?: number;
  mailSliceMs?: number;
}

type Args = Record<string, unknown>;

// A body read downloads whole messages, attachments included, so a list with
// bodies is capped at the newest 25, as the extension did.
const BODY_CAP = 25;
const DRAFT_MAX_BYTES = 25 * 1024 * 1024;
const FETCH_FIELDS = { uid: true, envelope: true, flags: true, size: true, internalDate: true };
const PRINTABLE = /^[^\x00-\x1F\x7F]+$/;

export const mailTools: Tool<MailContext>[] = [
  { name: "mail__configure_credential", handler: (args, context) => configureCredential(context, args) },
  { name: "mail__configure_status", handler: (_args, context) => configureStatus(context.mail) },
  { name: "mail__list_folders", handler: (args, context) => listFolders(runFor(context), args) },
  { name: "mail__folder_status", handler: (args, context) => folderStatus(runFor(context), args) },
  { name: "mail__get_latest_emails", handler: (args, context) => getLatestEmails(runFor(context), args) },
  { name: "mail__search_emails", handler: (args, context) => searchEmails(runFor(context), args) },
  { name: "mail__get_email", handler: (args, context) => getEmail(runFor(context), args) },
  { name: "mail__download_attachment", handler: (args, context) => downloadAttachment(runFor(context), args) },
  { name: "mail__save_message", handler: (args, context) => saveMessage(runFor(context), args) },
  { name: "mail__find_email_by_message_id", handler: (args, context) => findByMessageId(runFor(context), args) },
  { name: "mail__find_thread_messages", handler: (args, context) => findThreadMessages(runFor(context), args) },
  { name: "mail__save_draft", handler: (args, context) => saveDraft(runFor(context), args) },
  { name: "mail__create_folder", handler: (args, context) => createFolder(runFor(context), args) },
  { name: "mail__rename_folder", handler: (args, context) => renameFolder(runFor(context), args) },
  { name: "mail__move_messages", handler: (args, context) => moveMessages(runFor(context), args) },
  { name: "mail__dedupe_scan", handler: (args, context) => dedupeScan(context, args) },
  { name: "mail__dedupe_read_comparison", handler: (args) => dedupeReadComparison(args) },
  { name: "mail__dedupe_plan_tier2", handler: (args) => dedupePlanTier2(args) },
  { name: "mail__dedupe_apply", handler: (args, context) => dedupeApply(context, args) },
  { name: "mail__dedupe_apply_continue", handler: (args, context) => dedupeApplyContinue(context, args) },
];

function runFor(context: MailContext): Run {
  return (what, fn) => withImap(context.mail, context.imapFactory ?? defaultImapFactory, what, fn, context.mailTimeoutMs);
}

type Run = <T>(what: string, fn: (client: ImapClientLike) => Promise<T>) => Promise<T>;

// --- argument helpers ---------------------------------------------------------------

function intArg(label: string, value: unknown, fallback: number | undefined, min: number, max = Infinity): number {
  if (value === undefined) {
    if (fallback === undefined) throw new ValidationError(`${label} is required`);
    return fallback;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(
      max === Infinity ? `${label} must be an integer of at least ${min}` : `${label} must be an integer from ${min} to ${max}`
    );
  }
  return value;
}

const folderArg = (args: Args): string => (args.folder as string | undefined) ?? "INBOX";

/** The five body options, or undefined when the call asks for no body. */
function listBodyOptions(tool: string, args: Args): BodyOptions | undefined {
  if (args.include_body !== true) return undefined;
  return {
    format: (args.body_format as BodyFormat | undefined) ?? "text",
    maxLength: intArg(`${tool}.body_max_length`, args.body_max_length, 10000, 1),
    stripQuoted: args.strip_quoted === true,
    stripInlineImages: args.strip_inline_images === true,
  };
}

function ymd(label: string, value: unknown): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  const date = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : undefined;
  if (!m || !date || date.getUTCMonth() !== +m[2] - 1 || date.getUTCDate() !== +m[3]) {
    throw new ValidationError(`${label} must be a date like 2026-09-01`);
  }
  return date;
}

const notFound = (uid: number, folder: string): DataServerError =>
  new DataServerError(`no email with UID ${uid} in folder "${folder}"; UIDs change when mail is moved, so search again`, "mail_not_found");

const stripBrackets = (id: string): string => id.trim().replace(/^<|>$/g, "");

// --- shared reads -------------------------------------------------------------------

const byDateDesc = (a: MessageSummary, b: MessageSummary): number =>
  (b.date ?? "").localeCompare(a.date ?? "") || b.uid - a.uid;

type ListedMessage = MessageSummary & Partial<RenderedBody>;

async function fetchSummaries(client: ImapClientLike, folder: string, uids: number[], body?: BodyOptions): Promise<ListedMessage[]> {
  if (uids.length === 0) return [];
  const wanted = body ? [...uids].sort((a, b) => a - b).slice(-BODY_CAP) : uids;
  const out: ListedMessage[] = [];
  for await (const m of client.fetch(wanted, { ...FETCH_FIELDS, source: Boolean(body) }, { uid: true })) {
    const summary: ListedMessage = summarize(m, folder);
    if (body) Object.assign(summary, renderBody(parseMime(m.source ?? Buffer.alloc(0)), body));
    out.push(summary);
  }
  return out;
}

// --- configuration ------------------------------------------------------------------

// The password is never a tool argument, so it never passes through the chat:
// this validates every other field and returns the link to a local page where
// the practitioner types it (page.ts). The page saves through saveCredential.
// The schema has no password field, so dispatch refuses one as an unknown field.
async function configureCredential(context: MailContext, args: Args): Promise<unknown> {
  const host = String(args.host ?? "").trim();
  const username = String(args.username ?? "").trim();
  const port = intArg("mail__configure_credential.port", args.port, 993, 1, 65535);
  const fromAddress = String(args.from_address ?? "").trim();
  for (const [label, value] of [["host", host], ["username", username]]) {
    if (!value) throw new ValidationError(`mail__configure_credential requires ${label}`);
    if (!PRINTABLE.test(value)) throw new ValidationError(`mail__configure_credential.${label} must hold printable characters only`);
  }
  const fields: CredentialFields = { host, port, secure: args.secure !== false, username, ...(fromAddress ? { fromAddress } : {}) };
  // A calendar or contacts field the call leaves out keeps its saved value; an empty string clears it.
  const saved = context.mail.credential;
  const davArg = (label: string, key: "davUsername" | "caldavUrl" | "carddavUrl" | "timezone"): string =>
    args[label] === undefined || args[label] === null ? (saved?.[key] ?? "") : String(args[label]).trim();
  const davUsername = davArg("dav_username", "davUsername");
  if (davUsername) {
    if (!PRINTABLE.test(davUsername)) throw new ValidationError("mail__configure_credential.dav_username must hold printable characters only");
    fields.davUsername = davUsername;
  }
  for (const [label, key] of [["caldav_url", "caldavUrl"], ["carddav_url", "carddavUrl"]] as const) {
    const value = davArg(label, key);
    if (!value) continue;
    let parsed: URL | undefined;
    try {
      parsed = new URL(value);
    } catch {
      parsed = undefined;
    }
    if (!parsed || parsed.protocol !== "https:") {
      throw new ValidationError(`mail__configure_credential.${label} must be an https URL, such as https://caldav.icloud.com`);
    }
    fields[key] = value;
  }
  const timezone = davArg("timezone", "timezone");
  if (timezone) {
    if (!isValidTimeZone(timezone)) {
      throw new ValidationError(`mail__configure_credential.timezone "${timezone}" is not an IANA time zone, such as America/Vancouver`);
    }
    fields.timezone = timezone;
  }
  if (fields.caldavUrl && !fields.timezone) {
    throw new ValidationError("mail__configure_credential.caldav_url needs timezone, an IANA time zone such as America/Vancouver");
  }
  const url = await servePasswordPage(fields, (secret) => saveCredential(context, { ...fields, password: secret }));
  return {
    status: "awaiting_password",
    url,
    host,
    username,
    next:
      "Send the practitioner this link and ask them to type the password on that page, never in chat. " +
      "When they say it is done, call mail__configure_status. The link works only on this computer, until a new link is made or the server restarts.",
  };
}

// Probe, then set live, then persist. A credential whose mail sign-in fails is not
// saved and leaves the previous one in place. A calendar or contacts sign-in that
// fails is reported per service, and that service's URL is left out of what is
// saved, so it reads as not configured rather than as working. Nothing returned
// or thrown here holds the password.
async function saveCredential(context: MailContext, typed: MailCredential): Promise<SaveOutcome> {
  if (!typed.password) throw new ValidationError("enter the password");
  if (!PRINTABLE.test(typed.password)) throw new ValidationError("the password must hold printable characters only");

  const inbox: Record<string, unknown> = await runImap(
    typed,
    context.imapFactory ?? defaultImapFactory,
    "signing in",
    (client) => client.status("INBOX", { messages: true, unseen: true }),
    context.mailTimeoutMs ?? DEFAULT_TIMEOUT_MS
  );

  const credential: MailCredential = { ...typed };
  const dav: SaveOutcome["dav"] = {};
  const failures: NonNullable<MailState["davSignIn"]> = {};
  for (const [service, kind, key] of [["calendar", "caldav", "caldavUrl"], ["contacts", "carddav", "carddavUrl"]] as const) {
    if (!typed[key]) continue;
    const failure = await probeDav(context, typed, kind);
    const result: DavResult = failure ? { ok: false, detail: failure } : { ok: true };
    dav[service] = result;
    if (failure) {
      failures[service] = failure;
      delete credential[key];
    }
  }
  context.mail.credential = credential;
  delete context.mail.credentialError;
  if (Object.keys(failures).length) context.mail.davSignIn = failures;
  else delete context.mail.davSignIn;

  const counts = { messages: inbox.messages, unseen: inbox.unseen };
  try {
    await persistMailCredential(credential);
  } catch (error) {
    const detail = (error instanceof Error ? error.message : String(error)).split("\n")[0].trim();
    return {
      persisted: false,
      inbox: counts,
      dav,
      warning:
        "the credential works and is active for this session, but could not be saved to disk, so it " +
        `must be entered again after a restart: ${detail}`,
    };
  }
  return { persisted: true, inbox: counts, dav };
}

async function configureStatus(state: MailState): Promise<unknown> {
  const c = state.credential;
  return {
    configured: c !== null,
    host: c?.host ?? null,
    port: c?.port ?? null,
    username: c?.username ?? null,
    from_address: c?.fromAddress ?? null,
    password_set: Boolean(c?.password),
    dav_username: c?.davUsername ?? null,
    caldav_url: c?.caldavUrl ?? null,
    carddav_url: c?.carddavUrl ?? null,
    timezone: c?.timezone ?? null,
    calendar_configured: Boolean(c?.caldavUrl && c?.timezone),
    contacts_configured: Boolean(c?.carddavUrl),
    ...(state.davSignIn ? { dav_sign_in: state.davSignIn } : {}),
    ...(state.credentialError ? { credential_error: state.credentialError } : {}),
  };
}

// --- folders ------------------------------------------------------------------------

function listFolders(run: Run, args: Args): Promise<unknown> {
  const prefix = (args.prefix as string | undefined)?.toLowerCase();
  return run("listing folders", async (client) => {
    const all: FolderEntry[] = await client.list();
    const folders = all
      .filter((f) => !prefix || f.path.toLowerCase().startsWith(prefix))
      .map((f) => ({ name: f.path, specialUse: f.specialUse, selectable: !f.flags?.has("\\Noselect") }));
    return { folders, total: all.length, returned: folders.length };
  });
}

function folderStatus(run: Run, args: Args): Promise<unknown> {
  const folder = folderArg(args);
  return run(`reading the status of "${folder}"`, async (client) => {
    const s = await client.status(folder, { messages: true, unseen: true, recent: true, uidNext: true, uidValidity: true });
    return {
      folder,
      total: s.messages,
      unread: s.unseen,
      recent: s.recent,
      uidNext: s.uidNext,
      uidValidity: s.uidValidity === undefined ? undefined : String(s.uidValidity),
    };
  });
}

// --- message lists ------------------------------------------------------------------

function getLatestEmails(run: Run, args: Args): Promise<unknown> {
  const folder = folderArg(args);
  const count = intArg("mail__get_latest_emails.count", args.count, 10, 1, 200);
  const body = listBodyOptions("mail__get_latest_emails", args);
  return run(`reading the latest messages in "${folder}"`, async (client) => {
    const box = await client.mailboxOpen(folder, { readOnly: true });
    if (box.exists === 0) return { folder, messages: [] };
    const uids: number[] = [];
    for await (const m of client.fetch(`${Math.max(1, box.exists - count + 1)}:*`, { uid: true })) uids.push(m.uid);
    const messages = await fetchSummaries(client, folder, uids, body);
    return { folder, messages: messages.sort(byDateDesc) };
  });
}

function searchEmails(run: Run, args: Args): Promise<unknown> {
  const folder = folderArg(args);
  const limit = intArg("mail__search_emails.limit", args.limit, 50, 1, 500);
  const body = listBodyOptions("mail__search_emails", args);
  const criteria: Record<string, unknown> = {};
  for (const key of ["from", "to", "subject", "body"]) if (args[key]) criteria[key] = args[key];
  for (const key of ["since", "before"]) if (args[key]) criteria[key] = ymd(`mail__search_emails.${key}`, args[key]);
  if (args.seen !== undefined) criteria.seen = args.seen;
  if (args.flagged !== undefined) criteria.flagged = args.flagged;
  if (Object.keys(criteria).length === 0) criteria.all = true;
  return run(`searching "${folder}"`, async (client) => {
    await client.mailboxOpen(folder, { readOnly: true });
    const uids = (await client.search(criteria, { uid: true })) || [];
    const newest = [...uids].sort((a, b) => a - b).slice(-limit);
    const messages = (await fetchSummaries(client, folder, newest, body)).sort(byDateDesc).slice(0, limit);
    return { totalFound: uids.length, returned: messages.length, messages };
  });
}

// --- one message --------------------------------------------------------------------

function getEmail(run: Run, args: Args): Promise<unknown> {
  const folder = folderArg(args);
  const uid = intArg("mail__get_email.uid", args.uid, undefined, 1);
  const options: BodyOptions = {
    format: (args.body_format as BodyFormat | undefined) ?? "text",
    maxLength: intArg("mail__get_email.max_length", args.max_length, 20000, 1),
    stripQuoted: args.strip_quoted === true,
    stripInlineImages: args.strip_inline_images === true,
  };
  return run(`reading message ${uid} in "${folder}"`, async (client) => {
    await client.mailboxOpen(folder, { readOnly: true });
    const m = await client.fetchOne(
      String(uid),
      { uid: true, source: true, flags: true, envelope: true, bodyStructure: true, internalDate: true },
      { uid: true }
    );
    if (!m) throw notFound(uid, folder);
    const parts = parseMime(m.source ?? Buffer.alloc(0));
    const e = m.envelope ?? {};
    return {
      uid,
      folder,
      messageId: e.messageId,
      inReplyTo: e.inReplyTo,
      date: isoDate(e.date ?? m.internalDate),
      from: formatAddress(e.from?.[0]),
      to: formatAddresses(e.to),
      cc: formatAddresses(e.cc),
      replyTo: formatAddress(e.replyTo?.[0]),
      subject: e.subject,
      flags: [...(m.flags ?? [])],
      ...renderBody(parts, options),
      attachments: attachmentList(m.bodyStructure),
      ...(args.include_headers === true ? { headers: Object.fromEntries(parts.headers) } : {}),
    };
  });
}

// --- attachments --------------------------------------------------------------------

function pickAttachment(list: AttachmentEntry[], filename: string | undefined, index: number | undefined): AttachmentEntry {
  const norm = (s: string | undefined): string => (s ?? "").normalize("NFC").toLowerCase();
  const hit =
    index !== undefined
      ? list[index]
      : list.find((a) => a.filename === filename) ??
        list.find((a) => norm(a.filename) === norm(filename)) ??
        list.find((a) => a.contentId !== undefined && stripBrackets(a.contentId) === stripBrackets(filename ?? ""));
  if (hit) return hit;
  const have = list.map((a) => `[${a.index}] ${a.filename ?? "(no name)"}`).join(", ") || "no attachments";
  throw new DataServerError(`attachment not found; this email has: ${have}`, "mail_not_found");
}

// A file name that is safe on Windows: no folder part and no reserved character.
function safeName(name: string | undefined, fallback: string): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[<>:"|?*\x00-\x1F]/g, "_").replace(/[. ]+$/, "").trim();
  return clean || fallback;
}

// Writes `bytes` under `dir` without overwriting: "name (1).ext" and so on. The
// exclusive create claims the name, so a race cannot overwrite either.
function writeFree(dir: string, name: string, bytes: Buffer): string {
  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let i = 0; ; i += 1) {
    const candidate = join(dir, i === 0 ? name : `${stem} (${i})${ext}`);
    try {
      writeFileSync(candidate, bytes, { flag: "wx" });
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}

// The absolute path of an existing folder, or a refusal naming the tool.
function saveDirArg(tool: string, args: Args): string {
  const saveDir = args.save_dir as string;
  let isDir = false;
  try {
    isDir = pathWin32.isAbsolute(saveDir) && statSync(saveDir).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) throw new ValidationError(`${tool}.save_dir must be the absolute path of an existing folder`);
  return saveDir;
}

async function downloadAttachment(run: Run, args: Args): Promise<unknown> {
  const folder = folderArg(args);
  const uid = intArg("mail__download_attachment.uid", args.uid, undefined, 1);
  const index = args.index === undefined ? undefined : intArg("mail__download_attachment.index", args.index, undefined, 0);
  const filename = args.filename as string | undefined;
  if (index === undefined && !filename) throw new ValidationError("mail__download_attachment needs filename or index");
  const saveDir = saveDirArg("mail__download_attachment", args);

  const { entry, bytes } = await run(`downloading an attachment of message ${uid} in "${folder}"`, async (client) => {
    await client.mailboxOpen(folder, { readOnly: true });
    const m = await client.fetchOne(String(uid), { uid: true, bodyStructure: true }, { uid: true });
    if (!m) throw notFound(uid, folder);
    const entry = pickAttachment(attachmentList(m.bodyStructure), filename, index);
    const { content } = await client.download(String(uid), entry.part, { uid: true });
    const chunks: Buffer[] = [];
    for await (const chunk of content) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return { entry, bytes: Buffer.concat(chunks) };
  });

  const name = safeName(entry.filename, `attachment-${entry.index}`);
  const path = writeFree(saveDir, name, bytes);
  const result: Record<string, unknown> = {
    saved: true,
    path,
    filename: name,
    contentType: entry.contentType,
    size: bytes.length,
  };
  const isPdf = entry.contentType === "application/pdf" || name.toLowerCase().endsWith(".pdf");
  if (isPdf && args.extract_text !== false) {
    try {
      const pages = await pdfPages(path);
      result.pages = pages.length;
      result.text = pages.join("\n\f\n");
    } catch (error) {
      result.textError = `could not extract text: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  return result;
}

// Saves the message exactly as the server stores it, so its hash matches any other
// byte-for-byte copy and no inline image or header is lost to a rebuild.
async function saveMessage(run: Run, args: Args): Promise<unknown> {
  const folder = folderArg(args);
  const uid = intArg("mail__save_message.uid", args.uid, undefined, 1);
  const saveDir = saveDirArg("mail__save_message", args);

  const { source, messageId, subject } = await run(`saving message ${uid} in "${folder}"`, async (client) => {
    await client.mailboxOpen(folder, { readOnly: true });
    const m = await client.fetchOne(String(uid), { uid: true, source: true, envelope: true }, { uid: true });
    if (!m || !m.source) throw notFound(uid, folder);
    return { source: m.source, messageId: m.envelope?.messageId, subject: m.envelope?.subject };
  });

  const stem = safeName(subject?.replace(/[\\/]/g, "_").slice(0, 120), `message-${uid}`);
  const path = writeFree(saveDir, `${stem}.eml`, source);
  return {
    saved: true,
    path,
    filename: basename(path),
    size: source.length,
    sha256: createHash("sha256").update(source).digest("hex"),
    messageId,
  };
}

// --- finding messages ---------------------------------------------------------------

function findByMessageId(run: Run, args: Args): Promise<unknown> {
  const id = stripBrackets(String(args.message_id));
  return run("finding a message by its Message-ID", async (client) => {
    const found: MessageSummary[] = [];
    for (const f of await client.list()) {
      if (f.flags?.has("\\Noselect")) continue;
      await client.mailboxOpen(f.path, { readOnly: true });
      const uids = (await client.search({ header: { "message-id": id } }, { uid: true })) || [];
      found.push(...(await fetchSummaries(client, f.path, uids)));
    }
    return { found };
  });
}

function findThreadMessages(run: Run, args: Args): Promise<unknown> {
  const folder = folderArg(args);
  const uid = intArg("mail__find_thread_messages.uid", args.uid, undefined, 1);
  const body = listBodyOptions("mail__find_thread_messages", args);
  const named = args.search_folders as unknown[] | undefined;
  if (named !== undefined && (!Array.isArray(named) || named.length === 0 || named.some((f) => typeof f !== "string" || !f))) {
    throw new ValidationError("mail__find_thread_messages.search_folders must be a non-empty list of folder names");
  }
  return run(`tracing the thread of message ${uid} in "${folder}"`, async (client) => {
    await client.mailboxOpen(folder, { readOnly: true });
    const m = await client.fetchOne(String(uid), { uid: true, envelope: true, headers: ["references"] }, { uid: true });
    if (!m) throw notFound(uid, folder);
    const references = m.headers?.toString("latin1").match(/<[^<>\s]+>/g) ?? [];
    const ids = [
      ...new Set([...references, m.envelope?.inReplyTo, m.envelope?.messageId].filter((v): v is string => Boolean(v)).map(stripBrackets)),
    ].slice(-50);
    if (ids.length === 0) throw new DataServerError("this email has no Message-ID, so its thread cannot be traced", "mail_no_thread");

    let folders = named as string[] | undefined;
    if (!folders) {
      const list = await client.list();
      const archive = list.find((f) => f.specialUse === "\\Archive" || f.path === "Archive")?.path;
      folders = [...new Set(["INBOX", await sentFolder(client), archive, folder].filter((f): f is string => Boolean(f)))];
    }
    const or = ids.flatMap((id) => [{ header: { "message-id": id } }, { header: { references: id } }, { header: { "in-reply-to": id } }]);
    const messages: MessageSummary[] = [];
    for (const f of folders) {
      await client.mailboxOpen(f, { readOnly: true });
      const uids = (await client.search(or.length === 1 ? or[0] : { or }, { uid: true })) || [];
      messages.push(...(await fetchSummaries(client, f, uids, body)));
    }
    const unique = [...new Map(messages.map((x) => [`${x.folder}:${x.uid}`, x])).values()];
    return { threadIds: ids.length, count: unique.length, messages: unique.sort((a, b) => -byDateDesc(a, b)) };
  });
}

// --- the one write ------------------------------------------------------------------

// Appends an unsent .eml, as the write_email route produces it, to the Drafts
// folder. Reads only the named file and changes nothing else in the mailbox.
async function saveDraft(run: Run, args: Args): Promise<unknown> {
  const emlPath = args.eml_path as string;
  if (!pathWin32.isAbsolute(emlPath)) throw new ValidationError("mail__save_draft.eml_path must be an absolute path");
  let size: number;
  try {
    const stat = statSync(emlPath);
    if (!stat.isFile()) throw new Error("not a file");
    size = stat.size;
  } catch {
    throw new ValidationError("mail__save_draft.eml_path is not a readable file");
  }
  if (size > DRAFT_MAX_BYTES) {
    throw new DataServerError("mail__save_draft: the message is larger than 25 MB, so it was not saved", "too_large");
  }
  const bytes = readFileSync(emlPath);
  const parts = parseMime(bytes);
  const target = args.folder as string | undefined;
  return run("saving a draft", async (client) => {
    const folder = target ?? (await draftsFolder(client));
    if (!folder) throw new DataServerError("no Drafts folder was found; pass folder with the drafts folder's name", "mail_no_drafts");
    const appended = await client.append(folder, bytes, ["\\Draft", "\\Seen"]);
    if (!appended) throw new DataServerError(`the server did not accept the draft into "${folder}"`, "mail_error");
    return { saved: true, folder: appended.destination || folder, uid: appended.uid, messageId: parts.headers.get("message-id") };
  });
}

// --- organizing (writes) ------------------------------------------------------------

const MOVE_MAX = 500;

const folderExists = (path: string): DataServerError =>
  new DataServerError(`a folder named "${path}" already exists`, "mail_folder_exists");

function folderName(label: string, value: unknown): string {
  const name = String(value ?? "").trim();
  if (!name || !PRINTABLE.test(name)) throw new ValidationError(`${label} must be a folder name of printable characters`);
  return name;
}

function createFolder(run: Run, args: Args): Promise<unknown> {
  const name = folderName("mail__create_folder.name", args.name);
  const parent = args.parent as string | undefined;
  return run(`creating the folder "${name}"`, async (client) => {
    const list = await client.list();
    const under = parent === undefined ? undefined : findFolder(list, parent);
    if (parent !== undefined && !under) throw folderMissing(parent);
    const delimiter = under?.delimiter ?? list.find((f) => f.delimiter)?.delimiter;
    if (delimiter && name.includes(delimiter)) {
      throw new ValidationError(`mail__create_folder.name may not hold "${delimiter}"; pass parent to create a subfolder`);
    }
    const path = under ? `${under.path}${delimiter ?? "/"}${name}` : name;
    if (findFolder(list, path)) throw folderExists(path);
    const created = await client.mailboxCreate(path);
    return { created: true, path: created.path || path };
  });
}

// The inbox and the special-use folders (Sent, Drafts, Trash, Junk, Archive) are
// never renamed: mail clients and the other mail tools find them by those roles.
function renameFolder(run: Run, args: Args): Promise<unknown> {
  const folder = folderName("mail__rename_folder.folder", args.folder);
  const newName = folderName("mail__rename_folder.new_name", args.new_name);
  return run(`renaming the folder "${folder}"`, async (client) => {
    const list = await client.list();
    const entry = findFolder(list, folder);
    if (!entry) throw folderMissing(folder);
    if (entry.path.toUpperCase() === "INBOX" || entry.specialUse) {
      throw new DataServerError(
        `"${entry.path}" is the inbox or a special-use folder (${entry.specialUse ?? "\\Inbox"}), so it is never renamed`,
        "mail_protected_folder"
      );
    }
    if (findFolder(list, newName)) throw folderExists(newName);
    const renamed = await client.mailboxRename(entry.path, newName);
    return { renamed: true, from: entry.path, to: renamed.newPath || newName };
  });
}

// Moves only the named UIDs, and only by the server's MOVE. imapflow's
// messageMove, on a server without MOVE, copies and then permanently removes the
// originals, so a server without MOVE is refused before anything changes.
function moveMessages(run: Run, args: Args): Promise<unknown> {
  const folder = folderName("mail__move_messages.folder", args.folder);
  const destination = folderName("mail__move_messages.destination", args.destination);
  const uids = args.uids;
  if (!Array.isArray(uids) || uids.length === 0 || uids.length > MOVE_MAX || uids.some((u) => !Number.isInteger(u) || u < 1)) {
    throw new ValidationError(`mail__move_messages.uids must be a list of 1 to ${MOVE_MAX} message UIDs from a list or search of folder`);
  }
  const wanted = [...new Set(uids as number[])].sort((a, b) => a - b);
  return run(`moving messages from "${folder}" to "${destination}"`, async (client) => {
    const list = await client.list();
    const ends = [findFolder(list, folder), findFolder(list, destination)];
    for (const [i, path] of [folder, destination].entries()) {
      if (!ends[i]) throw folderMissing(path);
      if (ends[i]?.flags?.has("\\Noselect")) {
        throw new DataServerError(`"${path}" holds only folders, not messages`, "mail_not_selectable");
      }
    }
    const [source, target] = [ends[0]!.path, ends[1]!.path];
    if (source === target) throw new ValidationError("mail__move_messages.destination must differ from folder");
    if (!client.capabilities.has("MOVE")) {
      throw new DataServerError(
        "this mail server does not offer MOVE, so messages cannot be moved without deleting the originals; " +
          "nothing was changed. Move them in the practitioner's mail program instead.",
        "mail_move_unsupported"
      );
    }
    await client.mailboxOpen(source, { readOnly: false });
    const present = new Set((await client.search({ uid: wanted.join(",") }, { uid: true })) || []);
    const existing = wanted.filter((u) => present.has(u));
    const notFound = wanted.filter((u) => !present.has(u));
    if (existing.length === 0) {
      throw new DataServerError(`none of these UIDs is in "${source}"; UIDs change when mail is moved, so search again`, "mail_not_found");
    }
    const range = existing.join(",");
    const result = await client.messageMove(range, target, { uid: true });
    if (!result) throw new DataServerError(`the server refused to move the messages to "${target}"`, "mail_error");
    const left = new Set((await client.search({ uid: range }, { uid: true })) || []);
    const map = result.uidMap;
    return {
      folder: source,
      destination: target,
      moved: existing.filter((u) => !left.has(u)).map((u) => (map?.has(u) ? { uid: u, newUid: map.get(u) } : { uid: u })),
      notFound,
      notMoved: existing.filter((u) => left.has(u)),
    };
  });
}
