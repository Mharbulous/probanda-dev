// items-sync: every item of a tenant's store changed after a sequence number
// (rules.sync).
//
// Request:  { "tenant", "store", "since"?: whole number, 0 when absent }
// Reply:    { "items": [ { "id", "kind", "state", "tags", "links", "deleted" } ], "seq" }
//           or { "saved": false, "question" }
// Nothing here logs.

import { refuse, serveItems, tenantOf } from "../_shared/items.ts";

serveItems((body) => {
  const tenant = tenantOf(body);
  if (!tenant) return refuse("Which practice is this sync for? No tenant was given.");
  const since = body.since ?? null;
  if (since !== null && !(Number.isSafeInteger(since) && (since as number) >= 0)) {
    return refuse("From which point should this sync start? since is not a whole number.");
  }
  const store = typeof body.store === "string" ? body.store : null;
  return (tx) => tx`select rules.sync(${tenant}::uuid, ${store}::text, ${since}::bigint) as result`;
});
