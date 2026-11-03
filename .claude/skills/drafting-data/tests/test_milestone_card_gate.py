import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "shared" / "tests"))
from hook_runner import run_hook  # noqa: E402

SCRIPT = Path(__file__).resolve().parents[1] / "hooks" / "milestone-card-gate.py"
PAGE = r"<matter>\0. DRAFT\Work Board 3.html"
OPEN = "mcp__remote-devices__plugin_lawyer_data__drafting_forms__open_session"
RENDER = "mcp__plugin_lawyer_data__drafting_forms__render"
COMPLETE = "mcp__plugin_lawyer_data__drafting_data__complete_job"
ATTACH = "mcp__plugin_lawyer_data__drafting_data__attach_to_board"


def run(payload):
    return run_hook(SCRIPT, json.dumps(payload), timeout=None, text=True, encoding="utf-8")


def mcp_text(result):
    return [{"type": "text", "text": json.dumps(result)}]


def filing_render(pages_written, board_changed):
    return {"filing_id": 3, "documents": [{"document_type": "Work_board", "path": PAGE, "file_name": "Work Board 3.html",
                                           "pages_written": pages_written, "board_changed": board_changed}]}


class Transcript:
    """A session transcript: one practitioner prompt, then the given tool calls and their results."""

    def __init__(self, calls, prompt="Show me all the Work Boards"):
        self.lines = [{"type": "user", "message": {"role": "user", "content": prompt}}]
        for n, (name, tool_input, result) in enumerate(calls):
            self.lines.append({"type": "assistant", "message": {"role": "assistant", "content": [
                {"type": "tool_use", "id": f"t{n}", "name": name, "input": tool_input}]}})
            self.lines.append({"type": "user", "message": {"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": f"t{n}", "content": mcp_text(result) if result is not None else "ok"}]}})

    def write(self, folder):
        path = Path(folder) / "t.jsonl"
        path.write_text("\n".join(json.dumps(line) for line in self.lines) + "\n", encoding="utf-8")
        return str(path)


class StopTest(unittest.TestCase):
    def stop(self, calls, stop_hook_active=False, prompt="Show me all the Work Boards"):
        with tempfile.TemporaryDirectory() as folder:
            result = run({"hook_event_name": "Stop", "stop_hook_active": stop_hook_active,
                          "transcript_path": Transcript(calls, prompt).write(folder)})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, "")
        return json.loads(result.stdout) if result.stdout.strip() else None

    def test_pages_written_and_no_card_blocks(self):
        out = self.stop([(OPEN, {"matter_root": "<matter>"}, {"milestone_path": PAGE, "milestone_paths": []})])
        self.assertEqual(out["decision"], "block")
        self.assertIn(PAGE, out["reason"])

    def test_present_files_card_allows(self):
        self.assertIsNone(self.stop([(OPEN, {}, {"milestone_path": PAGE}),
                                     ("mcp__cowork__present_files", {"files": [{"file_path": PAGE}]}, None)]))

    def test_staged_send_user_file_allows(self):
        staged = "/mnt/user-data/uploads/Work Board 3.html"
        self.assertIsNone(self.stop([(OPEN, {}, {"milestone_path": PAGE}),
                                     ("mcp__remote-devices__device_stage_files", {"paths": [PAGE]}, {"staged": [staged]}),
                                     ("SendUserFile", {"file_path": staged}, None)]))

    def test_card_for_another_page_still_blocks(self):
        out = self.stop([(OPEN, {}, {"milestone_path": PAGE}),
                         ("mcp__cowork__present_files", {"files": [{"file_path": r"<matter>\0. DRAFT\Work Board 4.html"}]}, None)])
        self.assertEqual(out["decision"], "block")

    def test_card_before_the_result_does_not_count(self):
        out = self.stop([("mcp__cowork__present_files", {"files": [{"file_path": PAGE}]}, None),
                         (COMPLETE, {"job_id": 7}, {"pages_written": True, "board_changed": True, "milestone_path": PAGE})])
        self.assertEqual(out["decision"], "block")

    def test_render_with_board_unchanged_does_not_block(self):
        self.assertIsNone(self.stop([(RENDER, {"filing_id": 3, "draft_dir": "<matter>"}, filing_render(True, False))],
                                    prompt="Add a job"))

    def test_render_with_board_changed_blocks(self):
        out = self.stop([(RENDER, {"filing_id": 3, "draft_dir": "<matter>"}, filing_render(True, True))])
        self.assertEqual(out["decision"], "block")

    def test_proceeding_render_with_board_changed_blocks(self):
        out = self.stop([(RENDER, {"proceeding_id": 2}, {"pages_written": True, "board_changed": True, "milestone_path": PAGE})])
        self.assertEqual(out["decision"], "block")

    def test_bootstrap_is_never_due(self):
        bootstrap = "mcp__plugin_lawyer_data__drafting_forms__bootstrap"
        self.assertIsNone(self.stop([(bootstrap, {"draft_dir": "<matter>"}, {"milestone_paths": [{"path": PAGE}]})]))

    def test_never_blocks_twice_in_a_row(self):
        self.assertIsNone(self.stop([(OPEN, {}, {"milestone_path": PAGE})], stop_hook_active=True))

    def test_an_earlier_turn_is_not_judged(self):
        with tempfile.TemporaryDirectory() as folder:
            transcript = Transcript([(OPEN, {}, {"milestone_path": PAGE})])
            transcript.lines.append({"type": "user", "message": {"role": "user", "content": "Thanks"}})
            result = run({"hook_event_name": "Stop", "transcript_path": transcript.write(folder)})
        self.assertEqual(result.stdout.strip(), "")


class PostToolUseTest(unittest.TestCase):
    def post(self, tool, response):
        result = run({"hook_event_name": "PostToolUse", "tool_name": tool, "tool_input": {}, "tool_response": response})
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)["hookSpecificOutput"]["additionalContext"] if result.stdout.strip() else None

    def test_open_session_names_the_page(self):
        context = self.post(OPEN, mcp_text({"milestone_path": PAGE}))
        self.assertIn(PAGE, context)
        self.assertIn("present_files", context)
        self.assertIn("SendUserFile", context)

    def test_staging_route_stages_at_once_when_the_folder_is_known_connected(self):
        context = self.post(OPEN, mcp_text({"milestone_path": PAGE}))
        self.assertIn("tool list", context)
        self.assertIn("at once when the session context or an earlier get_device_info shows the matter folder connected", context)
        self.assertNotIn("first check", context)
        self.assertLess(context.index("device_stage_files"), context.index("device_request_folder_access"))

    def test_staging_route_reloads_the_stage_tool_and_never_sends_the_pc_path(self):
        context = self.post(OPEN, mcp_text({"milestone_path": PAGE}))
        self.assertIn("never the PC path", context)
        self.assertIn("select: ToolSearch", context)

    def test_response_given_as_object_or_content_dict(self):
        self.assertIn(PAGE, self.post(COMPLETE, {"pages_written": True, "board_changed": True, "milestone_path": PAGE}))
        self.assertIn(PAGE, self.post(RENDER, {"content": mcp_text(filing_render(True, True))}))

    def test_attach_names_its_page_when_it_changed(self):
        self.assertIn(PAGE, self.post(ATTACH, mcp_text({"pages_written": True, "board_changed": True, "milestone_path": PAGE})))
        self.assertIsNone(self.post(ATTACH, mcp_text({"pages_written": True, "board_changed": False, "milestone_path": PAGE})))

    def test_nothing_written_says_nothing(self):
        self.assertIsNone(self.post(RENDER, mcp_text(filing_render(False, False))))
        self.assertIsNone(self.post(COMPLETE, mcp_text({"pages_written": False})))
        self.assertIsNone(self.post(OPEN, mcp_text({"milestone_path": None})))

    def test_error_text_says_nothing(self):
        self.assertIsNone(self.post(OPEN, "Error: no such matter"))


if __name__ == "__main__":
    unittest.main()
