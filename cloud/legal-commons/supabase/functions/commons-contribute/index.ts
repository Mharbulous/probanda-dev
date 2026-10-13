// commons-contribute: embeds each clause text and the fixed sentence, then calls
// contribute_decomposition. Run from Probanda's development machine only.
//
// Request:  { "contributor": string, "payload": the payload contribute_decomposition takes,
//             without its "fingerprint" and without any "embedding" }
// Reply:    contribute_decomposition's reply, unchanged.

import { callPool, embed, FINGERPRINT_SENTENCE, reply, serve } from "../_shared/pool.ts";

type Item = Record<string, unknown>;

serve(async (key, body) => {
  const payload = body.payload as Item | undefined;
  if (!payload || typeof payload !== "object") return reply(400, { error: "payload is required" });

  // Every statement the payload carries: each consequence, each condition that has wording, each rationale.
  const tests = (payload.tests as Item[] | undefined) ?? [];
  const items: Item[] = [
    ...tests.map((t) => t.consequence as Item),
    ...tests.flatMap((t) => (t.clauses as Item[] | undefined) ?? []),
    ...((payload.rationales as Item[] | undefined) ?? []),
  ].filter((item) => item && typeof item.text === "string");

  for (const item of items) item.embedding = await embed(item.text as string);
  payload.fingerprint = await embed(FINGERPRINT_SENTENCE);

  return await callPool(key, "contribute_decomposition", {
    p_payload: payload,
    p_contributor: body.contributor ?? null,
  });
});
