"""The ingest_result converters (ingest orchestrator spec 2.2): each writer rule the
converters took over from operations/ingest-extract.md, run against synthetic
main, law and privileged stores with the cross-database triggers loaded, the way
the data server runs a plan (one transaction, a savepoint per statement group).
Every name is invented."""

import json
import re
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

CASE_DATA_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = CASE_DATA_ROOT / "references" / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import ingest_affidavit  # noqa: E402
import ingest_common  # noqa: E402
import ingest_facts  # noqa: E402
import ingest_privileged  # noqa: E402

SCHEMA = (CASE_DATA_ROOT / "references" / "schema.sql").read_text(encoding="utf-8")
TRIGGERS = (CASE_DATA_ROOT / "references" / "triggers.sql").read_text(encoding="utf-8")
H = "a" * 64
PATH = "5. COURT FILE\\2026-01-05 NOCC.pdf"
SEED = """
INSERT INTO proceedings (proceeding_id, court, file_number, style_of_cause) VALUES (1, 'BCSC', 'S-000001', 'Quill v. Plum');
INSERT INTO parties (party_id, name) VALUES (1, 'Ada Quill'), (2, 'Plum Holdings Ltd.');
"""
PARTIES = {"Ada Quill": 1, "Plum Holdings Ltd.": 2}


def section(db):
    begin = re.search(rf"^-- ===== v6 BEGIN {db} =====\s*$", SCHEMA, re.M)
    end = re.search(rf"^-- ===== v6 END {db} =====\s*$", SCHEMA, re.M)
    return SCHEMA[begin.end():end.start()]


def run_plan(con, plan):
    """The data server's run_statements: guards refuse the whole call, a group rolls back alone."""
    params = plan["params"]
    refused, failed, named, counts = [], [], {}, {}
    con.isolation_level = None
    con.execute("BEGIN")
    for n, st in enumerate(plan["statements"]):
        if refused and not st.get("refuse"):
            break
        if "statements" in st:
            merged = {**params, **(st.get("params") or {})}
            con.execute(f"SAVEPOINT g_{n}")
            try:
                done = []
                for s in st["statements"]:
                    cur = con.execute(s["sql"], merged)
                    rows = cur.fetchall()
                    if s.get("refuse") and rows:
                        raise LookupError(rows[0][0])
                    done.append((s.get("count"), cur.rowcount))
                con.execute(f"RELEASE g_{n}")
                for key, n_rows in done:
                    if key:
                        counts[key] = counts.get(key, 0) + max(n_rows, 0)
            except Exception as exc:  # noqa: BLE001 -- the helper's own rule
                con.execute(f"ROLLBACK TO g_{n}")
                con.execute(f"RELEASE g_{n}")
                failed.append((st["ref"], str(exc)))
            continue
        cur = con.execute(st["sql"], params)
        rows = cur.fetchall()
        if st.get("count"):
            counts[st["count"]] = counts.get(st["count"], 0) + max(cur.rowcount, 0)
        if st.get("refuse"):
            refused += [r[0] for r in rows]
        if st.get("value_as"):
            named[st["value_as"]] = rows[0][0] if rows else None
    con.execute("ROLLBACK" if refused else "COMMIT")
    return {"refused": refused, "failed": failed, "named": named, "counts": counts}


class Converters(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        for db in ("main", "law", "privileged"):
            c = sqlite3.connect(self.dir / f"{db}.sqlite")
            c.executescript(section(db))
            c.close()
        self.con = sqlite3.connect(self.dir / "main.sqlite")
        for db in ("law", "privileged"):
            self.con.execute(f"ATTACH ? AS {db}", (str(self.dir / f"{db}.sqlite"),))
        self.con.executescript(TRIGGERS)
        self.con.executescript(SEED)
        self.n = 0

    def tearDown(self):
        self.con.close()
        self.tmp.cleanup()

    def q(self, sql):
        return self.con.execute(sql).fetchall()

    def staged(self, result):
        self.n += 1
        path = self.dir / f"r{self.n}.json"
        path.write_text(json.dumps(result), encoding="utf-8")
        return {"result_id": f"r{self.n}", "path": str(path), "ref": result.get("ref", "f1")}

    def request(self, contract, results, **extra):
        req = {"contract": contract, "mode": "attended", "file_path": PATH, "file_hash": H,
               "results": [self.staged(r) for r in results], "answers": {}, "participants": dict(PARTIES),
               "route": {"ref": "f1", "kind": "facts", "file_path": PATH, "file_hash": H},
               "answered": {"facts": [], "relief": []}, "firm_name": "Quill Law LLP"}
        req.update(extra)
        return req

    def write(self, module, req):
        plan = module.plan(req)
        self.assertIn("statements", plan, plan)
        return plan, run_plan(self.con, plan)

    # ---------------------------------------------------------------- facts (Path A)

    def facts(self, **extra):
        result = {"contract": "facts", "contract_version": 2, "ref": "f1", "flags": [],
                  "document": {"title": "Notice of Civil Claim", "description": "The claim", "category": "court",
                               "date": "2026-01-05", "author_or_filing_party": "Ada Quill",
                               "proceeding_file_number": "S-000001"},
                  "facts": [{"fact_key": "new:1", "source_locator": "para. 1", "description": "A loan was made.",
                             "category": "contract", "date_of_fact": None, "evidence": None}],
                  "fact_positions": [{"target_fact_key": "new:1", "party_name": "Ada Quill", "value": "claim",
                                      "position_basis": None, "qualification": None, "source_locator": "para. 1"}],
                  "relief_items": [{"relief_key": "new-relief:1", "seeking_party_name": "Ada Quill",
                                    "against_party_name": "Plum Holdings Ltd.", "description": "Judgment.",
                                    "source_locator": "Part 2"}],
                  "relief_positions": [{"target_relief_key": "new-relief:1", "party_name": "Ada Quill",
                                        "value": "seek", "qualification": None, "source_locator": "Part 2"}],
                  "source_references": [], "unresolved_references": []}
        result.update(extra)
        return result

    def test_positions_and_relief_positions_are_closed_and_succeeded_bitemporally(self):
        self.write(ingest_facts, self.request("facts", [self.facts()]))
        changed = self.facts()
        changed["fact_positions"][0]["value"] = "admit"
        changed["relief_positions"][0]["value"] = "oppose"
        self.write(ingest_facts, self.request("facts", [changed]))
        rows = self.q("SELECT position, valid_to IS NULL, prior_id FROM positions ORDER BY position_id")
        self.assertEqual(rows, [("claim", 0, None), ("admit", 1, 1)])
        rows = self.q("SELECT position, valid_to IS NULL, prior_id FROM relief_positions ORDER BY relief_position_id")
        self.assertEqual(rows, [("seek", 0, None), ("oppose", 1, 1)])
        self.write(ingest_facts, self.request("facts", [changed]))
        self.assertEqual(self.q("SELECT count(*) FROM positions WHERE valid_to IS NULL"), [(1,)], "a repeat adds nothing")

    def test_a_failed_or_null_status_row_is_reused_by_the_re_extraction(self):
        self.write(ingest_facts, self.request("facts", [], route={"ref": "f1", "kind": "facts", "category": "court"}))
        self.assertEqual(self.q("SELECT ingestion_status FROM sources"), [("failed",)])
        self.write(ingest_facts, self.request("facts", [self.facts()]))
        self.assertEqual(self.q("SELECT count(*), ingestion_status FROM sources"), [(1, "complete")])
        self.con.execute("DELETE FROM positions")
        self.con.execute("DELETE FROM relief_positions")
        self.con.execute("DELETE FROM relief_items")
        self.con.execute("DELETE FROM facts")
        self.con.execute("UPDATE sources SET ingestion_status = NULL")
        self.write(ingest_facts, self.request("facts", [self.facts()]))
        self.assertEqual(self.q("SELECT count(*), ingestion_status FROM sources"), [(1, "complete")])
        self.assertEqual(self.q("SELECT count(*) FROM facts"), [(1,)])

    def test_a_failed_close_with_no_category_asks_rather_than_assume_court(self):
        plan = ingest_facts.plan(self.request("facts", []))
        self.assertEqual([a["kind"] for a in plan["asks"]], ["category"])
        self.assertIn("privileged", plan["asks"][0]["say"])

    def test_a_store_change_is_refused(self):
        self.con.execute("INSERT INTO privileged.privileged_sources (category, title, file_hash) VALUES ('other', 'P', ?)", (H,))
        _, out = self.write(ingest_facts, self.request("facts", [self.facts()]))
        self.assertTrue(out["refused"][0].startswith("store_change"))
        self.con.execute("DELETE FROM privileged.privileged_sources")
        self.con.execute("INSERT INTO sources (category, title, file_hash, privilege_status) VALUES ('court', 'x', ?, 'pending')", (H,))
        _, out = self.write(ingest_facts, self.request("facts", [self.facts()]))
        self.assertTrue(out["refused"][0].startswith("store_change"))

    def test_an_unknown_answered_fact_is_refused(self):
        result = self.facts(fact_positions=[{"target_fact_key": "fact:999", "party_name": "Plum Holdings Ltd.",
                                             "value": "deny", "position_basis": None, "qualification": None,
                                             "source_locator": "para. 1"}])
        req = self.request("facts", [result], answered={"facts": ["fact:999"], "relief": []})
        req["route"]["answers_source_id"] = 7
        _, out = self.write(ingest_facts, req)
        self.assertEqual(out["refused"], ["answered: unknown answered fact 999"])
        self.assertEqual(self.q("SELECT count(*) FROM sources"), [(0,)])

    def test_answered_keys_come_from_the_dispatch_not_the_extraction(self):
        result = self.facts(fact_positions=[{"target_fact_key": "fact:999", "party_name": "Plum Holdings Ltd.",
                                             "value": "deny", "position_basis": None, "qualification": None,
                                             "source_locator": "para. 1"}])
        self.assertIn("problems", ingest_facts.plan(self.request("facts", [result])))

    def test_an_unresolved_target_locator_is_reported_and_writes_nothing(self):
        plan = ingest_facts.plan(self.request("facts", [self.facts(unresolved_references=[
            {"target_locator": "para. 9", "reason": "x"}, {"target_locator": "para. 4", "reason": "x"}])]))
        self.assertEqual(plan["blocked"], "unresolved")
        self.assertIn("para. 4", plan["report"][0])

    def test_a_privileged_or_authority_reading_never_reaches_main(self):
        plan = ingest_facts.plan(self.request("facts", [self.facts(flags=[{"kind": "privilege_signal", "ref": "f1"}])]))
        self.assertEqual((plan["blocked"], plan["asks"][0]["kind"]), ("path_b", "privilege"))
        doc = self.facts()
        doc["document"]["category"] = "authority"
        self.assertEqual(ingest_facts.plan(self.request("facts", [doc]))["blocked"], "set_aside")
        doc["document"]["category"] = "other"
        plan = ingest_facts.plan(self.request("facts", [doc]))
        self.assertIn("legal authority", plan["asks"][0]["say"], "the category question offers all seven answers")

    def test_an_unresolved_filing_party_of_a_court_document_is_asked_and_0_means_none(self):
        doc = self.facts()
        doc["document"]["author_or_filing_party"] = "Someone Else"
        plan = ingest_facts.plan(self.request("facts", [doc]))
        self.assertEqual(plan["asks"][0]["ref"], "Someone Else")
        req = self.request("facts", [doc])
        req["participants"]["Someone Else"] = 0
        self.write(ingest_facts, req)
        self.assertEqual(self.q("SELECT filed_by_party_id FROM sources"), [(None,)])

    def test_witness_and_expert_upserts(self):
        doc = self.facts()
        doc["document"]["author_or_filing_party"] = "Dr. Rowan Expert"
        doc["document"]["category"] = "production"
        req = self.request("facts", [doc])
        req["route"]["witness"] = "expert"
        req["route"]["proceeding_id"] = 1
        self.write(ingest_facts, req)
        self.write(ingest_facts, req)
        self.assertEqual(self.q("SELECT name, witness_type, report_source_id FROM witnesses"), [("Dr. Rowan Expert", "expert", 1)])
        self.assertEqual(self.q("SELECT proceeding_id, witness_id FROM proceeding_witnesses"), [(1, 1)])

    def test_other_copy_resolves_by_title_regardless_of_case(self):
        self.con.execute("INSERT INTO sources (category, title, file_hash) VALUES ('court', 'Notice of Civil Claim', 'b')")
        doc = self.facts(flags=[{"kind": "other_copy", "ref": "f1", "detail": "notice of civil claim "}])
        plan, _ = self.write(ingest_facts, self.request("facts", [doc]))
        self.assertIn("other_copy", plan["post"])
        other = self.con.execute(plan["statements"][-1]["sql"], plan["params"]).fetchone()[0]
        self.assertEqual(other, 1)
        self.assertEqual(plan["other_title"], "notice of civil claim")

    def test_the_delivery_check_fires_only_on_the_firms_own_letter(self):
        def passes(detail, path=PATH):
            doc = self.facts(flags=[{"kind": "outgoing_letter", "ref": "f1", "detail": detail}])
            doc["document"]["category"] = "correspondence"
            return ingest_facts.plan(self.request("facts", [doc], file_path=path))["post"]
        self.assertIn("delivery_check", passes("QUILL LAW LLP"))
        self.assertNotIn("delivery_check", passes("Opposing Counsel LLP"))
        self.assertNotIn("delivery_check", passes("Quill Law LLP", "2. CORRESPONDENCE\\letter.eml"))

    def test_whole_words_and_a_missing_firm_profile_is_said(self):
        doc = self.facts(flags=[{"kind": "outgoing_letter", "ref": "f1", "detail": "Quill Lawson LLP"}])
        doc["document"]["category"] = "correspondence"
        self.assertNotIn("delivery_check", ingest_facts.plan(self.request("facts", [doc], firm_name="Quill Law"))["post"])
        plan = ingest_facts.plan(self.request("facts", [doc], firm_name=None))
        self.assertNotIn("delivery_check", plan["post"])
        self.assertTrue(any("was not checked" in line for line in plan["report"]), plan["report"])

    def test_universal_rules_prefixed_notes_local_dates_and_silence(self):
        doc = self.facts(facts=[{"fact_key": "new:1", "source_locator": "para. 1", "description": "A loan was made.",
                                 "category": "contract", "date_of_fact": None, "notes": "UNCONFIRMED: date unclear",
                                 "evidence": {"is_proof_source": True, "strength": 1, "notes": "OCR: faint"}}],
                         fact_positions=[], relief_items=[], relief_positions=[])
        self.write(ingest_facts, self.request("facts", [doc]))
        self.assertEqual(self.q("SELECT verified FROM facts"), [(2,)], "a prefixed note goes to the human queue")
        self.assertEqual(self.q("SELECT verified FROM evidence_links"), [(2,)])
        today = self.q("SELECT date('now','localtime')")[0][0]
        self.assertEqual(self.q("SELECT created_date FROM facts"), [(today,)], "host-local, not the UTC default")
        self.assertEqual(self.q("SELECT valid_from FROM evidence_links"), [(today,)])
        self.assertEqual(self.q("SELECT count(*) FROM positions"), [(0,)], "no row means actual silence")

    def test_order_detection_reads_the_leading_code_and_skips_a_notice_of_application(self):
        self.assertTrue(ingest_common.is_order("5. COURT FILE\\2026-05-01 ORDR Smith.pdf", "x", None))
        self.assertFalse(ingest_common.is_order("5. COURT FILE\\2026-05-01 AFF Smith re CO.pdf", "x", None))
        self.assertFalse(ingest_common.is_order(PATH, "Notice of Application for an order", None, "notice_of_application"))

    def test_every_date_setting_flag_gets_the_fixed_line(self):
        doc = self.facts(flags=[{"kind": "date_setting", "ref": "f1", "detail": "trial, 2026-09-01", "page": 1},
                                {"kind": "date_setting", "ref": "f1", "detail": "CPC, 2026-07-01"}])
        report = ingest_facts.plan(self.request("facts", [doc]))["report"]
        self.assertEqual(len(report), 2)
        self.assertEqual(report[0], "This document sets a date: trial, 2026-09-01, p. 1. Record it as an anchor through the docket "
                                    "clerk, citing source {source} (Notice of Civil Claim). Nothing was recorded here.")

    # ---------------------------------------------------------------- privileged (Path B)

    def privileged(self, **extra):
        result = {"contract": "privileged", "contract_version": 2, "ref": "memo",
                  "document": {"title": "Memo", "category": "solicitor_client", "date": "2026-01-02"},
                  "facts": [{"source_locator": "p1", "description": "The loan was oral.", "category": "contract",
                             "date_of_fact": None, "evidence": {"is_proof_source": True, "strength": 1, "notes": None}}]}
        result.update(extra)
        return result

    def test_path_b_no_writes_a_cleared_work_product_row_with_facts_and_links(self):
        req = self.request("privileged", [self.privileged()], answers={"privilege": "no"}, route=None)
        self.write(ingest_privileged, req)
        self.assertEqual(self.q("SELECT category, listed, privilege_status, ingestion_status FROM sources"),
                         [("work_product", 0, "cleared", "complete")])
        self.assertEqual(self.q("SELECT count(*) FROM facts WHERE description = 'The loan was oral.'"), [(1,)])
        self.assertEqual(self.q("SELECT count(*) FROM evidence_links"), [(1,)])

    def test_a_changed_client_instruction_closes_the_prior_one(self):
        ins = {"party_name": "Ada Quill", "instructed_by": "Ada Quill", "date": "2026-01-02",
               "description": "Settle above $4,000.", "source_locator": "p1", "status": "open"}
        self.write(ingest_privileged, self.request("privileged", [self.privileged(client_instructions=[ins])],
                                                   answers={"privilege": "yes"}, route=None))
        later = {**ins, "description": "Settle above $3,000.", "source_locator": "p2", "supersedes_instruction_id": 1}
        self.write(ingest_privileged, self.request("privileged", [self.privileged(client_instructions=[later])],
                                                   answers={"privilege": "yes"}, route=None))
        rows = self.q("SELECT instruction_id, status, valid_to IS NULL, prior_id FROM privileged.client_instructions ORDER BY instruction_id")
        self.assertEqual(rows, [(1, "superseded", 0, None), (2, "open", 1, 1)])

    # ---------------------------------------------------------------- affidavits (Path C)

    def body(self, **extra):
        result = {"contract": "affidavit_body", "contract_version": 2, "ref": "f1", "flags": [],
                  "deponent": {"name": "Ada Quill", "role": "plaintiff", "basis_statement": "I am."},
                  "sworn_date": "2026-03-01",
                  "body_facts": [{"source_locator": "para. 3", "description": "The loan was not repaid.",
                                  "category": "breach", "date_of_fact": None,
                                  "basis_of_knowledge": "information_and_belief", "informant": "Her lawyer",
                                  "informant_privileged": True}],
                  "exhibit_inventory": [], "body_page_count": 2, "total_pages_read": 2, "scanned": False}
        result.update(extra)
        return result

    def exhibit(self, letter, **extra):
        result = {"contract": "affidavit_exhibits", "contract_version": 2, "ref": f"f1:{letter}", "flags": [],
                  "exhibit_letter": letter, "title": f"Doc {letter}", "description": "x", "date": None,
                  "needs_human": False,
                  "facts": [{"source_locator": "p4", "description": f"{letter} says so.", "category": "contract",
                             "date_of_fact": None, "evidence": {"is_proof_source": True, "strength": 1, "notes": None}}]}
        result.update(extra)
        return result

    def exhibits(self, results, expected=("A", "B"), failed=()):
        return self.request("affidavit_exhibits", results, route={"ref": "f1", "kind": "affidavit"},
                            exhibits={"expected": list(expected), "failed": list(failed), "deferred": [], "uncertain": []})

    def test_a_privileged_informant_is_nulled_asked_and_recorded_on_the_answer(self):
        req = self.request("affidavit_body", [self.body()], route={"ref": "f1", "kind": "affidavit"})
        plan, _ = self.write(ingest_affidavit, req)
        self.assertEqual([a["kind"] for a in plan["asks"]], ["privileged_informant"])
        self.assertEqual(plan["date"], "2026-03-01")
        self.assertEqual(self.q("SELECT informant FROM facts"), [(None,)])
        self.assertEqual(self.q("SELECT date FROM sources"), [("2026-03-01",)])
        self.con.execute("INSERT INTO privileged.privileged_sources (source_id, category, title) VALUES (5, 'solicitor_client', 'Call note')")
        req = self.request("affidavit_body", [self.body()], route={"ref": "f1", "kind": "affidavit"},
                           answers={"informants": {"para. 3": 5}})
        plan, _ = self.write(ingest_affidavit, req)
        self.assertEqual(plan["asks"], [])
        self.assertEqual(self.q("SELECT source_id, source_note FROM privileged.fact_provenance"), [(5, "INFORMANT: Her lawyer")])
        self.assertEqual(self.q("SELECT informant FROM facts"), [(None,)])

    def write_body(self):
        self.write(ingest_affidavit, self.request("affidavit_body", [self.body(body_facts=[])], route={"ref": "f1", "kind": "affidavit"}))

    def test_exhibits_privilege_signal_constraint_failure_twice_failed_and_already_written(self):
        self.write_body()
        # B is already held pending a privilege decision, so a reading that cites it as proof breaks
        # the pending-privilege guard (#49) and its group rolls back alone.
        self.con.execute("INSERT INTO sources (category, title, parent_source_id, ingestion_status, privilege_status) "
                         "VALUES ('court', 'Exhibit B', 1, 'complete', 'pending')")
        a = self.exhibit("A", flags=[{"kind": "privilege_signal", "ref": "p4"}])
        plan, out = self.write(ingest_affidavit, self.exhibits([a, self.exhibit("B")], expected=("A", "B", "C")))
        self.assertEqual(plan["pending"], ["A"])
        self.assertEqual([ref for ref, _ in out["failed"]], ["B"])
        self.assertEqual(self.q("SELECT title, privilege_status, ingestion_status, verified FROM sources WHERE parent_source_id IS NOT NULL ORDER BY source_id"),
                         [("Exhibit B", "pending", "complete", 0), ("Exhibit A — Doc A", "pending", "complete", 0)])
        self.assertEqual(self.q("SELECT count(*) FROM facts WHERE description = 'B says so.'"), [(0,)], "the failed group left nothing")
        self.assertEqual(self.q("SELECT count(*) FROM evidence_links"), [(0,)], "a pending exhibit takes no links")
        self.assertEqual(self.q("SELECT ingestion_status FROM sources WHERE parent_source_id IS NULL"), [("partial",)])
        # C fails twice: the closing call records it and completes the body.
        self.write(ingest_affidavit, self.exhibits([], expected=("A", "B", "C"), failed=["C"]))
        self.assertEqual(self.q("SELECT notes, verified, ingestion_status FROM sources WHERE title = 'Exhibit C'"),
                         [("UNCONFIRMED: the exhibit could not be read after two attempts.", 2, "failed")])
        self.assertEqual(self.q("SELECT ingestion_status FROM sources WHERE parent_source_id IS NULL"), [("complete",)])
        before = self.q("SELECT count(*) FROM facts")
        _, out = self.write(ingest_affidavit, self.exhibits([self.exhibit("A")], expected=("A", "B", "C"), failed=["C"]))
        self.assertEqual(self.q("SELECT count(*) FROM facts"), before, "a repeat writes nothing twice")
        # The data server's already_written test: a prior row, nothing counted, the status unchanged.
        self.assertEqual(sum(out["counts"].values()), 0, out["counts"])
        self.assertEqual((out["named"]["prior"], out["named"]["final"]), ("complete", "complete"))

    def test_the_dispatched_letter_is_authoritative(self):
        self.write_body()
        plan = ingest_affidavit.plan(self.exhibits([self.exhibit("A", exhibit_letter="B", ref="f1:A")]))
        self.assertEqual(plan["invalid"], ["A"])
        run_plan(self.con, plan)
        self.assertEqual(self.q("SELECT title, ingestion_status FROM sources WHERE parent_source_id IS NOT NULL"), [("Exhibit A", "failed")])

    def test_an_exhibit_naming_no_expected_letter_fails_alone(self):
        self.write_body()
        plan, out = self.write(ingest_affidavit, self.exhibits([self.exhibit("A"), self.exhibit("b", ref="f1:b")]))
        self.assertEqual(plan["invalid"], ["b"])
        self.assertEqual(self.q("SELECT title FROM sources WHERE parent_source_id IS NOT NULL"), [("Exhibit A — Doc A",)])

    def test_twice_failed_exhibits_are_reported_on_the_closing_call(self):
        self.write_body()
        req = self.exhibits([], expected=("A",), failed=["A"])
        req["exhibits"]["closing"] = True
        plan, _ = self.write(ingest_affidavit, req)
        self.assertEqual(plan["report"], ["Exhibits A could not be read after two attempts and are marked for review."])

    def test_a_body_privilege_signal_is_reported(self):
        body = self.body(flags=[{"kind": "privilege_signal", "ref": "f1", "page": 2}])
        plan = ingest_affidavit.plan(self.request("affidavit_body", [body], route={"ref": "f1", "kind": "affidavit"}))
        self.assertTrue(any("(p. 2) may disclose privileged material" in line for line in plan["report"]), plan["report"])

    def test_no_exhibit_list_refuses_an_exhibit_write(self):
        self.write_body()
        plan = ingest_affidavit.plan(self.exhibits([self.exhibit("A")], expected=()))
        self.assertIn("problems", plan)


if __name__ == "__main__":
    unittest.main()
