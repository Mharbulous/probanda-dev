// Who may call a function, and the frame every function shares. Used by the
// pool functions (through pool.ts), the items functions (through items.ts) and
// the commons read functions. It never loads the embedding model.
//
// Each function is deployed with JWT verification off (config.toml), because
// neither kind of key it accepts is a JWT. So each function checks the caller
// itself, before it reads the request body, from the `apikey` header:
//
// - One of the project's secret keys. Supabase gives the function those keys in
//   SUPABASE_SECRET_KEYS, a JSON dictionary of name to key. It may call every
//   function, and an items body names its own tenant.
// - An install key (`pb_install_…`, docs/Plans/2026-10-14_install-keys.md). Its
//   SHA-256 is resolved by access.resolve_key to a tenant and scopes. It may
//   call only a function that names one of its scopes.
//
// A publishable key is neither and is refused like any other value.
//
// Nothing here logs a key or a body. A database fault logs its SQLSTATE only.

import { sql } from "./db.ts";

export type Scope = "commons:read" | "items:write" | "suggestions:write";

/** The caller a request's key names. */
export type Caller =
  | { kind: "project" }
  | { kind: "install"; tenant: string | null; scopes: Scope[]; keyHash: string };

const INSTALL_PREFIX = "pb_install_";

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

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The live install key the caller sent, or null when it names no key or a revoked one.
 * keyHash is the key's SHA-256 as access.install_key holds it: the Suggestion Box
 * records it as the account that sent a suggestion (Account Information), and
 * nothing here logs or returns it.
 */
async function callerInstallKey(sent: string): Promise<Caller | null> {
  const keyHash = await sha256Hex(sent);
  const [row] = await sql`select access.resolve_key(${keyHash}) as k`;
  const k = row?.k as { tenant: string | null; scopes: Scope[] } | null;
  return k ? { kind: "install", tenant: k.tenant, scopes: k.scopes, keyHash } : null;
}

export function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export interface ServeOptions {
  /** The scope an install key needs to call this function. Without one, only the project's secret keys may. */
  scope?: Scope;
  /** The reply to a body that is not JSON; by default a 400 with an error. */
  notJson?: () => Response;
}

/**
 * The frame of a function any caller may reach with no key: POST only and a JSON
 * object body. Only key-request-submit and key-request-status use it, because
 * a practitioner who asks for a key has none yet.
 */
export function serveOpen(work: (body: Record<string, unknown>) => Promise<Response>): void {
  Deno.serve(async (req) => {
    if (req.method !== "POST") return reply(405, { error: "POST only" });
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return reply(400, { error: "the request body is not JSON" });
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return reply(400, { error: "the request body is not a JSON object" });
    }
    return await work(body as Record<string, unknown>);
  });
}

/**
 * The frame every function shares: POST only, the caller checked before the body
 * is read, then the function's own work. `key` is the key the caller sent.
 */
export function serve(
  work: (key: string, body: Record<string, unknown>, caller: Caller) => Promise<Response>,
  options: ServeOptions = {},
): void {
  const notJson = options.notJson ?? (() => reply(400, { error: "the request body is not JSON" }));
  Deno.serve(async (req) => {
    if (req.method !== "POST") return reply(405, { error: "POST only" });
    const sent = req.headers.get("apikey") ?? "";
    let caller: Caller | null = null;
    if (callerSecretKey(req)) {
      caller = { kind: "project" };
    } else if (options.scope && sent.startsWith(INSTALL_PREFIX)) {
      try {
        caller = await callerInstallKey(sent);
      } catch (err) {
        console.error("caller: database fault", (err as { code?: unknown })?.code ?? "no code");
        return reply(500, { error: "Probanda's Cloud could not complete this request." });
      }
      if (caller?.kind === "install" && !caller.scopes.includes(options.scope)) caller = null;
    }
    if (!caller) return reply(401, { error: "not authorized" });
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return notJson();
    }
    return await work(sent, body, caller);
  });
}
