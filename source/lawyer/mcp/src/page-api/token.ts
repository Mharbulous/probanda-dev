// The page API's port and its per-page tokens, shared by the listener (server.ts) and the renders
// that write the Loose Threads page, the Past suggestions page and the suggestion cards. Thin
// wrappers over ../local-page/token.ts and ../local-page/ports.ts, which hold the scheme; every
// token keeps the bytes it had before the move (test/local-page-token.unit.test.mjs).
//
// The port is the lawyer bundle's page port (probanda.json `page_ports.lawyer`, else
// `page_api_port`, else 47615). The render embeds the same port it reads here.

import { ValidationError } from "../errors.js";
import { DEFAULT_PAGE_PORTS, PagePortError, pagePort } from "../local-page/ports.js";
import { secretPath, signTarget, verifyTarget } from "../local-page/token.js";

export const DEFAULT_PAGE_API_PORT = DEFAULT_PAGE_PORTS.lawyer;

/** The listener's port. A value that is not a port is refused. */
export function pageApiPort(env: NodeJS.ProcessEnv = process.env): number {
  try {
    return pagePort("lawyer", env);
  } catch (err) {
    if (err instanceof PagePortError) throw new ValidationError(err.message, err.code);
    throw err;
  }
}

/** The secret's path: beside probanda.json. */
export function pageApiSecretPath(env: NodeJS.ProcessEnv = process.env): string {
  return secretPath(env);
}

/** The token a page for this database and proceeding carries: HMAC of db_path + "\n" + proceeding_id. */
export function pageApiToken(dbPath: string, proceedingId: number, env: NodeJS.ProcessEnv = process.env): string {
  return signTarget("proceeding", `${dbPath}\n${proceedingId}`, env);
}

/** Whether `token` is the one pageApiToken gives, compared in constant time. */
export function pageApiTokenValid(token: string, dbPath: string, proceedingId: number, env: NodeJS.ProcessEnv = process.env): boolean {
  return verifyTarget("proceeding", `${dbPath}\n${proceedingId}`, token, env);
}

/** The token the Past suggestions page carries for one suggestion's Withdraw button. */
export function pageApiSuggestionToken(recordId: string, env: NodeJS.ProcessEnv = process.env): string {
  return signTarget("suggestion", recordId, env);
}

/** Whether `token` is the one pageApiSuggestionToken gives, compared in constant time. */
export function pageApiSuggestionTokenValid(token: string, recordId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return verifyTarget("suggestion", recordId, token, env);
}

/** The token a page's link carries for opening one file. A link opens only the file a render named. */
export function pageApiFileToken(path: string, env: NodeJS.ProcessEnv = process.env): string {
  return signTarget("file", path, env);
}

/** Whether `token` is the one pageApiFileToken gives, compared in constant time. */
export function pageApiFileTokenValid(token: string, path: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return verifyTarget("file", path, token, env);
}

/** The link that opens one file through the listener. A `file:///` link does nothing on a page shown from a
 * web origin, such as a Cowork file card, and this one is a plain link, so it needs no cross-origin reply. */
export function pageApiFileUrl(path: string, env: NodeJS.ProcessEnv = process.env): string {
  return `http://127.0.0.1:${pageApiPort(env)}/files/open?path=${encodeURIComponent(path)}&token=${pageApiFileToken(path, env)}`;
}

/** The token a suggestion card (suggestions/card.ts) and its mockup page carry for that card's buttons. */
export function pageApiCardToken(cardId: string, env: NodeJS.ProcessEnv = process.env): string {
  return signTarget("card", cardId, env);
}

/** Whether `token` is the one pageApiCardToken gives, compared in constant time. */
export function pageApiCardTokenValid(token: string, cardId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return verifyTarget("card", cardId, token, env);
}
