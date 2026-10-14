// Who may call a function, and the frame every function shares. Used by the
// pool functions (through pool.ts) and the items functions (through items.ts).
// It loads nothing else, so a function that imports only this file does not
// start the embedding model.
//
// Each function is deployed with JWT verification off (config.toml), because the
// project's secret keys are not JWTs. So each function checks the caller itself,
// before it reads the request body: the `apikey` header must hold one of the
// project's secret keys. Supabase gives the function those keys in
// SUPABASE_SECRET_KEYS, a JSON dictionary of name to key. A publishable key is
// not in it and is refused like any other value.
//
// Nothing here logs. No function logs a text it receives.

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

/**
 * The frame every function shares: POST only, the caller checked before the body
 * is read, then the function's own work. `notJson` is the reply to a body that is
 * not JSON; by default a 400 with an error.
 */
export function serve(
  work: (key: string, body: Record<string, unknown>) => Promise<Response>,
  notJson: () => Response = () => reply(400, { error: "the request body is not JSON" }),
): void {
  Deno.serve(async (req) => {
    if (req.method !== "POST") return reply(405, { error: "POST only" });
    const key = callerSecretKey(req);
    if (!key) return reply(401, { error: "not authorized" });
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return notJson();
    }
    return await work(key, body);
  });
}
