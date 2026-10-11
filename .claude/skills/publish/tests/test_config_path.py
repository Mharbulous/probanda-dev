"""COCLERK_CONFIG_PATH: the publish scripts read the same coclerk.json the MCP runtime does (#1230).

Run: python -m unittest discover -s .claude/skills/publish/tests
"""
from __future__ import annotations

import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import support
import render_letterhead

FIRM_PY = (support.PUBLISH_ROOT / "subskills" / "publish-bcsc-form" / "scripts"
           / "steps" / "shared" / "firm.py")
spec = importlib.util.spec_from_file_location("bcsc_firm", FIRM_PY)
firm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(firm)


class ConfigPathTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        tmp = Path(self._tmp.name)
        self.appdata = tmp / "appdata"
        support.write_config(self.appdata, {"person": "live-person",
                                            "firm": {"address": "live address"}})
        self.override = tmp / "scratch-coclerk.json"
        self.override.write_text(json.dumps({"person": "scratch-person",
                                             "firm": {"address": "scratch address"}}),
                                 encoding="utf-8")

    def env(self, **extra):
        base = {k: v for k, v in os.environ.items() if k != "COCLERK_CONFIG_PATH"}
        return mock.patch.dict(os.environ, {**base, "APPDATA": str(self.appdata), **extra}, clear=True)

    def test_unset_or_empty_reads_the_live_file(self):
        for extra in ({}, {"COCLERK_CONFIG_PATH": ""}):
            with self.env(**extra):
                self.assertEqual(render_letterhead.load_machine()[0], "live-person")
                self.assertEqual(firm.firm_context_fields()["firm_address"], "live address")

    def test_override_is_read_in_place_of_the_live_file(self):
        with self.env(COCLERK_CONFIG_PATH=str(self.override)):
            self.assertEqual(render_letterhead.load_machine()[0], "scratch-person")
            self.assertEqual(firm.firm_context_fields()["firm_address"], "scratch address")

    def test_override_naming_a_missing_file_fails_and_never_reads_the_live_file(self):
        missing = str(self.override.with_name("nope.json"))
        with self.env(COCLERK_CONFIG_PATH=missing):
            with self.assertRaises(SystemExit) as caught:
                render_letterhead.load_machine()
            self.assertIn("nope.json", str(caught.exception))
            with self.assertRaisesRegex(RuntimeError, "nope.json"):
                firm.firm_context_fields()


if __name__ == "__main__":
    unittest.main()
