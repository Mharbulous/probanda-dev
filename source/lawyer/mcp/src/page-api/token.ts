// The page API's port and its per-page token, shared by the listener (server.ts) and the renders
// that write the Loose Threads page and the Past suggestions page (suggestions/page.ts).
//
// The port is `page_api_port` in the per-device probanda.json (config-path.ts), 47615 when unset.
// The render embeds the same port it reads here.
//
// A page's token is HMAC-SHA256(secret, db_path + "\n" + proceeding_id), hex. The secret is 32
// random bytes in `page-api.secret` beside probanda.json, created on first need with an exclusive
// create, so every data server process on the device, and every restart, computes the same token
// and accepts only a db_path and proceeding a render wrote. Nothing is kept in memory.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { configPath } from "../config-path.js";
import { ValidationError } from "../errors.js";

export const DEFAULT_PAGE_API_PORT = 47615;
const SECRET_FILE = "page-api.secret";
const SECRET_BYTES = 32;

/** The listener's port: probanda.json's `page_api_port`, else 47615. A value that is not a port is refused. */
export function pageApiPort(env: NodeJS.ProcessEnv = process.env): number {
  const path = configPath(env);
  if (!existsSync(path)) return DEFAULT_PAGE_API_PORT;
  const value = (JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown> | null)?.page_api_port;
  if (value === undefined || value === null) return DEFAULT_PAGE_API_PORT;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw new ValidationError(`${path}: page_api_port must be a whole number from 1 to 65535, got ${JSON.stringify(value)}`, "invalid_page_api_port");
  }
  return value;
}

/** The secret's path: beside probanda.json. */
export function pageApiSecretPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(dirname(configPath(env)), SECRET_FILE);
}

/** The per-device secret, created on first need. The bytes are written to a temp file first and
 * linked into place, which fails if the file exists, so a reader never sees a part-written secret
 * and two processes creating it at once agree on one. */
function pageApiSecret(env: NodeJS.ProcessEnv): Buffer {
  const path = pageApiSecretPath(env);
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    writeFileSync(temp, randomBytes(SECRET_BYTES), { flag: "wx" });
    try {
      linkSync(temp, path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    } finally {
      unlinkSync(temp);
    }
  }
  const secret = readFileSync(path);
  if (secret.length !== SECRET_BYTES) throw new Error(`${path} holds ${secret.length} bytes, not ${SECRET_BYTES}; delete it and re-render the page`);
  return secret;
}

/** The token a page for this database and proceeding carries. */
export function pageApiToken(dbPath: string, proceedingId: number, env: NodeJS.ProcessEnv = process.env): string {
  return createHmac("sha256", pageApiSecret(env)).update(`${dbPath}\n${proceedingId}`).digest("hex");
}

/** Whether `token` is the one pageApiToken gives, compared in constant time. */
export function pageApiTokenValid(token: string, dbPath: string, proceedingId: number, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = Buffer.from(pageApiToken(dbPath, proceedingId, env), "utf-8");
  const given = Buffer.from(token, "utf-8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The token the Past suggestions page carries for one suggestion's Withdraw button:
 * HMAC-SHA256(secret, "suggestion\n" + record id), hex. A db_path is absolute, so it never collides. */
export function pageApiSuggestionToken(recordId: string, env: NodeJS.ProcessEnv = process.env): string {
  return createHmac("sha256", pageApiSecret(env)).update(`suggestion\n${recordId}`).digest("hex");
}

/** Whether `token` is the one pageApiSuggestionToken gives, compared in constant time. */
export function pageApiSuggestionTokenValid(token: string, recordId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = Buffer.from(pageApiSuggestionToken(recordId, env), "utf-8");
  const given = Buffer.from(token, "utf-8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The token a page's link carries for opening one file: HMAC-SHA256(secret, "file\n" + path), hex. A link
 * opens only the file a render named, and its prefix keeps it apart from every other token. */
export function pageApiFileToken(path: string, env: NodeJS.ProcessEnv = process.env): string {
  return createHmac("sha256", pageApiSecret(env)).update(`file\n${path}`).digest("hex");
}

/** Whether `token` is the one pageApiFileToken gives, compared in constant time. */
export function pageApiFileTokenValid(token: string, path: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = Buffer.from(pageApiFileToken(path, env), "utf-8");
  const given = Buffer.from(token, "utf-8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The link that opens one file through the listener. A `file:///` link does nothing on a page shown from a
 * web origin, such as a Cowork file card, and this one is a plain link, so it needs no cross-origin reply. */
export function pageApiFileUrl(path: string, env: NodeJS.ProcessEnv = process.env): string {
  return `http://127.0.0.1:${pageApiPort(env)}/files/open?path=${encodeURIComponent(path)}&token=${pageApiFileToken(path, env)}`;
}

/** The token a suggestion card (suggestions/card.ts) and its mockup page carry for that card's buttons:
 * HMAC-SHA256(secret, "card\n" + card id), hex. Its prefix keeps it apart from a withdraw token. */
export function pageApiCardToken(cardId: string, env: NodeJS.ProcessEnv = process.env): string {
  return createHmac("sha256", pageApiSecret(env)).update(`card\n${cardId}`).digest("hex");
}

/** Whether `token` is the one pageApiCardToken gives, compared in constant time. */
export function pageApiCardTokenValid(token: string, cardId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = Buffer.from(pageApiCardToken(cardId, env), "utf-8");
  const given = Buffer.from(token, "utf-8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
