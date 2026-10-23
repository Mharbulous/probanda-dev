-- =============================================================================
-- Migration 0003: retire rule-period corroboration (2026-10-23, #119)
-- =============================================================================
-- Rule periods have one current row per key, latest wins, and no reader sees a
-- status, a re-check or who contributed a row (lawyer-only-access plan §7 rules
-- 7 and 15). This replaces `rule_periods_find` with the body in
-- ../rule_periods.sql, drops `rule_periods_record_verification`, then drops the
-- `rule_period_verification` table and every row in it. Apply once, in one
-- paste in the SQL editor.
--
-- It refuses to run, changing nothing, when any other function still mentions
-- `rule_period_verification`, because Postgres does not track which function
-- bodies use a table and such a function would fail only when next called. A
-- view that uses the table makes the drop itself fail, which also changes
-- nothing (no cascade). The live body of the old `rule_periods_find` was never
-- recorded, so it is replaced without a drift check.
--
-- No undo file: the dropped re-checks cannot come back. To restore the old
-- reader and writer, re-apply ../rule_periods.sql at commit 0c7c7286^.
-- =============================================================================

begin;

do $$
declare
  v_others text;
begin
  select string_agg(n.nspname || '.' || p.proname, ', ') into v_others
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.prosrc ilike '%rule_period_verification%'
    and n.nspname not in ('pg_catalog', 'information_schema')
    and p.oid not in (
      'legal_commons.rule_periods_find(text,text,text,text,text)'::regprocedure,
      'legal_commons.rule_periods_record_verification(uuid,text,boolean,text)'::regprocedure);
  if v_others is not null then
    raise exception 'these functions still mention rule_period_verification: %', v_others;
  end if;
end;
$$;

create or replace function legal_commons.rule_periods_find(
  p_jurisdiction text,
  p_enactment_citation text,
  p_amending_reg text default null,
  p_rule_ref text default null,
  p_deadline_type text default null
)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'rule_period_id', c.rule_period_id,
    'contributed_at', c.contributed_at,
    'record', c.record,
    'retired_at', c.retired_at,
    'retire_reason', c.retire_reason,
    'shipped_version', c.shipped_version
  ) order by c.rule_ref, c.deadline_type, c.effective_from), '[]'::jsonb)
  from (
    select distinct on (r.rule_ref, r.deadline_type, r.effective_from) r.*
    from legal_commons.rule_period r
    where r.jurisdiction = p_jurisdiction
      and r.enactment_citation = p_enactment_citation
      and (p_rule_ref is null or r.rule_ref = p_rule_ref)
      and (p_deadline_type is null or r.deadline_type = p_deadline_type)
    order by r.rule_ref, r.deadline_type, r.effective_from,
             r.retired_at is not null, r.contributed_at desc, r.rule_period_id
  ) c
  where p_amending_reg is null or c.amending_reg = p_amending_reg;
$$;

drop function legal_commons.rule_periods_record_verification(uuid, text, boolean, text);

drop table legal_commons.rule_period_verification;

commit;

notify pgrst, 'reload schema';
