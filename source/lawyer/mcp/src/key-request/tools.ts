import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";

import { defaultStateDir, readProtectedJson, writeProtectedJson } from "../../../../mcp-shared/dpapi-store.js";
import { timedFetch } from "../../../../mcp-shared/timed-fetch.js";
import { loadCloudKey } from "../cloud-key.js";
import { ValidationError } from "../errors.js";
import { defineTool, type Tool } from "../tool-list.js";
import { escape, listen, page, readBody } from "./page.js";
import { configureCloudKey } from "./save-key.js";

// Runtime logic for the key_request namespace: a practitioner with no key asks
// Probanda for one. key_request__submit serves a page on this computer where
// the practitioner types what verifying a practising lawyer requires
// (docs/Plans/2026-10-18_lawyer-only-access.md section 2.1) and an email and
// optional phone Brahm uses only to contact them, all Account Information
// (COMMANDMENTS.md, Commandment 2), so those details never pass through the chat. The key itself is never sent to the typed email. The page sends them, and nothing
// else, to the key-request-submit Edge Function with no key, because the
// practitioner has none yet. Brahm lists the queue (/view-key-requests in the
// developer plugin), mints the key and delivers it out of band, and the
// practitioner enters it on cloud_key__configure_credential's page (save-key.ts).
//
// The request is identified by a random token only this computer holds; the
// cloud stores its SHA-256. key_request__status sends the token to
// key-request-status and reports pending, issued or declined.
// The page follows page.ts: node:http on 127.0.0.1, port 0, started lazily
// and unref'd, one random path token per link, only the newest link works, and
// a successful send spends it. Tool definitions live in schema-gen.ts.
// It sends to the project loadCloudKey names, the one the key works against.

/** The only fields a request carries, besides the jurisdiction and the token's hash. */
export const REQUEST_FIELDS = ["full_name", "year_of_call", "call_date", "firm_name", "email", "phone"] as const;

const MAX_NAME = 200;
const MAX_EMAIL = 254;
const MAX_PHONE = 40;
const TITLE = "Ask Probanda for a key";

interface SavedRequest {
  request_id: string;
  request_token: string;
  requested_at: string;
}

let pending: { link: string; projectUrl: string; env: NodeJS.ProcessEnv } | undefined;
let listening: Promise<number> | undefined;
// The last request this process sent, so a failed save to disk still leaves
// this session able to check it.
let sent: SavedRequest | undefined;

export function requestPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(defaultStateDir(env), "key-request.json.dpapi");
}

/** The data server's list entries for these tools. */
export const keyRequestTools: Tool<unknown>[] = ["key_request__submit", "key_request__status", "cloud_key__configure_credential"].map((name) =>
  defineTool(name, () => callKeyRequestTool(name)));

export function callKeyRequestTool(name: string, env: NodeJS.ProcessEnv = process.env): Promise<unknown> {
  switch (name) {
    case "key_request__submit":
      return submit(env);
    case "key_request__status":
      return status(env);
    case "cloud_key__configure_credential":
      return configureCloudKey(env);
    default:
      throw new ValidationError(`Unknown key_request tool "${name}"`);
  }
}

async function submit(env: NodeJS.ProcessEnv): Promise<unknown> {
  const key = await loadCloudKey(env);
  if (key.configured) {
    throw new ValidationError("this computer already holds Probanda's key (practice_data__config_status reports cloud_credential: present), so no request is needed");
  }
  const link = randomBytes(24).toString("hex");
  pending = { link, projectUrl: key.supabaseUrl, env };
  listening ??= listen(handle, () => { listening = undefined; });
  return {
    status: "awaiting_details",
    url: `http://127.0.0.1:${await listening}/key-request/${link}`,
    next:
      "Send the practitioner this link and ask them to type their details on that page, never in chat. " +
      "When they say it is sent, call key_request__status. The link works only on this computer, until a new link is made or the server restarts.",
  };
}

async function status(env: NodeJS.ProcessEnv): Promise<unknown> {
  const saved = sent ?? (await readProtectedJson(requestPath(env), null) as SavedRequest | null);
  if (!saved?.request_token) {
    if ((await loadCloudKey(env)).configured) {
      return {
        requested: false,
        next:
          "This computer holds Probanda's key, but no request was sent from it, so Probanda's Cloud holds no verification record " +
          "linked to this key. Tell the practitioner so, and never say they are verified.",
      };
    }
    return {
      requested: false,
      next: "No request for Probanda's key was sent from this computer. Call key_request__submit to send one.",
    };
  }
  const reply = await post((await loadCloudKey(env)).supabaseUrl, "functions/v1/key-request-status", { request_token: saved.request_token }, "return the request's status");
  const state = typeof reply.status === "string" ? reply.status : "unknown";
  return {
    requested: true,
    request_id: saved.request_id,
    status: state,
    requested_at: typeof reply.requested_at === "string" ? reply.requested_at : saved.requested_at,
    decided_at: typeof reply.decided_at === "string" ? reply.decided_at : null,
    next: NEXT[state] ?? "Report the status to the practitioner as it is.",
  };
}

const NEXT: Record<string, string> = {
  pending: "Probanda has not decided this request yet. Check again later.",
  issued:
    "Probanda checked the details sent from this computer against the Law Society of British Columbia's directory and issued a key on decided_at. " +
    "Probanda sends the key to the practitioner directly. When they have it, call " +
    "cloud_key__configure_credential and have them paste it on the page it serves, never in chat.",
  declined:
    "Probanda could not verify the details sent. The practitioner can check them against their own entry in the " +
    "Law Society of British Columbia's directory and send a new request with key_request__submit.",
};

// One call to a key-request Edge Function. It sends no key: there is none yet.
// The path is written out whole at each call, so check_plugin.py's bundle-purity
// check sees it.
async function post(projectUrl: string, path: string, body: Record<string, unknown>, what: string): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await timedFetch(`${projectUrl.replace(/\/$/, "")}/${path}`, {
      init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`Probanda's Cloud did not answer, so it is not known whether it got this request (${detail})`);
  }
  const text = await res.text();
  let reply: Record<string, unknown> = {};
  try {
    reply = text ? JSON.parse(text) : {};
  } catch {
    // Not JSON: the status line below says what happened.
  }
  if (!res.ok) {
    const error = typeof reply.error === "string" ? reply.error : res.statusText;
    throw new ValidationError(`Probanda's Cloud did not ${what} (${res.status}): ${error}`);
  }
  return reply;
}

/** The request body built from the page's form: only REQUEST_FIELDS are read, whatever else is posted. */
export function requestBody(form: URLSearchParams, tokenHash: string, thisYear = new Date().getFullYear()): Record<string, unknown> {
  const fullName = (form.get("full_name") ?? "").trim();
  const firmName = (form.get("firm_name") ?? "").trim();
  const yearText = (form.get("year_of_call") ?? "").trim();
  const callDate = (form.get("call_date") ?? "").trim();
  if (!fullName || !firmName || fullName.length > MAX_NAME || firmName.length > MAX_NAME) {
    throw new ValidationError(`type your full name and your firm's name as the directory shows them, each in 1 to ${MAX_NAME} characters`);
  }
  const year = Number(yearText);
  if (!/^\d{4}$/.test(yearText) || year < 1900 || year > thisYear) {
    throw new ValidationError("type your year of call as four digits");
  }
  if (callDate && (!/^\d{4}-\d{2}-\d{2}$/.test(callDate) || callDate.slice(0, 4) !== yearText)) {
    throw new ValidationError("the call date must fall in your year of call");
  }
  const email = (form.get("email") ?? "").trim();
  const phone = (form.get("phone") ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > MAX_EMAIL) {
    throw new ValidationError("type the email address Probanda can contact you at");
  }
  if (phone && (!/^[0-9+().\- ]+$/.test(phone) || phone.length > MAX_PHONE)) {
    throw new ValidationError(`type your phone number in digits, spaces and + ( ) - only, up to ${MAX_PHONE} characters`);
  }
  return {
    full_name: fullName,
    jurisdiction: "BC",
    year_of_call: year,
    ...(callDate ? { call_date: callDate } : {}),
    firm_name: firmName,
    email,
    ...(phone ? { phone } : {}),
    token_hash: tokenHash,
  };
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const m = /^\/key-request\/([0-9a-f]{48})$/.exec(new URL(req.url ?? "/", "http://127.0.0.1").pathname);
  const current = pending;
  if (!m || !current || m[1] !== current.link) {
    return page(res, 404, "This link has expired", "<p>Return to Claude and ask for a new link.</p>");
  }
  if (req.method === "GET") return page(res, 200, TITLE, FORM);
  if (req.method !== "POST") return page(res, 405, "Not allowed", "");

  const token = randomBytes(24).toString("hex");
  let reply: Record<string, unknown>;
  try {
    const body = requestBody(new URLSearchParams(await readBody(req)), createHash("sha256").update(token).digest("hex"));
    reply = await post(current.projectUrl, "functions/v1/key-request-submit", body, "save the request");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return page(res, 200, TITLE, `<p class="error">Not sent: ${escape(message)}</p>${FORM}`);
  }
  if (pending === current) pending = undefined;
  if (typeof reply.request_id !== "string") {
    return page(res, 200, TITLE, '<p class="error">Probanda\'s Cloud did not confirm the request, so it may not have been saved. Return to Claude and ask for a new link.</p>');
  }
  sent = { request_id: reply.request_id, request_token: token, requested_at: new Date().toISOString() };
  let kept = "";
  try {
    await writeProtectedJson(requestPath(current.env), sent);
  } catch (err) {
    kept = `<p class="error">This computer could not save the request's reference, so its status can be checked only until Claude restarts: ${
      escape(err instanceof Error ? err.message : String(err))}</p>`;
  }
  page(res, 200, "Request sent",
    "<p>Your request is with Probanda. Probanda checks your details against the Law Society of British Columbia's directory and, " +
    "once it has verified you, sends your key to the email address your firm's website or the directory lists for you.</p>" + kept +
    "<p>You can close this tab and return to Claude. Ask Claude at any time where your request stands. " +
    "When your key arrives, ask Claude to set Probanda's key, and paste it on the page Claude gives you, never in chat.</p>");
}

const FORM =
  "<p>Probanda's key lets this computer use Probanda's shared services: the legal commons, the Suggestion Box and the saving of practice records. " +
  "Probanda gives one to each practising lawyer it has verified.</p>" +
  '<form method="post">' +
  '<label>Full name, as the Law Society\'s directory shows it<br><input name="full_name" maxlength="200" autocomplete="name" required autofocus></label>' +
  "<p>Jurisdiction: British Columbia</p>" +
  '<label>Year of call<br><input name="year_of_call" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required></label>' +
  '<label>Call date (optional)<br><input type="date" name="call_date"></label>' +
  '<label>Firm name, as the directory shows it under "Primary location"<br><input name="firm_name" maxlength="200" autocomplete="organization" required></label>' +
  '<label>Email, so Probanda can contact you about this request<br><input type="email" name="email" maxlength="254" autocomplete="email" required></label>' +
  '<label>Phone (optional)<br><input type="tel" name="phone" maxlength="40" autocomplete="tel"></label>' +
  '<button type="submit">Send request</button></form>' +
  // The "never sent to Claude" note holds only for text typed on this 127.0.0.1 page, served by this
  // local server. A credential pasted into chat reaches the inference provider (docs/Specs/2026-10-16_mail-pasted-password-fallback-spec.md).
  '<p class="note">These details go only to Probanda, which uses them only to check in the Law Society of British Columbia\'s public directory ' +
  "that you are a practising lawyer, and to contact you about this request. Your key is sent only to the email address your firm's website or the directory lists for you, " +
  "never to the one you type here. They are never sent to Claude. Do not include any client or matter information. Sending the request is your consent.</p>";
