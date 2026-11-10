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
import ingest_authority  # noqa: E402
import ingest_common  # noqa: E402
import ingest_facts  # noqa: E402
import ingest_privileged  # noqa: E402
import resolve_paths  # noqa: E402

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
    refused, failed, named, counts, asks, reports = [], [], {}, {}, [], []
    con.isolation_level = None
    con.execute("BEGIN")
    for n, st in enumerate(plan["statements"]):
        if refused and not st.get("refuse"):
            break
        if "statements" in st:
            merged = {**params, **(st.get("params") or {})}
            con.execute(f"SAVEPOINT g_{n}")
            try:
                done, asked, said = [], [], []
                for s in st["statements"]:
                    cur = con.execute(s["sql"], merged)
                    rows = cur.fetchall()
                    if s.get("refuse") and rows:
                        raise LookupError(rows[0][0])
                    done.append((s.get("count"), cur.rowcount))
                    if s.get("ask"):
                        asked += [dict(zip([d[0] for d in cur.description], r)) for r in rows]
                    if s.get("report"):
                        said += [r[0] for r in rows]
                con.execute(f"RELEASE g_{n}")
                for key, n_rows in done:
                    if key:
                        counts[key] = counts.get(key, 0) + max(n_rows, 0)
                asks += asked
                reports += said
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
        if st.get("ask"):
            asks += [dict(zip([d[0] for d in cur.description], r)) for r in rows]
        if st.get("report"):
            reports += [r[0] for r in rows]
    con.execute("ROLLBACK" if refused else "COMMIT")
    return {"refused": refused, "failed": failed, "named": named, "counts": counts, "asks": asks, "reports": reports}


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
                         relief_items=[], relief_positions=[])
        self.write(ingest_facts, self.request("facts", [doc]))
        self.assertEqual(self.q("SELECT verified FROM facts"), [(2,)], "a prefixed note goes to the human queue")
        self.assertEqual(self.q("SELECT verified FROM evidence_links"), [(2,)])
        today = self.q("SELECT date('now','localtime')")[0][0]
        self.assertEqual(self.q("SELECT created_date FROM facts"), [(today,)], "host-local, not the UTC default")
        self.assertEqual(self.q("SELECT valid_from FROM evidence_links"), [(today,)])
        self.assertEqual(self.q("SELECT party_id FROM positions"), [(1,)],
                         "the party who took a position has its row; the silent party has none")

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

    # ---------------------------------------------------------------- transcripts (Path A step 7)

    def test_a_transcript_notes_each_contradiction_of_a_pleaded_position_and_resolves_nothing(self):
        self.write(ingest_facts, self.request("facts", [self.facts()]))
        H2 = "b" * 64
        answer = self.facts(facts=[], relief_items=[], relief_positions=[], fact_positions=[
            {"target_fact_key": "fact:1", "party_name": "Ada Quill", "value": "deny", "position_basis": None,
             "qualification": None, "source_locator": "p. 12, l. 4"}])
        answer["document"]["category"] = "production"
        req = self.request("facts", [answer], file_hash=H2, answered={"facts": ["fact:1"], "relief": []},
                           route={"ref": "f2", "kind": "facts", "transcript": True, "answers_source_id": 1})
        _, out = self.write(ingest_facts, req)
        self.assertEqual(self.q("SELECT position, notes, verified FROM positions WHERE source_id = 2"),
                         [("deny", "DISCREPANCY: contradicts pleaded position #1", 2)])
        self.assertEqual(self.q("SELECT position, valid_to, notes FROM positions WHERE position_id = 1"),
                         [("claim", None, None)], "the pleaded position stands")
        self.assertEqual(len(out["reports"]), 1)
        self.write(ingest_facts, req)
        self.assertEqual(self.q("SELECT count(*) FROM positions WHERE source_id = 2"), [(1,)], "a repeat adds nothing")

    def test_a_document_that_is_no_transcript_notes_nothing(self):
        self.write(ingest_facts, self.request("facts", [self.facts()]))
        answer = self.facts(facts=[], relief_items=[], relief_positions=[], fact_positions=[
            {"target_fact_key": "fact:1", "party_name": "Ada Quill", "value": "deny", "position_basis": None,
             "qualification": None, "source_locator": "para. 9"}])
        req = self.request("facts", [answer], file_hash="b" * 64, answered={"facts": ["fact:1"], "relief": []},
                           route={"ref": "f2", "kind": "facts", "answers_source_id": 1})
        self.write(ingest_facts, req)
        self.assertEqual(self.q("SELECT notes FROM positions WHERE source_id = 2"), [(None,)])

    # ---------------------------------------------------------------- version pairs (Substitution 1j)

    def test_a_route_naming_held_rows_marks_the_row_in_the_documents_transaction(self):
        self.con.execute("INSERT INTO sources (source_id, category, title, file_hash) VALUES (34, 'court', 'Held', 'b')")
        req = self.request("facts", [self.facts()], mode="unattended",
                           route={"ref": "f1", "kind": "facts", "possible_versions": [34]})
        self.write(ingest_facts, req)
        notes = self.q("SELECT notes FROM sources WHERE source_id <> 34")[0][0]
        self.assertIn("SUPERSEDE-PENDING: possible other version of source #34.", notes)

    def test_two_newcomers_are_marked_with_each_other_once_both_have_rows(self):
        other = "b" * 64
        first = self.request("facts", [self.facts()], mode="unattended",
                             route={"ref": "f1", "kind": "facts", "version_newcomers": [other]})
        self.write(ingest_facts, first)
        self.assertNotIn("SUPERSEDE-PENDING", self.q("SELECT notes FROM sources")[0][0], "no row yet, so no marker")
        second = self.request("facts", [self.facts()], mode="unattended", file_hash=other,
                              route={"ref": "f2", "kind": "facts", "version_newcomers": [H]})
        self.write(ingest_facts, second)
        notes = dict(self.q("SELECT file_hash, notes FROM sources"))
        self.assertIn("SUPERSEDE-PENDING: possible other version of source #2.", notes[H])
        self.assertIn("SUPERSEDE-PENDING: possible other version of source #1.", notes[other])

    def test_a_version_newcomer_that_is_no_hash_is_refused_rather_than_spliced(self):
        req = self.request("facts", [self.facts()], route={"ref": "f1", "kind": "facts", "version_newcomers": ["x' OR '1"]})
        with self.assertRaises(ValueError):
            ingest_facts.plan(req)

    # ---------------------------------------------------------------- an email's attachments (#51, #53, #54)

    ATTACHMENT = {"name": "Invoice.pdf", "file_hash": "e" * 64}

    def email(self):
        doc = self.facts()
        doc["document"]["category"] = "correspondence"
        self.write(ingest_facts, self.request("facts", [doc], file_path="3. CORRESPONDENCE\\mail.eml"))

    def attachment(self, doc, **extra):
        doc = {**doc, "contract": "attachment", "ref": "f1:a1"}
        return self.request("attachment", [doc], attachment=self.ATTACHMENT, file_path="3. CORRESPONDENCE\\mail.eml", **extra)

    def test_an_attachment_is_a_child_row_with_its_own_hash_no_path_and_its_file_name(self):
        self.email()
        doc = self.facts(facts=[{"fact_key": "new:1", "source_locator": "p1", "description": "An invoice issued.",
                                 "category": "contract", "date_of_fact": None,
                                 "evidence": {"is_proof_source": True, "strength": 1, "notes": None}}],
                         fact_positions=[], relief_items=[], relief_positions=[])
        doc["document"]["category"] = "production"
        plan, out = self.write(ingest_facts, self.attachment(doc))
        self.assertEqual(plan["post"], [], "the after-completion passes are the top-level row's")
        rows = self.q("SELECT title, file_path, file_hash, parent_source_id, ingestion_status, category "
                      "FROM sources WHERE parent_source_id IS NOT NULL")
        self.assertEqual(rows, [("Invoice.pdf", None, "e" * 64, 1, "complete", "production")])
        self.assertEqual(self.q("SELECT count(*) FROM facts WHERE source_id = 2"), [(1,)])
        self.assertEqual(self.q("SELECT count(*) FROM evidence_links WHERE source_id = 2"), [(1,)])
        self.assertEqual(out["named"]["source_id"], 2)
        _, again = self.write(ingest_facts, self.attachment(doc))
        self.assertEqual(self.q("SELECT count(*) FROM sources"), [(2,)])
        self.assertEqual(self.q("SELECT count(*) FROM facts WHERE source_id = 2"), [(1,)], "a repeat adds nothing")
        self.assertEqual(again["named"]["prior"], "complete")

    def test_an_attachment_registered_anywhere_else_writes_nothing(self):
        self.email()
        self.con.execute("INSERT INTO sources (category, title, file_hash) VALUES ('production', 'Filed copy', ?)", ("e" * 64,))
        self.con.commit()
        _, out = self.write(ingest_facts, self.attachment(self.facts()))
        self.assertTrue(out["refused"][0].startswith("attachment_held"), out)
        self.assertEqual(self.q("SELECT count(*) FROM sources WHERE parent_source_id IS NOT NULL"), [(0,)])

    def test_an_attachment_that_may_be_privileged_is_held_pending_with_facts_only(self):
        self.email()
        doc = self.facts(flags=[{"kind": "privilege_signal", "ref": "f1:a1"}])
        plan, _ = self.write(ingest_facts, self.attachment(doc))
        self.assertEqual([a["kind"] for a in plan["asks"]], ["privilege"])
        self.assertEqual(self.q("SELECT category, privilege_status, listed FROM sources WHERE parent_source_id = 1"),
                         [("work_product", "pending", 0)])
        self.assertEqual(self.q("SELECT count(*) FROM positions WHERE source_id = 2"), [(0,)])
        self.assertEqual(self.q("SELECT count(*) FROM facts WHERE source_id = 2"), [(2 - 1,)])

    def test_an_attachment_whose_extraction_failed_twice_is_registered_failed(self):
        self.email()
        req = self.request("attachment", [], attachment=self.ATTACHMENT, route={"ref": "f1", "kind": "facts"})
        plan, _ = self.write(ingest_facts, req)
        self.assertTrue(plan["failed"])
        self.assertEqual(self.q("SELECT title, ingestion_status, file_path FROM sources WHERE parent_source_id = 1"),
                         [("Invoice.pdf", "failed", None)])
        doc = self.facts()
        doc["document"]["category"] = "production"
        self.write(ingest_facts, self.attachment(doc))
        self.assertEqual(self.q("SELECT count(*), max(ingestion_status) FROM sources WHERE parent_source_id = 1"),
                         [(1, "complete")], "a later reading reuses the row")

    def test_an_attachment_before_its_email_waits(self):
        _, out = self.write(ingest_facts, self.attachment(self.facts()))
        self.assertTrue(out["refused"][0].startswith("waiting"))

    # ---------------------------------------------------------------- authorities (Path D, through the run)

    def authority(self, **extra):
        result = {"contract": "caselaw", "contract_version": 2, "ref": "f1", "flags": [],
                  "authority": {"title": "Quillfeather v. Plumtree", "citation": "2026 BCCA 999", "authority_type": "case_law",
                                "jurisdiction": "BC"},
                  "authority_disposition": "Appeal dismissed.", "fact_pattern": "A landlord and a tenant.",
                  "loss_description": None,
                  "treats_prior": {"citation": "2020 BCSC 1", "title": "An earlier case", "treatment": "affirms", "scope": "full"},
                  "concepts": [{"name": "Invented test", "jurisdiction": "BC", "concept_kind": "legal test", "description": "d",
                                "authority_role": "establishes", "authority_proposition": "A rule.",
                                "criteria": [{"requirement_kind": "mandatory element", "criterion_order": 1,
                                              "criterion_description": "An element.",
                                              "determined_by_concept_name": "Sub test"}]}]}
        result.update(extra)
        return result

    def authority_request(self, results, contract="caselaw", route=None):
        return self.request(contract, results, file_path="6. LAW\\Quillfeather.pdf",
                            route=route or {"ref": "f1", "kind": contract})

    def test_a_decision_is_written_and_its_treatment_is_a_pending_marker_never_a_treatment(self):
        plan, out = self.write(ingest_authority, self.authority_request([self.authority()]))
        self.assertNotIn("treats_prior", plan)
        self.assertEqual(self.q("SELECT citation, disposition, file_path, notes, last_verified_at FROM law.authorities"),
                         [("2026 BCCA 999", "Appeal dismissed.", "6. LAW\\Quillfeather.pdf",
                           "[TREATMENT-PENDING:2020 BCSC 1|affirms|full]", None)])
        self.assertEqual(self.q("SELECT count(*) FROM law.authority_treatments"), [(0,)], "matching stays an attended judgment")
        self.assertEqual(out["named"]["source_id"], 1)
        self.assertEqual(out["named"]["prior"], None)
        self.assertEqual(self.q("SELECT count(*) FROM law.concept_authorities"), [(1,)])
        self.assertEqual(self.q("SELECT count(*) FROM law.legal_criteria"), [(1,)])
        self.assertTrue(any("Sub test" in line for line in out["reports"]), "a stub is reported")
        _, again = self.write(ingest_authority, self.authority_request([self.authority()]))
        self.assertEqual(again["named"]["prior"], 1)
        self.assertEqual(sum(again["counts"].values()), 0)
        self.assertEqual(self.q("SELECT notes FROM law.authorities"), [("[TREATMENT-PENDING:2020 BCSC 1|affirms|full]",)], "one marker")

    def test_the_markers_field_separators_cannot_come_from_the_result(self):
        doc = self.authority(treats_prior=[{"citation": "A|B] C", "treatment": "varies", "scope": "partial"},
                                           {"title": "Second", "treatment": "overrules"}])
        self.write(ingest_authority, self.authority_request([doc]))
        self.assertEqual(self.q("SELECT notes FROM law.authorities"),
                         [("[TREATMENT-PENDING:A B  C|varies|partial]\n[TREATMENT-PENDING:Second|overrules|full]",)])

    def test_ingest_status_reports_a_pending_treatment_on_the_authority(self):
        self.write(ingest_authority, self.authority_request([self.authority()]))
        operation = (CASE_DATA_ROOT / "operations" / "ingest-status.md").read_text(encoding="utf-8")
        probe = re.search(r"```sql\n(-- ingest-status probe.*?)```", operation, re.S).group(1)
        code = re.search(r"```python\n(.*?def ingest_status.*?)```", operation, re.S).group(1)
        self.con.row_factory = sqlite3.Row
        rows = [dict(r) for r in self.con.execute(probe, (json.dumps([H]),)).fetchall()]
        self.con.row_factory = None
        namespace = {"stored_form": lambda path, root: path}
        exec(code, namespace)
        [entry] = namespace["ingest_status"]([{"path": "6. LAW\\Quillfeather.pdf", "hash": H}], rows, "root", str(self.dir))
        self.assertEqual((entry["verdict"], entry["store"], entry["pending"]), ("ingested", "law", ["treatment"]))

    def test_a_provision_stores_null_for_the_keys_it_lacks_and_one_calling_itself_case_law_is_set_aside(self):
        result = {"contract": "provision", "contract_version": 2, "ref": "f1", "flags": [],
                  "authority": {"title": "An Act", "citation": "RSBC 1996, c 1", "authority_type": "statute", "jurisdiction": "BC"},
                  "concepts": [{"name": "A duty", "jurisdiction": "BC", "concept_kind": "doctrine", "description": "d",
                                "authority_role": "establishes", "authority_proposition": "A duty.", "criteria": []}]}
        self.write(ingest_authority, self.authority_request([result], "provision"))
        self.assertEqual(self.q("SELECT authority_type, disposition, fact_pattern, notes FROM law.authorities"),
                         [("statute", None, None, None)])
        wrong = {**result, "authority": {**result["authority"], "authority_type": "case_law"}}
        plan = ingest_authority.plan(self.authority_request([wrong], "provision"))
        self.assertEqual(plan, {"blocked": "set_aside"})

    def test_a_result_that_fails_its_check_writes_nothing(self):
        plan = ingest_authority.plan(self.authority_request([self.authority(concepts=[{"name": None}])]))
        self.assertIn("problems", plan)

    def test_a_file_held_under_another_citation_is_refused(self):
        self.write(ingest_authority, self.authority_request([self.authority()]))
        other = self.authority(authority={"title": "Other", "citation": "2026 BCCA 1", "authority_type": "case_law"})
        _, out = self.write(ingest_authority, self.authority_request([other]))
        self.assertTrue(out["refused"][0].startswith("refused:"))

    def test_a_second_copy_is_recorded_by_reference_and_follows_a_tombstone(self):
        self.con.execute("INSERT INTO law.authorities (authority_id, title, citation, authority_type, notes) "
                         "VALUES (7, 'Canonical', '2026 BCCA 7', 'case_law', 'A note'), "
                         "(8, 'Merged', '2026 BCCA 8', 'case_law', '[MERGED-INTO:#7 2026-01-01 practitioner]')")
        self.con.commit()
        req = self.authority_request([], route={"ref": "f1", "kind": "caselaw", "second_copy_of": 8})
        _, out = self.write(ingest_authority, req)
        self.assertEqual(out["named"]["source_id"], 7)
        self.assertEqual(out["named"]["prior"], None)
        self.assertEqual(self.q("SELECT notes FROM law.authorities WHERE authority_id = 7"), [(f"A note\n[SECOND-COPY:{H}]",)])
        _, again = self.write(ingest_authority, req)
        self.assertEqual(again["named"]["prior"], 7, "a re-presented file is a no-op")
        self.assertEqual(self.q("SELECT notes FROM law.authorities WHERE authority_id = 7"), [(f"A note\n[SECOND-COPY:{H}]",)])

    def test_a_second_copy_of_an_authority_no_longer_on_file_is_refused(self):
        req = self.authority_request([], route={"ref": "f1", "kind": "caselaw", "second_copy_of": 99})
        _, out = self.write(ingest_authority, req)
        self.assertTrue(out["refused"][0].startswith("refused:"))

    def test_an_authority_whose_extraction_failed_twice_writes_nothing(self):
        plan, _ = self.write(ingest_authority, self.authority_request([]))
        self.assertTrue(plan["failed"])
        self.assertEqual(self.q("SELECT count(*) FROM law.authorities"), [(0,)])

    def test_the_legal_context_takes_out_every_party_name_and_serves_the_vocabulary(self):
        self.con.execute("INSERT INTO issues (title, description, issue_type, status, our_position) VALUES "
                         "('Did Quill rely on the promise?', 'Plum Holdings Ltd. says no.', 'legal', 'open', 'Secret'), "
                         "('A fact only', 'x', 'factual', 'open', NULL), ('Old', 'x', 'legal', 'resolved', NULL)")
        self.con.commit()
        self.con.execute(f"PRAGMA user_version = {resolve_paths.EXPECTED_USER_VERSION}")
        self.con.close()
        out = ingest_authority.dispatch_context({"case_data_dir": str(self.dir)})
        self.con = sqlite3.connect(self.dir / "main.sqlite")
        self.assertEqual(out["status"], "ok")
        self.assertEqual(out["legal_context"], [{"title": "Did a party rely on the promise?", "description": "a party says no."}])
        self.assertIn("establishes", out["treatment_vocabulary"])

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
        # B is already held listed and failed, so a reading that carries a privilege signal would hold
        # a listed row pending, which the sources check refuses: its group rolls back alone.
        self.con.execute("INSERT INTO sources (category, title, parent_source_id, ingestion_status, listed) "
                         "VALUES ('court', 'Exhibit B', 1, 'failed', 1)")
        a = self.exhibit("A", flags=[{"kind": "privilege_signal", "ref": "p4"}])
        b = self.exhibit("B", flags=[{"kind": "privilege_signal", "ref": "p6"}])
        plan, out = self.write(ingest_affidavit, self.exhibits([a, b], expected=("A", "B", "C")))
        self.assertEqual([(a["kind"], a["ref"]) for a in out["asks"]], [("privilege", "A")], "B's group rolled back")
        self.assertEqual([ref for ref, _ in out["failed"]], ["B"])
        self.assertEqual(self.q("SELECT title, privilege_status, ingestion_status, verified FROM sources WHERE parent_source_id IS NOT NULL ORDER BY source_id"),
                         [("Exhibit B", None, "failed", 0), ("Exhibit A — Doc A", "pending", "complete", 0)])
        self.assertEqual(self.q("SELECT count(*) FROM facts WHERE description = 'B says so.'"), [(0,)], "the failed group left nothing")
        self.assertEqual(self.q("SELECT count(*) FROM evidence_links"), [(0,)], "a pending exhibit takes no links")
        self.assertEqual(self.q("SELECT ingestion_status FROM sources WHERE parent_source_id IS NULL"), [("partial",)])
        # B and C fail twice: the closing call records them and completes the body.
        self.write(ingest_affidavit, self.exhibits([], expected=("A", "B", "C"), failed=["B", "C"]))
        self.assertEqual(self.q("SELECT notes, verified, ingestion_status FROM sources WHERE title = 'Exhibit C'"),
                         [("UNCONFIRMED: the exhibit could not be read after two attempts.", 2, "failed")])
        self.assertEqual(self.q("SELECT ingestion_status FROM sources WHERE parent_source_id IS NULL"), [("complete",)])
        before = self.q("SELECT count(*) FROM facts")
        _, out = self.write(ingest_affidavit, self.exhibits([self.exhibit("A")], expected=("A", "B", "C"), failed=["B", "C"]))
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

    def test_a_failed_exhibit_held_pending_stays_pending_and_takes_no_links(self):
        self.write_body()
        self.con.execute("INSERT INTO sources (category, title, parent_source_id, ingestion_status, verified, privilege_status) "
                         "VALUES ('court', 'Exhibit A', 1, 'failed', 2, 'pending')")
        self.write(ingest_affidavit, self.exhibits([self.exhibit("A")], expected=("A",)))
        self.assertEqual(self.q("SELECT title, ingestion_status, privilege_status FROM sources WHERE parent_source_id IS NOT NULL"),
                         [("Exhibit A — Doc A", "complete", "pending")], "a re-read never changes privilege_status")
        self.assertEqual(self.q("SELECT count(*) FROM evidence_links"), [(0,)])

    def test_a_cleared_exhibit_re_read_with_a_privilege_signal_stays_cleared_takes_links_and_is_not_asked(self):
        self.write_body()
        self.con.execute("INSERT INTO sources (category, title, parent_source_id, ingestion_status, verified, privilege_status) "
                         "VALUES ('court', 'Exhibit A', 1, 'failed', 2, 'cleared')")
        a = self.exhibit("A", flags=[{"kind": "privilege_signal", "ref": "p4"}])
        _, out = self.write(ingest_affidavit, self.exhibits([a], expected=("A",)))
        self.assertEqual(self.q("SELECT ingestion_status, privilege_status FROM sources WHERE parent_source_id IS NOT NULL"),
                         [("complete", "cleared")])
        self.assertEqual(self.q("SELECT count(*) FROM evidence_links"), [(1,)], "the stored status decides the links")
        self.assertEqual(out["asks"], [], "a privilege already decided is not asked again")

    def test_a_failed_exhibit_held_pending_re_read_without_a_signal_is_asked_as_pending(self):
        self.write_body()
        self.con.execute("INSERT INTO sources (category, title, parent_source_id, ingestion_status, verified, privilege_status) "
                         "VALUES ('court', 'Exhibit A', 1, 'failed', 2, 'pending')")
        _, out = self.write(ingest_affidavit, self.exhibits([self.exhibit("A")], expected=("A",)))
        self.assertEqual([(a["kind"], a["ref"]) for a in out["asks"]], [("privilege", "A")])

    def test_a_group_that_rolls_back_leaves_its_fallback_row_which_the_next_reading_reuses(self):
        self.write_body()
        plan = ingest_affidavit.plan(self.exhibits([self.exhibit("A"), self.exhibit("B")]))
        group_b = next(g for g in plan["statements"] if g.get("ref") == "B")
        group_b["statements"].append({"sql": "INSERT INTO main.facts (description) VALUES (NULL)"})
        out = run_plan(self.con, plan)
        self.assertEqual([ref for ref, _ in out["failed"]], ["B"])
        fallback = self.q("SELECT source_id, title, ingestion_status, verified, notes FROM sources WHERE title LIKE 'Exhibit B%'")
        self.assertEqual([row[1:] for row in fallback], [("Exhibit B", "failed", 2, ingest_affidavit.NOTE_FAILED)])
        self.write(ingest_affidavit, self.exhibits([self.exhibit("B")]))
        self.assertEqual(self.q("SELECT source_id, title, ingestion_status, verified FROM sources WHERE title LIKE 'Exhibit B%'"),
                         [(fallback[0][0], "Exhibit B — Doc B", "complete", 0)])

    def test_a_signalled_re_read_of_an_exhibit_on_file_with_no_privilege_hold_is_reported(self):
        self.write_body()
        self.con.execute("INSERT INTO sources (category, title, parent_source_id, ingestion_status, verified) "
                         "VALUES ('court', 'Exhibit A', 1, 'complete', 0)")
        a = self.exhibit("A", flags=[{"kind": "privilege_signal", "ref": "p4"}])
        _, out = self.write(ingest_affidavit, self.exhibits([a], expected=("A",)))
        self.assertEqual(out["asks"], [])
        self.assertEqual(len(out["reports"]), 1, out["reports"])
        self.assertRegex(out["reports"][0], r"^Exhibit A may be privileged.*not decided again")
        # A signalled reading of a cleared row says nothing more.
        self.con.execute("UPDATE sources SET privilege_status = 'cleared' WHERE title LIKE 'Exhibit A%'")
        _, out = self.write(ingest_affidavit, self.exhibits([a], expected=("A",)))
        self.assertEqual(out["reports"], [])

    def test_a_twice_failed_exhibit_held_pending_is_not_asked_again_on_every_call(self):
        self.write_body()
        self.con.execute("INSERT INTO sources (category, title, parent_source_id, ingestion_status, verified, privilege_status) "
                         "VALUES ('court', 'Exhibit A', 1, 'failed', 2, 'pending')")
        _, out = self.write(ingest_affidavit, self.exhibits([], expected=("A",), failed=["A"]))
        self.assertEqual(out["asks"], [])

    def test_no_exhibit_list_refuses_an_exhibit_write(self):
        self.write_body()
        plan = ingest_affidavit.plan(self.exhibits([self.exhibit("A")], expected=()))
        self.assertIn("problems", plan)


if __name__ == "__main__":
    unittest.main()
