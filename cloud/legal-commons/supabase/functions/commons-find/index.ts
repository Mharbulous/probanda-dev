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
// One file, unlike the other three functions, because it was deployed through
// the dashboard's editor (2026-10-13). The caller check and the model settings
// are the same as in ../_shared/pool.ts. Nothing here logs.

const SCHEMA = "legal_commons";
const URL_BASE = Deno.env.get("SUPABASE_URL");

// deno-lint-ignore no-explicit-any
const session = new (globalThis as any).Supabase.ai.Session("gte-small");

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  // Compares every byte whatever the result, so the time taken says nothing about where two keys differ.
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ (b[i % (b.length || 1)] ?? 0);
  return diff === 0;
}

/** The project's secret key the caller sent, or null when the caller sent none of them. */
function callerSecretKey(req: Request): string | null {
  const sent = req.headers.get("apikey");
  if (!sent) return null;
  const keys = Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}")) as string[];
  const encoder = new TextEncoder();
  const sentBytes = encoder.encode(sent);
  return keys.find((key) => sameBytes(encoder.encode(key), sentBytes)) ?? null;
}

async function pool(key: string, path: string, init: RequestInit = {}): Promise<unknown> {
  const profile = init.method === "POST" ? "Content-Profile" : "Accept-Profile";
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, "Content-Type": "application/json", [profile]: SCHEMA },
  });
  if (!res.ok) throw new Error(`the pool answered ${res.status}`);
  return await res.json();
}

type Hit = { tests?: { stated_in?: { principle_id: string }[] }[]; equivalent?: Hit[] };

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
  if (typeof body.text !== "string" || body.text.trim() === "") return reply(400, { error: "text is required" });
  const limit = body.limit ?? 5;
  if (!(Number.isInteger(limit) && (limit as number) >= 1 && (limit as number) <= 10)) {
    return reply(400, { error: "limit must be a whole number from 1 to 10" });
  }

  try {
    const embedding = await session.run(body.text, { mean_pool: true, normalize: true });
    const found = (await pool(key, "rpc/clause_search", {
      method: "POST",
      body: JSON.stringify({ p_text: body.text, p_embedding: JSON.stringify(embedding), p_role: "any", p_limit: 10 }),
    })) as { exact: Hit | null; nearest: Hit[] };

    // The stating principles, in the order their hits came.
    const ids: string[] = [];
    for (const hit of [...(found.exact ? [found.exact] : []), ...(found.nearest ?? [])]) {
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

    const inList = `in.(${chosen.join(",")})`;
    const principles = (await pool(key, `principle?select=principle_id,text&principle_id=${inList}`)) as
      { principle_id: string; text: string }[];
    // Two plain reads, not one embedded read: principle_authority has two
    // foreign keys to authority, so PostgREST refuses `authority(...)` as ambiguous.
    const links = (await pool(key,
      `principle_authority?select=principle_id,authority_id,pinpoint&principle_id=${inList}`)) as
      { principle_id: string; authority_id: string; pinpoint: string | null }[];
    const authorityIds = [...new Set(links.map((l) => l.authority_id))];
    const authorities = authorityIds.length === 0 ? [] : (await pool(key,
      `authority?select=authority_id,citation,title,url&authority_id=in.(${authorityIds.join(",")})`)) as
      { authority_id: string; citation: string; title: string | null; url: string | null }[];

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
});
