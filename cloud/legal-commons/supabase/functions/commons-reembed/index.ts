// commons-reembed: re-embeds the pool for a change of model, a batch per
// request, because one request may use 2 seconds of CPU time and cannot embed a
// whole pool. Run from Probanda's development machine only (tools/reembed.mjs
// makes the calls in order).
//
// A batch:   { "after"?: clause id, "limit"?: 1 to 100, 10 unless told otherwise }
//   embeds the next clauses in id order and the fixed sentence, and stages them
//   (stage_clause_embeddings). Nothing the search reads changes.
//   Reply: { "saved": true, "staged": n, "next": the last clause id, or null when no clause is left }
//          or stage_clause_embeddings's reply when it saved nothing.
//
// The end:   { "finish": true }
//   embeds the fixed sentence and calls set_clause_embeddings, which moves every
//   staged embedding in at once with the new fingerprint, or refuses. While the
//   pool has no clause this stores the first fingerprint.
//   Reply: set_clause_embeddings's reply, unchanged.
//
// A check:   { "embed": [1 to 100 texts] }
//   embeds the texts and returns the embeddings. Reads and writes nothing. It is
//   how the hosted model is compared with a local one, and how many embeddings
//   fit in one request is measured.
//   Reply: { "embeddings": [[384 numbers], ...] }

import { callPool, clausesAfter, embed, FINGERPRINT_SENTENCE, MODEL, reply, serve } from "../_shared/pool.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

serve(async (key, body) => {
  if (body.embed !== undefined) {
    const texts = body.embed;
    if (!(Array.isArray(texts) && texts.length >= 1 && texts.length <= 100 &&
          texts.every((text) => typeof text === "string" && text.trim() !== ""))) {
      return reply(400, { error: "embed must be a list of 1 to 100 texts" });
    }
    const embeddings = [];
    for (const text of texts) embeddings.push(await embed(text));
    return reply(200, { embeddings });
  }

  const fingerprint = await embed(FINGERPRINT_SENTENCE);

  if (body.finish === true) {
    return await callPool(key, "set_clause_embeddings", {
      p_fingerprint: { model: MODEL, sentence: FINGERPRINT_SENTENCE, embedding: fingerprint },
    });
  }

  const after = body.after ?? null;
  if (after !== null && !(typeof after === "string" && UUID.test(after))) {
    return reply(400, { error: "after must be a clause id" });
  }
  const limit = body.limit ?? 10;
  if (!(Number.isInteger(limit) && (limit as number) >= 1 && (limit as number) <= 100)) {
    return reply(400, { error: "limit must be a whole number from 1 to 100" });
  }

  const clauses = await clausesAfter(key, after, limit as number);
  if (clauses.length === 0) return reply(200, { saved: true, staged: 0, next: null });

  const rows = [];
  for (const clause of clauses) rows.push({ clause_id: clause.clause_id, embedding: await embed(clause.text) });

  const res = await callPool(key, "stage_clause_embeddings", { p_rows: rows, p_fingerprint: fingerprint });
  if (!res.ok) return res;
  const staged = await res.json();
  if (staged.saved !== true) return reply(200, staged);
  return reply(200, {
    saved: true,
    staged: staged.staged,
    next: clauses.length < (limit as number) ? null : clauses[clauses.length - 1].clause_id,
  });
});
