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
-- (jurisdiction, enactment_citation, rule_ref, deadline_type, effective_from);
-- several contributors may hold different rows for one key, and the pool never
-- picks a winner.
--
-- Status is derived on read (rule_periods_find), never stored, except
-- retirement. `content_hash` is computed by the runtime over the record's
-- operative fields; two live rows for one key with different hashes make that
-- key disputed.
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

create table if not exists legal_commons.rule_period_verification (
  rule_period_id     uuid not null references legal_commons.rule_period(rule_period_id),
  verifier           text not null,                            -- opaque per-install id
  verified_at        timestamptz not null default now(),
  source_fetched_at  text not null,
  quote_matched      boolean not null,
  primary key (rule_period_id, verifier)                       -- a verifier's latest check replaces its earlier one
);

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
-- rule_periods_find — rows for one enactment, optionally narrowed, each with its
-- derived status and its verifications. Retired rows are returned too, marked.
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
    'rule_period_id', r.rule_period_id,
    'status', case
      when r.retired_at is not null then 'retired'
      when exists (
        select 1 from legal_commons.rule_period o
        where o.retired_at is null
          and o.rule_period_id <> r.rule_period_id
          and o.jurisdiction = r.jurisdiction
          and o.enactment_citation = r.enactment_citation
          and o.rule_ref = r.rule_ref
          and o.deadline_type = r.deadline_type
          and o.effective_from is not distinct from r.effective_from
          and o.content_hash <> r.content_hash
      ) then 'disputed'
      when exists (
        select 1 from legal_commons.rule_period_verification v
        where v.rule_period_id = r.rule_period_id and v.quote_matched and v.verifier <> r.contributor
      ) then 'corroborated'
      else 'proposed'
    end,
    'contributor', r.contributor,
    'contributed_at', r.contributed_at,
    'record', r.record,
    'verifications', coalesce((
      select jsonb_agg(jsonb_build_object(
        'verifier', v.verifier,
        'verified_at', v.verified_at,
        'source_fetched_at', v.source_fetched_at,
        'quote_matched', v.quote_matched
      ) order by v.verified_at)
      from legal_commons.rule_period_verification v where v.rule_period_id = r.rule_period_id
    ), '[]'::jsonb),
    'retired_at', r.retired_at,
    'retire_reason', r.retire_reason,
    'shipped_version', r.shipped_version
  ) order by r.rule_ref, r.deadline_type, r.effective_from, r.contributed_at), '[]'::jsonb)
  from legal_commons.rule_period r
  where r.jurisdiction = p_jurisdiction
    and r.enactment_citation = p_enactment_citation
    and (p_amending_reg is null or r.amending_reg = p_amending_reg)
    and (p_rule_ref is null or r.rule_ref = p_rule_ref)
    and (p_deadline_type is null or r.deadline_type = p_deadline_type);
$$;

-- -----------------------------------------------------------------------------
-- rule_periods_record_verification — a verifier's live re-check of one row
-- against its primary source. Upserts: the verifier's latest check stands.
-- -----------------------------------------------------------------------------
create or replace function legal_commons.rule_periods_record_verification(
  p_id uuid,
  p_verifier text,
  p_quote_matched boolean,
  p_source_fetched_at text
)
returns jsonb
language plpgsql
as $$
begin
  perform 1 from legal_commons.rule_period r where r.rule_period_id = p_id;
  if not found then
    raise exception 'no pooled rule period %', p_id;
  end if;

  insert into legal_commons.rule_period_verification (rule_period_id, verifier, source_fetched_at, quote_matched)
  values (p_id, p_verifier, p_source_fetched_at, p_quote_matched)
  on conflict (rule_period_id, verifier) do update set
    verified_at = now(),
    source_fetched_at = excluded.source_fetched_at,
    quote_matched = excluded.quote_matched;

  return jsonb_build_object('rule_period_id', p_id, 'recorded', true, 'quote_matched', p_quote_matched);
end;
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
grant all on legal_commons.rule_period_verification to service_role;
grant execute on function legal_commons.rule_periods_push(jsonb, text) to service_role;
grant execute on function legal_commons.rule_periods_find(text, text, text, text, text) to service_role;
grant execute on function legal_commons.rule_periods_record_verification(uuid, text, boolean, text) to service_role;
grant execute on function legal_commons.rule_periods_retire(uuid, text, text, text) to service_role;
notify pgrst, 'reload schema';
