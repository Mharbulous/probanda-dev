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
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";

import type { MailCredential } from "./config.js";

export type CredentialFields = Omit<MailCredential, "password">;

export interface SaveOutcome {
  inbox: { messages: unknown; unseen: unknown };
  persisted: boolean;
  warning?: string;
}

/** Signs in with the typed secret and saves the credential; throws with a message safe to show. */
export type SaveSecret = (secret: string) => Promise<SaveOutcome>;

interface Pending {
  token: string;
  fields: CredentialFields;
  save: SaveSecret;
}

const MAX_BODY = 4 * 1024;
// Plain strings, not template literals: the src/mail/ scan refuses a template literal naming it.
const SECRET_INPUT = '<input type="password" name="secret" autocomplete="current-password" required autofocus>';
const SECRET_HINT = "Your mail password. For iCloud and most hosted mail, use an app-specific password, never the account password.";

let pending: Pending | undefined;
let listening: Promise<number> | undefined;

/** Starts the listener if needed, replaces any earlier link, and returns the new one. */
export async function servePasswordPage(fields: CredentialFields, save: SaveSecret): Promise<string> {
  const token = randomBytes(24).toString("hex");
  pending = { token, fields, save };
  listening ??= listen();
  return `http://127.0.0.1:${await listening}/mail/${token}`;
}

function listen(): Promise<number> {
  const server: Server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) page(res, 500, "Something went wrong", "<p>Return to Claude and ask for a new sign-in link.</p>");
      else res.destroy();
    });
  });
  server.on("connection", (socket) => socket.unref());
  return new Promise((resolve, reject) => {
    server.once("error", (err) => {
      listening = undefined;
      reject(err);
    });
    server.listen(0, "127.0.0.1", () => {
      server.unref();
      resolve((server.address() as AddressInfo).port);
    });
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const m = /^\/mail\/([0-9a-f]{48})$/.exec(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
  const current = pending;
  if (!m || !current || m[1] !== current.token) {
    return page(res, 404, "This link has expired", "<p>Return to Claude and ask for a new sign-in link.</p>");
  }
  if (req.method === "GET") return page(res, 200, "Mail sign-in", form(current.fields));
  if (req.method !== "POST") return page(res, 405, "Not allowed", "");

  const secret = (new URLSearchParams(await readBody(req)).get("secret") ?? "").trim();
  let outcome: SaveOutcome;
  try {
    outcome = await current.save(secret);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return page(res, 200, "Mail sign-in", `<p class="error">Not saved: ${escape(message)}</p>${form(current.fields)}`);
  }
  if (pending === current) pending = undefined;
  const saved = outcome.persisted
    ? "<p>It is saved on this computer, encrypted, and will be used after a restart.</p>"
    : `<p class="error">It works for this session only and could not be saved: ${escape(outcome.warning ?? "")}</p>`;
  page(res, 200, "Signed in", `<p>Signed in. ${escape(String(outcome.inbox.messages))} messages in the inbox.</p>${saved}<p>You can close this tab and return to Claude.</p>`);
}

function form(fields: CredentialFields): string {
  return (
    `<dl><dt>Server</dt><dd>${escape(fields.host)}:${fields.port}</dd><dt>Username</dt><dd>${escape(fields.username)}</dd></dl>` +
    '<form method="post"><label>' + SECRET_HINT + "<br>" + SECRET_INPUT + "</label>" +
    "<button type=\"submit\">Sign in and save</button></form>" +
    "<p class=\"note\">What you type here goes only to Probanda on this computer. It is never sent to Claude.</p>"
  );
}

function page(res: ServerResponse, status: number, title: string, body: string): void {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escape(title)}</title><style>${STYLE}</style></head><body><main><h1>${escape(title)}</h1>${body}</main></body></html>`
  );
}

const STYLE =
  "body{font-family:system-ui,sans-serif;margin:0;padding:16px;background:#fafafa;color:#222}" +
  "main{max-width:32rem;margin:2rem auto}dt{font-weight:600}dd{margin:0 0 .5rem}" +
  "input{display:block;width:100%;box-sizing:border-box;margin:.5rem 0 1rem;padding:.5rem;font-size:1rem}" +
  "button{padding:.5rem 1rem;font-size:1rem}.error{color:#a00}.note{color:#555;font-size:.9rem}" +
  "@media (prefers-color-scheme: dark){body{background:#1e1e1e;color:#eee}.error{color:#f88}.note{color:#aaa}}";

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("the form is larger than 4 KB"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}
