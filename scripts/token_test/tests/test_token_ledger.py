#!/usr/bin/env python3
"""
token_ledger: each API call is counted once, priced by model, and found by its RUN tag.

Run: python -m pytest -q scripts/token_test/tests
"""

import csv
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("token_ledger", HERE / "token_ledger.py")
token_ledger = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(token_ledger)


def usage(inp, w5, w1, read, out, thinking=0):
    return {"input_tokens": inp, "cache_creation_input_tokens": w5 + w1, "cache_read_input_tokens": read,
            "cache_creation": {"ephemeral_5m_input_tokens": w5, "ephemeral_1h_input_tokens": w1},
            "output_tokens": out, "output_tokens_details": {"thinking_tokens": thinking}}


def assistant(msg_id, model, use, effort="medium", sidechain=False):
    return {"type": "assistant", "effort": effort, "isSidechain": sidechain,
            "message": {"id": msg_id, "model": model, "usage": use}}


def user(text):
    return {"type": "user", "message": {"role": "user", "content": text}}


def write_jsonl(path, lines):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(l) for l in lines) + "\n", encoding="utf-8")


class LedgerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        project = self.root / "proj"
        write_jsonl(project / "sess1.jsonl", [
            user("orchestrate"),
            assistant("m1", "claude-opus-5-5", usage(10, 1000, 0, 0, 50)),
            assistant("sc", "claude-opus-5-5", usage(999, 0, 0, 0, 999), sidechain=True),
        ])
        subagents = project / "sess1" / "subagents"
        # Call a1 is split over two lines; only the last one counts.
        write_jsonl(subagents / "agent-abc.jsonl", [
            user("RUN E3-a-pdf_ocr-D007-2\nExtract the facts."),
            assistant("a1", "claude-haiku-5-5", usage(2, 2000, 0, 100, 3)),
            assistant("a1", "claude-haiku-5-5", usage(2, 2000, 0, 100, 400, thinking=40)),
            {"type": "user", "message": {"content": [{"type": "tool_result", "content": "x"}]}},
            assistant("a2", "claude-haiku-5-5", usage(1, 0, 500, 2100, 100)),
            assistant("syn", "<synthetic>", usage(0, 0, 0, 0, 0)),
        ])
        (subagents / "agent-abc.meta.json").write_text(json.dumps({"agentType": "legal:extract-facts"}))
        write_jsonl(subagents / "agent-untagged.jsonl", [
            user([{"type": "text", "text": "No tag here"}]),
            assistant("u1", "claude-sonnet-5", usage(5, 0, 0, 0, 5)),
        ])

    def tearDown(self):
        self.tmp.cleanup()

    def test_tagged_run_counts_each_call_once(self):
        runs, _ = token_ledger.ledger([self.root])
        self.assertEqual(len(runs), 1)
        run = runs[0]
        self.assertEqual((run["experiment"], run["cell"], run["doc"], run["rep"]), ("E3", "a-pdf_ocr", "D007", "2"))
        self.assertEqual((run["agent_id"], run["agent_type"], run["session"]), ("abc", "legal:extract-facts", "sess1"))
        self.assertEqual(run["calls"], 2)
        self.assertEqual([run[f] for f in token_ledger.TOKEN_FIELDS], [3, 2000, 500, 2200, 500, 40])
        expected = (3 * 0.10 + 2000 * 0.125 + 500 * 0.20 + 2200 * 0.01 + 500 * 0.50) / 1e6
        self.assertAlmostEqual(run["cost_usd"], expected, places=9)
        self.assertEqual((run["model"], run["effort"]), ("claude-haiku-5-5", "medium"))

    def test_orchestrator_totals_skip_sidechain(self):
        _, sessions = token_ledger.ledger([self.root])
        self.assertEqual(len(sessions), 1)
        s = sessions[0]
        self.assertEqual((s["session"], s["subagent_runs"], s["calls"]), ("sess1", 1, 1))
        self.assertAlmostEqual(s["cost_usd"], (10 * 4 + 1000 * 5 + 50 * 20) / 1e6, places=9)

    def test_all_includes_untagged(self):
        runs, _ = token_ledger.ledger([self.root], include_untagged=True)
        self.assertEqual(sorted(r["tag"] for r in runs), ["", "E3-a-pdf_ocr-D007-2"])

    def test_unknown_model_fails(self):
        with self.assertRaises(ValueError):
            token_ledger.price_for("gpt-9")

    def test_unsplit_cache_write_fails(self):
        with self.assertRaises(ValueError):
            token_ledger.call_tokens({"cache_creation_input_tokens": 5}, "x")

    def test_bad_tag_fails(self):
        with self.assertRaises(ValueError):
            token_ledger.parse_tag("E3-D007")

    def test_main_writes_csvs(self):
        out = self.root / "results"
        token_ledger.main([str(self.root), "--out", str(out)])
        with open(out / "ledger.csv", encoding="utf-8") as f:
            self.assertEqual(next(csv.reader(f)), token_ledger.RUN_COLUMNS)
        self.assertTrue((out / "sessions.csv").exists())


if __name__ == "__main__":
    unittest.main()
