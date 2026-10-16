-- =============================================================================
-- Probanda's Cloud: install keys
-- =============================================================================
-- One key per installed copy of the plugin (docs/Plans/2026-10-14_install-keys.md).
-- The cloud keeps only the key's SHA-256, never the key. Edge functions resolve
-- a caller's key to its tenant and scopes with access.resolve_key, server-side
-- as postgres (functions/_shared/caller.ts).
--
-- Scopes: commons:read (commons-read, commons-find), items:write (items-*) and
-- suggestions:write (suggestion-submit; cloud/suggestions/suggestions.sql).
-- tenant is null for a key that holds no items:write scope.
--
-- Idempotent: safe to re-run.
-- Grants nothing: the schema is not exposed through the API and no role but its
-- owner can reach it.
-- =============================================================================

create schema if not exists access;

-- One row per key.
--   key_hash    lowercase hex SHA-256 of the whole key, `pb_install_` prefix included
--   label       which machine holds it, for the maintainer; never a person's name
--   tenant      the practice its items writes must name
--   revoked_at  set when the key is withdrawn; the row stays as the record
create table if not exists access.install_key (
  key_hash    text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  label       text not null,
  tenant      uuid,
  scopes      text[] not null check (scopes <@ array['commons:read', 'items:write', 'suggestions:write']::text[] and cardinality(scopes) > 0),
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  check (tenant is not null or not ('items:write' = any (scopes)))
);

-- The tenant and scopes of a live key, or null when the hash names no key or a
-- revoked one.
create or replace function access.resolve_key(p_hash text)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object('tenant', k.tenant, 'scopes', to_jsonb(k.scopes))
  from access.install_key k
  where k.key_hash = p_hash and k.revoked_at is null
$$;

revoke all on schema access from public, anon, authenticated;
revoke all on all tables in schema access from public, anon, authenticated;
revoke all on all functions in schema access from public, anon, authenticated;
