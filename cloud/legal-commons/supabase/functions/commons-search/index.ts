// commons-search: embeds the query, calls clause_search, returns its reply.
// The only one of the three functions the plugin reaches.
//
// Request:  { "text": string, "role"?: "any" | "consequence" | "element" | "exception" | "factor" | "rationale", "limit"?: number }
// Reply:    clause_search's reply, unchanged.

import { callPool, embed, reply, serve } from "../_shared/pool.ts";

serve(async (key, body) => {
  if (typeof body.text !== "string" || body.text.trim() === "") return reply(400, { error: "text is required" });
  return await callPool(key, "clause_search", {
    p_text: body.text,
    p_embedding: JSON.stringify(await embed(body.text)),
    p_role: body.role ?? "any",
    p_limit: body.limit ?? 10,
  });
});
