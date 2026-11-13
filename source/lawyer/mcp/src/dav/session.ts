// CalDAV and CardDAV access for the calendar__* and contacts__* tools, signed in
// with the mail credential's password (src/mail/config.ts). The calendar is
// read-only. So is the address book, except through permittedRequest, which
// changes one contact card under a permit only src/contacts/card-write.ts
// holds (decided by the practitioner on 2026-11-12). tsdav handles discovery
// and collection queries and can only read; the one raw read is a GET of a
// single object. Ported from the practitioner's own mail, calendar and
// contacts desktop extension (MIT), without its write paths.
//
// The password goes only to the configured CalDAV or CardDAV host, or over HTTPS
// to a host this process reached with a successful signed-in request while
// signing in to that service (iCloud moves an account to a pNN-caldav.icloud.com
// host during discovery). Sign-in follows only the configured server's own
// answers, never a URL the model supplies. Every request, tsdav's included,
// passes the same check, never follows a redirect unless discovery asks for it
// to be handed back, and, permittedRequest aside, may only read (GET, PROPFIND,
// REPORT, OPTIONS).

import { createDAVClient } from "tsdav";

import { DataServerError, ValidationError } from "../errors.js";
import type { MailCredential, MailState } from "../mail/config.js";
import { isValidTimeZone } from "./tz.js";

export type DavKind = "caldav" | "carddav";

export interface DavCollection {
  url: string;
  displayName?: unknown;
  components?: string[];
  calendarColor?: string;
}

export interface DavObject {
  url: string;
  etag?: string;
  data?: string;
}

// The part of tsdav's client the read tools use. Nothing here can write.
export interface DavClientLike {
  fetchCalendars(): Promise<DavCollection[]>;
  fetchCalendarObjects(params: {
    calendar: DavCollection;
    timeRange: { start: string; end: string };
    urlFilter?: (url: string) => boolean;
  }): Promise<DavObject[]>;
  fetchAddressBooks(): Promise<DavCollection[]>;
  fetchVCards(params: { addressBook: DavCollection }): Promise<DavObject[]>;
}

export interface DavLogin {
  kind: DavKind;
  serverUrl: string;
  username: string;
  secret: string;
  fetch: typeof fetch;
}

/** Signs in (discovery included) and returns a client; throws when the server refuses. */
export type DavClientFactory = (login: DavLogin) => Promise<DavClientLike>;

export const defaultDavClientFactory: DavClientFactory = async (login) =>
  (await createDAVClient({
    serverUrl: login.serverUrl,
    credentials: { username: login.username, password: login.secret },
    authMethod: "Basic",
    defaultAccountType: login.kind,
    fetch: login.fetch,
  })) as unknown as DavClientLike;

/** The part of the dispatch context the calendar and contacts tools read. */
export interface DavContext {
  mail: MailState;
  // Tests inject a fake client, a fake fetch and a short timeout; the server uses none of them.
  davClientFactory?: DavClientFactory;
  davFetch?: typeof fetch;
  davTimeoutMs?: number;
}

export const DEFAULT_DAV_TIMEOUT_MS = 30_000;

const LABEL: Record<DavKind, string> = { caldav: "calendar", carddav: "contacts" };

export const CALENDAR_NOT_CONFIGURED =
  "calendar not configured: run mail__configure_credential with the calendar fields (caldav_url and timezone, plus " +
  "dav_username when the calendar sign-in name differs from the mail username) and have the practitioner enter the " +
  "mail password again on the page it links to";
export const CONTACTS_NOT_CONFIGURED =
  "contacts not configured: run mail__configure_credential with the contacts fields (carddav_url, plus dav_username " +
  "when the contacts sign-in name differs from the mail username) and have the practitioner enter the mail password " +
  "again on the page it links to";

function serverUrlOf(credential: MailCredential, kind: DavKind): string | undefined {
  return kind === "caldav" ? credential.caldavUrl : credential.carddavUrl;
}

/** The credential, when it holds this kind's fields; refuses `dav_not_configured` otherwise. */
export function requireDav(state: MailState, kind: DavKind): MailCredential {
  const c = state.credential;
  const ready = c && serverUrlOf(c, kind) && (kind === "carddav" || (c.timezone && isValidTimeZone(c.timezone)));
  if (c && ready) return c;
  const hint = kind === "caldav" ? CALENDAR_NOT_CONFIGURED : CONTACTS_NOT_CONFIGURED;
  const reason = state.credentialError ? ` (the stored mail credential could not be read: ${state.credentialError})` : "";
  throw new DataServerError(hint + reason, "dav_not_configured");
}

/** Sign-in names to try, in order: the DAV username first, then the mail username. */
export function davUsernames(credential: MailCredential): string[] {
  return [...new Set([credential.davUsername, credential.username].filter((u): u is string => Boolean(u)))];
}

/**
 * What a session's requests may reach. While signing in, tsdav follows the configured
 * server's own answers to any HTTPS host, and each host that answers a signed-in request
 * with success is recorded in `reached`. After sign-in, only the configured host and the
 * reached hosts are allowed.
 */
interface Trust {
  reached: Set<string>;
  signingIn: boolean;
}

const READ_METHODS = new Set(["GET", "PROPFIND", "REPORT", "OPTIONS"]);

/** Refuses a URL that is not on this kind's configured host or a host reached during its sign-in. */
function assertTrustedUrl(credential: MailCredential, kind: DavKind, url: string, trust: Trust): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ValidationError(`"${url}" is not a valid URL.`);
  }
  const configured = new URL(serverUrlOf(credential, kind) as string);
  const sameAsConfigured = u.protocol === configured.protocol && u.host === configured.host;
  const https = u.protocol === "https:";
  if (!sameAsConfigured && !(https && (trust.signingIn || trust.reached.has(u.host)))) {
    throw new ValidationError(
      `Refusing to use "${url}": it is not on the configured ${LABEL[kind]} server (${configured.host}) or a server ` +
        `it moved this account to while signing in. ` +
        `Use a url returned by the ${kind === "caldav" ? "calendar__list_events" : "contacts__search"} tool.`
    );
  }
  return u;
}

const scrub = (text: string, credential: MailCredential): string =>
  credential.password ? text.split(credential.password).join("[redacted]") : text;

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const isTimeout = (error: unknown): boolean => {
  const name = (error as { name?: unknown })?.name;
  return name === "TimeoutError" || name === "AbortError";
};

const isAuthFailure = (error: unknown): boolean => /\b401\b|unauthori[sz]ed|invalid credentials/i.test(errorText(error));

/**
 * The fetch every DAV request goes through: read methods only, the URL check, no redirect
 * followed unless the caller asks for it ("manual", as discovery does, hands the 3xx back),
 * and a per-request timeout. While signing in, it records each host that answers a signed-in
 * request with success.
 */
function guardedFetch(context: DavContext, credential: MailCredential, kind: DavKind, trust: Trust): typeof fetch {
  const base = context.davFetch ?? fetch;
  const timeoutMs = context.davTimeoutMs ?? DEFAULT_DAV_TIMEOUT_MS;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (!READ_METHODS.has(method)) {
      throw new ValidationError(`Refusing a ${method} request: the ${LABEL[kind]} tools only read.`);
    }
    const target = assertTrustedUrl(credential, kind, url, trust);
    const signingIn = trust.signingIn;
    const res = await base(input, { ...init, redirect: init?.redirect ?? "error", signal: init?.signal ?? AbortSignal.timeout(timeoutMs) });
    if (signingIn && res.ok && new Headers(init?.headers).has("authorization")) trust.reached.add(target.host);
    return res;
  }) as typeof fetch;
}

interface Session {
  client: DavClientLike;
  username: string;
  trust: Trust;
}

// One signed-in client per credential and kind. A new credential is a new object, so a
// save starts fresh; a failed sign-in is dropped so the next call retries.
const sessions = new WeakMap<MailCredential, Map<DavKind, Promise<Session>>>();

async function signIn(context: DavContext, credential: MailCredential, kind: DavKind): Promise<Session> {
  const factory = context.davClientFactory ?? defaultDavClientFactory;
  const serverUrl = serverUrlOf(credential, kind) as string;
  const failures: Array<{ username: string; error: unknown }> = [];
  const trust: Trust = { reached: new Set(), signingIn: true };
  const guarded = guardedFetch(context, credential, kind, trust);
  try {
    for (const username of davUsernames(credential)) {
      try {
        const client = await factory({ kind, serverUrl, username, secret: credential.password, fetch: guarded });
        // Load the collections once while signing in, so the host they live on (iCloud's
        // pNN host, named by discovery) is reached now and trusted afterwards.
        await (kind === "caldav" ? client.fetchCalendars() : client.fetchAddressBooks());
        return { client, username, trust };
      } catch (error) {
        if (error instanceof ValidationError) throw error;
        if (isTimeout(error)) throw timeoutError(context, kind, "signing in");
        failures.push({ username, error });
      }
    }
  } finally {
    trust.signingIn = false;
  }
  const detail = failures.map((f) => `${f.username}: ${scrub(errorText(f.error), credential)}`).join("; ");
  const auth = failures.every((f) => isAuthFailure(f.error));
  throw new DataServerError(
    `${LABEL[kind]}: ${new URL(serverUrl).host} refused the sign-in for every username tried (${detail}). ` +
      (auth
        ? "Check dav_username and the app-specific password, then run mail__configure_credential again."
        : "Check caldav_url or carddav_url, then run mail__configure_credential again."),
    auth ? "dav_auth" : "dav_error"
  );
}

export function session(context: DavContext, credential: MailCredential, kind: DavKind): Promise<Session> {
  let byKind = sessions.get(credential);
  if (!byKind) sessions.set(credential, (byKind = new Map()));
  let pending = byKind.get(kind);
  if (!pending) {
    pending = signIn(context, credential, kind);
    const cache = byKind;
    pending.catch(() => cache.delete(kind));
    byKind.set(kind, pending);
  }
  return pending;
}

/** Signs in once for the sign-in page; returns why it failed, or undefined when it worked. */
export async function probeDav(context: DavContext, credential: MailCredential, kind: DavKind): Promise<string | undefined> {
  try {
    await session(context, credential, kind);
    return undefined;
  } catch (error) {
    return scrub(errorText(error), credential);
  }
}

function timeoutError(context: DavContext, kind: DavKind, what: string): DataServerError {
  const seconds = (context.davTimeoutMs ?? DEFAULT_DAV_TIMEOUT_MS) / 1000;
  return new DataServerError(
    `${LABEL[kind]}: the server did not answer within ${seconds} s (${what}). Retry once; if it fails again, report the ${LABEL[kind]} server as unreachable.`,
    "dav_timeout"
  );
}

/** Runs one tool's DAV work, turning any failure into a DataServerError with the password removed. */
export async function runDav<T>(
  context: DavContext,
  credential: MailCredential,
  kind: DavKind,
  what: string,
  fn: (client: DavClientLike) => Promise<T>
): Promise<T> {
  try {
    const { client } = await session(context, credential, kind);
    return await fn(client);
  } catch (error) {
    if (error instanceof DataServerError) throw error;
    if (isTimeout(error)) throw timeoutError(context, kind, what);
    const text = scrub(errorText(error), credential);
    if (isAuthFailure(error)) {
      throw new DataServerError(`${LABEL[kind]}: the server refused the sign-in while ${what} (${text}).`, "dav_auth");
    }
    throw new DataServerError(`${LABEL[kind]}: ${what} failed: ${text}`, "dav_error");
  }
}

/** GET one object by its URL, after the URL check; returns its text and etag. */
export function getObject(
  context: DavContext,
  credential: MailCredential,
  kind: DavKind,
  url: string
): Promise<{ text: string; etag: string | null }> {
  return runDav(context, credential, kind, "reading " + url, async () => {
    const { username, trust } = await session(context, credential, kind);
    assertTrustedUrl(credential, kind, url, trust);
    const authorization = "Basic " + Buffer.from(username + ":" + credential.password).toString("base64");
    const res = await guardedFetch(context, credential, kind, trust)(url, {
      method: "GET",
      headers: { Authorization: authorization },
      redirect: "error", // never let the credential follow a redirect
    });
    if (res.status === 404) {
      throw new DataServerError(`Nothing found at ${url}. It may have been deleted; list again to get a current URL.`, "dav_error");
    }
    if (res.status === 401) throw new DataServerError(`${LABEL[kind]}: the server refused the sign-in reading ${url} (HTTP 401).`, "dav_auth");
    if (!res.ok) throw new DataServerError(`Could not read ${url}: HTTP ${res.status} ${res.statusText}`, "dav_error");
    return { text: await res.text(), etag: res.headers.get("etag") };
  });
}

/** What one changing request may be: a card directly under one address book, under the caller's rule. */
export interface CardPermit {
  collectionUrl: string;
  /** Throws unless this method, with these headers, is one the caller may send. */
  check(method: string, headers: Headers): void;
}

/**
 * The one way a request that changes anything is sent: to a contact card directly under the
 * permit's address book, and never to a calendar. The guarded fetch, which tsdav uses, still
 * only reads, so no permit ever reaches tsdav. Returns the status for the caller to judge.
 */
export function permittedRequest(
  context: DavContext,
  credential: MailCredential,
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
  permit: CardPermit
): Promise<{ status: number; etag: string | null }> {
  const kind: DavKind = "carddav";
  return runDav(context, credential, kind, "changing " + url, async () => {
    const { username, trust } = await session(context, credential, kind);
    const book = assertTrustedUrl(credential, kind, permit.collectionUrl, trust);
    const target = assertTrustedUrl(credential, kind, url, trust);
    const name = book.pathname.endsWith("/") && target.href.startsWith(book.href) ? target.href.slice(book.href.length) : "";
    if (!/^[^/?#]+\.vcf$/.test(name)) {
      throw new ValidationError(`Refusing to change "${url}": it is not a contact card in the address book.`);
    }
    const headers = new Headers(init.headers);
    permit.check(init.method.toUpperCase(), headers);
    headers.set("Authorization", "Basic " + Buffer.from(username + ":" + credential.password).toString("base64"));
    const res = await (context.davFetch ?? fetch)(url, {
      method: init.method.toUpperCase(),
      headers,
      body: init.body,
      redirect: "error", // never let the credential follow a redirect
      signal: AbortSignal.timeout(context.davTimeoutMs ?? DEFAULT_DAV_TIMEOUT_MS),
    });
    if (res.status === 401) throw new DataServerError(`${LABEL[kind]}: the server refused the sign-in changing ${url} (HTTP 401).`, "dav_auth");
    return { status: res.status, etag: res.headers.get("etag") };
  });
}

/** Absolute URL for an href returned by the server. */
export const absolute = (href: string, base: string): string => new URL(href, base).href;
