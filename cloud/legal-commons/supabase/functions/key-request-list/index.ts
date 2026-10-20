// key-request-list: the maintainer's read of the queue of requests for
// Probanda's key (access.key_request), for /view-key-requests through
// cloud/access/tools/key-requests.mjs. Project secret only: no install key may
// call it.
//
// Request:  {} or { "status": "pending" | "issued" | "declined" }
// Reply:    { "requests": [row, ...] }, oldest first
//
// Nothing here logs a row; a fault logs its SQLSTATE only.

import { reply, serve } from "../_shared/caller.ts";
import { sql } from "../_shared/db.ts";

const STATUSES = new Set(["pending", "issued", "declined"]);

serve(async (_key, body) => {
  const status = body.status;
  if (status !== undefined && (typeof status !== "string" || !STATUSES.has(status))) {
    return reply(400, { error: "status, when given, must be pending, issued or declined" });
  }
  try {
    const rows = await sql`select request_id, full_name, jurisdiction, year_of_call, call_date, firm_name,
        status, created_at, decided_at
      from access.key_request
      where ${status === undefined} or status = ${status ?? ""}
      order by created_at, request_id`;
    return reply(200, { requests: rows });
  } catch (err) {
    console.error("key-request-list: database fault", (err as { code?: unknown })?.code ?? "no code");
    return reply(502, { error: "the requests could not be read" });
  }
});
