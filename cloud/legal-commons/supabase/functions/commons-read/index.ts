// commons-read: the pool's read functions, for the plugin's read tools
// (docs/Plans/2026-10-14_install-keys.md, stage 2). Each calls one
// legal_commons function over a direct connection (db.ts), never through
// PostgREST, and replies with its jsonb unchanged, as PostgREST did.
//
// Request:  { "fn": one of the names below, "args": { the function's named arguments } }
// Reply:    the function's jsonb result.
//
// An install key needs the commons:read scope. Nothing here logs a request body;
// a fault logs its SQLSTATE only, and nothing from inside the pool goes back in
// an error.

import { reply, serve } from "../_shared/caller.ts";
import { sql } from "../_shared/db.ts";

type Args = Record<string, unknown>;

const text = (v: unknown) => (v === undefined || v === null ? null : String(v));
const texts = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
const int = (v: unknown, fallback: number) => (typeof v === "number" ? v : fallback);

// The defaults are the ones each function declares, as PostgREST applied them to an omitted argument.
const READS: Record<string, (a: Args) => Promise<{ result: unknown }[]>> = {
  resolve_principle: (a) => sql`select legal_commons.resolve_principle(${text(a.p_id)}::uuid) as result`,
  find_candidates: (a) =>
    sql`select legal_commons.find_candidates(${texts(a.p_rephrasings)}::text[], ${text(a.p_doctrine_tag)},
      ${texts(a.p_citations)}::text[], ${int(a.p_k, 20)}::integer) as result`,
  lookup_by_citation: (a) => sql`select legal_commons.lookup_by_citation(${text(a.p_citation)}) as result`,
  browse_principles: (a) =>
    sql`select legal_commons.browse_principles(${text(a.p_keyword)}, ${int(a.p_limit, 50)}::integer) as result`,
  treatment_chain: (a) => sql`select legal_commons.treatment_chain(${text(a.p_authority_id)}::uuid) as result`,
  rule_periods_find: (a) =>
    sql`select legal_commons.rule_periods_find(${text(a.p_jurisdiction)}, ${text(a.p_enactment_citation)},
      ${text(a.p_amending_reg)}, ${text(a.p_rule_ref)}, ${text(a.p_deadline_type)}) as result`,
};

serve(async (_key, body) => {
  const read = typeof body.fn === "string" && Object.hasOwn(READS, body.fn) ? READS[body.fn] : null;
  if (!read) return reply(400, { error: "fn must name one of the pool's reads" });
  const args = body.args && typeof body.args === "object" && !Array.isArray(body.args) ? body.args as Args : {};
  try {
    const [row] = await read(args);
    return reply(200, row?.result ?? null);
  } catch (err) {
    console.error("commons-read: database fault", (err as { code?: unknown })?.code ?? "no code");
    return reply(502, { error: "the read failed" });
  }
}, { scope: "commons:read" });
