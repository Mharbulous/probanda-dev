// commons-find: the search the plugin calls (the plan's phase 7). Embeds the
// query, calls clause_search, and replies with only the principles its hits are
// stated in, each with its prose and its authorities' citations and pinpoints.
// Clauses, records, conditions, rationales, links and their ids stay here:
// Brahm's decision of 2026-10-13 is that a user sees prose and pinpoints only.
//
// Request:  { "text": string, "limit"?: 1 to 10 principles, 5 unless told otherwise }
// Reply:    { "results": [ { "principle_id", "text",
//                            "authorities": [ { "citation", "title", "url", "pinpoint" } ] } ] }
//           best match first.
//
// It reads the pool over a direct connection (db.ts), never through PostgREST,
// and an install key needs the commons:read scope (caller.ts). Deployed with the
// CLI like the others (docs/Plans/2026-10-14_install-keys.md, stage 2), so it
// shares the model settings in ../_shared/pool.ts. Nothing here logs.

import { reply, serve } from "../_shared/caller.ts";
import { sql } from "../_shared/db.ts";
import { embed } from "../_shared/pool.ts";

type Hit = { tests?: { stated_in?: { principle_id: string }[] }[]; equivalent?: Hit[] };

serve(async (_key, body) => {
  if (typeof body.text !== "string" || body.text.trim() === "") return reply(400, { error: "text is required" });
  const limit = body.limit ?? 5;
  if (!(Number.isInteger(limit) && (limit as number) >= 1 && (limit as number) <= 10)) {
    return reply(400, { error: "limit must be a whole number from 1 to 10" });
  }

  try {
    const embedding = await embed(body.text);
    const [{ found }] = await sql`select legal_commons.clause_search(${body.text},
      ${JSON.stringify(embedding)}::extensions.vector, 'any', 10) as found`;
    const { exact, nearest } = found as { exact: Hit | null; nearest: Hit[] };

    // The stating principles, in the order their hits came.
    const ids: string[] = [];
    for (const hit of [...(exact ? [exact] : []), ...(nearest ?? [])]) {
      for (const clause of [hit, ...(hit.equivalent ?? [])]) {
        for (const test of clause.tests ?? []) {
          for (const stated of test.stated_in ?? []) {
            if (!ids.includes(stated.principle_id)) ids.push(stated.principle_id);
          }
        }
      }
    }
    const chosen = ids.slice(0, limit as number);
    if (chosen.length === 0) return reply(200, { results: [] });

    const principles = await sql<{ principle_id: string; text: string }[]>`
      select principle_id, text from legal_commons.principle where principle_id = any(${chosen}::uuid[])`;
    const links = await sql<{ principle_id: string; authority_id: string; pinpoint: string | null }[]>`
      select principle_id, authority_id, pinpoint from legal_commons.principle_authority
      where principle_id = any(${chosen}::uuid[])`;
    const authorityIds = [...new Set(links.map((l) => l.authority_id))];
    const authorities = authorityIds.length === 0 ? [] : await sql<
      { authority_id: string; citation: string; title: string | null; url: string | null }[]
    >`select authority_id, citation, title, url from legal_commons.authority where authority_id = any(${authorityIds}::uuid[])`;

    return reply(200, {
      results: chosen.map((id) => ({
        principle_id: id,
        text: principles.find((p) => p.principle_id === id)?.text ?? null,
        authorities: links.filter((l) => l.principle_id === id).map((l) => {
          const a = authorities.find((x) => x.authority_id === l.authority_id);
          return { citation: a?.citation ?? null, title: a?.title ?? null, url: a?.url ?? null, pinpoint: l.pinpoint };
        }),
      })),
    });
  } catch {
    // Nothing from inside the pool goes back in an error.
    return reply(502, { error: "the search failed" });
  }
}, { scope: "commons:read" });
