#!/usr/bin/env python3
"""
migrate_practice_db: a legacy practice.db that fills every table converts to the item form,
round-trips with no difference, seeds a fake Probanda's Cloud and swaps in; and the run
refuses or stops, leaving the original byte-identical, wherever it should.

The fixture's schema is read from git history at test time (the legacy SCHEMA_SQL in
3049ddc^), so no file here holds any DDL. Seed and sync go to a fake on 127.0.0.1.
The hash parity tests need the data server's tsc build:
    source/practice/mcp/node_modules/.bin/tsc -p source/practice/mcp

Run: python -m pytest -q scripts/tests/test_migrate_practice_db.py
"""

import base64
import datetime
import hashlib
import importlib.util
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
REPO = SCRIPTS.parent
SCRIPT = SCRIPTS / "migrate_practice_db.py"
OPS_JS = REPO / "source" / "practice" / "mcp" / "build" / "practice" / "ops.js"
LEGACY_REV = "3049ddc^"
LEGACY_BACKEND = "source/practice/mcp/src/practice/backend.ts"

_spec = importlib.util.spec_from_file_location("migrate_practice_db", SCRIPT)
migrate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(migrate)

FAKE_KEY = "sb_secret_fake_migration_test_key"
SEQ = 41


def legacy_schema():
    text = subprocess.run(["git", "-C", str(REPO), "show", "%s:%s" % (LEGACY_REV, LEGACY_BACKEND)],
                          check=True, capture_output=True, text=True, encoding="utf-8").stdout
    match = re.search(r"const SCHEMA_SQL = `(.*?)`\.trim\(\);", text, re.S)
    assert match, "no SCHEMA_SQL in %s:%s" % (LEGACY_REV, LEGACY_BACKEND)
    return match.group(1)


def ids(*names):
    return {name: str(uuid.uuid4()) for name in names}


def ts(day, minute=0):
    return "2026-0%d-%02dT10:%02d:00.000Z" % (1 + day // 28, 1 + day % 28, minute)


def overlay_record(record_id):
    return {
        "record_id": record_id,
        "jurisdiction": "CA-BC",
        "enactment": {"name": "Supreme Court Civil Rules", "citation": "B.C. Reg. 168/2009", "civix_id": "168_2009_00"},
        "amending_instrument": {"reg": "B.C. Reg. 120/2026", "oic": "OIC 456/2026", "commencement": "2026-07-01"},
        "deadline_type": "notice_of_application_service",
        "anchor_type": "hearing_date",
        "base": "anchor",
        "rule_ref": "8-1(8)",
        "offset": {"value": 8, "unit": "business_days", "direction": "before", "clear": True},
        "counting": "backward_full_business_days",
        "semantics": "latest_permissible",
        "description": "Serve the notice of application 8 business days before the hearing",
        "verbatim": "must be served at least 8 business days before the date set for the hearing",
        "source": {"url": "https://www.bclaws.gov.bc.ca/example", "fetched_at": "2026-07-02T09:00:00Z", "kind": "oic_pdf"},
        "effective_from": "2026-07-01",
        "effective_to": None,
        "supersedes": ["shipped:notice_of_application_service"],
        "open_questions": [],
        "status": "verified",
        "verified_by": "practitioner",
        "verified_at": "2026-07-02",
        "pool_id": None,
    }


def make_fixture(path):
    """A legacy practice.db with rows in every table, built on the legacy schema from git history."""
    i = ids("c1", "c2", "m1", "m2", "t1", "t2", "t3", "i1", "i2", "i3", "k1", "k2", "k3", "r1",
            "a1", "a2", "a3", "a4", "s1", "s2", "s3", "s4", "s5",
            "d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "p1", "p2", "g1", "g2", "y1", "y2", "day1", "day2", "o1")
    rows = {
        "practice_clients": [
            dict(id=i["c1"], name="Café Holdings 😀 Ltd", client_num="2575", orig_lawyer="BD", resp_lawyer="BD",
                 type_of_law="Litigation", major_client="Y", created_at=ts(1), updated_at=ts(1)),
            dict(id=i["c2"], name="Smith, J. \"Jo\"", client_num="8575", orig_lawyer=None, resp_lawyer="BD",
                 type_of_law=None, major_client=None, created_at=ts(2), updated_at=ts(3)),
        ],
        "practice_matters": [
            dict(id=i["m1"], client_id=i["c1"], description="Café v. Smith\nBCSC", file_number="S-123456",
                 matt_num="L8443", orig_lawyer="BD", resp_lawyer="BD", status="active", type_of_law="Litigation",
                 billable=1, regular_trust=-1500.0, term_trust=0.0, last_trust_date="2026-09-30",
                 created_at=ts(2), updated_at=ts(2)),
            dict(id=i["m2"], client_id=i["c2"], description="Estate advice", file_number=None, matt_num="L101",
                 orig_lawyer=None, resp_lawyer=None, status=None, type_of_law=None, billable=0,
                 regular_trust=None, term_trust=None, last_trust_date=None, created_at=ts(3), updated_at=ts(3)),
        ],
        "practice_time_entries": [
            dict(id=i["t1"], matter_id=i["m1"], description="Drafted letter\tto counsel", entry_date="2026-10-01",
                 hours=1.0, billable=1, batch_tag="batch-2026-10", created_at=ts(4), updated_at=ts(4)),
            dict(id=i["t2"], matter_id=i["m1"], description="Call", entry_date="2026-10-02", hours=0.1,
                 billable=0, batch_tag=None, created_at=ts(4, 1), updated_at=ts(4, 1)),
            dict(id=i["t3"], matter_id=i["m2"], description="Réunion", entry_date="2026-10-03", hours=2.5,
                 billable=0, batch_tag="batch-2026-10", created_at=ts(4, 1), updated_at=ts(4, 1)),
        ],
        "practice_invoices": [
            dict(id=i["i1"], matter_id=i["m1"], invoice_number="1001", issue_date="2026-10-05",
                 date_to="2026-09-30", amount=1200.0, amount_paid=0.0, status="unpaid",
                 last_import_at="2026-10-06T08:00:00.000Z", created_at=ts(5), updated_at=ts(5)),
            dict(id=i["i2"], matter_id=i["m1"], invoice_number=None, issue_date="2026-08-05", date_to=None,
                 amount=300.5, amount_paid=None, status=None, last_import_at="2026-10-06T08:00:00.000Z",
                 created_at=ts(5, 1), updated_at=ts(5, 1)),
            dict(id=i["i3"], matter_id=i["m1"], invoice_number=None, issue_date=None, date_to=None,
                 amount=0.0, amount_paid=None, status="paid", last_import_at=None,
                 created_at=ts(5, 2), updated_at=ts(5, 2)),
        ],
        "practice_tasks": [
            dict(id=i["k1"], matter_id=i["m1"], description="File the application response", task_type="client",
                 time_estimate_hours=2.0, actual_hours=None, deadline_date="2026-10-20", status="open",
                 completed_at=None, next_nudge_date="2026-10-15", nudge_interval_days=3, last_nudged_at=None,
                 created_at=ts(6), updated_at=ts(6), filing_ref="filing:3"),
            dict(id=i["k2"], matter_id=None, description="Renew insurance", task_type="admin",
                 time_estimate_hours=None, actual_hours=0.75, deadline_date=None, status="completed",
                 completed_at="2026-10-02T12:00:00.000Z", next_nudge_date=None, nudge_interval_days=None,
                 last_nudged_at=None, created_at=ts(6, 1), updated_at=ts(7), filing_ref=None),
            dict(id=i["k3"], matter_id=i["m1"], description="Old draft", task_type="professional",
                 time_estimate_hours=None, actual_hours=None, deadline_date=None, status="withdrawn",
                 completed_at=None, next_nudge_date=None, nudge_interval_days=None, last_nudged_at=None,
                 created_at=ts(6, 2), updated_at=ts(6, 2), filing_ref="proceeding:2"),
        ],
        "practice_retainer_notices": [
            dict(id=i["r1"], matter_id=i["m1"], sent_at="2026-09-01T09:00:00.000Z", created_at=ts(7), updated_at=ts(7)),
        ],
        "practice_anchors": [
            # Conflicted: two sources assert different dates.
            dict(id=i["a1"], matter_id=i["m1"], anchor_type="trial_date", anchor_date="2027-03-01",
                 status="conflicted", party_label="", proceeding_label=None, created_at=ts(8), updated_at=ts(9),
                 filing_ref="filing:3"),
            dict(id=i["a2"], matter_id=i["m1"], anchor_type="service_date", anchor_date="2026-10-01",
                 status="active", party_label="Plaintiff", proceeding_label="S-123456", created_at=ts(8, 1),
                 updated_at=ts(8, 1), filing_ref=None),
            dict(id=i["a3"], matter_id=i["m1"], anchor_type="hearing_date", anchor_date="2026-11-01",
                 status="superseded", party_label=None, proceeding_label=None, created_at=ts(8, 2),
                 updated_at=ts(8, 2), filing_ref=None),
            dict(id=i["a4"], matter_id=i["m2"], anchor_type="hearing_date", anchor_date="2026-09-01",
                 status="occurred", party_label=None, proceeding_label=None, created_at=ts(8, 3),
                 updated_at=ts(8, 3), filing_ref=None),
        ],
        "practice_anchor_sources": [
            dict(id=i["s1"], anchor_id=i["a1"], source_document="Notice of Trial.pdf",
                 source_excerpt="Trial set for March 1, 2027", stated_date="2026-09-15",
                 asserted_date="2027-03-01", status="conflicted", created_at=ts(8), updated_at=ts(9)),
            dict(id=i["s2"], anchor_id=i["a1"], source_document="Email from registry.msg", source_excerpt=None,
                 stated_date="2026-09-20", asserted_date="2027-03-08", status="conflicted",
                 created_at=ts(9), updated_at=ts(9)),
            dict(id=i["s3"], anchor_id=i["a2"], source_document="Affidavit of Service.pdf",
                 source_excerpt="served on October 1", stated_date="2026-10-02", asserted_date="2026-10-01",
                 status="confirmed", created_at=ts(8, 1), updated_at=ts(8, 1)),
            dict(id=i["s4"], anchor_id=i["a2"], source_document="Draft affidavit.docx", source_excerpt="",
                 stated_date="2026-09-29", asserted_date="2026-09-30", status="superseded",
                 created_at=ts(8, 1), updated_at=ts(8, 2)),
            dict(id=i["s5"], anchor_id=i["a3"], source_document=None, source_excerpt=None,
                 stated_date="2026-09-01", asserted_date="2026-11-01", status="pending",
                 created_at=ts(8, 2), updated_at=ts(8, 2)),
        ],
        "practice_deadlines": [
            dict(id=i["d1"], matter_id=i["m1"], anchor_id=i["a2"], source_document="Affidavit of Service.pdf",
                 deadline_type="response_to_civil_claim", deadline_date="2026-10-22", rule_ref="3-3(3)",
                 rule_description="Response to civil claim", source_type="bc_rules", status="active",
                 review_flag=None, review_note=None, party_label="", proceeding_label="",
                 scenario_label=None, expiry_notified_at=None, created_at=ts(10), updated_at=ts(10)),
            # Two alternatives awaiting the practitioner's choice.
            dict(id=i["d2"], matter_id=i["m1"], anchor_id=i["a1"], source_document=None,
                 deadline_type="trial_record", deadline_date="2027-02-15", rule_ref="12-3(3)",
                 rule_description="Trial record", source_type="bc_rules", status="active",
                 review_flag="practitioner_choice", review_note="Which trial date stands?", party_label=None,
                 proceeding_label=None, scenario_label="March 1 trial", expiry_notified_at=None,
                 created_at=ts(10, 1), updated_at=ts(10, 1)),
            dict(id=i["d3"], matter_id=i["m1"], anchor_id=i["a1"], source_document=None,
                 deadline_type="trial_record", deadline_date="2027-02-22", rule_ref="12-3(3)",
                 rule_description="Trial record", source_type="bc_rules", status="active",
                 review_flag="practitioner_choice", review_note="Which trial date stands?", party_label=None,
                 proceeding_label=None, scenario_label="March 8 trial", expiry_notified_at=None,
                 created_at=ts(10, 2), updated_at=ts(10, 2)),
            dict(id=i["d4"], matter_id=i["m1"], anchor_id=i["a2"], source_document=None,
                 deadline_type="response_to_civil_claim", deadline_date="2026-10-21", rule_ref="3-3(3)",
                 rule_description="Response to civil claim", source_type="bc_rules", status="superseded",
                 review_flag=None, review_note=None, party_label=None, proceeding_label=None,
                 scenario_label=None, expiry_notified_at=None, created_at=ts(9, 5), updated_at=ts(10)),
            dict(id=i["d5"], matter_id=i["m1"], anchor_id=None, source_document="Order.pdf",
                 deadline_type="document_production", deadline_date="2026-09-30", rule_ref="order para 4",
                 rule_description="Other side produces documents", source_type="order_term",
                 status="not_applicable", review_flag=None, review_note=None, party_label="Defendant",
                 proceeding_label=None, scenario_label=None, expiry_notified_at="2026-10-01T08:00:00.000Z",
                 created_at=ts(11), updated_at=ts(11)),
            dict(id=i["d6"], matter_id=i["m1"], anchor_id=None, source_document=None,
                 deadline_type="list_of_documents", deadline_date="2026-08-30", rule_ref="7-1(1)",
                 rule_description="List of documents", source_type="manual", status="met",
                 review_flag="shift_pending", review_note="moved", party_label=None, proceeding_label=None,
                 scenario_label=None, expiry_notified_at=None, created_at=ts(11, 1), updated_at=ts(11, 1)),
            dict(id=i["d7"], matter_id=i["m2"], anchor_id=i["a4"], source_document=None,
                 deadline_type="hearing_record", deadline_date="2026-08-25", rule_ref="8-1(15)",
                 rule_description="Application record", source_type="bc_rules", status="dismissed",
                 review_flag="limited_day", review_note=None, party_label=None, proceeding_label=None,
                 scenario_label=None, expiry_notified_at=None, created_at=ts(11, 2), updated_at=ts(11, 2)),
            dict(id=i["d8"], matter_id=None, anchor_id=None, source_document=None,
                 deadline_type="notice_of_application_service", deadline_date="2026-11-10", rule_ref="8-1(8)",
                 rule_description="Serve notice of application", source_type="bc_rules", status="stale",
                 review_flag="rule_stale", review_note="overlay pending", party_label=None,
                 proceeding_label=None, scenario_label=None, expiry_notified_at=None,
                 created_at=ts(11, 3), updated_at=ts(11, 3)),
        ],
        "practice_payment_in_flight": [
            dict(id=i["p1"], matter_id=i["m1"], notes="Cheque 1042", amount=500.0, recorded_at=ts(12),
                 expected_clear_by="2026-10-20", cleared=0, created_at=ts(12), updated_at=ts(12)),
            dict(id=i["p2"], matter_id=i["m1"], notes=None, amount=125.25, recorded_at=ts(12, 1),
                 expected_clear_by=None, cleared=1, created_at=ts(12, 1), updated_at=ts(13)),
        ],
        "practice_matter_signals": [
            dict(id=i["g1"], matter_id=i["m1"], note="Checked 2026-01-02", signal_key="conflict_check_completed",
                 state="confirmed", confirmed_at="2026-01-02T00:00:00.000Z", created_at=ts(13), updated_at=ts(13)),
            dict(id=i["g2"], matter_id=i["m1"], note=None, signal_key="retainer_agreement_signed",
                 state="unconfirmed", confirmed_at=None, created_at=ts(13, 1), updated_at=ts(13, 1)),
        ],
        "practice_court_calendar_coverage": [
            dict(id=i["y1"], year=2026, status="confirmed", source_document="2026 court calendar.pdf",
                 checked_at="2026-01-03T00:00:00.000Z", created_at=ts(14), updated_at=ts(14)),
            dict(id=i["y2"], year=2027, status="unavailable", source_document=None,
                 checked_at="2026-10-01T00:00:00.000Z", created_at=ts(14, 1), updated_at=ts(14, 1)),
        ],
        "practice_court_calendar_days": [
            dict(id=i["day1"], calendar_date="2026-12-25", status_category="full_closure", status_label="Christmas Day",
                 courthouse_scope=None, source_document="2026 court calendar.pdf", created_at=ts(14), updated_at=ts(14)),
            dict(id=i["day2"], calendar_date="2026-08-03", status_category="limited", status_label="B.C. Day (limited)",
                 courthouse_scope="Vancouver", source_document=None, created_at=ts(14), updated_at=ts(14)),
        ],
        "practice_rule_overlay": [
            dict(id=i["o1"], deadline_type="notice_of_application_service", rule_ref="8-1(8)",
                 amending_reg="B.C. Reg. 120/2026", effective_from="2026-07-01", effective_to=None,
                 status="verified", record=json.dumps(overlay_record(i["o1"])), created_at=ts(15), updated_at=ts(15)),
        ],
        "practice_status_policies": [
            dict(id=str(uuid.uuid4()), status_label=label, required_signals=json.dumps(required, separators=(",", ":")),
                 blocking_signals=None if blocking is None else json.dumps(blocking, separators=(",", ":")),
                 auto_advance=1 if auto else 0, description=description, created_at=ts(0), updated_at=ts(0))
            for label, required, blocking, auto, description in migrate.DEFAULT_POLICIES
        ],
    }
    con = sqlite3.connect(path)
    con.execute("PRAGMA journal_mode = DELETE")
    con.executescript(legacy_schema())
    for table, table_rows in rows.items():
        for row in table_rows:
            con.execute('INSERT INTO "%s" (%s) VALUES (%s)' % (table, ",".join(row), ",".join("?" * len(row))),
                        list(row.values()))
    con.commit()
    con.close()
    return i, rows


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class FakeCloud:
    """items-seed and items-sync on 127.0.0.1, with the ledger behaviour the migration relies on."""

    def __init__(self):
        self.requests = []
        self.items = []
        self.questions = []
        self.hang_sync = False
        self.sync_reached = threading.Event()
        self.release = threading.Event()
        cloud = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def reply(self, status, body):
                data = json.dumps(body).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_POST(self):
                raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                cloud.requests.append({"path": self.path, "raw": raw, "apikey": self.headers.get("apikey")})
                if self.headers.get("apikey") != FAKE_KEY:
                    return self.reply(401, {"error": "unauthorized"})
                body = json.loads(raw)
                if self.path.endswith("/functions/v1/items-seed"):
                    cloud.items = body["items"]
                    questions = [{"id": q[0], "question": q[1]} for q in cloud.questions]
                    return self.reply(200, {"seeded": len(cloud.items), "questions": questions})
                if self.path.endswith("/functions/v1/items-sync"):
                    cloud.sync_reached.set()
                    if cloud.hang_sync:
                        cloud.release.wait(60)
                        return
                    items = [{
                        "id": e["id"], "kind": e["kind"], "state": e["state"],
                        "tags": {k: v for k, v in e["tags"].items() if v is not None},
                        "links": {k: v for k, v in e["links"].items()
                                  if v is not None and not (e["kind"] == "calendar_day" and k == "calendar_year")},
                        "deleted": False,
                    } for e in cloud.items]
                    return self.reply(200, {"items": items, "seq": SEQ})
                self.reply(404, {"error": "no such function"})

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = "http://127.0.0.1:%d" % self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.release.set()
        self.server.shutdown()
        self.server.server_close()

    def seed_body(self):
        return next(json.loads(r["raw"]) for r in self.requests if r["path"].endswith("items-seed"))


def node_ops(vector, key):
    """canonicalJson and hashValue of each value, from the data server's own compiled ops.js."""
    script = (
        "import { readFileSync } from 'node:fs';"
        "import { pathToFileURL } from 'node:url';"
        "const ops = await import(pathToFileURL(process.argv[1]).href);"
        "const values = JSON.parse(readFileSync(process.argv[2], 'utf8'));"
        "const key = Buffer.from(process.argv[3], 'base64');"
        "process.stdout.write(JSON.stringify(values.map((v) => [ops.canonicalJson(v), ops.hashValue(key, v)])));"
    )
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "vector.json"
        # ensure_ascii: a lone surrogate survives the trip to JSON.parse as one.
        path.write_text(json.dumps(vector, ensure_ascii=True), encoding="utf-8")
        result = subprocess.run(["node", "--input-type=module", "-e", script, "--", str(OPS_JS), str(path),
                                 base64.b64encode(key).decode("ascii")], capture_output=True, text=True,
                                encoding="utf-8", check=True)
    return json.loads(result.stdout)


# Values whose JSON differs between Python and JavaScript, or whose order or escaping could.
PARITY_VECTOR = [
    2.0, 2, -0.0, 0, 0.1, 1.5, -3.25, 100.0, 1e21, 1e20, 123456789012345680000.0, 1e-6, 1e-7, 5e-324,
    1.7976931348623157e308, 12345678.9, 0.000123, 2 ** 53, 2 ** 53 + 1, 2 ** 60, -(2 ** 31),
    True, False, None, "", "café", "日本語", "😀", "  ", "\x00\x01\x1f\x7f", "\"\\/\b\f\n\r\t",
    "\ud800 lone", "L8443 matter", [], {}, [1.0, "x", None, [2.0]],
    {"b": 1, "a": [1.0, {"z": None, "é": "x", "😀": 1, "！": 2, "A": True}], "": 0},
    {"record": {"offset": {"value": 8.0, "clear": True}, "verbatim": "8 business days — before"}},
]


@unittest.skipUnless(OPS_JS.is_file(), "build the data server first: tsc -p source/practice/mcp")
class HashParityTest(unittest.TestCase):
    def test_canonical_json_and_hash_equal_ops_js(self):
        key = os.urandom(32)
        expected = node_ops(PARITY_VECTOR, key)
        for value, (canonical, digest) in zip(PARITY_VECTOR, expected):
            with self.subTest(value=value):
                self.assertEqual(migrate.canonical_json(value), canonical)
                self.assertEqual(migrate.hash_value(key, value), digest)
        self.assertEqual(len(expected), len(PARITY_VECTOR))


class MigrationRunTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="migrate-practice-"))
        self.db = self.tmp / "practice.db"
        self.ids, self.rows = make_fixture(self.db)
        self.original = sha256(self.db)
        self.cloud = FakeCloud()
        self.legacy = self.tmp / ("practice.legacy-%s.db" % datetime.date.today().isoformat())
        self.new = self.tmp / "practice.new.db"

    def tearDown(self):
        self.cloud.close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def env(self):
        env = dict(os.environ)
        env["LEGAL_COMMONS_SUPABASE_KEY"] = FAKE_KEY
        # The stored credential lives under LOCALAPPDATA: point it at an empty folder.
        env["LOCALAPPDATA"] = str(self.tmp / "localappdata")
        env["APPDATA"] = str(self.tmp / "appdata")
        return env

    def command(self, db=None, env_key=True):
        cmd = [sys.executable, str(SCRIPT), str(db or self.db), "--cloud-url", self.cloud.url]
        return cmd + ["--env-key"] if env_key else cmd

    def run_script(self, db=None, env_key=True):
        result = subprocess.run(self.command(db, env_key), capture_output=True, text=True, encoding="utf-8",
                                env=self.env())
        self.assertNotIn(FAKE_KEY, result.stdout + result.stderr)
        return result

    def kv(self, path, namespace):
        con = sqlite3.connect(path)
        try:
            return {k: json.loads(v) for k, v in
                    con.execute("SELECT key, value FROM kv_store WHERE namespace = ?", (namespace,))}
        finally:
            con.close()

    def test_fixture_converts_round_trips_seeds_and_swaps(self):
        self.cloud.questions = [(self.ids["d3"], "Which of {{item:%s}} and {{item:%s}} is the current deadline?"
                                 % (self.ids["d2"], self.ids["d3"]))]
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("round trip with 0 differences", result.stdout)
        # The question is printed with each item described from practice.db.
        self.assertIn('%s "Trial record"' % self.ids["d2"], result.stdout)

        # Swapped: the original, byte-identical, under its legacy name; the item form in its place.
        self.assertEqual(sha256(self.legacy), self.original)
        self.assertFalse(self.new.exists())
        con = sqlite3.connect(self.db)
        tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type = 'table'")]
        con.close()
        self.assertEqual(tables, ["kv_store"])

        # One item per row, of the table's kind.
        items = self.kv(self.db, "item")
        for table, spec in migrate.TABLES.items():
            kind_items = {k for k, v in items.items() if v["kind"] == spec["kind"]}
            self.assertEqual(kind_items, {r["id"] for r in self.rows[table]}, table)
        self.assertEqual(len(items), sum(len(self.rows[t]) for t in migrate.TABLES))

        meta = self.kv(self.db, "meta")
        self.assertEqual(set(meta), {"format", "tenant", "hash_key", "sync_seq"})
        self.assertEqual(meta["format"], "items-1")
        self.assertEqual(meta["sync_seq"], str(SEQ))
        self.assertEqual(len(base64.b64decode(meta["hash_key"])), 32)
        self.assertEqual(self.kv(self.db, "pending"), {})

        # The item form, as step 5's tools store it.
        self.assertEqual(items[self.ids["k1"]]["links"], {"matter": self.ids["m1"], "filing": "filing:3"})
        self.assertEqual(items[self.ids["m2"]]["tags"], {"billable": False})
        self.assertIsNone(items[self.ids["m2"]]["state"])
        self.assertEqual(items[self.ids["p1"]]["state"], "false")
        self.assertEqual(items[self.ids["p2"]]["state"], "true")
        self.assertEqual(items[self.ids["d1"]]["tags"], {"deadline_type": "response_to_civil_claim",
                                                         "source_type": "bc_rules"})
        self.assertEqual(items[self.ids["day1"]]["links"], {})
        self.assertEqual(items[self.ids["o1"]]["data"]["record"], overlay_record(self.ids["o1"]))
        self.assertEqual(items[self.ids["o1"]]["tags"], {"deadline_type": "notice_of_application_service",
                                                         "amending_reg": "B.C. Reg. 120/2026"})

        # The seed: the tenant, metadata and hashes only; a calendar day carries its year.
        seed = self.cloud.seed_body()
        self.assertEqual(seed["tenant"], meta["tenant"])
        self.assertEqual(seed["store"], "practice")
        by_id = {e["id"]: e for e in seed["items"]}
        self.assertEqual(by_id[self.ids["day1"]]["links"], {"calendar_year": self.ids["y1"]})
        self.assertEqual(by_id[self.ids["o1"]]["cross"], overlay_record(self.ids["o1"]))
        self.assertTrue(all(set(e) <= {"id", "kind", "state", "tags", "links", "hashes", "cross"}
                            for e in seed["items"]))
        seed_text = next(r["raw"] for r in self.cloud.requests if r["path"].endswith("items-seed")).decode("utf-8")
        for clear in ("Café Holdings", "Drafted letter", "S-123456", "L8443", "Notice of Trial", "Cheque 1042",
                      meta["hash_key"]):
            self.assertNotIn(clear, seed_text)
        # Empty labels are sent as null.
        self.assertIsNone(by_id[self.ids["a1"]]["hashes"]["party_label"])
        self.assertIsNone(by_id[self.ids["d1"]]["hashes"]["proceeding_label"])

    @unittest.skipUnless(OPS_JS.is_file(), "build the data server first: tsc -p source/practice/mcp")
    def test_seeded_hashes_equal_ops_js(self):
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        key = base64.b64decode(self.kv(self.db, "meta")["hash_key"])
        items = self.kv(self.db, "item")
        sent, values = [], []
        for entry in self.cloud.seed_body()["items"]:
            for field, digest in entry["hashes"].items():
                value = items[entry["id"]]["data"][field]
                if value is None or (field.endswith("_label") and value == ""):
                    self.assertIsNone(digest)
                    continue
                sent.append(digest)
                values.append(value)
        self.assertGreater(len(values), 100)
        self.assertEqual(sent, [digest for _, digest in node_ops(values, key)])

    def test_refuses_an_already_converted_file(self):
        self.assertEqual(self.run_script().returncode, 0)
        converted = sha256(self.db)
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertIn("already converted", result.stderr)
        self.assertEqual(sha256(self.db), converted)
        self.assertFalse(self.new.exists())

    def test_a_run_killed_before_the_swap_leaves_the_original_byte_identical(self):
        self.cloud.hang_sync = True
        process = subprocess.Popen(self.command(), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   env=self.env())
        try:
            self.assertTrue(self.cloud.sync_reached.wait(60), "the run never reached items-sync")
            self.assertTrue(self.new.exists())
        finally:
            process.kill()
            process.wait(30)
        self.assertEqual(sha256(self.db), self.original)
        self.assertFalse(self.legacy.exists())

    def test_non_default_policies_stop_the_run(self):
        con = sqlite3.connect(self.db)
        con.execute("UPDATE practice_status_policies SET auto_advance = 1 WHERE status_label = 'closing'")
        con.execute("DELETE FROM practice_status_policies WHERE status_label = 'declined'")
        con.commit()
        con.close()
        changed = sha256(self.db)
        result = self.run_script()
        self.assertEqual(result.returncode, 1)
        self.assertIn("not exactly the eight defaults", result.stderr)
        self.assertIn("'closing': auto_advance is True, the default is False", result.stderr)
        self.assertIn("'declined' has no policy", result.stderr)
        self.assertEqual(sha256(self.db), changed)
        self.assertFalse(self.new.exists())
        self.assertEqual(self.cloud.requests, [])

    def test_the_environment_key_is_ignored_by_default(self):
        result = self.run_script(env_key=False)
        self.assertEqual(result.returncode, 1)
        self.assertIn("credential is missing", result.stderr)
        self.assertEqual(sha256(self.db), self.original)
        self.assertFalse(self.new.exists())
        self.assertEqual(self.cloud.requests, [])


class RoundTripTest(unittest.TestCase):
    def test_the_round_trip_finds_a_changed_item(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = Path(tmp) / "practice.db"
            fixture_ids, _ = make_fixture(db)
            legacy = migrate.read_legacy(db)
        built = migrate.build_items(legacy, os.urandom(32))
        items = {item_id: json.loads(migrate.js_json(item)) for item_id, item, _ in built}
        self.assertEqual(migrate.round_trip_differences(legacy, items), [])
        items[fixture_ids["t1"]]["data"]["hours"] = 1.5
        del items[fixture_ids["k1"]]["links"]["filing"]
        differences = migrate.round_trip_differences(legacy, items)
        self.assertEqual(len(differences), 2, differences)
        self.assertIn("hours was 1, rebuilt 1.5", differences[0] + differences[1])


if __name__ == "__main__":
    unittest.main()
