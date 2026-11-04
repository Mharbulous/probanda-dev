"""scripts/stamp_dependencies.py against invented manifests in a throwaway repo.

Run: python -m pytest -q scripts/tests/test_stamp_dependencies.py
"""
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import check_plugin_sources  # noqa: E402
import fake_repo  # noqa: E402
import plugin_layout  # noqa: E402
import stamp_dependencies  # noqa: E402

MARKET = "Invented_market"
REQUIRES = {"base": [], "mid": ["base"], "top": ["base", "mid"]}


class StampTest(unittest.TestCase):
    def setUp(self):
        self.root = os.path.realpath(tempfile.mkdtemp(prefix="stamp-dependencies-"))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)
        self.put(".claude-plugin/marketplace.json", {"name": MARKET})
        fake_repo.write_assignment(self.root, {name: {"requires": requires} for name, requires in REQUIRES.items()})
        self.put("source/base/plugin.json", {"name": "base", "version": "0.2.1", "description": "é"})
        self.put("source/mid/plugin.json", {"name": "mid", "version": "0.5.0", "dependencies": ["base"], "hooks": {}})
        self.put("source/top/plugin.json", {"name": "top", "version": "0.7.3", "dependencies": ["base", "mid"]})

    def put(self, rel, data):
        path = os.path.join(self.root, *rel.split("/"))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def manifest(self, name):
        return json.loads(self.text(f"source/{name}/plugin.json"))

    def text(self, rel):
        with open(os.path.join(self.root, *rel.split("/")), encoding="utf-8") as f:
            return f.read()

    def set_version(self, name, version):
        self.put(f"source/{name}/plugin.json", {**self.manifest(name), "version": version})

    def pend(self, *names):
        self.put("/".join(check_plugin_sources.RANGES_PENDING), {"pending": list(names)})

    def run_stamp(self, *argv):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
            code = stamp_dependencies.main(list(argv), repo=self.root)
        return code, out.getvalue()

    def check(self, name):
        return check_plugin_sources.check_dependencies(self.root, plugin_layout.plugins(self.root)[name])

    def test_writes_name_marketplace_and_caret_of_the_current_version(self):
        code, out = self.run_stamp("mid", "top")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.manifest("mid")["dependencies"],
                         [{"name": "base", "marketplace": MARKET, "version": "^0.2.1"}])
        self.assertEqual(self.manifest("top")["dependencies"],
                         [{"name": "base", "marketplace": MARKET, "version": "^0.2.1"},
                          {"name": "mid", "marketplace": MARKET, "version": "^0.5.0"}])
        self.assertIn("stamped: top: base ^0.2.1, mid ^0.5.0", out)
        self.assertEqual(self.check("mid"), (True, ""))
        self.assertEqual(self.check("top"), (True, ""))

    def test_keeps_every_other_key_in_its_place(self):
        self.run_stamp("mid", "top")
        self.assertEqual(list(self.manifest("mid")), ["name", "version", "dependencies", "hooks"])
        self.assertTrue(self.text("source/mid/plugin.json").endswith("}\n"))

    def test_a_plugin_that_requires_nothing_is_not_written(self):
        before = self.text("source/base/plugin.json")
        self.run_stamp("mid", "top", "base")
        self.assertEqual(self.text("source/base/plugin.json"), before)

    def test_a_patch_of_the_dependency_leaves_nobody_behind(self):
        self.run_stamp("mid", "top")
        self.set_version("base", "0.2.2")
        code, out = self.run_stamp("base")
        self.assertEqual((code, out), (0, ""))
        self.assertEqual(self.manifest("mid")["dependencies"][0]["version"], "^0.2.1")

    def test_a_minor_of_the_dependency_cascades_until_every_dependent_is_released(self):
        self.run_stamp("mid", "top")
        self.set_version("base", "0.3.0")
        code, out = self.run_stamp("base")
        self.assertEqual(code, 1)
        self.assertIn("left behind: mid: 'base'", out)
        self.assertIn("left behind: top: 'base'", out)
        self.set_version("mid", "0.6.0")
        code, out = self.run_stamp("base", "mid")
        self.assertEqual(code, 1)
        self.assertNotIn("left behind: mid", out)
        self.assertIn("left behind: top: 'base'", out)
        self.assertIn("'mid' has the range '^0.5.0'", out)
        self.set_version("top", "0.8.0")
        code, out = self.run_stamp("base", "mid", "top")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.manifest("top")["dependencies"][1]["version"], "^0.6.0")

    def test_a_pending_plugin_keeps_its_bare_names_without_the_go_ahead(self):
        self.pend("mid", "top")
        before = self.text("source/mid/plugin.json")
        code, out = self.run_stamp("mid", "base")
        self.assertEqual(code, 0, out)
        self.assertEqual(out, "pending: mid keeps its bare names until the first release with ranges\n")
        self.assertEqual(self.text("source/mid/plugin.json"), before)
        self.assertEqual(check_plugin_sources.ranges_pending(self.root), {"mid", "top"})
        self.assertTrue(self.check("mid")[0])

    def test_first_ranges_lists_every_pending_plugin_left_behind_then_applies_in_one_run(self):
        self.pend("mid", "top")
        code, out = self.run_stamp("--first-ranges", "mid")
        self.assertEqual(code, 1)
        self.assertIn("stamped: mid: base ^0.2.1", out)
        self.assertIn("left behind: top: 'base' has no version range", out)
        self.assertEqual(check_plugin_sources.ranges_pending(self.root), {"top"})
        code, out = self.run_stamp("--first-ranges", "mid", "top")
        self.assertEqual(code, 0, out)
        self.assertFalse(os.path.exists(check_plugin_sources.ranges_pending_path(self.root)))
        self.assertEqual(self.check("top"), (True, ""))

    def test_an_unknown_plugin_stops_with_nothing_written(self):
        before = self.text("source/mid/plugin.json")
        code, out = self.run_stamp("mid", "nosuch")
        self.assertEqual(code, 2)
        self.assertIn("nosuch", out)
        self.assertEqual(self.text("source/mid/plugin.json"), before)


if __name__ == "__main__":
    unittest.main()
