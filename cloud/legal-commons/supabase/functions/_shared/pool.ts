// Shared by the pool functions: the embedding model and the one way they reach
// the database. Who may call, and the frame each function runs in, are in
// caller.ts and re-exported here.
//
// Nothing here logs. No function logs a text it receives.

import { callerSecretKey, reply, serve } from "./caller.ts";

export { callerSecretKey, reply, serve };

export const MODEL = "gte-small";

// The fixed sentence whose embedding is the model's fingerprint. Changing it
// means storing a new fingerprint (commons-reembed).
export const FINGERPRINT_SENTENCE = "The fixed sentence that identifies the embedding model of the legal commons pool.";

const SCHEMA = "legal_commons";

// deno-lint-ignore no-explicit-any
const session = new (globalThis as any).Supabase.ai.Session(MODEL);

/** The embedding of one text: 384 numbers, mean-pooled and normalized. */
export async function embed(text: string): Promise<number[]> {
  return (await session.run(text, { mean_pool: true, normalize: true })) as number[];
}

function headers(key: string, profile: "Accept-Profile" | "Content-Profile"): Record<string, string> {
  return { apikey: key, "Content-Type": "application/json", [profile]: SCHEMA };
}

/** Calls one database function of the pool and hands its reply back unchanged. */
export async function callPool(key: string, fn: string, args: Record<string, unknown>): Promise<Response> {
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: headers(key, "Content-Profile"),
    body: JSON.stringify(args),
  });
  return new Response(await res.text(), { status: res.status, headers: { "Content-Type": "application/json" } });
}

/** The next `limit` clauses in id order, after the id given or from the start. */
export async function clausesAfter(
  key: string,
  after: string | null,
  limit: number,
): Promise<{ clause_id: string; text: string }[]> {
  const from = after ? `&clause_id=gt.${after}` : "";
  const res = await fetch(
    `${Deno.env.get("SUPABASE_URL")}/rest/v1/clause?select=clause_id,text&order=clause_id&limit=${limit}${from}`,
    { headers: headers(key, "Accept-Profile") },
  );
  if (!res.ok) throw new Error(`reading clauses failed (${res.status})`);
  return await res.json();
}
