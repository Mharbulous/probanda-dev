"""Canonical push-source hash — executable form of push-state.md's pseudocode.

Stdlib only, no DB access, no file I/O beyond stdin/stdout. This is the *pure
in-memory* half of push_source_hash: the caller runs the SELECTs (via
case_data__query) and shapes the rows into the JSON payload this script hashes.
It never opens a database, never reads a matter file, never reads the clock.

This file and push-state.md's "canonical push-source hash" pseudocode MUST stay
in lockstep -- edit both together, or the divergence check silently lies about
what changed.

Usage: pipe one JSON object on stdin, get the hex digest on stdout.

Input shape (field names and order matter -- they feed json.dumps(sort_keys=True),
so *order* here is documentation, not a contract; but the *names* are):
{
  "name": "<legal_concepts.name, or \"\">",
  "description": "<legal_concepts.description, or \"\">",
  "criteria": [
    {"order": <criterion_order>, "requirement_type": <str>,
     "description": <criterion_description, or "">, "burden_of_proof": <str|null>,
     "in_force_date": <str|null>, "repeal_date": <str|null>}, ...
  ],  # ordered by criterion_order
  "edges": [
    {"authority_id": <int>, "relationship": <str|null>,
     "proposition": <str, or "">, "finding": <str, or "">,
     "obiter": <str, or "">, "treatment": <str|null>}, ...
  ]  # ordered by authority_id; verified >= 0, non-answered rows only (caller's filter)
}
"""
from __future__ import annotations

import hashlib
import json
import sys
import unicodedata


def push_source_hash(payload: dict) -> str:
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True,
                            separators=(",", ":"))
    return hashlib.sha256(
        unicodedata.normalize("NFC", canonical).encode("utf-8")).hexdigest()


_SELF_TEST_PAYLOAD = {
    "name": "Test concept", "description": "A test.",
    "criteria": [{"order": 1, "requirement_type": "element",
                  "description": "An element.", "burden_of_proof": None,
                  "in_force_date": None, "repeal_date": None}],
    "edges": [{"authority_id": 1, "relationship": "supports",
               "proposition": "A prop.", "finding": "", "obiter": "",
               "treatment": None}],
}
_SELF_TEST_DIGEST = push_source_hash(_SELF_TEST_PAYLOAD)


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] == "--self-test":
        got = push_source_hash(_SELF_TEST_PAYLOAD)
        assert got == _SELF_TEST_DIGEST, f"self-test drifted: {got}"
        print(f"OK {got}")
        return
    payload = json.load(sys.stdin)
    print(push_source_hash(payload))


if __name__ == "__main__":
    main()
