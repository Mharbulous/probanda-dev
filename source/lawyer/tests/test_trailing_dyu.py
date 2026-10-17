import json
import subprocess
import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
SKILL_ROOT = REPO_ROOT / "public" / "plugins" / "lawyer" / "skills" / "dyu"
HOOK = SKILL_ROOT / "hooks" / "trailing-dyu.py"
SKILL_MD = SKILL_ROOT / "SKILL.md"
PLUGIN_JSON = REPO_ROOT / "source" / "lawyer" / "plugin.json"
PUBLIC_PLUGIN_JSON = REPO_ROOT / "public" / "plugins" / "lawyer" / ".claude-plugin" / "plugin.json"
PLUGIN_HOOK_ARG = "${CLAUDE_PLUGIN_ROOT}/skills/dyu/hooks/trailing-dyu.py"


def run_hook(prompt):
    return subprocess.run(
        [sys.executable, str(HOOK)],
        input=json.dumps({"hook_event_name": "UserPromptSubmit", "prompt": prompt}),
        capture_output=True, text=True, encoding="utf-8",
    )


class TrailingDyuTests(unittest.TestCase):
    def test_trailing_token_loads_the_skill(self):
        for prompt in (
            "I want the letter to open with the offer, not the history. /dyu",
            "Two paragraphs.\n\nThe second one.\n/dyu\n",
            "Move the costs table up $dyu",
            "Move the costs table up /lawyer:dyu",
            "Is that what you meant? /DYU.",
            "/dyu",
        ):
            with self.subTest(prompt=prompt):
                result = run_hook(prompt)
                self.assertEqual(result.returncode, 0, result.stderr)
                out = json.loads(result.stdout)["hookSpecificOutput"]
                self.assertEqual(out["hookEventName"], "UserPromptSubmit")
                context = out["additionalContext"]
                self.assertIn("# DYU", context)
                self.assertIn("Any reply amending the restatement is not confirmation", context)
                self.assertNotIn("description:", context)

    def test_other_prompts_print_nothing(self):
        for prompt in (
            "/dyu I want the letter to open with the offer.",
            "Use /dyu before you answer, then draft the letter.",
            "Draft the letter.",
            "Open the file at notes/dyu",
            "See skills/dyu/SKILL.md for the rules",
            "",
        ):
            with self.subTest(prompt=prompt):
                result = run_hook(prompt)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, "")

    def test_the_skill_stays_model_invocable(self):
        self.assertNotIn("disable-model-invocation", SKILL_MD.read_text(encoding="utf-8"))

    def test_the_plugin_registers_the_hook(self):
        groups = json.loads(PLUGIN_JSON.read_text(encoding="utf-8"))["hooks"]["UserPromptSubmit"]
        args = [arg for group in groups for hook in group["hooks"] for arg in hook["args"]]
        self.assertIn(PLUGIN_HOOK_ARG, args)

    def test_the_public_plugin_registers_the_hook(self):
        groups = json.loads(PUBLIC_PLUGIN_JSON.read_text(encoding="utf-8"))["hooks"]["UserPromptSubmit"]
        args = [arg for group in groups for hook in group["hooks"] for arg in hook["args"]]
        self.assertEqual(args, [PLUGIN_HOOK_ARG])


if __name__ == "__main__":
    unittest.main()
