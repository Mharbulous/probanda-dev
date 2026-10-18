"""Unit + golden-output tests for references/scripts/merge_authorities.py.

The script is a pure JSON->(proposal|SQL) function (no DB, no filesystem, no
clock), so every test drives it in-process with dict inputs. Test numbering
follows plan §D5.
"""

import copy
import importlib.util
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "references" / "scripts" / "merge_authorities.py"

spec = importlib.util.spec_from_file_location("merge_authorities", SCRIPT)
ma = importlib.util.module_from_spec(spec)
sys.modules["merge_authorities"] = ma
spec.loader.exec_module(ma)


# --------------------------------------------------------------------------
# Row builders — minimal, keyword-overridable
# --------------------------------------------------------------------------
def auth(aid, **kw):
    row = {"authority_id": aid, "title": None, "citation": None,
           "authority_type": "case_law", "jurisdiction": "BC", "disposition": None,
           "fact_pattern": None, "loss_description": None, "notes": None,
           "file_path": None, "file_hash": None, "cloud_authority_id": None,
           "last_verified_at": None}
    row.update(kw)
    return row


def edge(concept_id, authority_id, **kw):
    row = {"concept_id": concept_id, "authority_id": authority_id,
           "relationship": "establishes", "proposition": None, "finding": None,
           "factual_context": None, "order_terms": None, "obiter": None,
           "treatment": None, "treated_by_authority_id": None, "verified": 0,
           "notes": None}
    row.update(kw)
    return row


def crit(criterion_id, authority_id, treated_by=None):
    return {"criterion_id": criterion_id, "authority_id": authority_id,
            "treated_by_authority_id": treated_by}


def treat(treating, treated, treatment="affirms", **kw):
    row = {"treating_authority_id": treating, "treated_authority_id": treated,
           "treatment": treatment, "scope": None, "notes": None}
    row.update(kw)
    return row


def data(authorities=None, concept_authorities=None, legal_criteria=None,
         authority_treatments=None):
    return {"authorities": authorities or [],
            "concept_authorities": concept_authorities or [],
            "legal_criteria": legal_criteria or [],
            "authority_treatments": authority_treatments or []}


def resolve_agent_checks(prop, decision="merge", resolutions=None):
    """Simulate the agent's perception step + human decision so a proposal can be
    handed to emit_sql."""
    prop = copy.deepcopy(prop)
    prop["checks"]["B4"]["status"] = "pass"
    prop["checks"]["B6"]["status"] = "pass"
    prop["decision"] = decision
    if resolutions:
        prop["resolutions"] = resolutions
    return prop


TRIGGER = data(
    authorities=[
        auth(31, title="Smith v Jones", citation="2020 BCSC 5",
             disposition="appeal dismissed", file_path="a.pdf", file_hash="h1",
             last_verified_at="2026-01-01"),
        auth(47, title="Smith v Jones", citation="2020 BCSC 5, [2020] 3 WWR 100",
             file_path="b.pdf", file_hash="h2", last_verified_at="2026-02-01"),
    ],
    concept_authorities=[
        edge(5, 31, proposition="P5", verified=1),
        edge(6, 31, proposition="P6", verified=1),
        edge(7, 31, proposition="P7", verified=0),
        edge(5, 47, proposition="P5 variant", verified=0),   # collision -> fold
        edge(8, 47, proposition="P8", verified=1),           # D-only -> migrate
    ],
)


class Tokenizer(unittest.TestCase):
    """Test 1 — normalization rules."""

    def test_neutral_and_reporter(self):
        c = ma.normalize_citation("2020 BCSC 5, [2020] 3 WWR 100")
        self.assertIn("2020 bcsc 5", c["neutral"])
        self.assertIn("3 wwr 100", c["reporter"])

    def test_bracket_year_reporter(self):
        c = ma.normalize_citation("[2019] 3 SCR 415")
        self.assertEqual(c["neutral"], set())
        self.assertIn("3 scr 415", c["reporter"])
        self.assertTrue(c["scr"])

    def test_statute_cite(self):
        c = ma.normalize_citation("Limitation Act, SBC 2012, c 13")
        self.assertIn("sbc 2012 c 13", c["statute"])

    def test_no2_retained_in_title(self):
        self.assertNotEqual(ma.normalize_title("Smith v Jones"),
                            ma.normalize_title("Smith v Jones (No. 2)"))
        self.assertIn("no 2", ma.normalize_title("Smith v Jones (No. 2)"))

    def test_style_of_cause_never_matches_a_cite(self):
        # A style-of-cause fragment carries no citation token — set aside naturally.
        c = ma.normalize_citation("R v Smith")
        self.assertEqual(c["neutral"] | c["reporter"] | c["statute"], set())

    def test_bilingual_scr_rcs(self):
        eng = ma.normalize_citation("[2019] 3 SCR 415")
        fr = ma.normalize_citation("[2019] 3 RCS 415")
        self.assertTrue(eng["scr"] and fr["rcs"])


class TriggerCase(unittest.TestCase):
    """Test 2 — the #31/#47 shape end to end + golden SQL fragments."""

    def setUp(self):
        self.proposal = ma.build_proposal(TRIGGER)
        self.p = self.proposal["proposals"][0]

    def test_match_and_election(self):
        self.assertEqual(self.p["match"]["rule"], "N1")
        self.assertEqual(self.p["canonical_id"], 31)   # 3 edges vs 2
        self.assertEqual(self.p["merged_id"], 47)
        self.assertTrue(self.p["autonomously_proposable"])

    def test_all_deterministic_checks_pass(self):
        for k in ("B1", "B2", "B3", "B3b", "B5", "B7", "B8"):
            self.assertEqual(self.p["checks"][k]["status"], "pass", k)
        self.assertEqual(self.p["checks"]["B4"]["status"], "agent_required")
        self.assertEqual(self.p["checks"]["B6"]["status"], "agent_required")

    def test_fold_and_migration(self):
        folds = self.p["edge_folds"]
        self.assertEqual([f["concept_id"] for f in folds], [5])
        self.assertTrue(folds[0]["escalated"])
        self.assertEqual(folds[0]["verified"], 2)
        self.assertEqual([m["concept_id"] for m in self.p["edge_migrations"]], [8])

    def test_citation_union_and_last_verified_max(self):
        self.assertEqual(self.p["field_merge"]["citation"]["action"], "union")
        self.assertEqual(self.p["field_merge"]["last_verified_at"]["value"], "2026-02-01")

    def test_golden_sql_fragments(self):
        approved = resolve_agent_checks(self.p)
        sql = ma.emit_sql({"proposals": [approved]}, "2026-07-20", "Elena")
        self.assertIn(
            "UPDATE law.authorities SET citation = '2020 BCSC 5; 2020 BCSC 5, "
            "[2020] 3 WWR 100', last_verified_at = '2026-02-01', notes = TRIM("
            "COALESCE(notes,'') || ' ' || '[merged from authority #47 2026-07-20 "
            "Elena]') WHERE authority_id = 31;", sql)
        self.assertIn(
            "UPDATE law.concept_authorities SET verified = 2, notes = TRIM("
            "COALESCE(notes,'') || ' ' || '[merged from authority #47 2026-07-20 "
            "Elena] D-values: proposition=P5 variant') WHERE concept_id = 5 AND "
            "authority_id = 31;", sql)
        self.assertIn(
            "UPDATE law.authorities\n  SET notes = '[MERGED-INTO:#31 2026-07-20 "
            "Elena] ' || coalesce(notes, '')\n  WHERE authority_id = 47;", sql)
        # fold DELETE precedes the re-point UPDATE for treatments
        self.assertLess(sql.index("DELETE FROM law.authority_treatments"),
                        sql.index("UPDATE law.authority_treatments SET treating_authority_id = 31"))
        # guards present
        self.assertIn("CREATE TEMP TABLE _assert", sql)
        self.assertIn("DROP TABLE _assert;", sql)


class TreatmentPkCollision(unittest.TestCase):
    """Test 3 — C and D both treat a third authority: fold, DELETE before re-point."""

    def test_fold_detected(self):
        d = data(
            authorities=[auth(1, citation="2020 BCSC 1"), auth(2, citation="2020 BCSC 1"),
                         auth(9, citation="2019 BCCA 9")],
            authority_treatments=[treat(1, 9), treat(2, 9)],  # both treat #9
        )
        prop = ma.build_proposal(d)["proposals"][0]
        # #1 elected (equal downstream -> lower id); #2 merged. Both treat #9 -> fold.
        self.assertEqual(prop["canonical_id"], 1)
        self.assertEqual([f["other"] for f in prop["treatment_folds"]], [9])
        sql = ma.emit_sql({"proposals": [resolve_agent_checks(prop)]}, "2026-07-20", "X")
        self.assertLess(sql.index("DELETE FROM law.authority_treatments WHERE treating_authority_id = 2"),
                        sql.index("UPDATE law.authority_treatments SET treating_authority_id = 1"))


class HardStops(unittest.TestCase):
    """Tests 4 & 5 — B3 / B3b are non-overridable; emit refuses."""

    def test_b3_treatment_link_rejects(self):
        d = data(
            authorities=[auth(1, citation="2020 BCSC 1", file_hash="x"),
                         auth(2, citation="2020 BCSC 1", file_hash="x")],
            authority_treatments=[treat(1, 2, "affirms")],
        )
        out = ma.build_proposal(d)
        self.assertEqual(out["proposals"], [])
        self.assertEqual(len(out["rejected"]), 1)
        self.assertIn("B3", out["rejected"][0]["reason"])

    def test_b3b_treated_by_link_rejects(self):
        d = data(
            authorities=[auth(1, citation="2020 BCSC 1"), auth(2, citation="2020 BCSC 1")],
            concept_authorities=[edge(5, 1, treated_by_authority_id=2)],
        )
        out = ma.build_proposal(d)
        self.assertEqual(out["proposals"], [])
        self.assertIn("B3b", out["rejected"][0]["reason"])

    def test_emit_refuses_a_failed_check(self):
        # Force a proposal object whose B3 failed into emit.
        bad = {"canonical_id": 1, "merged_id": 2, "decision": "merge",
               "checks": {"B3": {"status": "fail"}}, "unresolved_conflicts": [],
               "resolutions": {}, "field_merge": {}, "edge_folds": [],
               "treatment_folds": []}
        with self.assertRaises(ValueError):
            ma.emit_sql({"proposals": [bad]}, "2026-07-20", "X")


class ScalarConflict(unittest.TestCase):
    """Test 6 — both dispositions populated & unequal -> CONFLICT; emit refuses."""

    def setUp(self):
        self.d = data(authorities=[
            auth(1, citation="2020 BCSC 1", disposition="appeal allowed"),
            auth(2, citation="2020 BCSC 1", disposition="appeal dismissed"),
        ])
        self.p = ma.build_proposal(self.d)["proposals"][0]

    def test_conflict_recorded(self):
        # B5 also escalates on differing dispositions.
        self.assertEqual(self.p["checks"]["B5"]["status"], "escalate")
        self.assertIn("disposition", self.p["unresolved_conflicts"])

    def test_emit_refuses_until_resolved(self):
        # Even with B5 forced pass, the field CONFLICT still blocks emit.
        approved = resolve_agent_checks(self.p)
        approved["checks"]["B5"]["status"] = "pass"
        with self.assertRaises(ValueError):
            ma.emit_sql({"proposals": [approved]}, "2026-07-20", "X")
        approved["resolutions"] = {"disposition": "appeal dismissed"}
        sql = ma.emit_sql({"proposals": [approved]}, "2026-07-20", "X")
        self.assertIn("disposition = 'appeal dismissed'", sql)


class VerifiedMatrix(unittest.TestCase):
    """Test 7 — fold verified rules; surviving state never maxed."""

    def test_c_minus1_d_1_becomes_2(self):
        d = data(
            authorities=[auth(1, citation="2020 BCSC 1"), auth(2, citation="2020 BCSC 1")],
            concept_authorities=[edge(5, 1, proposition="P", verified=-1),
                                 edge(5, 2, proposition="P", verified=1)],
        )
        # equal downstream -> #1 canonical. Same text, states -1 vs 1 -> escalate 2.
        fold = ma.build_proposal(d)["proposals"][0]["edge_folds"][0]
        self.assertEqual(fold["verified"], 2)
        self.assertTrue(fold["escalated"])

    def test_c_1_differing_text_keeps_c_appends_d_escalates(self):
        d = data(
            authorities=[auth(1, citation="2020 BCSC 1"), auth(2, citation="2020 BCSC 1")],
            concept_authorities=[edge(5, 1, proposition="C text", verified=1),
                                 edge(5, 2, proposition="D text", verified=1)],
        )
        prop = ma.build_proposal(d)["proposals"][0]
        fold = prop["edge_folds"][0]
        self.assertEqual(fold["columns"]["proposition"]["action"], "keep_c_append_d")
        self.assertEqual(fold["verified"], 2)
        sql = ma.emit_sql({"proposals": [resolve_agent_checks(prop)]}, "2026-07-20", "X")
        # C's text is untouched (not overwritten with D's); D goes to the note.
        self.assertNotIn("proposition = 'D text'", sql)
        self.assertIn("D-values: proposition=D text", sql)

    def test_identical_edges_keep_state(self):
        d = data(
            authorities=[auth(1, citation="2020 BCSC 1"), auth(2, citation="2020 BCSC 1")],
            concept_authorities=[edge(5, 1, proposition="P", verified=1),
                                 edge(5, 2, proposition="P", verified=1)],
        )
        fold = ma.build_proposal(d)["proposals"][0]["edge_folds"][0]
        self.assertEqual(fold["verified"], 1)      # never maxed, never escalated
        self.assertFalse(fold["escalated"])


class N3Weak(unittest.TestCase):
    """Test 8 — title+year only: weak, not autonomously proposable."""

    def test_n3_not_autonomous(self):
        d = data(authorities=[
            auth(1, title="Acme v Beta", citation="[2018] 1 XYZ 10"),
            auth(2, title="Acme v Beta", citation="[2018] 2 XYZ 99"),
        ])
        p = ma.build_proposal(d)["proposals"][0]
        self.assertEqual(p["match"]["rule"], "N3")
        self.assertFalse(p["autonomously_proposable"])
        self.assertEqual(p["checks"]["B4"]["status"], "agent_required")
        self.assertEqual(p["checks"]["B6"]["status"], "agent_required")

    def test_name_only_different_year_no_match(self):
        d = data(authorities=[
            auth(1, title="Acme v Beta", citation="2018 BCSC 1"),
            auth(2, title="Acme v Beta", citation="2019 BCSC 1"),
        ])
        # different neutral cites, different years -> not matched
        self.assertEqual(ma.build_proposal(d)["proposals"], [])


class StatuteRevisions(unittest.TestCase):
    """Test 9 — different statute revisions/years are not duplicates."""

    def test_no_match(self):
        d = data(authorities=[
            auth(1, title="Limitation Act", citation="RSBC 1996, c 266"),
            auth(2, title="Limitation Act", citation="SBC 2012, c 13"),
        ])
        self.assertEqual(ma.build_proposal(d)["proposals"], [])


class TombstoneAndSuppression(unittest.TestCase):
    """Test 10 — tombstones excluded; NOT-DUPLICATE-OF suppresses a pair."""

    def test_tombstone_excluded(self):
        d = data(authorities=[
            auth(1, citation="2020 BCSC 1"),
            auth(2, citation="2020 BCSC 1", notes="[MERGED-INTO:#1 2026-07-01 X] old"),
        ])
        self.assertEqual(ma.build_proposal(d)["proposals"], [])

    def test_not_duplicate_suppresses(self):
        d = data(authorities=[
            auth(1, citation="2020 BCSC 1", notes="[NOT-DUPLICATE-OF:#2]"),
            auth(2, citation="2020 BCSC 1"),
        ])
        self.assertEqual(ma.build_proposal(d)["proposals"], [])


class Determinism(unittest.TestCase):
    """Test 11 — identical input -> identical bytes; emit requires date+operator."""

    def test_plan_is_byte_identical(self):
        a = json.dumps(ma.build_proposal(TRIGGER), sort_keys=True)
        b = json.dumps(ma.build_proposal(TRIGGER), sort_keys=True)
        self.assertEqual(a, b)

    def test_emit_requires_date_and_operator(self):
        approved = resolve_agent_checks(ma.build_proposal(TRIGGER)["proposals"][0])
        with self.assertRaises(ValueError):
            ma.emit_sql({"proposals": [approved]}, None, "X")
        with self.assertRaises(ValueError):
            ma.emit_sql({"proposals": [approved]}, "2026-07-20", None)

    def test_not_duplicate_emit(self):
        prop = ma.build_proposal(TRIGGER)["proposals"][0]
        prop["decision"] = "not_duplicate"
        sql = ma.emit_sql({"proposals": [prop]}, "2026-07-20", "X")
        self.assertIn("[NOT-DUPLICATE-OF:#47]", sql)
        self.assertIn("[NOT-DUPLICATE-OF:#31]", sql)


if __name__ == "__main__":
    unittest.main()
