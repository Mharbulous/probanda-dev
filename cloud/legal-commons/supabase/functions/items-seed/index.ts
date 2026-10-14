// items-seed: records a tenant's existing items once (rules.seed).
//
// Request:  { "tenant", "store": "practice", "items": [ { "id", "kind", "state", "tags", "links", "hashes", "cross" } ] }
// Reply:    { "seeded", "questions": [ { "id", "question" } ] }
// A tenant that already holds items seeds nothing. Nothing here logs.

import { type Json, serveItems, tenantOf } from "../_shared/items.ts";

serveItems((body) => {
  const store = typeof body.store === "string" ? body.store : null;
  const items = body.items ?? null;
  return (tx) => tx`select rules.seed(${tenantOf(body)}::uuid, ${store}::text, ${tx.json(items as Json)}) as result`;
});
