-- =============================================================================
-- Probanda's Cloud: the Suggestion Box
-- =============================================================================
-- Suggestions about the plugin that a practitioner expressly submits, through
-- /legal:suggestion or /draft's Suggestion Box, from the research plugin's
-- suggestion_box__submit tool.
--
-- Who can do what:
-- - The only writer is the suggestion-submit Edge Function
--   (cloud/legal-commons/supabase/functions/suggestion-submit), which runs as
--   postgres over a direct connection and only inserts.
-- - A caller reaches it with the project secret or with an install key that
--   holds the suggestions:write scope (functions/_shared/caller.ts). Such a key
--   can therefore insert a suggestion and nothing else: it cannot read, update
--   or delete any row, its own included.
-- - No API role (public, anon, authenticated) has any right on this schema, and
--   the schema is not exposed through the API. The maintainer reads suggestions
--   in the dashboard or over a direct connection.
--
-- Apply after cloud/access/access.sql. Idempotent: safe to re-run.
-- =============================================================================

create schema if not exists suggestions;

-- One row per suggestion. The plugin screens title and body for personal and
-- matter details before sending them; nothing here names who sent it.
create table if not exists suggestions.suggestion (
  suggestion_id  uuid primary key default gen_random_uuid(),
  title          text not null check (length(title) between 1 and 2000),
  body           text not null check (length(body) between 1 and 2000),
  source         text not null check (source in ('user', 'llm')),
  created_at     timestamptz not null default now()
);

revoke all on schema suggestions from public, anon, authenticated;
revoke all on all tables in schema suggestions from public, anon, authenticated;
revoke all on all sequences in schema suggestions from public, anon, authenticated;
revoke all on all functions in schema suggestions from public, anon, authenticated;

-- Install keys may now hold suggestions:write. The same list is in
-- cloud/access/access.sql for a fresh apply; this alters a table already made.
alter table access.install_key drop constraint if exists install_key_scopes_check;
alter table access.install_key add constraint install_key_scopes_check
  check (scopes <@ array['commons:read', 'items:write', 'suggestions:write']::text[] and cardinality(scopes) > 0);
