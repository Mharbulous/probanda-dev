// The Probanda's Cloud key page: where the practitioner pastes Probanda's key, so
// it is never a tool argument and never passes through the chat or the model.
// cloud_key__configure_credential serves it (credential.ts), and the key request
// page (tools.ts), the TimeCamp page and the mail page use its page helpers. The shape of
// every credential page: the shared local-page listener (../local-page/listener.ts) on an
// ephemeral 127.0.0.1 port, started lazily by the first serve, one random path token per link
// held in memory, only the newest link works, and a successful save spends it. A restart loses
// the link, by design. The key is never logged, echoed into a page or put in an error.

import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { BUILD_STAMP } from "../build-stamp.js";
import { startPageListener } from "../local-page/listener.js";
import { BodyTooLarge, html, readBody } from "../local-page/reply.js";
import { pluginVersion } from "../repo-root.js";

/** Checks the typed key against Probanda's Cloud and saves it; throws with a message safe to show. */
export type SaveKey = (key: string) => Promise<void>;

/** A credential page's form is never larger than this. */
export const MAX_FORM = 4 * 1024;
const CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'";
const TITLE = "Probanda's Cloud key";

export interface CredentialPageOptions {
  bundle: "lawyer" | "mail" | "timecamp";
  /** The links' first path segment, and the page's kind on /health. */
  prefix: string;
  /** Answers one request for the link `link` (the path segment after the prefix). */
  handle(req: IncomingMessage, res: ServerResponse, link: string): Promise<void>;
  /** The error page's body. */
  failure?: string;
  style?: string;
}

/** The page's port, starting its listener on the first call. A failed start is tried again on the next call. */
export function credentialListener(options: CredentialPageOptions): () => Promise<number> {
  const failure = options.failure ?? "<p>Return to Claude and ask for a new link.</p>";
  let listening: Promise<number> | undefined;
  return () => {
    if (!listening) {
      const starting = startPageListener({
        bundle: options.bundle,
        port: "ephemeral",
        env: process.env,
        about: { build_stamp: BUILD_STAMP, plugin_version: pluginVersion() },
        routes: [{
          method: "*",
          kind: options.prefix,
          path: new RegExp(`^/${options.prefix}/([^/]*)$`),
          handle: (req, res, m) => options.handle(req, res, m[1]).catch((err) => {
            if (res.headersSent) return void res.destroy();
            sendPage(res, err instanceof BodyTooLarge ? err.status : 500, "Something went wrong", failure, options.style);
          }),
        }],
      }).then((listener) => listener.port);
      listening = starting;
      starting.catch(() => {
        if (listening === starting) listening = undefined;
      });
    }
    return listening;
  };
}

let pending: { link: string; save: SaveKey } | undefined;
const port = credentialListener({ bundle: "lawyer", prefix: "cloud-key", handle });

/** Starts the listener if needed, replaces any earlier link, and returns the new one. */
export async function serveKeyPage(save: SaveKey): Promise<string> {
  const link = randomBytes(24).toString("hex");
  pending = { link, save };
  return `http://127.0.0.1:${await port()}/cloud-key/${link}`;
}

async function handle(req: IncomingMessage, res: ServerResponse, link: string): Promise<void> {
  const current = pending;
  if (!current || link !== current.link) {
    return sendPage(res, 404, "This link has expired", "<p>Return to Claude and ask for a new link.</p>");
  }
  if (req.method === "GET") return sendPage(res, 200, TITLE, FORM);
  if (req.method !== "POST") return sendPage(res, 405, "Not allowed", "");

  const typed = (new URLSearchParams(await readBody(req, MAX_FORM)).get("secret") ?? "").trim();
  try {
    await current.save(typed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return sendPage(res, 200, TITLE, `<p class="error">Not saved: ${escape(message)}</p>${FORM}`);
  }
  if (pending === current) pending = undefined;
  sendPage(res, 200, "Connected",
    "<p>Connected to Probanda's Cloud. The key is saved on this computer, encrypted, and will be used after a restart.</p>" +
    "<p>You can close this tab and return to Claude.</p>");
}

const FORM =
  "<p>Paste the key Probanda gave you for this computer. It lets this computer save practice records, " +
  "send suggestions about the plugin and use the legal commons.</p>" +
  '<form method="post"><label>Probanda\'s Cloud key<br>' +
  '<input type="password" name="secret" autocomplete="off" required autofocus></label>' +
  '<button type="submit">Check and save</button></form>' +
  // The "never sent to Claude" note holds only for text typed on this 127.0.0.1 page, served by this
  // local server. A credential pasted into chat reaches the inference provider (docs/Specs/2026-10-16_mail-pasted-password-fallback-spec.md).
  '<p class="note">What you type here goes only to Probanda on this computer. It is never sent to Claude.</p>' +
  "<p class=\"note\">No key yet? Return to Claude and ask to request Probanda's key.</p>";

/** A credential page: `body` under `title`, with the credential pages' CSP. */
export function sendPage(res: ServerResponse, status: number, title: string, body: string, style = STYLE): void {
  html(res, status,
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<title>${escape(title)}</title><style>${style}</style></head><body><main><h1>${escape(title)}</h1>${body}</main></body></html>`,
    { csp: CSP });
}

const STYLE =
  "body{font-family:system-ui,sans-serif;margin:0;padding:16px;background:#fafafa;color:#222}" +
  "main{max-width:32rem;margin:2rem auto}" +
  "input{display:block;width:100%;box-sizing:border-box;margin:.5rem 0 1rem;padding:.5rem;font-size:1rem}" +
  "button{padding:.5rem 1rem;font-size:1rem}.error{color:#a00}.note{color:#555;font-size:.9rem}" +
  "@media (prefers-color-scheme: dark){body{background:#1e1e1e;color:#eee}.error{color:#f88}.note{color:#aaa}}";

export function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
