// The one Postgres connection a function holds, as postgres over
// SUPABASE_DB_URL, never through PostgREST. Used by caller.ts (install keys),
// items.ts and the commons read functions. The connection opens on first use.

import postgres from "npm:postgres@3.4.5";

export const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 1, prepare: false });

/** A JSON value passed to a database function as jsonb. */
export type Json = postgres.JSONValue;

export type { postgres };
