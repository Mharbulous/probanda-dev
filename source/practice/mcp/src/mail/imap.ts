// One IMAP connection per tool call, raced against a timeout
// (docs/Plans/2026-10-15_imap-mail.md, step 2). Nothing persists between
// calls, so a stalled connection cannot outlive the call that opened it.

import type { Readable } from "node:stream";

import { ImapFlow } from "imapflow";

import { DataServerError } from "../errors.js";
import type { StructureNode, FetchedSummary } from "./body.js";
import type { MailCredential, MailState } from "./config.js";

export const DEFAULT_TIMEOUT_MS = 30_000;

export interface FolderEntry {
  path: string;
  specialUse?: string;
  flags?: Set<string>;
}

export interface FetchedMessage extends FetchedSummary {
  source?: Buffer;
  bodyStructure?: StructureNode;
  headers?: Buffer;
}

// The part of imapflow's ImapFlow the mail tools use. A read opens its folder
// read-only, so the server never sets \Seen as a side effect; the type allows no
// other open.
export interface ImapClientLike {
  connect(): Promise<void>;
  logout(): Promise<void>;
  close(): void;
  list(): Promise<FolderEntry[]>;
  status(path: string, query: Record<string, boolean>): Promise<Record<string, unknown>>;
  mailboxOpen(path: string, options: { readOnly: true }): Promise<{ exists: number }>;
  fetch(range: string | number[], query: Record<string, unknown>, options?: { uid?: boolean }): AsyncIterable<FetchedMessage>;
  fetchOne(seq: string, query: Record<string, unknown>, options?: { uid?: boolean }): Promise<FetchedMessage | false | undefined>;
  search(query: Record<string, unknown>, options?: { uid?: boolean }): Promise<number[] | false | undefined>;
  download(range: string, part?: string, options?: { uid?: boolean }): Promise<{ content: Readable | AsyncIterable<Buffer> }>;
  append(path: string, content: Buffer, flags?: string[]): Promise<{ destination: string; uid?: number } | false>;
}

export type ImapClientFactory = (credential: MailCredential) => ImapClientLike;

export const defaultImapFactory: ImapClientFactory = (credential) => {
  const client = new ImapFlow({
    host: credential.host,
    port: credential.port,
    secure: credential.secure,
    auth: { user: credential.username, pass: credential.password },
    logger: false,
    socketTimeout: 30_000,
    greetingTimeout: 15_000,
    connectionTimeout: 15_000,
  });
  // Failures surface through the awaited calls; an unhandled 'error' event would crash the server.
  client.on("error", () => {});
  return client as unknown as ImapClientLike;
};

export const NOT_CONFIGURED_HINT =
  "mail is not configured: call mail__configure_credential once with the IMAP host, port, username and password";

export function requireCredential(state: MailState): MailCredential {
  if (state.credential) return state.credential;
  throw new DataServerError(
    state.credentialError
      ? `${NOT_CONFIGURED_HINT} (the stored credential could not be read: ${state.credentialError})`
      : NOT_CONFIGURED_HINT,
    "mail_not_configured"
  );
}

const describeTimeout = (ms: number): string => (ms >= 1000 ? `${ms / 1000} s` : `${ms} ms`);

// Text from the server's reply, with the password removed should a server ever echo it.
function serverText(error: unknown, credential: MailCredential): string {
  const e = error as { responseText?: unknown; message?: unknown };
  const text = String(e?.responseText || e?.message || error);
  return credential.password ? text.split(credential.password).join("[redacted]") : text;
}

function isAuthFailure(error: unknown): boolean {
  const e = error as { authenticationFailed?: unknown; message?: unknown; responseText?: unknown };
  return e?.authenticationFailed === true || /auth|credential|login/i.test(`${e?.message ?? ""} ${e?.responseText ?? ""}`);
}

/** Runs `fn` on a fresh connection signed in with `credential`, within `timeoutMs`. */
export async function runImap<T>(
  credential: MailCredential,
  factory: ImapClientFactory,
  what: string,
  fn: (client: ImapClientLike) => Promise<T>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const client = factory(credential);
  const work = (async () => {
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.logout().catch(() => client.close());
    }
  })();
  let timer: NodeJS.Timeout | undefined;
  const timedOut = Symbol("timeout");
  const timeout = new Promise<typeof timedOut>((resolve) => {
    timer = setTimeout(() => resolve(timedOut), timeoutMs);
  });
  try {
    const outcome = await Promise.race([work, timeout]);
    if (outcome === timedOut) {
      // The abandoned call may still reject once its socket closes; that rejection is expected.
      work.catch(() => {});
      client.close();
      throw new DataServerError(
        `mail: the IMAP server did not answer within ${describeTimeout(timeoutMs)} (${what}); the connection was closed. ` +
          "Retry once; if it fails again, report the mail server as unreachable.",
        "mail_timeout"
      );
    }
    return outcome as T;
  } catch (error) {
    if (error instanceof DataServerError) throw error;
    if (isAuthFailure(error)) {
      throw new DataServerError(
        `mail: ${credential.host} refused the sign-in for "${credential.username}" (${serverText(error, credential)}). ` +
          "Check the username and the app-specific password, then call mail__configure_credential again.",
        "mail_auth"
      );
    }
    throw new DataServerError(`mail: ${what} failed on ${credential.host}: ${serverText(error, credential)}`, "mail_error");
  } finally {
    clearTimeout(timer);
  }
}

/** runImap with the configured credential; refuses `mail_not_configured` when there is none. */
export function withImap<T>(
  state: MailState,
  factory: ImapClientFactory,
  what: string,
  fn: (client: ImapClientLike) => Promise<T>,
  timeoutMs?: number
): Promise<T> {
  return runImap(requireCredential(state), factory, what, fn, timeoutMs);
}

export async function specialFolder(client: ImapClientLike, use: string, names: string[]): Promise<string | undefined> {
  const list = await client.list();
  const hit = list.find((f) => f.specialUse === use) ?? list.find((f) => names.some((n) => n.toLowerCase() === f.path.toLowerCase()));
  return hit?.path;
}

export const sentFolder = (client: ImapClientLike) => specialFolder(client, "\\Sent", ["Sent Messages", "Sent", "Sent Items"]);
export const draftsFolder = (client: ImapClientLike) => specialFolder(client, "\\Drafts", ["Drafts"]);
