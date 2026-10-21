import json
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "hooks" / "practitioner-words-gate.py"
PLUGIN_JSON = Path(__file__).resolve().parents[4] / "source" / "litigator" / "plugin.json"
PLUGIN_HOOK_ARG = "${CLAUDE_PLUGIN_ROOT}/skills/drafting-data/hooks/practitioner-words-gate.py"
REVISION_MD = Path(__file__).parents[1] / "references" / "paragraph-revision.md"

# #758's fixture pair.
TURN = "I want an order for a list of documents, verified by affidavit."
RECOMPOSED = "Draft the order for a verified list of documents"
CUT = "an order for a list of documents"

GOAL_FIELD = "field: drafting_data__set_board_goal.statement"
GOAL_REFUSAL = "a confirmed statement of goals is neither"


def sql_text(value):
    return "'" + value.replace("'", "''") + "'"


def insert(title, intent):
    """A new job (jobs-create.md §3)."""
    return ("INSERT INTO tickets (proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created)\n"
            f"  VALUES (1, 1, {sql_text(title)}, {sql_text(intent)}, 'work', 4, 'L1|issue', "
            "strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'));")


def update(title, intent):
    """An existing job's title and intent rewritten (jobs-create.md §3a)."""
    return (f"UPDATE tickets SET title = {sql_text(title)}, intent = {sql_text(intent)}\n"
            "  WHERE id = 42 AND status = 'queued' AND rejected_at IS NULL;")


GUARD = "FROM tickets WHERE id = 2 AND locked_by = 'sess-a1'"


def replace_steps(*texts):
    """jobs-run.md §5's step replacement on job 2, one INSERT ... SELECT per step."""
    return "\n".join(
        [f"DELETE FROM ticket_steps WHERE ticket_id = 2 AND EXISTS (SELECT 1 {GUARD});"]
        + [f"INSERT INTO ticket_steps (ticket_id, ordinal, text)\n  SELECT 2, {n}, {sql_text(t)} {GUARD};"
           for n, t in enumerate(texts, 1)]
        + ["UPDATE tickets SET plan_approved_at = strftime('%Y-%m-%dT%H:%M', 'now', 'localtime') "
           "WHERE id = 2 AND locked_by = 'sess-a1';"])


def turn_line(text, **kw):
    return {"type": "user", "promptSource": "sdk", "origin": {"kind": "human"},
            "message": {"role": "user", "content": text}, **kw}


def queued_line(text, origin=None, **kw):
    """A message sent while the session is mid-turn: an attachment record, not a `user` one (#1358)."""
    return {"type": "attachment", "attachment": {"type": "queued_command", "prompt": text, "commandMode": "prompt",
                                                 "origin": {"kind": "human"} if origin is None else origin, **kw}}


IMAGE = {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "iVBORw0KGgo="}}


def image_queued_line(*texts, origin=None, **kw):
    """A message sent mid-turn with an image attached: its prompt is a list of image and text parts (#1456)."""
    return queued_line([IMAGE] + [{"type": "text", "text": t} for t in texts], origin=origin, **kw)


def widget_line(*values):
    cards = "".join(f'<div class="elicit-card" data-value="{v.replace("&", "&amp;")}">{v}</div>' for v in values)
    return {"type": "assistant", "message": {"content": [
        {"type": "tool_use", "id": "w1", "name": "mcp__visualize__show_widget",
         "input": {"widget_code": f'<form class="elicit">{cards}<textarea class="elicit-textarea"></textarea></form>'}}]}}


def tool_lines(name, result):
    return [{"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "t1", "name": name, "input": {}}]}},
            {"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "t1",
                                                      "content": [{"type": "text", "text": json.dumps(result)}]}]}}]


# Harness context Claude Code puts inside a practitioner's record (#1366).
REMINDER = ("<system-reminder>\nNotes for the connected folder: Chase the guarantor on the overdue note.\n"
            "</system-reminder>")
TYPED = "Take the note-up."


def reminder_parts_line(*texts, **kw):
    return turn_line([{"type": "text", "text": t} for t in texts], **kw)


def reply_line(text, **kw):
    """One assistant record holding one text part: the session's visible reply."""
    return {"type": "assistant", "message": {"content": [{"type": "text", "text": text}]}, **kw}


# An on-the-fly revision of fact 12 (paragraph-revision.md §4).
OLD = "The invoice was delivered on April 2nd 2025."
REVISED = "The invoice was delivered on 2 April 2025."
ALTERNATIVE = "The invoice was delivered to the defendant on 2 April 2025."
ASK = f"Change fact 3 to: {REVISED}"


def shown(text):
    """The session's reply showing one revised paragraph, whole, in its only fenced code block."""
    return f"The revised paragraph:\n\n```\n{text}\n```\n\nApprove it?"


def execute_lines(sql):
    """An earlier drafting_data__execute call and its result."""
    use, res = tool_lines("mcp__plugin_lawyer_data__drafting_data__execute", {"ok": True})
    use["message"]["content"][0]["input"] = {"sql_script": sql}
    return [use, res]


def revision(new, choice, origin, select=False, update_text=None):
    """The one-script write: the guarded UPDATE (none for 'current') and the audit INSERT, by VALUES or by SELECT."""
    upd = ("" if choice == "current" else
           f"UPDATE facts SET postulate = {sql_text(new if update_text is None else update_text)}\n"
           f"  WHERE id = 12 AND postulate = {sql_text(OLD)};\n")
    values = (f"'facts', 12, 'postulate', {sql_text(OLD)}, {sql_text(new)}, {sql_text(REVISED)}, {sql_text(ALTERNATIVE)}, "
              f"NULL, {sql_text(choice)}, {sql_text(origin)}, 'sess-a1', strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')")
    body = (f"SELECT {values.replace(', 12, ', ', id, ', 1)}\n"
            f"  FROM facts WHERE id = 12 AND postulate = {sql_text(new)} AND changes() = 1;" if select
            else f"VALUES ({values});")
    return (upd + "INSERT INTO paragraph_revisions (entity, entity_id, field, old_text, new_text, proposed_text, "
            "alternative_text, review_flags, choice, origin, session_token, created)\n  " + body)


def answer_lines(question, answer):
    """An AskUserQuestion call and its answer: a tool result in a `user` record that carries no
    promptSource and no origin, the answers also in toolUseResult."""
    asked = [{"question": question, "header": "Approve", "multiSelect": False,
              "options": [{"label": answer, "description": ""}, {"label": "No", "description": ""}]}]
    return [{"type": "assistant", "message": {"content": [
                {"type": "tool_use", "id": "q1", "name": "AskUserQuestion", "input": {"questions": asked}}]}},
            {"type": "user", "toolUseResult": {"questions": asked, "answers": {question: answer}},
             "message": {"role": "user", "content": [
                 {"type": "tool_result", "tool_use_id": "q1",
                  "content": f'Your questions have been answered: "{question}"="{answer}". '
                             "You can now continue with these answers in mind."}]}}]


class GateTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.transcript = Path(self.tmp.name) / "session.jsonl"
        self.write_transcript(turn_line(TURN))

    def tearDown(self):
        self.tmp.cleanup()

    def write_transcript(self, *lines):
        self.transcript.write_text("".join(json.dumps(line) + "\n" for line in lines), encoding="utf-8")

    def run_payload(self, tool, tool_input, transcript=None):
        payload = {"hook_event_name": "PreToolUse", "session_id": "s-1",
                   "tool_name": f"mcp__plugin_lawyer_data__drafting_data__{tool}", "tool_input": tool_input,
                   "transcript_path": str(self.transcript) if transcript is None else transcript}
        return subprocess.run([sys.executable, str(SCRIPT)], input=json.dumps(payload).encode("utf-8"),
                              capture_output=True)

    def run_hook(self, sql, transcript=None):
        return self.run_payload("execute", {"db_path": "C:/matter/submission.sqlite", "sql_script": sql}, transcript)

    def run_goal(self, statement, status="confirmed", transcript=None):
        return self.run_payload("set_board_goal", {"db_path": "C:/matter/submission.sqlite", "filing_id": 1,
                                                   "status": status, "statement": statement}, transcript)

    def assertPassed(self, result):
        self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8"))

    def assertRefused(self, result, *fragments):
        self.assertEqual(result.returncode, 2, result.stderr)
        stderr = result.stderr.decode("utf-8")
        for fragment in fragments:
            self.assertIn(fragment, stderr)


class JobWordingIsNotGatedTest(GateTestCase):
    """2026-10-20 ruling: a job's title, intent and steps, and a suppression note, need no practitioner words."""

    def test_a_session_worded_job_insert_passes(self):
        # The practitioner approved a numbered list of issues with "No more issues.": no turn holds the wording.
        self.write_transcript(turn_line("Research these issues."),
                              reply_line("1. Whether the limitation period was postponed"), turn_line("No more issues."))
        job = insert("Research whether the limitation period was postponed",
                     "Find whether discoverability postponed the limitation period.")
        steps = ("INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (20, 1, 'Put the question to /legal-research');\n"
                 "INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (20, 2, 'Save the answer under this job');")
        for sql in (job, steps, job + "\n" + steps):
            for transcript in (None, ""):
                with self.subTest(sql=sql[:30], transcript=transcript):
                    self.assertPassed(self.run_hook(sql, transcript=transcript))

    def test_session_worded_job_rewrites_pass(self):
        self.assertPassed(self.run_hook(update(RECOMPOSED, "The practitioner wants a verified list.")))
        self.assertPassed(self.run_hook(replace_steps("Audit the exhibit list", "Reconcile against the disclosure log")))
        self.assertPassed(self.run_hook("UPDATE ticket_steps SET text = 'Reconcile the log' WHERE ticket_id = 9 AND ordinal = 1;"))

    def test_a_session_worded_suppression_note_passes(self):
        self.assertPassed(self.run_hook(
            "INSERT INTO marker_suppressions (marker, keyed_table, keyed_id, item, suppressed_on, note)\n"
            "  VALUES ('👤', 'facts', 12, 'x', '2026-10-08', 'Counsel says the delivery date is agreed');",
            transcript=""))


class TranscriptTurnsTest(GateTestCase):
    """Which records are the practitioner's words, read through a confirmed statement of goals."""

    def test_a_statement_cut_from_the_turn_passes_and_a_recomposed_one_is_refused(self):
        self.assertPassed(self.run_goal(CUT))
        self.assertPassed(self.run_goal("An  order for a list of documents"))
        self.assertRefused(self.run_goal(RECOMPOSED), GOAL_REFUSAL, GOAL_FIELD, f"wrote: {RECOMPOSED}",
                           f"nearest turn: {TURN}")

    def test_compares_punctuation_as_written(self):
        self.write_transcript(turn_line("I want the list of documents. Verified by affidavit is what I am after."))
        self.assertRefused(self.run_goal("the list of documents verified by affidavit"), GOAL_FIELD)

    def test_reads_non_ascii_text_intact(self):
        turn = "Quote Smith v. Jones — the implied-term test, café owner's point"
        self.write_transcript(turn_line(turn))
        self.assertPassed(self.run_goal("Smith v. Jones — the implied-term test, café"))

    def test_only_practitioner_turns_are_a_comparand(self):
        self.write_transcript(
            turn_line(TURN),
            turn_line(RECOMPOSED, isMeta=True),
            {"type": "user", "promptSource": None, "message": {"content": RECOMPOSED}},
            {"type": "user", "origin": {"kind": "human"}, "message": {"content": RECOMPOSED}},
            {"type": "user", "message": {"content": [{"type": "tool_result", "content": RECOMPOSED}]}},
            {"type": "assistant", "message": {"content": [{"type": "text", "text": RECOMPOSED}]}},
        )
        self.assertRefused(self.run_goal(RECOMPOSED), GOAL_FIELD)

    def command_line(self, args, **kw):
        body = f"<command-message>draft</command-message>\n<command-name>/draft</command-name>\n<command-args>{args}</command-args>"
        return {"type": "user", "origin": {"kind": "human"}, "message": {"role": "user", "content": body}, **kw}

    def test_the_text_typed_with_a_command_is_a_practitioner_turn(self):
        self.write_transcript(self.command_line(TURN))
        self.assertPassed(self.run_goal(CUT))
        self.assertRefused(self.run_goal(RECOMPOSED), GOAL_FIELD, f"nearest turn: {TURN}")

    def test_a_command_name_supplies_no_words(self):
        self.write_transcript(self.command_line(TURN))
        self.assertRefused(self.run_goal("draft"), GOAL_FIELD)
        self.assertRefused(self.run_goal("/draft"), GOAL_FIELD)

    def test_a_command_with_no_arguments_supplies_no_words(self):
        self.write_transcript(self.command_line(""))
        result = self.run_goal("draft")
        self.assertRefused(result, GOAL_FIELD)
        self.assertNotIn("nearest turn", result.stderr.decode("utf-8"))

    def test_the_skill_body_after_a_command_supplies_no_words(self):
        self.write_transcript(self.command_line(TURN), turn_line(RECOMPOSED, isMeta=True, promptSource=None))
        self.assertRefused(self.run_goal(RECOMPOSED), GOAL_FIELD)

    def test_a_task_notification_is_not_a_practitioner_turn(self):
        self.write_transcript(
            turn_line(TURN, origin={"kind": "human"}),
            turn_line("<task-notification>" + RECOMPOSED, origin={"kind": "task-notification"}),
        )
        self.assertRefused(self.run_goal(RECOMPOSED), GOAL_FIELD)
        self.assertPassed(self.run_goal(CUT))

    def test_a_terminal_session_typed_or_queued_turn_counts(self):
        for source in ("typed", "queued"):
            self.write_transcript(turn_line(TURN, promptSource=source))
            self.assertPassed(self.run_goal(CUT))

    def test_a_message_sent_mid_turn_is_a_practitioner_turn(self):
        self.write_transcript(queued_line(TURN))
        self.assertPassed(self.run_goal(CUT))
        for line in (queued_line(TURN, origin={"kind": "task-notification", "producer": "session-task"}),
                     queued_line(TURN, origin={"kind": "peer", "from": "uds:peer"}),
                     queued_line(TURN, origin={"kind": "coordinator"}),
                     queued_line(TURN, isMeta=True)):
            with self.subTest(line=line):
                self.write_transcript(line)
                self.assertRefused(self.run_goal(CUT), GOAL_FIELD)

    def test_a_message_sent_mid_turn_with_an_image_counts_its_text_parts(self):
        self.write_transcript(image_queued_line(TURN))
        self.assertPassed(self.run_goal(CUT))
        self.write_transcript(queued_line([IMAGE, IMAGE]))
        self.assertRefused(self.run_goal(CUT), GOAL_FIELD)
        for line in (image_queued_line(TURN, origin={"kind": "peer", "from": "uds:peer"}),
                     image_queued_line(TURN, isMeta=True)):
            with self.subTest(line=line):
                self.write_transcript(line)
                self.assertRefused(self.run_goal(CUT), GOAL_FIELD)

    def test_reminders_supply_no_words(self):
        for line in (reminder_parts_line(REMINDER, TYPED), turn_line(REMINDER + "\n" + TYPED),
                     image_queued_line(REMINDER, TYPED), self.command_line(REMINDER + TYPED),
                     queued_line(REMINDER + TYPED)):
            with self.subTest(line=line):
                self.write_transcript(line)
                self.assertRefused(self.run_goal("Chase the guarantor"), GOAL_FIELD)
                self.assertPassed(self.run_goal("the note-up"))

    def test_a_value_cannot_match_across_a_removed_reminder(self):
        self.write_transcript(turn_line(REMINDER + TYPED))
        self.assertRefused(self.run_goal("the overdue note. </system-reminder>Take the note-up"), GOAL_FIELD)
        self.write_transcript(turn_line("Draft the " + REMINDER + " opening submissions."))
        self.assertRefused(self.run_goal("Draft the opening submissions"), GOAL_FIELD)

    def test_a_record_holding_only_reminders_is_not_a_turn(self):
        self.write_transcript(turn_line(REMINDER), reminder_parts_line(REMINDER, " \n"))
        result = self.run_goal("Chase the guarantor")
        self.assertRefused(result, GOAL_FIELD)
        self.assertNotIn("nearest turn", result.stderr.decode("utf-8"))

    def test_an_accepted_prompt_suggestion_or_originless_turn_is_not_a_practitioner_turn(self):
        self.write_transcript(
            turn_line(TURN, promptSource="suggestion_accepted"),
            {"type": "user", "promptSource": "sdk", "message": {"content": TURN}},
        )
        self.assertRefused(self.run_goal(CUT), GOAL_FIELD)

    def test_a_widget_selection_supplies_no_words(self):
        self.write_transcript(turn_line(TURN), widget_line(RECOMPOSED, "Something else"),
                              turn_line(f"Selected: {RECOMPOSED}"))
        self.assertRefused(self.run_goal(RECOMPOSED), GOAL_FIELD)
        self.write_transcript(widget_line(RECOMPOSED, "Something else"),
                              queued_line(f"Selected: {RECOMPOSED}\nAnswer: {TURN}"))
        self.assertRefused(self.run_goal(RECOMPOSED), GOAL_FIELD, "[widget value]")
        self.assertPassed(self.run_goal(CUT))

    def test_a_typed_answer_still_counts_when_a_later_card_reuses_it(self):
        self.write_transcript(turn_line(TURN), widget_line(CUT), turn_line(f"Selected: {CUT}"))
        self.assertPassed(self.run_goal(CUT))

    def test_a_long_nearest_turn_is_echoed_as_a_bounded_window(self):
        # A shorter shared run ("the order for a ") sits far from the longest, which is spread over doubled spaces.
        typed = "See the order for a hearing. " + "Background. " * 30 + "  ".join(TURN.split()) + " Further context." * 30
        self.write_transcript(turn_line(REMINDER * 20 + "\n" + typed))
        result = self.run_goal(RECOMPOSED)
        self.assertRefused(result, GOAL_FIELD)
        stderr = result.stderr.decode("utf-8")
        self.assertNotIn("system-reminder", stderr)
        echo = next(line for line in stderr.splitlines() if line.startswith("  nearest turn: "))
        echo = echo[len("  nearest turn: "):]
        self.assertTrue(echo.startswith("…") and echo.endswith("…"), echo)
        self.assertLessEqual(len(echo.strip("…")), 300)
        self.assertIn(" list of documents", echo)


class BoardGoalTest(GateTestCase):
    """A confirmed statement of goals: the practitioner's words, or the one shown block approved by a bare yes."""

    STATEMENT = "Goal: The court orders the defendant to produce a list of documents verified by affidavit."

    def test_the_shown_statement_passes_after_a_bare_yes(self):
        self.write_transcript(turn_line(TURN), reply_line(f"```\n{self.STATEMENT}\n```\n\nDoes that capture your goal "
                                                          "accurately and completely?"), turn_line("Yes"))
        self.assertPassed(self.run_goal(self.STATEMENT))

    def test_the_shown_statement_is_refused_without_a_bare_yes(self):
        for last in ("Yes, but add costs.", "Close enough, but I am not sure."):
            with self.subTest(last=last):
                self.write_transcript(turn_line(TURN), reply_line(f"```\n{self.STATEMENT}\n```"), turn_line(last))
                self.assertRefused(self.run_goal(self.STATEMENT), GOAL_REFUSAL, GOAL_FIELD, "shown: 1 fenced block(s)")

    def test_a_statement_never_shown_is_refused_even_after_a_yes(self):
        self.write_transcript(turn_line(TURN), reply_line("Shall I record your goal?"), turn_line("Yes"))
        self.assertRefused(self.run_goal(self.STATEMENT), GOAL_REFUSAL, "shown: 0 fenced block(s)")

    def test_an_inferred_or_declined_statement_passes_unchecked(self):
        self.assertPassed(self.run_goal(self.STATEMENT.replace(".", "?"), status="inferred", transcript=""))
        self.assertPassed(self.run_goal(None, status="declined", transcript=""))

    def test_a_confirmed_statement_needs_a_transcript(self):
        self.assertRefused(self.run_goal(self.STATEMENT, transcript=""), "no transcript_path")
        missing = str(Path(self.tmp.name) / "absent.jsonl")
        self.assertRefused(self.run_goal(self.STATEMENT, transcript=missing), missing)


class ParagraphRevisionTest(GateTestCase):
    """An on-the-fly paragraph revision (paragraph-revision.md, draft/references/revise-on-the-fly.md)."""

    def approved(self, text, last_turn="Yes", *after):
        """The ask, the reply showing one revised paragraph, then the practitioner's answer."""
        self.write_transcript(turn_line(ASK), reply_line(shown(text)), turn_line(last_turn), *after)

    def test_a_revision_in_the_practitioners_typed_words_passes(self):
        self.approved(REVISED)
        self.assertPassed(self.run_hook(revision(REVISED, "proposed", "practitioner")))

    def test_the_models_paragraph_shown_and_approved_passes(self):
        self.approved(ALTERNATIVE)
        self.assertPassed(self.run_hook(revision(ALTERNATIVE, "alternative", "model")))

    def test_a_paragraph_shown_in_a_sent_message_passes(self):
        sent = {"type": "assistant", "message": {"content": [
            {"type": "tool_use", "id": "m1", "name": "SendUserMessage", "input": {"message": shown(ALTERNATIVE)}}]}}
        self.write_transcript(turn_line(ASK), sent, turn_line("Yes"))
        self.assertPassed(self.run_hook(revision(ALTERNATIVE, "alternative", "model")))

    def test_a_paragraph_from_an_older_reply_is_refused(self):
        self.write_transcript(turn_line(ASK), reply_line(shown(ALTERNATIVE)), turn_line("Let me think about it."),
                              reply_line("Take your time."), turn_line("Yes"))
        self.assertRefused(self.run_hook(revision(ALTERNATIVE, "alternative", "model")),
                           "field: paragraph_revisions.new_text", "exactly one fenced code block", "that reply holds 0")

    def test_a_second_paragraph_in_the_reply_is_refused(self):
        self.write_transcript(turn_line(ASK), reply_line(shown(REVISED) + "\n\n```\n" + ALTERNATIVE + "\n```"),
                              turn_line("Yes"))
        self.assertRefused(self.run_hook(revision(ALTERNATIVE, "alternative", "model")),
                           "field: paragraph_revisions.new_text", "exactly one fenced code block", "that reply holds 2")

    def test_a_shown_paragraph_is_refused_when_the_last_turn_is_not_a_bare_yes(self):
        for last_turn in ("Yes, but say April 2nd.", "Go with the alternative."):
            with self.subTest(last_turn=last_turn):
                self.approved(ALTERNATIVE, last_turn)
                self.assertRefused(self.run_hook(revision(ALTERNATIVE, "alternative", "model")),
                                   "field: paragraph_revisions.new_text", "not a bare yes", f"last turn: {last_turn}")

    def test_a_fabricated_revision_is_refused(self):
        fabricated = "The invoice was never delivered."
        self.approved(REVISED)
        self.assertRefused(self.run_hook(revision(fabricated, "alternative", "model")),
                           "field: paragraph_revisions.new_text", f"wrote: {fabricated}",
                           "not, character for character", f"shown: {REVISED}")
        self.approved(fabricated)
        self.assertRefused(self.run_hook(revision(fabricated, "proposed", "practitioner")),
                           "field: paragraph_revisions.new_text", f"wrote: {fabricated}", "not an unbroken run")

    def test_one_approval_admits_one_revision(self):
        self.approved(REVISED)
        both = revision(REVISED, "proposed", "practitioner") + "\n" + revision(ALTERNATIVE, "alternative", "model")
        self.assertRefused(self.run_hook(both), "writes 2 paragraph revisions", f"wrote: {ALTERNATIVE}")
        self.approved(REVISED, "Yes", *execute_lines(revision(REVISED, "proposed", "practitioner")))
        self.assertRefused(self.run_hook(revision(REVISED, "proposed", "practitioner")),
                           "already written, or attempted", "field: paragraph_revisions.new_text")

    def test_a_revision_whose_update_writes_other_text_is_refused(self):
        self.write_transcript(turn_line(ASK))
        for sql in (revision(REVISED, "proposed", "practitioner", update_text=ALTERNATIVE),
                    revision(REVISED, "proposed", "practitioner").replace("UPDATE facts", "UPDATE submissions")):
            with self.subTest(sql=sql[:60]):
                self.assertRefused(self.run_hook(sql), "field: paragraph_revisions.new_text",
                                   "UPDATE facts SET postulate")

    def test_keeping_the_current_wording_needs_unchanged_text(self):
        self.assertPassed(self.run_hook(revision(OLD, "current", "practitioner"), transcript=""))
        self.assertRefused(self.run_hook(revision(REVISED, "current", "practitioner")),
                           "field: paragraph_revisions.new_text", "differs from old_text")

    def test_an_insert_select_revision_passes(self):
        self.approved(REVISED)
        self.assertPassed(self.run_hook(revision(REVISED, "proposed", "practitioner", select=True)))
        self.approved(ALTERNATIVE)
        self.assertPassed(self.run_hook(revision(ALTERNATIVE, "alternative", "model", select=True)))

    def test_a_revision_it_cannot_read_fails_closed(self):
        sql = revision(REVISED, "proposed", "practitioner").replace(f"{sql_text(REVISED)}, {sql_text(REVISED)}",
                                                                    f"upper({sql_text(REVISED)}), {sql_text(REVISED)}", 1)
        self.assertNotEqual(sql, revision(REVISED, "proposed", "practitioner"))
        self.assertRefused(self.run_hook(sql), "cannot read the paragraph revision")
        self.assertRefused(self.run_hook(revision(REVISED, "move", "practitioner")),
                           "cannot read the paragraph revision", "paragraph_revisions.choice 'move'")

    def test_a_wording_revision_needs_a_transcript(self):
        self.assertRefused(self.run_hook(revision(REVISED, "proposed", "practitioner"), transcript=""),
                           "no transcript_path")
        missing = str(Path(self.tmp.name) / "absent.jsonl")
        self.assertRefused(self.run_hook(revision(REVISED, "proposed", "practitioner"), transcript=missing), missing)

    def test_an_ask_user_question_answer_does_not_approve_a_revision(self):
        # The answer is no practitioner turn, so the reply showing the paragraph is still unanswered.
        self.write_transcript(turn_line(ASK), reply_line(shown(ALTERNATIVE)), *answer_lines("Approve it?", "Yes"))
        self.assertRefused(self.run_hook(revision(ALTERNATIVE, "alternative", "model")),
                           "field: paragraph_revisions.new_text", "exactly one fenced code block", "that reply holds 0")

    def test_a_widget_selection_does_not_approve_a_revision(self):
        self.write_transcript(turn_line(ASK), reply_line(shown(ALTERNATIVE)), widget_line("Yes", "No"),
                              turn_line("Selected: Yes"))
        self.assertRefused(self.run_hook(revision(ALTERNATIVE, "alternative", "model")), "not a bare yes")


class FactMoveTest(GateTestCase):
    """A fact move (paragraph-revision.md §6): the section's own swap script, rows 31 and 32 at ordinals 3 and 4."""

    A_ROW = "SELECT 'filing_facts', 31, 'ordinal', '3', '4', NULL, NULL, NULL, 'move', 'practitioner'"

    def swap(self):
        text = REVISION_MD.read_text(encoding="utf-8")
        blocks = re.findall(r"```sql\n(.*?)\n```", text[text.index("## 6. Move"):], re.S)
        return next(b for b in blocks if b.startswith("UPDATE filing_facts"))

    def moved(self, replacement):
        sql = self.swap().replace(self.A_ROW, replacement, 1)
        self.assertNotEqual(sql, self.swap())
        return sql

    def test_the_section_6_swap_passes_with_no_transcript(self):
        self.assertPassed(self.run_hook(self.swap()))
        self.assertPassed(self.run_hook(self.swap(), transcript=""))

    def test_a_move_whose_new_text_differs_from_the_set_value_is_refused(self):
        self.assertRefused(self.run_hook(self.moved(self.A_ROW.replace("'3', '4'", "'3', '5'"))),
                           "field: paragraph_revisions.old_text/new_text", "new_text 5", "SET ordinal = 5")

    def test_a_move_whose_old_text_differs_from_the_where_guard_is_refused(self):
        self.assertRefused(self.run_hook(self.moved(self.A_ROW.replace("'3', '4'", "'2', '4'"))),
                           "field: paragraph_revisions.old_text/new_text", "old_text 2", "AND ordinal = 2")

    def test_a_move_with_no_update_filing_facts_is_refused(self):
        sql = self.swap()
        inserts = sql[sql.index("INSERT INTO paragraph_revisions"):]
        self.assertRefused(self.run_hook(inserts), "field: paragraph_revisions.old_text/new_text",
                           "match no UPDATE filing_facts")

    def test_a_move_with_the_wrong_choice_or_field_is_refused(self):
        for label, row in (("choice", self.A_ROW.replace("'move'", "'other'")),
                           ("field", self.A_ROW.replace("'ordinal'", "'position'"))):
            with self.subTest(label):
                self.assertRefused(self.run_hook(self.moved(row)), "needs field 'ordinal', choice 'move'")

    def test_a_move_whose_entity_id_is_not_a_literal_fails_closed(self):
        self.assertRefused(self.run_hook(self.moved(self.A_ROW.replace(" 31,", " (SELECT 31),"))),
                           "cannot read the paragraph revision", "entity_id of a fact move")


class MergeJobBoardsGateTest(unittest.TestCase):
    """docs/ADRs/0010: a merge of two Job Boards passes only on the practitioner's bare yes."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.transcript = Path(self.tmp.name) / "session.jsonl"

    def tearDown(self):
        self.tmp.cleanup()

    def run_merge(self, *lines):
        self.transcript.write_text("".join(json.dumps(line) + "\n" for line in lines), encoding="utf-8")
        payload = {"hook_event_name": "PreToolUse", "session_id": "s-1",
                   "tool_name": "mcp__plugin_lawyer_data__drafting_data__merge_job_boards",
                   "tool_input": {"db_path": "C:/matter/submission.sqlite", "boards": [{"filing_id": 1}, {"filing_id": 3}],
                                  "confirmed": True, "session_token": "tok"},
                   "transcript_path": str(self.transcript)}
        return subprocess.run([sys.executable, str(SCRIPT)], input=json.dumps(payload).encode("utf-8"), capture_output=True)

    def test_passes_after_a_bare_yes(self):
        result = self.run_merge(turn_line("merge the stay boards"), reply_line("Goal 12: ... Goal 15: ... Merge them?"), turn_line("yes"))
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_refuses_without_a_bare_yes(self):
        for last in ("merge them if the goals fit", "no"):
            with self.subTest(last=last):
                result = self.run_merge(reply_line("Goal 12: ... Goal 15: ... Merge them?"), turn_line(last))
                self.assertEqual(result.returncode, 2)
                self.assertIn("their last turn is not a bare yes", result.stderr.decode("utf-8"))


class PluginRegistrationTests(unittest.TestCase):
    def test_plugin_registers_the_gate_for_both_tool_name_forms(self):
        manifest = json.loads(PLUGIN_JSON.read_text(encoding="utf-8"))
        entries = [
            entry for entry in manifest["hooks"]["PreToolUse"]
            if any(PLUGIN_HOOK_ARG in h.get("args", []) for h in entry["hooks"])
        ]
        self.assertEqual(len(entries), 1)
        matcher = re.compile(entries[0]["matcher"])
        for prefix in ("mcp__plugin_lawyer_data__", "mcp__remote-devices__plugin_lawyer_data__"):
            for tool in ("execute", "set_board_goal", "merge_job_boards"):
                self.assertTrue(matcher.fullmatch(prefix + "drafting_data__" + tool), prefix + tool)
        self.assertFalse(matcher.fullmatch("mcp__plugin_lawyer_data__drafting_data__query"))
        self.assertFalse(matcher.fullmatch("mcp__plugin_other_data__drafting_data__execute"))


if __name__ == "__main__":
    unittest.main()
