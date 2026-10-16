-- =============================================================================
-- Exception gaps: pairs of records that state one test with different exceptions
-- =============================================================================
-- Lists each pair of live records (test rows with no retired date) that have
-- the same consequence clause and the same set of element and factor clauses,
-- but different sets of exceptions. A test is the consequence with its elements
-- and factors, and its exceptions are not part of it. So such a pair states one test,
-- and one of the two may have left out an exception the other states.
-- contribute_decomposition reuses a record only when every condition matches,
-- so such pairs are stored apart and nobody is told.
--
-- Matching is by id only. Equivalent pairs are not followed.
--
-- One row per pair, the smaller test_id first: both record ids, each record's
-- stating principle ids, and the exceptions each record has that the other
-- lacks, each labelled {"clause_id": ...} or {"points_to_test_id": ...}.
--
-- It only reads: one SELECT, no write and no change to any table. A person
-- reviews each pair it lists. Run in the SQL editor after each batch of
-- decompositions.
-- =============================================================================

with live as (
  select
    t.test_id,
    t.consequence_clause_id,
    coalesce((
      select array_agg(tc.clause_id order by tc.clause_id)
      from legal_commons.test_clause tc
      where tc.test_id = t.test_id and tc.clause_type in ('element', 'factor')
    ), '{}') as element_factor_ids,
    coalesce((
      select jsonb_agg(
               case when tc.clause_id is not null
                    then jsonb_build_object('clause_id', tc.clause_id)
                    else jsonb_build_object('points_to_test_id', tc.points_to_test_id) end
               order by tc.clause_id, tc.points_to_test_id)
      from legal_commons.test_clause tc
      where tc.test_id = t.test_id and tc.clause_type = 'exception'
    ), '[]'::jsonb) as exceptions
  from legal_commons.test t
  where t.retired_at is null
)
select
  a.test_id as first_test_id,
  b.test_id as second_test_id,
  (select array_agg(tp.principle_id order by tp.principle_id)
   from legal_commons.test_principle tp where tp.test_id = a.test_id) as first_stated_in,
  (select array_agg(tp.principle_id order by tp.principle_id)
   from legal_commons.test_principle tp where tp.test_id = b.test_id) as second_stated_in,
  (select coalesce(jsonb_agg(x.value order by x.value::text), '[]'::jsonb)
   from jsonb_array_elements(a.exceptions) x
   where not exists (select 1 from jsonb_array_elements(b.exceptions) y where y.value = x.value)
  ) as exceptions_only_in_first,
  (select coalesce(jsonb_agg(x.value order by x.value::text), '[]'::jsonb)
   from jsonb_array_elements(b.exceptions) x
   where not exists (select 1 from jsonb_array_elements(a.exceptions) y where y.value = x.value)
  ) as exceptions_only_in_second
from live a
join live b
  on a.test_id < b.test_id
 and a.consequence_clause_id = b.consequence_clause_id
 and a.element_factor_ids = b.element_factor_ids
 and a.exceptions <> b.exceptions
order by a.test_id, b.test_id;
