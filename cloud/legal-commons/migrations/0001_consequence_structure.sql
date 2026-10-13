-- =============================================================================
-- Migration 0001: the consequence-first structure (2026-10-13)
-- =============================================================================
-- Plan: ../restructuring-plan.md. Apply once, AFTER schema.sql, functions.sql
-- and rule_periods.sql, in one paste in the SQL editor. Then apply
-- ../consequence_functions.sql. Undo with 0001_down.sql.
--
-- Additive: ten tables, one view, one function the `clause` table depends on,
-- and one field on `principle_authority`. No existing column, row or function
-- changes.
--
-- Same access model as the other pool tables: no RLS, granted to service_role
-- only ("write protection is key custody").
-- =============================================================================

begin;

-- Already installed on the pool (0.8.0, seen 2026-10-13), so this does nothing
-- there. It is here for a fresh project. 0001_down.sql leaves it in place.
create extension if not exists vector with schema extensions;

-- -----------------------------------------------------------------------------
-- tidy_clause_text: the `normalize` rule of the plugin's phrases/rank.ts, in
-- SQL: Unicode NFC, trimmed, every run of white space made one space, one
-- trailing period removed, case kept. It lives in this file, not in
-- consequence_functions.sql, because `clause.text_key` is generated from it.
--
-- The white-space set is spelled out to match JavaScript's `\s` and `trim()`:
-- tab, line feed, vertical tab, form feed, carriage return, space, U+00A0,
-- U+1680, U+2000 to U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF.
-- Postgres's own `\s` and `trim()` cover fewer characters and follow the locale.
-- Where the two versions differ on a string, rank.ts is the rule.
-- -----------------------------------------------------------------------------
create function legal_commons.tidy_clause_text(p_text text)
returns text
language sql
immutable
strict
parallel safe
as $$
  select case when right(s.t, 1) = '.' then left(s.t, -1) else s.t end
  from (
    select btrim(
      regexp_replace(
        normalize(p_text, NFC),
        E'[\t\n\u000B\f\r    -     　﻿]+',
        ' ', 'g'),
      ' ') as t
  ) s;
$$;

-- -----------------------------------------------------------------------------
-- clause: one self-contained statement. No jurisdiction, contributor or type:
-- a clause gets its type from the link that uses it.
-- -----------------------------------------------------------------------------
create table legal_commons.clause (
  clause_id   uuid primary key default gen_random_uuid(),
  text        text not null,
  text_key    text generated always as (legal_commons.tidy_clause_text(text)) stored,
  embedding   extensions.vector(384) not null,
  created_at  timestamptz not null default now(),
  constraint clause_text_key_key unique (text_key),
  constraint clause_text_key_not_empty check (text_key <> '')
);

-- -----------------------------------------------------------------------------
-- clause_part: the reading aids for one outcome inside a consequence. A clause
-- used only as a condition or a rationale has none.
-- -----------------------------------------------------------------------------
create table legal_commons.clause_part (
  clause_id      uuid not null references legal_commons.clause(clause_id),
  part_order     integer not null,
  actor          text,
  discretionary  boolean not null,
  polarity       text not null check (polarity in ('affirmative', 'negative')),
  created_at     timestamptz not null default now(),
  primary key (clause_id, part_order)
);

-- -----------------------------------------------------------------------------
-- test: one route to one consequence. Retiring marks a mistake; nothing is
-- deleted.
-- -----------------------------------------------------------------------------
create table legal_commons.test (
  test_id                uuid primary key default gen_random_uuid(),
  consequence_clause_id  uuid not null references legal_commons.clause(clause_id),
  contributor            text,                                  -- opaque per-install id, never a name
  retired_at             timestamptz,
  retired_by             text,
  retired_note           text,
  created_at             timestamptz not null default now()
);
create index idx_test_consequence on legal_commons.test (consequence_clause_id);

-- -----------------------------------------------------------------------------
-- test_clause: one condition of one test. Exactly one of clause_id and
-- points_to_test_id is filled, a pointer is allowed only on an exception, and a
-- clause appears at most once in a test. Nothing here lets a clause attach to
-- another clause. Two rules a table cannot hold are enforced by
-- contribute_decomposition: a condition is never its test's own consequence,
-- and a chain of pointers never leads back to its start.
-- -----------------------------------------------------------------------------
create table legal_commons.test_clause (
  test_id            uuid not null references legal_commons.test(test_id),
  clause_order       integer not null,
  clause_type        text not null check (clause_type in ('element', 'exception', 'factor')),
  clause_id          uuid references legal_commons.clause(clause_id),
  points_to_test_id  uuid references legal_commons.test(test_id),
  created_at         timestamptz not null default now(),
  primary key (test_id, clause_order),
  constraint test_clause_one_target check (num_nonnulls(clause_id, points_to_test_id) = 1),
  constraint test_clause_pointer_is_exception check (points_to_test_id is null or clause_type = 'exception'),
  constraint test_clause_not_itself check (points_to_test_id <> test_id),
  constraint test_clause_clause_once unique (test_id, clause_id)
);
create index idx_test_clause_clause on legal_commons.test_clause (clause_id);
create index idx_test_clause_points_to on legal_commons.test_clause (points_to_test_id);

-- -----------------------------------------------------------------------------
-- test_principle: one principle stating one test (the stated-in link).
-- principle_text_md5 is the md5 of the principle's prose when the test was
-- decomposed; the search marks the test stale when the prose has since changed.
-- obiter is left empty by this migration (plan, default 2).
-- -----------------------------------------------------------------------------
create table legal_commons.test_principle (
  test_id             uuid not null references legal_commons.test(test_id),
  principle_id        uuid not null references legal_commons.principle(principle_id),
  obiter              boolean,
  principle_text_md5  text not null,
  created_at          timestamptz not null default now(),
  primary key (test_id, principle_id)
);
create index idx_test_principle_principle on legal_commons.test_principle (principle_id);

-- -----------------------------------------------------------------------------
-- test_rationale: one clause explaining one test. A principle can give a reason
-- only for a test it states. Never a row of test_clause, so nothing that
-- compares two tests reads it.
-- -----------------------------------------------------------------------------
create table legal_commons.test_rationale (
  test_id       uuid not null,
  clause_id     uuid not null references legal_commons.clause(clause_id),
  principle_id  uuid not null,
  created_at    timestamptz not null default now(),
  primary key (test_id, clause_id, principle_id),
  constraint test_rationale_stated_in_fkey
    foreign key (test_id, principle_id) references legal_commons.test_principle(test_id, principle_id)
);
create index idx_test_rationale_clause on legal_commons.test_rationale (clause_id);
create index idx_test_rationale_stated_in on legal_commons.test_rationale (test_id, principle_id);

-- -----------------------------------------------------------------------------
-- meaning_verdict: one judgment on two clauses. clause_a is always the smaller
-- id, so a pair has one form. A pair may have many verdicts, and a verdict that
-- says "different" is stored like any other. created_at uses the wall clock,
-- not the transaction's start, so "the latest person's verdict" is well defined
-- for verdicts stored in one call.
-- -----------------------------------------------------------------------------
create table legal_commons.meaning_verdict (
  verdict_id            uuid primary key default gen_random_uuid(),
  clause_a              uuid not null references legal_commons.clause(clause_id),
  clause_b              uuid not null references legal_commons.clause(clause_id),
  a_implies_b           boolean not null,
  b_implies_a           boolean not null,
  judge_kind            text not null check (judge_kind in ('person', 'model')),
  judge_model           text,
  judge_prompt_version  text,
  contributor           text,
  retired_at            timestamptz,
  retired_by            text,
  retired_note          text,
  created_at            timestamptz not null default clock_timestamp(),
  constraint meaning_verdict_one_form check (clause_a < clause_b),
  constraint meaning_verdict_model_named check (
    judge_kind <> 'model' or (judge_model is not null and judge_prompt_version is not null))
);
create index idx_meaning_verdict_pair on legal_commons.meaning_verdict (clause_a, clause_b);
create index idx_meaning_verdict_b on legal_commons.meaning_verdict (clause_b);

-- -----------------------------------------------------------------------------
-- clause_pair_state: one state per pair, from its live verdicts. If a person has
-- judged the pair, the latest person's verdict decides. Otherwise `equivalent`
-- when every verdict says both directions hold, `different` when none does, and
-- `conflict` when they disagree. The count of contributors is never used.
-- -----------------------------------------------------------------------------
create view legal_commons.clause_pair_state
with (security_invoker = true)
as
with live as (
  select v.clause_a, v.clause_b, v.judge_kind, v.created_at, v.verdict_id,
         (v.a_implies_b and v.b_implies_a) as both_ways
  from legal_commons.meaning_verdict v
  where v.retired_at is null
),
person as (
  select distinct on (l.clause_a, l.clause_b) l.clause_a, l.clause_b, l.both_ways
  from live l
  where l.judge_kind = 'person'
  order by l.clause_a, l.clause_b, l.created_at desc, l.verdict_id desc
),
pair as (
  select l.clause_a, l.clause_b, bool_and(l.both_ways) as all_both, bool_or(l.both_ways) as any_both
  from live l
  group by l.clause_a, l.clause_b
)
select
  pair.clause_a,
  pair.clause_b,
  case
    when person.clause_a is not null then case when person.both_ways then 'equivalent' else 'different' end
    when pair.all_both then 'equivalent'
    when not pair.any_both then 'different'
    else 'conflict'
  end as state,
  (person.clause_a is not null) as decided_by_person
from pair
left join person on person.clause_a = pair.clause_a and person.clause_b = pair.clause_b;

-- -----------------------------------------------------------------------------
-- embedding_fingerprint: which model made the embeddings. One row: the model's
-- name, one fixed sentence and that sentence's embedding.
-- -----------------------------------------------------------------------------
create table legal_commons.embedding_fingerprint (
  only_row    boolean primary key default true check (only_row),
  model       text not null,
  sentence    text not null,
  embedding   extensions.vector(384) not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- clause_embedding_staging: new embeddings waiting for a change of model. They
-- arrive a batch at a time (stage_clause_embeddings), because one Edge Function
-- request cannot embed a whole pool, and each row keeps the fingerprint its
-- batch came with. set_clause_embeddings moves all of them into `clause` at
-- once and empties this table. Nothing reads a staged embedding before then.
-- -----------------------------------------------------------------------------
create table legal_commons.clause_embedding_staging (
  clause_id    uuid primary key references legal_commons.clause(clause_id),
  embedding    extensions.vector(384) not null,
  fingerprint  extensions.vector(384) not null,
  created_at   timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- conversion_record: what became of each old row. Either a target or a reason
-- is filled. criterion_id is empty for a record about the principle as a whole.
-- Written by contribute_decomposition in the same transaction as the tests.
-- -----------------------------------------------------------------------------
create table legal_commons.conversion_record (
  record_id     uuid primary key default gen_random_uuid(),
  principle_id  uuid not null references legal_commons.principle(principle_id),
  criterion_id  uuid references legal_commons.criterion(criterion_id),
  test_id       uuid references legal_commons.test(test_id),
  clause_id     uuid references legal_commons.clause(clause_id),
  reason        text,
  created_at    timestamptz not null default now(),
  constraint conversion_record_target_or_reason check (num_nonnulls(test_id, clause_id, reason) > 0)
);
create index idx_conversion_record_principle on legal_commons.conversion_record (principle_id);
create index idx_conversion_record_criterion on legal_commons.conversion_record (criterion_id);
create index idx_conversion_record_test on legal_commons.conversion_record (test_id);
create index idx_conversion_record_clause on legal_commons.conversion_record (clause_id);

-- -----------------------------------------------------------------------------
-- The one change to an existing table. Empty on every existing row.
-- -----------------------------------------------------------------------------
alter table legal_commons.principle_authority add column pinpoint text;

-- -----------------------------------------------------------------------------
-- Grants: service_role only. A function is executable by every role unless that
-- default is withdrawn, so it is withdrawn here.
-- -----------------------------------------------------------------------------
revoke execute on function legal_commons.tidy_clause_text(text) from public;
grant execute on function legal_commons.tidy_clause_text(text) to service_role;
grant all on legal_commons.clause to service_role;
grant all on legal_commons.clause_part to service_role;
grant all on legal_commons.test to service_role;
grant all on legal_commons.test_clause to service_role;
grant all on legal_commons.test_principle to service_role;
grant all on legal_commons.test_rationale to service_role;
grant all on legal_commons.meaning_verdict to service_role;
grant all on legal_commons.embedding_fingerprint to service_role;
grant all on legal_commons.clause_embedding_staging to service_role;
grant all on legal_commons.conversion_record to service_role;
grant select on legal_commons.clause_pair_state to service_role;

commit;

notify pgrst, 'reload schema';
