-- =============================================================================
-- Court-rule periods in the pool (2026-10-05)
-- =============================================================================
-- Spec: planning/1. Design/2026-10-05_legal-commons-court-rule-sharing-spec.md.
-- Apply AFTER schema.sql and functions.sql, into the same Supabase project, in
-- one paste in the SQL editor. Idempotent — safe to re-run.
--
-- One `rule_period` row per pushed overlay record (rule-overlay spec §6). The
-- whole record is kept as JSON beside the extracted key columns, so a change to
-- the record shape needs no column change. The key is
-- (jurisdiction, enactment_citation, rule_ref, deadline_type, effective_from).
-- A key may hold several rows; rule_periods_find serves only its current one:
-- the latest live row, else the latest retired row (lawyer-only-access plan §7
-- rule 15, #119).
--
-- Only retirement is stored. `content_hash` is computed by the runtime over the
-- record's operative fields; a push with a new hash for a key adds a new row.
--
-- Same access model as the other pool tables: no RLS, granted to service_role
-- only (functions.sql bottom — "write protection is key custody").
-- =============================================================================

-- =============================================================================
-- OBSERVED LIVE ON THE POOL (2026-10-05) — by RPC probe, not by applying it
-- =============================================================================
-- Who pasted this file into the pool project, and when, is not recorded. On
-- 2026-10-05 the plugin's own tools, with the stored sb_secret_ key, got:
-- `rule_periods_find` with a synthetic jurisdiction/enactment -> [];
-- `rule_periods_record_verification` and `rule_periods_retire` with id
-- 00000000-0000-0000-0000-000000000000 -> the "no pooled rule period"
-- exception. So those three functions exist, are in PostgREST's schema cache,
-- and service_role can execute them and select from `rule_period`.
-- `rule_periods_record_verification` and its `rule_period_verification` table
-- are no longer in this file: migrations/0003 drops them (#119). It was applied
-- through the SQL editor on 2026-10-23; afterwards `rule_periods_find` answered
-- [] for a synthetic enactment and for CA-BC / B.C. Reg. 168/2009.
-- NOT CHECKED: `rule_periods_push`; the insert/update grants on both tables
-- (each probe raises before its write); the two indexes; RLS. Live `prosrc`
-- was not diffed against this file, unlike functions.sql's 2026-09-13 block.
-- =============================================================================

set search_path = legal_commons, extensions, public;

create table if not exists legal_commons.rule_period (
  rule_period_id      uuid primary key default gen_random_uuid(),
  jurisdiction        text not null,
  enactment_citation  text not null,
  rule_ref            text not null,
  deadline_type       text not null,
  effective_from      date,                                    -- null on a closing record with no start
  amending_reg        text not null,
  content_hash        text not null,
  record              jsonb not null,                          -- the overlay record, local fields stripped
  contributor         text not null,                           -- opaque per-install id, never a name
  contributed_at      timestamptz not null default now(),
  retired_at          timestamptz,
  retired_by          text,
  retire_reason       text,
  shipped_version     text                                     -- plugin version that now ships the row
);

-- Identical content for one key is held once while live.
create unique index if not exists uq_rule_period_live_content on legal_commons.rule_period (
  jurisdiction, enactment_citation, rule_ref, deadline_type,
  coalesce(effective_from, '-infinity'::date), content_hash
) where retired_at is null;
create index if not exists idx_rule_period_amending on legal_commons.rule_period (jurisdiction, enactment_citation, amending_reg);

-- -----------------------------------------------------------------------------
-- rule_periods_push — one transaction for the whole batch. Each element carries
-- the key columns, amending_reg, content_hash and record. A live row with the
-- same key and content is reused, not duplicated.
-- -----------------------------------------------------------------------------
create or replace function legal_commons.rule_periods_push(p_records jsonb, p_contributor text)
returns jsonb
language plpgsql
as $$
declare
  v_rec jsonb;
  v_id uuid;
  v_out jsonb := '[]'::jsonb;
begin
  for v_rec in select value from jsonb_array_elements(coalesce(p_records, '[]'::jsonb)) loop
    select r.rule_period_id into v_id
    from legal_commons.rule_period r
    where r.retired_at is null
      and r.jurisdiction = v_rec->>'jurisdiction'
      and r.enactment_citation = v_rec->>'enactment_citation'
      and r.rule_ref = v_rec->>'rule_ref'
      and r.deadline_type = v_rec->>'deadline_type'
      and r.effective_from is not distinct from (v_rec->>'effective_from')::date
      and r.content_hash = v_rec->>'content_hash'
    limit 1;

    if v_id is null then
      insert into legal_commons.rule_period
        (jurisdiction, enactment_citation, rule_ref, deadline_type, effective_from, amending_reg, content_hash, record, contributor)
      values (
        v_rec->>'jurisdiction', v_rec->>'enactment_citation', v_rec->>'rule_ref', v_rec->>'deadline_type',
        (v_rec->>'effective_from')::date, v_rec->>'amending_reg', v_rec->>'content_hash', v_rec->'record',
        p_contributor
      )
      returning rule_period_id into v_id;
      v_out := v_out || jsonb_build_object('rule_period_id', v_id, 'rule_ref', v_rec->>'rule_ref', 'pooled', 'new');
    else
      v_out := v_out || jsonb_build_object('rule_period_id', v_id, 'rule_ref', v_rec->>'rule_ref', 'pooled', 'already_pooled');
    end if;
  end loop;
  return v_out;
end;
$$;

-- -----------------------------------------------------------------------------
-- rule_periods_find — one current row per key for one enactment, optionally
-- narrowed (lawyer-only-access plan §7 rule 15, #119). The current row is the
-- latest live row, else the latest retired row, which `retired_at` marks. It is
-- chosen over every row of the key before the amending_reg filter, so that
-- filter never brings back a row a later one replaced. No status, verification
-- or contributor is returned (§7 rule 7).
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- rule_periods_retire — the contributor may retire its own row; anyone may
-- retire a row by naming the shipped plugin version that now covers it.
-- -----------------------------------------------------------------------------
create or replace function legal_commons.rule_periods_retire(
  p_id uuid,
  p_caller text,
  p_reason text,
  p_shipped_version text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_row legal_commons.rule_period%rowtype;
begin
  select * into v_row from legal_commons.rule_period r where r.rule_period_id = p_id;
  if not found then
    raise exception 'no pooled rule period %', p_id;
  end if;
  if v_row.retired_at is not null then
    raise exception 'rule period % is already retired', p_id;
  end if;
  if v_row.contributor <> p_caller and p_shipped_version is null then
    raise exception 'only the contributor may retire rule period % without naming the shipped version that covers it', p_id;
  end if;

  update legal_commons.rule_period
  set retired_at = now(), retired_by = p_caller, retire_reason = p_reason, shipped_version = p_shipped_version
  where rule_period_id = p_id;

  return jsonb_build_object('rule_period_id', p_id, 'retired', true);
end;
$$;

-- Grants: the same service_role-only model as functions.sql. Re-stated here so
-- this file is complete on its own against the live pool.
grant all on legal_commons.rule_period to service_role;
grant execute on function legal_commons.rule_periods_push(jsonb, text) to service_role;
grant execute on function legal_commons.rule_periods_find(text, text, text, text, text) to service_role;
grant execute on function legal_commons.rule_periods_retire(uuid, text, text, text) to service_role;
notify pgrst, 'reload schema';
