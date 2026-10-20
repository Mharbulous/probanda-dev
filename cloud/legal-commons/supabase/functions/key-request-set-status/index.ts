// key-request-set-status: records the outcome of one request for Probanda's key
// (access.key_request), once, after Brahm has minted and delivered the key or
// decided not to. Project secret only. The details the practitioner typed are
// cleared in the same statement: they were held only to verify and contact the
// person (Account Information, COMMANDMENTS.md, Commandment 2), and that is done.
//
// Request:  { "request_id": uuid, "status": "issued" | "declined" }
// Reply:    { "saved": true } or 409 when the request is not pending
//
// Nothing here logs a row; a fault logs its SQLSTATE only.

import { reply, serve } from "../_shared/caller.ts";
import { sql } from "../_shared/db.ts";

const OUTCOMES = new Set(["issued", "declined"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (_key, body) => {
  const id = body.request_id;
  const status = body.status;
  if (typeof id !== "string" || !UUID.test(id) || typeof status !== "string" || !OUTCOMES.has(status)) {
    return reply(400, { error: "request_id must be a request's uuid and status must be issued or declined" });
  }
  try {
    const rows = await sql`update access.key_request
      set status = ${status}, decided_at = now(),
          full_name = null, year_of_call = null, call_date = null, firm_name = null, email = null, phone = null
      where request_id = ${id}::uuid and status = 'pending'
      returning request_id`;
    if (rows.length === 0) return reply(409, { error: "no pending request has that request_id" });
    return reply(200, { saved: true });
  } catch (err) {
    console.error("key-request-set-status: database fault", (err as { code?: unknown })?.code ?? "no code");
    return reply(502, { error: "the status was not saved" });
  }
});
