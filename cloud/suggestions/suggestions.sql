-- =============================================================================
-- Probanda's Cloud: the Suggestion Box
-- =============================================================================
-- Suggestions about the plugin that a practitioner expressly submits, through
-- /lawyer:suggestion or /draft's Suggestion Box, from the lawyer plugin's data
-- server (decision 5 of the lifecycle plan). The design is
-- docs/Plans/2026-10-25_suggestion-design.md (decisions cited by number) and
-- its lifecycle plan docs/Plans/2026-10-25_suggestion-implementation-lifecycle.md.
--
-- Each suggestion records the install key that sent it, by the key's SHA-256
-- (access.install_key.key_hash), which is how Probanda's Cloud knows the account
-- that sent it (decision 15). That is Account Information (COMMANDMENTS.md,
-- Commandment 2): it stays in Probanda's Cloud and is never returned to anyone.
--
-- A suggestion is one or more items (decision 23), each decided on its own.
-- The suggestion's own status is 'submitted', 'under review' or 'withdrawn';
-- each item's is 'undecided', 'approved', 'declined' or 'implemented'. The badge
-- a practitioner sees (decision 17) is suggestions.badge, and nothing else
-- computes it. Every change of status is one of the functions below, so the
-- rules live here and the Edge Functions only check a request's shape.
--
-- Who can do what:
-- - suggestion-submit (cloud/legal-commons/supabase/functions/suggestion-submit)
--   is the only inserter, through suggestions.submit. It runs as postgres over
--   a direct connection.
-- - suggestion-list and suggestion-set-status, project secret only, are how
--   the maintainer reads and decides (cloud/suggestions/tools/triage.mjs), and
--   how Probanda's automation records the issue a suggestion is filed under,
--   opens it for review and marks an item implemented.
-- - A caller reaches the box with the project secret or with an install key
--   that holds the suggestions:write scope (functions/_shared/caller.ts). Such a
--   key can insert a suggestion; through suggestion-status read the status,
--   badge and per-item decisions of a suggestion it sent; through
--   suggestion-attach-specification attach a specification once to a
--   suggestion it sent; and through suggestion-withdraw withdraw one it sent.
--   It reads nothing else, and changes no other row.
-- - No API role (public, anon, authenticated) has any right on this schema, and
--   the schema is not exposed through the API.
--
-- Apply after cloud/access/access.sql. Idempotent: safe to re-run.
-- =============================================================================

create schema if not exists suggestions;

-- One row per suggestion. The plugin screens what it sends for personal and
-- matter details first (decisions 8, 12 and 28). sender_key_hash names the
-- install key that sent it (decision 15). body carries the suggestion's pain
-- point (decisions 2 and 6): it was a suggestion's text before the card
-- existed, and its readers still read it, so suggestion-submit saves a card's
-- pain_point in body rather than in a column of its own.
create table if not exists suggestions.suggestion (
  suggestion_id  uuid primary key default gen_random_uuid(),
  title          text not null check (length(title) between 1 and 2000),
  body           text not null check (length(body) between 1 and 2000),
  source         text not null check (source in ('user', 'llm')),
  created_at     timestamptz not null default now()
);

-- Triage fields (docs/Specs/2026-10-18_suggestion-triage-spec.md). The sending
-- server fills plugin_version from its own plugin.json, as "<plugin> <version>"; skill is the model's,
-- optional. Rows saved before plugin_version existed read 'unrecorded'.
alter table suggestions.suggestion add column if not exists plugin_version text;
update suggestions.suggestion set plugin_version = 'unrecorded' where plugin_version is null and title is not null;
alter table suggestions.suggestion add column if not exists skill text;
alter table suggestions.suggestion add column if not exists status text not null default 'submitted';
alter table suggestions.suggestion add column if not exists issue_number integer;
alter table suggestions.suggestion add column if not exists triaged_at timestamptz;

-- Structured suggestions (2026-10-19). source 'assisted' is a suggestion
-- Probanda drafted and the person confirmed. items holds one entry per pain;
-- previews holds UI Previews built from placeholder data. Both are optional and
-- screened by the plugin like title and body; title and body stay a complete
-- summary. suggestion-submit caps items at 50,000 characters of JSON and each
-- Preview's html at 200,000; the byte checks here leave room for JSON escaping
-- and multi-byte characters. These are the earlier card's fields, kept for the
-- readers that still use them; the items a maintainer decides are the rows of
-- suggestions.item below.
alter table suggestions.suggestion drop constraint if exists suggestion_source_check;
alter table suggestions.suggestion add constraint suggestion_source_check
  check (source in ('user', 'llm', 'assisted'));
alter table suggestions.suggestion add column if not exists items jsonb;
alter table suggestions.suggestion add column if not exists previews jsonb;
alter table suggestions.suggestion drop constraint if exists suggestion_items_size_check;
alter table suggestions.suggestion add constraint suggestion_items_size_check
  check (items is null or (jsonb_typeof(items) = 'array' and octet_length(items::text) <= 400000));
alter table suggestions.suggestion drop constraint if exists suggestion_previews_size_check;
alter table suggestions.suggestion add constraint suggestion_previews_size_check
  check (previews is null or (jsonb_typeof(previews) = 'array' and octet_length(previews::text) <= 4000000));

-- The suggestion card (2026-10-26, lifecycle plan Phase 1). All optional at
-- submit, so a plugin that sends none of them saves as before.
--   origin             who started it: the practitioner, or Probanda noticing (decision 4)
--   fingerprint        an AI-noticed suggestion's plugin, version, skill and kind (decision 3)
--   raw_observation    what Probanda noticed, from its own output only (decision 3)
--   environment_facts  the plugins, tools, host and OS (decision 19)
--   comment            the practitioner's optional comment (decision 6)
--   context_lines      the card's context lines in order (decision 23), each
--                      {"kind": "constraint" | "evidence", "text"}, with no
--                      status; the raw observation is shown among the evidence
--                      lines (decision 6) but is kept in raw_observation
--   mockup_html        the one mockup on the card at the click: one
--                      self-contained HTML file, under 1 MB (decision 26)
--   sender_key_hash    the sending install key's SHA-256 (decision 15)
--   specification,
--   backstop_result    technical-writer's specification and its backstop's
--                      result, attached once after the suggestion is sent
--                      (decision 18)
-- issue_number is written when intake files the suggestion
-- (suggestions.record_issue), which does not change its status.
alter table suggestions.suggestion add column if not exists origin text;
alter table suggestions.suggestion add column if not exists fingerprint jsonb;
alter table suggestions.suggestion add column if not exists raw_observation text;
alter table suggestions.suggestion add column if not exists environment_facts jsonb;
alter table suggestions.suggestion add column if not exists comment text;
alter table suggestions.suggestion add column if not exists context_lines jsonb;
alter table suggestions.suggestion add column if not exists mockup_html text;
alter table suggestions.suggestion add column if not exists sender_key_hash text references access.install_key (key_hash);
alter table suggestions.suggestion add column if not exists specification text;
alter table suggestions.suggestion add column if not exists backstop_result jsonb;

alter table suggestions.suggestion drop constraint if exists suggestion_origin_check;
alter table suggestions.suggestion add constraint suggestion_origin_check
  check (origin in ('practitioner', 'probanda'));
alter table suggestions.suggestion drop constraint if exists suggestion_fingerprint_check;
alter table suggestions.suggestion add constraint suggestion_fingerprint_check
  check (fingerprint is null or (jsonb_typeof(fingerprint) = 'object' and octet_length(fingerprint::text) <= 2000));
alter table suggestions.suggestion drop constraint if exists suggestion_raw_observation_check;
alter table suggestions.suggestion add constraint suggestion_raw_observation_check
  check (length(raw_observation) between 1 and 4000);
alter table suggestions.suggestion drop constraint if exists suggestion_environment_facts_check;
alter table suggestions.suggestion add constraint suggestion_environment_facts_check
  check (environment_facts is null or (jsonb_typeof(environment_facts) = 'object' and octet_length(environment_facts::text) <= 200000));
alter table suggestions.suggestion drop constraint if exists suggestion_comment_check;
alter table suggestions.suggestion add constraint suggestion_comment_check
  check (length(comment) between 1 and 2000);
alter table suggestions.suggestion drop constraint if exists suggestion_context_lines_check;
alter table suggestions.suggestion add constraint suggestion_context_lines_check
  check (context_lines is null or (jsonb_typeof(context_lines) = 'array'
    and jsonb_array_length(context_lines) between 1 and 20
    and octet_length(context_lines::text) <= 200000
    and not jsonb_path_exists(context_lines,
      '$[*] ? (@.type() != "object" || !(@.kind == "constraint" || @.kind == "evidence")
        || !exists(@.text ? (@.type() == "string")))', '{}', true)
    and not jsonb_path_exists(context_lines, '$[*].keyvalue() ? (@.key != "kind" && @.key != "text")', '{}', true)));
alter table suggestions.suggestion drop constraint if exists suggestion_mockup_html_check;
alter table suggestions.suggestion add constraint suggestion_mockup_html_check
  check (octet_length(mockup_html) between 1 and 1000000);
alter table suggestions.suggestion drop constraint if exists suggestion_specification_check;
alter table suggestions.suggestion add constraint suggestion_specification_check
  check (length(specification) between 1 and 100000);
alter table suggestions.suggestion drop constraint if exists suggestion_backstop_result_check;
alter table suggestions.suggestion add constraint suggestion_backstop_result_check
  check (backstop_result is null or (jsonb_typeof(backstop_result) = 'object' and octet_length(backstop_result::text) <= 40000));
alter table suggestions.suggestion drop constraint if exists suggestion_specification_pair_check;
alter table suggestions.suggestion add constraint suggestion_specification_pair_check
  check ((specification is null) = (backstop_result is null));

-- A withdrawn suggestion after triage is a tombstone holding only its id, its
-- issue number and its status (decision 16), so the content columns are
-- nullable, and these two checks say which rows hold content.
alter table suggestions.suggestion alter column title drop not null;
alter table suggestions.suggestion alter column body drop not null;
alter table suggestions.suggestion alter column source drop not null;
alter table suggestions.suggestion alter column plugin_version drop not null;
alter table suggestions.suggestion alter column created_at drop not null;
alter table suggestions.suggestion drop constraint if exists suggestion_content_check;
alter table suggestions.suggestion add constraint suggestion_content_check
  check (status = 'withdrawn'
    or num_nulls(title, body, source, plugin_version, created_at) = 0);
alter table suggestions.suggestion drop constraint if exists suggestion_tombstone_check;
alter table suggestions.suggestion add constraint suggestion_tombstone_check
  check (status <> 'withdrawn'
    or num_nonnulls(title, body, source, plugin_version, skill, items, previews, created_at, triaged_at,
      origin, fingerprint, raw_observation, environment_facts, comment, context_lines, mockup_html, sender_key_hash,
      specification, backstop_result) = 0);

-- The fixed categories a maintainer picks one of to decline an item
-- (decision 17). 'not recorded' is not among them: it marks only the items
-- declined before categories existed.
create or replace function suggestions.decline_categories()
returns text[]
language sql
immutable
as $$
  select array['not enough detail', 'already works as asked', 'already suggested',
    'outside what Probanda does', 'cost outweighs benefit', 'conflicts with how Probanda must work']
$$;

-- One row per item of a suggestion, numbered from 1 in the card's order
-- (decision 23). reason is the short plain-text line a practitioner reads
-- (decision 17); a declined item also holds a category; an implemented item
-- names the release that shipped it, as '<plugin> <version>'.
create table if not exists suggestions.item (
  suggestion_id   uuid not null references suggestions.suggestion (suggestion_id) on delete cascade,
  item            integer not null check (item between 1 and 50),
  text            text not null check (length(text) between 1 and 2000),
  status          text not null default 'undecided'
                  check (status in ('undecided', 'approved', 'declined', 'implemented')),
  reason          text check (length(reason) between 1 and 200 and reason !~ '[\r\n]'),
  category        text check (category = 'not recorded' or category = any (suggestions.decline_categories())),
  implemented_in  text check (implemented_in ~ '^[a-z][a-z-]* [0-9]+\.[0-9]+\.[0-9]+$'),
  primary key (suggestion_id, item),
  check (case status
    when 'undecided'   then num_nonnulls(reason, category, implemented_in) = 0
    when 'approved'    then reason is not null and category is null and implemented_in is null
    when 'declined'    then reason is not null and category is not null and implemented_in is null
    when 'implemented' then reason is not null and category is null and implemented_in is not null
  end)
);

-- Rows saved before items existed (2026-10-26): each gets one item holding its
-- body, and the old statuses map onto it. 'new' is a submitted suggestion with
-- its item undecided; 'approved' and 'approved in part' approve the item, and
-- 'rejected' declines it, each with the reason below; a decided row is under
-- review, because triage opened it. 'approved in part' is no longer a status.
alter table suggestions.suggestion drop constraint if exists suggestion_status_check;
insert into suggestions.item (suggestion_id, item, text, status, reason, category)
select s.suggestion_id, 1, s.body,
  case when s.status in ('approved', 'approved in part') then 'approved'
       when s.status = 'rejected' then 'declined'
       else 'undecided' end,
  case when s.status in ('approved', 'approved in part', 'rejected')
       then 'Decided before reasons were recorded' end,
  case when s.status = 'rejected' then 'not recorded' end
from suggestions.suggestion s
where s.body is not null
  and not exists (select 1 from suggestions.item i where i.suggestion_id = s.suggestion_id);
update suggestions.suggestion
  set status = case status when 'new' then 'submitted' else 'under review' end
  where status in ('new', 'approved', 'approved in part', 'rejected');
alter table suggestions.suggestion alter column status set default 'submitted';
alter table suggestions.suggestion add constraint suggestion_status_check
  check (status in ('submitted', 'under review', 'withdrawn'));

-- -----------------------------------------------------------------------------
-- Reading
-- -----------------------------------------------------------------------------

-- 'a', 'a and b', 'a, b and c'.
create or replace function suggestions.join_and(p_parts text[])
returns text
language sql
immutable
as $$
  select case
    when coalesce(cardinality(p_parts), 0) = 0 then null
    when cardinality(p_parts) = 1 then p_parts[1]
    else array_to_string(p_parts[1:cardinality(p_parts) - 1], ', ') || ' and ' || p_parts[cardinality(p_parts)]
  end
$$;

-- The badge of one suggestion (decision 17), or null for an unknown id.
-- Withdrawn; Submitted until triage opens it; Under Review while any item is
-- undecided; Declined when every item is declined; Implemented in <plugin>
-- <version> when every approved item has shipped, naming each plugin's latest
-- release among its items; otherwise Approved, or Approved (n of m) when some
-- items were declined.
create or replace function suggestions.badge(p_suggestion_id uuid)
returns text
language sql
stable
as $$
  with s as (
    select status from suggestions.suggestion where suggestion_id = p_suggestion_id
  ), c as (
    select count(*) as total,
      count(*) filter (where status = 'undecided') as undecided,
      count(*) filter (where status = 'declined') as declined,
      count(*) filter (where status in ('approved', 'implemented')) as approved,
      count(*) filter (where status = 'approved') as unshipped
    from suggestions.item where suggestion_id = p_suggestion_id
  ), r as (
    select array_agg(plugin || ' ' || version order by plugin) as releases
    from (
      select distinct on (plugin) plugin, version
      from (
        select split_part(implemented_in, ' ', 1) as plugin, split_part(implemented_in, ' ', 2) as version
        from suggestions.item
        where suggestion_id = p_suggestion_id and status = 'implemented'
      ) shipped
      order by plugin, string_to_array(version, '.')::int[] desc
    ) latest
  )
  select case
    when s.status = 'withdrawn' then 'Withdrawn'
    when s.status = 'submitted' then 'Submitted'
    when c.total = 0 or c.undecided > 0 then 'Under Review'
    when c.approved = 0 then 'Declined'
    when c.unshipped = 0 then 'Implemented in ' || suggestions.join_and(r.releases)
    when c.declined > 0 then 'Approved (' || c.approved || ' of ' || c.total || ')'
    else 'Approved'
  end
  from s, c, r
$$;

-- A suggestion's items in order, with their text when p_with_text.
create or replace function suggestions.items_of(p_suggestion_id uuid, p_with_text boolean)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(
      jsonb_build_object('item', i.item, 'status', i.status, 'reason', i.reason,
        'category', i.category, 'implemented_in', i.implemented_in)
      || case when p_with_text then jsonb_build_object('text', i.text) else '{}'::jsonb end
      order by i.item), '[]'::jsonb)
  from suggestions.item i
  where i.suggestion_id = p_suggestion_id
$$;

-- The status, badge and per-item decisions of the asked-for suggestions that
-- p_key_hash sent, oldest first; an id it did not send is omitted, as an
-- unknown id is. A suggestion saved before senders were recorded (no sender
-- and not withdrawn) is returned to any caller holding its id, as it was
-- before. p_everyone, for the project secret alone, returns every asked-for
-- suggestion.
create or replace function suggestions.status_for_key(p_key_hash text, p_ids uuid[], p_everyone boolean default false)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'suggestion_id', s.suggestion_id, 'status', s.status, 'triaged_at', s.triaged_at,
      'badge', suggestions.badge(s.suggestion_id), 'items', suggestions.items_of(s.suggestion_id, false))
      order by s.created_at nulls last, s.suggestion_id), '[]'::jsonb)
  from suggestions.suggestion s
  where s.suggestion_id = any (p_ids)
    and (p_everyone
      or s.sender_key_hash = p_key_hash
      or (s.sender_key_hash is null and s.status <> 'withdrawn'))
$$;

-- The maintainer's read: every suggestion, or those with one status, oldest
-- first, with its badge and its items. The sender's key hash is not returned.
create or replace function suggestions.list(p_status text default null)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'suggestion_id', s.suggestion_id, 'title', s.title, 'body', s.body, 'source', s.source,
      'plugin_version', s.plugin_version, 'skill', s.skill, 'status', s.status,
      'badge', suggestions.badge(s.suggestion_id), 'issue_number', s.issue_number,
      'created_at', s.created_at, 'triaged_at', s.triaged_at, 'items', s.items, 'previews', s.previews,
      'origin', s.origin, 'fingerprint', s.fingerprint, 'raw_observation', s.raw_observation,
      'environment_facts', s.environment_facts, 'comment', s.comment, 'context_lines', s.context_lines,
      'mockup_html', s.mockup_html,
      'specification', s.specification, 'backstop_result', s.backstop_result,
      'item_list', suggestions.items_of(s.suggestion_id, true))
      order by s.created_at nulls last, s.suggestion_id), '[]'::jsonb)
  from suggestions.suggestion s
  where p_status is null or s.status = p_status
$$;

-- -----------------------------------------------------------------------------
-- Writing. Each function returns {"saved": true, ...}, or {"saved": false,
-- "refusal": <code>} when the write was refused; the Edge Function turns the
-- code into its reply. A refusal changes nothing.
-- -----------------------------------------------------------------------------

create or replace function suggestions.refused(p_code text)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('saved', false, 'refusal', p_code)
$$;

-- A reason as stored, or null when it is not one: trimmed, 1 to 200
-- characters, one line.
create or replace function suggestions.clean_reason(p_reason text)
returns text
language sql
immutable
as $$
  select case when length(btrim(p_reason)) between 1 and 200 and btrim(p_reason) !~ '[\r\n]'
    then btrim(p_reason) end
$$;

-- Saves one suggestion and its items, and returns its id. p holds the
-- suggestion's columns by name, as suggestion-submit's shape.ts builds them,
-- plus item_texts: the card's items in order. With no item_texts the
-- suggestion gets one item holding its body. p_key_hash is the sending install
-- key's hash, or null for the project secret.
create or replace function suggestions.submit(p_key_hash text, p jsonb)
returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_texts jsonb := nullif(p -> 'item_texts', 'null'::jsonb);
begin
  insert into suggestions.suggestion (title, body, source, plugin_version, skill, items, previews,
    origin, fingerprint, raw_observation, environment_facts, comment, context_lines, mockup_html, sender_key_hash)
  values (p ->> 'title', p ->> 'body', p ->> 'source', p ->> 'plugin_version', p ->> 'skill',
    nullif(p -> 'items', 'null'::jsonb), nullif(p -> 'previews', 'null'::jsonb),
    p ->> 'origin', nullif(p -> 'fingerprint', 'null'::jsonb), p ->> 'raw_observation',
    nullif(p -> 'environment_facts', 'null'::jsonb), p ->> 'comment', nullif(p -> 'context_lines', 'null'::jsonb),
    p ->> 'mockup_html', p_key_hash)
  returning suggestion_id into v_id;
  if v_texts is not null and jsonb_typeof(v_texts) = 'array' and jsonb_array_length(v_texts) > 0 then
    insert into suggestions.item (suggestion_id, item, text)
    select v_id, t.n, t.v from jsonb_array_elements_text(v_texts) with ordinality as t (v, n);
  else
    insert into suggestions.item (suggestion_id, item, text) values (v_id, 1, p ->> 'body');
  end if;
  return v_id;
end
$$;

-- Triage opens a suggestion (Probanda's automation): 'submitted' becomes
-- 'under review', with the issue it is filed under when given. Opening it
-- again is allowed, and records the issue if none was recorded.
create or replace function suggestions.open_for_review(p_suggestion_id uuid, p_issue integer default null)
returns jsonb
language plpgsql
as $$
declare
  s suggestions.suggestion%rowtype;
begin
  if p_issue is not null and p_issue < 1 then return suggestions.refused('issue'); end if;
  select * into s from suggestions.suggestion where suggestion_id = p_suggestion_id for update;
  if not found then return suggestions.refused('unknown'); end if;
  if s.status = 'withdrawn' then return suggestions.refused('withdrawn'); end if;
  if p_issue is not null and s.issue_number is not null and s.issue_number <> p_issue then
    return suggestions.refused('issue');
  end if;
  update suggestions.suggestion
    set status = 'under review', issue_number = coalesce(p_issue, issue_number), triaged_at = coalesce(triaged_at, now())
    where suggestion_id = p_suggestion_id;
  return jsonb_build_object('saved', true, 'suggestion_id', p_suggestion_id, 'status', 'under review',
    'issue_number', coalesce(p_issue, s.issue_number), 'badge', suggestions.badge(p_suggestion_id));
end
$$;

-- Intake records the issue a suggestion is filed under (Probanda's
-- automation), without changing its status. Recording the same issue again is
-- saved; a different one is refused.
create or replace function suggestions.record_issue(p_suggestion_id uuid, p_issue integer)
returns jsonb
language plpgsql
as $$
declare
  s suggestions.suggestion%rowtype;
begin
  if p_issue is null or p_issue < 1 then return suggestions.refused('issue'); end if;
  select * into s from suggestions.suggestion where suggestion_id = p_suggestion_id for update;
  if not found then return suggestions.refused('unknown'); end if;
  if s.status = 'withdrawn' then return suggestions.refused('withdrawn'); end if;
  if s.issue_number is not null and s.issue_number <> p_issue then return suggestions.refused('issue'); end if;
  update suggestions.suggestion set issue_number = p_issue where suggestion_id = p_suggestion_id;
  return jsonb_build_object('saved', true, 'suggestion_id', p_suggestion_id, 'status', s.status,
    'issue_number', p_issue, 'badge', suggestions.badge(p_suggestion_id));
end
$$;

-- The maintainer approves or declines one undecided item, with a reason, and a
-- category to decline. A decision is never overwritten. Deciding an item of a
-- suggestion still 'submitted' opens it for review.
create or replace function suggestions.set_item_status(p_suggestion_id uuid, p_item integer, p_status text,
  p_reason text, p_category text default null)
returns jsonb
language plpgsql
as $$
declare
  s suggestions.suggestion%rowtype;
  v_current text;
  v_reason text := suggestions.clean_reason(p_reason);
begin
  if p_status is null or p_status not in ('approved', 'declined') then return suggestions.refused('status'); end if;
  if v_reason is null then return suggestions.refused('reason'); end if;
  if p_status = 'declined' and (p_category is null or not p_category = any (suggestions.decline_categories())) then
    return suggestions.refused('category');
  end if;
  if p_status = 'approved' and p_category is not null then return suggestions.refused('category'); end if;
  select * into s from suggestions.suggestion where suggestion_id = p_suggestion_id for update;
  if not found then return suggestions.refused('unknown'); end if;
  if s.status = 'withdrawn' then return suggestions.refused('withdrawn'); end if;
  select status into v_current from suggestions.item
    where suggestion_id = p_suggestion_id and item = p_item for update;
  if not found then return suggestions.refused('item'); end if;
  if v_current <> 'undecided' then return suggestions.refused('decided'); end if;
  update suggestions.item set status = p_status, reason = v_reason, category = p_category
    where suggestion_id = p_suggestion_id and item = p_item;
  if s.status = 'submitted' then
    update suggestions.suggestion set status = 'under review', triaged_at = coalesce(triaged_at, now())
      where suggestion_id = p_suggestion_id;
  end if;
  return jsonb_build_object('saved', true, 'suggestion_id', p_suggestion_id, 'item', p_item,
    'status', p_status, 'badge', suggestions.badge(p_suggestion_id));
end
$$;

-- The old whole-suggestion decision, kept until the triage skill decides per
-- item (lifecycle plan Phase 7): 'approved' and 'approved in part' approve every
-- item, and 'rejected' declines every item. Only a suggestion whose items are
-- all undecided moves, so an outcome is never overwritten. The reason defaults
-- to the one migrated rows carry, and a decline's category to 'not recorded'.
-- It opens the suggestion for review, with the issue when given.
create or replace function suggestions.set_all_items(p_suggestion_id uuid, p_legacy_status text,
  p_issue integer default null, p_reason text default null, p_category text default null)
returns jsonb
language plpgsql
as $$
declare
  s suggestions.suggestion%rowtype;
  v_status text := case when p_legacy_status in ('approved', 'approved in part') then 'approved'
                        when p_legacy_status = 'rejected' then 'declined' end;
  v_reason text := suggestions.clean_reason(coalesce(p_reason, 'Decided before reasons were recorded'));
begin
  if v_status is null then return suggestions.refused('status'); end if;
  if v_reason is null then return suggestions.refused('reason'); end if;
  if p_category is not null and (v_status = 'approved' or not p_category = any (suggestions.decline_categories())) then
    return suggestions.refused('category');
  end if;
  if p_issue is not null and p_issue < 1 then return suggestions.refused('issue'); end if;
  select * into s from suggestions.suggestion where suggestion_id = p_suggestion_id for update;
  if not found then return suggestions.refused('unknown'); end if;
  if s.status = 'withdrawn' then return suggestions.refused('withdrawn'); end if;
  if exists (select 1 from suggestions.item where suggestion_id = p_suggestion_id and status <> 'undecided')
     or not exists (select 1 from suggestions.item where suggestion_id = p_suggestion_id) then
    return suggestions.refused('decided');
  end if;
  if p_issue is not null and s.issue_number is not null and s.issue_number <> p_issue then
    return suggestions.refused('issue');
  end if;
  update suggestions.item
    set status = v_status, reason = v_reason,
        category = case when v_status = 'declined' then coalesce(p_category, 'not recorded') end
    where suggestion_id = p_suggestion_id;
  update suggestions.suggestion
    set status = 'under review', issue_number = coalesce(p_issue, issue_number), triaged_at = coalesce(triaged_at, now())
    where suggestion_id = p_suggestion_id;
  return jsonb_build_object('saved', true, 'suggestion_id', p_suggestion_id, 'status', 'under review',
    'badge', suggestions.badge(p_suggestion_id));
end
$$;

-- Probanda's automation marks an approved item implemented in the release that
-- shipped it, '<plugin> <version>', with the reason "Fixed in <plugin>
-- <version>" (lifecycle plan Phase 9). Marking it again with the same release
-- changes nothing and is saved.
create or replace function suggestions.mark_implemented(p_suggestion_id uuid, p_item integer, p_release text)
returns jsonb
language plpgsql
as $$
declare
  s suggestions.suggestion%rowtype;
  i suggestions.item%rowtype;
begin
  if p_release is null or p_release !~ '^[a-z][a-z-]* [0-9]+\.[0-9]+\.[0-9]+$' then
    return suggestions.refused('release');
  end if;
  select * into s from suggestions.suggestion where suggestion_id = p_suggestion_id for update;
  if not found then return suggestions.refused('unknown'); end if;
  if s.status = 'withdrawn' then return suggestions.refused('withdrawn'); end if;
  select * into i from suggestions.item where suggestion_id = p_suggestion_id and item = p_item for update;
  if not found then return suggestions.refused('item'); end if;
  if not (i.status = 'approved' or (i.status = 'implemented' and i.implemented_in = p_release)) then
    return suggestions.refused('not approved');
  end if;
  update suggestions.item
    set status = 'implemented', implemented_in = p_release, reason = 'Fixed in ' || p_release
    where suggestion_id = p_suggestion_id and item = p_item;
  return jsonb_build_object('saved', true, 'suggestion_id', p_suggestion_id, 'item', p_item,
    'status', 'implemented', 'badge', suggestions.badge(p_suggestion_id));
end
$$;

-- The sending install key attaches technical-writer's specification and its
-- backstop's result, once, to a suggestion it sent that is not withdrawn
-- (decision 18).
create or replace function suggestions.attach_specification(p_key_hash text, p_suggestion_id uuid,
  p_specification text, p_backstop_result jsonb)
returns jsonb
language plpgsql
as $$
declare
  s suggestions.suggestion%rowtype;
begin
  if p_specification is null or length(p_specification) not between 1 and 100000 then
    return suggestions.refused('specification');
  end if;
  if p_backstop_result is null or jsonb_typeof(p_backstop_result) <> 'object'
     or octet_length(p_backstop_result::text) > 40000 then
    return suggestions.refused('backstop');
  end if;
  select * into s from suggestions.suggestion
    where suggestion_id = p_suggestion_id and p_key_hash is not null and sender_key_hash = p_key_hash
      and status <> 'withdrawn'
    for update;
  if not found then return suggestions.refused('unknown'); end if;
  if s.specification is not null then return suggestions.refused('attached'); end if;
  update suggestions.suggestion set specification = p_specification, backstop_result = p_backstop_result
    where suggestion_id = p_suggestion_id;
  return jsonb_build_object('saved', true, 'suggestion_id', p_suggestion_id);
end
$$;

-- The sending install key withdraws a suggestion it sent (decision 16). Before
-- triage, meaning no issue number is recorded, the row and its items are deleted.
-- After, the items and every content column are deleted, and a tombstone holds
-- only the id, the issue number and 'withdrawn', for intake to close the issue.
create or replace function suggestions.withdraw(p_key_hash text, p_suggestion_id uuid)
returns jsonb
language plpgsql
as $$
declare
  s suggestions.suggestion%rowtype;
begin
  select * into s from suggestions.suggestion
    where suggestion_id = p_suggestion_id and p_key_hash is not null and sender_key_hash = p_key_hash
      and status <> 'withdrawn'
    for update;
  if not found then return suggestions.refused('unknown'); end if;
  if s.issue_number is null then
    delete from suggestions.suggestion where suggestion_id = p_suggestion_id;
    return jsonb_build_object('saved', true, 'suggestion_id', p_suggestion_id, 'tombstone', false);
  end if;
  delete from suggestions.item where suggestion_id = p_suggestion_id;
  update suggestions.suggestion
    set status = 'withdrawn', title = null, body = null, source = null, plugin_version = null, skill = null,
        items = null, previews = null, created_at = null, triaged_at = null, origin = null, fingerprint = null,
        raw_observation = null, environment_facts = null, comment = null, context_lines = null, mockup_html = null,
        sender_key_hash = null, specification = null, backstop_result = null
    where suggestion_id = p_suggestion_id;
  return jsonb_build_object('saved', true, 'suggestion_id', p_suggestion_id, 'tombstone', true);
end
$$;

revoke all on schema suggestions from public, anon, authenticated;
revoke all on all tables in schema suggestions from public, anon, authenticated;
revoke all on all sequences in schema suggestions from public, anon, authenticated;
revoke all on all functions in schema suggestions from public, anon, authenticated;

-- Install keys may now hold suggestions:write. The same list is in
-- cloud/access/access.sql for a fresh apply; this alters a table already made.
alter table access.install_key drop constraint if exists install_key_scopes_check;
alter table access.install_key add constraint install_key_scopes_check
  check (scopes <@ array['commons:read', 'items:write', 'suggestions:write']::text[] and cardinality(scopes) > 0);
