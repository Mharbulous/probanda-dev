// key-request-status: the status of one request for Probanda's key, for the
// researcher plugin's key_request__status tool. Any caller may reach it with no
// key (serveOpen in caller.ts): the request token, which only the requesting
// computer holds, is the proof. The cloud stores only the token's SHA-256.
// It returns the status and its dates and nothing else of the request.
//
// Request:  { "request_token": 48 hex characters }
// Reply:    { "status": "pending" | "issued" | "declined", "requested_at", "decided_at" }
//           or 404 when no request has that token
//
// Nothing here logs a request body; a fault logs its SQLSTATE only.

import { reply, serveOpen } from "../_shared/caller.ts";
import { sql } from "../_shared/db.ts";

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

serveOpen(async (body) => {
  const token = body.request_token;
  if (typeof token !== "string" || !/^[0-9a-f]{48}$/.test(token)) {
    return reply(400, { error: "Which request is this, by the request token this computer saved when it sent it?" });
  }
  try {
    const [row] = await sql`select status, created_at, decided_at from access.key_request
      where token_hash = ${await sha256Hex(token)}`;
    if (!row) return reply(404, { error: "Was a request sent from this computer? None has this token." });
    return reply(200, { status: row.status, requested_at: row.created_at, decided_at: row.decided_at });
  } catch (err) {
    console.error("key-request-status: database fault", (err as { code?: unknown })?.code ?? "no code");
    return reply(502, { error: "the status could not be read" });
  }
});
