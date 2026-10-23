-- =============================================================================
-- PROVENANCE (2026-07-18)
-- =============================================================================
-- Recovered from `3bdd492^:planning/3. Staging/legal-commons-functions.sql`,
-- deleted 2026-07-14 in a staging tidy-up (not superseded). See schema.sql's
-- provenance block for the full account.
--
-- VERIFIED: the six functions below are exactly the six the live runtime calls
-- via `rpc(...)` in `../src/legal-commons/`.
-- NOT VERIFIED against the deployed pool — see schema.sql.
--
-- SCOPE: this file is the RPC surface only, not the whole tool surface. `browse`
-- and the `amend_*` / `link_*` / `unlink_*` / `merge_*` tools
-- operate directly on the tables through PostgREST (the client's
-- insert/update/delete methods) and define no function here. That is why the
-- read numbering below skips #4.
-- =============================================================================

-- =============================================================================
-- CURRENCY CHANGE (2026-09-08) — DEPLOYED 2026-09-13 (#499)
-- =============================================================================
-- `record_treatment` (new) and the `push_principle` currency fix (it then carried
-- `authority.last_verified_at`, retired by #118 below, and the `principle_authority` / `criterion`
-- `treatment` values the push payload already supplies) were applied to the
-- deployed pool on 2026-09-13 through the Supabase SQL editor: both
-- `create or replace function` statements, the explicit `service_role` grants,
-- and `notify pgrst, 'reload schema'`, in one transaction.
--
-- Pre-deploy diff: the live `push_principle` was the single overload, and its
-- body matched this file's pre-change text byte for byte (md5 of `prosrc`
-- 68829211a8a1a41d77949176a7521366), so no drift was overwritten.
-- Post-deploy: live `prosrc` md5 is 1bfc90428f40685a9f1dccbe223a1d6e for
-- `push_principle` and 4a10dba657c0f051d8b12a5476fd8ada for `record_treatment`,
-- both matching this file; `service_role` holds execute on both; PostgREST lists
-- `/rpc/record_treatment`.
-- =============================================================================

-- =============================================================================
-- NOTE-UP DATE RETIRED (2026-10-23, #118) — DEPLOYED 2026-10-23
-- =============================================================================
-- `push_principle` and `record_treatment` below no longer write
-- `authority.last_verified_at`, and the column is dropped. The pool keeps no
-- note-up date (lawyer-only-access plan §7 rules 3 and 8). Brahm applied
-- migrations/0002_retire_note_up_date.sql, which carries both functions as
-- written here, through the SQL editor on 2026-10-23. Its pre-checks passed (the
-- live bodies matched the 2026-09-13 md5s above, and no other function used the
-- column), and afterwards `authority` had no `last_verified_at` column. The drop
-- and both replacements ran in one transaction, so the live `prosrc` md5s are
-- abdbe94d1e0b754068c90e1ff2cb0dfd (`push_principle`) and
-- e15c870936666d190fbd3bed3bc3aee4 (`record_treatment`), computed from this file.
-- =============================================================================

-- =============================================================================
-- Three-layer re-architecture — A2: legal_commons runtime functions
-- =============================================================================
-- The five read RPCs + the one push write RPC the `legal_commons__*` MCP
-- namespace binds to (plan §A2, spec §3 D7 / §6 / §7 / §9 as amended 2026-07-13).
-- Deploy AFTER schema.sql into the same Supabase project, then
-- expose the schema + grant the static credential (bottom of this file).
--
-- Retrieval is ZERO-VENDOR (amendment 2026-07-13): no embeddings, no external
-- model. `find_candidates` unions full-text search + trigram + citation join +
-- doctrine-tag bucket over Claude's retrieval packet. Claude still makes the
-- duplicate/variant/distinct call; the runtime only shortlists.
--
-- Deploy path (same as B1): Supabase Management API
--   POST /v1/projects/{ref}/database/query  with a personal access token.
--
-- Encapsulation: redirect resolution and the push transaction live HERE, in the
-- gatekeeper's SQL — callers (the /legal-commons skill) never see it (spec §3 D2).
-- =============================================================================

set search_path = legal_commons, extensions, public;

-- -----------------------------------------------------------------------------
-- resolve_principle — follow ≤1 redirect hop, return the principle + its full
-- variant cluster + each member's criteria and authorities, in one call.
-- (spec §3 D7 read #1). The one redirect hop is invisible to callers.
-- -----------------------------------------------------------------------------
create or replace function legal_commons.resolve_principle(p_id uuid)
returns jsonb
language sql
stable
as $$
  with target as (
    select coalesce(
      (select r.canonical_id from legal_commons.principle_redirects r where r.old_id = p_id),
      p_id
    ) as id
  ),
  root as (
    select coalesce(p.variant_of, p.principle_id) as root_id
    from legal_commons.principle p, target t
    where p.principle_id = t.id
  ),
  cluster as (
    select p.*
    from legal_commons.principle p, root r
    where p.principle_id = r.root_id or p.variant_of = r.root_id
  )
  select jsonb_build_object(
    'requested_id', p_id,
    'resolved_id', (select id from target),
    'cluster', coalesce((
      select jsonb_agg(jsonb_build_object(
        'principle_id', c.principle_id,
        'text', c.text,
        'jurisdiction', c.jurisdiction,
        'doctrine_tag', c.doctrine_tag,
        'variant_of', c.variant_of,
        'variant_note', c.variant_note,
        'criteria', coalesce((
          select jsonb_agg(jsonb_build_object(
            'criterion_id', cr.criterion_id,
            'description', cr.description,
            'requirement_type', cr.requirement_type,
            'criterion_order', cr.criterion_order,
            'burden_of_proof', cr.burden_of_proof
          ) order by cr.criterion_order)
          from legal_commons.criterion cr where cr.principle_id = c.principle_id
        ), '[]'::jsonb),
        'authorities', coalesce((
          select jsonb_agg(jsonb_build_object(
            'authority_id', a.authority_id,
            'citation', a.citation,
            'url', a.url,
            'title', a.title,
            'proposition', pa.proposition,
            'finding', pa.finding,
            'relationship', pa.relationship,
            'obiter', pa.obiter
          ))
          from legal_commons.principle_authority pa
          join legal_commons.authority a on a.authority_id = pa.authority_id
          where pa.principle_id = c.principle_id
        ), '[]'::jsonb)
      ))
      from cluster c
    ), '[]'::jsonb)
  );
$$;

-- -----------------------------------------------------------------------------
-- find_candidates — the push-time dedup retrieval step (read #2), zero-vendor.
-- Unions four cheap in-Postgres filters over Claude's retrieval packet and
-- returns the shortlist for Claude to adjudicate:
--   FTS       — websearch_to_tsquery over each rephrasing vs search_vector
--   trigram   — pg_trgm similarity of principle.text vs each rephrasing
--   citation  — principles citing any of the packet's authorities
--   tag       — principles sharing the doctrine_tag bucket
-- `matched_by` tells the caller which arm(s) hit each candidate.
-- -----------------------------------------------------------------------------
create or replace function legal_commons.find_candidates(
  p_rephrasings text[] default '{}',
  p_doctrine_tag text default null,
  p_citations text[] default '{}',
  p_k integer default 20
)
returns jsonb
language sql
stable
as $$
  with fts as (
    select p.principle_id, max(ts_rank(p.search_vector, q.query)) as score, 'fts'::text as src
    from legal_commons.principle p
    cross join lateral (
      select websearch_to_tsquery('english', r) as query
      from unnest(coalesce(p_rephrasings, '{}')) as r
      where length(trim(r)) > 0
    ) q
    where p.search_vector @@ q.query
    group by p.principle_id
  ),
  trg as (
    select p.principle_id, max(similarity(p.text, r)) as score, 'trigram'::text as src
    from legal_commons.principle p
    cross join unnest(coalesce(p_rephrasings, '{}')) as r
    where length(trim(r)) > 0 and p.text % r
    group by p.principle_id
  ),
  cit as (
    select distinct p.principle_id, 1.0::real as score, 'citation'::text as src
    from legal_commons.principle p
    join legal_commons.principle_authority pa on pa.principle_id = p.principle_id
    join legal_commons.authority a on a.authority_id = pa.authority_id
    where a.citation = any(coalesce(p_citations, '{}'))
  ),
  tag as (
    select p.principle_id, 1.0::real as score, 'doctrine_tag'::text as src
    from legal_commons.principle p
    where p_doctrine_tag is not null and p.doctrine_tag = p_doctrine_tag
  ),
  unioned as (
    select principle_id, score, src from fts
    union all select principle_id, score, src from trg
    union all select principle_id, score, src from cit
    union all select principle_id, score, src from tag
  ),
  ranked as (
    select u.principle_id,
           array_agg(distinct u.src) as matched_by,
           max(u.score) as best_score
    from unioned u
    group by u.principle_id
    order by max(u.score) desc
    limit greatest(coalesce(p_k, 20), 1)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'principle_id', r.principle_id,
    'text', p.text,
    'jurisdiction', p.jurisdiction,
    'doctrine_tag', p.doctrine_tag,
    'variant_of', p.variant_of,
    'matched_by', r.matched_by,
    'score', r.best_score
  ) order by r.best_score desc), '[]'::jsonb)
  from ranked r
  join legal_commons.principle p on p.principle_id = r.principle_id;
$$;

-- -----------------------------------------------------------------------------
-- lookup_by_citation — pooled authorities by exact public citation, with the
-- principles they stand for. (read #3)
-- -----------------------------------------------------------------------------
create or replace function legal_commons.lookup_by_citation(p_citation text)
returns jsonb
language sql
stable
as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'authority_id', a.authority_id,
      'citation', a.citation,
      'url', a.url,
      'title', a.title,
      'authority_type', a.authority_type,
      'jurisdiction', a.jurisdiction,
      'principles', coalesce((
        select jsonb_agg(jsonb_build_object('principle_id', p.principle_id, 'text', p.text))
        from legal_commons.principle_authority pa
        join legal_commons.principle p on p.principle_id = pa.principle_id
        where pa.authority_id = a.authority_id
      ), '[]'::jsonb)
    ))
    from legal_commons.authority a
    where a.citation = p_citation
  ), '[]'::jsonb);
$$;

-- -----------------------------------------------------------------------------
-- treatment_chain — REFIT of the old cloud authority_treatment_chain onto the
-- pooled treatment edges (spec §7). Directed edges LEADING TO the given
-- authority (who treats it, and who treats those), depth-bounded. (read #5)
-- -----------------------------------------------------------------------------
create or replace function legal_commons.treatment_chain(p_authority_id uuid)
returns jsonb
language sql
stable
as $$
  with recursive chain as (
    select t.treating_authority_id, t.treated_authority_id, t.treatment, t.scope, 1 as depth
    from legal_commons.treatment t
    where t.treated_authority_id = p_authority_id
    union all
    select t.treating_authority_id, t.treated_authority_id, t.treatment, t.scope, c.depth + 1
    from legal_commons.treatment t
    join chain c on t.treated_authority_id = c.treating_authority_id
    where c.depth < 10
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'treating_authority_id', treating_authority_id,
    'treated_authority_id', treated_authority_id,
    'treatment', treatment,
    'scope', scope,
    'depth', depth
  ) order by depth), '[]'::jsonb)
  from chain;
$$;

-- -----------------------------------------------------------------------------
-- push_principle — the one write. ONE transaction per principle (this function's
-- implicit transaction, spec §6): mint the principle, attach authorities
-- (upsert-by-citation as a dedup cache), replace criteria by (principle_id,
-- criterion_order), optionally variant-link. Returns the minted id.
-- Matter-free by signature — there is no p_matter_id. No embedding: search_vector
-- is a generated column; the doctrine_tag feeds the retrieval bucket.
-- -----------------------------------------------------------------------------
create or replace function legal_commons.push_principle(
  p_text text,
  p_jurisdiction text,
  p_variant_of uuid,
  p_variant_note text,
  p_doctrine_tag text,
  p_authorities jsonb default '[]'::jsonb,
  p_criteria jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
as $$
declare
  v_principle_id uuid;
  v_auth jsonb;
  v_authority_id uuid;
  v_crit jsonb;
  v_auth_ids uuid[] := '{}';
begin
  insert into legal_commons.principle (text, jurisdiction, doctrine_tag, variant_of, variant_note)
  values (p_text, p_jurisdiction, p_doctrine_tag, p_variant_of, p_variant_note)
  returning principle_id into v_principle_id;

  for v_auth in select value from jsonb_array_elements(coalesce(p_authorities, '[]'::jsonb)) loop
    -- upsert-by-citation: reuse an already-pooled authority (the dedup cache),
    -- else mint it. citation is not a unique constraint in the schema, so this
    -- is a select-or-insert, not ON CONFLICT.
    select a.authority_id into v_authority_id
    from legal_commons.authority a
    where a.citation = v_auth->>'citation'
    limit 1;

    if v_authority_id is null then
      insert into legal_commons.authority (title, citation, url, authority_type, jurisdiction, disposition)
      values (
        v_auth->>'title', v_auth->>'citation', v_auth->>'url',
        v_auth->>'authority_type', v_auth->>'jurisdiction', v_auth->>'disposition'
      )
      returning authority_id into v_authority_id;
    end if;

    insert into legal_commons.principle_authority
      (principle_id, authority_id, proposition, finding, relationship, obiter, treatment)
    values (
      v_principle_id, v_authority_id,
      v_auth->>'proposition', v_auth->>'finding', v_auth->>'relationship',
      (v_auth->>'obiter')::boolean, v_auth->>'treatment'
    )
    on conflict (principle_id, authority_id) do update set
      proposition = excluded.proposition,
      finding = excluded.finding,
      relationship = excluded.relationship,
      obiter = excluded.obiter,
      -- Currency is only ever added by a push, never cleared: a payload with no
      -- treatment leaves a treatment recorded by record_treatment standing.
      treatment = coalesce(excluded.treatment, principle_authority.treatment),
      updated_at = now();

    v_auth_ids := array_append(v_auth_ids, v_authority_id);
  end loop;

  for v_crit in select value from jsonb_array_elements(coalesce(p_criteria, '[]'::jsonb)) loop
    insert into legal_commons.criterion
      (principle_id, description, requirement_type, criterion_order, burden_of_proof, in_force_date, repeal_date, treatment)
    values (
      v_principle_id,
      v_crit->>'description',
      coalesce(v_crit->>'requirement_type', 'element'),
      (v_crit->>'criterion_order')::integer,
      v_crit->>'burden_of_proof',
      v_crit->>'in_force_date',
      v_crit->>'repeal_date',
      v_crit->>'treatment'
    )
    on conflict (principle_id, criterion_order) do update set
      description = excluded.description,
      requirement_type = excluded.requirement_type,
      burden_of_proof = excluded.burden_of_proof,
      in_force_date = excluded.in_force_date,
      repeal_date = excluded.repeal_date,
      treatment = coalesce(excluded.treatment, criterion.treatment),
      updated_at = now();
  end loop;

  return jsonb_build_object(
    'principle_id', v_principle_id,
    'authority_ids', to_jsonb(v_auth_ids),
    'minted', true
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- record_treatment — the currency write (2026-09-08). Two tables in one
-- transaction, which is why it is an RPC and not a direct PostgREST write:
--   1. select-or-insert the TREATING authority by citation (the same dedup cache
--      as push_principle — the overruling decision, or an oral decision, is
--      usually not pooled yet);
--   2. upsert the directed `treatment` edge (present tense: what the treating
--      decision DOES to the treated one);
--   3. when p_edge_treatment is given, stamp every principle_authority edge
--      standing on the treated authority with that PAST-tense value and point it
--      at the treating authority.
-- The two vocabularies are deliberately different tenses and are NOT
-- interchangeable; oral treatment notes pass p_edge_treatment => null, because a
-- note about what a judge said orally does not restate what a principle's
-- authority now is. Values are enforced in the runtime (`../src/legal-commons/
-- tools.ts`) — these columns are bare text by schema.
-- -----------------------------------------------------------------------------
create or replace function legal_commons.record_treatment(
  p_treating jsonb,
  p_treated_authority_id uuid,
  p_treatment text,
  p_scope text default null,
  p_edge_treatment text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_citation text := nullif(trim(coalesce(p_treating->>'citation', '')), '');
  v_treating_id uuid;
  v_minted boolean := false;
  v_edges integer := 0;
begin
  if v_citation is null then
    raise exception 'record_treatment requires p_treating.citation';
  end if;

  perform 1 from legal_commons.authority a where a.authority_id = p_treated_authority_id;
  if not found then
    raise exception 'no pooled authority % to treat', p_treated_authority_id;
  end if;

  select a.authority_id into v_treating_id
  from legal_commons.authority a
  where a.citation = v_citation
  limit 1;

  if v_treating_id is null then
    insert into legal_commons.authority (title, citation, url, authority_type, jurisdiction, disposition)
    values (
      p_treating->>'title', v_citation, p_treating->>'url',
      p_treating->>'authority_type', p_treating->>'jurisdiction', p_treating->>'disposition'
    )
    returning authority_id into v_treating_id;
    v_minted := true;
  elsif v_treating_id = p_treated_authority_id then
    -- The schema's own check would catch this, but the citation is the useful
    -- diagnostic: it says WHICH authority was resolved onto itself.
    raise exception 'an authority cannot treat itself (%)', v_citation;
  end if;

  insert into legal_commons.treatment (treating_authority_id, treated_authority_id, treatment, scope)
  values (v_treating_id, p_treated_authority_id, p_treatment, p_scope)
  on conflict (treating_authority_id, treated_authority_id) do update set
    treatment = excluded.treatment,
    scope = coalesce(excluded.scope, treatment.scope),
    updated_at = now();

  if p_edge_treatment is not null then
    update legal_commons.principle_authority pa
    set treatment = p_edge_treatment,
        treated_by_authority_id = v_treating_id,
        updated_at = now()
    where pa.authority_id = p_treated_authority_id;
    get diagnostics v_edges = row_count;
  end if;

  return jsonb_build_object(
    'treating_authority_id', v_treating_id,
    'treated_authority_id', p_treated_authority_id,
    'treating_authority_minted', v_minted,
    'treatment', p_treatment,
    'edge_treatment', p_edge_treatment,
    'principle_edges_stamped', v_edges
  );
end;
$$;

-- =============================================================================
-- Expose + grant (A2 owns this; B1 deferred it). The static runtime credential
-- MUST be the service_role / sb_secret_ key — NOT the public anon key. The pool
-- is granted to service_role ONLY, so possession of that non-public key is the
-- write protection (spec §9: "write protection is key custody"). Do NOT grant to
-- anon. (No embedding key exists any more — retrieval is in-Postgres.)
--
-- 1) Expose the schema through PostgREST — PRESERVE the existing list. Either
--    the Dashboard (Project Settings > API > Exposed schemas > tick legal_commons),
--    or:
--   alter role authenticator set pgrst.db_schemas =
--     'public, storage, graphql_public, legal_commons';
--   notify pgrst, 'reload config';
--
-- 2) Grant the static credential's role:
--   grant usage on schema legal_commons to service_role;
--   grant all on all tables in schema legal_commons to service_role;
--   grant execute on all functions in schema legal_commons to service_role;
--   alter default privileges in schema legal_commons
--     grant all on tables to service_role;
--   alter default privileges in schema legal_commons
--     grant execute on functions to service_role;
-- =============================================================================
