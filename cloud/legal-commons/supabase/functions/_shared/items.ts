// Shared by the three items functions (items-write, items-sync, items-seed):
// the one Postgres connection and the frame that calls one `rules` function.
//
// The `rules` and `ledger` schemas are not exposed through the API, so these
// functions reach them over a direct connection as postgres
// (SUPABASE_DB_URL), never through PostgREST. Each request runs one `rules`
// function in one transaction and replies with its jsonb unchanged.
//
// A body that is not a JSON object is refused with {saved: false, question}.
// A database fault replies 500 with a generic body: its text could state a rule
// (Commandment 6). Nothing here logs a request body; a fault logs its SQLSTATE
// only.

import postgres from "npm:postgres@3.4.5";
import { reply, serve } from "./caller.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 1, prepare: false });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The refusal shape every items function shares. */
export function refuse(question: string): Response {
  return reply(200, { saved: false, question });
}

/** The tenant a body names, or null when it names none or names it by something other than a UUID. */
export function tenantOf(body: Record<string, unknown>): string | null {
  return typeof body.tenant === "string" && UUID.test(body.tenant) ? body.tenant : null;
}

/** A JSON value passed to a `rules` function as jsonb. */
export type Json = postgres.JSONValue;

/** The one query a request runs: a `rules` call that returns one row with a jsonb `result`. */
export type RulesCall = (tx: postgres.TransactionSql) => Promise<postgres.Row[]>;

/**
 * Serves one items function. `prepare` reads the body and returns either the
 * `rules` call to run or a reply to send without touching the database.
 */
export function serveItems(prepare: (body: Record<string, unknown>) => RulesCall | Response): void {
  serve(async (_key, body) => {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return refuse("What is this request? Its body is not a JSON object.");
    }
    const call = prepare(body);
    if (call instanceof Response) return call;
    try {
      const rows = await sql.begin(call);
      return reply(200, rows[0].result);
    } catch (err) {
      console.error("items: database fault", (err as { code?: unknown })?.code ?? "no code");
      return reply(500, { error: "Probanda's Cloud could not complete this request." });
    }
  }, () => refuse("What is this request? Its body is not JSON."));
}
