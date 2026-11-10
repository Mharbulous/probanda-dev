# Deferred — Authority search over captured case law

schema-context: v7.3

## Problem

The local authority corpus now captures mechanism-free loss descriptions,
relief-independent fact patterns, functional remedy descriptions, outcome/quantum
findings, and source-faithful operative order terms. The practitioner needs three
future entry modes — search by loss, fact pattern, or remedy — with enough semantic
recall to bridge different facts and labels. Exact string matching will miss those
connections, but external embeddings, vector libraries, and client-derived cloud
queries are prohibited.

The search text itself may identify a live matter through the mosaic of losses,
relationships, and intended relief. Query text must remain session-ephemeral: never
persisted in `law.sqlite`, never sent to the cloud, and never written to logs or a
recent-search cache.

## Insights

- SQLite FTS5 is available through the standard-library SQLite build and can provide
  local candidate retrieval without a dependency. Agent reranking can supply the
  semantic comparison over a bounded candidate set.
- Loss, fact-pattern, and remedy queries need separate entry modes because combining
  mechanism and loss recreates the original retrieval failure.
- Remedy matching should use functional, label-free concept descriptions plus edge
  proposition/finding text; `order_terms` supports drafting after retrieval rather
  than acting as the sole recall field.
- Quantum normalization, an outcome enum, and remedy clustering remain derivable
  from captured text and should be designed only when a real query requires them.
- Any FTS index is derived infrastructure outside the durable dump boundary. It must
  be rebuilt after restore and must not appear between the `evidence.sql` section
  markers.

## Direction (non-binding)

When the trigger fires, design fresh against the then-current schema: build an FTS5
candidate layer over the local capture fields, rerank candidates with a session-only
agent prompt, and expose explicit loss / fact-pattern / remedy modes. Keep all query
text local and ephemeral. Do not add stored search history, embeddings, or a cloud
fallback.
