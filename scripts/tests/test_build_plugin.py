"""Tests for scripts/build_plugin.py. Every build goes to a temp folder."""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "scripts" / "build_plugin.py"
SOURCE = REPO / "source" / "probanda"


def build(*args):
    return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True)


class BuildPluginTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.out = Path(cls.tmp.name) / "probanda"
        result = build("--out", str(cls.out))
        if result.returncode != 0:
            raise AssertionError(result.stderr)
        cls.version = json.loads((SOURCE / "plugin.json").read_text(encoding="utf-8"))["version"]

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_roster_skill_is_stamped(self):
        text = (self.out / "skills" / "draft" / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn(f"\n<!-- probanda v{self.version} -->\n> **Installed copy.**", text)

    def test_no_tests_or_bytecode_ship(self):
        shipped = [p.relative_to(self.out).parts for p in self.out.rglob("*")]
        self.assertFalse([p for p in shipped if "tests" in p[:-1] or "__pycache__" in p])

    def test_bundles_and_manifest_exist(self):
        for rel in ("mcp/dist/litigation-mcp.js", "canlii-mcp/dist/canlii-mcp.js",
                    "commons-mcp/dist/legal-commons-mcp.js", ".claude-plugin/plugin.json"):
            self.assertTrue((self.out / rel).is_file(), rel)

    def test_rebuild_swaps_the_folder_and_leaves_no_temp_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "probanda"
            (out / "skills").mkdir(parents=True)
            (out / "skills" / "stale.md").write_text("stale", encoding="utf-8")
            result = build("--out", str(out))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse((out / "skills" / "stale.md").exists())
            self.assertTrue((out / ".claude-plugin" / "plugin.json").is_file())
            self.assertEqual([p.name for p in Path(tmp).iterdir()], ["probanda"])

    def test_a_build_in_progress_stops_a_second_build(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "probanda"
            out.mkdir()
            (out / "kept.md").write_text("kept", encoding="utf-8")
            building = Path(tmp) / ".probanda.building"
            building.mkdir()
            result = build("--out", str(out))
            self.assertEqual(result.returncode, 2)
            self.assertIn("another build is running", result.stderr)
            self.assertTrue((out / "kept.md").is_file())
            self.assertTrue(building.is_dir())

    def test_overlong_description_stops_the_build(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            skip = shutil.ignore_patterns("tests", "__pycache__", "node_modules")
            shutil.copytree(REPO / ".claude" / "skills", repo / ".claude" / "skills", ignore=skip)
            src = repo / "source" / "probanda"
            src.mkdir(parents=True)
            shutil.copy2(REPO / "source" / "assignment.json", repo / "source" / "assignment.json")
            for name in ("plugin.json", "roster.json", ".mcp.json", "README.md", "VISION.md"):
                shutil.copy2(SOURCE / name, src / name)
            for sub in ("agents", "hooks", "mcp/dist", "canlii-mcp/dist", "commons-mcp/dist"):
                shutil.copytree(SOURCE / sub, src / sub, ignore=skip)
            skill_md = repo / ".claude" / "skills" / "draft" / "SKILL.md"
            skill_md.write_text("---\nname: draft\ndescription: " + "x" * 1100 + "\n---\n\nBody.\n",
                                encoding="utf-8")
            out = repo / "out"
            result = build("--repo", str(repo), "--out", str(out))
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("1024", result.stderr)
            self.assertFalse(out.exists())

    def test_public_skill_ships_unstamped_and_may_not_also_be_private(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            skip = shutil.ignore_patterns("tests", "__pycache__", "node_modules")
            shutil.copytree(REPO / ".claude" / "skills", repo / ".claude" / "skills", ignore=skip)
            shutil.copytree(SOURCE, repo / "source" / "probanda", ignore=skip)
            shutil.copy2(REPO / "source" / "assignment.json", repo / "source" / "assignment.json")
            # The real public skills come too: a hook of the plugin runs a script in one of them.
            shutil.copytree(REPO / "public" / "plugins", repo / "public" / "plugins", ignore=skip)
            text = "---\nname: zz-public\ndescription: A public skill.\n---\n\nBody.\n"
            # Any public plugin's skills folder is searched, whatever the plugin is called.
            public = repo / "public" / "plugins" / "another" / "skills" / "zz-public"
            (public / "references").mkdir(parents=True)
            (public / "SKILL.md").write_bytes(text.encode("utf-8"))
            (public / "references" / "notes.txt").write_bytes(b"shipped whole\n")
            out = repo / "out"
            result = build("--repo", str(repo), "--out", str(out))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((out / "skills" / "zz-public" / "SKILL.md").read_bytes(), text.encode("utf-8"))
            self.assertTrue((out / "skills" / "zz-public" / "references" / "notes.txt").is_file())

            (repo / ".claude" / "skills" / "zz-public").mkdir()
            result = build("--repo", str(repo), "--out", str(repo / "out2"))
            self.assertEqual(result.returncode, 2)
            self.assertIn("skill in both public/ and .claude/skills/", result.stderr)


def skill(name):
    return f"---\nname: {name}\ndescription: Fixture skill {name}.\n---\n\n# {name}\n"


HOOK = "${CLAUDE_PLUGIN_ROOT}/skills/shared/hooks/guard.py"
PRACTICE = {"name": "practice", "version": "0.2.0", "hooks": {"PreToolUse": [
    {"matcher": "Bash", "hooks": [{"type": "command", "command": "python3", "args": [HOOK]}]}]}}
ASSIGNMENT = {"status": "cutover", "plugins": {
    "practice": {"requires": [], "skills": ["alpha", "pub-one"], "agents": ["clerk"], "hooks": {}, "servers": ["data"]},
    "research": {"requires": ["practice"], "skills": ["beta", "legal-commons", "pub-two"], "agents": [],
                 "hooks": {}, "servers": []},
}}
# A two-plugin repo at cutover: one private skill each, one public skill each under
# differently named public plugins, and a leftover plugins/probanda/ folder.
CUTOVER_REPO = {
    "source/assignment.json": json.dumps(ASSIGNMENT),
    "source/practice/plugin.json": json.dumps(PRACTICE),
    "source/practice/roster.json": json.dumps({"alpha": ["assets"]}),
    "source/practice/.mcp.json": json.dumps({"data": {"command": "node"}}),
    "source/practice/README.md": "# practice\n",
    "source/practice/agents/clerk.md": "# clerk\n",
    "source/practice/mcp/dist/server.js": "var server = 1;\n",
    "source/research/plugin.json": json.dumps({"name": "research", "version": "0.3.1"}),
    "source/research/roster.json": json.dumps({"beta": []}),
    ".claude/skills/alpha/SKILL.md": skill("alpha"),
    ".claude/skills/alpha/assets/form.bin": "asset\n",
    ".claude/skills/beta/SKILL.md": skill("beta"),
    ".claude/skills/legal-commons/SKILL.md": skill("legal-commons"),
    ".claude/skills/shared/hooks/guard.py": "print('guard')\n",
    ".claude/skills/shared/x.md": "shared\n",
    "public/plugins/practice/skills/pub-one/SKILL.md": skill("pub-one"),
    "public/plugins/probanda/skills/pub-two/SKILL.md": skill("pub-two"),
    "plugins/probanda/old.md": "left over from the single plugin\n",
}


class CutoverBuildTest(unittest.TestCase):
    """The build at "cutover": every plugin of the assignment, each from source/<plugin>/."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.repo = Path(self._tmp.name) / "repo"
        for rel, text in CUTOVER_REPO.items():
            self.put(rel, text)

    def put(self, rel, text):
        path = self.repo / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(text.encode("utf-8"))

    def build(self, *args):
        return build("--repo", str(self.repo), *args)

    def assert_stops(self, fragment):
        result = self.build()
        self.assertEqual(result.returncode, 2, result.stdout)
        self.assertIn(fragment, result.stderr)
        self.assertFalse((self.repo / "plugins" / "practice").exists())
        self.assertFalse((self.repo / "plugins" / "research").exists())

    def test_each_plugin_gets_its_own_units_and_the_whole_shared_tree(self):
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stderr)
        practice, research = self.repo / "plugins" / "practice", self.repo / "plugins" / "research"
        for plugin in (practice, research):
            self.assertEqual((plugin / "skills" / "shared" / "x.md").read_bytes(), b"shared\n")
            self.assertTrue((plugin / "skills" / "shared" / "hooks" / "guard.py").is_file())
        self.assertIn("\n<!-- practice v0.2.0 -->\n", (practice / "skills" / "alpha" / "SKILL.md").read_text("utf-8"))
        self.assertIn("\n<!-- research v0.3.1 -->\n", (research / "skills" / "beta" / "SKILL.md").read_text("utf-8"))
        self.assertTrue((practice / "skills" / "alpha" / "assets" / "form.bin").is_file())
        # A public skill is found under any public plugin, and ships unstamped. So does legal-commons.
        self.assertEqual((practice / "skills" / "pub-one" / "SKILL.md").read_text("utf-8"), skill("pub-one"))
        self.assertEqual((research / "skills" / "pub-two" / "SKILL.md").read_text("utf-8"), skill("pub-two"))
        self.assertEqual((research / "skills" / "legal-commons" / "SKILL.md").read_text("utf-8"), skill("legal-commons"))
        self.assertEqual(sorted(p.name for p in (practice / "skills").iterdir()), ["alpha", "pub-one", "shared"])
        self.assertEqual(sorted(p.name for p in (research / "skills").iterdir()),
                         ["beta", "legal-commons", "pub-two", "shared"])
        # Servers, agents and the optional root files follow the plugin that has them.
        self.assertTrue((practice / "mcp" / "dist" / "server.js").is_file())
        self.assertTrue((practice / "agents" / "clerk.md").is_file())
        self.assertEqual(sorted(p.name for p in research.iterdir()), [".claude-plugin", "skills"])

    def test_leftover_plugin_folder_is_stale_to_the_check_and_removed_by_the_build(self):
        result = self.build("--check")
        self.assertEqual(result.returncode, 1)
        self.assertIn("is stale: no plugin in source/assignment.json builds it", result.stdout)
        self.assertEqual(self.build().returncode, 0)
        self.assertEqual(sorted(p.name for p in (self.repo / "plugins").iterdir()), ["practice", "research"])
        result = self.build("--check")
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual(result.stdout.count(" is current"), 2)

    def test_out_holds_one_folder_per_plugin_and_leaves_plugins_alone(self):
        out = Path(self._tmp.name) / "out"
        result = self.build("--out", str(out))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sorted(p.name for p in out.iterdir()), ["practice", "research"])
        self.assertTrue((self.repo / "plugins" / "probanda" / "old.md").is_file())

    def test_hook_whose_script_is_not_in_its_plugin_stops_the_build(self):
        missing = "${CLAUDE_PLUGIN_ROOT}/skills/beta/hooks/gate.py"
        self.put("source/practice/plugin.json", json.dumps(PRACTICE).replace(HOOK, missing))
        self.put(".claude/skills/beta/hooks/gate.py", "print('in research only')\n")
        self.assert_stops(f"hook path {missing} names no file in the built plugin 'practice'")

    def test_single_plugin_identifiers_in_another_plugin_stop_the_build(self):
        for text, needle in (("Call mcp__plugin_probanda_data__x.\n", "plugin_probanda_"),
                             ("Spawn probanda:clerk.\n", "probanda:[A-Za-z]")):
            with self.subTest(needle=needle):
                self.put(".claude/skills/beta/notes.md", text)
                self.assert_stops(f"skills/beta/notes.md: {needle}")

    def test_roster_that_disagrees_with_the_assignment_stops_the_build(self):
        self.put("source/research/roster.json", json.dumps({"beta": [], "gamma": []}))
        self.assert_stops("disagree on the private skills of 'research': gamma")

    def test_agent_file_the_assignment_does_not_place_stops_the_build(self):
        self.put("source/practice/agents/stray.md", "# stray\n")
        self.assert_stops("disagree on the agents of 'practice': stray")

    def test_server_the_plugin_does_not_declare_stops_the_build(self):
        self.put("source/practice/.mcp.json", "{}")
        self.assert_stops("declares the servers [], but 'practice' ships ['data']")


if __name__ == "__main__":
    unittest.main()
