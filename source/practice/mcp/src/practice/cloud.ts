// The client of Probanda's Cloud's three items functions
// (cloud/items/README.md). It posts with the commons credential in the
// `apikey` header, through Node's fetch. A reply that is not what the function
// promises counts as no answer, never as a save
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

/** Posts one request and returns its JSON object, or throws CloudUnreachableError. */
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
    });
  } catch (err) {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    throw new CloudUnreachableError([(err as Error).message, cause?.code ?? cause?.message].filter(Boolean).join(": "));
  }
  if (!res.ok) throw new CloudUnreachableError(`HTTP ${res.status}`);
  let json: unknown;
  try {
    json = JSON.parse(await res.text());
  } catch {
    throw new CloudUnreachableError("a reply that is not JSON");
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) throw new CloudUnreachableError("a reply that is not a JSON object");
  return json as Record<string, unknown>;
}
