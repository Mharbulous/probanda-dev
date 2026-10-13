// commons-reembed: embeds every clause and the fixed sentence, then calls
// set_clause_embeddings once. Run from Probanda's development machine only: to
// store the first fingerprint while the pool has no clause, and again after any
// change of model. It must finish inside one run.
//
// Request:  {}
// Reply:    set_clause_embeddings's reply, unchanged.

import { allClauses, callPool, embed, FINGERPRINT_SENTENCE, MODEL, serve } from "../_shared/pool.ts";

serve(async (key) => {
  const rows = [];
  for (const clause of await allClauses(key)) {
    rows.push({ clause_id: clause.clause_id, embedding: await embed(clause.text) });
  }
  return await callPool(key, "set_clause_embeddings", {
    p_rows: rows,
    p_fingerprint: { model: MODEL, sentence: FINGERPRINT_SENTENCE, embedding: await embed(FINGERPRINT_SENTENCE) },
  });
});
