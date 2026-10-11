#!/usr/bin/env python3
"""Flag unsourced comparative/intensifier glosses in law-side edge text.

Advisory, read-only, stdlib-only, E1 only. Writes nothing and never blocks a push.

The rule: a comparative or intensifier that appears in an edge's `proposition` or
`finding` but NOWHERE in the judgment it cites is a model-added ranking. That is the
shape of the one confirmed defect in this corpus -- an edge said the "stricter 'bound
to fail' standard" where the judgment said only that a "somewhat different" standard
applied and never ranked the two.

Absence is the whole test, so matching is exact-token and deliberately NOT stemmed:
source "strict" vs edge "stricter" is precisely the added ranking we are looking for.

A flag is a tripwire, not a verdict. It cannot see relationship misattribution,
structure miscounts, or paraphrase drift. To act on a flag, route it through
operations/amend-law.md -- this script never mutates.

Usage:
    python3 lint_comparative_gloss.py "<matter_root>" [--concept-id N] [--json]
"""
import argparse, hashlib, json, os, re, shutil, sqlite3, sys, tempfile, unicodedata

from render_document import RenderError, render_rtf_bytes
from resolve_paths import resolve_pointer

BSL = chr(92)
TEXT_EXT = {".doc", ".docx", ".rtf", ".txt", ".htm", ".html", ".pdf"}
MAX_BYTES = 25 * 1024 * 1024

SINGLES = """stricter strictest stronger strongest weaker weakest higher highest lower lowest
broader broadest narrower narrowest heavier heaviest harsher harshest looser loosest tougher
easier harder greater lesser heightened elevated stringent onerous exacting rigorous""".split()
BIGRAMS = ["more stringent", "more onerous", "more demanding", "more exacting", "more rigorous",
           "less stringent", "less onerous", "less demanding", "most stringent",
           "more deferential", "less deferential"]

# Curial usage, not a ranking gloss: "the lower courts", "a higher court". Calibrated on
# the first full L142 run, where 2 of 3 flags were exactly this. A term is only flagged
# when it occurs OUTSIDE these contexts -- so a genuine "lower standard" still flags.
CONTEXT_EXEMPT = {
    "lower": r"(?:court|courts|appellate|tribunal|judge|judges)",
    "higher": r"(?:court|courts|appellate|tribunal|judge|judges|authority)",
}


def norm_tokens(text):
    """Casefolded token set + adjacent-bigram set."""
    t = unicodedata.normalize("NFKC", text or "").casefold()
    toks = re.findall(r"[a-z]+", t)
    return set(toks), {"%s %s" % (a, b) for a, b in zip(toks, toks[1:])}


def _outside_exempt_context(term, text):
    """True if `term` occurs at least once OUTSIDE its curial-usage context.
    'the lower courts' is not a ranking gloss; 'a lower standard' is."""
    follow = CONTEXT_EXEMPT.get(term)
    if not follow:
        return True
    total = len(re.findall(r"\b%s\b" % term, text, re.I))
    exempt = len(re.findall(r"\b%s\s+%s\b" % (term, follow), text, re.I))
    return total > exempt


def extract(path):
    """(text, status). status is None on success."""
    with open(path, "rb") as fh:
        head = fh.read(8)
        fh.seek(0)
        raw = fh.read()
    if head[:5] == b"%PDF-":
        return None, "SOURCE_UNSUPPORTED"          # stdlib cannot extract PDF text reliably
    txt = raw.decode("latin-1", "replace")
    if txt.lstrip()[:5] == "{" + BSL + "rtf":      # Westlaw exports: RTF bytes, .doc extension
        try:
            return render_rtf_bytes(raw)[0], None
        except RenderError:
            return None, "SOURCE_UNREADABLE"       # never search partial text
    txt = raw.decode("utf-8", "replace")
    if head[:1] == b"<" or "<html" in txt[:2000].lower():
        txt = re.sub(r"<[^>]+>", " ", txt)
    return txt, None


def build_hash_index(root):
    idx = {}
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if not d.startswith((".", "~"))]
        for fn in files:
            if fn.startswith((".", "~")) or os.path.splitext(fn)[1].lower() not in TEXT_EXT:
                continue
            p = os.path.join(dirpath, fn)
            try:
                if os.path.getsize(p) > MAX_BYTES: continue
                with open(p, "rb") as fh:
                    idx.setdefault(hashlib.sha256(fh.read()).hexdigest(), p)
            except OSError:
                continue
    return idx


def sha256(path):
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("matter_root")
    ap.add_argument("--concept-id", type=int)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    root = os.path.normpath(a.matter_root)
    case_data_dir = resolve_pointer(root, migrate_only=True)["case_data_dir"]

    stage = tempfile.mkdtemp(prefix="coclerk_lint_")
    try:
        law = os.path.join(stage, "law.sqlite")
        shutil.copy2(os.path.join(case_data_dir, "law.sqlite"), law)
        con = sqlite3.connect(law)
        con.execute("PRAGMA journal_mode = DELETE")
        cols = [r[1] for r in con.execute("PRAGMA table_info(concept_authorities)")]
        if "verified" not in cols:
            sys.exit("law.sqlite predates schema v7.1 (concept_authorities.verified absent) -- run migrate.")

        q = ("SELECT ca.concept_id, ca.authority_id, ca.proposition, ca.finding, "
             "       a.title, a.file_path, a.file_hash "
             "FROM concept_authorities ca JOIN authorities a ON a.authority_id = ca.authority_id "
             "WHERE ca.verified >= 0")
        params = ()
        if a.concept_id:
            q += " AND ca.concept_id = ?"; params = (a.concept_id,)
        rows = con.execute(q, params).fetchall()
        con.close()

        hash_idx, srccache, sources, findings = None, {}, {}, []
        for cid, aid, prop, find, title, fpath, fhash in rows:
            if aid not in srccache:
                resolved, stale, status = None, False, None
                cand = fpath if os.path.isabs(fpath or "") else os.path.join(root, (fpath or "").replace("/", os.sep))
                if fpath and os.path.exists(cand) and fhash and sha256(cand) == fhash:
                    resolved = cand
                elif fhash:
                    if hash_idx is None:
                        hash_idx = build_hash_index(root)
                    if fhash in hash_idx:
                        resolved, stale = hash_idx[fhash], True
                if not resolved:
                    status = "SOURCE_MISSING"
                    srccache[aid] = (None, status)
                else:
                    text, status = extract(resolved)
                    srccache[aid] = ((norm_tokens(text) if text else None), status)
                sources[aid] = {"title": title, "resolved_path": resolved, "path_stale": stale,
                                "status": status or "OK"}
            src, status = srccache[aid]
            if src is None:
                continue                      # absence of evidence is not a gloss finding
            s_tok, s_big = src
            for field, val in (("proposition", prop), ("finding", find)):
                if not val:
                    continue
                e_tok, e_big = norm_tokens(val)
                hits = [w for w in SINGLES if w in e_tok and w not in s_tok
                        and _outside_exempt_context(w, val)]
                hits += [b for b in BIGRAMS if b in e_big and b not in s_big]
                for term in hits:
                    m = re.search(r"[^.]*\b%s\b[^.]*\." % re.escape(term), val, re.I)
                    findings.append({"concept_id": cid, "authority_id": aid, "field": field,
                                     "term": term, "edge_snippet": (m.group(0).strip() if m else val[:160])})

        report = {"edges_examined": len(rows), "authorities": sources, "findings": findings,
                  "summary": {"flagged": len(findings),
                              "sources_stale_path": sum(1 for s in sources.values() if s["path_stale"]),
                              "sources_missing": sum(1 for s in sources.values() if s["status"] == "SOURCE_MISSING"),
                              "sources_unsupported": sum(1 for s in sources.values() if s["status"] == "SOURCE_UNSUPPORTED"),
                              "sources_unreadable": sum(1 for s in sources.values() if s["status"] == "SOURCE_UNREADABLE")}}
        if a.json:
            print(json.dumps(report, indent=1, ensure_ascii=False))
        else:
            s = report["summary"]
            print("edges examined: %d | flagged: %d" % (report["edges_examined"], s["flagged"]))
            print("sources: %d | stale path (hash-rescued): %d | missing: %d | unsupported(PDF): %d | unreadable(RTF): %d"
                  % (len(sources), s["sources_stale_path"], s["sources_missing"], s["sources_unsupported"],
                     s["sources_unreadable"]))
            for f in findings:
                print("\n  [concept %s / authority %s] %s -- '%s' NOT IN SOURCE"
                      % (f["concept_id"], f["authority_id"], f["field"], f["term"]))
                print("    %s" % f["edge_snippet"][:200])
    finally:
        shutil.rmtree(stage, ignore_errors=True)


if __name__ == "__main__":
    main()
