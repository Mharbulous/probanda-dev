"""Regression lock for the gate's step 0: missing research dependencies are named before any dispatch.

One run met a missing pool credential, CanLII key, PDF extractor and settings file only as each
step failed, after Westlaw had run (Engineering/1. Design/2026-10-06_research-preflight-dependency-check-spec.md).
Step 0 now checks them up front, says one line, and goes on; the audit agent learns the result
through the spawn template's `Preflight:` field.
"""
import re
import unittest
from pathlib import Path


SKILLS_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = SKILLS_ROOT.parents[1]
FRONT_DOOR = SKILLS_ROOT / "legal-research" / "SKILL.md"
GATE = SKILLS_ROOT / "shared" / "legal-research.md"
SCHEMA = REPO_ROOT / "source" / "practice" / "mcp" / "src" / "schema-gen.ts"
TOOL = "research__preflight"


def step_zero():
    text = FRONT_DOOR.read_text(encoding="utf-8")
    start = re.search(r"(?m)^0\. Preflight", text).start()
    end = re.search(r"(?m)^1\. Read `shared/legal-research\.md`", text).start()
    return " ".join(text[start:end].split())


def template():
    text = GATE.read_text(encoding="utf-8")
    start = text.index("**Spawn the agent from this template.**")
    return text[start:text.index("```", text.index("```", start) + 3)]


class StepZeroTests(unittest.TestCase):
    def test_step_zero_batches_the_three_status_calls_before_step_one(self):
        step = step_zero()
        self.assertIn(f"call `{TOOL}`", step)
        self.assertIn("CanLII's `configure_status`", step)
        self.assertIn("when the pooled layer's own `configure_status` is in your tool list", step)

    def test_step_zero_never_stops_or_delays_westlaw(self):
        step = step_zero()
        self.assertIn("With every row ok, say nothing.", step)
        self.assertIn("Westlaw is not delayed", step)
        self.assertIn("never a stop", step)

    def test_an_install_is_named_never_run(self):
        self.assertIn("is the practitioner's to run, never yours", step_zero())

    def test_the_front_door_names_no_commons_tool(self):
        # The packager's dependency-direction check scans this file too, so the literals are split.
        text = FRONT_DOOR.read_text(encoding="utf-8")
        for literal in ("legal_" + "commons__", "/legal-" + "commons"):
            self.assertNotIn(literal, text)


class TemplateTests(unittest.TestCase):
    def test_the_template_carries_the_preflight_field_and_its_cap_rule(self):
        block = template()
        self.assertIn("Preflight: all ok / <row>: <state>[; <row>: <state>]", block)
        self.assertIn("commons reads NOT AUDITED: <its state>, CanLII reads no key. Make no call to it.", block)

    def test_the_tool_step_zero_names_is_registered_read_only(self):
        schema = SCHEMA.read_text(encoding="utf-8")
        start = schema.index(f'name: "{TOOL}"')
        annotations = schema[schema.index("annotations:", start):]
        self.assertTrue(annotations.startswith("annotations: { readOnlyHint: true"))


if __name__ == "__main__":
    unittest.main()
