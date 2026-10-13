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
            text = "---\nname: zz-public\ndescription: A public skill.\n---\n\nBody.\n"
            public = repo / "public" / "plugins" / "probanda" / "skills" / "zz-public"
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


if __name__ == "__main__":
    unittest.main()
