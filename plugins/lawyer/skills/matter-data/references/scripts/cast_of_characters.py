"""cast_of_characters.py — everyone in a matter's case data, for the Cast of Characters board (MODULE + CLI).

Read-only. Given a matter-data folder, returns every party with its proceeding
roles and its counsel of record for each proceeding (a proceeding_parties value
overrides the party's own, #55), every witness and expert with the parties that
call and retain them, every tribunal member, every alias and file code, and per
party, witness and tribunal member the number of facts and of source documents
that name them (Cast of Characters spec 4.2). The data server spawns it over
PYTHONPATH, as it does list_parties.py (#56). Three statuses, never a bare empty list:

  {"status": "ok", "proceedings": [...], "parties": [...], "witnesses": [...],
   "tribunal_members": [...], "sources": [{source_id, title, date, file_path}, ...]}
  {"status": "not_applicable", "reason": ...}  no matter-data database in the folder
  {"status": "unavailable", "reason": ...}     a database behind the current schema

A fact names a participant when a position or admission ties it to the party,
when the participant's report is its source, or when its description or
informant holds the participant's folded name or a spelling alias of four or
more letters. A document names a participant when it was filed by the party,
is the expert's report, or its file name holds one of the participant's file
codes as a word, or its title holds the name or a spelling alias. The counts
are leads, not identities.

Reads a temp copy of main.sqlite only (never the native file, never law or
privileged), takes no lock, and writes nothing. Standard library only.

    python cast_of_characters.py <case_data_dir>
"""

import json
import ntpath
import re
import sys

from list_parties import read_staged
from parties_of_record import _behind
from resolve_participant import _fold

_PARTY = ('party_id', 'name', 'party_type', 'lawyer_name', 'lawyer_firm', 'lawyer_email',
          'lawyer_phone', 'address', 'contact_info', 'service_address_filed_date',
          'replaced_representative')
_OVERRIDES = ('lawyer_name', 'lawyer_firm', 'lawyer_email', 'lawyer_phone', 'address',
              'service_address_filed_date')
_MIN_TERM = 4


def _rows(con, sql):
    cur = con.execute(sql)
    names = [d[0] for d in cur.description]
    return [dict(zip(names, row)) for row in cur.fetchall()]


def _has_term(folded_text, term):
    return bool(term) and re.search(rf"(?:^| ){re.escape(term)}(?: |$)", folded_text) is not None


class _Counter:
    """Fact and document ids per participant, so each is counted once."""

    def __init__(self, facts, sources):
        self.facts = [(f['fact_id'], _fold(f'{f["description"] or ""} {f["informant"] or ""}')) for f in facts]
        self.sources = [(s['source_id'], _fold(s['title']),
                         _fold(ntpath.basename(s['file_path'] or ''))) for s in sources]

    def count(self, names, codes, fact_ids=(), source_ids=()):
        terms = {t for t in (_fold(n) for n in names) if len(t) >= _MIN_TERM}
        code_terms = {t for t in (_fold(c) for c in codes) if t}
        facts = set(fact_ids) | {fid for fid, text in self.facts if any(_has_term(text, t) for t in terms)}
        docs = set(source_ids) | {
            sid for sid, title, base in self.sources
            if any(_has_term(base, t) for t in code_terms) or any(_has_term(title, t) for t in terms)}
        return {"facts": len(facts), "documents": len(docs)}


def _read(con, source_ids=()):
    behind = _behind(con)
    if behind:
        return behind

    aliases = _rows(con, "SELECT party_id, of_counsel, witness_id, tribunal_member_id, alias_text, alias_kind "
                         "FROM participant_aliases ORDER BY alias_id")

    def own(key, value, of_counsel=0):
        return [{"text": a['alias_text'], "kind": a['alias_kind']} for a in aliases
                if a[key] == value and (key != 'party_id' or a['of_counsel'] == of_counsel)]

    counter = _Counter(_rows(con, "SELECT fact_id, description, informant FROM facts"),
                       _rows(con, "SELECT source_id, title, file_path FROM sources"))
    linked_facts = {}
    for party_id, fact_id in con.execute(
            "SELECT party_id, fact_id FROM positions UNION SELECT admitting_party_id, fact_id FROM admissions"):
        linked_facts.setdefault(party_id, set()).add(fact_id)
    filed = {}
    for party_id, source_id in con.execute(
            "SELECT filed_by_party_id, source_id FROM sources WHERE filed_by_party_id IS NOT NULL"):
        filed.setdefault(party_id, set()).add(source_id)

    def counts(name, own_aliases, facts=(), docs=()):
        names = [name] + [a['text'] for a in own_aliases if a['kind'] == 'spelling']
        codes = [a['text'] for a in own_aliases if a['kind'] == 'file_code']
        return counter.count(names, codes, facts, docs)

    proceedings = _rows(con, "SELECT proceeding_id, court, registry, file_number, style_of_cause, status "
                             "FROM proceedings ORDER BY proceeding_id")
    links = _rows(con, "SELECT proceeding_id, party_id, role, " + ", ".join(_OVERRIDES) +
                       " FROM proceeding_parties ORDER BY proceeding_id, party_id, role")
    parties = []
    for p in _rows(con, f"SELECT {', '.join(_PARTY)} FROM parties ORDER BY party_id"):
        mine = [link for link in links if link['party_id'] == p['party_id']]
        counsel = {}
        for link in mine:
            effective = {k: (link[k] if link[k] not in (None, '') else p[k]) for k in _OVERRIDES}
            counsel.setdefault(link['proceeding_id'], {"proceeding_id": link['proceeding_id'], **effective})
        own_aliases = own('party_id', p['party_id'])
        parties.append({
            **p,
            "proceedings": [{"proceeding_id": link['proceeding_id'], "role": link['role']} for link in mine],
            "counsel_by_proceeding": list(counsel.values()),
            "aliases": own_aliases,
            "counsel_aliases": own('party_id', p['party_id'], 1),
            "counts": counts(p['name'], own_aliases, linked_facts.get(p['party_id'], ()),
                             filed.get(p['party_id'], ())),
        })

    called = {}
    for witness_id, proceeding_id, party_id in con.execute(
            "SELECT witness_id, proceeding_id, called_by_party_id FROM proceeding_witnesses "
            "ORDER BY proceeding_id"):
        called.setdefault(witness_id, []).append({"proceeding_id": proceeding_id, "called_by_party_id": party_id})
    witnesses = []
    for w in _rows(con, "SELECT witness_id, name, witness_type, field_of_expertise, retained_by_party_id, "
                        "report_source_id, qualified FROM witnesses ORDER BY witness_id"):
        own_aliases = own('witness_id', w['witness_id'])
        report = [w['report_source_id']] if w['report_source_id'] is not None else []
        report_facts = [fid for (fid,) in con.execute(
            "SELECT fact_id FROM facts WHERE source_id = ?", (w['report_source_id'],))] if report else []
        witnesses.append({**w, "proceedings": called.get(w['witness_id'], []), "aliases": own_aliases,
                          "counts": counts(w['name'], own_aliases, report_facts, report)})

    tribunal = []
    for m in _rows(con, "SELECT tribunal_member_id, name, capacity, tribunal_body, proceeding_id, notes "
                        "FROM tribunal_members ORDER BY tribunal_member_id"):
        own_aliases = own('tribunal_member_id', m['tribunal_member_id'])
        tribunal.append({**m, "aliases": own_aliases, "counts": counts(m['name'], own_aliases)})

    wanted = sorted({int(i) for i in source_ids})
    cited = [dict(zip(('source_id', 'title', 'date', 'file_path'), row)) for row in con.execute(
        "SELECT source_id, title, date, file_path FROM sources WHERE source_id IN "
        "(SELECT value FROM json_each(?)) ORDER BY source_id", (json.dumps(wanted),))]
    return {"status": "ok", "proceedings": proceedings, "parties": parties, "witnesses": witnesses,
            "tribunal_members": tribunal, "sources": cited}


def run(request):
    """One JSON request in, one JSON-serializable result out.

    request = {"case_data_dir": str, "source_ids": [int, ...]}  source_ids: the sources whose
    title, date and file_path the board cites, from the matter roles' from_source_id
    """
    return read_staged(request.get("case_data_dir"), 'cast',
                       lambda con: _read(con, request.get("source_ids") or ()))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: cast_of_characters.py <case_data_dir>", file=sys.stderr)
        sys.exit(1)
    print(json.dumps(run({"case_data_dir": sys.argv[1]}), indent=2))
