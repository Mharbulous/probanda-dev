"""Locks for the correspondence review gate.

An outgoing email is written only after the source-trace reviewer has read the
exact text it carries, or with DRAFT in its subject (draft SKILL.md ban 20). The gate reads that
from the harness transcript, which the session being checked cannot write.
"""
import json
import re
import sys
import unittest
from pathlib import Path
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "source" / "skills" / "shared" / "tests"))
from hook_runner import run_hook  # noqa: E402


PLUGIN_DIR = Path(__file__).resolve().parents[1]
PLUGIN_JSON = PLUGIN_DIR / "plugin.json"
HOOK = PLUGIN_DIR / "hooks" / "correspondence-review-gate.py"
HOOK_ARG = "${CLAUDE_PLUGIN_ROOT}/hooks/correspondence-review-gate.py"

HARNESS = "mcp__plugin_lawyer_data__drafting_forms__draft_harness"
SAVE_DRAFT = "mcp__plugin_lawyer_contacts-calendars-email__mail__save_draft"
BODY = "Opposing counsel wrote on 3 March that the application was filed.\nWe have asked the registry to confirm."
EML = r"C:\Matters\Smith\0. DRAFT\2026-10-23 email to client re status.eml"


def tool_use(use_id, name, tool_input, sidechain=False):
    return {"type": "assistant", "isSidechain": sidechain,
            "message": {"content": [{"type": "tool_use", "id": use_id, "name": name, "input": tool_input}]}}


def tool_result(use_id, text, sidechain=False):
    return {"type": "user", "isSidechain": sidechain,
            "message": {"content": [{"type": "tool_result", "tool_use_id": use_id,
                                     "content": [{"type": "text", "text": text}]}]}}


def review(body, use_id="r1", sidechain=False, agent="litigator:source-tracer"):
    prompt = "kind: email\naudience: client\ntext:\n" + body + "\nsources: inbox uid 41"
    return [tool_use(use_id, "Agent", {"subagent_type": agent, "prompt": prompt}, sidechain),
            tool_result(use_id, '{"assertions": []}', sidechain)]


class GateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def transcript(self, records):
        path = Path(self.tmp.name) / "session.jsonl"
        path.write_text("".join(json.dumps(r) + "\n" for r in records), encoding="utf-8")
        return str(path)

    def run_hook(self, tool_name, tool_input, records=None):
        payload = {"tool_name": tool_name, "tool_input": tool_input}
        if records is not None:
            payload["transcript_path"] = self.transcript(records)
        result = run_hook(HOOK, json.dumps(payload, ensure_ascii=False), timeout=None, text=True, encoding="utf-8")
        self.assertEqual(result.returncode, 0, result.stderr)
        if not result.stdout.strip():
            return "allow", ""
        decision = json.loads(result.stdout)["hookSpecificOutput"]
        return decision["permissionDecision"], decision["permissionDecisionReason"]

    def write_email(self, records, body=BODY, subject="Status"):
        return self.run_hook(HARNESS, {"step": "write_email", "matter_root": "M", "to": ["a@b.c"],
                                       "subject": subject, "body": body}, records)

    def test_a_draft_labelled_subject_needs_no_review(self):
        self.assertEqual(self.write_email([], subject="DRAFT - Status")[0], "allow")

    def test_only_the_capitalised_word_draft_is_a_label(self):
        for subject in ("Draft - Status", "draft status", "DRAFTS of the order"):
            with self.subTest(subject=subject):
                self.assertEqual(self.write_email([], subject=subject)[0], "deny")

    def test_the_refusal_names_the_draft_route(self):
        self.assertIn("DRAFT", self.write_email([])[1])

    def test_allows_an_email_the_reviewer_read(self):
        self.assertEqual(self.write_email(review(BODY))[0], "allow")

    def test_whitespace_differences_do_not_matter(self):
        self.assertEqual(self.write_email(review(BODY.replace("\n", "\n\n  ")))[0], "allow")

    def test_allows_non_ascii_text_the_reviewer_read(self):
        body = BODY.replace("wrote", "wrote — through Mr. Gagné —")
        self.assertEqual(self.write_email(review(body), body=body)[0], "allow")

    def test_refuses_with_no_review(self):
        decision, reason = self.write_email([])
        self.assertEqual(decision, "deny")
        self.assertIn("checked against", reason)

    def test_an_empty_body_needs_no_review(self):
        for body in ("", "  \n\t "):
            with self.subTest(body=body):
                self.assertEqual(self.write_email([], body=body)[0], "allow")

    def test_refuses_when_the_reviewer_read_other_text(self):
        self.assertEqual(self.write_email(review(BODY.replace("3 March", "4 March")))[0], "deny")

    def test_refuses_when_the_review_has_not_returned(self):
        records = review(BODY)[:1]
        self.assertEqual(self.write_email(records)[0], "deny")

    def test_refuses_a_review_run_inside_a_subagent(self):
        self.assertEqual(self.write_email(review(BODY, sidechain=True))[0], "deny")

    def test_refuses_a_different_agent(self):
        self.assertEqual(self.write_email(review(BODY, agent="general-purpose"))[0], "deny")

    def test_refuses_with_no_transcript(self):
        self.assertEqual(self.write_email(None)[0], "deny")

    def test_other_harness_steps_pass(self):
        self.assertEqual(self.run_hook(HARNESS, {"step": "scrutiny_review"}, [])[0], "allow")

    def test_save_draft_allows_an_email_written_here(self):
        records = review(BODY) + [
            tool_use("w1", HARNESS, {"step": "write_email", "body": BODY}),
            tool_result("w1", json.dumps({"path": EML, "signature_source": "template"})),
        ]
        self.assertEqual(self.run_hook(SAVE_DRAFT, {"eml_path": EML}, records)[0], "allow")

    def test_save_draft_refuses_another_file(self):
        records = [tool_use("w1", HARNESS, {"step": "write_email", "body": BODY}),
                   tool_result("w1", json.dumps({"path": EML}))]
        other = EML.replace("status", "costs")
        self.assertEqual(self.run_hook(SAVE_DRAFT, {"eml_path": other}, records)[0], "deny")

    def test_save_draft_refuses_with_no_transcript(self):
        self.assertEqual(self.run_hook(SAVE_DRAFT, {"eml_path": EML})[0], "deny")

    def test_writing_an_eml_by_hand_is_refused(self):
        for tool in ("Write", "Edit", "MultiEdit"):
            with self.subTest(tool=tool):
                self.assertEqual(self.run_hook(tool, {"file_path": EML.replace(".eml", ".EML")})[0], "deny")

    def test_writing_other_files_passes(self):
        self.assertEqual(self.run_hook("Write", {"file_path": r"C:\notes\draft.md"})[0], "allow")

    def test_refusals_name_no_internals(self):
        for reason in (self.write_email([])[1], self.run_hook(SAVE_DRAFT, {"eml_path": EML}, [])[1],
                       self.run_hook("Write", {"file_path": EML})[1]):
            with self.subTest(reason=reason):
                self.assertNotRegex(reason, r"\w__\w|source-tracer|transcript|hook")


class MatcherTests(unittest.TestCase):
    def test_matcher_covers_exactly_the_delivery_tools(self):
        manifest = json.loads(PLUGIN_JSON.read_text(encoding="utf-8"))
        entries = [e for e in manifest["hooks"]["PreToolUse"]
                   if any(HOOK_ARG in h.get("args", []) for h in e["hooks"])]
        self.assertEqual(len(entries), 1)
        pattern = re.compile(entries[0]["matcher"])
        for name in (HARNESS, SAVE_DRAFT, "mcp__remote-devices__" + HARNESS[5:],
                     "mcp__remote-devices__" + SAVE_DRAFT[5:], "Write", "Edit", "MultiEdit"):
            with self.subTest(name=name):
                self.assertTrue(pattern.fullmatch(name))
        for name in ("Read", "mcp__plugin_lawyer_data__drafting_forms__render",
                     "mcp__plugin_lawyer_contacts-calendars-email__mail__get_email"):
            with self.subTest(name=name):
                self.assertFalse(pattern.fullmatch(name))


if __name__ == "__main__":
    unittest.main()
