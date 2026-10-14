-- =============================================================================
-- Probanda's Cloud: the item ledger
-- =============================================================================
-- What the cloud keeps about each practice item: its id, kind, state, tags,
-- links, keyed field hashes and (for rule overlay records only) its cross
-- record. Never a data value in clear. Written and read only by the functions
-- in rules.sql, which edge functions call server-side as postgres.
--
-- Idempotent: safe to re-run. Apply before rules.sql.
-- Grants nothing: the schema is not exposed through the API and no role but its
-- owner can reach it.
-- =============================================================================

begin;

create schema if not exists ledger;

-- One row per tenant. seq is the tenant's change counter: every saved write
-- takes the next number, and every item that write changes carries it, so a
-- sync from a number returns everything changed since. Writes lock this row,
-- so one tenant's writes are checked one at a time.
create table if not exists ledger.tenant (
  tenant uuid primary key,
  seq bigint not null default 0,
  created_at timestamptz not null default now()
);

-- One row per item. A deleted item stays as a tombstone (deleted = true) so a
-- sync can report the deletion.
--   tags           object of vocabulary values and booleans
--   links          object from role to item id (or a filing reference)
--   hashes         object from field name to hex HMAC of the value, or null
--   cross_payload  the rule overlay record; null for every other kind
--   seq            the write that last changed the item
--   created_seq    the write that created it
create table if not exists ledger.item (
  tenant uuid not null references ledger.tenant (tenant),
  id uuid not null,
  store text not null,
  kind text not null,
  state text,
  tags jsonb not null default '{}'::jsonb,
  links jsonb not null default '{}'::jsonb,
  hashes jsonb not null default '{}'::jsonb,
  cross_payload jsonb,
  seq bigint not null,
  created_seq bigint not null,
  deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant, id)
);

create index if not exists item_sync_idx on ledger.item (tenant, store, seq);
create index if not exists item_kind_idx on ledger.item (tenant, kind) where not deleted;

-- Every write's id and the result it got, saved or refused, so a repeated
-- write_id gets the same answer and is never applied twice.
create table if not exists ledger.write_result (
  tenant uuid not null references ledger.tenant (tenant),
  write_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (tenant, write_id)
);

revoke all on schema ledger from public, anon, authenticated;
revoke all on all tables in schema ledger from public, anon, authenticated;
revoke all on all sequences in schema ledger from public, anon, authenticated;
revoke all on all functions in schema ledger from public, anon, authenticated;

commit;
