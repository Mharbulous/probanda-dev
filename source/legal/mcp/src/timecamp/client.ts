// The TimeCamp API client of the timekeeper plugin's `timecamp` server
// (docs/Specs/2026-10-15_timecamp-api-connector-spec.md). It runs on the
// practitioner's computer and talks only to www.timecamp.com.
//
// The token is one DPAPI-protected file beside the other Probanda credentials,
// set once through configure_credential's local page (page.ts), so it is never
// a tool argument and never passes through the chat. It is never returned,
// logged or put in an error. This module imports nothing from the data
// server's stores.

import { join } from "node:path";

import { defaultStateDir, readProtectedJson, writeProtectedJson } from "../../../../mcp-shared/dpapi-store.js";
import { DataServerError } from "../errors.js";

export const API_BASE = "https://www.timecamp.com/third_party/api/";
const TIMEOUT_MS = 60_000;

export interface TokenState {
  token: string | null;
  // First line of the reason a stored token could not be read, if any.
  credentialError?: string;
}

export function credentialPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(defaultStateDir(env, "timecamp"), "timecamp.json.dpapi");
}

// Never throws, so the server always starts and configure_credential can fix it.
export async function loadToken(env: NodeJS.ProcessEnv = process.env): Promise<TokenState> {
  try {
    const stored = await readProtectedJson<{ token?: unknown }>(credentialPath(env), null);
    if (!stored) return { token: null };
    if (typeof stored.token !== "string" || !stored.token) throw new Error("the stored file is not a TimeCamp token");
    return { token: stored.token };
  } catch (error) {
    const detail = (error instanceof Error ? error.message : String(error)).split("\n")[0].trim();
    process.stderr.write(`timecamp: the stored token could not be read: ${detail}\n`);
    return { token: null, credentialError: detail };
  }
}

// `protect` is forced true: a real token is never written as plaintext.
export async function persistToken(token: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  await writeProtectedJson(credentialPath(env), { token }, true);
}

/** Why the API cannot be used without a token, or undefined when one is set. */
export function missingTokenReason(state: TokenState): string | undefined {
  if (state.token) return undefined;
  if (state.credentialError) {
    return `the stored TimeCamp token could not be read (${state.credentialError}); set it again with configure_credential`;
  }
  return "no TimeCamp token is set on this computer; set it with configure_credential";
}

export class TimeCampError extends DataServerError {
  constructor(message: string, code = "timecamp_error") {
    super(message, code);
  }
}

/**
 * One request to the API. `path` keeps its trailing slash: the bare URL
 * redirects and drops the query string, so a redirect is an error here, never
 * followed. Returns the parsed JSON body of a 2xx answer.
 */
export async function apiRequest(
  token: string,
  method: "GET" | "PUT",
  path: string,
  query?: URLSearchParams,
  form?: URLSearchParams
): Promise<unknown> {
  const url = API_BASE + path + (query ? `?${query.toString()}` : "");
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      },
      ...(form ? { body: form.toString() } : {}),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new TimeCampError(`network: TimeCamp could not be reached (${detail})`, "timecamp_network");
  }
  const text = await res.text();
  if (res.status >= 300 && res.status < 400) {
    throw new TimeCampError(`TimeCamp redirected ${method} ${path} (HTTP ${res.status}); the request was not followed`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new TimeCampError(
      `TimeCamp refused the request (HTTP ${res.status}): ${snippet(text)}. If this is every request, the token is wrong or revoked; set it again with configure_credential`,
      "timecamp_auth"
    );
  }
  if (!res.ok) throw new TimeCampError(`TimeCamp answered HTTP ${res.status}: ${snippet(text)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new TimeCampError(`TimeCamp answered HTTP ${res.status} with a body that is not JSON: ${snippet(text)}`);
  }
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat ? (flat.length > 200 ? `${flat.slice(0, 200)}…` : flat) : "(empty body)";
}
