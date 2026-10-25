// The Probanda's Cloud key page: where the practitioner pastes Probanda's key, so
// it is never a tool argument and never passes through the chat or the model.
// cloud_key__configure_credential serves it (credential.ts), and the key request
// page (tools.ts) uses its page helpers. The shape of the mail and TimeCamp
// pages: node:http on 127.0.0.1, port 0, started lazily and unref'd, one random
// path token per link, only the newest link works, and a successful save spends
// it. The key is never logged, echoed into a page or put in an error.

import { randomBytes } from "node:crypto";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";

/** Checks the typed key against Probanda's Cloud and saves it; throws with a message safe to show. */
export type SaveKey = (key: string) => Promise<void>;

const MAX_BODY = 4 * 1024;
const TITLE = "Probanda's Cloud key";

let pending: { link: string; save: SaveKey } | undefined;
let listening: Promise<number> | undefined;

/** Starts the listener if needed, replaces any earlier link, and returns the new one. */
export async function serveKeyPage(save: SaveKey): Promise<string> {
  const link = randomBytes(24).toString("hex");
  pending = { link, save };
  listening ??= listen(handle, () => { listening = undefined; });
  return `http://127.0.0.1:${await listening}/cloud-key/${link}`;
}

/** Starts a page listener on 127.0.0.1 for `handle`; `onError` runs before the returned promise rejects. */
export function listen(handle: (req: IncomingMessage, res: ServerResponse) => Promise<void>, onError: () => void): Promise<number> {
  const server: Server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) page(res, 500, "Something went wrong", "<p>Return to Claude and ask for a new link.</p>");
      else res.destroy();
    });
  });
  server.on("connection", (socket) => socket.unref());
  return new Promise((resolve, reject) => {
    server.once("error", (err) => {
      onError();
      reject(err);
    });
    server.listen(0, "127.0.0.1", () => {
      server.unref();
      resolve((server.address() as AddressInfo).port);
    });
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const m = /^\/cloud-key\/([0-9a-f]{48})$/.exec(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
  const current = pending;
  if (!m || !current || m[1] !== current.link) {
    return page(res, 404, "This link has expired", "<p>Return to Claude and ask for a new link.</p>");
  }
  if (req.method === "GET") return page(res, 200, TITLE, FORM);
  if (req.method !== "POST") return page(res, 405, "Not allowed", "");

  const typed = (new URLSearchParams(await readBody(req)).get("secret") ?? "").trim();
  try {
    await current.save(typed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return page(res, 200, TITLE, `<p class="error">Not saved: ${escape(message)}</p>${FORM}`);
  }
  if (pending === current) pending = undefined;
  page(res, 200, "Connected",
    "<p>Connected to Probanda's Cloud. The key is saved on this computer, encrypted, and will be used after a restart.</p>" +
    "<p>You can close this tab and return to Claude.</p>");
}

const FORM =
  "<p>Paste the key Probanda gave you for this computer. It lets this computer save practice records, " +
  "send suggestions about the plugin and use the legal commons.</p>" +
  '<form method="post"><label>Probanda\'s Cloud key<br>' +
  '<input type="password" name="secret" autocomplete="off" required autofocus></label>' +
  '<button type="submit">Check and save</button></form>' +
  '<p class="note">What you type here goes only to Probanda on this computer. It is never sent to Claude.</p>' +
  "<p class=\"note\">No key yet? Return to Claude and ask to request Probanda's key.</p>";

export function page(res: ServerResponse, status: number, title: string, body: string): void {
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
  "main{max-width:32rem;margin:2rem auto}" +
  "input{display:block;width:100%;box-sizing:border-box;margin:.5rem 0 1rem;padding:.5rem;font-size:1rem}" +
  "button{padding:.5rem 1rem;font-size:1rem}.error{color:#a00}.note{color:#555;font-size:.9rem}" +
  "@media (prefers-color-scheme: dark){body{background:#1e1e1e;color:#eee}.error{color:#f88}.note{color:#aaa}}";

export function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function readBody(req: IncomingMessage): Promise<string> {
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
