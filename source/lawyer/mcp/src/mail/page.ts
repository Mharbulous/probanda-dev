// The mail sign-in page (docs/Plans/2026-10-15_imap-mail.md, amendment of 2026-10-15): where the
// practitioner types the mail password, so it is never a tool argument and never passes through
// the chat or the model. mail__configure_credential calls servePasswordPage with every other field
// and hands the session the link; the page posts the password straight to this process, which
// signs in and saves through the caller's `save`.
//
// node:http on 127.0.0.1, port 0, started lazily by the first serve and unref'd, so it lives only
// as long as this data server process (the shape of src/housekeeping/server.ts). Each serve mints a
// random token carried in the URL and drops the previous one, so only the newest link works. A
// successful save spends the token; a refused sign-in keeps it, so the practitioner can retry on
// the page. The password is never logged, echoed into a page or put in an error.

import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { escape, listen, page as sharedPage, readBody } from "../key-request/page.js";
import type { MailCredential } from "./config.js";

export type CredentialFields = Omit<MailCredential, "password">;

export interface DavResult {
  ok: boolean;
  detail?: string;
}

export interface SaveOutcome {
  inbox: { messages: unknown; unseen: unknown };
  persisted: boolean;
  // One entry per calendar or contacts server the fields named; a failed one was not saved.
  dav?: { calendar?: DavResult; contacts?: DavResult };
  warning?: string;
}

/** Signs in with the typed secret and saves the credential; throws with a message safe to show. */
export type SaveSecret = (secret: string) => Promise<SaveOutcome>;

interface Pending {
  token: string;
  fields: CredentialFields;
  save: SaveSecret;
}

const TITLE = "Probanda mail connector";
// Plain strings, not template literals: the src/mail/ scan refuses a template literal naming it.
const SECRET_INPUT = '<input type="password" name="secret" autocomplete="current-password" required autofocus>';
const SECRET_HINT = "Your mail password. For iCloud and most hosted mail, use an app-specific password, never the account password.";

const SENT_TO = "Your password will be sent to: ";

// A hint only: the page never blocks or rewrites the username.
const APPLE_ID_HINT =
  "iCloud Mail signs in with your Apple ID (an @icloud.com, @me.com or @mac.com address), even when you send from " +
  "your own domain. If the username above is not your Apple ID, return to Claude and set it up again with the Apple ID.";

/** True when the host is iCloud Mail and the username is not an Apple ID address. */
export function needsAppleIdHint(fields: Pick<CredentialFields, "host" | "username">): boolean {
  if (fields.host.trim().toLowerCase() !== "imap.mail.me.com") return false;
  const domain = fields.username.trim().toLowerCase().split("@")[1] ?? "";
  return !["icloud.com", "me.com", "mac.com"].includes(domain);
}

// What the save does (saveCredential in tools.ts). Each line must stay true to that code.
const FLOW =
  "<h2>What happens when you click Sign in and save</h2><ol>" +
  "<li>Probanda signs in to your mail server with the password to check that it works, then to any calendar and contacts " +
  // The "never sent to Claude" note holds only for text typed on this 127.0.0.1 page, served by this
  // local server. A credential pasted into chat reaches the inference provider (docs/Specs/2026-10-16_mail-pasted-password-fallback-spec.md).
  "servers listed above, and to any server they move the account to while signing in. The password is not sent to Claude or Anthropic.</li>" +
  "<li>If the mail sign-in fails, nothing is saved and any earlier password stays in place. You can correct it and try again here. " +
  "If only the calendar or contacts sign-in fails, mail is still saved, and calendar or contacts are marked as not set up.</li>" +
  "<li>If the sign-in works, the password is saved encrypted on this computer only. It is never logged and never shown again. " +
  "If it cannot be saved, this page tells you.</li>" +
  "<li>Probanda uses it to read your mail, calendar and contacts, to save drafts to your Drafts folder, and to move mail between " +
  "folders, including to your deleted-mail folder, where it stays recoverable. Probanda does not send mail or permanently delete it. That is how Probanda is built, not a limit set by the password, which gives full access to the mailbox.</li>" +
  "<li>Setting up changes nothing in your mailbox. To end Probanda's access, revoke the password with your mail provider " +
  "(for iCloud, in your Apple Account at account.apple.com). Probanda can no longer sign in after that.</li>" +
  "</ol>";

const DISCLAIMER =
  "<p class=\"disclaimer\">We have made our best efforts to make this email connection secure, but no system is completely secure. " +
  "Probanda and its authors accept no liability for any loss, damage or unauthorized access arising from its use. " +
  "Use of this connection is at your own risk.</p>";

/** Each host the typed secret goes to: the mail server, then the calendar and contacts servers. */
function recipients(fields: CredentialFields): string {
  const dav = [fields.caldavUrl, fields.carddavUrl].filter((u): u is string => Boolean(u)).map((u) => new URL(u).host);
  const hosts = [...new Set([fields.host, ...dav])].join(", ");
  return dav.length ? hosts + ", and any server the calendar or contacts server moves the account to while signing in" : hosts;
}

let pending: Pending | undefined;
let listening: Promise<number> | undefined;

/** Starts the listener if needed, replaces any earlier link, and returns the new one. */
export async function servePasswordPage(fields: CredentialFields, save: SaveSecret): Promise<string> {
  const token = randomBytes(24).toString("hex");
  pending = { token, fields, save };
  listening ??= listen(handle, () => { listening = undefined; }, "<p>Return to Claude and ask for a new sign-in link.</p>", STYLE);
  return `http://127.0.0.1:${await listening}/mail/${token}`;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const m = /^\/mail\/([0-9a-f]{48})$/.exec(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
  const current = pending;
  if (!m || !current || m[1] !== current.token) {
    return page(res, 404, "This link has expired", "<p>Return to Claude and ask for a new sign-in link.</p>");
  }
  if (req.method === "GET") return page(res, 200, TITLE, form(current.fields));
  if (req.method !== "POST") return page(res, 405, "Not allowed", "");

  const secret = (new URLSearchParams(await readBody(req)).get("secret") ?? "").trim();
  let outcome: SaveOutcome;
  try {
    outcome = await current.save(secret);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return page(res, 200, TITLE, `<p class="error">Not saved: ${escape(message)}</p>${form(current.fields)}`);
  }
  if (pending === current) pending = undefined;
  const saved = outcome.persisted
    ? "<p>It is saved on this computer, encrypted, and will be used after a restart.</p>"
    : `<p class="error">It works for this session only and could not be saved: ${escape(outcome.warning ?? "")}</p>`;
  page(res, 200, "Signed in", `<p>Signed in. ${escape(String(outcome.inbox.messages))} messages in the inbox.</p>${davLines(outcome)}${saved}<p>You can close this tab and return to Claude.</p>`);
}

function davLines(outcome: SaveOutcome): string {
  const line = (label: string, r: DavResult | undefined): string =>
    !r ? "" : r.ok ? `<p>${label}: signed in.</p>` : `<p class="error">${label}: sign-in failed, so it was not saved: ${escape(r.detail ?? "")}</p>`;
  return line("Calendar", outcome.dav?.calendar) + line("Contacts", outcome.dav?.contacts);
}

function form(fields: CredentialFields): string {
  const row = (label: string, value: string | undefined): string => (value ? `<dt>${label}</dt><dd>${escape(value)}</dd>` : "");
  return (
    `<dl><dt>Server</dt><dd>${escape(fields.host)}:${fields.port}</dd><dt>Username</dt><dd>${escape(fields.username)}</dd>` +
    row("Calendar and contacts username", fields.davUsername) +
    row("Calendar server", fields.caldavUrl) +
    row("Time zone", fields.timezone) +
    row("Contacts server", fields.carddavUrl) +
    "</dl>" +
    (needsAppleIdHint(fields) ? "<p>" + APPLE_ID_HINT + "</p>" : "") +
    "<p>" + SENT_TO + escape(recipients(fields)) + "</p>" +
    '<form method="post"><label>' + SECRET_HINT + "<br>" + SECRET_INPUT + "</label>" +
    "<button type=\"submit\">Sign in and save</button></form>" +
    // The "never sent to Claude" note holds only for text typed on this 127.0.0.1 page, served by this
    // local server. A credential pasted into chat reaches the inference provider (docs/Specs/2026-10-16_mail-pasted-password-fallback-spec.md).
    "<p class=\"note\">What you type here goes only to Probanda on this computer. It is never sent to Claude.</p>" +
    FLOW +
    DISCLAIMER
  );
}

const page = (res: ServerResponse, status: number, title: string, body: string): void => sharedPage(res, status, title, body, STYLE);

const STYLE =
  "body{font-family:system-ui,sans-serif;margin:0;padding:16px;background:#fafafa;color:#222}" +
  "main{max-width:32rem;margin:2rem auto}dt{font-weight:600}dd{margin:0 0 .5rem}" +
  "input{display:block;width:100%;box-sizing:border-box;margin:.5rem 0 1rem;padding:.5rem;font-size:1rem}" +
  "button{padding:.5rem 1rem;font-size:1rem}.error{color:#a00}.note{color:#555;font-size:.9rem}" +
  "h2{font-size:1.1rem;margin-top:2rem}li{margin-bottom:.5rem}" +
  ".disclaimer{font-style:italic;margin-top:4rem;color:#555;font-size:.85rem}" +
  "@media (prefers-color-scheme: dark){body{background:#1e1e1e;color:#eee}.error{color:#f88}.note,.disclaimer{color:#aaa}}";
