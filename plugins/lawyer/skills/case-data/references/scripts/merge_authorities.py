#!/usr/bin/env python3
"""merge_authorities.py — hybrid authority-deduplication generator (/case-data).

Script computes, agent perceives, human decides. This is a PURE function of its
JSON input: it never opens a database, never reads or writes a file (beyond
stdin/stdout and argument-named JSON), and never reads the clock. Identical input
gives byte-identical output — the merge date and operator are REQUIRED CLI
arguments to --emit-sql, never derived from `datetime.now`.

Two modes:

  --plan      : detect candidate duplicate pairs, run the deterministic checks,
                elect the canonical row, compute the field-merge / edge-fold plan,
                and emit a proposal JSON (+ optional markdown) for the human.

  --emit-sql  : turn an approved proposal into a guarded SQL script for
                case_data__execute. Refuses to emit anything that is not fully
                resolved and approved.

Stdlib only (json, re, argparse, sys). No sqlite3, no filesystem, no datetime.

See ../operations/merge-authorities.md (orchestration) and the design at
Engineering/2026-07-20 merge-authorities-hybrid-plan.md. The citation-normalization
rules here are the single executable home of the token rules that
shared/extraction-protocol.md restates in prose — keep the two in lockstep.
"""

import argparse
import json
import re
import sys

# --------------------------------------------------------------------------
# Tombstone / suppression markers (live on law.authorities.notes)
# --------------------------------------------------------------------------
MERGED_INTO_RE = re.compile(r'^\s*\[MERGED-INTO:')
NOT_DUP_RE = re.compile(r'\[NOT-DUPLICATE-OF:#(\d+)\]')

# --------------------------------------------------------------------------
# Citation normalization — the single executable home of these rules.
# shared/extraction-protocol.md restates them in backend-free prose; the two
# MUST match. Style-of-cause names never match a citation pattern, so they are
# "set aside" automatically (a name is not year-court-seq / vol-reporter-page).
# --------------------------------------------------------------------------
_Y = r'(?:19|20)\d{2}'
# neutral: <year> <court code> <sequence>, nothing between year and the code.
NEUTRAL_RE = re.compile(r'\b(' + _Y + r') ([a-z]{2,6}) (\d+)\b')
# statute: <revision> <year> [ c <chapter> ]
STATUTE_RE = re.compile(r'\b(rsbc|sbc|rsc|sc) (' + _Y + r')(?: c ([0-9a-z\-]+))?')
# reporter: [<year>] <volume> <reporter>[ <series>] <page>
REPORTER_RE = re.compile(
    r'\b(?:' + _Y + r' )?(\d{1,4}) ([a-z]{2,6})(?: (\d[a-z]{0,2}))? (\d{1,4})\b')
NO_MARKER_RE = re.compile(r'\(no \d+\)|supplementary reasons')


def _norm_text(s):
    """Lowercase; drop periods, commas, semicolons; strip brackets/parens (keep the
    digits); collapse whitespace. '[2019]' -> '2019', 'v.' -> 'v', 'SBC 2012, c 13'
    -> 'sbc 2012 c 13'."""
    s = s.lower()
    s = re.sub(r'[.,;\[\]()]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def normalize_citation(raw):
    """Classify a raw citation string into neutral / reporter / statute token sets,
    plus the bilingual cues used by B8. Extraction is global (whole-string) and
    ordered neutral -> statute -> reporter so overlapping spans are consumed once."""
    out = {'neutral': set(), 'reporter': set(), 'statute': set(),
           'scr': False, 'rcs': False, 'year': None}
    if not raw:
        return out
    t = _norm_text(raw)
    ym = re.search(_Y, t)
    out['year'] = ym.group(0) if ym else None
    out['scr'] = bool(re.search(r'\bscr\b', t))
    out['rcs'] = bool(re.search(r'\brcs\b', t))
    for m in NEUTRAL_RE.finditer(t):
        out['neutral'].add(f"{m.group(1)} {m.group(2)} {m.group(3)}")
    t = NEUTRAL_RE.sub(' ', t)
    for m in STATUTE_RE.finditer(t):
        chap = m.group(3) or ''
        out['statute'].add(f"{m.group(1)} {m.group(2)} c {chap}".strip())
    t = STATUTE_RE.sub(' ', t)
    for m in REPORTER_RE.finditer(t):
        series = f" {m.group(3)}" if m.group(3) else ''
        out['reporter'].add(f"{m.group(1)} {m.group(2)}{series} {m.group(4)}")
    return out


def normalize_title(raw):
    """Lowercase; unify v./v/c. to ' v '; keep '(no 2)'-type distinguishers; strip
    corporate designators. Titles are compared for equality (N3), so distinguishers
    are load-bearing — 'X' and 'X (no 2)' must not compare equal."""
    if not raw:
        return ''
    t = ' ' + raw.lower().replace('.', ' ') + ' '
    t = re.sub(r'\s+v\s+|\s+vs\s+', ' v ', t)
    t = re.sub(r'\s+c\s+(?=[a-z])', ' v ', t)          # French 'c.' before a name
    t = re.sub(r'\s+(ltd|inc|llp|corp|co|plc)\s+', ' ', t)
    t = re.sub(r'[^\w()\s]', ' ', t)                    # keep parens for '(no 2)'
    return re.sub(r'\s+', ' ', t).strip()


def _year_of(cit):
    """The citation's year (for N3 same-year), captured over the whole string."""
    return cit['year']


def _court_of(neutral_tok):
    parts = neutral_tok.split(' ')
    return parts[1] if len(parts) == 3 else None


# --------------------------------------------------------------------------
# Input assembly
# --------------------------------------------------------------------------
def load_rows(data):
    auths = data.get('authorities', [])
    ca = data.get('concept_authorities', [])
    lc = data.get('legal_criteria', [])
    tr = data.get('authority_treatments', [])
    for a in auths:
        a['_cit'] = normalize_citation(a.get('citation'))
        a['_title'] = normalize_title(a.get('title'))
    return auths, ca, lc, tr


# --------------------------------------------------------------------------
# Detection
# --------------------------------------------------------------------------
def _is_tombstone(a):
    return bool(MERGED_INTO_RE.match(a.get('notes') or ''))


def _not_duplicate_ids(a):
    return set(int(x) for x in NOT_DUP_RE.findall(a.get('notes') or ''))


def find_candidates(auths, forced_pair=None):
    """Return list of (a_row, b_row, rule, detail). rule in
    HASH/N1/N2/N3/STATUTE. Excludes tombstoned rows and NOT-DUPLICATE-OF pairs.
    When forced_pair is (id, id) only that pair is returned (still typed by the
    strongest signal, or N3/UNSPECIFIED if none)."""
    live = [a for a in auths if not _is_tombstone(a)]
    by_id = {a['authority_id']: a for a in live}

    def suppressed(x, y):
        return (y['authority_id'] in _not_duplicate_ids(x)
                or x['authority_id'] in _not_duplicate_ids(y))

    if forced_pair:
        c, d = forced_pair
        if c not in by_id or d not in by_id:
            return []
        x, y = by_id[c], by_id[d]
        return [(x, y) + _classify(x, y, forced=True)]

    seen = set()
    out = []
    for i, x in enumerate(live):
        for y in live[i + 1:]:
            key = (x['authority_id'], y['authority_id'])
            if key in seen or suppressed(x, y):
                continue
            rule, detail = _classify(x, y)
            if rule:
                seen.add(key)
                out.append((x, y, rule, detail))
    return out


def _classify(x, y, forced=False):
    """Strongest matching signal between two rows (descending confidence)."""
    if x.get('file_hash') and x.get('file_hash') == y.get('file_hash'):
        return 'HASH', 'identical file_hash'
    cx, cy = x['_cit'], y['_cit']
    shared_n = cx['neutral'] & cy['neutral']
    if shared_n:
        return 'N1', 'shared neutral token ' + sorted(shared_n)[0]
    shared_s = cx['statute'] & cy['statute']
    if shared_s and x['_title'] and x['_title'] == y['_title']:
        return 'STATUTE', 'shared chapter ' + sorted(shared_s)[0]
    shared_r = cx['reporter'] & cy['reporter']
    if shared_r:
        return 'N2', 'shared reporter token ' + sorted(shared_r)[0]
    if x['_title'] and x['_title'] == y['_title'] and _year_of(cx) == _year_of(cy) \
            and _year_of(cx) is not None:
        return 'N3', 'title + year match'
    if forced:
        return 'UNSPECIFIED', 'operator-forced pair (no automatic signal)'
    return None, None


# --------------------------------------------------------------------------
# Checks
# --------------------------------------------------------------------------
def _treatment_link(tr, a, b):
    for t in tr:
        pair = {t.get('treating_authority_id'), t.get('treated_authority_id')}
        if pair == {a, b}:
            return True
    return False


def _treated_by_link(rows, a, b):
    for r in rows:
        if (r.get('authority_id') == a and r.get('treated_by_authority_id') == b) or \
           (r.get('authority_id') == b and r.get('treated_by_authority_id') == a):
            return True
    return False


def compute_checks(x, y, ca, lc, tr):
    """Deterministic checks. Hard stops (B1/B2/B3/B3b/B9) set status 'fail'. B4/B6
    are 'agent_required'. B5/B7 escalate. B8 records bilingual election."""
    a, b = x['authority_id'], y['authority_id']
    checks = {}

    # B1 — court codes equal (only meaningful when both carry a neutral cite).
    cx, cy = x['_cit'], y['_cit']
    courts_x = {_court_of(t) for t in cx['neutral']}
    courts_y = {_court_of(t) for t in cy['neutral']}
    if courts_x and courts_y and not (courts_x & courts_y):
        checks['B1'] = {'status': 'fail',
                        'detail': f'different courts {sorted(courts_x)} vs {sorted(courts_y)}'}
    else:
        checks['B1'] = {'status': 'pass'}

    # B2 — year+sequence equal (guards a hash/reporter match against contradicting
    # neutral cites). Fails when both have neutral cites and none coincide.
    if cx['neutral'] and cy['neutral'] and not (cx['neutral'] & cy['neutral']):
        checks['B2'] = {'status': 'fail',
                        'detail': f'neutral cites differ {sorted(cx["neutral"])} vs {sorted(cy["neutral"])}'}
    else:
        checks['B2'] = {'status': 'pass'}

    # B3 — no authority_treatments link (either direction) between the pair.
    if _treatment_link(tr, a, b):
        checks['B3'] = {'status': 'fail', 'detail': 'authority_treatments link between the pair'}
    else:
        checks['B3'] = {'status': 'pass'}

    # B3b — no treated_by_authority_id link in concept_authorities or legal_criteria.
    if _treated_by_link(ca, a, b) or _treated_by_link(lc, a, b):
        checks['B3b'] = {'status': 'fail', 'detail': 'treated_by_authority_id link between the pair'}
    else:
        checks['B3b'] = {'status': 'pass'}

    # B4 — decision date. Script cannot read PDFs.
    checks['B4'] = {'status': 'agent_required', 'detail': 'compare judgment dates in the documents'}

    # B5 — disposition consistency (computable when both populated).
    dx, dy = (x.get('disposition') or '').strip(), (y.get('disposition') or '').strip()
    if dx and dy and dx != dy:
        checks['B5'] = {'status': 'escalate', 'detail': 'dispositions differ — human judgment',
                        'canonical': x.get('disposition'), 'merged': y.get('disposition')}
    else:
        checks['B5'] = {'status': 'pass'}

    # B6 — document comparison.
    checks['B6'] = {'status': 'agent_required',
                    'detail': 'compare judge/panel, docket, court header, length'}

    # B7 — (No. 2) / supplementary-reasons marker on exactly one row.
    mx = bool(NO_MARKER_RE.search((x.get('title') or '').lower() + ' ' + (x.get('citation') or '').lower()))
    my = bool(NO_MARKER_RE.search((y.get('title') or '').lower() + ' ' + (y.get('citation') or '').lower()))
    if mx != my:
        checks['B7'] = {'status': 'escalate', 'detail': 'supplementary-reasons marker on exactly one row'}
    else:
        checks['B7'] = {'status': 'pass'}

    # B8 — bilingual cue: same neutral token but SCR/RCS split.
    bilingual = bool(cx['neutral'] & cy['neutral']) and (
        (cx['scr'] and cy['rcs']) or (cx['rcs'] and cy['scr']))
    if bilingual:
        eng = a if cx['scr'] else b
        checks['B8'] = {'status': 'bilingual', 'english_id': eng,
                        'detail': 'bilingual parallel versions — English canonical'}
    else:
        checks['B8'] = {'status': 'pass'}

    # B9 (v8.5) -- an oral_reasons row never merges, in either direction.
    # An oral-reasons authority is a pointer to an unreported bench decision,
    # identified only by a synthetic court+file+judge+date citation with no
    # style of cause. Nothing in the citation-normalization rules above can
    # tell two of them apart, and merging one into a reported decision would
    # silently assert that the transcript-free record and the reported case
    # are the same document. The transcript-upgrade path is a separate,
    # deliberately deferred flow (CLAUDE.md #46), not a merge.
    oral = [r['authority_id'] for r in (x, y)
            if (r.get('authority_type') or '') == 'oral_reasons']
    if oral:
        checks['B9'] = {'status': 'fail',
                        'detail': 'oral_reasons row(s) %s never merge' % sorted(oral)}
    else:
        checks['B9'] = {'status': 'pass'}

    return checks


def is_hard_stop(checks):
    return any(checks[k]['status'] == 'fail'
               for k in ('B1', 'B2', 'B3', 'B3b', 'B9'))


# --------------------------------------------------------------------------
# Election
# --------------------------------------------------------------------------
def _downstream_count(aid, ca, lc, tr):
    n = 0
    for r in ca:
        if r.get('authority_id') == aid or r.get('treated_by_authority_id') == aid:
            n += 1
    for r in lc:
        if r.get('authority_id') == aid or r.get('treated_by_authority_id') == aid:
            n += 1
    for t in tr:
        if t.get('treating_authority_id') == aid or t.get('treated_authority_id') == aid:
            n += 1
    return n


def elect(x, y, checks, ca, lc, tr):
    """English (B8) > more downstream references > lower authority_id.
    Returns (canonical_row, merged_row, basis)."""
    a, b = x['authority_id'], y['authority_id']
    if checks['B8']['status'] == 'bilingual':
        eng = checks['B8']['english_id']
        c, d = (x, y) if eng == a else (y, x)
        return c, d, 'B8 bilingual — English canonical'
    na, nb = _downstream_count(a, ca, lc, tr), _downstream_count(b, ca, lc, tr)
    if na != nb:
        c, d = (x, y) if na > nb else (y, x)
        return c, d, f'more downstream references ({max(na, nb)} vs {min(na, nb)})'
    c, d = (x, y) if a < b else (y, x)
    return c, d, f'lower authority_id (#{min(a, b)})'


# --------------------------------------------------------------------------
# Field-merge and edge/treatment plan
# --------------------------------------------------------------------------
SCALAR_CONFLICT_FIELDS = ['title', 'authority_type', 'jurisdiction', 'disposition',
                          'fact_pattern', 'loss_description']
COPY_IF_EMPTY_FIELDS = ['file_path', 'file_hash']  # two files for one case: never a conflict
EDGE_COLUMNS = ['relationship', 'proposition', 'finding', 'factual_context',
                'obiter', 'order_terms', 'pinpoint', 'excerpt', 'treatment',
                'treated_by_authority_id']


def _empty(v):
    return v is None or (isinstance(v, str) and v.strip() == '')


def plan_field_merge(c, d):
    """Scalar plan for the authority row. copy-if-empty backfills; both-populated-
    unequal -> CONFLICT (needs a resolution). Special fields handled separately."""
    plan = {}
    for f in SCALAR_CONFLICT_FIELDS:
        cv, dv = c.get(f), d.get(f)
        if _empty(cv) and not _empty(dv):
            plan[f] = {'action': 'backfill', 'value': dv}
        elif not _empty(cv) and not _empty(dv) and cv != dv:
            plan[f] = {'action': 'conflict', 'canonical': cv, 'merged': dv}
    for f in COPY_IF_EMPTY_FIELDS:
        cv, dv = c.get(f), d.get(f)
        if _empty(cv) and not _empty(dv):
            plan[f] = {'action': 'backfill', 'value': dv}

    # citation: append D's citation when it carries a token C lacks (token union,
    # canonical string preserved).
    cc, dc = c['_cit'], d['_cit']
    d_only = ((dc['neutral'] - cc['neutral']) | (dc['reporter'] - cc['reporter'])
              | (dc['statute'] - cc['statute']))
    if d_only and d.get('citation'):
        base = c.get('citation')
        plan['citation'] = {'action': 'union',
                            'value': (base + '; ' + d['citation']) if base else d['citation']}

    # last_verified_at: max (ISO strings sort chronologically).
    lv = [v for v in (c.get('last_verified_at'), d.get('last_verified_at')) if v]
    if lv and max(lv) != c.get('last_verified_at'):
        plan['last_verified_at'] = {'action': 'max', 'value': max(lv)}

    # cloud_authority_id: two distinct cloud ids -> record both, flag a separate
    # human-initiated commons merge (Decision 10; dormant while all NULL).
    ccl, dcl = c.get('cloud_authority_id'), d.get('cloud_authority_id')
    if ccl and dcl and ccl != dcl:
        plan['cloud_authority_id'] = {'action': 'dual_flag', 'canonical': ccl, 'merged': dcl}
    elif _empty(ccl) and not _empty(dcl):
        plan['cloud_authority_id'] = {'action': 'backfill', 'value': dcl}
    return plan


def plan_edges(c, d, ca):
    """Concept-authority edge plan. Collisions (same concept on C and D) fold onto
    C per Decision 5; D-only edges migrate by re-point."""
    cid, did = c['authority_id'], d['authority_id']
    c_edges = {r['concept_id']: r for r in ca if r.get('authority_id') == cid}
    d_edges = {r['concept_id']: r for r in ca if r.get('authority_id') == did}
    folds, migrations = [], []
    for concept_id, de in d_edges.items():
        if concept_id in c_edges:
            ce = c_edges[concept_id]
            cols, conflict = {}, False
            for col in EDGE_COLUMNS:
                cv, dv = ce.get(col), de.get(col)
                if _empty(cv) and not _empty(dv):
                    cols[col] = {'action': 'backfill', 'value': dv}
                elif not _empty(cv) and not _empty(dv) and cv != dv:
                    cols[col] = {'action': 'keep_c_append_d', 'canonical': cv, 'merged': dv}
                    conflict = True
            cver, dver = ce.get('verified', 0), de.get('verified', 0)
            # surviving text keeps its own state; disagreement (text or state) -> 2.
            new_ver = cver if (cver == dver and not conflict) else 2
            folds.append({'concept_id': concept_id, 'columns': cols,
                          'canonical_verified': cver, 'merged_verified': dver,
                          'verified': new_ver, 'escalated': new_ver == 2})
        else:
            migrations.append({'concept_id': concept_id})
    return folds, migrations


def plan_treatments(c, d, tr):
    """authority_treatments plan: which D rows collide with a C row on the surviving
    PK (folded/deleted) vs migrate by re-point. B3 guarantees no C<->D row."""
    cid, did = c['authority_id'], d['authority_id']
    c_treating = {t['treated_authority_id'] for t in tr if t.get('treating_authority_id') == cid}
    c_treated = {t['treating_authority_id'] for t in tr if t.get('treated_authority_id') == cid}
    folds, migrations = [], []
    for t in tr:
        if t.get('treating_authority_id') == did:
            other = t.get('treated_authority_id')
            (folds if other in c_treating else migrations).append(
                {'role': 'treating', 'other': other})
        elif t.get('treated_authority_id') == did:
            other = t.get('treating_authority_id')
            (folds if other in c_treated else migrations).append(
                {'role': 'treated', 'other': other})
    return folds, migrations


def _needs_resolution(fp):
    return [f for f, p in fp.items() if p['action'] == 'conflict']


# --------------------------------------------------------------------------
# --plan
# --------------------------------------------------------------------------
def build_proposal(data, forced_pair=None):
    auths, ca, lc, tr = load_rows(data)
    candidates = find_candidates(auths, forced_pair)
    proposals, rejected = [], []
    for x, y, rule, detail in candidates:
        checks = compute_checks(x, y, ca, lc, tr)
        if is_hard_stop(checks):
            reasons = [f'{k}: {checks[k]["detail"]}'
                       for k in ('B1', 'B2', 'B3', 'B3b', 'B9')
                       if checks[k]['status'] == 'fail']
            rejected.append({'pair': [x['authority_id'], y['authority_id']],
                             'match': {'rule': rule, 'detail': detail},
                             'reason': '; '.join(reasons)})
            continue
        c, d, basis = elect(x, y, checks, ca, lc, tr)
        fp = plan_field_merge(c, d)
        folds, migrations = plan_edges(c, d, ca)
        t_folds, t_migrations = plan_treatments(c, d, tr)
        autonomous = (rule == 'N1'
                      and all(checks[k]['status'] == 'pass'
                              for k in checks if k not in ('B4', 'B6'))
                      and checks['B4']['status'] == 'agent_required'
                      and checks['B6']['status'] == 'agent_required')
        proposals.append({
            'canonical_id': c['authority_id'],
            'merged_id': d['authority_id'],
            'canonical_title': c.get('title'),
            'merged_title': d.get('title'),
            'match': {'rule': rule, 'detail': detail},
            'checks': checks,
            'election': {'canonical': c['authority_id'], 'basis': basis},
            'field_merge': fp,
            'unresolved_conflicts': _needs_resolution(fp),
            'edge_folds': folds,
            'edge_migrations': migrations,
            'treatment_folds': t_folds,
            'treatment_migrations': t_migrations,
            'autonomously_proposable': autonomous,
            'decision': None,
            'resolutions': {},
        })
    return {'merge_date': None, 'operator': None,
            'proposals': proposals, 'rejected': rejected}


# --------------------------------------------------------------------------
# Markdown rendering
# --------------------------------------------------------------------------
def render_md(proposal):
    lines = []
    for p in proposal['proposals']:
        lines.append(f"### Merge #{p['merged_id']} → #{p['canonical_id']}  ({p['match']['rule']})")
        lines.append(f"- Canonical: #{p['canonical_id']} {p['canonical_title']!r}")
        lines.append(f"- Merged away: #{p['merged_id']} {p['merged_title']!r}")
        lines.append(f"- Match: {p['match']['detail']}")
        lines.append(f"- Election: {p['election']['basis']}")
        lines.append(f"- Autonomously proposable: {p['autonomously_proposable']}")
        for k in sorted(p['checks']):
            ch = p['checks'][k]
            extra = f" — {ch.get('detail')}" if ch.get('detail') else ''
            lines.append(f"  - {k}: {ch['status']}{extra}")
        if p['field_merge']:
            lines.append("- Field merge:")
            for f, pl in p['field_merge'].items():
                if pl['action'] == 'conflict':
                    lines.append(f"  - **CONFLICT** {f}: {pl['canonical']!r} vs {pl['merged']!r} — resolve")
                else:
                    lines.append(f"  - {f}: {pl['action']} → {pl.get('value', '')!r}")
        for fold in p['edge_folds']:
            flag = ' [escalated → verified 2]' if fold['escalated'] else ''
            lines.append(f"- Edge fold concept {fold['concept_id']}{flag}")
        if p['edge_migrations']:
            lines.append(f"- Edge migrations: {[m['concept_id'] for m in p['edge_migrations']]}")
        if p['unresolved_conflicts']:
            lines.append(f"- **Needs resolution:** {p['unresolved_conflicts']}")
        lines.append('')
    for r in proposal['rejected']:
        lines.append(f"### REJECTED {r['pair']} — {r['reason']}")
    return '\n'.join(lines)


# --------------------------------------------------------------------------
# SQL emission
# --------------------------------------------------------------------------
def _sqlstr(v):
    """SQL string literal with ''-doubling. None -> NULL."""
    if v is None:
        return 'NULL'
    return "'" + str(v).replace("'", "''") + "'"


def _int(v, name):
    if not isinstance(v, int) or isinstance(v, bool) or v <= 0:
        raise ValueError(f'{name} must be a positive integer, got {v!r}')
    return v


def _resolved_scalar_value(field, pl, resolutions):
    if pl['action'] == 'conflict':
        if field not in resolutions:
            raise ValueError(f'unresolved CONFLICT on {field}')
        return resolutions[field]
    return pl['value']


def _stage_d_statements(p, merge_date, operator):
    """Generate the UPDATEs on C: scalar backfills/resolutions, citation union,
    notes concatenation, and per-edge collision folds. One statement per touched
    row. Runs BEFORE the generic re-point/delete block."""
    c, d = p['canonical_id'], p['merged_id']
    res = p.get('resolutions', {})
    stmts = []

    # Authority scalar SET clause.
    sets = []
    for f in SCALAR_CONFLICT_FIELDS + COPY_IF_EMPTY_FIELDS + ['citation', 'last_verified_at']:
        if f in p['field_merge']:
            val = _resolved_scalar_value(f, p['field_merge'][f], res)
            sets.append(f"{f} = {_sqlstr(val)}")
    cl = p['field_merge'].get('cloud_authority_id')
    if cl and cl['action'] == 'backfill':
        sets.append(f"cloud_authority_id = {_sqlstr(cl['value'])}")

    # Notes: provenance-prefixed concatenation on C. Includes a dual-cloud flag when
    # two distinct cloud ids meet (Decision 10).
    # D's own notes stay on D (retained on its tombstone), not duplicated onto C.
    prov = f"[merged from authority #{d} {merge_date} {operator}]"
    note_bits = [prov]
    if cl and cl['action'] == 'dual_flag':
        note_bits.append(f"[COMMONS-MERGE-NEEDED: cloud {cl['canonical']} + {cl['merged']}]")
    merged_note = ' '.join(note_bits)
    # coalesce existing C notes in-SQL so a concurrent note change is preserved.
    sets.append("notes = TRIM(COALESCE(notes,'') || ' ' || " + _sqlstr(merged_note) + ")")

    stmts.append(f"UPDATE law.authorities SET {', '.join(sets)} WHERE authority_id = {c};")

    # Per-edge collision folds (before the generic concept_authorities re-point).
    for fold in p['edge_folds']:
        concept_id = _int(fold['concept_id'], 'concept_id')
        esets = []
        appended = []
        for col, pl in fold['columns'].items():
            if pl['action'] == 'backfill':
                esets.append(f"{col} = {_edge_val(col, pl['value'])}")
            elif pl['action'] == 'keep_c_append_d':
                appended.append(f"{col}={pl['merged']}")
        esets.append(f"verified = {fold['verified']}")
        if appended or fold['escalated']:
            enote = f"[merged from authority #{d} {merge_date} {operator}]"
            if appended:
                enote += ' D-values: ' + '; '.join(appended)
            esets.append("notes = TRIM(COALESCE(notes,'') || ' ' || " + _sqlstr(enote) + ")")
        stmts.append(
            f"UPDATE law.concept_authorities SET {', '.join(esets)} "
            f"WHERE concept_id = {concept_id} AND authority_id = {c};")
    return '\n'.join(stmts)


def _edge_val(col, value):
    if col == 'treated_by_authority_id':
        return 'NULL' if value is None else str(int(value))
    return _sqlstr(value)


def emit_merge_sql(p, merge_date, operator):
    c = _int(p['canonical_id'], 'canonical_id')
    d = _int(p['merged_id'], 'merged_id')
    date = _sqlstr(merge_date)
    op = _sqlstr(operator)
    stage_d = _stage_d_statements(p, merge_date, operator)
    return MERGE_TEMPLATE.format(C=c, D=d, DATE=merge_date, OPERATOR=operator,
                                 STAGE_D=stage_d, DATE_SQL=date, OP_SQL=op)


MERGE_TEMPLATE = """-- ===== merge authority #{D} into #{C} ({DATE} {OPERATOR}) =====
-- Guards: assert-table trick — any CHECK failure aborts the whole script;
-- backend rolls back temp copies, natives untouched.
CREATE TEMP TABLE _assert (n INTEGER CHECK (n = 0));
-- D still live (not merged by a concurrent session)
INSERT INTO _assert SELECT count(*) FROM law.authorities
  WHERE authority_id = {D} AND instr(coalesce(notes,''), '[MERGED-INTO:') > 0;
-- C exists and is live
INSERT INTO _assert SELECT 1 - count(*) FROM law.authorities
  WHERE authority_id = {C} AND instr(coalesce(notes,''), '[MERGED-INTO:') = 0;
-- B3 re-check in-transaction (also guarantees the re-point UPDATEs below can
-- never trip CHECK(treating != treated))
INSERT INTO _assert SELECT count(*) FROM law.authority_treatments
  WHERE (treating_authority_id = {C} AND treated_authority_id = {D})
     OR (treating_authority_id = {D} AND treated_authority_id = {C});
-- B3b re-check
INSERT INTO _assert SELECT count(*) FROM law.concept_authorities
  WHERE (authority_id = {C} AND treated_by_authority_id = {D})
     OR (authority_id = {D} AND treated_by_authority_id = {C});
INSERT INTO _assert SELECT count(*) FROM law.legal_criteria
  WHERE (authority_id = {C} AND treated_by_authority_id = {D})
     OR (authority_id = {D} AND treated_by_authority_id = {C});

-- Stage D writes on C: approved field backfills, citation union, notes
-- concatenation, per-edge collision folds.
{STAGE_D}

-- authority_treatments: fold PK collisions BEFORE re-pointing
DELETE FROM law.authority_treatments WHERE treating_authority_id = {D}
  AND treated_authority_id IN
      (SELECT treated_authority_id FROM law.authority_treatments WHERE treating_authority_id = {C});
DELETE FROM law.authority_treatments WHERE treated_authority_id = {D}
  AND treating_authority_id IN
      (SELECT treating_authority_id FROM law.authority_treatments WHERE treated_authority_id = {C});
UPDATE law.authority_treatments SET treating_authority_id = {C} WHERE treating_authority_id = {D};
UPDATE law.authority_treatments SET treated_authority_id  = {C} WHERE treated_authority_id  = {D};

-- concept_authorities: re-point simple refs, migrate D-only edges, delete folded collisions
UPDATE law.concept_authorities SET treated_by_authority_id = {C} WHERE treated_by_authority_id = {D};
UPDATE law.concept_authorities SET authority_id = {C}
  WHERE authority_id = {D}
    AND concept_id NOT IN (SELECT concept_id FROM law.concept_authorities WHERE authority_id = {C});
DELETE FROM law.concept_authorities WHERE authority_id = {D};

-- legal_criteria
UPDATE law.legal_criteria SET authority_id = {C} WHERE authority_id = {D};
UPDATE law.legal_criteria SET treated_by_authority_id = {C} WHERE treated_by_authority_id = {D};

-- Tombstone D (original citation/file_path/file_hash retained for audit + ingest redirect)
UPDATE law.authorities
  SET notes = '[MERGED-INTO:#{C} {DATE} {OPERATOR}] ' || coalesce(notes, '')
  WHERE authority_id = {D};

-- Post-conditions (enforced, not advisory)
INSERT INTO _assert SELECT count(*) FROM law.concept_authorities
  WHERE authority_id = {D} OR treated_by_authority_id = {D};
INSERT INTO _assert SELECT count(*) FROM law.legal_criteria
  WHERE authority_id = {D} OR treated_by_authority_id = {D};
INSERT INTO _assert SELECT count(*) FROM law.authority_treatments
  WHERE treating_authority_id = {D} OR treated_authority_id = {D};
-- self-treatment anomaly guards
INSERT INTO _assert SELECT count(*) FROM law.concept_authorities
  WHERE authority_id = {C} AND treated_by_authority_id = {C};
INSERT INTO _assert SELECT count(*) FROM law.legal_criteria
  WHERE authority_id = {C} AND treated_by_authority_id = {C};
DROP TABLE _assert;"""


NOT_DUP_TEMPLATE = """-- ===== mark #{A} and #{B} not duplicates ({DATE} {OPERATOR}) =====
UPDATE law.authorities SET notes = TRIM(COALESCE(notes,'') || ' ' || '[NOT-DUPLICATE-OF:#{B}]')
  WHERE authority_id = {A};
UPDATE law.authorities SET notes = TRIM(COALESCE(notes,'') || ' ' || '[NOT-DUPLICATE-OF:#{A}]')
  WHERE authority_id = {B};"""


def emit_not_duplicate_sql(a, b, merge_date, operator):
    a, b = _int(a, 'id'), _int(b, 'id')
    return NOT_DUP_TEMPLATE.format(A=a, B=b, DATE=merge_date, OPERATOR=operator)


def emit_sql(proposal, merge_date, operator):
    if not merge_date or not operator:
        raise ValueError('--merge-date and --operator are required for --emit-sql')
    blocks = []
    approved = [p for p in proposal.get('proposals', [])
                if p.get('decision') in ('merge', 'not_duplicate')]
    if not approved:
        raise ValueError('no proposal carries an approved decision (merge / not_duplicate)')
    for p in approved:
        if p['decision'] == 'not_duplicate':
            blocks.append(emit_not_duplicate_sql(p['canonical_id'], p['merged_id'], merge_date, operator))
            continue
        # merge — refuse anything unresolved.
        for k, ch in p['checks'].items():
            if ch['status'] in ('fail', 'agent_required'):
                raise ValueError(f"pair #{p['merged_id']}→#{p['canonical_id']}: check {k} is {ch['status']}")
            if ch['status'] == 'escalate':
                raise ValueError(f"pair #{p['merged_id']}→#{p['canonical_id']}: check {k} escalated — needs human resolution")
        unresolved = [f for f in p.get('unresolved_conflicts', []) if f not in p.get('resolutions', {})]
        if unresolved:
            raise ValueError(f"pair #{p['merged_id']}→#{p['canonical_id']}: unresolved conflicts {unresolved}")
        blocks.append(emit_merge_sql(p, merge_date, operator))
    return '\n\n'.join(blocks)


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------
def _read_json(path):
    if path == '-' or path is None:
        return json.load(sys.stdin)
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def main(argv=None):
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding='utf-8')  # UTF-8 output regardless of console locale
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(description=__doc__)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument('--plan', action='store_true')
    mode.add_argument('--emit-sql', action='store_true')
    ap.add_argument('--input', help='rows JSON (--plan); default stdin')
    ap.add_argument('--proposal', help='approved proposal JSON (--emit-sql); default stdin')
    ap.add_argument('--pair', nargs=2, type=int, metavar=('C_ID', 'D_ID'))
    ap.add_argument('--merge-date', help='ISO date, required for --emit-sql')
    ap.add_argument('--operator', help='operator name, required for --emit-sql')
    ap.add_argument('--format', choices=['json', 'md'], default='json')
    args = ap.parse_args(argv)

    if args.plan:
        data = _read_json(args.input)
        proposal = build_proposal(data, tuple(args.pair) if args.pair else None)
        if args.format == 'md':
            sys.stdout.write(render_md(proposal) + '\n')
        else:
            sys.stdout.write(json.dumps(proposal, indent=2, ensure_ascii=False) + '\n')
        return 0

    # --emit-sql
    proposal = _read_json(args.proposal)
    try:
        sql = emit_sql(proposal, args.merge_date, args.operator)
    except ValueError as e:
        sys.stderr.write(f'REFUSED: {e}\n')
        return 2
    sys.stdout.write(sql + '\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
