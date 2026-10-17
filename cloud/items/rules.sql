-- =============================================================================
-- Probanda's Cloud: the practice rulebook and the write checks
-- =============================================================================
-- The vocabularies, state transitions, lifecycle policies and natural keys of
-- practice items, and the functions that check and apply every practice write
-- against the ledger (ledger.sql, applied first):
--
--   rules.apply_write(tenant, write)  check and apply one write, all or nothing
--   rules.sync(tenant, store, since)  every item changed after a sequence number
--   rules.seed(tenant, store, items)  record a tenant's existing items, once
--
-- Ported from the practice data server's write rules (R1 to R11 of
-- docs/Plans/2026-10-14_practice-db-conversion.md). A refusal never states a
-- rule: it is {saved: false, question} with one question about the item, which
-- may name items as {{item:<id>}}.
--
-- Idempotent: safe to re-run. Grants nothing: called only server-side, by edge
-- functions connecting as postgres.
-- =============================================================================

begin;

create schema if not exists rules;

-- -----------------------------------------------------------------------------
-- The rulebook tables
-- -----------------------------------------------------------------------------

-- Each kind of item. state_by_rule: the state is set by the checks, never by
-- the caller.
create table if not exists rules.kind (
  kind text primary key,
  store text not null,
  has_state boolean not null,
  state_required boolean not null,
  state_default text,
  state_by_rule boolean not null
);

-- Allowed values. field is 'state', a tag name, or a field of the overlay
-- record ('record.counting').
create table if not exists rules.vocabulary (
  kind text not null,
  field text not null,
  value text not null,
  primary key (kind, field, value)
);

-- The tags each kind carries. form: vocab (a value from rules.vocabulary),
-- text (any text) or boolean.
create table if not exists rules.tag (
  kind text not null,
  tag text not null,
  form text not null,
  required boolean not null,
  primary key (kind, tag)
);

-- The links each kind has. target_kind null: the link is a reference string,
-- not an item id. synced false: the link is kept in the cloud and never sent to
-- the user's machine.
create table if not exists rules.link_role (
  kind text not null,
  role text not null,
  target_kind text,
  required boolean not null,
  synced boolean not null,
  primary key (kind, role)
);

-- State changes. A kind with rows here may change state only along them; ''
-- as from_state is the state a new item may start in. A kind with no rows may
-- move freely within its vocabulary.
create table if not exists rules.transition (
  kind text not null,
  from_state text not null,
  to_state text not null,
  primary key (kind, from_state, to_state)
);

-- Natural keys. purpose 'upsert' matches an upsert to an existing item;
-- 'supersede' names the items a new one replaces. Ranks are tried in order and
-- the first whose strict parts the op supplies is used. A part is
-- '<tag|link|hash>:<name>' plus a mode: none (the op's value is required and
-- equal), '?' (equal, with no value matching no value) or '*' (equal when the
-- op has a value, otherwise not compared). states: the states an item must be
-- in to match (null: any).
create table if not exists rules.natural_key (
  kind text not null,
  purpose text not null,
  rank integer not null,
  parts text[] not null,
  states text[],
  primary key (kind, purpose, rank)
);

-- The eight matter lifecycle policies.
create table if not exists rules.status_policy (
  status_label text primary key,
  required_signals text[] not null,
  blocking_signals text[],
  auto_advance boolean not null,
  description text not null
);

-- -----------------------------------------------------------------------------
-- The rulebook (replaced whole on every run)
-- -----------------------------------------------------------------------------

delete from rules.kind;
insert into rules.kind (kind, store, has_state, state_required, state_default, state_by_rule) values
  ('client',          'practice', false, false, null,     false),
  ('matter',          'practice', true,  false, null,     false),
  ('time_entry',      'practice', false, false, null,     false),
  ('invoice',         'practice', false, false, null,     false),
  ('task',            'practice', true,  true,  'open',   false),
  ('retainer_notice', 'practice', false, false, null,     false),
  ('anchor',          'practice', true,  true,  null,     true),
  ('anchor_source',   'practice', true,  true,  null,     true),
  ('deadline',        'practice', true,  true,  'active', false),
  ('payment',         'practice', true,  true,  'false',  false),
  ('signal',          'practice', true,  true,  null,     false),
  ('calendar_year',   'practice', true,  true,  null,     false),
  ('calendar_day',    'practice', false, false, null,     false),
  ('rule_overlay',    'practice', true,  true,  null,     false),
  ('contact',         'practice', false, false, null,     false),
  ('affiliation',     'practice', false, false, null,     false),
  ('matter_role',     'practice', false, false, null,     false);

delete from rules.vocabulary;
insert into rules.vocabulary (kind, field, value)
select v.kind, v.field, unnest(v.vals) from (values
  ('task',          'state',           array['open', 'completed', 'paused', 'withdrawn']),
  ('task',          'task_type',       array['client', 'admin', 'professional']),
  ('anchor',        'state',           array['active', 'conflicted', 'superseded', 'occurred']),
  ('anchor_source', 'state',           array['pending', 'confirmed', 'conflicted', 'superseded']),
  ('deadline',      'state',           array['active', 'stale', 'superseded', 'not_applicable', 'dismissed', 'met']),
  ('deadline',      'source_type',     array['bc_rules', 'order_term', 'manual']),
  ('deadline',      'review_flag',     array['shift_pending', 'limited_day', 'rule_stale', 'practitioner_choice']),
  ('payment',       'state',           array['false', 'true']),
  ('signal',        'state',           array['confirmed', 'unconfirmed', 'absent']),
  ('calendar_year', 'state',           array['confirmed', 'unavailable']),
  ('calendar_day',  'status_category', array['full_closure', 'limited', 'regional_exception']),
  ('rule_overlay',  'state',           array['verified', 'unverified', 'superseded_by_shipped', 'conflict']),
  ('rule_overlay',  'record.status',   array['verified', 'unverified', 'superseded_by_shipped', 'conflict']),
  ('rule_overlay',  'record.offset.unit',      array['days', 'business_days', 'months', 'years']),
  ('rule_overlay',  'record.offset.direction', array['before', 'after']),
  ('rule_overlay',  'record.counting', array['calendar', 'forward_n_business_days', 'backward_n_business_days', 'backward_full_business_days']),
  ('rule_overlay',  'record.semantics', array['mandatory', 'earliest_permissible', 'latest_permissible', 'permissive']),
  ('rule_overlay',  'record.source.kind', array['oic_pdf', 'consolidation', 'regulation']),
  ('contact',       'entity',          array['person', 'organization']),
  ('matter_role',   'role',            array['client', 'prospective_client', 'opposing_party', 'opposing_counsel',
                                             'co_counsel', 'expert', 'adjuster', 'referral_source'])
) as v(kind, field, vals);

delete from rules.tag;
insert into rules.tag (kind, tag, form, required) values
  ('matter',       'billable',        'boolean', false),
  ('time_entry',   'billable',        'boolean', false),
  ('task',         'task_type',       'vocab',   true),
  ('anchor',       'anchor_type',     'text',    true),
  ('deadline',     'deadline_type',   'text',    true),
  ('deadline',     'source_type',     'vocab',   true),
  ('deadline',     'review_flag',     'vocab',   false),
  ('signal',       'signal_key',      'text',    true),
  ('calendar_day', 'status_category', 'vocab',   true),
  ('rule_overlay', 'deadline_type',   'text',    true),
  ('rule_overlay', 'amending_reg',    'text',    true),
  ('contact',      'entity',          'vocab',   true),
  ('matter_role',  'role',            'vocab',   true);

delete from rules.link_role;
insert into rules.link_role (kind, role, target_kind, required, synced) values
  ('matter',          'client',        'client',        false, true),
  ('time_entry',      'matter',        'matter',        true,  true),
  ('invoice',         'matter',        'matter',        true,  true),
  ('task',            'matter',        'matter',        false, true),
  ('task',            'filing',        null,            false, true),
  ('retainer_notice', 'matter',        'matter',        true,  true),
  ('anchor',          'matter',        'matter',        true,  true),
  ('anchor',          'filing',        null,            false, true),
  ('anchor_source',   'anchor',        'anchor',        true,  true),
  ('deadline',        'matter',        'matter',        false, true),
  ('deadline',        'anchor',        'anchor',        false, true),
  ('payment',         'matter',        'matter',        true,  true),
  ('signal',          'matter',        'matter',        true,  true),
  ('calendar_day',    'calendar_year', 'calendar_year', true,  false),
  ('affiliation',     'person',        'contact',       true,  true),
  ('affiliation',     'organization',  'contact',       true,  true),
  ('matter_role',     'matter',        'matter',        true,  true),
  ('matter_role',     'contact',       'contact',       true,  true);

delete from rules.transition;
insert into rules.transition (kind, from_state, to_state) values
  ('payment', '',      'false'),
  ('payment', 'false', 'true');

delete from rules.natural_key;
insert into rules.natural_key (kind, purpose, rank, parts, states) values
  ('client',        'upsert',    1, array['hash:client_num'], null),
  ('matter',        'upsert',    1, array['hash:file_number'], null),
  ('matter',        'upsert',    2, array['hash:matt_num'], null),
  ('invoice',       'upsert',    1, array['link:matter', 'hash:invoice_number'], null),
  ('signal',        'upsert',    1, array['link:matter', 'tag:signal_key'], null),
  ('calendar_year', 'upsert',    1, array['hash:year'], null),
  ('anchor',        'upsert',    1, array['link:matter', 'tag:anchor_type', 'hash:party_label?', 'hash:proceeding_label?'],
                                  array['active', 'conflicted', 'occurred']),
  ('deadline',      'supersede', 1, array['link:matter*', 'link:anchor?', 'tag:deadline_type', 'hash:party_label?',
                                        'hash:proceeding_label?', 'hash:scenario_label?'],
                                  array['active']),
  ('affiliation',   'upsert',    1, array['link:person', 'link:organization', 'hash:from?'], null),
  ('matter_role',   'upsert',    1, array['link:matter', 'link:contact', 'tag:role', 'hash:case_proceeding_id?'], null);

delete from rules.status_policy;
insert into rules.status_policy (status_label, required_signals, blocking_signals, auto_advance, description) values
  ('prospective',       '{}', '{conflict_check_completed}', true, 'File opened; conflict check not yet completed'),
  ('intake',            '{conflict_check_completed}', '{retainer_agreement_signed}', true, 'Conflict check done; retainer agreement not yet signed'),
  ('active',            '{retainer_agreement_signed,deposit_received}', null, true, 'Retainer signed and deposit received; work in progress'),
  ('retainer_warning',  '{retainer_agreement_signed}', null, true, 'Active matter; retainer balance at or below replenishment threshold'),
  ('retainer_depleted', '{retainer_agreement_signed}', null, true, 'Active matter; retainer balance confirmed zero'),
  ('closing',           '{}', null, false, 'Work substantially complete; representation not yet formally ended'),
  ('closed',            '{representation_ended}', null, true, 'Representation formally ended'),
  ('declined',          '{conflict_check_completed}', null, false, 'Conflict identified or matter not accepted');

-- -----------------------------------------------------------------------------
-- Small helpers
-- -----------------------------------------------------------------------------

-- Every refusal and interface error goes through here. apply_write catches
-- SQLSTATE PR001 and returns its message as the question; any other error is a
-- fault and is raised to the caller.
create or replace function rules.refuse(p_question text)
returns void language plpgsql
set search_path = pg_catalog, pg_temp
as $f$
begin
  raise exception using errcode = 'PR001', message = p_question;
end;
$f$;

create or replace function rules.obj(p_value jsonb)
returns jsonb language sql immutable
set search_path = pg_catalog, pg_temp
as $f$
  select case when jsonb_typeof(p_value) = 'object' then p_value else '{}'::jsonb end;
$f$;

create or replace function rules.is_uuid(p_value jsonb)
returns boolean language sql immutable
set search_path = pg_catalog, pg_temp
as $f$
  select coalesce(jsonb_typeof(p_value) = 'string'
    and (p_value #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false);
$f$;

create or replace function rules.is_text(p_value jsonb)
returns boolean language sql immutable
set search_path = pg_catalog, pg_temp
as $f$
  select coalesce(jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') ~ '\S', false);
$f$;

create or replace function rules.is_snake(p_value jsonb)
returns boolean language sql immutable
set search_path = pg_catalog, pg_temp
as $f$
  select coalesce(jsonb_typeof(p_value) = 'string'
    and (p_value #>> '{}') ~ '^[a-z][a-z0-9]*(_[a-z0-9]+)*$', false);
$f$;

create or replace function rules.is_iso_date(p_value jsonb)
returns boolean language plpgsql immutable
set search_path = pg_catalog, pg_temp
as $f$
declare
  v text;
begin
  if jsonb_typeof(p_value) is distinct from 'string' then
    return false;
  end if;
  v := p_value #>> '{}';
  if v !~ '^\d{4}-\d{2}-\d{2}$' then
    return false;
  end if;
  return to_char(v::date, 'YYYY-MM-DD') = v;
exception when others then
  return false;
end;
$f$;

create or replace function rules.in_vocab(p_kind text, p_field text, p_value jsonb)
returns boolean language sql stable
set search_path = pg_catalog, pg_temp
as $f$
  select coalesce(jsonb_typeof(p_value) = 'string' and exists (
    select 1 from rules.vocabulary v
    where v.kind = p_kind and v.field = p_field and v.value = p_value #>> '{}'), false);
$f$;

create or replace function rules.op_result(p_id uuid, p_saved boolean, p_as uuid)
returns jsonb language sql immutable
set search_path = pg_catalog, pg_temp
as $f$
  select jsonb_build_object('id', p_id, 'saved', p_saved, 'as', p_as);
$f$;

-- Replaces each link value that names an earlier op of the same write with the
-- item that op was saved to.
create or replace function rules.remap_links(p_op jsonb, p_map jsonb)
returns jsonb language sql immutable
set search_path = pg_catalog, pg_temp
as $f$
  select case when jsonb_typeof(p_op->'links') = 'object' then
    p_op || jsonb_build_object('links', coalesce((
      select jsonb_object_agg(e.key,
        case when jsonb_typeof(e.value) = 'string' and p_map ? (e.value #>> '{}')
             then p_map->(e.value #>> '{}') else e.value end)
      from jsonb_each(p_op->'links') e), '{}'::jsonb))
  else p_op end;
$f$;

create or replace function rules.synced_links(p_kind text, p_links jsonb)
returns jsonb language sql stable
set search_path = pg_catalog, pg_temp
as $f$
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
  from jsonb_each(p_links) e
  where not exists (
    select 1 from rules.link_role l where l.kind = p_kind and l.role = e.key and not l.synced);
$f$;

create or replace function rules.signal_state(p_tenant uuid, p_matter uuid, p_key text)
returns text language sql stable
set search_path = pg_catalog, pg_temp
as $f$
  select i.state from ledger.item i
  where i.tenant = p_tenant and i.kind = 'signal' and not i.deleted
    and i.links->>'matter' = p_matter::text and i.tags->>'signal_key' = p_key
  order by i.created_seq, i.id
  limit 1;
$f$;

-- -----------------------------------------------------------------------------
-- Natural keys
-- -----------------------------------------------------------------------------

create or replace function rules.part_value(p_part text, p_tags jsonb, p_links jsonb, p_hashes jsonb)
returns text language sql immutable
set search_path = pg_catalog, pg_temp
as $f$
  select case split_part(p_part, ':', 1)
    when 'tag'  then p_tags   ->> rtrim(split_part(p_part, ':', 2), '?*')
    when 'link' then p_links  ->> rtrim(split_part(p_part, ':', 2), '?*')
    when 'hash' then p_hashes ->> rtrim(split_part(p_part, ':', 2), '?*')
  end;
$f$;

-- True when the op supplies every strict part of the key.
create or replace function rules.key_usable(p_parts text[], p_tags jsonb, p_links jsonb, p_hashes jsonb)
returns boolean language sql immutable
set search_path = pg_catalog, pg_temp
as $f$
  select not exists (
    select 1 from unnest(p_parts) p
    where right(p, 1) not in ('?', '*') and rules.part_value(p, p_tags, p_links, p_hashes) is null);
$f$;

create or replace function rules.key_equal(
  p_parts text[],
  p_item_tags jsonb, p_item_links jsonb, p_item_hashes jsonb,
  p_tags jsonb, p_links jsonb, p_hashes jsonb)
returns boolean language plpgsql immutable
set search_path = pg_catalog, pg_temp
as $f$
declare
  v_part text;
  v_mine text;
  v_theirs text;
begin
  foreach v_part in array p_parts loop
    v_mine := rules.part_value(v_part, p_tags, p_links, p_hashes);
    v_theirs := rules.part_value(v_part, p_item_tags, p_item_links, p_item_hashes);
    if right(v_part, 1) = '?' then
      if coalesce(v_mine, '') <> coalesce(v_theirs, '') then return false; end if;
    elsif right(v_part, 1) = '*' then
      if v_mine is not null and v_mine is distinct from v_theirs then return false; end if;
    elsif v_mine is null or v_mine is distinct from v_theirs then
      return false;
    end if;
  end loop;
  return true;
end;
$f$;

create or replace function rules.key_matches(
  p_tenant uuid, p_kind text, p_parts text[], p_states text[],
  p_tags jsonb, p_links jsonb, p_hashes jsonb, p_skip uuid)
returns uuid[] language sql stable
set search_path = pg_catalog, pg_temp
as $f$
  select coalesce(array_agg(i.id order by i.created_seq, i.created_at, i.id), '{}'::uuid[])
  from ledger.item i
  where i.tenant = p_tenant and i.kind = p_kind and not i.deleted
    and (p_states is null or i.state = any (p_states))
    and (p_skip is null or i.id <> p_skip)
    and rules.key_equal(p_parts, i.tags, i.links, i.hashes, p_tags, p_links, p_hashes);
$f$;

-- The items an upsert matches. A kind with no upsert key matches by id.
create or replace function rules.upsert_matches(p_tenant uuid, p_kind text, p_op jsonb)
returns uuid[] language plpgsql stable
set search_path = pg_catalog, pg_temp
as $f$
declare
  r record;
  v_tags jsonb := rules.obj(p_op->'tags');
  v_links jsonb := rules.obj(p_op->'links');
  v_hashes jsonb := rules.obj(p_op->'hashes');
begin
  if not exists (select 1 from rules.natural_key k where k.kind = p_kind and k.purpose = 'upsert') then
    return array(select i.id from ledger.item i
                 where i.tenant = p_tenant and i.id = (p_op->>'id')::uuid and not i.deleted);
  end if;
  for r in
    select k.parts, k.states from rules.natural_key k
    where k.kind = p_kind and k.purpose = 'upsert' order by k.rank
  loop
    if rules.key_usable(r.parts, v_tags, v_links, v_hashes) then
      return rules.key_matches(p_tenant, p_kind, r.parts, r.states, v_tags, v_links, v_hashes, null);
    end if;
  end loop;
  return '{}'::uuid[];
end;
$f$;

-- -----------------------------------------------------------------------------
-- Interface checks: the shape of a write, an op and an item (R2's vocabularies)
-- -----------------------------------------------------------------------------

create or replace function rules.check_op(p_op jsonb, p_index integer, p_store text)
returns void language plpgsql stable
set search_path = pg_catalog, pg_temp
as $f$
declare
  v_id text;
  v_kind text;
  v_part text;
  v_field text;
begin
  if jsonb_typeof(p_op) is distinct from 'object' then
    perform rules.refuse(format('What is op %s of this write? It is not an object.', p_index));
  end if;
  if not rules.is_uuid(p_op->'id') then
    perform rules.refuse(format('Which item is op %s about? Its id is missing or is not a UUID.', p_index));
  end if;
  v_id := p_op->>'id';
  if coalesce(p_op->>'op', '') not in ('create', 'upsert', 'update', 'delete') then
    perform rules.refuse(format(
      'What should op %s do to {{item:%s}}? Its op is not create, upsert, update or delete.', p_index, v_id));
  end if;
  v_kind := p_op->>'kind';
  if v_kind is null or not exists (select 1 from rules.kind k where k.kind = v_kind and k.store = p_store) then
    perform rules.refuse(format(
      'What kind of item is {{item:%s}}? Its kind is missing or is not one this store holds.', v_id));
  end if;
  foreach v_part in array array['tags', 'links', 'hashes'] loop
    if p_op ? v_part and jsonb_typeof(p_op->v_part) not in ('object', 'null') then
      perform rules.refuse(format('What are the %s of {{item:%s}}? They are not an object.', v_part, v_id));
    end if;
  end loop;
  if p_op ? 'state' and jsonb_typeof(p_op->'state') not in ('string', 'null') then
    perform rules.refuse(format('What state is {{item:%s}} in? The state given is not text.', v_id));
  end if;
  if p_op ? 'cross' and jsonb_typeof(p_op->'cross') <> 'null' and v_kind <> 'rule_overlay' then
    perform rules.refuse(format('What is the cross record on {{item:%s}}? This kind of item carries none.', v_id));
  end if;
  select e.key into v_field
  from jsonb_each(rules.obj(p_op->'hashes')) e
  where jsonb_typeof(e.value) <> 'null'
    and not (jsonb_typeof(e.value) = 'string' and (e.value #>> '{}') ~ '^[0-9a-f]{64}$')
  order by e.key limit 1;
  if v_field is not null then
    perform rules.refuse(format(
      'What is the hash of %s on {{item:%s}}? It is neither a 64-character hex HMAC nor null.', v_field, v_id));
  end if;
end;
$f$;

-- The item as it would be saved: its state, tags and links against the kind's
-- vocabularies and link roles. p_op names the links this write supplies (their
-- targets are checked); on a create every link is checked.
create or replace function rules.check_item(p_new ledger.item, p_op jsonb, p_create boolean)
returns void language plpgsql stable
set search_path = pg_catalog, pg_temp
as $f$
declare
  v_kind rules.kind;
  r record;
begin
  select * into v_kind from rules.kind k where k.kind = p_new.kind;

  if not v_kind.has_state and p_new.state is not null then
    perform rules.refuse(format('What state is {{item:%s}} meant to have? This kind of item has none.', p_new.id));
  end if;
  if v_kind.state_required and p_new.state is null then
    perform rules.refuse(format('What state is {{item:%s}} in?', p_new.id));
  end if;
  if p_new.state is not null
     and exists (select 1 from rules.vocabulary v where v.kind = p_new.kind and v.field = 'state')
     and not rules.in_vocab(p_new.kind, 'state', to_jsonb(p_new.state)) then
    perform rules.refuse(format('What state is {{item:%s}} in? The one given is not a known state for it.', p_new.id));
  end if;

  for r in
    select e.key, e.value, t.form
    from jsonb_each(p_new.tags) e
    left join rules.tag t on t.kind = p_new.kind and t.tag = e.key
    order by e.key
  loop
    if r.form is null then
      perform rules.refuse(format('What is the tag %s on {{item:%s}}? It is not one this kind of item carries.', r.key, p_new.id));
    elsif r.form = 'boolean' and jsonb_typeof(r.value) <> 'boolean' then
      perform rules.refuse(format('Is {{item:%s}} %s? The value given is not true or false.', p_new.id, r.key));
    elsif r.form in ('text', 'vocab') and jsonb_typeof(r.value) <> 'string' then
      perform rules.refuse(format('What is the %s of {{item:%s}}? The value given is not text.', r.key, p_new.id));
    elsif r.form = 'vocab' and not rules.in_vocab(p_new.kind, r.key, r.value) then
      perform rules.refuse(format('Which %s is {{item:%s}}? The one given is not a known value.', r.key, p_new.id));
    end if;
  end loop;
  for r in
    select t.tag from rules.tag t
    where t.kind = p_new.kind and t.required and not (p_new.tags ? t.tag)
    order by t.tag
  loop
    perform rules.refuse(format('What is the %s of {{item:%s}}?', r.tag, p_new.id));
  end loop;

  for r in
    select e.key, e.value, l.role, l.target_kind
    from jsonb_each(p_new.links) e
    left join rules.link_role l on l.kind = p_new.kind and l.role = e.key
    order by e.key
  loop
    if r.role is null then
      perform rules.refuse(format('What is the %s link on {{item:%s}}? It is not a link this kind of item has.', r.key, p_new.id));
    elsif r.target_kind is null then
      if jsonb_typeof(r.value) <> 'string' then
        perform rules.refuse(format('Which %s does {{item:%s}} point to? The value given is not text.', r.key, p_new.id));
      end if;
    elsif p_create or rules.obj(p_op->'links') ? r.key then
      if not rules.is_uuid(r.value) then
        perform rules.refuse(format('Which %s is {{item:%s}} for? The link given is not an item id.', r.key, p_new.id));
      end if;
      if not exists (
        select 1 from ledger.item i
        where i.tenant = p_new.tenant and i.id = (r.value #>> '{}')::uuid
          and i.kind = r.target_kind and not i.deleted) then
        perform rules.refuse(format('Which %s is {{item:%s}} for? {{item:%s}} is not a recorded %s.',
          r.key, p_new.id, r.value #>> '{}', replace(r.target_kind, '_', ' ')));
      end if;
    end if;
  end loop;
  for r in
    select l.role from rules.link_role l
    where l.kind = p_new.kind and l.required and not (p_new.links ? l.role)
    order by l.role
  loop
    perform rules.refuse(format('Which %s is {{item:%s}} for?', r.role, p_new.id));
  end loop;
end;
$f$;

create or replace function rules.check_transition(p_kind text, p_from text, p_to text, p_id uuid)
returns void language plpgsql stable
set search_path = pg_catalog, pg_temp
as $f$
begin
  if p_to is distinct from p_from
     and exists (select 1 from rules.transition t where t.kind = p_kind)
     and not exists (
       select 1 from rules.transition t
       where t.kind = p_kind and t.from_state = coalesce(p_from, '') and t.to_state = p_to) then
    perform rules.refuse(format('Is {{item:%s}} really moving from %s to %s?', p_id, coalesce(p_from, 'nothing'), p_to));
  end if;
end;
$f$;

-- -----------------------------------------------------------------------------
-- R9. The rule overlay record (deadline-rule-overlay spec section 6). Returns
-- the question for the first fault found, or null. The matter-code guard runs
-- on the user's machine before the record is sent.
-- -----------------------------------------------------------------------------

create or replace function rules.overlay_question(p_id uuid, p_rec jsonb)
returns text language plpgsql stable
set search_path = pg_catalog, pg_temp
as $f$
declare
  v_item text := format('{{item:%s}}', p_id);
  v_fields text[] := array['record_id', 'jurisdiction', 'enactment', 'amending_instrument', 'deadline_type',
    'anchor_type', 'base', 'rule_ref', 'offset', 'counting', 'semantics', 'description', 'verbatim', 'source',
    'effective_from', 'effective_to', 'supersedes', 'open_questions', 'status', 'verified_by', 'verified_at', 'pool_id'];
  v_nested jsonb := '{"enactment": ["name", "citation", "civix_id"],
                      "amending_instrument": ["reg", "oic", "commencement"],
                      "offset": ["value", "unit", "direction", "clear"],
                      "source": ["url", "fetched_at", "kind"]}';
  v_key text;
  v_sub text;
  v_off jsonb;
  v_value jsonb;
  v_index integer;
begin
  if jsonb_typeof(p_rec) is distinct from 'object' then
    return format('What does the overlay record %s say? It is not an object.', v_item);
  end if;
  select k into v_key from jsonb_object_keys(p_rec) k where k <> all (v_fields) order by k limit 1;
  if v_key is not null then
    return format('What is record.%s in %s? It is not a field of an overlay record.', v_key, v_item);
  end if;
  select f into v_key from unnest(v_fields) with ordinality as t(f, n)
  where f not in ('record_id', 'pool_id') and not (p_rec ? f) order by n limit 1;
  if v_key is not null then
    return format('What is record.%s of %s? It is missing (a field with no value is sent as null).', v_key, v_item);
  end if;
  foreach v_key in array array['enactment', 'amending_instrument', 'source', 'offset'] loop
    v_value := p_rec->v_key;
    continue when v_key = 'offset' and jsonb_typeof(v_value) = 'null';
    if jsonb_typeof(v_value) is distinct from 'object' then
      return format('What is record.%s of %s? It is not an object.', v_key, v_item);
    end if;
    select k into v_sub from jsonb_object_keys(v_value) k
    where not (v_nested->v_key ? k) order by k limit 1;
    if v_sub is not null then
      return format('What is record.%s.%s in %s? It is not a field of record.%s.', v_key, v_sub, v_item, v_key);
    end if;
    select f into v_sub from jsonb_array_elements_text(v_nested->v_key) with ordinality as t(f, n)
    where not (v_value ? f) order by n limit 1;
    if v_sub is not null then
      return format('What is record.%s.%s of %s? It is missing (a field with no value is sent as null).', v_key, v_sub, v_item);
    end if;
  end loop;

  if p_rec ? 'record_id' and jsonb_typeof(p_rec->'record_id') <> 'null' and not rules.is_uuid(p_rec->'record_id') then
    return format('Which record is %s? record.record_id is not a UUID.', v_item);
  end if;
  if lower(coalesce(p_rec->>'record_id', '')) <> lower(p_id::text) then
    return format('Which record is %s? record.record_id is not its item id.', v_item);
  end if;
  if p_rec->>'jurisdiction' is distinct from 'CA-BC' or jsonb_typeof(p_rec->'jurisdiction') <> 'string' then
    return format('Which jurisdiction is %s for?', v_item);
  end if;
  foreach v_key in array array['name', 'citation', 'civix_id'] loop
    if not rules.is_text(p_rec->'enactment'->v_key) then
      return format('What is record.enactment.%s of %s? It is empty.', v_key, v_item);
    end if;
  end loop;
  if not rules.is_text(p_rec->'amending_instrument'->'reg') then
    return format('Which regulation amends the rule in %s? record.amending_instrument.reg is empty.', v_item);
  end if;
  if jsonb_typeof(p_rec->'amending_instrument'->'oic') not in ('null', 'string') then
    return format('What is record.amending_instrument.oic of %s? It is neither text nor null.', v_item);
  end if;
  if not rules.is_iso_date(p_rec->'amending_instrument'->'commencement') then
    return format('On what date did the amending instrument of %s commence? record.amending_instrument.commencement is not a YYYY-MM-DD date.', v_item);
  end if;
  foreach v_key in array array['deadline_type', 'anchor_type'] loop
    if not rules.is_snake(p_rec->v_key) then
      return format('What is record.%s of %s, in lower case with underscores?', v_key, v_item);
    end if;
  end loop;
  if not rules.is_text(p_rec->'rule_ref') then
    return format('Which rule does %s record? record.rule_ref is empty.', v_item);
  end if;

  v_off := p_rec->'offset';
  if jsonb_typeof(v_off) = 'null' then
    foreach v_key in array array['counting', 'semantics', 'base'] loop
      if jsonb_typeof(p_rec->v_key) <> 'null' then
        return format('Is %s a repeal? It has no offset but gives record.%s.', v_item, v_key);
      end if;
    end loop;
  else
    if jsonb_typeof(v_off->'value') is distinct from 'number' then
      return format('How many units does the offset of %s run? record.offset.value is not a whole number of zero or more.', v_item);
    end if;
    if (v_off->>'value')::numeric <> trunc((v_off->>'value')::numeric) or (v_off->>'value')::numeric < 0 then
      return format('How many units does the offset of %s run? record.offset.value is not a whole number of zero or more.', v_item);
    end if;
    if not rules.in_vocab('rule_overlay', 'record.offset.unit', v_off->'unit') then
      return format('In which unit is the offset of %s counted? record.offset.unit is not a known unit.', v_item);
    end if;
    if not rules.in_vocab('rule_overlay', 'record.offset.direction', v_off->'direction') then
      return format('Does the offset of %s run before or after its base? record.offset.direction is neither.', v_item);
    end if;
    if jsonb_typeof(v_off->'clear') is distinct from 'boolean' then
      return format('Is the offset of %s counted in clear days? record.offset.clear is not true or false.', v_item);
    end if;
    foreach v_key in array array['counting', 'semantics', 'base'] loop
      if jsonb_typeof(p_rec->v_key) = 'null' then
        return format('What is record.%s of %s?', v_key, v_item);
      end if;
    end loop;
    if not rules.in_vocab('rule_overlay', 'record.counting', p_rec->'counting') then
      return format('Which counting method does %s use? record.counting is not a known method.', v_item);
    end if;
    if not rules.in_vocab('rule_overlay', 'record.semantics', p_rec->'semantics') then
      return format('What kind of time limit does %s set? record.semantics is not a known kind.', v_item);
    end if;
    if not rules.is_snake(p_rec->'base') then
      return format('What is record.base of %s, in lower case with underscores?', v_item);
    end if;
  end if;

  if not rules.is_text(p_rec->'description') then
    return format('How would you describe the rule in %s? record.description is empty.', v_item);
  end if;
  if not rules.is_text(p_rec->'verbatim') then
    return format('What are the words of the rule in %s? record.verbatim is empty.', v_item);
  end if;
  if jsonb_typeof(p_rec->'source'->'url') is distinct from 'string'
     or (p_rec->'source'->>'url') !~* '^https?://[^\s/?#]+([/?#]\S*)?$' then
    return format('Where was %s fetched from? record.source.url is not an http or https address.', v_item);
  end if;
  if not rules.is_iso_date(p_rec->'source'->'fetched_at') then
    return format('On what date was %s fetched? record.source.fetched_at is not a YYYY-MM-DD date.', v_item);
  end if;
  if not rules.in_vocab('rule_overlay', 'record.source.kind', p_rec->'source'->'kind') then
    return format('What kind of source is %s taken from? record.source.kind is not a known kind.', v_item);
  end if;

  if not rules.is_iso_date(p_rec->'effective_from') then
    return format('From what date does %s take effect? record.effective_from is not a YYYY-MM-DD date.', v_item);
  end if;
  if jsonb_typeof(p_rec->'effective_to') <> 'null' then
    if not rules.is_iso_date(p_rec->'effective_to') then
      return format('On what date does %s stop taking effect? record.effective_to is not a YYYY-MM-DD date.', v_item);
    end if;
    if (p_rec->>'effective_to') < (p_rec->>'effective_from') then
      return format('Does %s end before it takes effect? record.effective_to falls before record.effective_from.', v_item);
    end if;
  end if;

  if jsonb_typeof(p_rec->'supersedes') is distinct from 'array' then
    return format('What does %s supersede? record.supersedes is not a list of text.', v_item);
  end if;
  if exists (select 1 from jsonb_array_elements(p_rec->'supersedes') e where jsonb_typeof(e) <> 'string') then
    return format('What does %s supersede? record.supersedes is not a list of text.', v_item);
  end if;
  select n - 1 into v_index
  from jsonb_array_elements(p_rec->'supersedes') with ordinality as t(e, n)
  where not ((e #>> '{}') ~ '^shipped:[a-z][a-z0-9]*(_[a-z0-9]+)*$'
             or (rules.is_uuid(e) and lower(e #>> '{}') <> lower(p_id::text)))
  order by n limit 1;
  if v_index is not null then
    return format('What does %s supersede at record.supersedes[%s]?', v_item, v_index);
  end if;
  if jsonb_typeof(p_rec->'open_questions') is distinct from 'array' then
    return format('What questions does %s leave open? record.open_questions is not a list of text.', v_item);
  end if;
  if exists (select 1 from jsonb_array_elements(p_rec->'open_questions') e where jsonb_typeof(e) <> 'string') then
    return format('What questions does %s leave open? record.open_questions is not a list of text.', v_item);
  end if;

  if not rules.in_vocab('rule_overlay', 'record.status', p_rec->'status') then
    return format('Has %s been verified? record.status is not a known status.', v_item);
  end if;
  if jsonb_typeof(p_rec->'verified_by') <> 'null' and p_rec->'verified_by' <> '"practitioner"'::jsonb then
    return format('Who verified %s?', v_item);
  end if;
  if jsonb_typeof(p_rec->'verified_at') <> 'null' and not rules.is_iso_date(p_rec->'verified_at') then
    return format('On what date was %s verified? record.verified_at is not a YYYY-MM-DD date.', v_item);
  end if;
  if p_rec->>'status' = 'verified'
     and (jsonb_typeof(p_rec->'verified_by') = 'null' or jsonb_typeof(p_rec->'verified_at') = 'null') then
    return format('Who verified %s, and on what date?', v_item);
  end if;
  if p_rec ? 'pool_id' and jsonb_typeof(p_rec->'pool_id') <> 'null' and not rules.is_uuid(p_rec->'pool_id') then
    return format('Which pooled record did %s come from? record.pool_id is not a UUID.', v_item);
  end if;
  return null;
end;
$f$;

-- -----------------------------------------------------------------------------
-- The function per kind. Each takes the item as it would be saved and returns
-- it, possibly with tags the rules add; each may refuse, and may change other
-- items as a side effect.
-- -----------------------------------------------------------------------------

-- R1 (the set_status check) and R6 (a new matter is billable unless told).
create or replace function rules.kind_matter(
  p_tenant uuid, p_seq bigint, p_write jsonb, p_op jsonb, p_create boolean, p_cur ledger.item, p_new ledger.item)
returns ledger.item language plpgsql stable
set search_path = pg_catalog, pg_temp
as $f$
declare
  v_policy rules.status_policy;
  v_signal text;
begin
  if p_create and not (p_new.tags ? 'billable') then
    p_new.tags := p_new.tags || '{"billable": true}'::jsonb;
  end if;
  if p_write->>'tool' = 'set_status' and p_op ? 'state' then
    select * into v_policy from rules.status_policy s where s.status_label = p_new.state;
    if not found then
      perform rules.refuse(format('Which lifecycle stage is {{item:%s}} in?', p_new.id));
    end if;
    foreach v_signal in array v_policy.required_signals loop
      if rules.signal_state(p_tenant, p_new.id, v_signal) is distinct from 'confirmed' then
        perform rules.refuse(format('Has %s been confirmed for {{item:%s}}?', v_signal, p_new.id));
      end if;
    end loop;
    foreach v_signal in array coalesce(v_policy.blocking_signals, '{}'::text[]) loop
      if rules.signal_state(p_tenant, p_new.id, v_signal) = 'confirmed' then
        perform rules.refuse(format('Has {{item:%s}} moved past %s, now that %s is confirmed?',
          p_new.id, p_new.state, v_signal));
      end if;
    end loop;
  end if;
  return p_new;
end;
$f$;

-- R6. A new time entry takes its matter's billable flag unless it carries one.
create or replace function rules.kind_time_entry(
  p_tenant uuid, p_seq bigint, p_write jsonb, p_op jsonb, p_create boolean, p_cur ledger.item, p_new ledger.item)
returns ledger.item language plpgsql stable
set search_path = pg_catalog, pg_temp
as $f$
declare
  v_billable boolean;
begin
  if p_create and not (p_new.tags ? 'billable') then
    select coalesce((m.tags->>'billable')::boolean, true) into v_billable
    from ledger.item m
    where m.tenant = p_tenant and m.id = (p_new.links->>'matter')::uuid;
    p_new.tags := p_new.tags || jsonb_build_object('billable', coalesce(v_billable, true));
  end if;
  return p_new;
end;
$f$;

-- R6 (a non-billable matter takes no invoice) and R7 (an invoice with no number
-- replaces the matter's earlier invoices with no number; the merge by number is
-- the upsert key).
create or replace function rules.kind_invoice(
  p_tenant uuid, p_seq bigint, p_write jsonb, p_op jsonb, p_create boolean, p_cur ledger.item, p_new ledger.item)
returns ledger.item language plpgsql
set search_path = pg_catalog, pg_temp
as $f$
declare
  v_matter text := p_new.links->>'matter';
begin
  if exists (
    select 1 from ledger.item m
    where m.tenant = p_tenant and m.id = v_matter::uuid and m.tags->'billable' = 'false'::jsonb) then
    perform rules.refuse(format('Should {{item:%s}}, which is recorded as not billable, take this invoice?', v_matter));
  end if;
  if p_create and p_new.hashes->>'invoice_number' is null then
    update ledger.item i
    set deleted = true, seq = p_seq, updated_at = now()
    where i.tenant = p_tenant and i.kind = 'invoice' and not i.deleted
      and i.links->>'matter' = v_matter and i.hashes->>'invoice_number' is null
      and i.created_seq <> p_seq and i.id <> p_new.id;
  end if;
  return p_new;
end;
$f$;

-- R3. One open to-do per (matter, filing), and a filing link needs a matter.
-- An update that supplies none of matter, filing or state is not checked, so a
-- nudge advance on two to-dos that already share a filing still lands.
create or replace function rules.kind_task(
  p_tenant uuid, p_seq bigint, p_write jsonb, p_op jsonb, p_create boolean, p_cur ledger.item, p_new ledger.item)
returns ledger.item language plpgsql stable
set search_path = pg_catalog, pg_temp
as $f$
declare
  v_links jsonb := rules.obj(p_op->'links');
  v_holder uuid;
begin
  if (v_links->>'filing') is not null and (p_new.links->>'matter') is null then
    perform rules.refuse(format('Which matter''s filing does the to-do {{item:%s}} point to?', p_new.id));
  end if;
  if not p_create and not (v_links ? 'matter' or v_links ? 'filing' or p_op ? 'state') then
    return p_new;
  end if;
  if p_new.state = 'open' and (p_new.links->>'filing') is not null and (p_new.links->>'matter') is not null then
    select i.id into v_holder from ledger.item i
    where i.tenant = p_tenant and i.kind = 'task' and not i.deleted and i.state = 'open'
      and i.links->>'matter' = p_new.links->>'matter' and i.links->>'filing' = p_new.links->>'filing'
      and i.id <> p_new.id
    order by i.created_seq, i.created_at, i.id
    limit 1;
    if v_holder is not null then
      perform rules.refuse(format(
        'Is this work part of the open to-do {{item:%s}}, which already covers this filing?', v_holder));
    end if;
  end if;
  return p_new;
end;
$f$;

-- R5. A new deadline supersedes the active one with its natural key; a
-- provisional alternative carries a scenario and a note, and only an
-- alternative carries a scenario; a rule_stale alternative is not resolved.
create or replace function rules.kind_deadline(
  p_tenant uuid, p_seq bigint, p_write jsonb, p_op jsonb, p_create boolean, p_cur ledger.item, p_new ledger.item)
returns ledger.item language plpgsql
set search_path = pg_catalog, pg_temp
as $f$
declare
  v_choice boolean := p_new.tags->>'review_flag' = 'practitioner_choice';
  v_parts text[];
  v_states text[];
  v_hashes jsonb := rules.obj(p_op->'hashes');
begin
  if p_create then
    if v_choice and (p_new.hashes->>'scenario_label' is null or p_new.hashes->>'review_note' is null) then
      perform rules.refuse(format(
        'Which scenario does the alternative date {{item:%s}} cover, and what open question does it turn on?', p_new.id));
    end if;
    if not v_choice and p_new.hashes->>'scenario_label' is not null then
      perform rules.refuse(format('Is {{item:%s}} one of several alternative dates awaiting a choice?', p_new.id));
    end if;
    select k.parts, k.states into v_parts, v_states from rules.natural_key k
    where k.kind = 'deadline' and k.purpose = 'supersede' and k.rank = 1;
    update ledger.item i
    set state = 'superseded', seq = p_seq, updated_at = now()
    where i.tenant = p_tenant
      and i.id = any (rules.key_matches(p_tenant, 'deadline', v_parts, v_states,
                                        p_new.tags, p_new.links, p_new.hashes, p_new.id));
  elsif v_hashes ? 'scenario_label' and v_hashes->>'scenario_label' is null
        and rules.obj(p_op->'tags')->>'review_flag' is distinct from 'rule_stale'
        and p_cur.tags->>'review_flag' = 'rule_stale' then
    perform rules.refuse(format('Has {{item:%s}} been recalculated since its rule changed?', p_new.id));
  end if;
  return p_new;
end;
$f$;

-- R11. One signal per (matter, signal_key); the upsert key keeps its id.
create or replace function rules.kind_signal(
  p_tenant uuid, p_seq bigint, p_write jsonb, p_op jsonb, p_create boolean, p_cur ledger.item, p_new ledger.item)
returns ledger.item language plpgsql stable
set search_path = pg_catalog, pg_temp
as $f$
declare
  v_other uuid;
begin
  select i.id into v_other from ledger.item i
  where i.tenant = p_tenant and i.kind = 'signal' and not i.deleted and i.id <> p_new.id
    and i.links->>'matter' = p_new.links->>'matter' and i.tags->>'signal_key' = p_new.tags->>'signal_key'
  limit 1;
  if v_other is not null then
    perform rules.refuse(format('Is this the signal {{item:%s}} already recorded for this matter?', v_other));
  end if;
  return p_new;
end;
$f$;

-- R9. The record travels as the cross payload; its tags and state repeat it.
create or replace function rules.kind_rule_overlay(
  p_tenant uuid, p_seq bigint, p_write jsonb, p_op jsonb, p_create boolean, p_cur ledger.item, p_new ledger.item)
returns ledger.item language plpgsql stable
set search_path = pg_catalog, pg_temp
as $f$
declare
  v_question text;
begin
  if p_new.cross_payload is null then
    perform rules.refuse(format('What does the overlay record {{item:%s}} say? It carries no record.', p_new.id));
  end if;
  v_question := rules.overlay_question(p_new.id, p_new.cross_payload);
  if v_question is not null then
    perform rules.refuse(v_question);
  end if;
  if p_new.state is distinct from p_new.cross_payload->>'status'
     or p_new.tags->>'deadline_type' is distinct from p_new.cross_payload->>'deadline_type'
     or p_new.tags->>'amending_reg' is distinct from p_new.cross_payload #>> '{amending_instrument,reg}' then
    perform rules.refuse(format('Which is right for {{item:%s}}: its tags and state, or its record? They differ.', p_new.id));
  end if;
  return p_new;
end;
$f$;

-- R12. A contact has a name (firm-wide contacts spec 4.1).
create or replace function rules.kind_contact(
  p_tenant uuid, p_seq bigint, p_write jsonb, p_op jsonb, p_create boolean, p_cur ledger.item, p_new ledger.item)
returns ledger.item language plpgsql stable
set search_path = pg_catalog, pg_temp
as $f$
begin
  if p_new.hashes->>'name' is null then
    perform rules.refuse(format('What is the name of {{item:%s}}?', p_new.id));
  end if;
  return p_new;
end;
$f$;

-- R12. An affiliation ties a person to an organization.
create or replace function rules.kind_affiliation(
  p_tenant uuid, p_seq bigint, p_write jsonb, p_op jsonb, p_create boolean, p_cur ledger.item, p_new ledger.item)
returns ledger.item language plpgsql stable
set search_path = pg_catalog, pg_temp
as $f$
declare
  v_person text := p_new.links->>'person';
  v_org text := p_new.links->>'organization';
begin
  if exists (
    select 1 from ledger.item c
    where c.tenant = p_tenant and c.id = v_person::uuid and c.tags->>'entity' is distinct from 'person') then
    perform rules.refuse(format('Is {{item:%s}} a person?', v_person));
  end if;
  if exists (
    select 1 from ledger.item c
    where c.tenant = p_tenant and c.id = v_org::uuid and c.tags->>'entity' is distinct from 'organization') then
    perform rules.refuse(format('Is {{item:%s}} an organization?', v_org));
  end if;
  return p_new;
end;
$f$;

-- R12. A contact that an affiliation or a matter role still points to stays.
create or replace function rules.kind_contact_delete(p_tenant uuid, p_contact uuid)
returns void language plpgsql stable
set search_path = pg_catalog, pg_temp
as $f$
declare
  v_holder uuid;
begin
  select i.id into v_holder from ledger.item i
  where i.tenant = p_tenant and not i.deleted and i.kind in ('affiliation', 'matter_role')
    and p_contact::text in (i.links->>'person', i.links->>'organization', i.links->>'contact')
  order by i.created_seq, i.created_at, i.id
  limit 1;
  if v_holder is not null then
    perform rules.refuse(format('Which contact replaces {{item:%s}} on {{item:%s}}?', p_contact, v_holder));
  end if;
end;
$f$;

-- R8. Deleting an anchor deletes its sources and the deadlines derived from it.
create or replace function rules.kind_anchor_delete(p_tenant uuid, p_seq bigint, p_anchor uuid)
returns void language sql
set search_path = pg_catalog, pg_temp
as $f$
  update ledger.item i
  set deleted = true, seq = p_seq, updated_at = now()
  where i.tenant = p_tenant and not i.deleted and i.kind in ('anchor_source', 'deadline')
    and i.links->>'anchor' = p_anchor::text;
$f$;

create or replace function rules.add_source(
  p_tenant uuid, p_seq bigint, p_src jsonb, p_anchor uuid, p_hashes jsonb, p_state text)
returns uuid language plpgsql
set search_path = pg_catalog, pg_temp
as $f$
declare
  v_new ledger.item;
begin
  if exists (select 1 from ledger.item i where i.tenant = p_tenant and i.id = (p_src->>'id')::uuid) then
    perform rules.refuse(format('Is {{item:%s}} already recorded? An item with this id exists.', p_src->>'id'));
  end if;
  v_new := row(p_tenant, (p_src->>'id')::uuid, 'practice', 'anchor_source', p_state,
               jsonb_strip_nulls(rules.obj(p_src->'tags')), jsonb_build_object('anchor', p_anchor), p_hashes,
               null, p_seq, p_seq, false, now(), now())::ledger.item;
  perform rules.check_item(v_new, p_src, true);
  insert into ledger.item select (v_new).*;
  return v_new.id;
end;
$f$;

-- R4. One anchor per (matter, anchor_type, party, proceeding), written by an
-- upsert that carries one source. Returns the results of both ops. An op whose
-- data the rules did not store (an anchor whose authoritative date stands, a
-- source already recorded) is reported saved: false, with the item it matched
-- as its `as`.
create or replace function rules.kind_anchor(
  p_tenant uuid, p_seq bigint, p_write jsonb, p_op jsonb, p_src jsonb)
returns jsonb language plpgsql
set search_path = pg_catalog, pg_temp
as $f$
declare
  v_intent jsonb := rules.obj(p_write->'intent');
  v_resolve boolean := coalesce(v_intent->'resolve' = 'true'::jsonb, false);
  v_amend boolean := coalesce(v_intent->'amend' = 'true'::jsonb, false);
  v_occurred boolean := coalesce(v_intent->'occurred' = 'true'::jsonb, false);
  v_id uuid := (p_op->>'id')::uuid;
  v_src_id uuid := (p_src->>'id')::uuid;
  v_tags jsonb := jsonb_strip_nulls(rules.obj(p_op->'tags'));
  v_links jsonb := rules.obj(p_op->'links');
  v_hashes jsonb := rules.obj(p_op->'hashes');
  v_src_hashes jsonb := rules.obj(p_src->'hashes');
  v_date text := v_hashes->>'anchor_date';
  v_parts text[];
  v_states text[];
  v_matches uuid[];
  v_cur ledger.item;
  v_new ledger.item;
  v_found uuid;
  v_prior text;
  v_anchor_saved boolean;
  v_src_saved boolean := true;
  v_src_as uuid := v_src_id;
begin
  if v_resolve::int + v_amend::int + v_occurred::int > 1 then
    perform rules.refuse(format('Which is meant for {{item:%s}}: resolve, amend or occurred? More than one was given.', v_id));
  end if;
  if p_op ? 'state' or p_src ? 'state' then
    perform rules.refuse(format('Which of resolve, amend or occurred is meant for {{item:%s}}? Its state is not set directly.', v_id));
  end if;
  if p_src->>'op' is distinct from 'create' then
    perform rules.refuse(format('How should the source {{item:%s}} be recorded? A source is created with its anchor.', v_src_id));
  end if;
  if v_date is null then
    perform rules.refuse(format('What date does {{item:%s}} record?', v_id));
  end if;
  if v_src_hashes ? 'asserted_date' and v_src_hashes->>'asserted_date' is distinct from v_date then
    perform rules.refuse(format('Which date does the source {{item:%s}} assert? It differs from the date of its anchor.', v_src_id));
  end if;
  v_src_hashes := v_src_hashes || jsonb_build_object('asserted_date', v_date);

  -- The item the op describes, checked before it is matched.
  v_new := row(p_tenant, v_id, 'practice', 'anchor', 'active', v_tags, jsonb_strip_nulls(v_links), v_hashes,
               null, p_seq, p_seq, false, now(), now())::ledger.item;
  perform rules.check_item(v_new, p_op, true);

  select k.parts, k.states into v_parts, v_states from rules.natural_key k
  where k.kind = 'anchor' and k.purpose = 'upsert' and k.rank = 1;
  v_matches := rules.key_matches(p_tenant, 'anchor', v_parts, v_states, v_tags, v_links, v_hashes, null);
  if cardinality(v_matches) > 1 then
    perform rules.refuse(format('Which of {{item:%s}} and {{item:%s}} is the anchor for this event?',
      v_matches[1], v_matches[2]));
  end if;

  if cardinality(v_matches) = 0 then
    if v_amend then
      perform rules.refuse(format('Which recorded date does {{item:%s}} amend? No date is recorded for this event yet.', v_id));
    end if;
    if v_occurred then
      perform rules.refuse(format('Which recorded event took place on the date in {{item:%s}}? No date is recorded for this event yet.', v_id));
    end if;
    if exists (select 1 from ledger.item i where i.tenant = p_tenant and i.id = v_id) then
      perform rules.refuse(format('Is {{item:%s}} already recorded? An item with this id exists.', v_id));
    end if;
    insert into ledger.item select (v_new).*;
    perform rules.add_source(p_tenant, p_seq, p_src, v_id, v_src_hashes, 'confirmed');
    return jsonb_build_array(rules.op_result(v_id, true, v_id), rules.op_result(v_src_id, true, v_src_id));
  end if;

  select * into v_cur from ledger.item i where i.tenant = p_tenant and i.id = v_matches[1] for update;
  v_new := v_cur;
  v_new.seq := p_seq;
  v_new.updated_at := now();
  if v_links ? 'filing' then
    v_new.links := jsonb_strip_nulls(v_cur.links || jsonb_build_object('filing', v_links->'filing'));
  end if;

  if v_occurred then
    if v_cur.state = 'conflicted' then
      perform rules.refuse(format('Which date is authoritative for {{item:%s}}?', v_cur.id));
    end if;
    if v_date is distinct from v_cur.hashes->>'anchor_date' then
      perform rules.refuse(format('Did the event of {{item:%s}} move to a different date?', v_cur.id));
    end if;
    perform rules.add_source(p_tenant, p_seq, p_src, v_cur.id, v_src_hashes, 'confirmed');
    v_new.state := 'occurred';
    v_anchor_saved := false;

  elsif v_amend then
    if v_date = v_cur.hashes->>'anchor_date' then
      perform rules.refuse(format('What changed about the date of {{item:%s}}? The date given is the one already recorded.', v_cur.id));
    end if;
    v_prior := v_cur.hashes->>'anchor_date';
    select s.id into v_found from ledger.item s
    where s.tenant = p_tenant and s.kind = 'anchor_source' and not s.deleted
      and s.links->>'anchor' = v_cur.id::text
      and s.hashes->>'source_document' is not distinct from v_src_hashes->>'source_document'
      and s.hashes->>'asserted_date' = v_date
    order by s.created_seq, s.created_at, s.id limit 1;
    if v_found is not null then
      update ledger.item s set state = 'confirmed', seq = p_seq, updated_at = now()
      where s.tenant = p_tenant and s.id = v_found and s.state is distinct from 'confirmed';
      v_src_saved := false;
      v_src_as := v_found;
    else
      perform rules.add_source(p_tenant, p_seq, p_src, v_cur.id, v_src_hashes, 'confirmed');
    end if;
    update ledger.item s set state = 'superseded', seq = p_seq, updated_at = now()
    where s.tenant = p_tenant and s.kind = 'anchor_source' and not s.deleted
      and s.links->>'anchor' = v_cur.id::text
      and s.hashes->>'asserted_date' = v_prior and s.state is distinct from 'superseded';
    v_new.hashes := v_cur.hashes || v_hashes;
    v_new.state := 'active';
    v_anchor_saved := true;

  elsif v_resolve or (v_cur.state = 'conflicted' and v_date = v_cur.hashes->>'anchor_date') then
    v_new.hashes := v_cur.hashes || v_hashes;
    v_new.state := 'active';
    v_anchor_saved := true;
    select s.id into v_found from ledger.item s
    where s.tenant = p_tenant and s.kind = 'anchor_source' and not s.deleted
      and s.links->>'anchor' = v_cur.id::text
      and s.hashes->>'source_document' is not distinct from v_src_hashes->>'source_document'
      and s.hashes->>'asserted_date' = v_date
    order by s.created_seq, s.created_at, s.id limit 1;
    if v_found is not null then
      v_src_saved := false;
      v_src_as := v_found;
    else
      perform rules.add_source(p_tenant, p_seq, p_src, v_cur.id, v_src_hashes, 'confirmed');
    end if;
    -- Re-mark every source against the authoritative date; a source with no
    -- asserted date is pending rather than silently confirmed.
    update ledger.item s
    set state = case when s.hashes->>'asserted_date' is null then 'pending'
                     when s.hashes->>'asserted_date' = v_date then 'confirmed'
                     else 'conflicted' end,
        seq = p_seq, updated_at = now()
    where s.tenant = p_tenant and s.kind = 'anchor_source' and not s.deleted
      and s.links->>'anchor' = v_cur.id::text and s.state is distinct from 'superseded'
      and s.state is distinct from (case when s.hashes->>'asserted_date' is null then 'pending'
                                         when s.hashes->>'asserted_date' = v_date then 'confirmed'
                                         else 'conflicted' end);

  elsif v_date is distinct from v_cur.hashes->>'anchor_date' then
    v_new.state := 'conflicted';
    v_anchor_saved := false;
    perform rules.add_source(p_tenant, p_seq, p_src, v_cur.id, v_src_hashes, 'conflicted');

  else
    v_anchor_saved := false;
    perform rules.add_source(p_tenant, p_seq, p_src, v_cur.id, v_src_hashes, 'confirmed');
  end if;

  perform rules.check_item(v_new, p_op, false);
  update ledger.item i
  set state = v_new.state, links = v_new.links, hashes = v_new.hashes, seq = p_seq, updated_at = now()
  where i.tenant = p_tenant and i.id = v_cur.id;
  return jsonb_build_array(rules.op_result(v_id, v_anchor_saved, v_cur.id),
                           rules.op_result(v_src_id, v_src_saved, v_src_as));
end;
$f$;

-- -----------------------------------------------------------------------------
-- One op of any kind but anchor (and its sources)
-- -----------------------------------------------------------------------------

create or replace function rules.write_op(p_tenant uuid, p_seq bigint, p_write jsonb, p_op jsonb)
returns jsonb language plpgsql
set search_path = pg_catalog, pg_temp
as $f$
declare
  v_kind text := p_op->>'kind';
  v_type text := p_op->>'op';
  v_id uuid := (p_op->>'id')::uuid;
  v_cur ledger.item;
  v_new ledger.item;
  v_create boolean;
  v_target uuid;
  v_matches uuid[];
begin
  if v_kind = 'anchor_source' then
    perform rules.refuse(format('Which anchor does the source {{item:%s}} belong to? A source is written with its anchor.', v_id));
  end if;

  if v_type = 'delete' then
    select * into v_cur from ledger.item i where i.tenant = p_tenant and i.id = v_id and not i.deleted for update;
    if not found or v_cur.kind <> v_kind then
      perform rules.refuse(format('Which %s is meant? {{item:%s}} is not recorded.', replace(v_kind, '_', ' '), v_id));
    end if;
    if v_kind = 'contact' then
      perform rules.kind_contact_delete(p_tenant, v_id);
    end if;
    update ledger.item i set deleted = true, seq = p_seq, updated_at = now()
    where i.tenant = p_tenant and i.id = v_id;
    if v_kind = 'anchor' then
      perform rules.kind_anchor_delete(p_tenant, p_seq, v_id);
    end if;
    return rules.op_result(v_id, true, v_id);
  end if;

  if v_kind = 'anchor' then
    perform rules.refuse(format('How should {{item:%s}} be recorded? An anchor is written by an upsert with its source, or deleted.', v_id));
  end if;

  if v_type = 'update' then
    select * into v_cur from ledger.item i where i.tenant = p_tenant and i.id = v_id and not i.deleted for update;
    if not found then
      perform rules.refuse(format('Which %s is meant? {{item:%s}} is not recorded.', replace(v_kind, '_', ' '), v_id));
    end if;
    v_create := false;
    v_target := v_id;
  elsif v_type = 'upsert' then
    v_matches := rules.upsert_matches(p_tenant, v_kind, p_op);
    if cardinality(v_matches) > 1 then
      perform rules.refuse(format('Which of {{item:%s}} and {{item:%s}} is this %s?',
        v_matches[1], v_matches[2], replace(v_kind, '_', ' ')));
    end if;
    v_create := cardinality(v_matches) = 0;
    v_target := case when v_create then v_id else v_matches[1] end;
    if not v_create then
      select * into v_cur from ledger.item i where i.tenant = p_tenant and i.id = v_target for update;
    end if;
  else
    v_create := true;
    v_target := v_id;
  end if;

  if v_create then
    if exists (select 1 from ledger.item i where i.tenant = p_tenant and i.id = v_target) then
      perform rules.refuse(format('Is {{item:%s}} already recorded? An item with this id exists.', v_target));
    end if;
    v_new := row(p_tenant, v_target, p_write->>'store', v_kind,
                 coalesce(p_op->>'state', (select k.state_default from rules.kind k where k.kind = v_kind)),
                 jsonb_strip_nulls(rules.obj(p_op->'tags')), jsonb_strip_nulls(rules.obj(p_op->'links')),
                 rules.obj(p_op->'hashes'),
                 case when jsonb_typeof(p_op->'cross') = 'object' then p_op->'cross' end,
                 p_seq, p_seq, false, now(), now())::ledger.item;
  else
    if v_cur.kind <> v_kind then
      perform rules.refuse(format('What kind of item is {{item:%s}}? It is recorded as another kind.', v_target));
    end if;
    v_new := v_cur;
    if p_op ? 'state' then
      v_new.state := p_op->>'state';
    end if;
    v_new.tags := jsonb_strip_nulls(v_cur.tags || rules.obj(p_op->'tags'));
    v_new.links := jsonb_strip_nulls(v_cur.links || rules.obj(p_op->'links'));
    v_new.hashes := v_cur.hashes || rules.obj(p_op->'hashes');
    if p_op ? 'cross' then
      v_new.cross_payload := case when jsonb_typeof(p_op->'cross') = 'object' then p_op->'cross' end;
    end if;
    v_new.seq := p_seq;
    v_new.updated_at := now();
  end if;

  perform rules.check_item(v_new, p_op, v_create);
  perform rules.check_transition(v_kind, case when v_create then null else v_cur.state end, v_new.state, v_target);

  v_new := case v_kind
    when 'matter'       then rules.kind_matter(p_tenant, p_seq, p_write, p_op, v_create, v_cur, v_new)
    when 'time_entry'   then rules.kind_time_entry(p_tenant, p_seq, p_write, p_op, v_create, v_cur, v_new)
    when 'invoice'      then rules.kind_invoice(p_tenant, p_seq, p_write, p_op, v_create, v_cur, v_new)
    when 'task'         then rules.kind_task(p_tenant, p_seq, p_write, p_op, v_create, v_cur, v_new)
    when 'deadline'     then rules.kind_deadline(p_tenant, p_seq, p_write, p_op, v_create, v_cur, v_new)
    when 'signal'       then rules.kind_signal(p_tenant, p_seq, p_write, p_op, v_create, v_cur, v_new)
    when 'rule_overlay' then rules.kind_rule_overlay(p_tenant, p_seq, p_write, p_op, v_create, v_cur, v_new)
    when 'contact'      then rules.kind_contact(p_tenant, p_seq, p_write, p_op, v_create, v_cur, v_new)
    when 'affiliation'  then rules.kind_affiliation(p_tenant, p_seq, p_write, p_op, v_create, v_cur, v_new)
    else v_new
  end;

  if v_create then
    insert into ledger.item select (v_new).*;
  else
    update ledger.item i
    set state = v_new.state, tags = v_new.tags, links = v_new.links, hashes = v_new.hashes,
        cross_payload = v_new.cross_payload, seq = p_seq, updated_at = now()
    where i.tenant = p_tenant and i.id = v_target;
  end if;
  return rules.op_result(v_id, true, v_target);
end;
$f$;

-- R10. After every op: a day belongs to a year written in the same write, a
-- year's earlier days give way to the days written with it, and a confirmed
-- year lists at least one day.
create or replace function rules.kind_calendar(p_tenant uuid, p_seq bigint, p_write jsonb, p_results jsonb)
returns void language plpgsql
set search_path = pg_catalog, pg_temp
as $f$
declare
  v_years uuid[];
  v_day uuid;
  v_year uuid;
begin
  v_years := array(
    select (p_results->(o->>'id')->>'as')::uuid
    from jsonb_array_elements(p_write->'ops') o
    where o->>'kind' = 'calendar_year' and o->>'op' <> 'delete');
  for v_day in
    select (p_results->(o->>'id')->>'as')::uuid
    from jsonb_array_elements(p_write->'ops') o where o->>'kind' = 'calendar_day'
  loop
    if not exists (
      select 1 from ledger.item i
      where i.tenant = p_tenant and i.id = v_day and (i.links->>'calendar_year')::uuid = any (v_years)) then
      perform rules.refuse(format('Is the day {{item:%s}} part of a fresh ingest of its year''s calendar?', v_day));
    end if;
  end loop;
  update ledger.item i set deleted = true, seq = p_seq, updated_at = now()
  where i.tenant = p_tenant and i.kind = 'calendar_day' and not i.deleted
    and (i.links->>'calendar_year')::uuid = any (v_years) and i.created_seq <> p_seq;
  foreach v_year in array v_years loop
    if exists (select 1 from ledger.item y where y.tenant = p_tenant and y.id = v_year and y.state = 'confirmed')
       and not exists (
         select 1 from ledger.item d
         where d.tenant = p_tenant and d.kind = 'calendar_day' and not d.deleted
           and d.links->>'calendar_year' = v_year::text) then
      perform rules.refuse(format('Which court closures or limited days does the confirmed calendar {{item:%s}} list?', v_year));
    end if;
  end loop;
end;
$f$;

-- -----------------------------------------------------------------------------
-- Entry points
-- -----------------------------------------------------------------------------

-- Applies every op of one write, or raises PR001 with the question.
create or replace function rules.apply_ops(p_tenant uuid, p_write jsonb)
returns jsonb language plpgsql
set search_path = pg_catalog, pg_temp
as $f$
declare
  v_store text := p_write->>'store';
  v_ops jsonb := p_write->'ops';
  v_count integer;
  v_seq bigint;
  v_op jsonb;
  v_sources jsonb;
  v_res jsonb;
  v_one jsonb;
  v_results jsonb := '{}'::jsonb;
  v_map jsonb := '{}'::jsonb;
  v_done text[] := '{}'::text[];
  i integer;
begin
  if v_store is distinct from 'practice' then
    perform rules.refuse('Which store is this write for? Its store is missing or is not one Probanda''s Cloud holds.');
  end if;
  if jsonb_typeof(v_ops) is distinct from 'array' or jsonb_array_length(v_ops) = 0 then
    perform rules.refuse('What does this write change? It carries no ops.');
  end if;
  if p_write ? 'intent' and jsonb_typeof(p_write->'intent') not in ('object', 'null') then
    perform rules.refuse('What is the intent of this write? It is not an object.');
  end if;
  v_count := jsonb_array_length(v_ops);
  for i in 0 .. v_count - 1 loop
    perform rules.check_op(v_ops->i, i, v_store);
  end loop;
  if (select count(distinct o->>'id') from jsonb_array_elements(v_ops) o) <> v_count then
    perform rules.refuse('Which op is which? Two ops in this write share an id.');
  end if;

  update ledger.tenant t set seq = t.seq + 1 where t.tenant = p_tenant returning t.seq into v_seq;

  for i in 0 .. v_count - 1 loop
    v_op := v_ops->i;
    continue when (v_op->>'id') = any (v_done);
    v_op := rules.remap_links(v_op, v_map);
    if v_op->>'kind' = 'anchor' and v_op->>'op' = 'upsert' then
      select coalesce(jsonb_agg(o), '[]'::jsonb) into v_sources
      from jsonb_array_elements(v_ops) o
      where o->>'kind' = 'anchor_source' and o->'links'->>'anchor' = v_op->>'id';
      if jsonb_array_length(v_sources) <> 1 then
        perform rules.refuse(format('Which source records the date of {{item:%s}}? The write carries %s sources linked to it.',
          v_op->>'id', jsonb_array_length(v_sources)));
      end if;
      v_res := rules.kind_anchor(p_tenant, v_seq, p_write, v_op, v_sources->0);
      v_done := v_done || (v_sources->0->>'id');
    else
      v_res := jsonb_build_array(rules.write_op(p_tenant, v_seq, p_write, v_op));
    end if;
    for v_one in select e from jsonb_array_elements(v_res) e loop
      v_results := v_results || jsonb_build_object(v_one->>'id', v_one);
      v_map := v_map || jsonb_build_object(v_one->>'id', v_one->'as');
    end loop;
  end loop;

  perform rules.kind_calendar(p_tenant, v_seq, p_write, v_results);

  return jsonb_build_object(
    'saved', true,
    'ops', (select jsonb_agg(v_results->(o->>'id') order by n)
            from jsonb_array_elements(v_ops) with ordinality as t(o, n)),
    'seq', v_seq);
end;
$f$;

-- rules.apply_write(tenant, write): write is {write_id, store, tool, intent, ops}.
-- Returns {saved: true, ops: [{id, saved, as}], seq} or {saved: false, question}.
-- All or nothing; the result is stored under write_id and returned unchanged
-- for a repeated write_id.
create or replace function rules.apply_write(p_tenant uuid, p_write jsonb)
returns jsonb language plpgsql
set search_path = pg_catalog, pg_temp
as $f$
declare
  v_write_id uuid;
  v_result jsonb;
begin
  if p_tenant is null then
    return jsonb_build_object('saved', false, 'question', 'Which practice is this write for? No tenant was given.');
  end if;
  if jsonb_typeof(p_write) is distinct from 'object' or not rules.is_uuid(p_write->'write_id') then
    return jsonb_build_object('saved', false, 'question', 'Which write is this? Its write_id is missing or is not a UUID.');
  end if;
  v_write_id := (p_write->>'write_id')::uuid;

  insert into ledger.tenant (tenant) values (p_tenant) on conflict (tenant) do nothing;
  perform 1 from ledger.tenant t where t.tenant = p_tenant for update;

  select w.result into v_result from ledger.write_result w
  where w.tenant = p_tenant and w.write_id = v_write_id;
  if found then
    return v_result;
  end if;

  begin
    v_result := rules.apply_ops(p_tenant, p_write);
  exception when sqlstate 'PR001' then
    v_result := jsonb_build_object('saved', false, 'question', sqlerrm);
  end;

  insert into ledger.write_result (tenant, write_id, result) values (p_tenant, v_write_id, v_result);
  return v_result;
end;
$f$;

-- rules.sync(tenant, store, since): every item changed after since, with its
-- state, tags, the links the user's machine keeps, and whether it is deleted.
create or replace function rules.sync(p_tenant uuid, p_store text, p_since bigint)
returns jsonb language sql stable
set search_path = pg_catalog, pg_temp
as $f$
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'kind', i.kind, 'state', i.state, 'tags', i.tags,
               'links', rules.synced_links(i.kind, i.links), 'deleted', i.deleted)
             order by i.seq, i.id)
      from ledger.item i
      where i.tenant = p_tenant and i.store = p_store and i.seq > coalesce(p_since, 0)), '[]'::jsonb),
    'seq', coalesce((select t.seq from ledger.tenant t where t.tenant = p_tenant), 0));
$f$;

-- The question for one seeded item that today's checks would refuse, or null.
-- p_order maps each seeded id to its place in the seed, so of two items that
-- clash the later one is asked about.
create or replace function rules.seed_question(p_item ledger.item, p_order jsonb)
returns text language plpgsql stable
set search_path = pg_catalog, pg_temp
as $f$
declare
  v_place integer := (p_order->>p_item.id::text)::integer;
  v_parts text[];
  v_states text[];
  v_other uuid;
  v_question text;
begin
  perform rules.check_item(p_item, null, true);

  if p_item.kind = 'task' then
    if p_item.links->>'filing' is not null and p_item.links->>'matter' is null then
      return format('Which matter''s filing does the to-do {{item:%s}} point to?', p_item.id);
    end if;
    if p_item.state = 'open' and p_item.links->>'filing' is not null then
      select i.id into v_other from ledger.item i
      where i.tenant = p_item.tenant and i.kind = 'task' and i.state = 'open' and not i.deleted
        and i.links->>'matter' = p_item.links->>'matter' and i.links->>'filing' = p_item.links->>'filing'
        and (p_order->>i.id::text)::integer < v_place
      order by (p_order->>i.id::text)::integer limit 1;
      if v_other is not null then
        return format('Is this work part of the open to-do {{item:%s}}, which already covers this filing?', v_other);
      end if;
    end if;

  elsif p_item.kind in ('anchor', 'deadline') then
    if p_item.kind = 'deadline' then
      if p_item.tags->>'review_flag' = 'practitioner_choice'
         and (p_item.hashes->>'scenario_label' is null or p_item.hashes->>'review_note' is null) then
        return format('Which scenario does the alternative date {{item:%s}} cover, and what open question does it turn on?', p_item.id);
      end if;
      if p_item.tags->>'review_flag' is distinct from 'practitioner_choice' and p_item.hashes->>'scenario_label' is not null then
        return format('Is {{item:%s}} one of several alternative dates awaiting a choice?', p_item.id);
      end if;
    end if;
    select k.parts, k.states into v_parts, v_states from rules.natural_key k
    where k.kind = p_item.kind and k.rank = 1;
    if p_item.state = any (v_states) then
      select m into v_other
      from unnest(rules.key_matches(p_item.tenant, p_item.kind, v_parts, v_states,
                                    p_item.tags, p_item.links, p_item.hashes, p_item.id)) m
      where (p_order->>m::text)::integer < v_place
      order by (p_order->>m::text)::integer limit 1;
      if v_other is not null then
        return format('Which of {{item:%s}} and {{item:%s}} is the current %s?', v_other, p_item.id, p_item.kind);
      end if;
    end if;

  elsif p_item.kind = 'invoice' then
    if exists (
      select 1 from ledger.item m
      where m.tenant = p_item.tenant and m.id = (p_item.links->>'matter')::uuid and m.tags->'billable' = 'false'::jsonb) then
      return format('Should {{item:%s}}, which is recorded as not billable, take the invoice {{item:%s}}?',
        p_item.links->>'matter', p_item.id);
    end if;
    if p_item.hashes->>'invoice_number' is not null then
      select i.id into v_other from ledger.item i
      where i.tenant = p_item.tenant and i.kind = 'invoice' and not i.deleted
        and i.links->>'matter' = p_item.links->>'matter' and i.hashes->>'invoice_number' = p_item.hashes->>'invoice_number'
        and (p_order->>i.id::text)::integer < v_place
      order by (p_order->>i.id::text)::integer limit 1;
      if v_other is not null then
        return format('Is {{item:%s}} the same invoice as {{item:%s}}?', p_item.id, v_other);
      end if;
    end if;

  elsif p_item.kind = 'signal' then
    select i.id into v_other from ledger.item i
    where i.tenant = p_item.tenant and i.kind = 'signal' and not i.deleted
      and i.links->>'matter' = p_item.links->>'matter' and i.tags->>'signal_key' = p_item.tags->>'signal_key'
      and (p_order->>i.id::text)::integer < v_place
    order by (p_order->>i.id::text)::integer limit 1;
    if v_other is not null then
      return format('Is {{item:%s}} the same signal as {{item:%s}}?', p_item.id, v_other);
    end if;

  elsif p_item.kind = 'calendar_year' then
    if p_item.state = 'confirmed' and not exists (
      select 1 from ledger.item d
      where d.tenant = p_item.tenant and d.kind = 'calendar_day' and not d.deleted
        and d.links->>'calendar_year' = p_item.id::text) then
      return format('Which court closures or limited days does the confirmed calendar {{item:%s}} list?', p_item.id);
    end if;

  elsif p_item.kind = 'rule_overlay' then
    v_question := coalesce(rules.overlay_question(p_item.id, p_item.cross_payload),
      case when p_item.state is distinct from p_item.cross_payload->>'status'
             or p_item.tags->>'deadline_type' is distinct from p_item.cross_payload->>'deadline_type'
             or p_item.tags->>'amending_reg' is distinct from p_item.cross_payload #>> '{amending_instrument,reg}'
           then format('Which is right for {{item:%s}}: its tags and state, or its record? They differ.', p_item.id) end);
    return v_question;
  end if;
  return null;
exception when sqlstate 'PR001' then
  return sqlerrm;
end;
$f$;

-- rules.seed(tenant, store, items): records a tenant's existing items as they
-- are, once. items is [{id, kind, state, tags, links, hashes, cross}].
-- Returns {seeded, questions: [{id, question}]}: one question for each item
-- today's checks would refuse. Nothing is repaired. A tenant that already holds
-- items, or a malformed item, seeds nothing.
create or replace function rules.seed(p_tenant uuid, p_store text, p_items jsonb)
returns jsonb language plpgsql
set search_path = pg_catalog, pg_temp
as $f$
declare
  v_seq bigint;
  v_order jsonb;
  v_item ledger.item;
  v_question text;
  v_questions jsonb := '[]'::jsonb;
  v_count integer;
  i integer;
begin
  if p_tenant is null or p_store is distinct from 'practice' or jsonb_typeof(p_items) is distinct from 'array' then
    return jsonb_build_object('seeded', 0, 'questions', jsonb_build_array(jsonb_build_object('id', null,
      'question', 'What is being seeded? The tenant, the store or the list of items is missing or malformed.')));
  end if;
  insert into ledger.tenant (tenant) values (p_tenant) on conflict (tenant) do nothing;
  perform 1 from ledger.tenant t where t.tenant = p_tenant for update;
  if exists (select 1 from ledger.item it where it.tenant = p_tenant) then
    return jsonb_build_object('seeded', 0, 'questions', jsonb_build_array(jsonb_build_object('id', null,
      'question', 'Has this practice already been moved to Probanda''s Cloud? It already holds items.')));
  end if;

  v_count := jsonb_array_length(p_items);
  begin
    for i in 0 .. v_count - 1 loop
      perform rules.check_op(jsonb_build_object('op', 'create') || (p_items->i), i, p_store);
    end loop;
    if (select count(distinct o->>'id') from jsonb_array_elements(p_items) o) <> v_count then
      perform rules.refuse('Which item is which? Two seeded items share an id.');
    end if;
  exception when sqlstate 'PR001' then
    return jsonb_build_object('seeded', 0, 'questions',
      jsonb_build_array(jsonb_build_object('id', null, 'question', sqlerrm)));
  end;

  update ledger.tenant t set seq = t.seq + 1 where t.tenant = p_tenant returning t.seq into v_seq;
  insert into ledger.item (tenant, id, store, kind, state, tags, links, hashes, cross_payload, seq, created_seq, deleted)
  select p_tenant, (o->>'id')::uuid, p_store, o->>'kind', o->>'state',
         jsonb_strip_nulls(rules.obj(o->'tags')), jsonb_strip_nulls(rules.obj(o->'links')), rules.obj(o->'hashes'),
         case when jsonb_typeof(o->'cross') = 'object' then o->'cross' end,
         v_seq, v_seq, false
  from jsonb_array_elements(p_items) o;

  select jsonb_object_agg(o->>'id', n) into v_order
  from jsonb_array_elements(p_items) with ordinality as t(o, n);
  for v_item in
    select it.* from ledger.item it
    where it.tenant = p_tenant
    order by (v_order->>it.id::text)::integer
  loop
    v_question := rules.seed_question(v_item, v_order);
    if v_question is not null then
      v_questions := v_questions || jsonb_build_array(jsonb_build_object('id', v_item.id, 'question', v_question));
    end if;
  end loop;
  return jsonb_build_object('seeded', v_count, 'questions', v_questions);
end;
$f$;

revoke all on schema rules from public, anon, authenticated;
revoke all on all tables in schema rules from public, anon, authenticated;
revoke all on all sequences in schema rules from public, anon, authenticated;
revoke all on all functions in schema rules from public, anon, authenticated;

commit;
