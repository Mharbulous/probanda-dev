-- =============================================================================
-- Undo migration 0001 and consequence_functions.sql (2026-10-13)
-- =============================================================================
-- Removes exactly what 0001_consequence_structure.sql and
-- consequence_functions.sql add, and nothing else. The `vector` extension was
-- installed before the migration and stays. Every statement names its object
-- and none cascades, so a dependency this file does not know about stops the
-- script instead of being dropped with it.
--
-- The rows of the nine tables go with the tables. No existing table loses a
-- row; `principle_authority` loses the `pinpoint` field and what it held.
-- =============================================================================

begin;

drop function if exists legal_commons.clause_search(text, extensions.vector, text, integer);
drop function if exists legal_commons.contribute_decomposition(jsonb, text);
drop function if exists legal_commons.contribute_verdicts(jsonb, text);
drop function if exists legal_commons.retire(text, uuid, text, text);
drop function if exists legal_commons.set_clause_embeddings(jsonb, jsonb);

alter table legal_commons.principle_authority drop column pinpoint;

drop view legal_commons.clause_pair_state;
drop table legal_commons.conversion_record;
drop table legal_commons.embedding_fingerprint;
drop table legal_commons.meaning_verdict;
drop table legal_commons.test_rationale;
drop table legal_commons.test_principle;
drop table legal_commons.test_clause;
drop table legal_commons.test;
drop table legal_commons.clause_part;
drop table legal_commons.clause;
drop function legal_commons.tidy_clause_text(text);

commit;

notify pgrst, 'reload schema';
