-- =============================================================================
-- PROVENANCE (2026-07-18)
-- =============================================================================
-- Recovered from `3bdd492^:planning/3. Staging/legal-commons-schema.sql`. That
-- copy was deleted 2026-07-14 in a staging tidy-up — NOT superseded — leaving
-- this plugin with no DDL in-repo. `3bdd492` is the last commit to touch it, so
-- this is the final authored state, not a mid-stream draft.
--
-- Re-materialized here to replace the dead byte-identical pre-B5 carryover
-- that previously occupied this path (22 matter-scoped tables: `matters`,
-- `user_keys`, `parties`, `facts`, `privileged_sources`, …). Its absence had
-- already caused two prior sessions to reason from that wrong schema — see
-- `.claude/skills/consolidation-push/references/adjudication.md`.
--
-- VERIFIED: the six tables below match every table name referenced by the live
-- runtime in `../src/legal-commons/`.
-- NOT VERIFIED: this file has not been diffed against the deployed Supabase pool
-- (ref nbzkuhgiqscjkypedqff), which has taken content since 2026-07-13. Treat it
-- as the DDL of record, but confirm against the live pool before relying on it
-- for a migration.
-- =============================================================================

-- =============================================================================
-- Three-layer re-architecture — B1 schema (A2 AMENDMENT 2026-07-13)
-- =============================================================================
-- Deploys the matter-free knowledge pool as a dedicated Postgres schema
-- `legal_commons` in the existing Supabase project (ref nbzkuhgiqscjkypedqff),
-- coexisting with the still-live matter tables in `public` until the B6 wipe.
--
-- AMENDMENT (2026-07-13, practitioner-ratified this session): candidate
-- retrieval moved OFF external embeddings onto a zero-vendor in-Postgres approach
-- (full-text + trigram + citation/doctrine-tag, with Claude generating the query
-- expansion). So `principle` DROPS `embedding` / `embedding_model` and GAINS
-- `doctrine_tag` + a generated `search_vector` (tsvector) with FTS + trigram
-- indexes. See spec §3 D5/D7 + §9 (amended) and docs/Research #46 (superseded).
--
-- Severance stays structural: NO matter table in this namespace; REFERENCES
-- matters(...) is unrepresentable. No RLS, no role/grant machinery in this file
-- (grants live with the functions file). Idempotent — safe to re-run over the
-- existing B1 deployment (which is empty).
-- =============================================================================

create schema if not exists legal_commons;

-- Trigram matching for the lexical retrieval filter (Supabase keeps extensions
-- off `public` by convention). pgvector is intentionally NOT used any more.
create extension if not exists pg_trgm with schema extensions;

set search_path = legal_commons, extensions, public;

-- -----------------------------------------------------------------------------
-- principle — the atomic pooled unit (replaces matter-scoped legal_concepts).
-- `search_vector` is a generated tsvector over the canonical text + doctrine tag
-- (the FTS arm of find_candidates); `doctrine_tag` is the bucket arm.
-- -----------------------------------------------------------------------------
create table if not exists legal_commons.principle (
  principle_id     uuid primary key default gen_random_uuid(),
  text             text not null,                              -- canonical generalized statement
  jurisdiction     text,                                       -- null = general common law (travels)
  doctrine_tag     text,                                       -- controlled-vocabulary bucket for retrieval
  variant_of       uuid references legal_commons.principle(principle_id),  -- null = cluster representative
  variant_note     text,                                       -- only meaningful when variant_of is set
  search_vector    tsvector generated always as (
                     to_tsvector('english', coalesce(text, '') || ' ' || coalesce(doctrine_tag, ''))
                   ) stored,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- Idempotent migration for the ALREADY-DEPLOYED B1 instance (the empty pool).
-- On a fresh deploy these are all no-ops. Order matters: drop the embedding
-- columns, add doctrine_tag, THEN add the generated column that references it.
alter table legal_commons.principle drop column if exists embedding;
alter table legal_commons.principle drop column if exists embedding_model;
alter table legal_commons.principle add column if not exists doctrine_tag text;
alter table legal_commons.principle add column if not exists search_vector tsvector
  generated always as (to_tsvector('english', coalesce(text, '') || ' ' || coalesce(doctrine_tag, ''))) stored;

create index if not exists idx_principle_variant_of on legal_commons.principle (variant_of);
create index if not exists idx_principle_doctrine_tag on legal_commons.principle (doctrine_tag);
create index if not exists idx_principle_search on legal_commons.principle using gin (search_vector);
create index if not exists idx_principle_text_trgm on legal_commons.principle using gin (text extensions.gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- principle_redirects — merged-away IDs resolve forever (depth always 1)
-- -----------------------------------------------------------------------------
create table if not exists legal_commons.principle_redirects (
  old_id        uuid primary key,                              -- merged-away ID, resolves forever
  canonical_id  uuid not null references legal_commons.principle(principle_id)
);

-- -----------------------------------------------------------------------------
-- authority — a public legal source (case/statute/rule) by public citation.
-- NO file_path / file_hash (matter pointers; severed). url is the public link.
-- -----------------------------------------------------------------------------
create table if not exists legal_commons.authority (
  authority_id      uuid primary key default gen_random_uuid(),
  title             text,
  citation          text not null,
  url               text,                                      -- public CanLII / BCLaws link
  authority_type    text,
  jurisdiction      text,
  disposition       text,
  last_verified_at  timestamptz,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
create index if not exists idx_authority_citation on legal_commons.authority (citation);

-- -----------------------------------------------------------------------------
-- principle_authority — which authority stands for which principle.
-- NO factual_context (matter-identifying; severed).
-- -----------------------------------------------------------------------------
create table if not exists legal_commons.principle_authority (
  principle_id             uuid not null references legal_commons.principle(principle_id),
  authority_id             uuid not null references legal_commons.authority(authority_id),
  proposition              text,
  finding                  text,
  relationship             text,
  obiter                   boolean,
  treatment                text,
  treated_by_authority_id  uuid references legal_commons.authority(authority_id),
  created_at               timestamptz default now(),
  updated_at               timestamptz default now(),
  primary key (principle_id, authority_id)
);
create index if not exists idx_principle_authority_authority on legal_commons.principle_authority (authority_id);

-- -----------------------------------------------------------------------------
-- criterion — elements/branches of a principle (incl. sub-test nesting)
-- -----------------------------------------------------------------------------
create table if not exists legal_commons.criterion (
  criterion_id                uuid primary key default gen_random_uuid(),
  principle_id                uuid not null references legal_commons.principle(principle_id),
  description                 text not null,
  requirement_type            text default 'element',
  criterion_order             integer,
  burden_of_proof             text,
  determined_by_principle_id  uuid references legal_commons.principle(principle_id),
  authority_id                uuid references legal_commons.authority(authority_id),
  in_force_date               text,
  repeal_date                 text,
  treatment                   text,
  treated_by_authority_id     uuid references legal_commons.authority(authority_id),
  created_at                  timestamptz default now(),
  updated_at                  timestamptz default now(),
  unique (principle_id, criterion_order)
);
create index if not exists idx_criterion_principle on legal_commons.criterion (principle_id);

-- -----------------------------------------------------------------------------
-- treatment — directed authority-treats-authority edges
-- -----------------------------------------------------------------------------
create table if not exists legal_commons.treatment (
  treating_authority_id  uuid not null references legal_commons.authority(authority_id),
  treated_authority_id   uuid not null references legal_commons.authority(authority_id),
  treatment              text,
  scope                  text,
  created_at             timestamptz default now(),
  updated_at             timestamptz default now(),
  check (treating_authority_id <> treated_authority_id),
  primary key (treating_authority_id, treated_authority_id)
);
create index if not exists idx_treatment_treated on legal_commons.treatment (treated_authority_id);

-- =============================================================================
-- Expose + grant: see legal-commons-functions.sql (A2 owns exposure + grants).
-- =============================================================================
