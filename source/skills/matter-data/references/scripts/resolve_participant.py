"""resolve_participant.py — resolve a name to the participants it could mean (MODULE + CLI).

Read-only. Given a matter-data folder and a name as someone wrote or said it (a
full name, a surname, "Surname, Given", "J. Surname", or a firm file-name code
such as `SmithJ`), returns every participant it could mean, with every name,
alias and file code on record for each, so a caller can search for all of
them. A participant is a party, a party's counsel, a witness (an expert is a
witness) or a tribunal member (design-decisions.md #65, #66).

Matching, in order:

  exact  the whole name, an alias or a file code equals the request; or the
         request's surname equals a recorded surname or file-code stem, and any
         given name or initial in the request agrees with one on record.
         Case, accents, apostrophes and hyphens are ignored throughout.
  near   only where nothing about that participant matched exactly: the
         request's surname is within Levenshtein distance 2 of a recorded
         surname, both are at least four letters, the distance is under half
         the shorter one's length, and any given name or initial agrees.
         Given names are never fuzzed. Organisations match exactly only.

Three statuses, never a bare empty list:

  {"status": "ok", "query": ..., "matches": [
      {"role": "party"|"counsel"|"witness"|"expert"|"tribunal",
       "id": int, "name": str, "capacity": str|None, "body": str|None,
       "party_ids": [int] (counsel only), "match": "exact"|"near",
       "matched": str, "distance": int (near only),
       "search_terms": [str, ...]}, ...]}
  {"status": "not_found", "query": ..., "reason": ...}   nothing matched
  {"status": "unavailable", "reason": ...}  no name, no matter-data database,
      or a database behind the current schema

`id` is the party's, witness's or tribunal member's own id; for counsel it is
the first party they act for, and `party_ids` lists every one. `capacity` is a
tribunal member's capacity, a party's proceeding roles, counsel's clients, or
an expert's field. Reads a temp copy of main.sqlite only (never the native
file, never law or privileged), takes no lock, and writes nothing. Standard
library only.

    python resolve_participant.py <case_data_dir> <name>
"""

import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import unicodedata

import resolve_paths

_ROLE_ORDER = {"party": 0, "counsel": 1, "witness": 2, "expert": 3, "tribunal": 4}
_CODE_RE = re.compile(r"^([A-Za-z'\-]*[a-z])([A-Z]{1,3})$")
_MIN_FUZZ_LEN = 4
_MAX_DISTANCE = 2


def _version_label(version):
    return f"v{version // 10}.{version % 10}"


def _behind(con):
    uv = con.execute("PRAGMA user_version").fetchone()[0]
    version = resolve_paths.LEGACY_USER_VERSION if uv == 0 else uv
    if version < resolve_paths.EXPECTED_USER_VERSION:
        return {
            "status": "unavailable",
            "reason": (
                f"case data is at {_version_label(version)} and resolving a participant "
                f"needs {_version_label(resolve_paths.EXPECTED_USER_VERSION)}; "
                "run matter_data__migrate (plan, then apply)"),
        }
    return None


def _fold(text):
    """Case-, accent-, apostrophe- and hyphen-insensitive form; other punctuation is a space."""
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).casefold()
    text = re.sub(r"['’\-]", "", text)
    return " ".join(re.sub(r"[^0-9a-z]+", " ", text).split())


def _split_code(text):
    """`SmithJ` -> ('smith', 'j'); None when the text is not shaped like a file code."""
    m = _CODE_RE.match((text or "").strip())
    return (_fold(m.group(1)), m.group(2).casefold()) if m else None


def _parse_name(text):
    """(surname, given) from a written name, folded; given may be '' or one initial."""
    raw = (text or "").strip()
    if "," in raw:
        surname, _, given = raw.partition(",")
        surname, given = _fold(surname), _fold(given).split()
        return surname.replace(" ", ""), (given[0] if given else "")
    words = _fold(raw).split()
    if not words:
        return "", ""
    if len(words) == 1:
        return words[0], ""
    return words[-1], words[0]


def _levenshtein(a, b):
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


class _Participant:
    def __init__(self, role, pid, name, person, capacity=None, body=None, party_ids=None):
        self.role, self.id, self.name, self.person = role, pid, name, person
        self.capacity, self.body, self.party_ids = capacity, body, party_ids
        self.terms = []          # (original text, kind) where kind is name|spelling|file_code
        self.add(name, "name")

    def add(self, text, kind):
        if text and text.strip() and (text.strip(), kind) not in self.terms:
            self.terms.append((text.strip(), kind))

    def keys(self):
        """(whole forms, [(surname, given, original)]) for matching."""
        wholes, names = {}, []
        for text, kind in self.terms:
            wholes.setdefault(_fold(text), text)
            wholes.setdefault(_fold(text).replace(" ", ""), text)
            if not self.person:
                continue
            code = _split_code(text) if kind == "file_code" else None
            if code:
                names.append((code[0], code[1], text))
            elif kind == "file_code":
                names.append((_fold(text).replace(" ", ""), "", text))
            else:
                surname, given = _parse_name(text)
                if surname:
                    names.append((surname, given, text))
        return wholes, names

    def search_terms(self):
        out = []
        for text, _ in self.terms:
            if text not in out:
                out.append(text)
        if self.person:
            for text, kind in self.terms:
                if kind == "file_code":
                    continue
                surname = _parse_name(text)[0]
                original = next((w for w in re.split(r"[\s,]+", text) if _fold(w).replace(" ", "") == surname), None)
                if original and original not in out:
                    out.append(original)
        return out


def _given_agrees(query_given, givens):
    """True when the request names no given name, the participant has none on
    record, or one on record agrees (in full, or by initial where either side
    is an initial). A term with no given name never vouches for a wrong one."""
    if not query_given or not givens:
        return True
    for given in givens:
        if len(query_given) == 1 or len(given) == 1:
            if query_given[0] == given[0]:
                return True
        elif query_given == given:
            return True
    return False


def _load(con):
    people = {}

    def get(key, factory):
        if key not in people:
            people[key] = factory()
        return people[key]

    party_roles = {}
    for party_id, role in con.execute("SELECT party_id, role FROM proceeding_parties ORDER BY role"):
        party_roles.setdefault(party_id, [])
        if role not in party_roles[party_id]:
            party_roles[party_id].append(role)

    party_names, counsel_of = {}, {}
    for party_id, name, party_type, lawyer in con.execute(
            "SELECT party_id, name, party_type, lawyer_name FROM parties ORDER BY party_id"):
        party_names[party_id] = name
        roles = party_roles.get(party_id) or []
        get(("party", party_id), lambda: _Participant(
            "party", party_id, name, party_type in (None, "individual"),
            capacity=", ".join(roles) or None))
        counsel_of.setdefault(party_id, [])
        if lawyer and lawyer.strip():
            counsel_of[party_id].append(lawyer.strip())
    for party_id, lawyer in con.execute(
            "SELECT party_id, lawyer_name FROM proceeding_parties "
            "WHERE lawyer_name IS NOT NULL AND trim(lawyer_name) <> '' ORDER BY proceeding_id"):
        if lawyer.strip() not in counsel_of.setdefault(party_id, []):
            counsel_of[party_id].append(lawyer.strip())

    counsel_key = {}
    for party_id in sorted(counsel_of):
        for lawyer in counsel_of[party_id]:
            key = ("counsel", _fold(lawyer))
            c = get(key, lambda: _Participant("counsel", party_id, lawyer, True, party_ids=[]))
            if party_id not in c.party_ids:
                c.party_ids.append(party_id)
            counsel_key.setdefault(party_id, []).append(key)
    for key in [k for k in people if k[0] == "counsel"]:
        c = people[key]
        c.capacity = "counsel for " + ", ".join(party_names[p] for p in c.party_ids)

    for wid, name, wtype, field in con.execute(
            "SELECT witness_id, name, witness_type, field_of_expertise FROM witnesses ORDER BY witness_id"):
        role = "expert" if wtype == "expert" else "witness"
        get(("witness", wid), lambda: _Participant(role, wid, name, True, capacity=field))

    for tid, name, capacity, body in con.execute(
            "SELECT tribunal_member_id, name, capacity, tribunal_body FROM tribunal_members "
            "ORDER BY tribunal_member_id"):
        get(("tribunal", tid), lambda: _Participant("tribunal", tid, name, True, capacity=capacity, body=body))

    for party_id, of_counsel, wid, tid, alias, kind in con.execute(
            "SELECT party_id, of_counsel, witness_id, tribunal_member_id, alias_text, alias_kind "
            "FROM participant_aliases ORDER BY alias_id"):
        if party_id is not None and of_counsel:
            keys = counsel_key.get(party_id) or []
        elif party_id is not None:
            keys = [("party", party_id)]
        elif wid is not None:
            keys = [("witness", wid)]
        else:
            keys = [("tribunal", tid)]
        for key in keys:
            if key in people:
                people[key].add(alias, kind)
    return list(people.values())


def _match(participant, query):
    """(match, matched_text, distance) or None."""
    q_whole = _fold(query)
    q_compact = q_whole.replace(" ", "")
    code = _split_code(query)
    q_surname, q_given = code if code else _parse_name(query)
    wholes, names = participant.keys()
    givens = {given for _, given, _ in names if given}
    if participant.person and not _given_agrees(q_given, givens):
        return None

    for form in (q_whole, q_compact):
        if form and form in wholes:
            return "exact", wholes[form], None
    if participant.person and q_surname:
        for surname, _, text in names:
            if surname == q_surname:
                return "exact", text, None
        best = None
        for surname, _, text in names:
            shorter = min(len(surname), len(q_surname))
            if shorter < _MIN_FUZZ_LEN:
                continue
            d = _levenshtein(surname, q_surname)
            if d <= _MAX_DISTANCE and 2 * d < shorter and (best is None or d < best[2]):
                best = ("near", text, d)
        return best
    if not participant.person and q_whole:
        for word in q_whole.split():
            if len(word) >= _MIN_FUZZ_LEN and any(word in w.split() for w in wholes):
                return "exact", participant.name, None
    return None


def _resolve(con, query):
    behind = _behind(con)
    if behind:
        return behind
    matches = []
    for p in _load(con):
        hit = _match(p, query)
        if not hit:
            continue
        entry = {"role": p.role, "id": p.id, "name": p.name, "capacity": p.capacity, "body": p.body}
        if p.role == "counsel":
            entry["party_ids"] = list(p.party_ids)
        entry.update({"match": hit[0], "matched": hit[1]})
        if hit[0] == "near":
            entry["distance"] = hit[2]
        entry["search_terms"] = p.search_terms()
        matches.append(entry)
    if not matches:
        return {"status": "not_found", "query": query,
                "reason": f"no participant on record matches {query!r}, exactly or near"}
    matches.sort(key=lambda m: (m["match"] != "exact", m.get("distance", 0),
                                _ROLE_ORDER[m["role"]], m["name"].casefold()))
    return {"status": "ok", "query": query, "matches": matches}


def run(request):
    """One JSON request in, one JSON-serializable result out.

    request = {"case_data_dir": str, "name": str}
    """
    query = (request.get("name") or "").strip()
    if not _fold(query):
        return {"status": "unavailable", "reason": "no name was given to resolve"}
    case_data_dir = request.get("case_data_dir") or ""
    main = os.path.join(case_data_dir, "main.sqlite")
    if not os.path.isfile(main):
        return {"status": "unavailable", "reason": f"no matter-data database in {case_data_dir}"}
    tmp = tempfile.mkdtemp(prefix=resolve_paths.staging_prefix("participant"))
    try:
        staged = os.path.join(tmp, "main.sqlite")
        shutil.copy2(main, staged)
        con = sqlite3.connect(staged)
        try:
            return _resolve(con, query)
        finally:
            con.close()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: resolve_participant.py <case_data_dir> <name>", file=sys.stderr)
        sys.exit(1)
    print(json.dumps(run({"case_data_dir": sys.argv[1], "name": sys.argv[2]}), indent=2))
