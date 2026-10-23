-- =============================================================================
-- Migration 0002: retire the note-up date (2026-10-23, #118)
-- =============================================================================
-- The pool keeps no note-up date (lawyer-only-access plan §7 rules 3 and 8).
-- This replaces `push_principle` and `record_treatment` with the bodies in
-- ../functions.sql, which no longer write `authority.last_verified_at`, then
-- drops that column. Apply once, in one paste in the SQL editor.
--
-- It refuses to run, changing nothing, when:
--   - either live function's body differs from the one deployed on 2026-09-13
--     (md5 of `prosrc` recorded in ../functions.sql), so no drift is overwritten;
--   - any other function still mentions `last_verified_at`, because Postgres does
--     not track which function bodies use a column and such a function would
--     fail only when next called.
-- A view that uses the column makes the drop itself fail, which also changes
-- nothing (no cascade).
--
-- No undo file: the dropped dates cannot come back. To restore the old writer,
-- add the column again (`timestamptz`) and re-apply both functions from
-- ../functions.sql at commit b927555a.
--
-- After it runs, `md5(prosrc)` should be abdbe94d1e0b754068c90e1ff2cb0dfd for
-- `push_principle` and e15c870936666d190fbd3bed3bc3aee4 for `record_treatment`,
-- the bodies in ../functions.sql.
-- =============================================================================

begin;

do $$
declare
  v_others text;
begin
  if (select md5(prosrc) from pg_proc
      where oid = 'legal_commons.push_principle(text,text,uuid,text,text,jsonb,jsonb)'::regprocedure)
     <> '1bfc90428f40685a9f1dccbe223a1d6e' then
    raise exception 'push_principle differs from the 2026-09-13 deploy; compare it with functions.sql first';
  end if;
  if (select md5(prosrc) from pg_proc
      where oid = 'legal_commons.record_treatment(jsonb,uuid,text,text,text)'::regprocedure)
     <> '4a10dba657c0f051d8b12a5476fd8ada' then
    raise exception 'record_treatment differs from the 2026-09-13 deploy; compare it with functions.sql first';
  end if;

  select string_agg(n.nspname || '.' || p.proname, ', ') into v_others
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where p.prosrc ilike '%last_verified_at%'
    and n.nspname not in ('pg_catalog', 'information_schema')
    and p.oid not in (
      'legal_commons.push_principle(text,text,uuid,text,text,jsonb,jsonb)'::regprocedure,
      'legal_commons.record_treatment(jsonb,uuid,text,text,text)'::regprocedure);
  if v_others is not null then
    raise exception 'these functions still mention last_verified_at: %', v_others;
  end if;
end;
$$;

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

alter table legal_commons.authority drop column last_verified_at;

commit;

notify pgrst, 'reload schema';
