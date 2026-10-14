"""supersede-draft (operations/supersede-draft.md): the candidate pass, rank, the fold
plan and the emitted SQL, run against synthetic temp databases shaped like a court
file holding an unsigned draft and the filed copy of one affidavit."""

import importlib.util
import json
import re
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


CASE_DATA_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = CASE_DATA_ROOT / "references" / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))
SCHEMA_PATH = CASE_DATA_ROOT / "references" / "schema.sql"
TRIGGERS_PATH = CASE_DATA_ROOT / "references" / "triggers.sql"
CONVENTIONS_PATH = CASE_DATA_ROOT / "shared" / "conventions.md"
OPERATION_PATH = CASE_DATA_ROOT / "operations" / "supersede-draft.md"

spec = importlib.util.spec_from_file_location("case_data_rebuild", SCRIPTS_DIR / "rebuild.py")
rebuild = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rebuild)

MATTER_ROOT = r"C:\Users\Test\Litigation - Documents\L9000 Test Matter"
FOLDER = "5. COURT FILE#S-1"
S_PATH = FOLDER + r"\2024-04-20 AFF Smith DRAFT.pdf"
K_PATH = FOLDER + r"\2024-05-02 AFF Smith FILED.pdf"
S_HASH, K_HASH, R_HASH = "a" * 64, "b" * 64, "c" * 64
DATE, APPROVER = "2026-10-05", "practitioner"
S_NOTE = "DISCREPANCY: possible duplicate of source #34."


def fenced(path, lang, needle):
    text = path.read_text(encoding="utf-8")
    for body in re.findall(r"```" + lang + r"\n(.*?)```", text, re.S):
        if needle in body:
            return body
    raise AssertionError(f"no ```{lang} block containing {needle!r} in {path.name}")


def load_functions():
    namespace = {}
    exec(fenced(CONVENTIONS_PATH, "python", "def stored_form("), namespace)
    for needle in ("def candidates(", "def rank(", "def fold_plan(", "def emit_sql("):
        exec(fenced(OPERATION_PATH, "python", needle), namespace)
    return namespace


FN = load_functions()


def refusal(condition):
    """The message a guard's named CHECK raises."""
    return "^CHECK constraint failed: " + re.escape(condition) + "$"


def registered(source_id, name, proceeding=1, notes=None, folder=FOLDER):
    return {"source_id": source_id, "proceeding_id": proceeding, "title": name,
            "file_path": f"{folder}\\{name}", "notes": notes}


class CandidateTests(unittest.TestCase):
    def pairs(self, newcomers, rows, pages=None, scan=FOLDER):
        return FN["candidates"]([{"path": p, "hash": "h"} for p in newcomers], rows,
                                pages or {}, scan, MATTER_ROOT)

    def test_the_title_stem_drops_dates_and_version_tokens(self):
        stem = FN["title_stem"]
        self.assertEqual(stem(S_PATH), "aff smith")
        self.assertEqual(stem(r"x\20240502_AFF_Smith_(FILED).PDF"), "aff smith")
        self.assertEqual(stem("2024-05-02 AFF Smith SIGNED unfiled.pdf"), "aff smith")
        self.assertEqual(stem("2024-05-02 AFF Jones FILED.pdf"), "aff jones")

    def test_the_title_stem_drops_unsigned_and_executed_as_whole_words(self):
        stem = FN["title_stem"]
        self.assertEqual(stem("2024-04-20 AFF Smith (unsigned).pdf"), "aff smith")
        self.assertEqual(stem("2024-05-01 AFF Smith executed.pdf"), "aff smith")
        self.assertEqual(stem("AFF Smith Unsigned Draft.pdf"), "aff smith")
        self.assertEqual(stem("AFF Smith cosigned.pdf"), "aff smith cosigned")

    def test_two_newcomers_in_one_court_folder_pair(self):
        pages = {S_PATH: 10, K_PATH: 12}
        self.assertEqual(self.pairs([S_PATH, K_PATH], [], pages), [{"newcomers": [S_PATH, K_PATH]}])
        cases = {
            "another court folder": r"5. COURT FILE#S-2\2024-05-02 AFF Smith FILED.pdf",
            "not a court folder": r"3. CORRESPONDENCE\2024-05-02 AFF Smith FILED.pdf",
            "another title": FOLDER + r"\2024-05-02 AFF Jones FILED.pdf",
        }
        for label, other in cases.items():
            with self.subTest(label):
                self.assertEqual(self.pairs([S_PATH, other], [], pages), [])
        with self.subTest("three pages apart"):
            self.assertEqual(self.pairs([S_PATH, K_PATH], [], {S_PATH: 10, K_PATH: 13}), [])

    def test_a_newcomer_pairs_with_both_another_newcomer_and_a_registered_copy(self):
        signed = FOLDER + r"\2024-04-30 AFF Smith SIGNED.pdf"
        row = registered(20, "2024-04-20 AFF Smith DRAFT.pdf")
        self.assertEqual(self.pairs([signed, K_PATH], [row]),
                         [{"newcomer": signed, "source_id": 20}, {"newcomer": K_PATH, "source_id": 20},
                          {"newcomers": [signed, K_PATH]}])

    def test_a_newcomer_pairs_with_a_registered_copy_in_its_court_folder(self):
        pages = {K_PATH: 12, S_PATH: 10}
        self.assertEqual(self.pairs([K_PATH], [registered(20, S_PATH.split("\\")[1])], pages),
                         [{"newcomer": K_PATH, "source_id": 20}])

    def test_each_newcomer_exclusion(self):
        row = registered(20, "2024-04-20 AFF Smith DRAFT.pdf")
        cases = {
            "another court folder": [r"5. COURT FILE#S-2\2024-05-02 AFF Smith FILED.pdf"],
            "not a court folder": [r"3. CORRESPONDENCE\2024-05-02 AFF Smith FILED.pdf"],
            "another title": [FOLDER + r"\2024-05-02 AFF Jones FILED.pdf"],
            "three pages apart": [K_PATH],
        }
        for label, newcomers in cases.items():
            with self.subTest(label):
                self.assertEqual(self.pairs(newcomers, [row], {K_PATH: 13, S_PATH: 10}), [])

    def test_the_page_test_is_skipped_for_a_file_that_is_not_a_pdf_or_has_no_count(self):
        row = registered(20, "2024-04-20 AFF Smith DRAFT.pdf")
        docx = FOLDER + r"\2024-05-02 AFF Smith FILED.docx"
        self.assertEqual(len(self.pairs([docx], [row], {docx: 40, S_PATH: 10})), 1)
        self.assertEqual(len(self.pairs([K_PATH], [row], {K_PATH: None, S_PATH: 10})), 1)
        self.assertEqual(len(self.pairs([K_PATH], [row], {K_PATH: 12, S_PATH: 10})), 1)

    def test_two_registered_rows_pair_only_in_one_proceeding_and_without_a_marker(self):
        a = registered(30, "2024-05-02 NOCC FILED.pdf")
        b = registered(31, "2024-05-02 NOCC.pdf")
        self.assertEqual(self.pairs([], [a, b]), [{"source_ids": [30, 31]}])
        cases = {
            "another proceeding": dict(b, proceeding_id=2),
            "no proceeding": dict(b, proceeding_id=None),
            "already judged different": dict(b, notes=f"x\n[NOT-VERSION-OF:#30 {DATE} strict-test]"),
            "already superseded": dict(b, notes=f"[SUPERSEDED-BY:#30 {DATE} practitioner]"),
        }
        for label, other in cases.items():
            with self.subTest(label):
                self.assertEqual(self.pairs([], [a, other]), [])
        third = dict(b, notes=f"[NOT-VERSION-OF:#99 {DATE} strict-test]")
        self.assertEqual(self.pairs([], [a, third]), [{"source_ids": [30, 31]}], "a marker naming a third row")

    def test_a_registered_row_outside_the_scanned_folder_is_not_read(self):
        row = registered(20, "2024-04-20 AFF Smith DRAFT.pdf", folder=r"5. COURT FILE#S-1\Old")
        self.assertEqual(self.pairs([], [row, registered(21, "2024-05-02 AFF Smith.pdf")],
                                    scan=r"5. COURT FILE#S-1\New"), [])

    def test_the_marker_id_is_matched_whole(self):
        a = registered(3, "2024-05-02 NOCC FILED.pdf")
        b = registered(31, "2024-05-02 NOCC.pdf", notes=f"[NOT-VERSION-OF:#34 {DATE} strict-test]")
        self.assertEqual(self.pairs([], [a, b]), [{"source_ids": [3, 31]}])

    # -- same_title: two copies named by hand ---------------------------------

    def copies(self, a, b):
        """The draft and the filed copy of one pair of names, as file names."""
        return f"2024-04-20 {a} DRAFT.pdf", f"2024-05-02 {b} FILED.pdf"

    def every_route(self, a, b, pages=(10, 12)):
        """The pairs `candidates` returns for two names in one court folder, by each of its three routes."""
        draft, filed = (FOLDER + "\\" + name for name in self.copies(a, b))
        count = {draft: pages[0], filed: pages[1]}
        row, other = registered(20, draft.split("\\")[1]), registered(21, filed.split("\\")[1])
        return draft, filed, (self.pairs([draft, filed], [], count), self.pairs([filed], [row], count),
                              self.pairs([], [row, other], count))

    def test_the_title_words_expand_codes_and_drop_filler_words(self):
        words = FN["title_words"]
        self.assertEqual(words("2024-05-02 AFF#1 of Smith re DJ FILED.pdf"),
                         ({1}, {"affidavit", "smith", "default", "judgment"}))
        self.assertEqual(words("2024-05-02 RNOCC.pdf"), (set(), {"response", "civil", "claim"}))
        self.assertEqual(FN["_edits"]("judgment", "judgmetn"), 2)
        self.assertEqual(FN["_edits"]("smith", "smiths"), 1)

    def test_names_differing_by_a_filler_word_a_code_or_a_typo_pair(self):
        cases = {
            "a filler word": ("AFF Smith", "AFF of Smith"),
            "a code": ("REQ DJ", "REQ default judgment"),
            "a typo": ("REQ default judgment", "REQ default judgmetn"),
            "all three": ("AFF Smith DJ", "AFF of Smith default judgmetn"),
        }
        for label, (a, b) in cases.items():
            with self.subTest(label):
                draft, filed, found = self.every_route(a, b)
                self.assertTrue(FN["same_title"](draft, filed))
                self.assertTrue(FN["same_title"](filed, draft))
                self.assertEqual(found, ([{"newcomers": [draft, filed]}], [{"newcomer": filed, "source_id": 20}],
                                         [{"source_ids": [20, 21]}]))
            with self.subTest(label + ", three pages apart"):
                self.assertEqual(self.every_route(a, b, pages=(10, 13))[2], ([], [], []))
            with self.subTest(label + ", another court folder"):
                draft, filed = self.copies(a, b)
                elsewhere = r"5. COURT FILE#S-2" + "\\" + filed
                self.assertEqual(self.pairs([FOLDER + "\\" + draft, elsewhere], []), [])
                self.assertEqual(self.pairs([elsewhere], [registered(20, draft)]), [])

    def test_a_typo_counts_only_in_a_word_of_six_letters_or_more(self):
        draft, filed, found = self.every_route("AFF Smith", "AFF Smyth")
        self.assertFalse(FN["same_title"](draft, filed))
        self.assertEqual(found, ([], [], []))

    def test_names_with_different_numbers_or_unrelated_titles_do_not_pair(self):
        cases = {
            "AFF#1 against AFF#2": ("AFF#1 Smith", "AFF#2 Smith"),
            "a numbered name against an unnumbered one": ("AFF#1 Smith", "AFF Smith"),
            "an unnumbered name against a numbered one": ("AFF Smith", "AFF#1 Smith"),
            "two unrelated documents": ("NOCC", "AFF Smith"),
            "two unrelated documents sharing words": ("REQ default judgment", "NOA default judgment"),
        }
        for label, (a, b) in cases.items():
            with self.subTest(label):
                draft, filed, found = self.every_route(a, b, pages=(10, 10))
                self.assertFalse(FN["same_title"](draft, filed))
                self.assertFalse(FN["same_title"](filed, draft))
                self.assertEqual(found, ([], [], []))


class RankTests(unittest.TestCase):
    def test_filed_over_affirmed_over_draft(self):
        rank = FN["rank"]
        self.assertEqual(rank("draft", "filed")["keep"], "b")
        self.assertEqual(rank("affirmed", "draft"), {"keep": "a", "basis": "affirmed over draft"})
        self.assertEqual(rank("filed", "affirmed")["keep"], "a")

    def test_a_tie_or_an_unclear_status_asks(self):
        rank = FN["rank"]
        self.assertEqual(rank("filed", "filed"), {"keep": "ask", "basis": "tie: both filed"})
        self.assertEqual(rank(None, "draft")["keep"], "ask")


class ClauseTests(unittest.TestCase):
    def test_only_the_possible_duplicate_clause_is_removed(self):
        clear = FN["clear_duplicate_clause"]
        self.assertEqual(clear("DISCREPANCY: possible duplicate of source #31"), (None, False))
        self.assertEqual(clear("DISCREPANCY: Possible duplicate of source #32; registry rejected the filing"),
                         ("DISCREPANCY: registry rejected the filing", False))
        self.assertEqual(clear("DISCREPANCY: Registry stamp reads REJECTED. Possible duplicate of #32 "
                               "(para. 5 identical). Filed copy missing."),
                         ("DISCREPANCY: Registry stamp reads REJECTED. Filed copy missing.", False))
        self.assertEqual(clear("DISCREPANCY: possible duplicate of #31\nLINKAGE-PENDING: x"),
                         ("LINKAGE-PENDING: x", False))
        self.assertEqual(clear("UNCONFIRMED: possible duplicate"), ("UNCONFIRMED: possible duplicate", False))

    def test_a_clause_that_says_more_than_possible_duplicate_leaves_the_note_and_is_reported(self):
        clear = FN["clear_duplicate_clause"]
        for note in ("DISCREPANCY: possible duplicate of #32 and the registry rejected the filing",
                     "DISCREPANCY: rejected filing, possible duplicate of #32\nLINKAGE-PENDING: x",
                     "DISCREPANCY: possible duplicate of source #31; possible duplicate of the draft, unsigned"):
            with self.subTest(note=note):
                self.assertEqual(clear(note), (note, True))


class CourtFile(unittest.TestCase):
    """The filed affidavit #34 (exhibits #40, #41) and its unsigned draft #20
    (exhibits #21, matching #40, and #22, matching nothing), with links of every kind
    on the draft."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.paths = {name: root / f"{name}.sqlite" for name in ("main", "law", "privileged")}
        sections = rebuild.parse_sections(SCHEMA_PATH.read_text(encoding="utf-8"))
        for name, path in self.paths.items():
            con = sqlite3.connect(path)
            try:
                con.executescript(sections[name])
            finally:
                con.close()
        self.con = sqlite3.connect(self.paths["main"])
        self.con.execute("ATTACH DATABASE ? AS law", (str(self.paths["law"]),))
        self.con.execute("ATTACH DATABASE ? AS privileged", (str(self.paths["privileged"]),))
        self.con.execute("PRAGMA foreign_keys = ON")
        self.con.executescript(TRIGGERS_PATH.read_text(encoding="utf-8"))
        self.con.row_factory = sqlite3.Row
        self.seed()

    def tearDown(self):
        self.con.close()
        self.tmp.cleanup()

    def source(self, sid, title, path, file_hash, status=None, parent=None, notes=None, verified=0):
        self.con.execute(
            "INSERT INTO main.sources (source_id, proceeding_id, category, title, file_path, file_hash, "
            "ingestion_status, parent_source_id, notes, verified) VALUES (?, 1, 'court', ?, ?, ?, ?, ?, ?, ?)",
            (sid, title, path, file_hash, status, parent, notes, verified))

    def fact(self, fid, sid, locator, description, verified=0):
        self.con.execute(
            "INSERT INTO main.facts (fact_id, source_id, source_locator, description, verified) "
            "VALUES (?, ?, ?, ?, ?)", (fid, sid, locator, description, verified))

    def seed(self):
        c = self.con
        c.execute("INSERT INTO main.proceedings (proceeding_id, court, file_number) VALUES (1, 'BCSC', 'S-1')")
        c.execute("INSERT INTO main.parties (party_id, name) VALUES (1, 'Plaintiff Ltd'), (2, 'Defendant Inc')")
        c.execute("INSERT INTO law.legal_concepts (concept_id, name, concept_type) VALUES (1, 'Debt', 'cause_of_action')")
        c.execute("INSERT INTO law.legal_criteria (criterion_id, concept_id, criterion_order, criterion_description) "
                  "VALUES (1, 1, 1, 'A debt is owed'), (2, 1, 2, 'Payment was demanded')")
        c.execute("INSERT INTO main.issues (issue_id, title) VALUES (1, 'Was payment demanded?')")
        c.execute("INSERT INTO privileged.privileged_sources (source_id, category, title) "
                  "VALUES (1, 'solicitor_client', 'Client email')")
        self.source(34, "Affidavit #1 of Smith", K_PATH, K_HASH, "complete")
        self.source(40, "Exhibit A", K_PATH, K_HASH, parent=34)
        self.source(41, "Exhibit B", K_PATH, K_HASH, parent=34)
        self.source(20, "Affidavit #1 of Smith", S_PATH, S_HASH, "partial", notes=S_NOTE, verified=2)
        self.source(21, "Exhibit A", S_PATH, S_HASH, parent=20)
        self.source(22, "Exhibit C", S_PATH, S_HASH, parent=20)
        self.source(30, "Response to Civil Claim", FOLDER + r"\RCC.pdf", R_HASH, "complete")
        self.source(50, "Affidavit #1 of Jones", FOLDER + r"\Jones.pdf", "d" * 64, "complete")
        self.fact(160, 34, "para. 2", "Smith is the plaintiff's manager.")
        self.fact(167, 40, "Exhibit A", "The letter of 1 March demanded payment.")
        self.fact(168, 41, "Exhibit B", "The invoice totals $5,000.")
        self.fact(169, 40, "Exhibit A", "Exhibit A is a letter.")
        self.fact(185, 20, "para. 2", "Smith is the plaintiff's manager.", verified=1)
        self.fact(186, 20, "para. 5", "The letter dated 1 March demanded payment.")
        self.fact(187, 20, "para. 6", "the invoice  totals $5,000.")
        self.fact(183, 20, "para. 7", "Smith met the defendant on 3 April.")
        self.fact(188, 20, "para. 8", "A rejected reading.", verified=-1)
        self.fact(190, 21, "Exhibit A", "Exhibit A is a letter.")
        self.fact(191, 21, "Exhibit A", "The letter bears a registry stamp.")
        self.fact(192, 22, "Exhibit C", "Exhibit C is a photograph.")
        c.executescript("""
            INSERT INTO main.positions (position_id, fact_id, party_id, position, source_id, source_locator) VALUES
              (1, 185, 1, 'claim', 20, 'para. 2'), (10, 160, 1, 'claim', 34, 'para. 2'),
              (2, 183, 2, 'deny', 30, 'para. 3'), (3, 186, 2, 'admit', 30, 'para. 4'),
              (4, 187, 1, 'claim', 20, 'para. 6'), (5, 183, 1, 'claim', 20, 'para. 7');
            INSERT INTO main.admissions (admission_id, fact_id, admitting_party_id, admission_kind, source_id,
                                         source_locator) VALUES (1, 186, 2, 'express_pleading', 20, 'para. 5');
            INSERT INTO main.evidence_links (evidence_link_id, source_id, fact_id, strength) VALUES
              (1, 20, 183, 1), (2, 50, 185, 2);
            INSERT INTO main.relief_items (relief_id, source_id, seeking_party_id, description) VALUES
              (1, 20, 1, 'Damages'), (2, 20, 1, 'Costs'), (10, 34, 1, 'damages ');
            INSERT INTO main.relief_positions (relief_position_id, relief_id, party_id, position, source_id,
                                               source_locator) VALUES
              (1, 1, 1, 'seek', 20, 'Part 1'), (2, 2, 1, 'seek', 20, 'Part 2'),
              (3, 1, 2, 'oppose', 30, 'para. 9'), (10, 10, 1, 'seek', 34, 'Part 1');
            INSERT INTO main.sought_orders (sought_order_id, source_id, order_number, order_text) VALUES
              (1, 20, '1', 'Judgment for the debt'), (2, 20, '2', 'Costs'), (10, 34, '1', 'Judgment for the debt');
            INSERT INTO main.criteria_facts (criterion_id, fact_id, relevance) VALUES
              (1, 185, 'supports'), (1, 160, 'supports'), (2, 186, 'supports');
            INSERT INTO main.issue_facts (issue_id, fact_id, relevance) VALUES (1, 185, 'supports');
            INSERT INTO privileged.fact_provenance (fact_id, source_id) VALUES (186, 1);
            INSERT INTO main.source_references (source_reference_id, source_id, reference_type, target_source_id,
                                                description) VALUES
              (1, 20, 'procedural', NULL, 'Sworn before a commissioner'),
              (2, 30, 'paragraph_reference', 20, 'Responds to the affidavit');
            INSERT INTO main.causes_of_action (coa_id, claiming_party_id, name, concept_id, source_id)
              VALUES (1, 1, 'Debt', 1, 20);
            INSERT INTO main.witnesses (witness_id, name, witness_type, report_source_id) VALUES (1, 'Dr X', 'expert', 20);
        """)
        c.commit()

    def execute(self, sql):
        """As case_data__execute runs a script: one transaction, rolled back on any failure."""
        try:
            self.con.executescript("BEGIN;\n" + sql + "\n;\nCOMMIT;")
        except Exception:
            self.con.execute("ROLLBACK")
            raise

    def rows(self, ids):
        probe = fenced(OPERATION_PATH, "sql", "-- supersede-draft pair probe")
        return [dict(r) for r in self.con.execute(probe, (json.dumps(ids),))]

    def one(self, sql, *params):
        return self.con.execute(sql, params).fetchone()


class SupersedeSqlTests(CourtFile):
    """#34 is kept and #20 superseded."""

    def decision(self, **overrides):
        plan = FN["fold_plan"](self.rows([20, 34]), 20, 34)
        judged = {186: 167, 183: None, 191: None}
        facts = plan["auto"] + [{"fact_id": f["fact_id"], "fold_into": judged[f["fact_id"]]}
                                for f in plan["agent_required"]]
        notes = {str(r["id"]): r["notes"] for r in self.rows([20, 34]) if r["kind"] == "source"}
        return {"outcome": "superseded", "superseded": 20, "kept": 34,
                "notes": {k: notes[k] for k in ("20", "34")},
                "execution_status": {"superseded": "draft", "kept": "filed"},
                "children_into": plan["children_into"], "facts": facts,
                "date": DATE, "approver": APPROVER, **overrides}

    def test_the_fold_plan_matches_children_and_exact_facts(self):
        plan = FN["fold_plan"](self.rows([20, 34]), 20, 34)
        self.assertEqual(plan["children_into"], {21: 40})
        self.assertEqual(plan["reparent"], [22])
        self.assertEqual(sorted((a["fact_id"], a["fold_into"]) for a in plan["auto"]),
                         [(185, 160), (187, 168), (190, 169)])
        self.assertEqual(sorted(f["fact_id"] for f in plan["agent_required"]), [183, 186, 191])

    def test_no_fact_is_lost_and_none_is_duplicated_on_the_kept_copy(self):
        self.execute(FN["emit_sql"](self.decision()))
        self.assertIsNone(self.one("SELECT 1 FROM main.facts WHERE source_id IN (20, 21) AND verified >= 0"))
        self.assertEqual(self.one("SELECT source_id, source_locator FROM main.facts WHERE fact_id = 183")[:], (34, "para. 7"))
        self.assertEqual(self.one("SELECT source_id FROM main.facts WHERE fact_id = 191")[0], 40)
        self.assertEqual(self.one("SELECT source_id, verified FROM main.facts WHERE fact_id = 192")[:], (22, 0))
        self.assertEqual(self.one("SELECT source_id, verified FROM main.facts WHERE fact_id = 188")[:], (20, -1))
        dupes = self.one(
            "SELECT count(*) FROM (SELECT lower(trim(description)) d FROM main.facts "
            "WHERE verified >= 0 AND source_id IN (SELECT source_id FROM main.sources "
            "WHERE source_id = 34 OR parent_source_id = 34) GROUP BY d HAVING count(*) > 1)")[0]
        self.assertEqual(dupes, 0)
        self.assertEqual(self.one("SELECT verified FROM main.facts WHERE fact_id = 160")[0], 0,
                         "the kept fact keeps its own verified; S's 1 does not transfer")

    def test_folded_facts_are_retired_with_the_marker(self):
        self.execute(FN["emit_sql"](self.decision()))
        for fact_id, kept in ((185, 160), (186, 167), (187, 168), (190, 169)):
            with self.subTest(fact_id=fact_id):
                row = self.one("SELECT verified, pending_reverification, notes FROM main.facts WHERE fact_id = ?", fact_id)
                self.assertEqual(row[:], (-1, 0, f"[FOLDED-INTO:#{kept} {DATE} {APPROVER}]"))

    def test_every_link_is_re_pointed_and_key_collisions_resolve(self):
        self.execute(FN["emit_sql"](self.decision()))
        positions = {r[0]: r[1:] for r in self.con.execute(
            "SELECT position_id, fact_id, source_id, verified, notes FROM main.positions")}
        self.assertEqual(positions[1], (185, 20, -1, f"[FOLDED-INTO:#10 {DATE} {APPROVER}]"))
        self.assertEqual(positions[2][:2], (183, 30))
        self.assertEqual(positions[3][:3], (167, 30, 0))
        self.assertEqual(positions[4][:3], (168, 34, 0))
        self.assertEqual(positions[5][:3], (183, 34, 0))
        self.assertEqual(positions[10][:3], (160, 34, 0))
        self.assertEqual(self.one("SELECT fact_id, source_id FROM main.admissions WHERE admission_id = 1")[:], (167, 34))
        self.assertEqual([tuple(r) for r in self.con.execute(
            "SELECT evidence_link_id, source_id, fact_id FROM main.evidence_links ORDER BY 1")],
            [(1, 34, 183), (2, 50, 160)])
        self.assertEqual(sorted(tuple(r) for r in self.con.execute("SELECT criterion_id, fact_id FROM main.criteria_facts")),
                         [(1, 160), (2, 167)])
        self.assertEqual([tuple(r) for r in self.con.execute("SELECT issue_id, fact_id FROM main.issue_facts")], [(1, 160)])
        self.assertEqual([tuple(r) for r in self.con.execute("SELECT fact_id, source_id FROM privileged.fact_provenance")],
                         [(167, 1)])
        self.assertEqual([tuple(r) for r in self.con.execute(
            "SELECT source_reference_id, source_id, target_source_id FROM main.source_references ORDER BY 1")],
            [(1, 34, None), (2, 30, 34)])
        self.assertEqual(self.one("SELECT source_id FROM main.causes_of_action")[0], 34)
        self.assertEqual(self.one("SELECT report_source_id FROM main.witnesses")[0], 34)

    def test_relief_and_sought_order_duplicates_are_retired_not_moved(self):
        self.execute(FN["emit_sql"](self.decision()))
        relief = {r[0]: r[1:] for r in self.con.execute("SELECT relief_id, source_id, verified, notes FROM main.relief_items")}
        self.assertEqual(relief[1], (20, -1, f"[FOLDED-INTO:#10 {DATE} {APPROVER}]"))
        self.assertEqual(relief[2][:2], (34, 0))
        rpos = {r[0]: r[1:] for r in self.con.execute(
            "SELECT relief_position_id, relief_id, source_id, verified, notes FROM main.relief_positions")}
        self.assertEqual(rpos[1], (1, 20, -1, f"[FOLDED-INTO:#10 {DATE} {APPROVER}]"))
        self.assertEqual(rpos[2][:3], (2, 34, 0))
        self.assertEqual(rpos[3][:3], (10, 30, 0))
        orders = {r[0]: r[1:] for r in self.con.execute(
            "SELECT sought_order_id, source_id, verified, notes FROM main.sought_orders")}
        self.assertEqual(orders[1], (20, -1, f"[FOLDED-INTO:#10 {DATE} {APPROVER}]"))
        self.assertEqual(orders[2][:2], (34, 0))
        self.assertEqual(orders[10][:2], (34, 0))

    def test_children_are_matched_or_re_parented(self):
        self.execute(FN["emit_sql"](self.decision()))
        child = {r[0]: r[1:] for r in self.con.execute(
            "SELECT source_id, parent_source_id, file_path, file_hash, notes FROM main.sources WHERE source_id IN (21, 22)")}
        self.assertEqual(child[22], (34, K_PATH, K_HASH, None))
        self.assertEqual(child[21], (20, S_PATH, S_HASH, f"[SUPERSEDED-BY:#40 {DATE} {APPROVER}]"))

    def test_the_superseded_row_keeps_its_hash_and_loses_only_the_duplicate_clause(self):
        self.execute(FN["emit_sql"](self.decision()))
        s = self.one("SELECT notes, verified, execution_status, file_hash, ingestion_status FROM main.sources WHERE source_id = 20")
        self.assertEqual(s[:], (f"[SUPERSEDED-BY:#34 {DATE} {APPROVER}]", 0, "draft", S_HASH, "partial"))
        self.assertEqual(self.one("SELECT execution_status FROM main.sources WHERE source_id = 34")[0], "filed")

    def test_the_same_script_is_refused_a_second_time(self):
        sql = FN["emit_sql"](self.decision())
        self.execute(sql)
        before = [tuple(r) for r in self.con.execute("SELECT source_id, notes, parent_source_id FROM main.sources")]
        with self.assertRaisesRegex(sqlite3.IntegrityError, refusal("a copy is already superseded")):
            self.execute(sql)
        self.assertEqual([tuple(r) for r in self.con.execute("SELECT source_id, notes, parent_source_id FROM main.sources")],
                         before)

    def test_an_undecided_fact_or_a_moved_duplicate_fails_the_whole_script(self):
        undecided = self.decision()
        undecided["facts"] = [f for f in undecided["facts"] if f["fact_id"] != 183]
        moved_twin = self.decision()
        moved_twin["facts"] = [dict(f, fold_into=None) if f["fact_id"] == 185 else f for f in moved_twin["facts"]]
        changed_note = self.decision(notes={"20": "an older note", "34": None})
        for label, decision, condition in (
                ("undecided", undecided, "the superseded copy keeps a current fact"),
                ("moved twin", moved_twin, "an arriving fact restates a current fact of the kept copy"),
                ("note changed", changed_note, "a note changed since it was read")):
            with self.subTest(label):
                with self.assertRaisesRegex(sqlite3.IntegrityError, refusal(condition)):
                    self.execute(FN["emit_sql"](decision))
                self.assertEqual(self.one("SELECT notes FROM main.sources WHERE source_id = 20")[0], S_NOTE)
                self.assertEqual(self.one("SELECT source_id FROM main.facts WHERE fact_id = 183")[0], 20)

    def test_a_fold_target_listed_in_the_moves_is_refused(self):
        decision = self.decision()
        decision["facts"].append({"fact_id": 160})
        with self.assertRaisesRegex(sqlite3.IntegrityError, refusal(
                "a moved fact is not a current fact of the superseded copy or a matched child")):
            self.execute(FN["emit_sql"](decision))
        self.assertEqual(self.one("SELECT source_id FROM main.facts WHERE fact_id = 160")[0], 34)
        self.assertEqual(self.one("SELECT notes FROM main.sources WHERE source_id = 20")[0], S_NOTE)

    def test_a_kept_copy_pending_privilege_refuses_the_whole_script(self):
        self.con.execute("UPDATE main.sources SET privilege_status = 'pending' WHERE source_id = 34")
        self.con.commit()
        with self.assertRaisesRegex(sqlite3.IntegrityError, "^source is pending privilege review$"):
            self.execute(FN["emit_sql"](self.decision()))
        self.assertEqual(self.one("SELECT notes FROM main.sources WHERE source_id = 20")[0], S_NOTE)
        self.assertEqual(self.one("SELECT source_id, verified FROM main.facts WHERE fact_id = 185")[:], (20, 1))
        self.assertEqual(self.one("SELECT source_id FROM main.positions WHERE position_id = 5")[0], 20)

    def test_two_positions_landing_on_one_current_response_keep_one(self):
        # 189 restates 167 exactly and 186 is judged to; the response admits both at one locator,
        # so both positions would land on (167, party 2, source 30, 'para. 4').
        self.fact(189, 20, "para. 9", "The letter of 1 March demanded payment.")
        self.con.execute("INSERT INTO main.positions (position_id, fact_id, party_id, position, source_id, "
                         "source_locator) VALUES (6, 189, 2, 'admit', 30, 'para. 4')")
        self.con.commit()
        self.execute(FN["emit_sql"](self.decision()))
        positions = {r[0]: r[1:] for r in self.con.execute(
            "SELECT position_id, fact_id, source_id, verified, notes FROM main.positions WHERE position_id IN (3, 6)")}
        self.assertEqual(positions[3][:3], (167, 30, 0))
        self.assertEqual(positions[6], (189, 30, -1, f"[FOLDED-INTO:#3 {DATE} {APPROVER}]"))

    def test_two_relief_positions_landing_on_one_current_response_keep_one(self):
        # relief 3 duplicates the kept relief 10, as relief 1 does; the response opposes both at one locator
        self.con.execute("INSERT INTO main.relief_items (relief_id, source_id, seeking_party_id, description) "
                         "VALUES (3, 20, 1, 'DAMAGES')")
        self.con.execute("INSERT INTO main.relief_positions (relief_position_id, relief_id, party_id, position, "
                         "source_id, source_locator) VALUES (4, 3, 2, 'oppose', 30, 'para. 9')")
        self.con.commit()
        self.execute(FN["emit_sql"](self.decision()))
        rpos = {r[0]: r[1:] for r in self.con.execute(
            "SELECT relief_position_id, relief_id, source_id, verified, notes FROM main.relief_positions "
            "WHERE relief_position_id IN (3, 4)")}
        self.assertEqual(rpos[3][:3], (10, 30, 0))
        self.assertEqual(rpos[4], (3, 30, -1, f"[FOLDED-INTO:#3 {DATE} {APPROVER}]"))

    def test_a_fact_restating_another_arriving_fact_folds_into_it(self):
        # 189 restates 183, which moves to K; 193, on the re-parented exhibit #22, restates K's 168
        self.fact(189, 20, "para. 9", "Smith met the defendant  on 3 April.")
        self.fact(193, 22, "Exhibit C", "The invoice totals $5,000.")
        self.con.commit()
        plan = FN["fold_plan"](self.rows([20, 34]), 20, 34)
        self.assertIn({"fact_id": 189, "fold_into": 183}, plan["auto"])
        self.assertIn({"fact_id": 193, "fold_into": 168}, plan["auto"])
        self.assertEqual(sorted(f["fact_id"] for f in plan["agent_required"]), [183, 186, 191])
        self.execute(FN["emit_sql"](self.decision()))
        for fact_id, kept in ((189, 183), (193, 168)):
            with self.subTest(fact_id=fact_id):
                self.assertEqual(self.one("SELECT verified, notes FROM main.facts WHERE fact_id = ?", fact_id)[:],
                                 (-1, f"[FOLDED-INTO:#{kept} {DATE} {APPROVER}]"))
        self.assertEqual(self.one("SELECT source_id, verified FROM main.facts WHERE fact_id = 183")[:], (34, 0))
        dupes = self.one(
            "SELECT count(*) FROM (SELECT lower(trim(description)) d FROM main.facts "
            "WHERE verified >= 0 AND source_id IN (SELECT source_id FROM main.sources "
            "WHERE source_id = 34 OR parent_source_id = 34) GROUP BY d HAVING count(*) > 1)")[0]
        self.assertEqual(dupes, 0)

    def test_a_restating_fact_follows_its_fact_into_the_kept_copy(self):
        self.fact(189, 20, "para. 9", "Smith met the defendant on 3 April.")
        self.con.commit()
        decision = self.decision(facts=[{"fact_id": 185, "fold_into": 160}, {"fact_id": 186, "fold_into": 167},
                                        {"fact_id": 187, "fold_into": 168}, {"fact_id": 190, "fold_into": 169},
                                        {"fact_id": 183, "fold_into": 160}, {"fact_id": 189, "fold_into": 183},
                                        {"fact_id": 191}])
        self.execute(FN["emit_sql"](decision))
        self.assertEqual(self.one("SELECT notes FROM main.facts WHERE fact_id = 189")[0],
                         f"[FOLDED-INTO:#160 {DATE} {APPROVER}]")
        self.assertEqual(self.one("SELECT fact_id FROM main.positions WHERE position_id = 5")[0], 160)

    def test_an_arriving_fact_restating_another_current_fact_is_refused(self):
        self.fact(189, 20, "para. 9", "Smith met the defendant on 3 April.")
        self.fact(193, 22, "Exhibit C", "The invoice totals $5,000.")
        self.con.commit()
        settled = [{"fact_id": 185, "fold_into": 160}, {"fact_id": 186, "fold_into": 167},
                   {"fact_id": 187, "fold_into": 168}, {"fact_id": 190, "fold_into": 169},
                   {"fact_id": 183}, {"fact_id": 191}]
        cases = {
            "two moved facts restate each other": settled + [{"fact_id": 189}, {"fact_id": 193, "fold_into": 168}],
            "a re-parented child's fact restates K's": settled + [{"fact_id": 189, "fold_into": 183}],
        }
        for label, facts in cases.items():
            with self.subTest(label):
                with self.assertRaisesRegex(sqlite3.IntegrityError, refusal(
                        "an arriving fact restates a current fact of the kept copy")):
                    self.execute(FN["emit_sql"](self.decision(facts=facts)))
                self.assertEqual(self.one("SELECT source_id FROM main.facts WHERE fact_id = 183")[0], 20)

    def test_a_superseded_row_keeps_no_pending_marker(self):
        pending = "\n".join(FN["pending_marker"](n) for n in (34, 50))
        self.con.execute("UPDATE main.sources SET notes = ? WHERE source_id = 20", (S_NOTE + "\n" + pending,))
        self.con.execute("UPDATE main.sources SET notes = ? WHERE source_id = 34",
                         ("\n".join(FN["pending_marker"](n) for n in (20, 50)),))
        self.con.commit()
        self.execute(FN["emit_sql"](self.decision()))
        self.assertEqual(self.one("SELECT notes FROM main.sources WHERE source_id = 20")[0],
                         f"[SUPERSEDED-BY:#34 {DATE} {APPROVER}]")
        self.assertEqual(self.one("SELECT notes FROM main.sources WHERE source_id = 34")[0], FN["pending_marker"](50))

    def test_a_kept_copy_with_no_row_is_inserted_and_takes_every_fact(self):
        new_hash = "e" * 64
        new_path = FOLDER + r"\2024-05-02 AFF Smith FILED v2.pdf"
        decision = self.decision(kept={"file_path": new_path, "file_hash": new_hash}, children_into={},
                                 notes={"20": S_NOTE})
        plan = FN["fold_plan"](self.rows([20]), 20, None)
        self.assertEqual((plan["auto"], plan["children_into"], plan["reparent"]), ([], {}, [21, 22]))
        decision["facts"] = [{"fact_id": f["fact_id"]} for f in plan["agent_required"]]
        self.execute(FN["emit_sql"](decision))
        new = self.one("SELECT source_id, parent_source_id, title, proceeding_id, file_path, ingestion_status, "
                       "execution_status FROM main.sources WHERE file_hash = ? AND parent_source_id IS NULL", new_hash)
        self.assertEqual(new[1:], (None, "Affidavit #1 of Smith", 1, new_path, "partial", "filed"))
        k = new[0]
        self.assertEqual(sorted(r[0] for r in self.con.execute("SELECT fact_id FROM main.facts WHERE source_id = ?", (k,))),
                         [183, 185, 186, 187])
        self.assertEqual(sorted(r[0] for r in self.con.execute(
            "SELECT source_id FROM main.sources WHERE parent_source_id = ?", (k,))), [21, 22])
        self.assertEqual(self.one("SELECT notes FROM main.sources WHERE source_id = 20")[0],
                         f"[SUPERSEDED-BY:#{k} {DATE} {APPROVER}]")
        self.assertEqual(self.one("SELECT file_hash FROM main.sources WHERE source_id = 21")[0], new_hash)

    def test_a_kept_copy_inserted_for_a_complete_draft_is_complete(self):
        self.con.execute("UPDATE main.sources SET ingestion_status = 'complete' WHERE source_id = 20")
        self.con.commit()
        new_hash = "e" * 64
        decision = self.decision(kept={"file_path": FOLDER + r"\x.pdf", "file_hash": new_hash},
                                 children_into={}, notes={"20": S_NOTE},
                                 facts=[{"fact_id": f} for f in (183, 185, 186, 187)])
        self.execute(FN["emit_sql"](decision))
        self.assertEqual(self.one("SELECT ingestion_status FROM main.sources WHERE file_hash = ? AND parent_source_id IS NULL", new_hash)[0], "complete")

    def test_a_superseded_copy_with_no_row_is_recorded_by_its_own_hash(self):
        new_hash = "f" * 64
        decision = {"outcome": "superseded", "superseded": {"file_path": FOLDER + r"\draft.pdf", "file_hash": new_hash},
                    "kept": 34, "notes": {"34": None}, "execution_status": {"superseded": "draft"},
                    "date": DATE, "approver": APPROVER}
        self.execute(FN["emit_sql"](decision))
        row = self.one("SELECT parent_source_id, title, ingestion_status, execution_status, notes "
                       "FROM main.sources WHERE file_hash = ?", new_hash)
        self.assertEqual(row[:], (None, "Affidavit #1 of Smith", "complete", "draft",
                                  f"[SUPERSEDED-BY:#34 {DATE} {APPROVER}]"))
        self.assertEqual(self.one("SELECT count(*) FROM main.facts WHERE source_id = 34")[0], 1)

    def test_a_malformed_decision_is_refused_before_any_sql(self):
        cases = {
            "date": self.decision(date="5 Oct 2026"),
            "both new": self.decision(superseded={"file_path": "a.pdf", "file_hash": "f" * 64},
                                      kept={"file_path": "b.pdf", "file_hash": "e" * 64}),
            "notes": self.decision(notes={"20": S_NOTE}),
            "twice": self.decision(facts=[{"fact_id": 183}, {"fact_id": 183, "fold_into": 160}]),
            "status": self.decision(execution_status={"kept": "sworn"}),
        }
        for label, decision in cases.items():
            with self.subTest(label):
                with self.assertRaises(ValueError):
                    FN["emit_sql"](decision)


class NotVersionSqlTests(CourtFile):
    """Two filed copies #32 and #33 whose pages differ beyond execution marks."""

    PENDING = "SUPERSEDE-PENDING: possible other version of source #33."

    def seed(self):
        super().seed()
        self.source(32, "NOCC", FOLDER + r"\NOCC.pdf", "1" * 64, "complete",
                    notes="DISCREPANCY: possible duplicate of source #33\n" + self.PENDING, verified=2)
        self.source(33, "NOCC", FOLDER + r"\NOCC FILED.pdf", "2" * 64, "complete",
                    notes="DISCREPANCY: possible duplicate of source #32; registry rejected the filing", verified=2)
        self.con.commit()

    def not_version(self, approver="strict-test"):
        notes = {str(r["id"]): r["notes"] for r in self.rows([32, 33]) if r["kind"] == "source" and r["id"] in (32, 33)}
        return FN["emit_sql"]({"outcome": "not_version", "pair": [32, 33], "notes": notes,
                               "date": DATE, "approver": approver})

    def test_both_rows_are_marked_and_verified_returns_only_without_a_prefix(self):
        self.execute(self.not_version())
        rows = {r[0]: r[1:] for r in self.con.execute("SELECT source_id, notes, verified FROM main.sources WHERE source_id IN (32, 33)")}
        self.assertEqual(rows[32], (f"[NOT-VERSION-OF:#33 {DATE} strict-test]", 0))
        self.assertEqual(rows[33], ("DISCREPANCY: registry rejected the filing\n"
                                    f"[NOT-VERSION-OF:#32 {DATE} strict-test]", 2))

    def test_a_clause_that_cannot_be_isolated_is_left_and_reported(self):
        mixed = "DISCREPANCY: possible duplicate of #32 and the registry rejected the filing"
        self.con.execute("UPDATE main.sources SET notes = ? WHERE source_id = 33", (mixed,))
        self.con.commit()
        sql = self.not_version()
        self.assertIn("-- REPORT: #33", sql)
        self.execute(sql)
        self.assertEqual(self.one("SELECT notes, verified FROM main.sources WHERE source_id = 33")[:],
                         (mixed + f"\n[NOT-VERSION-OF:#32 {DATE} strict-test]", 2))

    def test_the_marker_refuses_a_second_run_and_ends_the_pair_as_a_candidate(self):
        sql = self.not_version("practitioner")
        self.execute(sql)
        with self.assertRaisesRegex(sqlite3.IntegrityError, refusal("the pair is already decided")):
            self.execute(sql)
        rows = [dict(r) for r in self.con.execute(
            fenced(OPERATION_PATH, "sql", "-- supersede-draft candidates probe"))]
        self.assertEqual([p for p in FN["candidates"]([], rows, {}, FOLDER, MATTER_ROOT)
                          if "source_ids" in p and 32 in p["source_ids"]], [])

    def test_an_approver_other_than_the_two_is_refused(self):
        with self.assertRaises(ValueError):
            self.not_version("BD")


class UnmovedTests(CourtFile):
    """A superseded row whose file never reached 0. DRAFT*\\Superseded\\ (§6c)."""

    def unmoved(self):
        namespace = dict(FN)
        exec(fenced(OPERATION_PATH, "python", "def unmoved("), namespace)
        probe = fenced(OPERATION_PATH, "sql", "-- supersede-draft unmoved probe")
        return [r["source_id"] for r in namespace["unmoved"]([dict(r) for r in self.con.execute(probe)], MATTER_ROOT)]

    def test_only_a_superseded_row_outside_the_superseded_folder_is_offered_its_move(self):
        self.con.execute("UPDATE main.sources SET notes = ? WHERE source_id = 20",
                         (f"x\n[SUPERSEDED-BY:#34 {DATE} {APPROVER}]",))
        self.con.commit()
        self.assertEqual(self.unmoved(), [20], "the move never ran: the row keeps its court-folder path")
        for path, expected in ((r"0. DRAFT\Superseded\2024-04-20 AFF Smith DRAFT.pdf", []),
                               (MATTER_ROOT + r"\0. DRAFT v2\SUPERSEDED\aff.pdf", []),
                               (r"0. DRAFT\Old\aff.pdf", [20])):
            with self.subTest(path=path):
                self.con.execute("UPDATE main.sources SET file_path = ? WHERE source_id = 20", (path,))
                self.assertEqual(self.unmoved(), expected)


class CommandLineTests(unittest.TestCase):
    def run_cli(self, command, request):
        return subprocess.run([sys.executable, str(SCRIPTS_DIR / "supersede_draft.py"), command],
                              input=json.dumps(request), capture_output=True, text=True)

    def test_the_cli_runs_the_operation_functions(self):
        out = self.run_cli("rank", {"a": "draft", "b": "filed"})
        self.assertEqual((out.returncode, json.loads(out.stdout)["keep"]), (0, "b"))

    def test_a_refused_decision_exits_2(self):
        out = self.run_cli("emit-sql", {"outcome": "superseded", "date": "today", "approver": APPROVER})
        self.assertEqual(out.returncode, 2)
        self.assertIn("REFUSED: date", out.stderr)


if __name__ == "__main__":
    unittest.main()
