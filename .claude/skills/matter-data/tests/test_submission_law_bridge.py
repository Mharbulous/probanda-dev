"""Tests for references/scripts/submission_law_bridge.py — the retired-filing
law bridge (operations/ingest-submission-law.md).

The script is a pure JSON->SQL function, so most of this suite is exercised by
running the emitted SQL against an in-memory `law` database built from the
canonical `references/schema.sql` law section. That is deliberate: asserting on
SQL text would pass while the SQL is wrong.
"""

import copy
import importlib.util
import json
import sqlite3
import subprocess
import sys
import unittest
from pathlib import Path


CASE_DATA_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = CASE_DATA_ROOT / "references" / "scripts"
SCHEMA_PATH = CASE_DATA_ROOT / "references" / "schema.sql"
PUSH_STATE_PATH = CASE_DATA_ROOT / "operations" / "push-state.md"

sys.path.insert(0, str(SCRIPTS_DIR))


def _load(name, filename):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS_DIR / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


bridge = _load("submission_law_bridge", "submission_law_bridge.py")
rebuild = _load("case_data_rebuild", "rebuild.py")
hashmod = _load("push_source_hash", "push_source_hash.py")
merge = _load("merge_authorities", "merge_authorities.py")

INGESTED_ON = "2026-09-11"


PAYLOAD = {
    "source": {
        "kind": "submission_retire",
        "filing_id": 12,
        "filing_title": "Application response - production",
        "retired_on": "2026-09-08",
    },
    "jurisdiction": "British Columbia",
    "assertions": [
        {
            "key": "la#41",
            "name": "Relevance threshold for document production",
            "concept_type": "test",
            "description": "A document is producible if it could prove or "
                           "disprove a material fact.",
        },
        {
            "key": "la#42",
            "name": "Proportionality limits production",
            "concept_type": "doctrine",
            "description": "Production is bounded by proportionality.",
        },
    ],
    "authorities": [
        {
            "key": "auth#7", "kind": "case", "title": "Alpha Holdings",
            "citation": "2011 BCSC 1774", "jurisdiction": "British Columbia",
            "disposition": "Application allowed in part",
            "verification": "verified", "treatment": "good_law",
        },
        {
            "key": "auth#9", "kind": "rule",
            "title": "Supreme Court Civil Rules, r. 7-1",
            "citation": "B.C. Reg. 168/2009, r. 7-1",
        },
        {
            "key": "auth#11", "kind": "doctrine", "title": "Proportionality",
            "citation": "Doctrine: proportionality in production",
        },
    ],
    "statements": [
        {
            "key": "sol#88", "assertion_key": "la#41", "authority_key": "auth#7",
            "relationship": "establishes",
            "proposition": "Relevance is measured against the pleadings.",
            "pinpoint": "para 31",
            "excerpt": "The test is whether the document may prove or disprove "
                       "a material fact.",
            "verification": "verified", "treatment": "good_law", "doubt": None,
        },
        {
            "key": "sol#89", "assertion_key": "la#41", "authority_key": "auth#9",
            "relationship": "applies",
            "proposition": "Rule 7-1 states the listing obligation.",
            "pinpoint": "r. 7-1(1)",
            "verification": None, "treatment": "distinguishable",
        },
        {
            "key": "sol#90", "assertion_key": "la#42", "authority_key": "auth#11",
            "relationship": "establishes",
            "proposition": "Proportionality narrows the listing obligation.",
            "verification": "verified",
            "doubt": "The drafter was unsure this survives the 2020 amendment.",
        },
    ],
    "opposing_authorities": [
        {
            "key": "opp#3", "kind": "case", "title": "Beta Logistics",
            "citation": "2010 BCSC 1391",
            "proposition": "Relied on for a broader production obligation.",
            "pinpoint": "para 17",
            "answers_assertion_keys": ["la#41"],
        },
        {
            "key": "opp#4", "kind": "case", "title": "Gamma Freight",
            "citation": "2009 BCCA 220",
            "proposition": "Cited by the other side; never tied to an assertion.",
            "answers_assertion_keys": [],
        },
    ],
    "oral_decision": {
        "court": "BCSC",
        "file_number": "S-231456",
        "judge": "Master Harper",
        "decided_on": "2026-08-14",
        "disposition": "Application dismissed",
        "treatments": [
            {"authority_key": "auth#7", "treatment": "follows"},
            {"authority_key": "opp#3", "treatment": "declines_to_follow",
             "scope": "partial"},
        ],
    },
}


def law_connection():
    """An in-memory database with the canonical law schema attached as `law`,
    which is how the emitted SQL addresses it."""
    sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
    con = sqlite3.connect(":memory:")
    con.execute("ATTACH DATABASE ':memory:' AS law")
    con.executescript(
        sections["law"].replace("CREATE TABLE ", "CREATE TABLE law.")
                       .replace("CREATE INDEX ", "CREATE INDEX law."))
    return con


def apply_payload(con, payload, ingested_on=INGESTED_ON):
    sql = bridge.emit_sql(bridge.build_plan(payload, ingested_on))
    con.executescript(sql)
    con.commit()
    return sql


def concept_hash(con, concept_id):
    """The canonical push-source hash, over exactly the fields push-state.md's
    serializer selects — which is what proves pinpoint/excerpt stay out of it."""
    name, description = con.execute(
        "SELECT name, description FROM law.legal_concepts WHERE concept_id = ?",
        (concept_id,)).fetchone()
    criteria = con.execute(
        "SELECT criterion_order, requirement_type, criterion_description, "
        "       burden_of_proof, in_force_date, repeal_date "
        "FROM law.legal_criteria WHERE concept_id = ? ORDER BY criterion_order",
        (concept_id,)).fetchall()
    edges = con.execute(
        "SELECT authority_id, relationship, proposition, finding, obiter, treatment "
        "FROM law.concept_authorities WHERE concept_id = ? AND verified >= 0 "
        "AND relationship != 'answered' "
        "ORDER BY authority_id", (concept_id,)).fetchall()
    return hashmod.push_source_hash({
        "name": name or "", "description": description or "",
        "criteria": [{"order": c[0], "requirement_type": c[1],
                      "description": c[2] or "", "burden_of_proof": c[3],
                      "in_force_date": c[4], "repeal_date": c[5]} for c in criteria],
        "edges": [{"authority_id": e[0], "relationship": e[1],
                   "proposition": e[2] or "", "finding": e[3] or "",
                   "obiter": e[4] or "", "treatment": e[5]} for e in edges],
    })


class MappingTests(unittest.TestCase):
    def test_kind_maps_to_authority_type(self):
        con = law_connection()
        try:
            apply_payload(con, PAYLOAD)
            rows = dict(con.execute(
                "SELECT citation, authority_type FROM law.authorities").fetchall())
            self.assertEqual(rows["2011 BCSC 1774"], "case_law")
            self.assertEqual(rows["B.C. Reg. 168/2009, r. 7-1"], "regulation")
            self.assertEqual(rows["Doctrine: proportionality in production"], "other")
        finally:
            con.close()

    def test_an_unknown_kind_is_refused(self):
        payload = copy.deepcopy(PAYLOAD)
        payload["authorities"][0]["kind"] = "podcast"
        with self.assertRaises(bridge.Refused):
            bridge.build_plan(payload, INGESTED_ON)

    def test_only_overruled_becomes_a_past_tense_edge_treatment(self):
        con = law_connection()
        try:
            payload = copy.deepcopy(PAYLOAD)
            payload["statements"][0]["treatment"] = "overruled"
            apply_payload(con, payload)
            rows = dict(con.execute(
                "SELECT a.citation, ca.treatment FROM law.concept_authorities ca "
                "JOIN law.authorities a ON a.authority_id = ca.authority_id"
            ).fetchall())
            self.assertEqual(rows["2011 BCSC 1774"], "overruled")
            # distinguishable is a prospective risk, never a treatment event.
            self.assertIsNone(rows["B.C. Reg. 168/2009, r. 7-1"])
            note = con.execute(
                "SELECT ca.notes FROM law.concept_authorities ca "
                "JOIN law.authorities a ON a.authority_id = ca.authority_id "
                "WHERE a.citation = 'B.C. Reg. 168/2009, r. 7-1'").fetchone()[0]
            self.assertIn("NOTED-UP 2026-09-11 (submission): distinguishable", note)
        finally:
            con.close()

    def test_verification_maps_and_doubt_escalates_to_two(self):
        con = law_connection()
        try:
            apply_payload(con, PAYLOAD)
            rows = dict(con.execute(
                "SELECT a.citation, ca.verified FROM law.concept_authorities ca "
                "JOIN law.authorities a ON a.authority_id = ca.authority_id"
            ).fetchall())
            self.assertEqual(rows["2011 BCSC 1774"], 1)               # verified
            self.assertEqual(rows["B.C. Reg. 168/2009, r. 7-1"], 0)   # not verified
            self.assertEqual(
                rows["Doctrine: proportionality in production"], 2)   # doubt wins
            note = con.execute(
                "SELECT ca.notes FROM law.concept_authorities ca "
                "JOIN law.authorities a ON a.authority_id = ca.authority_id "
                "WHERE a.citation = 'Doctrine: proportionality in production'"
            ).fetchone()[0]
            self.assertIn("NEEDS HUMAN", note)
        finally:
            con.close()

    def test_summary_names_held_back_edges_and_their_remedy(self):
        summary = bridge.summarize(bridge.build_plan(PAYLOAD, INGESTED_ON))
        held = {h["key"] for h in summary["held_back"]}
        self.assertEqual(held, {"sol#89"})  # an answered edge is never held back
        for entry in summary["held_back"]:
            self.assertIn("/verify-law", entry["reason"])
        self.assertEqual([d["key"] for d in summary["doubt"]], ["sol#90"])

    def test_a_dropped_row_is_skipped_and_reported_never_written(self):
        payload = copy.deepcopy(PAYLOAD)
        payload["assertions"].append(
            {"key": "la#99", "name": "Dead end", "dropped": True})
        summary = bridge.summarize(bridge.build_plan(payload, INGESTED_ON))
        self.assertEqual(summary["skipped_dropped"],
                         [{"kind": "assertion", "key": "la#99"}])
        self.assertEqual(summary["counts"]["concepts"], 2)


class OpposingAuthorityTests(unittest.TestCase):
    def test_a_tie_produces_an_answered_edge(self):
        con = law_connection()
        try:
            apply_payload(con, PAYLOAD)
            row = con.execute(
                "SELECT ca.relationship, ca.pinpoint, ca.verified "
                "FROM law.concept_authorities ca "
                "JOIN law.authorities a ON a.authority_id = ca.authority_id "
                "WHERE a.citation = '2010 BCSC 1391'").fetchone()
            # The practitioner's tie is the whole claim, so it lands at 1 (#48).
            self.assertEqual(row, ("answered", "para 17", 1))
        finally:
            con.close()

    def test_a_re_retirement_lifts_a_standing_answered_edge_to_one(self):
        con = law_connection()
        try:
            apply_payload(con, PAYLOAD)
            con.execute("UPDATE law.concept_authorities SET verified = 0 "
                        "WHERE relationship = 'answered'")
            con.commit()
            apply_payload(con, PAYLOAD)
            self.assertEqual(con.execute(
                "SELECT verified FROM law.concept_authorities "
                "WHERE relationship = 'answered'").fetchall(), [(1,)])
        finally:
            con.close()

    def test_an_answered_edge_does_not_gate_its_concept(self):
        con = law_connection()
        try:
            payload = copy.deepcopy(PAYLOAD)
            payload["statements"][1]["verification"] = "verified"
            apply_payload(con, payload)
            gating = con.execute(
                "SELECT count(*) FROM law.concept_authorities ca "
                "JOIN law.legal_concepts c ON c.concept_id = ca.concept_id "
                "WHERE c.name = 'Relevance threshold for document production' "
                "AND ca.verified IN (0, 2)").fetchone()[0]
            self.assertEqual(gating, 0)
        finally:
            con.close()

    def test_an_answered_edge_is_excluded_from_the_push_source_hash(self):
        untied = copy.deepcopy(PAYLOAD)
        untied["opposing_authorities"][0]["answers_assertion_keys"] = []
        edited = copy.deepcopy(PAYLOAD)
        edited["opposing_authorities"][0]["proposition"] = "A different characterization."
        name = "Relevance threshold for document production"
        hashes = []
        for payload in (PAYLOAD, untied, edited):
            con = law_connection()
            try:
                apply_payload(con, payload)
                cid = con.execute("SELECT concept_id FROM law.legal_concepts "
                                  "WHERE name = ?", (name,)).fetchone()[0]
                hashes.append(concept_hash(con, cid))
            finally:
                con.close()
        self.assertEqual(len(set(hashes)), 1)

    def test_push_state_filters_answered_edges_from_serializer_and_payload(self):
        text = PUSH_STATE_PATH.read_text(encoding="utf-8")
        serializer = text.split("def push_source_hash(", 1)[1].split("```", 1)[0]
        queue = text.split("def push_queue(", 1)[1].split("```", 1)[0]
        self.assertIn("relationship != 'answered'", serializer)
        self.assertIn("relationship != 'answered'", queue)

    def test_a_statement_cannot_claim_the_answered_relationship(self):
        payload = copy.deepcopy(PAYLOAD)
        payload["statements"][0]["relationship"] = "answered"
        with self.assertRaises(bridge.Refused):
            bridge.build_plan(payload, INGESTED_ON)

    def test_an_untied_opposing_authority_produces_no_edge(self):
        con = law_connection()
        try:
            apply_payload(con, PAYLOAD)
            self.assertIsNotNone(con.execute(
                "SELECT 1 FROM law.authorities WHERE citation = '2009 BCCA 220'"
            ).fetchone())
            self.assertEqual(con.execute(
                "SELECT count(*) FROM law.concept_authorities ca "
                "JOIN law.authorities a ON a.authority_id = ca.authority_id "
                "WHERE a.citation = '2009 BCCA 220'").fetchone()[0], 0)
        finally:
            con.close()


class OralReasonsTests(unittest.TestCase):
    def test_citation_shape_carries_no_style_of_cause(self):
        citation = bridge.oral_citation(PAYLOAD["oral_decision"])
        self.assertEqual(
            citation, "Oral reasons, BCSC S-231456, Master Harper, 2026-08-14")
        self.assertNotRegex(citation, r"\sv\.?\s")

    def test_a_style_of_cause_particle_is_refused(self):
        for field, value in (("judge", "Smith v. Jones J."),
                             ("court", "BCSC v. Someone"),
                             ("file_number", "Alpha v Beta")):
            payload = copy.deepcopy(PAYLOAD)
            payload["oral_decision"][field] = value
            with self.subTest(field=field):
                with self.assertRaises(bridge.Refused) as ctx:
                    bridge.build_plan(payload, INGESTED_ON)
                self.assertIn("style-of-cause", str(ctx.exception))

    def test_oral_row_gets_treatments_and_never_an_edge(self):
        con = law_connection()
        try:
            apply_payload(con, PAYLOAD)
            oral_id, kind = con.execute(
                "SELECT authority_id, authority_type FROM law.authorities "
                "WHERE authority_type = 'oral_reasons'").fetchone()
            self.assertEqual(kind, "oral_reasons")
            self.assertEqual(con.execute(
                "SELECT count(*) FROM law.concept_authorities WHERE authority_id = ?",
                (oral_id,)).fetchone()[0], 0)
            self.assertEqual(sorted(con.execute(
                "SELECT treatment, scope FROM law.authority_treatments "
                "WHERE treating_authority_id = ?", (oral_id,)).fetchall()),
                [("declines_to_follow", "partial"), ("follows", None)])
        finally:
            con.close()

    def test_an_unknown_oral_treatment_is_refused(self):
        payload = copy.deepcopy(PAYLOAD)
        payload["oral_decision"]["treatments"][0]["treatment"] = "overrules"
        with self.assertRaises(bridge.Refused):
            bridge.build_plan(payload, INGESTED_ON)


class IdempotenceTests(unittest.TestCase):
    def test_emitted_sql_is_byte_identical_for_identical_input(self):
        first = bridge.emit_sql(bridge.build_plan(PAYLOAD, INGESTED_ON))
        second = bridge.emit_sql(bridge.build_plan(copy.deepcopy(PAYLOAD), INGESTED_ON))
        self.assertEqual(first, second)

    def test_a_re_run_writes_no_duplicate_rows_and_no_stacked_notes(self):
        con = law_connection()
        try:
            apply_payload(con, PAYLOAD)
            snapshot = {
                t: con.execute("SELECT * FROM law." + t).fetchall()
                for t in ("legal_concepts", "authorities", "concept_authorities",
                          "authority_treatments")
            }
            apply_payload(con, PAYLOAD)
            for table, rows in snapshot.items():
                with self.subTest(table=table):
                    self.assertEqual(
                        con.execute("SELECT * FROM law." + table).fetchall(), rows)
        finally:
            con.close()

    def test_the_push_source_hash_is_unchanged_by_a_re_run(self):
        con = law_connection()
        try:
            apply_payload(con, PAYLOAD)
            cid = con.execute(
                "SELECT concept_id FROM law.legal_concepts "
                "WHERE name = 'Relevance threshold for document production'"
            ).fetchone()[0]
            before = concept_hash(con, cid)
            apply_payload(con, PAYLOAD)
            self.assertEqual(concept_hash(con, cid), before)
        finally:
            con.close()

    def test_the_push_source_hash_changes_when_crossing_content_changes(self):
        con = law_connection()
        try:
            apply_payload(con, PAYLOAD)
            cid = con.execute(
                "SELECT concept_id FROM law.legal_concepts "
                "WHERE name = 'Relevance threshold for document production'"
            ).fetchone()[0]
            before = concept_hash(con, cid)
            edited = copy.deepcopy(PAYLOAD)
            edited["statements"][0]["proposition"] = "Relevance is measured differently."
            apply_payload(con, edited)
            self.assertNotEqual(concept_hash(con, cid), before)
        finally:
            con.close()

    def test_pinpoint_and_excerpt_are_excluded_from_the_push_source_hash(self):
        con = law_connection()
        try:
            apply_payload(con, PAYLOAD)
            cid = con.execute(
                "SELECT concept_id FROM law.legal_concepts "
                "WHERE name = 'Relevance threshold for document production'"
            ).fetchone()[0]
            before = concept_hash(con, cid)
            edited = copy.deepcopy(PAYLOAD)
            edited["statements"][0]["pinpoint"] = "paras 31-33"
            edited["statements"][0]["excerpt"] = "A different quoted passage."
            apply_payload(con, edited)
            self.assertEqual(
                con.execute(
                    "SELECT pinpoint FROM law.concept_authorities ca "
                    "JOIN law.authorities a ON a.authority_id = ca.authority_id "
                    "WHERE a.citation = '2011 BCSC 1774'").fetchone()[0],
                "paras 31-33")
            self.assertEqual(concept_hash(con, cid), before)
        finally:
            con.close()

    def test_push_state_never_returns_pinpoint_or_excerpt(self):
        """The exclusion is a documented read-boundary rule, not only a habit of
        the serializer — push-state.md must name both on its never-return list
        and must not select either in the push-queue authorities join."""
        text = PUSH_STATE_PATH.read_text(encoding="utf-8")
        never_return = text.split("**Never return**", 1)[1].split("\n\n", 1)[0]
        self.assertIn("`pinpoint`", never_return)
        self.assertIn("`excerpt`", never_return)
        serializer = text.split("def push_source_hash(", 1)[1].split("```", 1)[0]
        self.assertNotIn("pinpoint", serializer)
        self.assertNotIn("excerpt", serializer)

    def test_a_re_run_never_touches_an_edge_at_verified_two_or_minus_one(self):
        con = law_connection()
        try:
            apply_payload(con, PAYLOAD)
            con.execute(
                "UPDATE law.concept_authorities SET verified = -1, "
                "proposition = 'rejected by a human' "
                "WHERE authority_id = (SELECT authority_id FROM law.authorities "
                "                      WHERE citation = 'B.C. Reg. 168/2009, r. 7-1')")
            con.commit()
            apply_payload(con, PAYLOAD)
            self.assertEqual(con.execute(
                "SELECT verified, proposition FROM law.concept_authorities ca "
                "JOIN law.authorities a ON a.authority_id = ca.authority_id "
                "WHERE a.citation = 'B.C. Reg. 168/2009, r. 7-1'").fetchone(),
                (-1, "rejected by a human"))
            # The doubt edge was written at 2 and stays exactly as written.
            self.assertEqual(con.execute(
                "SELECT verified FROM law.concept_authorities ca "
                "JOIN law.authorities a ON a.authority_id = ca.authority_id "
                "WHERE a.citation = 'Doctrine: proportionality in production'"
            ).fetchone()[0], 2)
        finally:
            con.close()

    def test_a_pre_existing_row_without_the_bridge_marker_is_never_rewritten(self):
        con = law_connection()
        try:
            con.executescript(
                "INSERT INTO law.legal_concepts (name, concept_type, description, "
                "jurisdiction, notes) VALUES "
                "('Relevance threshold for document production', 'test', "
                " 'A practitioner wrote this description.', 'British Columbia', NULL);"
                "INSERT INTO law.authorities (title, citation, authority_type, notes) "
                "VALUES ('Alpha Holdings (existing row)', '2011 BCSC 1774', "
                "        'case_law', NULL);")
            con.commit()
            apply_payload(con, PAYLOAD)
            self.assertEqual(con.execute(
                "SELECT description FROM law.legal_concepts "
                "WHERE name = 'Relevance threshold for document production'"
            ).fetchone()[0], "A practitioner wrote this description.")
            self.assertEqual(con.execute(
                "SELECT count(*), min(title) FROM law.authorities "
                "WHERE citation = '2011 BCSC 1774'").fetchone(),
                (1, "Alpha Holdings (existing row)"))
        finally:
            con.close()


class RefusalTests(unittest.TestCase):
    def test_a_wrong_source_kind_is_refused(self):
        payload = copy.deepcopy(PAYLOAD)
        payload["source"]["kind"] = "something_else"
        with self.assertRaises(bridge.Refused):
            bridge.build_plan(payload, INGESTED_ON)

    def test_the_ingested_on_date_is_required_and_never_derived(self):
        for bad in (None, "", "2026/09/11", "today"):
            with self.subTest(value=bad):
                with self.assertRaises(bridge.Refused):
                    bridge.build_plan(PAYLOAD, bad)

    def test_a_retired_relationship_is_refused(self):
        payload = copy.deepcopy(PAYLOAD)
        payload["statements"][2]["relationship"] = "refines"
        with self.assertRaises(bridge.Refused) as ctx:
            bridge.build_plan(payload, INGESTED_ON)
        self.assertIn("relationship 'refines' is not one of", str(ctx.exception))

    def test_two_rows_targeting_one_edge_are_refused(self):
        payload = copy.deepcopy(PAYLOAD)
        payload["statements"].append(dict(payload["statements"][0], key="sol#91"))
        with self.assertRaises(bridge.Refused):
            bridge.build_plan(payload, INGESTED_ON)

    def test_cli_refusal_exits_two_and_says_why(self):
        payload = copy.deepcopy(PAYLOAD)
        payload["source"]["kind"] = "nope"
        result = subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / "submission_law_bridge.py"),
             "--emit-sql", "--ingested-on", INGESTED_ON],
            input=json.dumps(payload), capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertIn("REFUSED:", result.stderr)
        self.assertEqual(result.stdout, "")


class MergeHardStopTests(unittest.TestCase):
    """B9 — an oral_reasons row never merges (CLAUDE.md #46)."""

    @staticmethod
    def _rows(second_type):
        return {
            "authorities": [
                {"authority_id": 1,
                 "title": "Oral reasons, BCSC S-231456, Master Harper, 2026-08-14",
                 "citation": "Oral reasons, BCSC S-231456, Master Harper, 2026-08-14",
                 "authority_type": "oral_reasons"},
                {"authority_id": 2,
                 "title": "Oral reasons, BCSC S-231456, Master Harper, 2026-08-14",
                 "citation": "Oral reasons, BCSC S-231456, Master Harper, 2026-08-14",
                 "authority_type": second_type},
            ],
            "concept_authorities": [], "legal_criteria": [],
            "authority_treatments": [],
        }

    def test_two_oral_rows_hard_stop(self):
        proposal = merge.build_proposal(self._rows("oral_reasons"), (1, 2))
        self.assertEqual(proposal["proposals"], [])
        self.assertTrue(proposal["rejected"])
        self.assertIn("B9:", proposal["rejected"][0]["reason"])

    def test_an_oral_row_against_a_reported_decision_hard_stops(self):
        proposal = merge.build_proposal(self._rows("case_law"), (1, 2))
        self.assertEqual(proposal["proposals"], [])
        self.assertIn("B9:", proposal["rejected"][0]["reason"])

    def test_two_ordinary_rows_still_pass_b9(self):
        rows = self._rows("case_law")
        rows["authorities"][0]["authority_type"] = "case_law"
        rows["authorities"][0]["citation"] = "2011 BCSC 1774"
        rows["authorities"][1]["citation"] = "2011 BCSC 1774"
        rows["authorities"][0]["title"] = "Alpha Holdings"
        rows["authorities"][1]["title"] = "Alpha Holdings"
        proposal = merge.build_proposal(rows, (1, 2))
        self.assertEqual(len(proposal["proposals"]), 1)
        self.assertEqual(proposal["proposals"][0]["checks"]["B9"]["status"], "pass")


if __name__ == "__main__":
    unittest.main()
