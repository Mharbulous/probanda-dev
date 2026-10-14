-- =============================================================================
-- Tests of ledger.sql and rules.sql
-- =============================================================================
-- Not run as it stands. build_scratch_test.mjs applies both files twice under
-- scratch schema names, runs this, drops the scratch schemas and selects the
-- result rows, all in one transaction.
--
-- Each test records one row through pg_temp.t_check, and uses its own random
-- tenant. Field hashes stand in for the plugin's keyed HMAC: sha256 of the
-- value, so equal values give equal hashes. A test that raises an error it does
-- not expect stops the whole run, and the transaction then leaves nothing.
-- =============================================================================

create function pg_temp.t_check(p_name text, p_pass boolean, p_detail text default null)
returns void language sql as $f$
  insert into t_result (name, pass, detail)
  values (p_name, coalesce(p_pass, false), case when coalesce(p_pass, false) then null else p_detail end);
$f$;

create function pg_temp.h(p text)
returns text language sql immutable as $f$
  select encode(sha256(convert_to(p, 'UTF8')), 'hex');
$f$;

create function pg_temp.keys(p jsonb)
returns text[] language sql immutable as $f$
  select array_agg(k order by k) from jsonb_object_keys(p) k;
$f$;

create function pg_temp.w(p_tenant uuid, p_tool text, p_ops jsonb, p_intent jsonb default '{}'::jsonb)
returns jsonb language plpgsql as $f$
declare
  r jsonb;
begin
  r := rules.apply_write(p_tenant, jsonb_build_object('write_id', gen_random_uuid(), 'store', 'practice',
         'tool', p_tool, 'intent', p_intent, 'ops', p_ops));
  if r ? 'question' then
    insert into t_question (question) values (r->>'question');
  end if;
  return r;
end;
$f$;

create function pg_temp.op(p_op text, p_id uuid, p_kind text, p_body jsonb default '{}'::jsonb)
returns jsonb language sql immutable as $f$
  select jsonb_build_object('op', p_op, 'id', p_id, 'kind', p_kind) || p_body;
$f$;

create function pg_temp.as_id(p_result jsonb, p_index integer default 0)
returns uuid language sql immutable as $f$
  select (p_result->'ops'->p_index->>'as')::uuid;
$f$;

create function pg_temp.saved(p_result jsonb)
returns boolean language sql immutable as $f$
  select coalesce(p_result->>'saved' = 'true', false);
$f$;

create function pg_temp.refused(p_result jsonb)
returns boolean language sql immutable as $f$
  select coalesce(p_result->>'saved' = 'false' and pg_temp.keys(p_result) = array['question', 'saved']
                  and p_result->>'question' like '%?%', false);
$f$;

create function pg_temp.item(p_tenant uuid, p_id uuid)
returns ledger.item language sql stable as $f$
  select * from ledger.item i where i.tenant = p_tenant and i.id = p_id;
$f$;

create function pg_temp.st(p_tenant uuid, p_id uuid)
returns text language sql stable as $f$
  select i.state from ledger.item i where i.tenant = p_tenant and i.id = p_id and not i.deleted;
$f$;

create function pg_temp.live(p_tenant uuid, p_kind text)
returns integer language sql stable as $f$
  select count(*)::integer from ledger.item i where i.tenant = p_tenant and i.kind = p_kind and not i.deleted;
$f$;

create function pg_temp.tenant_seq(p_tenant uuid)
returns bigint language sql stable as $f$
  select coalesce((select t.seq from ledger.tenant t where t.tenant = p_tenant), 0);
$f$;

-- The states of an anchor's live sources citing one document, oldest first.
create function pg_temp.src(p_tenant uuid, p_anchor uuid, p_doc text)
returns text language sql stable as $f$
  select string_agg(s.state, ',' order by s.created_seq, s.id) from ledger.item s
  where s.tenant = p_tenant and s.kind = 'anchor_source' and not s.deleted
    and s.links->>'anchor' = p_anchor::text and s.hashes->>'source_document' = pg_temp.h(p_doc);
$f$;

create function pg_temp.nsrc(p_tenant uuid, p_anchor uuid)
returns integer language sql stable as $f$
  select count(*)::integer from ledger.item s
  where s.tenant = p_tenant and s.kind = 'anchor_source' and not s.deleted and s.links->>'anchor' = p_anchor::text;
$f$;

-- upsert_client_matter: one write, the matter linked to the client op.
create function pg_temp.matter(p_tenant uuid, p_num text, p_tags jsonb default '{}'::jsonb)
returns uuid language plpgsql as $f$
declare
  c uuid := gen_random_uuid();
  m uuid := gen_random_uuid();
  r jsonb;
begin
  r := pg_temp.w(p_tenant, 'upsert_client_matter', jsonb_build_array(
    pg_temp.op('upsert', c, 'client', jsonb_build_object('hashes',
      jsonb_build_object('client_num', pg_temp.h('C-' || p_num), 'name', pg_temp.h('Client ' || p_num)))),
    pg_temp.op('upsert', m, 'matter', jsonb_build_object('tags', p_tags, 'links', jsonb_build_object('client', c),
      'hashes', jsonb_build_object('matt_num', pg_temp.h(p_num), 'file_number', pg_temp.h('F-' || p_num))))));
  if not pg_temp.saved(r) then
    raise exception 'matter setup refused: %', r;
  end if;
  return pg_temp.as_id(r, 1);
end;
$f$;

create function pg_temp.task(p_tenant uuid, p_matter uuid, p_filing text, p_desc text, p_extra jsonb default '{}'::jsonb)
returns jsonb language sql as $f$
  select pg_temp.w(p_tenant, 'upsert_task', jsonb_build_array(pg_temp.op('create', gen_random_uuid(), 'task',
    jsonb_build_object('tags', jsonb_build_object('task_type', 'client'),
      'links', jsonb_strip_nulls(jsonb_build_object('matter', p_matter, 'filing', p_filing)),
      'hashes', jsonb_build_object('description', pg_temp.h(p_desc))) || p_extra)));
$f$;

create function pg_temp.upd(p_tenant uuid, p_tool text, p_id uuid, p_kind text, p_body jsonb)
returns jsonb language sql as $f$
  select pg_temp.w(p_tenant, p_tool, jsonb_build_array(pg_temp.op('update', p_id, p_kind, p_body)));
$f$;

-- upsert_anchor: the anchor upsert and its one source.
create function pg_temp.anchor(p_tenant uuid, p_matter uuid, p_type text, p_date text, p_doc text,
                               p_intent jsonb default '{}'::jsonb, p_hashes jsonb default '{}'::jsonb,
                               p_links jsonb default '{}'::jsonb)
returns jsonb language plpgsql as $f$
declare
  a uuid := gen_random_uuid();
begin
  return pg_temp.w(p_tenant, 'upsert_anchor', jsonb_build_array(
    pg_temp.op('upsert', a, 'anchor', jsonb_build_object(
      'tags', jsonb_build_object('anchor_type', p_type),
      'links', jsonb_build_object('matter', p_matter) || p_links,
      'hashes', jsonb_build_object('anchor_date', pg_temp.h(p_date), 'party_label', null, 'proceeding_label', null) || p_hashes)),
    pg_temp.op('create', gen_random_uuid(), 'anchor_source', jsonb_build_object(
      'links', jsonb_build_object('anchor', a),
      'hashes', jsonb_build_object('source_document', pg_temp.h(p_doc), 'source_excerpt', null,
                                   'stated_date', pg_temp.h(p_date), 'asserted_date', pg_temp.h(p_date))))),
    p_intent);
end;
$f$;

-- upsert_deadline (create).
create function pg_temp.dl(p_tenant uuid, p_matter uuid, p_type text, p_date text,
                           p_tags jsonb default '{}'::jsonb, p_hashes jsonb default '{}'::jsonb,
                           p_links jsonb default '{}'::jsonb, p_state text default null)
returns jsonb language sql as $f$
  select pg_temp.w(p_tenant, 'upsert_deadline', jsonb_build_array(pg_temp.op('create', gen_random_uuid(), 'deadline',
    jsonb_build_object(
      'tags', jsonb_build_object('deadline_type', p_type, 'source_type', 'bc_rules') || p_tags,
      'links', jsonb_strip_nulls(jsonb_build_object('matter', p_matter)) || p_links,
      'hashes', jsonb_build_object('deadline_date', pg_temp.h(p_date), 'rule_ref', pg_temp.h('R. 1'),
        'rule_description', pg_temp.h('Rule text'), 'party_label', null, 'proceeding_label', null,
        'scenario_label', null, 'review_note', null) || p_hashes)
    || case when p_state is null then '{}'::jsonb else jsonb_build_object('state', p_state) end)));
$f$;

create function pg_temp.signal(p_tenant uuid, p_matter uuid, p_key text, p_state text)
returns jsonb language sql as $f$
  select pg_temp.w(p_tenant, 'upsert_signal', jsonb_build_array(pg_temp.op('upsert', gen_random_uuid(), 'signal',
    jsonb_build_object('state', p_state, 'tags', jsonb_build_object('signal_key', p_key),
      'links', jsonb_build_object('matter', p_matter),
      'hashes', jsonb_build_object('note', null, 'confirmed_at', pg_temp.h('2026-10-01'))))));
$f$;

create function pg_temp.entry(p_tenant uuid, p_matter uuid, p_tags jsonb default '{}'::jsonb)
returns jsonb language sql as $f$
  select pg_temp.w(p_tenant, 'insert_time_entry', jsonb_build_array(pg_temp.op('create', gen_random_uuid(), 'time_entry',
    jsonb_build_object('tags', p_tags, 'links', jsonb_build_object('matter', p_matter),
      'hashes', jsonb_build_object('entry_date', pg_temp.h('2026-08-01'), 'hours', pg_temp.h('1'),
                                   'description', pg_temp.h(gen_random_uuid()::text), 'batch_tag', null)))));
$f$;

create function pg_temp.invoice_op(p_matter uuid, p_number text, p_amount text)
returns jsonb language sql as $f$
  select pg_temp.op('upsert', gen_random_uuid(), 'invoice', jsonb_build_object(
    'links', jsonb_build_object('matter', p_matter),
    'hashes', jsonb_build_object('invoice_number', pg_temp.h(p_number), 'amount', pg_temp.h(p_amount))));
$f$;

-- The rule overlay fixture (fixtures/rule-overlay/rule-8-1-14-5-a.json) under a given record_id.
create function pg_temp.fixture(p_id uuid)
returns jsonb language sql immutable as $f$
  select jsonb_build_object('record_id', p_id) || '{
    "jurisdiction": "CA-BC",
    "enactment": {"name": "Supreme Court Civil Rules", "citation": "B.C. Reg. 168/2009", "civix_id": "168_2009"},
    "amending_instrument": {"reg": "B.C. Reg. 105/2026", "oic": "OIC 264/2026", "commencement": "2026-10-01"},
    "deadline_type": "notice_of_hearing_service",
    "anchor_type": "application_hearing_date",
    "base": "application_hearing_date",
    "rule_ref": "Rule 8-1(14.5)(a)",
    "offset": {"value": 4, "unit": "business_days", "direction": "before", "clear": true},
    "counting": "backward_n_business_days",
    "semantics": "mandatory",
    "description": "File the notice of hearing of application and serve a filed copy on each application respondent at least 4 business days before the hearing date (application of 2 hours or less).",
    "verbatim": "subject to paragraph (b) of this subrule, at least 4 business days before the date set for the hearing of the application",
    "source": {"url": "https://www.bclaws.gov.bc.ca/civix/document/id/oic/oic_cur/0264_2026", "fetched_at": "2026-10-05", "kind": "oic_pdf"},
    "effective_from": "2026-10-01",
    "effective_to": null,
    "supersedes": ["shipped:application_hearing_earliest"],
    "open_questions": ["s. 25.2(3) added day for business-day periods (#740)"],
    "status": "verified",
    "verified_by": "practitioner",
    "verified_at": "2026-10-05"
  }'::jsonb;
$f$;

create function pg_temp.repeal(p_id uuid)
returns jsonb language sql immutable as $f$
  select pg_temp.fixture(p_id) || '{
    "deadline_type": "application_hearing_earliest", "base": null, "rule_ref": "Rule 8-1(8)",
    "offset": null, "counting": null, "semantics": null,
    "description": "No earliest-hearing floor after service.",
    "verbatim": "by repealing subrules (5), (6), (7) and (8)",
    "supersedes": ["shipped:application_hearing_earliest"], "open_questions": []
  }'::jsonb;
$f$;

create function pg_temp.overlay(p_tenant uuid, p_rec jsonb, p_tags jsonb default null, p_state text default null)
returns jsonb language sql as $f$
  select pg_temp.w(p_tenant, 'upsert_rule_overlay', jsonb_build_array(pg_temp.op('upsert',
    (p_rec->>'record_id')::uuid, 'rule_overlay', jsonb_build_object(
      'state', coalesce(p_state, p_rec->>'status'),
      'tags', coalesce(p_tags, jsonb_build_object('deadline_type', p_rec->>'deadline_type',
                                                  'amending_reg', p_rec #>> '{amending_instrument,reg}')),
      'hashes', jsonb_build_object('record', pg_temp.h(p_rec::text)),
      'cross', p_rec))));
$f$;

-- ingest_court_calendar_year: the year upsert and one create per day; p_days is [[date, category], ...].
create function pg_temp.year(p_tenant uuid, p_year integer, p_state text, p_days jsonb default '[]'::jsonb)
returns jsonb language plpgsql as $f$
declare
  y uuid := gen_random_uuid();
  v_ops jsonb;
  d jsonb;
begin
  v_ops := jsonb_build_array(pg_temp.op('upsert', y, 'calendar_year', jsonb_build_object('state', p_state,
    'hashes', jsonb_build_object('year', pg_temp.h(p_year::text), 'source_document', pg_temp.h('CourtCalendar.pdf'),
                                 'checked_at', pg_temp.h(clock_timestamp()::text)))));
  for d in select e from jsonb_array_elements(p_days) e loop
    v_ops := v_ops || jsonb_build_array(pg_temp.op('create', gen_random_uuid(), 'calendar_day', jsonb_build_object(
      'tags', jsonb_build_object('status_category', d->>1),
      'links', jsonb_build_object('calendar_year', y),
      'hashes', jsonb_build_object('calendar_date', pg_temp.h(d->>0), 'status_label', pg_temp.h('Holiday')))));
  end loop;
  return pg_temp.w(p_tenant, 'ingest_court_calendar_year', v_ops);
end;
$f$;

create function pg_temp.seed_item(p_id uuid, p_kind text, p_body jsonb default '{}'::jsonb)
returns jsonb language sql immutable as $f$
  select jsonb_build_object('id', p_id, 'kind', p_kind) || p_body;
$f$;

-- =============================================================================
-- P. Privacy and setup
-- =============================================================================

do $t$
declare
  v_bad text;
begin
  select string_agg(x, '; ') into v_bad from (
    select format('%s has %s on schema %s', r, p, s) as x
    from unnest(array['anon', 'authenticated']) r, unnest(array['ledger', 'rules']) s, unnest(array['USAGE', 'CREATE']) p
    where has_schema_privilege(r, s, p)
    union all
    select format('%s can reach table %s.%s', r, n.nspname, c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace, unnest(array['anon', 'authenticated']) r
    where n.nspname in ('ledger', 'rules') and c.relkind in ('r', 'v', 'm', 'S')
      and has_table_privilege(r, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
    union all
    select format('%s can execute %s.%s', r, n.nspname, p.proname)
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace, unnest(array['anon', 'authenticated']) r
    where n.nspname in ('ledger', 'rules') and has_function_privilege(r, p.oid, 'EXECUTE')
  ) t;
  perform pg_temp.t_check('P1 anon, authenticated and public can reach no schema, table or function', v_bad is null, v_bad);
end $t$;

do $t$
declare
  v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('ledger', 'rules')
    and not coalesce('search_path=pg_catalog, pg_temp' = any (p.proconfig), false);
  perform pg_temp.t_check('P2 every function sets an explicit search_path', v_bad is null, v_bad);
end $t$;

do $t$
declare
  v_counts jsonb;
begin
  select jsonb_build_object(
    'kinds', (select count(*) from rules.kind),
    'policies', (select count(*) from rules.status_policy),
    'vocabulary', (select count(*) from rules.vocabulary),
    'tags', (select count(*) from rules.tag),
    'links', (select count(*) from rules.link_role),
    'keys', (select count(*) from rules.natural_key)) into v_counts;
  perform pg_temp.t_check('P3 applying both files twice leaves one copy of every table of the rulebook',
    v_counts = '{"kinds": 14, "policies": 8, "vocabulary": 63, "tags": 11, "links": 14, "keys": 8}'::jsonb, v_counts::text);
end $t$;

-- =============================================================================
-- W. The write envelope, idempotence and sync
-- =============================================================================

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_id uuid := gen_random_uuid();
  r jsonb;
begin
  r := pg_temp.w(v_t, 'upsert_task', jsonb_build_array(pg_temp.op('create', v_id, 'task', jsonb_build_object(
    'tags', jsonb_build_object('task_type', 'admin'), 'hashes', jsonb_build_object('description', pg_temp.h('x'))))));
  perform pg_temp.t_check('W1 a saved write answers saved, ops and seq, and each op its id, saved and as',
    pg_temp.keys(r) = array['ops', 'saved', 'seq'] and r->>'saved' = 'true'
    and pg_temp.keys(r->'ops'->0) = array['as', 'id', 'saved'] and pg_temp.as_id(r) = v_id
    and r->'ops'->0->>'saved' = 'true' and (r->>'seq')::bigint = 1 and pg_temp.st(v_t, v_id) = 'open', r::text);
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_write jsonb;
  r1 jsonb;
  r2 jsonb;
begin
  v_write := jsonb_build_object('write_id', gen_random_uuid(), 'store', 'practice', 'tool', 'upsert_task',
    'intent', '{}'::jsonb, 'ops', jsonb_build_array(pg_temp.op('create', gen_random_uuid(), 'task', jsonb_build_object(
      'tags', jsonb_build_object('task_type', 'admin'), 'hashes', jsonb_build_object('description', pg_temp.h('x'))))));
  r1 := rules.apply_write(v_t, v_write);
  r2 := rules.apply_write(v_t, v_write);
  perform pg_temp.t_check('W2 a repeated write_id gets the stored result and is not applied again',
    pg_temp.saved(r1) and r1 = r2 and pg_temp.live(v_t, 'task') = 1 and pg_temp.tenant_seq(v_t) = 1,
    format('%s / %s', r1, r2));
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_first uuid;
  r jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  v_first := pg_temp.as_id(pg_temp.dl(v_t, v_m, 'witness_list', '2026-04-14'));
  r := pg_temp.w(v_t, 'upsert_deadline', jsonb_build_array(
    pg_temp.op('create', gen_random_uuid(), 'deadline', jsonb_build_object(
      'tags', '{"deadline_type": "witness_list", "source_type": "bc_rules"}'::jsonb,
      'links', jsonb_build_object('matter', v_m),
      'hashes', jsonb_build_object('deadline_date', pg_temp.h('2026-04-15')))),
    pg_temp.op('create', gen_random_uuid(), 'task', jsonb_build_object('tags', '{"task_type": "personal"}'::jsonb))));
  perform pg_temp.t_check('W3 a refused write is all or nothing: no item saved, no side effect, no sequence number used',
    pg_temp.refused(r) and pg_temp.live(v_t, 'deadline') = 1 and pg_temp.live(v_t, 'task') = 0
    and pg_temp.st(v_t, v_first) = 'active' and pg_temp.tenant_seq(v_t) = 2, r::text);
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_first uuid;
  v_write jsonb;
  r1 jsonb;
  r2 jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  v_first := pg_temp.as_id(pg_temp.task(v_t, v_m, 'filing:3', 'First'));
  v_write := jsonb_build_object('write_id', gen_random_uuid(), 'store', 'practice', 'tool', 'upsert_task',
    'ops', jsonb_build_array(pg_temp.op('create', gen_random_uuid(), 'task', jsonb_build_object(
      'tags', '{"task_type": "client"}'::jsonb, 'links', jsonb_build_object('matter', v_m, 'filing', 'filing:3')))));
  r1 := rules.apply_write(v_t, v_write);
  perform pg_temp.upd(v_t, 'complete_task', v_first, 'task', '{"state": "completed"}'::jsonb);
  r2 := rules.apply_write(v_t, v_write);
  perform pg_temp.t_check('W4 a repeated write_id gets its stored refusal even after the item changed',
    pg_temp.refused(r1) and r1 = r2 and pg_temp.live(v_t, 'task') = 1, format('%s / %s', r1, r2));
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_task uuid;
  v_bad text := '';
  c record;
  r jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  v_task := pg_temp.as_id(pg_temp.task(v_t, v_m, null, 'Existing'));
  for c in
    select * from (values
      ('no write_id', '{"store": "practice", "ops": []}'::jsonb),
      ('another store', jsonb_build_object('write_id', gen_random_uuid(), 'store', 'other', 'ops', '[]'::jsonb)),
      ('no ops', jsonb_build_object('write_id', gen_random_uuid(), 'store', 'practice', 'ops', '[]'::jsonb)),
      ('unknown op', jsonb_build_object('write_id', gen_random_uuid(), 'store', 'practice',
         'ops', jsonb_build_array(pg_temp.op('replace', gen_random_uuid(), 'task')))),
      ('id not a uuid', jsonb_build_object('write_id', gen_random_uuid(), 'store', 'practice',
         'ops', '[{"op": "create", "id": "task-1", "kind": "task"}]'::jsonb)),
      ('unknown kind', jsonb_build_object('write_id', gen_random_uuid(), 'store', 'practice',
         'ops', jsonb_build_array(pg_temp.op('create', gen_random_uuid(), 'practice_tasks')))),
      ('bad hash', jsonb_build_object('write_id', gen_random_uuid(), 'store', 'practice',
         'ops', jsonb_build_array(pg_temp.op('create', gen_random_uuid(), 'task', jsonb_build_object(
           'tags', '{"task_type": "admin"}'::jsonb, 'hashes', '{"description": "Call the client"}'::jsonb))))),
      ('tags not an object', jsonb_build_object('write_id', gen_random_uuid(), 'store', 'practice',
         'ops', jsonb_build_array(pg_temp.op('create', gen_random_uuid(), 'task', '{"tags": ["admin"]}'::jsonb)))),
      ('cross on a task', jsonb_build_object('write_id', gen_random_uuid(), 'store', 'practice',
         'ops', jsonb_build_array(pg_temp.op('create', gen_random_uuid(), 'task', '{"tags": {"task_type": "admin"}, "cross": {}}'::jsonb)))),
      ('two ops one id', jsonb_build_object('write_id', gen_random_uuid(), 'store', 'practice',
         'ops', jsonb_build_array(pg_temp.op('create', v_m, 'task', '{"tags": {"task_type": "admin"}}'::jsonb),
                                  pg_temp.op('create', v_m, 'task', '{"tags": {"task_type": "admin"}}'::jsonb)))),
      ('update of an unknown item', jsonb_build_object('write_id', gen_random_uuid(), 'store', 'practice',
         'ops', jsonb_build_array(pg_temp.op('update', gen_random_uuid(), 'task', '{"state": "completed"}'::jsonb)))),
      ('create of an existing id', jsonb_build_object('write_id', gen_random_uuid(), 'store', 'practice',
         'ops', jsonb_build_array(pg_temp.op('create', v_task, 'task', '{"tags": {"task_type": "admin"}}'::jsonb)))),
      ('update of another kind', jsonb_build_object('write_id', gen_random_uuid(), 'store', 'practice',
         'ops', jsonb_build_array(pg_temp.op('update', v_task, 'deadline', '{"state": "met"}'::jsonb)))),
      ('unknown tag', jsonb_build_object('write_id', gen_random_uuid(), 'store', 'practice',
         'ops', jsonb_build_array(pg_temp.op('create', gen_random_uuid(), 'task', '{"tags": {"task_type": "admin", "priority": "high"}}'::jsonb)))),
      ('unknown link role', jsonb_build_object('write_id', gen_random_uuid(), 'store', 'practice',
         'ops', jsonb_build_array(pg_temp.op('create', gen_random_uuid(), 'task', jsonb_build_object(
           'tags', '{"task_type": "admin"}'::jsonb, 'links', jsonb_build_object('client', v_m)))))),
      ('link to a missing matter', jsonb_build_object('write_id', gen_random_uuid(), 'store', 'practice',
         'ops', jsonb_build_array(pg_temp.op('create', gen_random_uuid(), 'task', jsonb_build_object(
           'tags', '{"task_type": "admin"}'::jsonb, 'links', jsonb_build_object('matter', gen_random_uuid()))))))
    ) as v(name, write)
  loop
    r := rules.apply_write(v_t, c.write);
    insert into t_question (question) select r->>'question' where r ? 'question';
    if not pg_temp.refused(r) then
      v_bad := v_bad || format('%s: %s; ', c.name, r);
    end if;
  end loop;
  perform pg_temp.t_check('W5 a malformed write or op is refused with a question and nothing is saved',
    v_bad = '' and pg_temp.live(v_t, 'task') = 1 and pg_temp.tenant_seq(v_t) = 2, v_bad);
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m1 uuid;
  v_m2 uuid;
  v_client uuid;
begin
  v_m1 := pg_temp.matter(v_t, 'L100');
  v_client := ((pg_temp.item(v_t, v_m1)).links->>'client')::uuid;
  -- A second matter for the same client: the client upsert matches the existing client.
  perform pg_temp.w(v_t, 'upsert_client_matter', jsonb_build_array(
    pg_temp.op('upsert', '00000000-0000-4000-8000-000000000c02', 'client', jsonb_build_object('hashes',
      jsonb_build_object('client_num', pg_temp.h('C-L100')))),
    pg_temp.op('upsert', '00000000-0000-4000-8000-000000000a02', 'matter', jsonb_build_object(
      'links', '{"client": "00000000-0000-4000-8000-000000000c02"}'::jsonb,
      'hashes', jsonb_build_object('matt_num', pg_temp.h('L200'), 'file_number', pg_temp.h('F-L200'))))));
  v_m2 := '00000000-0000-4000-8000-000000000a02';
  perform pg_temp.t_check('W6 a link naming an earlier op of the same write points to the item that op was saved to',
    v_client is not null and pg_temp.live(v_t, 'client') = 1
    and (pg_temp.item(v_t, v_m2)).links->>'client' = v_client::text,
    (pg_temp.item(v_t, v_m2)).links::text);
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_old uuid;
  v_new uuid;
  v_since bigint;
  v_year jsonb;
  s jsonb;
  s0 jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  v_old := pg_temp.as_id(pg_temp.dl(v_t, v_m, 'witness_list', '2026-04-14'));
  v_since := pg_temp.tenant_seq(v_t);
  v_new := pg_temp.as_id(pg_temp.dl(v_t, v_m, 'witness_list', '2026-04-15'));
  v_year := pg_temp.year(v_t, 2026, 'confirmed', '[["2026-01-01", "full_closure"]]'::jsonb);
  s := rules.sync(v_t, 'practice', v_since);
  s0 := rules.sync(v_t, 'practice', 0);
  perform pg_temp.t_check('W7 sync returns every item changed after a sequence number, side effects included, without cloud-only links',
    pg_temp.keys(s) = array['items', 'seq'] and (s->>'seq')::bigint = pg_temp.tenant_seq(v_t)
    and jsonb_array_length(s->'items') = 4
    and exists (select 1 from jsonb_array_elements(s->'items') e
                where e->>'id' = v_old::text and e->>'state' = 'superseded' and e->>'deleted' = 'false')
    and exists (select 1 from jsonb_array_elements(s->'items') e where e->>'id' = v_new::text and e->>'state' = 'active')
    and exists (select 1 from jsonb_array_elements(s->'items') e where e->>'kind' = 'calendar_day' and e->'links' = '{}'::jsonb)
    and (select bool_and(pg_temp.keys(e) = array['deleted', 'id', 'kind', 'links', 'state', 'tags'])
         from jsonb_array_elements(s->'items') e)
    and jsonb_array_length(s0->'items') = 6
    and jsonb_array_length(rules.sync(v_t, 'practice', (s->>'seq')::bigint)->'items') = 0,
    s::text);
end $t$;

-- =============================================================================
-- R1. Lifecycle policies and set_status
-- =============================================================================

do $t$
declare
  v_ok boolean;
begin
  select bool_and(matched) and count(*) = 8 into v_ok from (
    select exists (
      select 1 from rules.status_policy p
      where p.status_label = d.label and p.required_signals = d.req
        and p.blocking_signals is not distinct from d.block and p.auto_advance = d.auto) as matched
    from (values
      ('prospective', '{}'::text[], '{conflict_check_completed}'::text[], true),
      ('intake', '{conflict_check_completed}', '{retainer_agreement_signed}', true),
      ('active', '{retainer_agreement_signed,deposit_received}', null, true),
      ('retainer_warning', '{retainer_agreement_signed}', null, true),
      ('retainer_depleted', '{retainer_agreement_signed}', null, true),
      ('closing', '{}', null, false),
      ('closed', '{representation_ended}', null, true),
      ('declined', '{conflict_check_completed}', null, false)) as d(label, req, block, auto)) t;
  perform pg_temp.t_check('R1 the eight default lifecycle policies are held once, as shipped', v_ok);
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  r jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  perform pg_temp.signal(v_t, v_m, 'retainer_agreement_signed', 'confirmed');
  perform pg_temp.signal(v_t, v_m, 'deposit_received', 'confirmed');
  r := pg_temp.upd(v_t, 'set_status', v_m, 'matter', '{"state": "active"}'::jsonb);
  perform pg_temp.t_check('R1 set_status saves a stage whose required signals are confirmed',
    pg_temp.saved(r) and pg_temp.st(v_t, v_m) = 'active', r::text);
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  r jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  perform pg_temp.signal(v_t, v_m, 'retainer_agreement_signed', 'confirmed');
  perform pg_temp.signal(v_t, v_m, 'deposit_received', 'unconfirmed');
  r := pg_temp.upd(v_t, 'set_status', v_m, 'matter', '{"state": "active"}'::jsonb);
  perform pg_temp.t_check('R1 set_status is refused while a required signal is not confirmed, asking about that signal',
    pg_temp.refused(r) and r->>'question' like '%deposit_received%' and r->>'question' like '%{{item:' || v_m || '}}%'
    and pg_temp.st(v_t, v_m) is null, r::text);
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  r1 jsonb;
  r2 jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  r1 := pg_temp.upd(v_t, 'set_status', v_m, 'matter', '{"state": "prospective"}'::jsonb);
  perform pg_temp.signal(v_t, v_m, 'conflict_check_completed', 'confirmed');
  r2 := pg_temp.upd(v_t, 'set_status', v_m, 'matter', '{"state": "prospective"}'::jsonb);
  perform pg_temp.t_check('R1 set_status is refused once a blocking signal is confirmed',
    pg_temp.saved(r1) and pg_temp.refused(r2) and r2->>'question' like '%conflict_check_completed%',
    format('%s / %s', r1, r2));
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  r1 jsonb;
  r2 jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  r1 := pg_temp.upd(v_t, 'set_status', v_m, 'matter', '{"state": "dormant"}'::jsonb);
  r2 := pg_temp.w(v_t, 'upsert_client_matter', jsonb_build_array(pg_temp.op('upsert', gen_random_uuid(), 'matter',
    jsonb_build_object('state', 'active', 'hashes', jsonb_build_object('file_number', pg_temp.h('F-L100'))))));
  perform pg_temp.t_check('R1 set_status refuses an unknown stage; other tools write the state without the signal check',
    pg_temp.refused(r1) and pg_temp.saved(r2) and pg_temp.as_id(r2) = v_m and pg_temp.st(v_t, v_m) = 'active',
    format('%s / %s', r1, r2));
end $t$;

-- =============================================================================
-- R2. Vocabularies and state transitions
-- =============================================================================

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_bad text := '';
  c record;
  r jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  for c in
    select * from (values
      ('task_type', pg_temp.op('create', gen_random_uuid(), 'task', '{"tags": {"task_type": "personal"}}'::jsonb)),
      ('task state', pg_temp.op('create', gen_random_uuid(), 'task', '{"state": "done", "tags": {"task_type": "admin"}}'::jsonb)),
      ('deadline source_type', pg_temp.op('create', gen_random_uuid(), 'deadline',
         '{"tags": {"deadline_type": "x", "source_type": "statute"}}'::jsonb)),
      ('deadline review_flag', pg_temp.op('create', gen_random_uuid(), 'deadline',
         '{"tags": {"deadline_type": "x", "source_type": "manual", "review_flag": "maybe"}}'::jsonb)),
      ('deadline state', pg_temp.op('create', gen_random_uuid(), 'deadline',
         '{"state": "expired", "tags": {"deadline_type": "x", "source_type": "manual"}}'::jsonb)),
      ('signal state', pg_temp.op('upsert', gen_random_uuid(), 'signal', jsonb_build_object('state', 'yes',
         'tags', '{"signal_key": "deposit_received"}'::jsonb, 'links', jsonb_build_object('matter', v_m)))),
      ('calendar year state', pg_temp.op('upsert', gen_random_uuid(), 'calendar_year',
         jsonb_build_object('state', 'partial', 'hashes', jsonb_build_object('year', pg_temp.h('2030'))))),
      ('matter billable', pg_temp.op('update', v_m, 'matter', '{"tags": {"billable": "yes"}}'::jsonb)),
      ('time entry state', pg_temp.op('create', gen_random_uuid(), 'time_entry',
         jsonb_build_object('state', 'open', 'links', jsonb_build_object('matter', v_m)))),
      ('required task_type', pg_temp.op('create', gen_random_uuid(), 'task', '{}'::jsonb)),
      ('required matter link', pg_temp.op('create', gen_random_uuid(), 'time_entry', '{}'::jsonb)),
      ('required signal state', pg_temp.op('upsert', gen_random_uuid(), 'signal', jsonb_build_object(
         'tags', '{"signal_key": "deposit_received"}'::jsonb, 'links', jsonb_build_object('matter', v_m)))),
      ('a source alone', pg_temp.op('create', gen_random_uuid(), 'anchor_source', '{"state": "confirmed"}'::jsonb)),
      ('an anchor by create', pg_temp.op('create', gen_random_uuid(), 'anchor',
         jsonb_build_object('tags', '{"anchor_type": "trial_date"}'::jsonb, 'links', jsonb_build_object('matter', v_m))))
    ) as v(name, op)
  loop
    r := pg_temp.w(v_t, 'scratch', jsonb_build_array(c.op));
    if not pg_temp.refused(r) then
      v_bad := v_bad || format('%s: %s; ', c.name, r);
    end if;
  end loop;
  perform pg_temp.t_check('R2 a value outside a kind''s vocabulary, or a missing required tag, link or state, is refused',
    v_bad = '' and pg_temp.live(v_t, 'task') = 0 and pg_temp.live(v_t, 'deadline') = 0
    and pg_temp.live(v_t, 'signal') = 0 and (pg_temp.item(v_t, v_m)).tags->>'billable' = 'true', v_bad);
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_ids uuid[] := '{}';
  v_bad text := '';
  v_state text;
  r jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  foreach v_state in array array['dismissed', 'met', 'not_applicable', 'stale'] loop
    r := pg_temp.dl(v_t, v_m, 'type_' || v_state, '2026-04-14');
    v_ids := v_ids || pg_temp.as_id(r);
    r := pg_temp.upd(v_t, 'upsert_deadline', pg_temp.as_id(r), 'deadline', jsonb_build_object('state', v_state));
    if not pg_temp.saved(r) or pg_temp.st(v_t, v_ids[cardinality(v_ids)]) <> v_state then
      v_bad := v_bad || v_state || ' ';
    end if;
  end loop;
  r := pg_temp.dl(v_t, v_m, 'arbitration_counterclaim', '2026-07-01', p_state => 'not_applicable');
  perform pg_temp.t_check('R2 a deadline takes dismissed, met, not_applicable and stale by id and is kept, not deleted',
    v_bad = '' and pg_temp.saved(r) and pg_temp.st(v_t, pg_temp.as_id(r)) = 'not_applicable'
    and pg_temp.live(v_t, 'deadline') = 5, v_bad || r::text);
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_p uuid := gen_random_uuid();
  r1 jsonb;
  r2 jsonb;
  r3 jsonb;
  r4 jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  r1 := pg_temp.w(v_t, 'manage_payment_in_flight', jsonb_build_array(pg_temp.op('create', v_p, 'payment',
    jsonb_build_object('links', jsonb_build_object('matter', v_m), 'hashes', jsonb_build_object('amount', pg_temp.h('500'))))));
  r2 := pg_temp.upd(v_t, 'manage_payment_in_flight', v_p, 'payment', '{"state": "true"}'::jsonb);
  r3 := pg_temp.upd(v_t, 'manage_payment_in_flight', v_p, 'payment', '{"state": "false"}'::jsonb);
  r4 := pg_temp.w(v_t, 'manage_payment_in_flight', jsonb_build_array(pg_temp.op('create', gen_random_uuid(), 'payment',
    jsonb_build_object('state', 'true', 'links', jsonb_build_object('matter', v_m)))));
  perform pg_temp.t_check('R2 a payment is recorded uncleared and clears once; un-clearing or recording it cleared is refused',
    pg_temp.saved(r1) and pg_temp.saved(r2) and pg_temp.refused(r3) and pg_temp.refused(r4)
    and pg_temp.st(v_t, v_p) = 'true' and pg_temp.live(v_t, 'payment') = 1,
    format('%s / %s / %s / %s', r1, r2, r3, r4));
end $t$;

-- =============================================================================
-- R3. One open to-do per (matter, filing); a filing link needs a matter
-- =============================================================================

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_first uuid;
  v_forum uuid;
  r1 jsonb;
  r2 jsonb;
  v_ok boolean;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  v_first := pg_temp.as_id(pg_temp.task(v_t, v_m, 'filing:3', 'Re-file default judgment application'));
  r1 := pg_temp.task(v_t, v_m, 'filing:3', 'Research the rejection');
  v_forum := pg_temp.as_id(pg_temp.task(v_t, v_m, 'proceeding:2', 'Choose the forum'));
  r2 := pg_temp.task(v_t, v_m, 'proceeding:2', 'Research the forum');
  v_ok := pg_temp.saved(pg_temp.task(v_t, v_m, 'filing:4', 'Settle a different filing'))
      and pg_temp.saved(pg_temp.task(v_t, v_m, 'proceeding:3', 'A proceeding sharing the number'))
      and pg_temp.saved(pg_temp.task(v_t, v_m, null, 'Points nowhere'))
      and pg_temp.saved(pg_temp.task(v_t, v_m, null, 'Also points nowhere'));
  perform pg_temp.t_check('R3 a second open to-do on one filing in one matter is refused, asking about the first',
    pg_temp.refused(r1) and r1->>'question' like '%{{item:' || v_first || '}}%'
    and pg_temp.refused(r2) and r2->>'question' like '%{{item:' || v_forum || '}}%'
    and v_ok and pg_temp.live(v_t, 'task') = 6, format('%s / %s', r1, r2));
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m1 uuid;
  v_m2 uuid;
  r jsonb;
begin
  v_m1 := pg_temp.matter(v_t, 'L100');
  v_m2 := pg_temp.matter(v_t, 'L200');
  perform pg_temp.task(v_t, v_m1, 'filing:3', 'Ours');
  r := pg_temp.task(v_t, v_m2, 'filing:3', 'Theirs');
  perform pg_temp.t_check('R3 the same filing in a different matter is allowed', pg_temp.saved(r), r::text);
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_done uuid;
  v_second uuid;
  r1 jsonb;
  r2 jsonb;
  r3 jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  v_done := pg_temp.as_id(pg_temp.task(v_t, v_m, 'filing:3', 'First attempt'));
  perform pg_temp.upd(v_t, 'complete_task', v_done, 'task', '{"state": "completed"}'::jsonb);
  r1 := pg_temp.task(v_t, v_m, 'filing:3', 'Second attempt');
  v_second := pg_temp.as_id(r1);
  perform pg_temp.upd(v_t, 'upsert_task', v_second, 'task', '{"state": "withdrawn"}'::jsonb);
  r2 := pg_temp.task(v_t, v_m, 'filing:3', 'Third attempt');
  perform pg_temp.task(v_t, v_m, 'filing:5', 'On hold', '{"state": "paused"}'::jsonb);
  r3 := pg_temp.task(v_t, v_m, 'filing:5', 'Taken up again');
  perform pg_temp.t_check('R3 a completed, paused or withdrawn to-do does not hold its filing',
    pg_temp.saved(r1) and pg_temp.saved(r2) and pg_temp.saved(r3)
    and pg_temp.st(v_t, v_second) = 'withdrawn' and pg_temp.live(v_t, 'task') = 5,
    format('%s / %s / %s', r1, r2, r3));
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m1 uuid;
  v_m2 uuid;
  v_holder uuid;
  v_other uuid;
  v_elsewhere uuid;
  v_done uuid;
  v_withdrawn uuid;
  r_repoint jsonb;
  r_move jsonb;
  r_carry jsonb;
  r_reopen jsonb;
  r_reopen2 jsonb;
  r_restate jsonb;
  v_q text := 'which already covers this filing';
begin
  v_m1 := pg_temp.matter(v_t, 'L100');
  v_m2 := pg_temp.matter(v_t, 'L200');
  v_holder := pg_temp.as_id(pg_temp.task(v_t, v_m1, 'filing:3', 'Re-file'));
  v_other := pg_temp.as_id(pg_temp.task(v_t, v_m1, 'filing:4', 'Other filing'));
  r_repoint := pg_temp.upd(v_t, 'upsert_task', v_other, 'task', '{"links": {"filing": "filing:3"}}'::jsonb);
  v_elsewhere := pg_temp.as_id(pg_temp.task(v_t, v_m2, 'filing:3', 'Other matter'));
  r_move := pg_temp.upd(v_t, 'upsert_task', v_elsewhere, 'task', jsonb_build_object('links', jsonb_build_object('matter', v_m1)));
  v_done := pg_temp.as_id(pg_temp.task(v_t, v_m1, null, 'Done earlier'));
  perform pg_temp.upd(v_t, 'complete_task', v_done, 'task', '{"state": "completed"}'::jsonb);
  r_carry := pg_temp.upd(v_t, 'upsert_task', v_done, 'task', '{"links": {"filing": "filing:3"}}'::jsonb);
  r_reopen := pg_temp.upd(v_t, 'upsert_task', v_done, 'task', '{"state": "open"}'::jsonb);
  v_withdrawn := pg_temp.as_id(pg_temp.task(v_t, v_m1, null, 'Entered in error'));
  perform pg_temp.upd(v_t, 'upsert_task', v_withdrawn, 'task', '{"state": "withdrawn"}'::jsonb);
  r_reopen2 := pg_temp.upd(v_t, 'upsert_task', v_withdrawn, 'task', '{"state": "open", "links": {"filing": "filing:3"}}'::jsonb);
  r_restate := pg_temp.upd(v_t, 'upsert_task', v_holder, 'task', jsonb_build_object('links', '{"filing": "filing:3"}'::jsonb,
    'hashes', jsonb_build_object('description', pg_temp.h('Re-file it'))));
  perform pg_temp.t_check('R3 re-pointing, moving or re-opening into a held filing is refused and changes nothing; the holder may restate it',
    pg_temp.refused(r_repoint) and r_repoint->>'question' like '%' || v_holder || '%' || v_q || '%'
    and pg_temp.refused(r_move) and pg_temp.saved(r_carry) and pg_temp.refused(r_reopen)
    and pg_temp.refused(r_reopen2) and pg_temp.saved(r_restate)
    and (pg_temp.item(v_t, v_other)).links->>'filing' = 'filing:4'
    and (pg_temp.item(v_t, v_elsewhere)).links->>'matter' = v_m2::text
    and pg_temp.st(v_t, v_done) = 'completed' and pg_temp.st(v_t, v_withdrawn) = 'withdrawn'
    and (pg_temp.item(v_t, v_holder)).hashes->>'description' = pg_temp.h('Re-file it'),
    format('%s / %s / %s / %s / %s / %s', r_repoint, r_move, r_carry, r_reopen, r_reopen2, r_restate));
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid := gen_random_uuid();
  v_first uuid := gen_random_uuid();
  v_legacy uuid := gen_random_uuid();
  s jsonb;
  r1 jsonb;
  r2 jsonb;
begin
  s := rules.seed(v_t, 'practice', jsonb_build_array(
    pg_temp.seed_item(v_m, 'matter', '{"tags": {"billable": true}}'::jsonb),
    pg_temp.seed_item(v_first, 'task', jsonb_build_object('state', 'open', 'tags', '{"task_type": "client"}'::jsonb,
      'links', jsonb_build_object('matter', v_m, 'filing', 'filing:3'))),
    pg_temp.seed_item(v_legacy, 'task', jsonb_build_object('state', 'open', 'tags', '{"task_type": "client"}'::jsonb,
      'links', jsonb_build_object('matter', v_m, 'filing', 'filing:3')))));
  r1 := pg_temp.upd(v_t, 'upsert_task', v_legacy, 'task', jsonb_build_object('hashes', jsonb_build_object(
    'next_nudge_date', pg_temp.h('2026-10-01'), 'last_nudged_at', pg_temp.h('2026-09-24T09:00:00.000Z'))));
  r2 := pg_temp.upd(v_t, 'upsert_task', v_legacy, 'task', '{"links": {"filing": "filing:3"}}'::jsonb);
  perform pg_temp.t_check('R3 an update naming no matter, filing or state lands on two to-dos already sharing a filing',
    pg_temp.saved(r1) and pg_temp.refused(r2) and r2->>'question' like '%' || v_first || '%'
    and (pg_temp.item(v_t, v_legacy)).hashes->>'next_nudge_date' = pg_temp.h('2026-10-01'),
    format('%s / %s / %s', s, r1, r2));
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_loose uuid;
  v_own uuid;
  r1 jsonb;
  r2 jsonb;
  r3 jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  r1 := pg_temp.w(v_t, 'upsert_task', jsonb_build_array(pg_temp.op('create', gen_random_uuid(), 'task',
    '{"tags": {"task_type": "admin"}, "links": {"filing": "filing:1"}}'::jsonb)));
  v_loose := pg_temp.as_id(pg_temp.task(v_t, null, null, 'CLE reporting'));
  r2 := pg_temp.upd(v_t, 'upsert_task', v_loose, 'task', '{"links": {"filing": "filing:1"}}'::jsonb);
  v_own := pg_temp.as_id(pg_temp.task(v_t, v_m, null, 'Settle it'));
  r3 := pg_temp.upd(v_t, 'upsert_task', v_own, 'task', '{"links": {"filing": "filing:1"}}'::jsonb);
  perform pg_temp.t_check('R3 a filing link on a to-do with no matter is refused; an update takes the to-do''s own matter',
    pg_temp.refused(r1) and pg_temp.refused(r2) and pg_temp.saved(r3)
    and (pg_temp.item(v_t, v_own)).links->>'filing' = 'filing:1' and pg_temp.live(v_t, 'task') = 2,
    format('%s / %s / %s', r1, r2, r3));
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_task uuid;
  r1 jsonb;
  r2 jsonb;
  v_item ledger.item;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  v_task := pg_temp.as_id(pg_temp.task(v_t, v_m, 'filing:3', 'Settle the requisition', jsonb_build_object('hashes',
    jsonb_build_object('description', pg_temp.h('Settle the requisition'), 'next_nudge_date', pg_temp.h('2026-08-10'),
                       'nudge_interval_days', pg_temp.h('30'), 'deadline_date', pg_temp.h('2026-09-01')))));
  r1 := pg_temp.upd(v_t, 'upsert_task', v_task, 'task', jsonb_build_object('hashes', jsonb_build_object(
    'next_nudge_date', pg_temp.h('2026-09-09'), 'last_nudged_at', pg_temp.h('2026-08-10T14:00:00.000Z'))));
  r2 := pg_temp.upd(v_t, 'upsert_task', v_task, 'task', '{"links": {"filing": null}, "hashes": {"next_nudge_date": null, "nudge_interval_days": null}}'::jsonb);
  v_item := pg_temp.item(v_t, v_task);
  perform pg_temp.t_check('R3 an update changes only what it names: a nudge advance keeps the rest, and null clears the filing and a field',
    pg_temp.saved(r1) and pg_temp.saved(r2) and v_item.state = 'open' and not (v_item.links ? 'filing')
    and v_item.links->>'matter' = v_m::text
    and v_item.hashes->>'description' = pg_temp.h('Settle the requisition')
    and v_item.hashes->>'deadline_date' = pg_temp.h('2026-09-01')
    and v_item.hashes->>'last_nudged_at' = pg_temp.h('2026-08-10T14:00:00.000Z')
    and v_item.hashes ? 'next_nudge_date' and v_item.hashes->>'next_nudge_date' is null
    and v_item.hashes->>'nudge_interval_days' is null,
    format('%s / %s', r1, v_item));
end $t$;

-- =============================================================================
-- R4. Anchors
-- =============================================================================

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_a uuid;
  r jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  r := pg_temp.anchor(v_t, v_m, 'trial_date', '2026-09-01', 'Notice of Trial');
  v_a := pg_temp.as_id(r, 0);
  perform pg_temp.t_check('R4 a new anchor is active, its source confirmed, each saved under its own id',
    pg_temp.saved(r) and v_a = (r->'ops'->0->>'id')::uuid and r->'ops'->0->>'saved' = 'true'
    and r->'ops'->1->>'as' = r->'ops'->1->>'id' and r->'ops'->1->>'saved' = 'true'
    and pg_temp.st(v_t, v_a) = 'active' and pg_temp.src(v_t, v_a, 'Notice of Trial') = 'confirmed', r::text);
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_a uuid;
  r jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  v_a := pg_temp.as_id(pg_temp.anchor(v_t, v_m, 'trial_date', '2026-09-01', 'Notice of Trial'));
  r := pg_temp.anchor(v_t, v_m, 'trial_date', '2026-10-15', 'TMC Order');
  perform pg_temp.t_check('R4 a conflicting date adds a conflicted source under the one anchor and leaves its date',
    pg_temp.saved(r) and pg_temp.as_id(r, 0) = v_a and r->'ops'->0->>'saved' = 'false'
    and r->'ops'->1->>'saved' = 'true' and pg_temp.live(v_t, 'anchor') = 1
    and pg_temp.st(v_t, v_a) = 'conflicted' and (pg_temp.item(v_t, v_a)).hashes->>'anchor_date' = pg_temp.h('2026-09-01')
    and pg_temp.nsrc(v_t, v_a) = 2 and pg_temp.src(v_t, v_a, 'Notice of Trial') = 'confirmed'
    and pg_temp.src(v_t, v_a, 'TMC Order') = 'conflicted', r::text);
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_a uuid;
  r jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  v_a := pg_temp.as_id(pg_temp.anchor(v_t, v_m, 'trial_date', '2026-09-01', 'Notice of Trial'));
  perform pg_temp.anchor(v_t, v_m, 'trial_date', '2026-10-15', 'TMC Order');
  r := pg_temp.anchor(v_t, v_m, 'trial_date', '2026-09-01', 'Registrar confirmation');
  perform pg_temp.t_check('R4 re-asserting the anchor''s own date resolves the conflict without a resolve flag',
    pg_temp.saved(r) and pg_temp.live(v_t, 'anchor') = 1 and pg_temp.st(v_t, v_a) = 'active'
    and (pg_temp.item(v_t, v_a)).hashes->>'anchor_date' = pg_temp.h('2026-09-01')
    and pg_temp.src(v_t, v_a, 'Notice of Trial') = 'confirmed'
    and pg_temp.src(v_t, v_a, 'Registrar confirmation') = 'confirmed'
    and pg_temp.src(v_t, v_a, 'TMC Order') = 'conflicted', r::text);
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_a uuid;
  v_amended_src uuid;
  r jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  v_a := pg_temp.as_id(pg_temp.anchor(v_t, v_m, 'trial_date', '2026-09-01', 'Notice of Trial'));
  v_amended_src := pg_temp.as_id(pg_temp.anchor(v_t, v_m, 'trial_date', '2026-10-15', 'Amended Notice of Trial'), 1);
  r := pg_temp.anchor(v_t, v_m, 'trial_date', '2026-10-15', 'Amended Notice of Trial', '{"resolve": true}'::jsonb);
  perform pg_temp.t_check('R4 resolve to the later date makes it authoritative and re-marks the sources without duplicating one',
    pg_temp.saved(r) and r->'ops'->0->>'saved' = 'true' and r->'ops'->1->>'saved' = 'false'
    and pg_temp.as_id(r, 1) = v_amended_src and pg_temp.nsrc(v_t, v_a) = 2 and pg_temp.st(v_t, v_a) = 'active'
    and (pg_temp.item(v_t, v_a)).hashes->>'anchor_date' = pg_temp.h('2026-10-15')
    and pg_temp.src(v_t, v_a, 'Amended Notice of Trial') = 'confirmed'
    and pg_temp.src(v_t, v_a, 'Notice of Trial') = 'conflicted', r::text);
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_a uuid;
  r jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  v_a := pg_temp.as_id(pg_temp.anchor(v_t, v_m, 'trial_date', '2026-09-01', 'Notice of Trial'));
  perform pg_temp.anchor(v_t, v_m, 'trial_date', '2026-10-15', 'Amended Notice of Trial');
  r := pg_temp.anchor(v_t, v_m, 'trial_date', '2026-09-01', 'Notice of Trial', '{"resolve": true}'::jsonb);
  perform pg_temp.t_check('R4 resolve re-citing the original source keeps one anchor and two sources (path 2b)',
    pg_temp.saved(r) and pg_temp.live(v_t, 'anchor') = 1 and pg_temp.nsrc(v_t, v_a) = 2
    and pg_temp.st(v_t, v_a) = 'active' and (pg_temp.item(v_t, v_a)).hashes->>'anchor_date' = pg_temp.h('2026-09-01')
    and pg_temp.src(v_t, v_a, 'Notice of Trial') = 'confirmed'
    and pg_temp.src(v_t, v_a, 'Amended Notice of Trial') = 'conflicted', r::text);
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_a uuid;
  r1 jsonb;
  r2 jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  v_a := pg_temp.as_id(pg_temp.anchor(v_t, v_m, 'trial_date', '2026-09-01', 'Notice of Trial'));
  r1 := pg_temp.anchor(v_t, v_m, 'trial_date', '2026-10-15', 'Amended Notice of Trial', '{"amend": true}'::jsonb);
  r2 := pg_temp.anchor(v_t, v_m, 'trial_date', '2026-10-15', 'Amended Notice of Trial', '{"resolve": true}'::jsonb);
  perform pg_temp.t_check('R4 amend moves the date, supersedes the prior authoritative source, and resolve keeps it superseded (path 4)',
    pg_temp.saved(r1) and pg_temp.as_id(r1, 0) = v_a and r1->'ops'->0->>'saved' = 'true'
    and pg_temp.saved(r2) and pg_temp.st(v_t, v_a) = 'active'
    and (pg_temp.item(v_t, v_a)).hashes->>'anchor_date' = pg_temp.h('2026-10-15')
    and pg_temp.nsrc(v_t, v_a) = 2 and pg_temp.src(v_t, v_a, 'Notice of Trial') = 'superseded'
    and pg_temp.src(v_t, v_a, 'Amended Notice of Trial') = 'confirmed', format('%s / %s', r1, r2));
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_a uuid;
  r_both jsonb;
  r_none jsonb;
  r_same jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  r_both := pg_temp.anchor(v_t, v_m, 'trial_date', '2026-09-01', 'Notice of Trial', '{"amend": true, "resolve": true}'::jsonb);
  r_none := pg_temp.anchor(v_t, v_m, 'trial_date', '2026-09-01', 'Notice of Trial', '{"amend": true}'::jsonb);
  v_a := pg_temp.as_id(pg_temp.anchor(v_t, v_m, 'trial_date', '2026-09-01', 'Notice of Trial'));
  r_same := pg_temp.anchor(v_t, v_m, 'trial_date', '2026-09-01', 'Notice of Trial', '{"amend": true}'::jsonb);
  perform pg_temp.t_check('R4 amend is refused with resolve, without an anchor, or with the date already recorded',
    pg_temp.refused(r_both) and pg_temp.refused(r_none) and pg_temp.refused(r_same)
    and pg_temp.live(v_t, 'anchor') = 1 and pg_temp.nsrc(v_t, v_a) = 1,
    format('%s / %s / %s', r_both, r_none, r_same));
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_a uuid;
  v_b uuid;
  r jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  v_a := pg_temp.as_id(pg_temp.anchor(v_t, v_m, 'nocc_served', '2026-09-01', 'Affidavit of Service A',
    p_hashes => jsonb_build_object('party_label', pg_temp.h('Defendant A'))));
  v_b := pg_temp.as_id(pg_temp.anchor(v_t, v_m, 'nocc_served', '2026-09-20', 'Affidavit of Service B',
    p_hashes => jsonb_build_object('party_label', pg_temp.h('Defendant B'))));
  r := pg_temp.anchor(v_t, v_m, 'nocc_served', '2026-09-05', 'Amended Affidavit of Service',
    p_hashes => jsonb_build_object('party_label', pg_temp.h('Defendant A')));
  perform pg_temp.t_check('R4 another party''s anchor of the same type never collides; the same party''s new date conflicts',
    v_a <> v_b and pg_temp.live(v_t, 'anchor') = 2 and pg_temp.st(v_t, v_b) = 'active'
    and pg_temp.as_id(r, 0) = v_a and pg_temp.st(v_t, v_a) = 'conflicted', r::text);
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_a uuid;
  v_b uuid;
  r jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  v_a := pg_temp.as_id(pg_temp.anchor(v_t, v_m, 'order_pronounced', '2026-09-01', 'Arbitral Award',
    p_hashes => jsonb_build_object('proceeding_label', pg_temp.h('Arbitration'))));
  v_b := pg_temp.as_id(pg_temp.anchor(v_t, v_m, 'order_pronounced', '2026-10-20', 'Court Order',
    p_hashes => jsonb_build_object('proceeding_label', pg_temp.h('Court action'))));
  r := pg_temp.anchor(v_t, v_m, 'order_pronounced', '2026-09-05', 'Corrected Award',
    p_hashes => jsonb_build_object('proceeding_label', pg_temp.h('Arbitration')));
  perform pg_temp.t_check('R4 another proceeding''s anchor of the same type never collides; the same proceeding''s new date conflicts',
    v_a <> v_b and pg_temp.live(v_t, 'anchor') = 2 and pg_temp.st(v_t, v_b) = 'active'
    and pg_temp.as_id(r, 0) = v_a and pg_temp.st(v_t, v_a) = 'conflicted', r::text);
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_a uuid;
  r jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  v_a := pg_temp.as_id(pg_temp.anchor(v_t, v_m, 'application_hearing_date', '2026-07-17', 'Notice of Application'));
  r := pg_temp.anchor(v_t, v_m, 'application_hearing_date', '2026-07-17', 'Practitioner confirmation', '{"occurred": true}'::jsonb);
  perform pg_temp.t_check('R4 occurred records the confirming source and marks the anchor occurred',
    pg_temp.saved(r) and pg_temp.as_id(r, 0) = v_a and r->'ops'->0->>'saved' = 'false'
    and pg_temp.live(v_t, 'anchor') = 1 and pg_temp.st(v_t, v_a) = 'occurred'
    and pg_temp.src(v_t, v_a, 'Practitioner confirmation') = 'confirmed', r::text);
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_a uuid;
  r_none jsonb;
  r_moved jsonb;
  r_both jsonb;
  r_conflicted jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  r_none := pg_temp.anchor(v_t, v_m, 'application_hearing_date', '2026-07-17', 'Practitioner confirmation', '{"occurred": true}'::jsonb);
  v_a := pg_temp.as_id(pg_temp.anchor(v_t, v_m, 'application_hearing_date', '2026-07-17', 'Notice of Application'));
  r_moved := pg_temp.anchor(v_t, v_m, 'application_hearing_date', '2026-07-18', 'Practitioner confirmation', '{"occurred": true}'::jsonb);
  r_both := pg_temp.anchor(v_t, v_m, 'application_hearing_date', '2026-07-17', 'Practitioner confirmation', '{"occurred": true, "amend": true}'::jsonb);
  perform pg_temp.anchor(v_t, v_m, 'application_hearing_date', '2026-07-24', 'Requisition');
  r_conflicted := pg_temp.anchor(v_t, v_m, 'application_hearing_date', '2026-07-17', 'Practitioner confirmation', '{"occurred": true}'::jsonb);
  perform pg_temp.t_check('R4 occurred is refused with no anchor, a moved date, another intent, or a conflict',
    pg_temp.refused(r_none) and pg_temp.refused(r_moved) and r_moved->>'question' like '%move%'
    and pg_temp.refused(r_both)
    and pg_temp.refused(r_conflicted) and r_conflicted->>'question' like '%authoritative%'
    and pg_temp.st(v_t, v_a) = 'conflicted' and pg_temp.nsrc(v_t, v_a) = 2,
    format('%s / %s / %s / %s', r_none, r_moved, r_both, r_conflicted));
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_a uuid;
  r jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  v_a := pg_temp.as_id(pg_temp.anchor(v_t, v_m, 'application_hearing_date', '2026-07-17', 'Notice of Application'));
  perform pg_temp.anchor(v_t, v_m, 'application_hearing_date', '2026-07-17', 'Practitioner confirmation', '{"occurred": true}'::jsonb);
  r := pg_temp.anchor(v_t, v_m, 'application_hearing_date', '2026-09-04', 'Order made at hearing', '{"amend": true}'::jsonb);
  perform pg_temp.t_check('R4 amend returns an occurred anchor to active when the event moved',
    pg_temp.saved(r) and pg_temp.as_id(r, 0) = v_a and pg_temp.st(v_t, v_a) = 'active'
    and (pg_temp.item(v_t, v_a)).hashes->>'anchor_date' = pg_temp.h('2026-09-04'), r::text);
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_a uuid;
  v_kept text;
  r jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  v_a := pg_temp.as_id(pg_temp.anchor(v_t, v_m, 'application_hearing_date', '2026-07-17', 'Notice of Hearing',
    p_links => '{"filing": "filing:3"}'::jsonb));
  perform pg_temp.anchor(v_t, v_m, 'application_hearing_date', '2026-07-17', 'Practitioner confirmation');
  v_kept := (pg_temp.item(v_t, v_a)).links->>'filing';
  r := pg_temp.anchor(v_t, v_m, 'application_hearing_date', '2026-07-17', 'Practitioner confirmation',
    p_links => '{"filing": null}'::jsonb);
  perform pg_temp.t_check('R4 an anchor''s filing link is kept by an upsert that omits it and cleared by null, never adding an anchor',
    v_kept = 'filing:3' and pg_temp.saved(r) and not ((pg_temp.item(v_t, v_a)).links ? 'filing')
    and pg_temp.live(v_t, 'anchor') = 1, r::text);
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid := gen_random_uuid();
  v_a1 uuid := gen_random_uuid();
  v_a2 uuid := gen_random_uuid();
  v_old uuid := gen_random_uuid();
  v_s1 uuid := gen_random_uuid();
  v_s2 uuid := gen_random_uuid();
  v_t2 uuid := gen_random_uuid();
  v_m2 uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid();
  s jsonb;
  r jsonb;
  r2 jsonb;
  r3 jsonb;
begin
  -- Two live anchors sharing one key, as an old database may hold them.
  s := rules.seed(v_t, 'practice', jsonb_build_array(
    pg_temp.seed_item(v_m, 'matter'),
    pg_temp.seed_item(v_a1, 'anchor', jsonb_build_object('state', 'active', 'tags', '{"anchor_type": "trial_date"}'::jsonb,
      'links', jsonb_build_object('matter', v_m), 'hashes', jsonb_build_object('anchor_date', pg_temp.h('2026-09-01')))),
    pg_temp.seed_item(v_a2, 'anchor', jsonb_build_object('state', 'active', 'tags', '{"anchor_type": "trial_date"}'::jsonb,
      'links', jsonb_build_object('matter', v_m), 'hashes', jsonb_build_object('anchor_date', pg_temp.h('2026-10-01'))))));
  r := pg_temp.anchor(v_t, v_m, 'trial_date', '2026-09-01', 'Notice of Trial');
  -- A superseded anchor sharing the key, and a source whose asserted date is missing.
  perform rules.seed(v_t2, 'practice', jsonb_build_array(
    pg_temp.seed_item(v_m2, 'matter'),
    pg_temp.seed_item(v_old, 'anchor', jsonb_build_object('state', 'superseded', 'tags', '{"anchor_type": "trial_date"}'::jsonb,
      'links', jsonb_build_object('matter', v_m2), 'hashes', jsonb_build_object('anchor_date', pg_temp.h('2025-01-01')))),
    pg_temp.seed_item(v_c, 'anchor', jsonb_build_object('state', 'conflicted', 'tags', '{"anchor_type": "discovery_date"}'::jsonb,
      'links', jsonb_build_object('matter', v_m2), 'hashes', jsonb_build_object('anchor_date', pg_temp.h('2026-09-01')))),
    pg_temp.seed_item(v_s1, 'anchor_source', jsonb_build_object('state', 'confirmed', 'links', jsonb_build_object('anchor', v_c),
      'hashes', jsonb_build_object('source_document', pg_temp.h('Undated letter'), 'asserted_date', null))),
    pg_temp.seed_item(v_s2, 'anchor_source', jsonb_build_object('state', 'conflicted', 'links', jsonb_build_object('anchor', v_c),
      'hashes', jsonb_build_object('source_document', pg_temp.h('Later letter'), 'asserted_date', pg_temp.h('2026-10-15'))))));
  r2 := pg_temp.anchor(v_t2, v_m2, 'trial_date', '2026-09-01', 'Notice of Trial');
  r3 := pg_temp.anchor(v_t2, v_m2, 'discovery_date', '2026-09-01', 'Registrar', '{"resolve": true}'::jsonb);
  perform pg_temp.t_check('R4 two live anchors on one key are asked about; a superseded one never reconciles; a source with no asserted date goes pending',
    pg_temp.refused(r) and r->>'question' like '%' || v_a1 || '%' and r->>'question' like '%' || v_a2 || '%'
    and pg_temp.saved(r2) and pg_temp.as_id(r2, 0) <> v_old and pg_temp.st(v_t2, v_old) = 'superseded'
    and pg_temp.saved(r3) and pg_temp.st(v_t2, v_c) = 'active' and pg_temp.st(v_t2, v_s1) = 'pending'
    and pg_temp.st(v_t2, v_s2) = 'conflicted' and pg_temp.src(v_t2, v_c, 'Registrar') = 'confirmed',
    format('%s / %s / %s / %s', s, r, r2, r3));
end $t$;

-- =============================================================================
-- R5. Deadlines
-- =============================================================================

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_a1 uuid;
  v_b1 uuid;
  v_a2 uuid;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  v_a1 := pg_temp.as_id(pg_temp.dl(v_t, v_m, 'response_to_civil_claim', '2026-09-22',
    p_hashes => jsonb_build_object('party_label', pg_temp.h('Defendant A'))));
  v_b1 := pg_temp.as_id(pg_temp.dl(v_t, v_m, 'response_to_civil_claim', '2026-10-11',
    p_hashes => jsonb_build_object('party_label', pg_temp.h('Defendant B'))));
  v_a2 := pg_temp.as_id(pg_temp.dl(v_t, v_m, 'response_to_civil_claim', '2026-09-23',
    p_hashes => jsonb_build_object('party_label', pg_temp.h('Defendant A'))));
  perform pg_temp.t_check('R5 a new deadline supersedes the same party''s active one and leaves another party''s alone',
    v_a2 <> v_a1 and pg_temp.st(v_t, v_a1) = 'superseded' and pg_temp.st(v_t, v_b1) = 'active'
    and pg_temp.st(v_t, v_a2) = 'active');
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_choice jsonb := '{"review_flag": "practitioner_choice"}';
  v_note jsonb;
  v_plain uuid;
  v_early uuid;
  v_late uuid;
  v_late2 uuid;
  v_auth uuid;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  v_note := jsonb_build_object('review_note', pg_temp.h('Turns on whether the extension was validly agreed'));
  v_plain := pg_temp.as_id(pg_temp.dl(v_t, v_m, 'ultimate_limitation', '2040-01-01'));
  v_early := pg_temp.as_id(pg_temp.dl(v_t, v_m, 'basic_limitation', '2030-03-01', v_choice,
    v_note || jsonb_build_object('scenario_label', pg_temp.h('Extension invalid'))));
  v_late := pg_temp.as_id(pg_temp.dl(v_t, v_m, 'basic_limitation', '2030-03-13', v_choice,
    v_note || jsonb_build_object('scenario_label', pg_temp.h('Extension valid'))));
  v_late2 := pg_temp.as_id(pg_temp.dl(v_t, v_m, 'basic_limitation', '2030-03-14', v_choice,
    v_note || jsonb_build_object('scenario_label', pg_temp.h('Extension valid'))));
  v_auth := pg_temp.as_id(pg_temp.dl(v_t, v_m, 'basic_limitation', '2030-03-01'));
  perform pg_temp.t_check('R5 alternatives coexist; re-storing one scenario supersedes only it; a plain row neither supersedes nor is superseded by them',
    pg_temp.st(v_t, v_plain) = 'active' and pg_temp.st(v_t, v_early) = 'active' and pg_temp.st(v_t, v_late) = 'superseded'
    and pg_temp.st(v_t, v_late2) = 'active' and pg_temp.st(v_t, v_auth) = 'active');
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  r1 jsonb;
  r2 jsonb;
  r3 jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  r1 := pg_temp.dl(v_t, v_m, 'basic_limitation', '2030-03-01', '{"review_flag": "practitioner_choice"}'::jsonb,
    jsonb_build_object('review_note', pg_temp.h('Open question')));
  r2 := pg_temp.dl(v_t, v_m, 'basic_limitation', '2030-03-01', '{"review_flag": "practitioner_choice"}'::jsonb,
    jsonb_build_object('scenario_label', pg_temp.h('Extension valid')));
  r3 := pg_temp.dl(v_t, v_m, 'basic_limitation', '2030-03-01', '{"review_flag": "shift_pending"}'::jsonb,
    jsonb_build_object('scenario_label', pg_temp.h('Extension valid'), 'review_note', pg_temp.h('Open question')));
  perform pg_temp.t_check('R5 an alternative needs a scenario and a note, and a scenario needs an alternative; a refusal stores nothing',
    pg_temp.refused(r1) and pg_temp.refused(r2) and pg_temp.refused(r3) and pg_temp.live(v_t, 'deadline') = 0,
    format('%s / %s / %s', r1, r2, r3));
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_d uuid;
  r1 jsonb;
  r2 jsonb;
  v_item ledger.item;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  v_d := pg_temp.as_id(pg_temp.dl(v_t, v_m, 'basic_limitation', '2030-03-01', '{"review_flag": "practitioner_choice"}'::jsonb,
    jsonb_build_object('review_note', pg_temp.h('Open question'), 'scenario_label', pg_temp.h('Extension valid'),
      'party_label', pg_temp.h('Defendant A'), 'proceeding_label', pg_temp.h('Court action'))));
  r1 := pg_temp.upd(v_t, 'upsert_deadline', v_d, 'deadline', '{"state": "dismissed"}'::jsonb);
  v_item := pg_temp.item(v_t, v_d);
  r2 := pg_temp.upd(v_t, 'upsert_deadline', v_d, 'deadline', '{"hashes": {"party_label": null}}'::jsonb);
  perform pg_temp.t_check('R5 an update by id keeps the key labels it does not name; an explicit null clears one',
    pg_temp.saved(r1) and v_item.state = 'dismissed' and v_item.hashes->>'party_label' = pg_temp.h('Defendant A')
    and v_item.hashes->>'proceeding_label' = pg_temp.h('Court action')
    and v_item.hashes->>'scenario_label' = pg_temp.h('Extension valid')
    and pg_temp.saved(r2) and (pg_temp.item(v_t, v_d)).hashes->>'party_label' is null,
    format('%s / %s', r1, r2));
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_chosen uuid;
  v_other uuid;
  v_recalc uuid;
  r1 jsonb;
  v_item ledger.item;
  v_choice jsonb := '{"review_flag": "practitioner_choice"}';
begin
  v_m := pg_temp.matter(v_t, 'L100');
  v_chosen := pg_temp.as_id(pg_temp.dl(v_t, v_m, 'basic_limitation', '2030-03-13', v_choice,
    jsonb_build_object('review_note', pg_temp.h('Open question'), 'scenario_label', pg_temp.h('Extension valid'))));
  v_other := pg_temp.as_id(pg_temp.dl(v_t, v_m, 'basic_limitation', '2030-03-01', v_choice,
    jsonb_build_object('review_note', pg_temp.h('Open question'), 'scenario_label', pg_temp.h('Extension invalid'))));
  r1 := pg_temp.upd(v_t, 'upsert_deadline', v_chosen, 'deadline', jsonb_build_object('tags', '{"review_flag": null}'::jsonb,
    'hashes', jsonb_build_object('scenario_label', null, 'review_note', pg_temp.h('Practitioner chose: extension valid'))));
  perform pg_temp.upd(v_t, 'upsert_deadline', v_other, 'deadline', '{"state": "dismissed"}'::jsonb);
  v_item := pg_temp.item(v_t, v_chosen);
  v_recalc := pg_temp.as_id(pg_temp.dl(v_t, v_m, 'basic_limitation', '2030-03-16'));
  perform pg_temp.t_check('R5 a resolved alternative is the deadline''s one row: active, unflagged, and superseded by a later recalculation',
    pg_temp.saved(r1) and v_item.state = 'active' and not (v_item.tags ? 'review_flag')
    and v_item.hashes->>'scenario_label' is null and pg_temp.st(v_t, v_other) = 'dismissed'
    and (pg_temp.item(v_t, v_other)).hashes->>'scenario_label' = pg_temp.h('Extension invalid')
    and pg_temp.st(v_t, v_chosen) = 'superseded' and pg_temp.st(v_t, v_recalc) = 'active', r1::text);
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_d uuid;
  r1 jsonb;
  r2 jsonb;
  v_item ledger.item;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  v_d := pg_temp.as_id(pg_temp.dl(v_t, v_m, 'basic_limitation', '2030-03-13', '{"review_flag": "practitioner_choice"}'::jsonb,
    jsonb_build_object('review_note', pg_temp.h('Open question'), 'scenario_label', pg_temp.h('Extension valid'))));
  r1 := pg_temp.upd(v_t, 'upsert_deadline', v_d, 'deadline', jsonb_build_object('tags', '{"review_flag": "rule_stale"}'::jsonb,
    'hashes', jsonb_build_object('review_note', pg_temp.h('s. 6 amended'))));
  r2 := pg_temp.upd(v_t, 'upsert_deadline', v_d, 'deadline', '{"tags": {"review_flag": null}, "hashes": {"scenario_label": null}}'::jsonb);
  v_item := pg_temp.item(v_t, v_d);
  perform pg_temp.t_check('R5 resolving a rule_stale alternative is refused and changes nothing',
    pg_temp.saved(r1) and pg_temp.refused(r2) and v_item.tags->>'review_flag' = 'rule_stale'
    and v_item.hashes->>'scenario_label' = pg_temp.h('Extension valid'), format('%s / %s', r1, r2));
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_1 uuid;
  v_2 uuid;
  v_3 uuid;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  v_1 := pg_temp.as_id(pg_temp.dl(v_t, v_m, 'award_set_aside_application', '2026-10-01',
    p_hashes => jsonb_build_object('proceeding_label', pg_temp.h('Arbitration A'))));
  v_2 := pg_temp.as_id(pg_temp.dl(v_t, v_m, 'award_set_aside_application', '2026-11-01',
    p_hashes => jsonb_build_object('proceeding_label', pg_temp.h('Arbitration B'))));
  v_3 := pg_temp.as_id(pg_temp.dl(v_t, v_m, 'award_set_aside_application', '2026-10-02',
    p_hashes => jsonb_build_object('proceeding_label', pg_temp.h('Arbitration A'))));
  perform pg_temp.t_check('R5 a new deadline supersedes within its proceeding and leaves a concurrent proceeding alone',
    pg_temp.st(v_t, v_1) = 'superseded' and pg_temp.st(v_t, v_2) = 'active' and pg_temp.st(v_t, v_3) = 'active');
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_a uuid;
  v_with uuid;
  v_without uuid;
  v_new uuid;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  v_a := pg_temp.as_id(pg_temp.anchor(v_t, v_m, 'application_hearing_date', '2026-07-17', 'Notice of Application'));
  v_with := pg_temp.as_id(pg_temp.dl(v_t, v_m, 'application_response', '2026-07-10', p_links => jsonb_build_object('anchor', v_a)));
  v_without := pg_temp.as_id(pg_temp.dl(v_t, v_m, 'application_response', '2026-07-10'));
  v_new := pg_temp.as_id(pg_temp.dl(v_t, v_m, 'application_response', '2026-07-11'));
  perform pg_temp.t_check('R5 the anchor is part of the key: a deadline with no anchor supersedes only one with no anchor',
    pg_temp.st(v_t, v_with) = 'active' and pg_temp.st(v_t, v_without) = 'superseded' and pg_temp.st(v_t, v_new) = 'active');
end $t$;

-- =============================================================================
-- R6. Billable inheritance; a non-billable matter takes no invoice
-- =============================================================================

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_bill uuid;
  v_non uuid;
  v_e1 uuid;
  v_e2 uuid;
  v_e3 uuid;
  v_e4 uuid;
  s jsonb;
begin
  v_bill := pg_temp.matter(v_t, 'L3000');
  v_non := pg_temp.matter(v_t, 'LIF300', '{"billable": false}'::jsonb);
  v_e1 := pg_temp.as_id(pg_temp.entry(v_t, v_bill));
  v_e2 := pg_temp.as_id(pg_temp.entry(v_t, v_bill, '{"billable": false}'::jsonb));
  v_e3 := pg_temp.as_id(pg_temp.entry(v_t, v_non));
  v_e4 := pg_temp.as_id(pg_temp.entry(v_t, v_non, '{"billable": true}'::jsonb));
  s := rules.sync(v_t, 'practice', 0);
  perform pg_temp.t_check('R6 a time entry takes its matter''s billable flag unless it carries its own, and sync reports it',
    (pg_temp.item(v_t, v_e1)).tags->'billable' = 'true'::jsonb
    and (pg_temp.item(v_t, v_e2)).tags->'billable' = 'false'::jsonb
    and (pg_temp.item(v_t, v_e3)).tags->'billable' = 'false'::jsonb
    and (pg_temp.item(v_t, v_e4)).tags->'billable' = 'true'::jsonb
    and exists (select 1 from jsonb_array_elements(s->'items') e
                where e->>'id' = v_e3::text and e->'tags'->'billable' = 'false'::jsonb), s::text);
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_non uuid;
  r jsonb;
begin
  v_non := pg_temp.matter(v_t, 'LIF003', '{"billable": false}'::jsonb);
  r := pg_temp.w(v_t, 'import_invoices', jsonb_build_array(pg_temp.invoice_op(v_non, 'INV-1', '500')));
  perform pg_temp.t_check('R6 an invoice on a non-billable matter is refused, asking about the matter',
    pg_temp.refused(r) and r->>'question' like '%{{item:' || v_non || '}}%' and pg_temp.live(v_t, 'invoice') = 0, r::text);
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_plain uuid;
  r1 jsonb;
  r2 jsonb;
  v_after_omit jsonb;
begin
  v_m := pg_temp.matter(v_t, 'LIF001', '{"billable": false}'::jsonb);
  v_plain := pg_temp.matter(v_t, 'L2000');
  r1 := pg_temp.w(v_t, 'upsert_client_matter', jsonb_build_array(pg_temp.op('upsert', gen_random_uuid(), 'matter',
    jsonb_build_object('hashes', jsonb_build_object('matt_num', pg_temp.h('LIF001'), 'description', pg_temp.h('LIF file'))))));
  v_after_omit := (pg_temp.item(v_t, v_m)).tags;
  r2 := pg_temp.w(v_t, 'upsert_client_matter', jsonb_build_array(pg_temp.op('upsert', gen_random_uuid(), 'matter',
    jsonb_build_object('tags', '{"billable": true}'::jsonb, 'hashes', jsonb_build_object('matt_num', pg_temp.h('LIF001'))))));
  perform pg_temp.t_check('R6 a matter is billable unless told; a re-upsert omitting billable keeps it; true flips it back',
    (pg_temp.item(v_t, v_plain)).tags->'billable' = 'true'::jsonb
    and pg_temp.as_id(r1) = v_m and v_after_omit->'billable' = 'false'::jsonb
    and pg_temp.as_id(r2) = v_m and (pg_temp.item(v_t, v_m)).tags->'billable' = 'true'::jsonb
    and pg_temp.live(v_t, 'matter') = 2, format('%s / %s', r1, r2));
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_a uuid;
  v_b uuid;
  r jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  v_a := pg_temp.as_id(pg_temp.entry(v_t, v_m));
  v_b := pg_temp.as_id(pg_temp.entry(v_t, v_m));
  r := pg_temp.upd(v_t, 'set_time_entries_billable', v_a, 'time_entry', '{"tags": {"billable": false}}'::jsonb);
  perform pg_temp.t_check('R6 setting billable on named entries changes only them',
    pg_temp.saved(r) and (pg_temp.item(v_t, v_a)).tags->'billable' = 'false'::jsonb
    and (pg_temp.item(v_t, v_b)).tags->'billable' = 'true'::jsonb, r::text);
end $t$;

-- =============================================================================
-- R7. Invoice merge by number; invoices with no number replaced together
-- =============================================================================

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_m2 uuid;
  v_inv uuid;
  r1 jsonb;
  r2 jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  v_m2 := pg_temp.matter(v_t, 'L200');
  v_inv := pg_temp.as_id(pg_temp.w(v_t, 'import_invoices', jsonb_build_array(pg_temp.invoice_op(v_m, 'INV-1', '100'))));
  r1 := pg_temp.w(v_t, 'import_invoices', jsonb_build_array(pg_temp.invoice_op(v_m, 'INV-1', '175')));
  r2 := pg_temp.w(v_t, 'import_invoices', jsonb_build_array(pg_temp.invoice_op(v_m2, 'INV-1', '10')));
  perform pg_temp.t_check('R7 a re-imported invoice number merges onto the same item; another matter''s same number is its own',
    pg_temp.as_id(r1) = v_inv and r1->'ops'->0->>'saved' = 'true'
    and (pg_temp.item(v_t, v_inv)).hashes->>'amount' = pg_temp.h('175')
    and pg_temp.as_id(r2) <> v_inv and pg_temp.live(v_t, 'invoice') = 2, format('%s / %s', r1, r2));
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_m2 uuid;
  r1 jsonb;
  r2 jsonb;
  v_other uuid;
  v_numbered uuid;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  v_m2 := pg_temp.matter(v_t, 'L200');
  v_other := pg_temp.as_id(pg_temp.w(v_t, 'import_invoices', jsonb_build_array(pg_temp.invoice_op(v_m2, null, '5'))));
  r1 := pg_temp.w(v_t, 'import_invoices', jsonb_build_array(
    pg_temp.invoice_op(v_m, null, '50'), pg_temp.invoice_op(v_m, null, '51'), pg_temp.invoice_op(v_m, 'INV-1', '100')));
  v_numbered := pg_temp.as_id(r1, 2);
  r2 := pg_temp.w(v_t, 'import_invoices', jsonb_build_array(pg_temp.invoice_op(v_m, null, '60')));
  perform pg_temp.t_check('R7 an invoice with no number replaces the matter''s earlier ones with no number, and none in its own write',
    pg_temp.saved(r1) and pg_temp.saved(r2)
    and (select count(*) from ledger.item i where i.tenant = v_t and i.kind = 'invoice' and i.deleted) = 2
    and pg_temp.st(v_t, pg_temp.as_id(r1, 0)) is null and pg_temp.st(v_t, pg_temp.as_id(r1, 1)) is null
    and pg_temp.live(v_t, 'invoice') = 3
    and not (pg_temp.item(v_t, v_other)).deleted and not (pg_temp.item(v_t, v_numbered)).deleted
    and not (pg_temp.item(v_t, pg_temp.as_id(r2))).deleted, format('%s / %s', r1, r2));
end $t$;

-- =============================================================================
-- R8. Deleting an anchor
-- =============================================================================

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  v_a uuid;
  v_b uuid;
  v_d uuid;
  v_keep uuid;
  v_since bigint;
  r1 jsonb;
  r2 jsonb;
  s jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  v_a := pg_temp.as_id(pg_temp.anchor(v_t, v_m, 'trial_date', '2026-09-01', 'Notice of Trial'));
  v_b := pg_temp.as_id(pg_temp.anchor(v_t, v_m, 'application_hearing_date', '2026-07-17', 'Notice of Application'));
  v_d := pg_temp.as_id(pg_temp.dl(v_t, v_m, 'trial_management_conference', '2026-08-04', p_links => jsonb_build_object('anchor', v_a)));
  v_keep := pg_temp.as_id(pg_temp.dl(v_t, v_m, 'application_response', '2026-07-10', p_links => jsonb_build_object('anchor', v_b)));
  v_since := pg_temp.tenant_seq(v_t);
  r1 := pg_temp.w(v_t, 'delete_anchor', jsonb_build_array(pg_temp.op('delete', v_a, 'anchor')));
  s := rules.sync(v_t, 'practice', v_since);
  r2 := pg_temp.w(v_t, 'delete_anchor', jsonb_build_array(pg_temp.op('delete', v_a, 'anchor')));
  perform pg_temp.t_check('R8 deleting an anchor deletes its sources and deadlines, which sync reports; a second delete is refused',
    pg_temp.saved(r1) and pg_temp.st(v_t, v_a) is null and pg_temp.nsrc(v_t, v_a) = 0 and pg_temp.st(v_t, v_d) is null
    and pg_temp.st(v_t, v_keep) = 'active' and pg_temp.st(v_t, v_b) = 'active' and pg_temp.nsrc(v_t, v_b) = 1
    and jsonb_array_length(s->'items') = 3
    and (select bool_and(e->>'deleted' = 'true') from jsonb_array_elements(s->'items') e)
    and pg_temp.refused(r2), format('%s / %s / %s', r1, s, r2));
end $t$;

-- =============================================================================
-- R9. The rule overlay record
-- =============================================================================

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_id uuid := '5f0c2a8e-3b1d-4c6e-9a7f-2d4b6e8a0c13';
  r1 jsonb;
  r2 jsonb;
  v_item ledger.item;
begin
  r1 := pg_temp.overlay(v_t, pg_temp.fixture(v_id));
  v_item := pg_temp.item(v_t, v_id);
  r2 := pg_temp.overlay(v_t, pg_temp.fixture(v_id) || '{"status": "conflict", "effective_to": "2026-12-31"}'::jsonb);
  perform pg_temp.t_check('R9 a valid record is saved as the cross record, and a write with its record_id replaces it',
    pg_temp.saved(r1) and pg_temp.as_id(r1) = v_id and v_item.cross_payload = pg_temp.fixture(v_id)
    and v_item.state = 'verified' and v_item.tags->>'amending_reg' = 'B.C. Reg. 105/2026'
    and pg_temp.saved(r2) and pg_temp.as_id(r2) = v_id and pg_temp.live(v_t, 'rule_overlay') = 1
    and pg_temp.st(v_t, v_id) = 'conflict'
    and (pg_temp.item(v_t, v_id)).cross_payload->>'effective_to' = '2026-12-31', format('%s / %s', r1, r2));
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  r1 jsonb;
  r2 jsonb;
  r3 jsonb;
  v_pool uuid := gen_random_uuid();
begin
  r1 := pg_temp.overlay(v_t, pg_temp.repeal(gen_random_uuid()));
  r2 := pg_temp.overlay(v_t, pg_temp.fixture(gen_random_uuid())
    || jsonb_build_object('status', 'unverified', 'verified_by', null, 'verified_at', null, 'pool_id', v_pool));
  r3 := pg_temp.overlay(v_t, pg_temp.fixture(gen_random_uuid()) || '{"pool_id": "row-7"}'::jsonb);
  perform pg_temp.t_check('R9 a repeal record and a pulled record with its pool_id are saved; a bad pool_id is refused',
    pg_temp.saved(r1) and pg_temp.saved(r2)
    and (pg_temp.item(v_t, pg_temp.as_id(r2))).cross_payload->>'pool_id' = v_pool::text
    and pg_temp.refused(r3) and r3->>'question' like '%pool_id%', format('%s / %s / %s', r1, r2, r3));
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_bad text := '';
  c record;
  r jsonb;
begin
  for c in
    select * from (values
      ('unknown field', pg_temp.fixture(gen_random_uuid()) || '{"matter": "test"}'::jsonb, 'record.matter'),
      ('unknown nested field', jsonb_set(pg_temp.fixture(gen_random_uuid()), '{offset,matter}', '"test"'), 'record.offset.matter'),
      ('unknown source field', jsonb_set(pg_temp.fixture(gen_random_uuid()), '{source,note}', '"x"'), 'record.source.note'),
      ('missing field', pg_temp.fixture(gen_random_uuid()) - 'verbatim', 'record.verbatim'),
      ('bad counting', pg_temp.fixture(gen_random_uuid()) || '{"counting": "weekly"}'::jsonb, 'record.counting'),
      ('bad unit', jsonb_set(pg_temp.fixture(gen_random_uuid()), '{offset,unit}', '"weeks"'), 'record.offset.unit'),
      ('verified with no verifier', pg_temp.fixture(gen_random_uuid()) || '{"verified_by": null}'::jsonb, 'verified'),
      ('verified with no date', pg_temp.fixture(gen_random_uuid()) || '{"verified_at": null}'::jsonb, 'verified'),
      ('reversed period', pg_temp.fixture(gen_random_uuid()) || '{"effective_to": "2026-09-30"}'::jsonb, 'record.effective_to'),
      ('repeal with counting', pg_temp.repeal(gen_random_uuid()) || '{"counting": "calendar"}'::jsonb, 'record.counting'),
      ('offset with no base', pg_temp.fixture(gen_random_uuid()) || '{"base": null}'::jsonb, 'record.base'),
      ('not a date', pg_temp.fixture(gen_random_uuid()) || '{"effective_from": "2026-02-30"}'::jsonb, 'record.effective_from'),
      ('not http', jsonb_set(pg_temp.fixture(gen_random_uuid()), '{source,url}', '"ftp://example.org/x"'), 'record.source.url'),
      ('superseding itself', jsonb_set(pg_temp.fixture('00000000-0000-4000-8000-0000000000e1'), '{supersedes}',
         '["00000000-0000-4000-8000-0000000000e1"]'), 'record.supersedes[0]'),
      ('another jurisdiction', pg_temp.fixture(gen_random_uuid()) || '{"jurisdiction": "CA-ON"}'::jsonb, 'jurisdiction')
    ) as v(name, rec, expect)
  loop
    r := pg_temp.overlay(v_t, c.rec);
    if not pg_temp.refused(r) or position(c.expect in r->>'question') = 0 then
      v_bad := v_bad || format('%s: %s; ', c.name, r);
    end if;
  end loop;
  perform pg_temp.t_check('R9 a record with an unknown or missing field, a bad value or a broken field rule is refused, naming the field',
    v_bad = '' and pg_temp.live(v_t, 'rule_overlay') = 0, v_bad);
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_id uuid := gen_random_uuid();
  r1 jsonb;
  r2 jsonb;
  r3 jsonb;
  r4 jsonb;
begin
  r1 := pg_temp.overlay(v_t, pg_temp.fixture(v_id), '{"deadline_type": "other_type", "amending_reg": "B.C. Reg. 105/2026"}'::jsonb);
  r2 := pg_temp.overlay(v_t, pg_temp.fixture(v_id), p_state => 'unverified');
  r3 := pg_temp.w(v_t, 'upsert_rule_overlay', jsonb_build_array(pg_temp.op('upsert', v_id, 'rule_overlay', jsonb_build_object(
    'state', 'verified', 'tags', '{"deadline_type": "notice_of_hearing_service", "amending_reg": "B.C. Reg. 105/2026"}'::jsonb,
    'cross', pg_temp.fixture(gen_random_uuid())))));
  r4 := pg_temp.w(v_t, 'upsert_rule_overlay', jsonb_build_array(pg_temp.op('upsert', v_id, 'rule_overlay', jsonb_build_object(
    'state', 'verified', 'tags', '{"deadline_type": "notice_of_hearing_service", "amending_reg": "B.C. Reg. 105/2026"}'::jsonb))));
  perform pg_temp.t_check('R9 the record''s tags, state and record_id agree with the item, and an overlay carries its record',
    pg_temp.refused(r1) and pg_temp.refused(r2) and pg_temp.refused(r3) and pg_temp.refused(r4)
    and pg_temp.live(v_t, 'rule_overlay') = 0, format('%s / %s / %s / %s', r1, r2, r3, r4));
end $t$;

-- =============================================================================
-- R10. Court calendar years
-- =============================================================================

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_year uuid;
  r1 jsonb;
  r2 jsonb;
  r3 jsonb;
  v_old uuid[];
  s jsonb;
begin
  r1 := pg_temp.year(v_t, 2026, 'confirmed', '[["2026-01-01", "full_closure"], ["2026-03-16", "limited"]]'::jsonb);
  v_year := pg_temp.as_id(r1);
  v_old := array[pg_temp.as_id(r1, 1), pg_temp.as_id(r1, 2)];
  r2 := pg_temp.year(v_t, 2026, 'confirmed', '[["2026-01-01", "full_closure"]]'::jsonb);
  r3 := pg_temp.year(v_t, 2027, 'unavailable');
  s := rules.sync(v_t, 'practice', 0);
  perform pg_temp.t_check('R10 re-ingesting a year replaces its days whole under the same year item; another year is untouched',
    pg_temp.saved(r1) and pg_temp.saved(r2) and pg_temp.saved(r3)
    and pg_temp.as_id(r2) = v_year and pg_temp.live(v_t, 'calendar_year') = 2 and pg_temp.live(v_t, 'calendar_day') = 1
    and pg_temp.st(v_t, v_old[1]) is null and (pg_temp.item(v_t, v_old[2])).deleted
    and not (pg_temp.item(v_t, pg_temp.as_id(r2, 1))).deleted
    and not exists (select 1 from jsonb_array_elements(s->'items') e where e->'links' ? 'calendar_year'),
    format('%s / %s / %s', r1, r2, r3));
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_year uuid;
  v_day uuid;
  r1 jsonb;
  r2 jsonb;
  r3 jsonb;
  r4 jsonb;
  v_hashes jsonb;
begin
  r1 := pg_temp.year(v_t, 2026, 'confirmed');
  r2 := pg_temp.year(v_t, 2026, 'confirmed', '[["2026-01-01", "full_closure"]]'::jsonb);
  v_year := pg_temp.as_id(r2);
  v_day := pg_temp.as_id(r2, 1);
  v_hashes := (pg_temp.item(v_t, v_year)).hashes;
  r3 := pg_temp.year(v_t, 2026, 'confirmed', '[["2026-12-25", "full_closure"], ["2026-03-16", "closed"]]'::jsonb);
  r4 := pg_temp.w(v_t, 'scratch', jsonb_build_array(pg_temp.op('create', gen_random_uuid(), 'calendar_day', jsonb_build_object(
    'tags', '{"status_category": "limited"}'::jsonb, 'links', jsonb_build_object('calendar_year', v_year)))));
  perform pg_temp.t_check('R10 a confirmed year with no days, a bad day, or a day written outside its year''s ingest is refused, leaving the prior days',
    pg_temp.refused(r1) and pg_temp.saved(r2) and pg_temp.refused(r3) and pg_temp.refused(r4)
    and pg_temp.live(v_t, 'calendar_day') = 1 and not (pg_temp.item(v_t, v_day)).deleted
    and (pg_temp.item(v_t, v_year)).hashes = v_hashes, format('%s / %s / %s / %s', r1, r2, r3, r4));
end $t$;

-- =============================================================================
-- R11. One signal per (matter, signal_key)
-- =============================================================================

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_m uuid;
  r1 jsonb;
  r2 jsonb;
  r3 jsonb;
begin
  v_m := pg_temp.matter(v_t, 'L100');
  r1 := pg_temp.signal(v_t, v_m, 'conflict_check_completed', 'confirmed');
  r2 := pg_temp.signal(v_t, v_m, 'conflict_check_completed', 'unconfirmed');
  r3 := pg_temp.w(v_t, 'upsert_signal', jsonb_build_array(pg_temp.op('create', gen_random_uuid(), 'signal',
    jsonb_build_object('state', 'absent', 'tags', '{"signal_key": "conflict_check_completed"}'::jsonb,
      'links', jsonb_build_object('matter', v_m)))));
  perform pg_temp.t_check('R11 a re-upserted signal keeps its id and takes the new state; a second one on the same key is refused',
    pg_temp.saved(r1) and pg_temp.saved(r2) and pg_temp.as_id(r2) = pg_temp.as_id(r1)
    and pg_temp.st(v_t, pg_temp.as_id(r1)) = 'unconfirmed' and pg_temp.refused(r3)
    and pg_temp.live(v_t, 'signal') = 1, format('%s / %s / %s', r1, r2, r3));
end $t$;

-- =============================================================================
-- Seed
-- =============================================================================

do $t$
declare
  v_t uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid();
  v_m uuid := gen_random_uuid();
  v_n uuid := gen_random_uuid();
  v_t1 uuid := gen_random_uuid();
  v_t2 uuid := gen_random_uuid();
  v_t3 uuid := gen_random_uuid();
  v_inv uuid := gen_random_uuid();
  v_a1 uuid := gen_random_uuid();
  v_a2 uuid := gen_random_uuid();
  v_d1 uuid := gen_random_uuid();
  v_d2 uuid := gen_random_uuid();
  v_d3 uuid := gen_random_uuid();
  v_o uuid := gen_random_uuid();
  v_y uuid := gen_random_uuid();
  v_bad uuid := gen_random_uuid();
  v_items jsonb;
  s jsonb;
  s2 jsonb;
  v_asked uuid[];
  v_sync jsonb;
begin
  v_items := jsonb_build_array(
    pg_temp.seed_item(v_c, 'client', jsonb_build_object('hashes', jsonb_build_object('client_num', pg_temp.h('C-1')))),
    pg_temp.seed_item(v_m, 'matter', jsonb_build_object('state', 'active', 'tags', '{"billable": true}'::jsonb,
      'links', jsonb_build_object('client', v_c))),
    pg_temp.seed_item(v_n, 'matter', jsonb_build_object('tags', '{"billable": false}'::jsonb)),
    pg_temp.seed_item(v_t1, 'task', jsonb_build_object('state', 'open', 'tags', '{"task_type": "client"}'::jsonb,
      'links', jsonb_build_object('matter', v_m, 'filing', 'filing:3'))),
    pg_temp.seed_item(v_t2, 'task', jsonb_build_object('state', 'open', 'tags', '{"task_type": "client"}'::jsonb,
      'links', jsonb_build_object('matter', v_m, 'filing', 'filing:3'))),
    pg_temp.seed_item(v_t3, 'task', jsonb_build_object('state', 'open', 'tags', '{"task_type": "admin"}'::jsonb,
      'links', '{"filing": "filing:9"}'::jsonb)),
    pg_temp.seed_item(v_inv, 'invoice', jsonb_build_object('links', jsonb_build_object('matter', v_n),
      'hashes', jsonb_build_object('invoice_number', pg_temp.h('INV-9')))),
    pg_temp.seed_item(v_a1, 'anchor', jsonb_build_object('state', 'active', 'tags', '{"anchor_type": "trial_date"}'::jsonb,
      'links', jsonb_build_object('matter', v_m), 'hashes', jsonb_build_object('anchor_date', pg_temp.h('2026-09-01')))),
    pg_temp.seed_item(v_a2, 'anchor', jsonb_build_object('state', 'conflicted', 'tags', '{"anchor_type": "trial_date"}'::jsonb,
      'links', jsonb_build_object('matter', v_m), 'hashes', jsonb_build_object('anchor_date', pg_temp.h('2026-09-02')))),
    pg_temp.seed_item(v_d1, 'deadline', jsonb_build_object('state', 'active',
      'tags', '{"deadline_type": "witness_list", "source_type": "bc_rules"}'::jsonb, 'links', jsonb_build_object('matter', v_m))),
    pg_temp.seed_item(v_d2, 'deadline', jsonb_build_object('state', 'active',
      'tags', '{"deadline_type": "witness_list", "source_type": "bc_rules"}'::jsonb, 'links', jsonb_build_object('matter', v_m))),
    pg_temp.seed_item(v_d3, 'deadline', jsonb_build_object('state', 'superseded',
      'tags', '{"deadline_type": "witness_list", "source_type": "bc_rules"}'::jsonb, 'links', jsonb_build_object('matter', v_m))),
    pg_temp.seed_item(v_o, 'rule_overlay', jsonb_build_object('state', 'verified',
      'tags', '{"deadline_type": "notice_of_hearing_service", "amending_reg": "B.C. Reg. 105/2026"}'::jsonb,
      'cross', pg_temp.fixture(v_o) || '{"verified_at": null}'::jsonb)),
    pg_temp.seed_item(v_y, 'calendar_year', jsonb_build_object('state', 'confirmed',
      'hashes', jsonb_build_object('year', pg_temp.h('2025')))),
    pg_temp.seed_item(v_bad, 'task', jsonb_build_object('state', 'done', 'tags', '{"task_type": "client"}'::jsonb)));
  s := rules.seed(v_t, 'practice', v_items);
  select array_agg((q->>'id')::uuid order by (q->>'id')) into v_asked from jsonb_array_elements(s->'questions') q;
  s2 := rules.seed(v_t, 'practice', v_items);
  v_sync := rules.sync(v_t, 'practice', 0);
  insert into t_question (question) select q->>'question' from jsonb_array_elements(s->'questions' || s2->'questions') q;
  perform pg_temp.t_check('Seed records every item as it is and asks one question about each item today''s checks would refuse',
    pg_temp.keys(s) = array['questions', 'seeded'] and (s->>'seeded')::integer = 15
    and v_asked = (select array_agg(x order by x::text) from unnest(array[v_t2, v_t3, v_inv, v_a2, v_d2, v_o, v_y, v_bad]) x)
    and (select bool_and(q->>'question' like '%?%') from jsonb_array_elements(s->'questions') q)
    and pg_temp.st(v_t, v_t2) = 'open' and pg_temp.st(v_t, v_bad) = 'done' and pg_temp.live(v_t, 'task') = 4,
    s::text);
  perform pg_temp.t_check('Seed refuses a tenant that already holds items, and sync returns every seeded item',
    (s2->>'seeded')::integer = 0 and jsonb_array_length(s2->'questions') = 1
    and (select count(*) from ledger.item i where i.tenant = v_t) = 15
    and jsonb_array_length(v_sync->'items') = 15 and (v_sync->>'seq')::bigint = 1, format('%s / %s', s2, v_sync));
end $t$;

do $t$
declare
  v_t uuid := gen_random_uuid();
  s jsonb;
begin
  s := rules.seed(v_t, 'practice', jsonb_build_array(
    pg_temp.seed_item(gen_random_uuid(), 'client'),
    pg_temp.seed_item(gen_random_uuid(), 'practice_clients')));
  perform pg_temp.t_check('Seed of a malformed item seeds nothing and says what is malformed',
    (s->>'seeded')::integer = 0 and jsonb_array_length(s->'questions') = 1
    and not exists (select 1 from ledger.item i where i.tenant = v_t), s::text);
end $t$;

-- =============================================================================
-- Commandment 6: every refusal asks, none states a rule
-- =============================================================================

do $t$
declare
  v_bad text;
  v_count integer;
begin
  select count(*) into v_count from t_question;
  select string_agg(q.question, ' | ') into v_bad from t_question q
  where q.question not like '%?%'
     or q.question ~* '\m(must|only|allowed|cannot|can not|not permitted|at most|at least|required|requires)\M';
  perform pg_temp.t_check(format('C6 every one of the %s refusals asked is a question and states no rule', v_count),
    v_bad is null and v_count >= 60, v_bad);
end $t$;
