// The TimeCamp token page: where the practitioner pastes the API token, so it
// is never a tool argument and never passes through the chat or the model. The
// shape of src/mail/page.ts: node:http on 127.0.0.1, port 0, started lazily and
// unref'd, one random path token per link, only the newest link works, and a
// successful save spends it. The API token is never logged, echoed into a page
// or put in an error.

import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { escape, listen, page, readBody } from "../key-request/page.js";

/** Checks the typed token against TimeCamp and saves it; throws with a message safe to show. */
export type SaveToken = (token: string) => Promise<{ user: string; persisted: boolean; warning?: string }>;

const TITLE = "Probanda TimeCamp connector";

let pending: { link: string; save: SaveToken } | undefined;
let listening: Promise<number> | undefined;

/** Starts the listener if needed, replaces any earlier link, and returns the new one. */
export async function serveTokenPage(save: SaveToken): Promise<string> {
  const link = randomBytes(24).toString("hex");
  pending = { link, save };
  listening ??= listen(handle, () => { listening = undefined; });
  return `http://127.0.0.1:${await listening}/timecamp/${link}`;
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
  // The "never sent to Claude" note holds only for text typed on this 127.0.0.1 page, served by this
  // local server. A credential pasted into chat reaches the inference provider (docs/Specs/2026-10-16_mail-pasted-password-fallback-spec.md).
  '<p class="note">What you type here goes only to Probanda on this computer. It is never sent to Claude.</p>';
