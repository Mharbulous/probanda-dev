// Shared by the three pool functions: who may call, the embedding model, and
// the one way they reach the database.
//
// Each function is deployed with JWT verification off (config.toml), because the
// pool's secret keys are not JWTs. So each function checks the caller itself,
// before it reads the request body: the `apikey` header must hold one of the
// project's secret keys. Supabase gives the function those keys in
// SUPABASE_SECRET_KEYS, a JSON dictionary of name to key. A publishable key is
// not in it and is refused like any other value.
//
// Nothing here logs. No function logs a text it receives.

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

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  // Compares every byte whatever the result, so the time taken says nothing about where two keys differ.
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ (b[i % (b.length || 1)] ?? 0);
  return diff === 0;
}

/** The project's secret key the caller sent, or null when the caller sent none of them. */
export function callerSecretKey(req: Request): string | null {
  const sent = req.headers.get("apikey");
  if (!sent) return null;
  const keys = Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}")) as string[];
  const encoder = new TextEncoder();
  const sentBytes = encoder.encode(sent);
  return keys.find((key) => sameBytes(encoder.encode(key), sentBytes)) ?? null;
}

export function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
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

/** Every clause's id and text, read a page at a time. */
export async function allClauses(key: string): Promise<{ clause_id: string; text: string }[]> {
  const page = 500;
  const out: { clause_id: string; text: string }[] = [];
  for (let offset = 0; ; offset += page) {
    const res = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/rest/v1/clause?select=clause_id,text&order=clause_id&limit=${page}&offset=${offset}`,
      { headers: headers(key, "Accept-Profile") },
    );
    if (!res.ok) throw new Error(`reading clauses failed (${res.status})`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < page) return out;
  }
}

/**
 * The frame every function shares: POST only, the caller checked before the body
 * is read, then the function's own work.
 */
export function serve(work: (key: string, body: Record<string, unknown>) => Promise<Response>): void {
  Deno.serve(async (req) => {
    if (req.method !== "POST") return reply(405, { error: "POST only" });
    const key = callerSecretKey(req);
    if (!key) return reply(401, { error: "not authorized" });
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return reply(400, { error: "the request body is not JSON" });
    }
    return await work(key, body);
  });
}
