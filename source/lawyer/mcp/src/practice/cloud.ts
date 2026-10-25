// The client of Probanda's Cloud's three items functions
// (cloud/items/README.md). It posts with the commons credential in the
// `apikey` header, through Node's fetch. A reply that is not what the function
// promises counts as no answer, never as a save. A connection reset after the request went
// out, or part-way through the reply, is neither: the cloud may have saved
// (docs/Plans/2026-10-14_practice-db-conversion.md, "When the cloud cannot be reached").

import { loadCloudKey } from "../cloud-key.js";
import { DataServerError } from "../errors.js";

// Every function path the data server calls, written out whole.
const PATHS = {
  write: "functions/v1/items-write",
  sync: "functions/v1/items-sync",
  seed: "functions/v1/items-seed",
} as const;

export type ItemsFunction = keyof typeof PATHS;

/** The cloud did not answer usefully. Nothing it said can be taken as a save. */
export class CloudUnreachableError extends DataServerError {
  constructor(readonly detail: string) {
    super(
      `Probanda's Cloud did not answer (${detail}). Nothing was saved, in the cloud or in practice.db. ` +
        "If this persists, check whether the Supabase project is paused.",
      "cloud_unreachable"
    );
  }
}

/** The connection was reset before the answer arrived: the cloud may have received the request, and saved it. */
export class CloudResetError extends DataServerError {
  constructor(readonly detail: string) {
    super(`Probanda's Cloud may have received this request: the connection was reset before its answer arrived (${detail}).`, "cloud_reset");
  }
}

const TIMEOUT_MS = 60_000;

// The fetch failures that can come after the request went out. A timeout is one too.
const RESET_CODES = new Set(["ECONNRESET", "UND_ERR_SOCKET"]);

function failure(err: unknown): { detail: string; code?: string } {
  const cause = (err as { cause?: { code?: string; message?: string } }).cause;
  return { detail: [(err as Error).message, cause?.code ?? cause?.message].filter(Boolean).join(": "), code: cause?.code };
}

/** No credential is configured: nothing can be sent. */
export class CloudNotConfiguredError extends DataServerError {
  constructor(reason: string) {
    super(`Probanda's Cloud is not configured: ${reason}. Nothing was saved.`, "cloud_not_configured");
  }
}

/** Throws CloudNotConfiguredError when there is no credential. */
export async function cloudCredential(env: NodeJS.ProcessEnv): Promise<{ supabaseUrl: string; staticKey: string }> {
  const key = await loadCloudKey(env);
  if (!key.configured) throw new CloudNotConfiguredError(key.reason);
  return key;
}

/** Posts one request and returns its JSON object, or throws CloudUnreachableError or CloudResetError. */
export async function callItems(
  env: NodeJS.ProcessEnv,
  fn: ItemsFunction,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const { supabaseUrl, staticKey } = await cloudCredential(env);
  let res: Response;
  try {
    res = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/${PATHS[fn]}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: staticKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const { detail, code } = failure(err);
    const reset = RESET_CODES.has(code ?? "") || (err as Error).name === "TimeoutError";
    throw reset ? new CloudResetError(detail) : new CloudUnreachableError(detail);
  }
  if (!res.ok) throw new CloudUnreachableError(`HTTP ${res.status}`);
  let text: string;
  try {
    text = await res.text();
  } catch (err) {
    // The cloud answered 200, so it got the request; its reply was cut off.
    throw new CloudResetError(failure(err).detail);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new CloudUnreachableError("a reply that is not JSON");
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) throw new CloudUnreachableError("a reply that is not a JSON object");
  return json as Record<string, unknown>;
}
