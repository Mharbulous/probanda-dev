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
        self.assertEqual(self.version, "0.1.3")
        text = (self.out / "skills" / "draft" / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("\n<!-- probanda v0.1.3 -->\n> **Installed copy.**", text)

    def test_no_tests_or_bytecode_ship(self):
        shipped = [p.relative_to(self.out).parts for p in self.out.rglob("*")]
        self.assertFalse([p for p in shipped if "tests" in p[:-1] or "__pycache__" in p])

    def test_bundles_and_manifest_exist(self):
        for rel in ("mcp/dist/litigation-mcp.js", "canlii-mcp/dist/canlii-mcp.js",
                    "commons-mcp/dist/legal-commons-mcp.js", ".claude-plugin/plugin.json"):
            self.assertTrue((self.out / rel).is_file(), rel)

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


if __name__ == "__main__":
    unittest.main()
