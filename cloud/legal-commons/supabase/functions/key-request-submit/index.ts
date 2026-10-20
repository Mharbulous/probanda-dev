// key-request-submit: queues one practitioner's request for Probanda's key, for
// the researcher plugin's key_request__submit tool. Any caller may reach it with
// no key, because the person asking has none yet (serveOpen in caller.ts). It
// inserts one row into access.key_request and never reads one back. Brahm lists
// the queue with key-request-list, mints the key and delivers it out of band,
// and records the outcome with key-request-set-status. The practitioner checks
// it with key-request-status, by the request token only their computer holds.
//
// Request:  { "full_name": text, "jurisdiction": "BC", "year_of_call": integer,
//             "call_date"?: "YYYY-MM-DD", "firm_name": text, "email": text,
//             "phone"?: text, "token_hash": hex SHA-256 }
// Reply:    { "request_id": uuid }
//
// It holds only what verifying that a person is a practising lawyer requires,
// plus the email and phone Brahm uses to contact the applicant: Account
// Information (COMMANDMENTS.md, Commandment 2; shape.ts). At most MAX_PER_DAY requests are
// queued in a day, so a flood cannot bury the queue. Nothing here logs a
// request body; a fault logs its SQLSTATE only.

import { reply, serveOpen } from "../_shared/caller.ts";
import { sql } from "../_shared/db.ts";
import { checkRequest } from "./shape.ts";

const MAX_PER_DAY = 50;

serveOpen(async (body) => {
  const checked = checkRequest(body);
  if ("question" in checked) return reply(400, { error: checked.question });
  const r = checked.ok;
  try {
    const [{ queued }] = await sql`select count(*)::int as queued from access.key_request
      where created_at > now() - interval '1 day'`;
    if (queued >= MAX_PER_DAY) return reply(429, { error: "Can this request wait until tomorrow?" });
    const [row] = await sql`insert into access.key_request
        (token_hash, full_name, jurisdiction, year_of_call, call_date, firm_name, email, phone)
      values (${r.token_hash}, ${r.full_name}, ${r.jurisdiction}, ${r.year_of_call}, ${r.call_date}, ${r.firm_name},
        ${r.email}, ${r.phone})
      on conflict (token_hash) do nothing
      returning request_id`;
    if (!row) return reply(409, { error: "Was this request already sent? Ask for a new link to send another." });
    return reply(200, { request_id: row.request_id });
  } catch (err) {
    console.error("key-request-submit: database fault", (err as { code?: unknown })?.code ?? "no code");
    return reply(502, { error: "the request was not saved" });
  }
});
