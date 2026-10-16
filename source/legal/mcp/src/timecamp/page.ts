// The TimeCamp token page: where the practitioner pastes the API token, so it
// is never a tool argument and never passes through the chat or the model. The
// shape of src/mail/page.ts: node:http on 127.0.0.1, port 0, started lazily and
// unref'd, one random path token per link, only the newest link works, and a
// successful save spends it. The API token is never logged, echoed into a page
// or put in an error.

import { randomBytes } from "node:crypto";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";

/** Checks the typed token against TimeCamp and saves it; throws with a message safe to show. */
export type SaveToken = (token: string) => Promise<{ user: string; persisted: boolean; warning?: string }>;

const MAX_BODY = 4 * 1024;
const TITLE = "Probanda TimeCamp connector";

let pending: { link: string; save: SaveToken } | undefined;
let listening: Promise<number> | undefined;

/** Starts the listener if needed, replaces any earlier link, and returns the new one. */
export async function serveTokenPage(save: SaveToken): Promise<string> {
  const link = randomBytes(24).toString("hex");
  pending = { link, save };
  listening ??= listen();
  return `http://127.0.0.1:${await listening}/timecamp/${link}`;
}

function listen(): Promise<number> {
  const server: Server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) page(res, 500, "Something went wrong", "<p>Return to Claude and ask for a new link.</p>");
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
  const m = /^\/timecamp\/([0-9a-f]{48})$/.exec(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
  const current = pending;
  if (!m || !current || m[1] !== current.link) {
    return page(res, 404, "This link has expired", "<p>Return to Claude and ask for a new link.</p>");
  }
  if (req.method === "GET") return page(res, 200, TITLE, FORM);
  if (req.method !== "POST") return page(res, 405, "Not allowed", "");

  const typed = (new URLSearchParams(await readBody(req)).get("secret") ?? "").trim();
  let outcome: Awaited<ReturnType<SaveToken>>;
  try {
    outcome = await current.save(typed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return page(res, 200, TITLE, `<p class="error">Not saved: ${escape(message)}</p>${FORM}`);
  }
  if (pending === current) pending = undefined;
  const saved = outcome.persisted
    ? "<p>It is saved on this computer, encrypted, and will be used after a restart.</p>"
    : `<p class="error">It works for this session only and could not be saved: ${escape(outcome.warning ?? "")}</p>`;
  page(res, 200, "Connected", `<p>Connected to TimeCamp as ${escape(outcome.user)}.</p>${saved}<p>You can close this tab and return to Claude.</p>`);
}

const FORM =
  "<p>Find your token in TimeCamp: click your avatar, open Profile Settings, and scroll to the bottom for " +
  "\"Your programming API token\".</p>" +
  "<p>Your token will be sent to: www.timecamp.com</p>" +
  '<form method="post"><label>TimeCamp API token<br>' +
  '<input type="password" name="secret" autocomplete="off" required autofocus></label>' +
  '<button type="submit">Check and save</button></form>' +
  '<p class="note">What you type here goes only to Probanda on this computer. It is never sent to Claude.</p>';

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
  "main{max-width:32rem;margin:2rem auto}" +
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
