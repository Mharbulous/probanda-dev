#!/usr/bin/env python3
"""
Converts one legacy practice.db to the item form and seeds Probanda's Cloud with it.

    python scripts/migrate_practice_db.py <path to practice.db> [--cloud-url URL] [--env-key]

Migration steps 3 to 6 of docs/Plans/2026-10-14_practice-db-conversion.md, for one file:

1. Refuses a file already converted (its only table is kv_store).
2. Reads every row of the 15 legacy tables, and stops unless the status
   policies are exactly the eight defaults.
3. Writes practice.new.db beside the original, in the item form the data
   server's practice store keeps (source/practice/mcp/src/practice/store.ts),
   under a new tenant id and a new 32-byte hash key.
4. Rebuilds every old row from its item with the data server's generic
   flattening (items.ts) and compares field by field. Any difference stops the
   run before anything is sent.
5. Posts every item's metadata and keyed hashes (ops.ts) to items-seed, prints
   each question the cloud asks, runs items-sync from 0 and checks that the
   cloud holds the same items, states, tags and synced links. The sync position
   is stored as sync_seq.
6. Renames practice.db to practice.legacy-<YYYY-MM-DD>.db and practice.new.db
   to practice.db.

The legacy file is only ever opened read-only, so a run stopped before step 6
leaves it byte-identical.

The cloud key is the stored commons credential, read by the data server's own
loader (source/mcp-shared/commons-key.js) with the key environment variables
blanked, because the shell may hold a stale one. --env-key lets those variables
win, as the data server does. The key is never printed. --cloud-url replaces the
project URL (the tests point it at a local fake).

Private to this repository and never shipped: it names the legacy tables, which
Exception 2 allows on Probanda's own machines until practice-data leaves its list.
"""

import argparse
import base64
import datetime
import decimal
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import subprocess
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
KV_SOURCE = REPO / "source" / "practice" / "mcp" / "src" / "kv" / "backend.ts"
COMMONS_KEY = REPO / "source" / "mcp-shared" / "commons-key.js"

FORMAT = "items-1"
STORE = "practice"

# The legacy tables, in seed order. For each: the item kind, its data fields (stored locally,
# sent only as hashes), its tag fields, the field holding its state, and its links as
# role -> field. The plan's "How each current table maps" table, as step 5's tools store it.
TABLES = {
    "practice_clients": {
        "kind": "client",
        "data": ["name", "client_num", "orig_lawyer", "resp_lawyer", "type_of_law", "major_client"],
    },
    "practice_matters": {
        "kind": "matter",
        "data": ["description", "file_number", "matt_num", "orig_lawyer", "resp_lawyer", "type_of_law",
                 "regular_trust", "term_trust", "last_trust_date"],
        "tags": ["billable"],
        "state": "status",
        "links": {"client": "client_id"},
    },
    "practice_time_entries": {
        "kind": "time_entry",
        "data": ["description", "entry_date", "hours", "batch_tag"],
        "tags": ["billable"],
        "links": {"matter": "matter_id"},
    },
    "practice_invoices": {
        "kind": "invoice",
        "data": ["invoice_number", "issue_date", "date_to", "amount", "amount_paid", "status", "last_import_at"],
        "links": {"matter": "matter_id"},
    },
    "practice_tasks": {
        "kind": "task",
        "data": ["description", "time_estimate_hours", "actual_hours", "deadline_date", "completed_at",
                 "next_nudge_date", "nudge_interval_days", "last_nudged_at"],
        "tags": ["task_type"],
        "state": "status",
        "links": {"matter": "matter_id", "filing": "filing_ref"},
    },
    "practice_retainer_notices": {
        "kind": "retainer_notice",
        "data": ["sent_at"],
        "links": {"matter": "matter_id"},
    },
    "practice_anchors": {
        "kind": "anchor",
        "data": ["anchor_date", "party_label", "proceeding_label"],
        "tags": ["anchor_type"],
        "state": "status",
        "links": {"matter": "matter_id", "filing": "filing_ref"},
        "blank": ["party_label", "proceeding_label"],
    },
    "practice_anchor_sources": {
        "kind": "anchor_source",
        "data": ["source_document", "source_excerpt", "stated_date", "asserted_date"],
        "state": "status",
        "links": {"anchor": "anchor_id"},
    },
    "practice_deadlines": {
        "kind": "deadline",
        "data": ["source_document", "deadline_date", "rule_ref", "rule_description", "review_note",
                 "party_label", "proceeding_label", "scenario_label", "expiry_notified_at"],
        "tags": ["deadline_type", "source_type", "review_flag"],
        "state": "status",
        "links": {"matter": "matter_id", "anchor": "anchor_id"},
        "blank": ["party_label", "proceeding_label", "scenario_label"],
    },
    "practice_payment_in_flight": {
        "kind": "payment",
        "data": ["notes", "amount", "recorded_at", "expected_clear_by"],
        "state": "cleared",
        "links": {"matter": "matter_id"},
    },
    "practice_matter_signals": {
        "kind": "signal",
        "data": ["note", "confirmed_at"],
        "tags": ["signal_key"],
        "state": "state",
        "links": {"matter": "matter_id"},
    },
    "practice_court_calendar_coverage": {
        "kind": "calendar_year",
        "data": ["year", "source_document", "checked_at"],
        "state": "status",
    },
    "practice_court_calendar_days": {
        "kind": "calendar_day",
        "data": ["calendar_date", "status_label", "courthouse_scope", "source_document"],
        "tags": ["status_category"],
    },
    # The record is the item's one data field and its cross record. Its tags and state are
    # taken from the record, as upsert_rule_overlay takes them; the other columns repeat it.
    "practice_rule_overlay": {
        "kind": "rule_overlay",
        "data": ["record"],
        "tags": ["deadline_type", "amending_reg"],
        "state": "status",
        "repeats": ["rule_ref", "effective_from", "effective_to"],
    },
}
POLICY_TABLE = "practice_status_policies"
LEGACY_TABLES = set(TABLES) | {POLICY_TABLE}
ROW_FIELDS = ("id", "created_at", "updated_at")
DROPPED = ("owner_id",)
BOOL_FIELDS = ("billable", "cleared")

# The eight default lifecycle policies the data server seeded before step 5
# (3049ddc^:source/practice/mcp/src/tools/practice/shared.ts, DEFAULT_POLICIES).
DEFAULT_POLICIES = [
    ("prospective", [], ["conflict_check_completed"], True, "File opened; conflict check not yet completed"),
    ("intake", ["conflict_check_completed"], ["retainer_agreement_signed"], True,
     "Conflict check done; retainer agreement not yet signed"),
    ("active", ["retainer_agreement_signed", "deposit_received"], None, True,
     "Retainer signed and deposit received; work in progress"),
    ("retainer_warning", ["retainer_agreement_signed"], None, True,
     "Active matter; retainer balance at or below replenishment threshold"),
    ("retainer_depleted", ["retainer_agreement_signed"], None, True, "Active matter; retainer balance confirmed zero"),
    ("closing", [], None, False, "Work substantially complete; representation not yet formally ended"),
    ("closed", ["representation_ended"], None, True, "Representation formally ended"),
    ("declined", ["conflict_check_completed"], None, False, "Conflict identified or matter not accepted"),
]

# ops.ts: a raw string leaves the machine only as a vocabulary value, never carrying a matter code.
VOCABULARY = re.compile(r"^[a-z0-9][a-z0-9_:.-]*$")
MATTER_CODE = re.compile(r"\bL\d{3,4}\b")

# items.ts: the state's field name in the old row, where it is not `status`.
STATE_FIELD = {"signal": "state", "payment": "cleared"}

# rules.sql: the one link role the cloud keeps and never syncs back.
UNSYNCED_LINKS = {("calendar_day", "calendar_year")}


class Stop(Exception):
    """The run stops here. The message says why and what was left where."""


# ---------------------------------------------------------------------------
# JSON exactly as JavaScript's JSON.stringify writes it, and ops.ts's hash
# ---------------------------------------------------------------------------

def js_number(value):
    """ECMAScript Number::toString for a finite double, which JSON.stringify uses."""
    if value != value or value in (float("inf"), float("-inf")):
        return "null"
    if value == 0:
        return "0"
    if value < 0:
        return "-" + js_number(-value)
    sign, digits, exponent = decimal.Decimal(repr(float(value))).as_tuple()
    text = "".join(map(str, digits)).rstrip("0")
    exponent += len(digits) - len(text)
    k = len(text)
    n = exponent + k
    if k <= n <= 21:
        return text + "0" * (n - k)
    if 0 < n <= 21:
        return text[:n] + "." + text[n:]
    if -6 < n <= 0:
        return "0." + "0" * (-n) + text
    mark = "+" if n - 1 >= 0 else "-"
    return (text if k == 1 else text[0] + "." + text[1:]) + "e" + mark + str(abs(n - 1))


_ESCAPES = {'"': '\\"', "\\": "\\\\", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t"}


def js_string(value):
    out = ['"']
    for ch in value:
        code = ord(ch)
        if ch in _ESCAPES:
            out.append(_ESCAPES[ch])
        elif code < 0x20 or 0xD800 <= code <= 0xDFFF:
            out.append("\\u%04x" % code)
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def _utf16_order(key):
    # Array.prototype.sort compares strings by UTF-16 code units, not code points.
    return key.encode("utf-16-be", "surrogatepass")


def js_json(value, sort_keys=False):
    """JSON.stringify(value), or with sort_keys, ops.ts canonicalJson(value)."""
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        return str(value) if abs(value) < 2 ** 53 else js_number(float(value))
    if isinstance(value, float):
        return js_number(value)
    if isinstance(value, str):
        return js_string(value)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(js_json(v, sort_keys) for v in value) + "]"
    if isinstance(value, dict):
        keys = sorted(value, key=_utf16_order) if sort_keys else list(value)
        return "{" + ",".join(js_string(k) + ":" + js_json(value[k], sort_keys) for k in keys) + "}"
    raise TypeError("no JSON form for %r" % type(value).__name__)


def canonical_json(value):
    return js_json(value, sort_keys=True)


def hash_value(hash_key, value):
    """ops.ts hashValue: HMAC-SHA256 hex of the value's canonical JSON; null stays null."""
    if value is None:
        return None
    return hmac.new(hash_key, canonical_json(value).encode("utf-8"), hashlib.sha256).hexdigest()


def guard_raw(value, field):
    """ops.ts guardRaw: the reason a raw value may not leave the machine, or None."""
    if value is None or isinstance(value, (bool, int, float)):
        return None
    if not isinstance(value, str):
        return "%s is not a single value" % field
    if not VOCABULARY.match(value):
        return "%s is not a vocabulary value (lower-case letters, digits, _ : . -)" % field
    if MATTER_CODE.search(value):
        return "%s carries a client matter code" % field
    return None


def guard_cross(value, field):
    """ops.ts guardCross: every reason a cross value may not leave the machine."""
    if isinstance(value, str):
        return ["%s carries a client matter code" % field] if MATTER_CODE.search(value) else []
    if isinstance(value, list):
        return [p for i, v in enumerate(value) for p in guard_cross(v, "%s[%d]" % (field, i))]
    if isinstance(value, dict):
        return [p for k, v in value.items() for p in guard_cross(v, "%s.%s" % (field, k))]
    return []


# ---------------------------------------------------------------------------
# The item model (items.ts)
# ---------------------------------------------------------------------------

def flatten(item_id, item):
    """items.ts flatten: id, every data field, each tag, the state under its old name, each link."""
    row = {"id": item_id, **item["data"], **item["tags"]}
    if item["state"] is not None:
        field = STATE_FIELD.get(item["kind"], "status")
        row[field] = item["state"] == "true" if field == "cleared" else item["state"]
    for role, target in item["links"].items():
        row["filing_ref" if role == "filing" else role + "_id"] = target
    row["created_at"] = item["created_at"]
    row["updated_at"] = item["updated_at"]
    return row


def describe(item_id, item):
    """items.ts describe: how a question names an item."""
    data = (item or {}).get("data") or {}
    for field in ("description", "name", "rule_description", "status_label", "source_document"):
        value = data.get(field)
        if isinstance(value, str) and value != "":
            return '%s "%s"' % (item_id, value)
    tags = [v for v in ((item or {}).get("tags") or {}).values() if isinstance(v, str)]
    return "%s (%s)" % (item_id, ", ".join(tags)) if tags else item_id


# ---------------------------------------------------------------------------
# Step 1 and 2: the legacy file
# ---------------------------------------------------------------------------

def open_read_only(path):
    return sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True)


def user_tables(con):
    rows = con.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 7) <> 'sqlite_'")
    return sorted(r[0] for r in rows)


def expected_columns(spec):
    links = list(spec.get("links", {}).values())
    state = [spec["state"]] if "state" in spec else []
    return set(ROW_FIELDS) | set(spec["data"]) | set(spec.get("tags", [])) | set(state) | set(links) | set(
        spec.get("repeats", []))


def read_legacy(path):
    """Every row of the 15 tables, as {table: [row dict]}, from a file opened read-only."""
    con = open_read_only(path)
    try:
        tables = user_tables(con)
        if tables == ["kv_store"]:
            raise Stop("%s is already converted: its only table is kv_store. Nothing was done." % path)
        problems = []
        if "kv_store" in tables:
            problems.append("it holds kv_store beside the legacy tables")
        problems += ["it has no table %s" % t for t in sorted(LEGACY_TABLES - set(tables))]
        problems += ["it holds a table this script does not know: %s" % t for t in tables if t not in LEGACY_TABLES]
        legacy = {}
        for table in sorted(LEGACY_TABLES & set(tables)):
            cursor = con.execute('SELECT * FROM "%s"' % table)
            columns = [c[0] for c in cursor.description]
            if table in TABLES:
                expected = expected_columns(TABLES[table])
                present = set(columns) - set(DROPPED)
                problems += ["%s has no column %s" % (table, c) for c in sorted(expected - present)]
                problems += ["%s has a column this script does not map: %s" % (table, c)
                             for c in sorted(present - expected)]
            legacy[table] = [dict(zip(columns, row)) for row in cursor.fetchall()]
        if problems:
            raise Stop("%s is not a practice.db this script can convert. Nothing was done:\n  - %s"
                       % (path, "\n  - ".join(problems)))
        return legacy
    finally:
        con.close()


def policy_differences(rows):
    """How the status policies differ from the eight defaults; empty when they are exactly those."""
    def parsed(value):
        if value is None:
            return None
        try:
            return json.loads(value)
        except (TypeError, ValueError):
            return value

    found = {}
    differences = []
    for row in rows:
        label = row.get("status_label")
        actual = (parsed(row.get("required_signals")), parsed(row.get("blocking_signals")),
                  None if row.get("auto_advance") is None else bool(row.get("auto_advance")), row.get("description"))
        if label in found:
            differences.append("status %r has more than one policy" % label)
        found[label] = actual
    defaults = {p[0]: p[1:] for p in DEFAULT_POLICIES}
    for label in sorted(set(found) - set(defaults), key=str):
        differences.append("status %r has a policy that is not a default" % label)
    for label, default in defaults.items():
        if label not in found:
            differences.append("status %r has no policy" % label)
            continue
        for name, want, have in zip(("required_signals", "blocking_signals", "auto_advance", "description"),
                                    default, found[label]):
            if want != have:
                differences.append("status %r: %s is %r, the default is %r" % (label, name, have, want))
    return differences


# ---------------------------------------------------------------------------
# Step 3: the items
# ---------------------------------------------------------------------------

def row_value(field, value):
    return bool(value) if field in BOOL_FIELDS and value is not None else value


def build_items(legacy, hash_key):
    """[(id, local item, seed entry)] in seed order. Stops on anything step 5 would refuse to send."""
    problems = []
    years = {}
    for row in legacy["practice_court_calendar_coverage"]:
        year = str(row["year"])
        if year in years:
            problems.append("two calendar coverage rows hold year %s: %s and %s" % (year, years[year], row["id"]))
        years[year] = row["id"]

    built = []
    seen = {}
    for table, spec in TABLES.items():
        kind = spec["kind"]
        rows = sorted(legacy[table], key=lambda r: (r.get("created_at") or "", str(r["id"])))
        for row in rows:
            item_id = row["id"]
            at = "%s %s" % (table, item_id)
            if item_id in seen:
                problems.append("%s shares its id with a row of %s" % (at, seen[item_id]))
            seen[item_id] = table

            if kind == "rule_overlay":
                try:
                    record = json.loads(row["record"])
                except (TypeError, ValueError):
                    problems.append("%s: record is not JSON" % at)
                    continue
                data = {"record": record}
                instrument = record.get("amending_instrument") if isinstance(record, dict) else None
                tags = {"deadline_type": record.get("deadline_type") if isinstance(record, dict) else None,
                        "amending_reg": instrument.get("reg") if isinstance(instrument, dict) else None}
                state = record.get("status") if isinstance(record, dict) else None
                cross = record
            else:
                data = {field: row[field] for field in spec["data"]}
                tags = {tag: row_value(tag, row[tag]) for tag in spec.get("tags", [])}
                state_value = row[spec["state"]] if "state" in spec else None
                if spec.get("state") == "cleared" and state_value is not None:
                    state_value = "true" if state_value else "false"
                state = state_value
                cross = None
            tags = {k: v for k, v in tags.items() if v is not None}
            links = {role: row[field] for role, field in spec.get("links", {}).items() if row[field] is not None}
            seed_links = dict(links)
            if kind == "calendar_day":
                year = str(row["calendar_date"])[:4]
                if year in years:
                    seed_links["calendar_year"] = years[year]

            reasons = [guard_raw(item_id, "the id of " + at), guard_raw(kind, "the kind of " + at),
                       guard_raw(state, "the state of " + at)]
            for tag, value in tags.items():
                if kind == "rule_overlay" and tag == "amending_reg":
                    reasons += guard_cross(value, "tag %s of %s" % (tag, at))
                else:
                    reasons.append(guard_raw(value, "tag %s of %s" % (tag, at)))
            for role, target in seed_links.items():
                reasons.append(guard_raw(target, "link %s of %s" % (role, at)))
            if cross is not None:
                reasons += guard_cross(cross, "the record of " + at)
            problems += [r for r in reasons if r]

            blank = spec.get("blank", [])
            hashes = {field: hash_value(hash_key, None if field in blank and value == "" else value)
                      for field, value in data.items()}
            item = {"kind": kind, "data": data, "tags": tags, "state": state,
                    "links": {r: t for r, t in seed_links.items() if (kind, r) not in UNSYNCED_LINKS},
                    "created_at": row.get("created_at"), "updated_at": row.get("updated_at")}
            entry = {"id": item_id, "kind": kind, "state": state, "tags": tags, "links": seed_links, "hashes": hashes}
            if cross is not None:
                entry["cross"] = cross
            built.append((item_id, item, entry))
    if problems:
        raise Stop("Some rows cannot leave this machine as they stand, so nothing was written or sent:\n  - "
                   + "\n  - ".join(problems))
    return built


def kv_schema():
    """The kv_store DDL, read from the data server's own source so this file holds none."""
    text = KV_SOURCE.read_text(encoding="utf-8")
    match = re.search(r'SCHEMA = """(.*?)"""', text, re.S)
    if not match:
        raise Stop("No kv_store schema was found in %s. Nothing was done." % KV_SOURCE)
    return match.group(1).strip()


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def write_new_db(path, built, meta):
    con = sqlite3.connect(path)
    try:
        con.execute("PRAGMA journal_mode = DELETE")
        con.executescript(kv_schema())
        stamp = now_iso()
        upsert = "INSERT INTO kv_store (namespace, key, value, updated_at) VALUES (?, ?, ?, ?)"
        con.executemany(upsert, [("item", item_id, js_json(item), stamp) for item_id, item, _ in built])
        con.executemany(upsert, [("meta", key, js_json(value), stamp) for key, value in meta.items()])
        con.commit()
    finally:
        con.close()


def set_meta(path, key, value):
    con = sqlite3.connect(path)
    try:
        con.execute("UPDATE kv_store SET value = ?, updated_at = ? WHERE namespace = 'meta' AND key = ?",
                    (js_json(value), now_iso(), key))
        con.commit()
    finally:
        con.close()


def read_new_items(path):
    con = sqlite3.connect(path)
    try:
        return {key: json.loads(value) for key, value in
                con.execute("SELECT key, value FROM kv_store WHERE namespace = 'item'")}
    finally:
        con.close()


# ---------------------------------------------------------------------------
# Step 4: the round trip
# ---------------------------------------------------------------------------

def old_row(table, row):
    """The row as the legacy tools returned it, less what the item form drops on purpose:
    owner_id, a tag, state or link that is null (now omitted), and the overlay columns that
    only repeat its record."""
    spec = TABLES[table]
    omittable = set(spec.get("tags", [])) | set(spec.get("links", {}).values())
    if "state" in spec:
        omittable.add(spec["state"])
    out = {}
    for field, value in row.items():
        if field in DROPPED or field in spec.get("repeats", []):
            continue
        if field in omittable and value is None:
            continue
        out[field] = row_value(field, value)
    if spec["kind"] == "rule_overlay":
        out["record"] = json.loads(row["record"])
    return out


def round_trip_differences(legacy, items):
    """Every difference between a legacy row and the row its stored item flattens to."""
    differences = []
    missing = object()
    for table, spec in TABLES.items():
        for row in legacy[table]:
            item = items.get(row["id"])
            if item is None:
                differences.append("%s %s: no item was stored" % (table, row["id"]))
                continue
            expected = old_row(table, row)
            rebuilt = flatten(row["id"], item)
            for field in sorted(set(expected) | set(rebuilt)):
                want, have = expected.get(field, missing), rebuilt.get(field, missing)
                same = (want is not missing and have is not missing
                        and canonical_json(want) == canonical_json(have))
                if not same:
                    differences.append("%s %s: %s was %s, rebuilt %s" % (
                        table, row["id"], field, "absent" if want is missing else canonical_json(want),
                        "absent" if have is missing else canonical_json(have)))
            if spec["kind"] == "rule_overlay":
                record = expected["record"] if isinstance(expected["record"], dict) else {}
                for field in spec["repeats"]:
                    if canonical_json(record.get(field)) != canonical_json(row[field]):
                        differences.append("%s %s: column %s is %s, its record says %s" % (
                            table, row["id"], field, canonical_json(row[field]), canonical_json(record.get(field))))
                if str(record.get("record_id", "")).lower() != str(row["id"]).lower():
                    differences.append("%s %s: its record's record_id is %s" % (
                        table, row["id"], canonical_json(record.get("record_id"))))
    return differences


# ---------------------------------------------------------------------------
# Step 5: the cloud
# ---------------------------------------------------------------------------

def load_credential(use_env_key):
    """(url, key) from the data server's own credential loader. The key is never printed."""
    script = (
        "import { pathToFileURL } from 'node:url';"
        "const m = await import(pathToFileURL(process.argv[1]).href);"
        "const env = { ...process.env };"
        "if (process.argv[2] !== 'env') { env.LEGAL_COMMONS_SUPABASE_KEY = ''; env.SUPABASE_SERVICE_ROLE_KEY = ''; }"
        "const k = await m.loadCommonsKey(env);"
        "process.stdout.write(JSON.stringify({ url: k.supabaseUrl, key: k.staticKey || null,"
        " error: k.credentialError || null }));"
    )
    result = subprocess.run(
        ["node", "--input-type=module", "-e", script, "--", str(COMMONS_KEY), "env" if use_env_key else "stored"],
        capture_output=True, text=True)
    if result.returncode != 0:
        raise Stop("The commons credential could not be loaded (node exited %d). Nothing was done."
                   % result.returncode)
    loaded = json.loads(result.stdout)
    if not loaded.get("key"):
        reason = loaded.get("error") or "no credential is configured"
        raise Stop("Probanda's Cloud credential is missing: %s. Nothing was done." % reason)
    return loaded["url"], loaded["key"]


def post(url, key, function, body):
    request = urllib.request.Request(
        url.rstrip("/") + "/functions/v1/" + function,
        data=js_json(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "apikey": key},
        method="POST")
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            text = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        raise Stop("%s answered HTTP %d." % (function, error.code))
    except (urllib.error.URLError, OSError) as error:
        raise Stop("%s did not answer (%s)." % (function, getattr(error, "reason", error)))
    try:
        reply = json.loads(text)
    except ValueError:
        raise Stop("%s answered with something that is not JSON." % function)
    if not isinstance(reply, dict):
        raise Stop("%s answered with something that is not a JSON object." % function)
    return reply


def fill_question(question, items):
    return re.sub(r"\{\{item:([^}]+)\}\}", lambda m: describe(m.group(1), items.get(m.group(1))), question)


def sync_differences(built, reply):
    if not isinstance(reply.get("items"), list) or not isinstance(reply.get("seq"), int):
        return ["items-sync did not return items and a seq"]
    cloud = {}
    differences = []
    for entry in reply["items"]:
        if entry.get("id") in cloud:
            differences.append("the cloud returned %s twice" % entry.get("id"))
        cloud[entry.get("id")] = entry
    for item_id, item, _ in built:
        entry = cloud.pop(item_id, None)
        if entry is None:
            differences.append("%s %s is not in the cloud" % (item["kind"], item_id))
            continue
        for field, want, have in (("kind", item["kind"], entry.get("kind")),
                                  ("state", item["state"], entry.get("state")),
                                  ("tags", item["tags"], entry.get("tags")),
                                  ("links", item["links"], entry.get("links")),
                                  ("deleted", False, entry.get("deleted"))):
            if canonical_json(want) != canonical_json(have):
                differences.append("%s %s: %s is %s here and %s in the cloud" % (
                    item["kind"], item_id, field, canonical_json(want), canonical_json(have)))
    differences += ["the cloud holds %s, which is not here" % item_id for item_id in cloud]
    return differences


# ---------------------------------------------------------------------------
# The run
# ---------------------------------------------------------------------------

def run(db_path, cloud_url=None, use_env_key=False, out=print):
    db_path = Path(db_path)
    if not db_path.is_file():
        raise Stop("%s is not a file. Nothing was done." % db_path)
    new_path = db_path.with_name("practice.new.db")
    legacy_path = db_path.with_name("practice.legacy-%s.db" % datetime.date.today().isoformat())

    # Steps 1 and 2.
    legacy = read_legacy(db_path)
    for path in (new_path, legacy_path):
        if path.exists():
            raise Stop("%s already exists. Nothing was done: move it aside first." % path)
    differences = policy_differences(legacy[POLICY_TABLE])
    if differences:
        raise Stop("The status policies are not exactly the eight defaults, so the run stopped. Nothing was "
                   "written or sent:\n  - " + "\n  - ".join(differences))
    counts = {spec["kind"]: len(legacy[table]) for table, spec in TABLES.items()}
    out("Read %s: %d rows in 14 tables, and the eight default status policies."
        % (db_path, sum(counts.values())))
    url, key = load_credential(use_env_key)
    url = cloud_url or url

    # Step 3.
    tenant = str(uuid.uuid4())
    hash_key = secrets.token_bytes(32)
    built = build_items(legacy, hash_key)
    meta = {"format": FORMAT, "tenant": tenant, "hash_key": base64.b64encode(hash_key).decode("ascii"),
            "sync_seq": "0"}
    try:
        write_new_db(new_path, built, meta)
        # Step 4.
        items = read_new_items(new_path)
        differences = round_trip_differences(legacy, items)
        if len(items) != len(built):
            differences.append("%d items were stored for %d rows" % (len(items), len(built)))
        if differences:
            raise Stop("The round trip found %d difference(s), so nothing was sent:\n  - %s"
                       % (len(differences), "\n  - ".join(differences)))
    except BaseException:
        new_path.unlink(missing_ok=True)
        raise
    out("Wrote %s: %d items, round trip with 0 differences." % (new_path, len(built)))
    for kind, count in counts.items():
        out("  %-16s %d" % (kind, count))

    # Step 5. From here the new file is kept: it holds the key to what the cloud was sent.
    kept = "%s is kept, holding tenant %s. %s is unchanged." % (new_path, tenant, db_path)
    try:
        seeded = post(url, key, "items-seed", {"tenant": tenant, "store": STORE, "items": [e for _, _, e in built]})
        questions = seeded.get("questions")
        if seeded.get("seeded") != len(built) or not isinstance(questions, list):
            detail = "; ".join(str(q.get("question")) for q in questions or [] if isinstance(q, dict))
            raise Stop("items-seed seeded %r of %d items%s." % (seeded.get("seeded"), len(built),
                                                                  ": " + detail if detail else ""))
        out("Seeded tenant %s with %d items." % (tenant, len(built)))
        if questions:
            out("Probanda's Cloud asks %d question(s) about existing data, which stays as it is:" % len(questions))
            for question in questions:
                item_id = question.get("id")
                out("  - %s: %s" % (describe(item_id, items.get(item_id)) if item_id else "(the seed)",
                                    fill_question(str(question.get("question")), items)))
        synced = post(url, key, "items-sync", {"tenant": tenant, "store": STORE, "since": 0})
        differences = sync_differences(built, synced)
        if differences:
            raise Stop("The cloud does not hold what was seeded:\n  - " + "\n  - ".join(differences))
        set_meta(new_path, "sync_seq", str(synced["seq"]))
        out("Synced from 0: the cloud holds the same %d items, states, tags and links (seq %d)."
            % (len(built), synced["seq"]))
    except Stop as stop:
        raise Stop("%s\n%s" % (stop, kept))

    # Step 6.
    if legacy_path.exists():
        raise Stop("%s appeared during the run. %s" % (legacy_path, kept))
    os.rename(db_path, legacy_path)
    try:
        os.rename(new_path, db_path)
    except OSError as error:
        raise Stop("%s was renamed to %s, but %s could not take its place (%s). Rename it by hand."
                   % (db_path, legacy_path, new_path, error))
    out("Swapped: the original is now %s, and %s is in the item form." % (legacy_path, db_path))
    return {"tenant": tenant, "items": len(built), "counts": counts, "legacy_path": str(legacy_path)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0].strip())
    parser.add_argument("db_path", help="the practice.db to convert")
    parser.add_argument("--cloud-url", help="the Supabase project URL to use instead of the credential's")
    parser.add_argument("--env-key", action="store_true",
                        help="let LEGAL_COMMONS_SUPABASE_KEY or SUPABASE_SERVICE_ROLE_KEY win over the stored "
                             "credential (by default they are ignored)")
    args = parser.parse_args(argv)
    try:
        run(args.db_path, cloud_url=args.cloud_url, use_env_key=args.env_key)
    except Stop as stop:
        print("STOPPED: %s" % stop, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
