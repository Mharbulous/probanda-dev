// items-write: checks and applies one practice write (rules.apply_write).
//
// Request:  { "tenant", "write_id", "store": "practice", "tool", "intent", "ops": [op] }
// Reply:    { "saved": true, "ops": [ { "id", "saved", "as" } ], "seq" }
//           or { "saved": false, "question" }
// A repeated write_id gets the stored reply unchanged. Nothing here logs.

import { type Json, serveItems, tenantOf } from "../_shared/items.ts";

serveItems((body) => {
  const { tenant: _tenant, ...write } = body;
  return (tx) => tx`select rules.apply_write(${tenantOf(body)}::uuid, ${tx.json(write as Json)}) as result`;
});
