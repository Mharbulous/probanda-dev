-- =============================================================================
-- Probanda's Cloud: the Suggestion Box
-- =============================================================================
-- Suggestions about the plugin that a practitioner expressly submits, through
-- /legal:suggestion or /draft's Suggestion Box, from the research plugin's
-- suggestion_box__submit tool.
--
-- Who can do what:
-- - The suggestion-submit Edge Function
--   (cloud/legal-commons/supabase/functions/suggestion-submit) is the only
--   inserter. It runs as postgres over a direct connection.
-- - suggestion-list and suggestion-set-status, project secret only, are how
--   the maintainer reads and triages (cloud/suggestions/tools/triage.mjs).
-- - A caller reaches it with the project secret or with an install key that
--   holds the suggestions:write scope (functions/_shared/caller.ts). Such a key
--   can therefore insert a suggestion and nothing else: it cannot read, update
--   or delete any row, its own included.
-- - No API role (public, anon, authenticated) has any right on this schema, and
--   the schema is not exposed through the API.
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

-- Triage fields (docs/Specs/2026-10-18_suggestion-triage-spec.md). The commons
-- server fills plugin_version from its own plugin.json; skill is the model's,
-- optional. suggestion-set-status alone moves status off 'new' and sets
-- issue_number and triaged_at. Rows saved before plugin_version existed read
-- 'unrecorded'.
alter table suggestions.suggestion add column if not exists plugin_version text;
update suggestions.suggestion set plugin_version = 'unrecorded' where plugin_version is null;
alter table suggestions.suggestion alter column plugin_version set not null;
alter table suggestions.suggestion add column if not exists skill text;
alter table suggestions.suggestion add column if not exists status text not null default 'new';
alter table suggestions.suggestion add column if not exists issue_number integer;
alter table suggestions.suggestion add column if not exists triaged_at timestamptz;
alter table suggestions.suggestion drop constraint if exists suggestion_status_check;
alter table suggestions.suggestion add constraint suggestion_status_check
  check (status in ('new', 'approved', 'approved in part', 'rejected'));

revoke all on schema suggestions from public, anon, authenticated;
revoke all on all tables in schema suggestions from public, anon, authenticated;
revoke all on all sequences in schema suggestions from public, anon, authenticated;
revoke all on all functions in schema suggestions from public, anon, authenticated;

-- Install keys may now hold suggestions:write. The same list is in
-- cloud/access/access.sql for a fresh apply; this alters a table already made.
alter table access.install_key drop constraint if exists install_key_scopes_check;
alter table access.install_key add constraint install_key_scopes_check
  check (scopes <@ array['commons:read', 'items:write', 'suggestions:write']::text[] and cardinality(scopes) > 0);
