import importlib.util
import json
import re
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("practitioner-words-gate.py")
STOCK_MD = Path(__file__).parents[1] / "references" / "jobs-stock.md"
GATE_MD = Path(__file__).parents[1] / "references" / "jobs-gate.md"
REVISION_MD = Path(__file__).parents[1] / "references" / "paragraph-revision.md"

# #758's fixture pair.
TURN = "I want an order for a list of documents, verified by affidavit."
RECOMPOSED = "Draft the order for a verified list of documents"
CUT = "an order for a list of documents"

GATE_TITLE = "Pre-filing consistency gate"
GATE_INTENT = ("Run the pre-filing checks on the assembled package and clear or waive every "
               "failure before the Writing is presented as ready to file.")
# jobs-stock.md §3b's stock bundle jobs: (title, intent).
STOCK_JOBS = [
    ("Availability letter", "Obtain the court's availability for the hearing of this application by letter."),
    ("File and serve", "File this Writing in the registry, serve it, and record the filing date and any "
                       "affidavit of service."),
    ("Application book", "Prepare the application book: render its title page and index, then bind them "
                         "with the documents and fill in the page numbers."),
    ("Draft the letter", "Draft this letter and render its mockup for review."),
    ("Deliver", "Send this letter to its recipients and record it as sent."),
    ("Draft the letter", "Draft this memo and render its mockup for review."),
    ("Deliver", "Circulate this memo or put it on file, and record it as sent."),
]

# jobs-stock.md §3c's counsel's review jobs: (title, intent). The review title is the prefix
# plus the filing's own title.
REVIEW_JOBS = [
    ("Prepare the review pages", "Extract the source pages each paragraph of this Writing relies on into the "
                                 "presentation folder, ready for counsel's review."),
    ("Counsel's review of Notice of Application", "Counsel reviews every paragraph of this Writing, in document "
                                                  "order, against its source pages."),
]

# jobs-stock.md §3d's scrutiny review job: the title is the prefix, the authority's title and the statement's id.
SCRUTINY_TITLE = "Review scrutiny finding: X (statement 3)"
SCRUTINY_INTENT = ("Counsel reviews the scrutinizer's finding on this statement of law against the source and "
                   "confirms, revises or drops the statement.")

# jobs-stock.md's fixed step text: §3b's stock bundle jobs, §3c's counsel's review jobs, §3d's scrutiny review job.
STOCK_STEPS = [
    "Draft the chambers-availability letter",
    "File in the registry and record the filing date",
    "Serve the filed documents",
    "Affidavit of service, or n/a",
    "Render the title page and index",
    "Bind the book and fill in the page numbers",
    "Draft the letter",
    "Send the letter to its recipients",
    "Record the letter as sent",
    "Draft the memo",
    "Circulate the memo or put it on file",
    "Record the memo as sent",
    "Extract the source pages into the presentation folder",
    "Review every paragraph and resolve every discussion point",
    "Review the finding against the source and confirm, revise or drop the statement",
]

# The adoption ceremony a refusal names.
CEREMONY = ("Show the proposed wording in one code block, introduce it with the fixed sentence in "
            "shared/paralegal-posture.md section 3, and ask the practitioner to copy it, edit it if needed, "
            "and paste it back.")


def sql_text(value):
    return "'" + value.replace("'", "''") + "'"


def insert(title, intent=TURN):
    """A new job: the gate never reads it."""
    return ("INSERT INTO tickets (proceeding_id, filing_id, title, intent, kind, priority, billing_anchor, created)\n"
            f"  VALUES (1, 1, {sql_text(title)}, {sql_text(intent)}, 'work', 4, 'L1|issue', "
            "strftime('%Y-%m-%dT%H:%M', 'now', 'localtime'));")


def update(title, intent=TURN, extra=""):
    """An existing job's title and intent rewritten (jobs-create.md §3a)."""
    return (f"UPDATE tickets SET title = {sql_text(title)}, intent = {sql_text(intent)}{extra}\n"
            "  WHERE id = 42 AND status = 'queued' AND rejected_at IS NULL;")


GUARD = "FROM tickets WHERE id = 2 AND locked_by = 'sess-a1'"


def replace_steps(*texts):
    """jobs-run.md §5's step replacement on job 2, one INSERT ... SELECT per step."""
    return "\n".join(
        [f"DELETE FROM ticket_steps WHERE ticket_id = 2 AND EXISTS (SELECT 1 {GUARD});"]
        + [f"INSERT INTO ticket_steps (ticket_id, ordinal, text)\n  SELECT 2, {n}, {t} {GUARD};"
           for n, t in enumerate(texts, 1)]
        + ["UPDATE tickets SET plan_approved_at = strftime('%Y-%m-%dT%H:%M', 'now', 'localtime') "
           "WHERE id = 2 AND locked_by = 'sess-a1';"])


def step_update(value):
    """An in-place rewrite of job 9's first step, jobs-gate.md §14's shape."""
    return (f"UPDATE ticket_steps SET text = {value}, done_at = strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')\n"
            "  WHERE ticket_id = 9 AND ordinal = 1 AND text NOT LIKE '% — WAIVED: %'\n"
            "  AND EXISTS (SELECT 1 FROM tickets WHERE id = 9 AND locked_by = 'sess-a1');")


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


def persisted_lines(name, result):
    """A result too large to keep inline: a stub in the content, the full result in toolUseResult (#1358)."""
    use, res = tool_lines(name, result)
    res["message"]["content"][0]["content"] = ("<persisted-output>\nOutput too large (66.1KB). Full output saved to: "
                                               "session\\tool-results\\t1.txt\n\nPreview (first 2KB):\n"
                                               + json.dumps(result)[:40] + "\n...\n</persisted-output>")
    res["toolUseResult"] = [{"type": "text", "text": json.dumps(result)}]
    return [use, res]


ITEM = "Smith v. Jones, 2023 BCCA 182"
PROPOSAL = f"Note up: {ITEM}"
RENDER = {"documents": [{"document_type": "work_board", "board_data": {"proposals": [
    {"key": "note-up:authorities:5", "slug": "note-up", "item": ITEM, "title": PROPOSAL}]}}]}
SHELVED = "Draft a submission for the order: a reserved fallback order"
SUMMARY = "\n".join([
    "# Job Board — Opening Submissions Package (filing 1, proceeding 1) · Rev 3 · Rendered 2026-10-02 09:00 · State: Drafting",
    "## Ready (0)",
    "## Shelved (1 job, 1 proposal)",
    "- #13 Serve the August notice to admit",
    f"- 🦵 {SHELVED}",
    "  key: unserved-petitum:order_sought:2 · item: a reserved fallback order · lane: rejected",
    "## Proposed (1)",
    f"- 📇 {PROPOSAL}",
    "  key: note-up:authorities:5 · item: Smith v. Jones, 2023 BCCA 182 · lane: proposed",
    "## Loose Threads (1)",
    "- 💡 Chase the guarantor",
])
SUMMARY_RENDER = {"documents": [{"document_type": "Work_board", "file_name": "Job Board.html", "board_summary": SUMMARY}]}
# drafting_forms__board_card(lanes: ["proposed", "rejected"]): the lanes the headline only counts.
CARD = {"filing_id": 1, "revision": 3, "rendered_at": "2026-10-02 09:00", "card": "\n".join([
    "## Proposed (1)",
    f"- 📇 {PROPOSAL}",
    "  key: note-up:authorities:5 · item: Smith v. Jones, 2023 BCCA 182 · lane: proposed",
    "## Shelved (1 job, 1 proposal)",
    "- Job #13 Serve the August notice to admit · Shelved",
    f"- 🦵 {SHELVED}",
    "  key: unserved-petitum:order_sought:2 · item: a reserved fallback order · lane: rejected",
])}

# Harness context Claude Code puts inside a practitioner's record (#1366).
REMINDER = ("<system-reminder>\nNotes for the connected folder: Chase the guarantor on the overdue note.\n"
            "</system-reminder>")
TYPED = "Take the note-up."


def reminder_parts_line(*texts, **kw):
    return turn_line([{"type": "text", "text": t} for t in texts], **kw)


# A blocker worded by the practitioner in an earlier session, read back and confirmed in this one.
SEED = "Does attornment defeat the stay?"
CONFIRM = "Yes, spin them off as worded."


def block_line(*texts):
    """An assistant reply whose one text part reads back each text in its own fenced code block."""
    body = "Read back:" + "\n\n" + "\n\n".join(f"```\n{t}\n```" for t in texts)
    return {"type": "assistant", "message": {"content": [{"type": "text", "text": body}]}}


# A blocker job the session proposed in its visible reply, from the obstacle as recorded.
PROPOSED_TITLE = "Confirm the date the guarantee was signed"
PROPOSED_INTENT = "When did the guarantor sign the guarantee?"
PROPOSAL_REPLY = (f"I propose this blocker job, from the obstacle as recorded.\n\nTitle: {PROPOSED_TITLE}\n"
                  f"Intent: {PROPOSED_INTENT}\n\nApprove it, or change it?")


def reply_line(text, **kw):
    """One assistant record holding one text part: the session's visible reply."""
    return {"type": "assistant", "message": {"content": [{"type": "text", "text": text}]}, **kw}


def proposed_update(title=PROPOSED_TITLE, intent=PROPOSED_INTENT, flag="1"):
    return update(title, intent, extra=f", session_proposed = {flag}")


# A grouped intake job (jobs-create.md §3e): five exhibit-pinpoint Proposals, one step per item.
GROUP_TITLE = "Locate pinpoint references for the following facts"
DOTTED = "Admission 4: The defendant received the invoice · dated 2 April."
GROUP_ITEMS = [
    "M. Reyes: Overtime for the final week was recorded in the Site Diary.",
    "M. Reyes: The foreman signed each daily timesheet.",
    "J. Okafor: The crane was idle from 3 to 7 March.",
    "J. Okafor: The delay notice went out on 8 March.",
    DOTTED,
]
GROUP_KEYS = [f"exhibit-pinpoint:statements_of_fact:{n}" for n in range(7, 12)]
GROUP_CARD = {"filing_id": 1, "revision": 3, "rendered_at": "2026-10-05 09:00", "card": "\n".join(
    ["## Proposed (6)"]
    + [line for key, item in zip(GROUP_KEYS, GROUP_ITEMS)
       for line in (f"- 📌 Locate the exhibit pinpoint: {item}", f"  key: {key} · item: {item} · lane: proposed")]
    + [f"- 📇 {PROPOSAL}", f"  key: note-up:authorities:5 · item: {ITEM} · lane: proposed"])}
# A job's card: its `keys:` line prints each stored item and current item as JSON strings.
STORED = 'M. Reyes: The foreman signed each "daily" timesheet.'
CURRENT = "M. Reyes: The foreman signed every daily timesheet."
JOB_CARD = {"filing_id": 1, "revision": 4, "rendered_at": "2026-10-05 10:00", "card": "\n".join([
    f"- Job #2 {GROUP_TITLE}",
    "  keys: " + "; ".join([
        f"{GROUP_KEYS[0]} = {json.dumps(GROUP_ITEMS[0], ensure_ascii=False)} "
        f"(now: 📌 {json.dumps(GROUP_ITEMS[0], ensure_ascii=False)})",
        f"{GROUP_KEYS[1]} = {json.dumps(STORED, ensure_ascii=False)} (now: 📌 {json.dumps(CURRENT, ensure_ascii=False)})",
        f"{GROUP_KEYS[2]} = {json.dumps(GROUP_ITEMS[2], ensure_ascii=False)} (now: dead)"]),
])}


# An on-the-fly revision of fact 12 (paragraph-revision.md §4).
OLD = "The invoice was delivered on April 2nd 2025."
REVISED = "The invoice was delivered on 2 April 2025."
ALTERNATIVE = "The invoice was delivered to the defendant on 2 April 2025."
ASK = f"Change fact 3 to: {REVISED}"
LABELS = ("Keep the current wording", "Your proposed revision", "The model's alternative revision", "Something else")
SELECTOR = ("**The current wording**\n\n```\n" + OLD + "\n```\n\n**Your proposed revision**\n\n```\n" + REVISED
            + "\n```\n\n**The model's alternative revision**\n\n```\n" + ALTERNATIVE + "\n```\n\nPick one of the four.")


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


def group_create():
    """§3e's Call 1 and Call 3 for the group, as two scripts on recovered id 2."""
    keys = ", ".join(sql_text(k) for k in GROUP_KEYS)
    call1 = (insert(GROUP_TITLE, intent=GROUP_TITLE) + "\n"
             "DELETE FROM tickets WHERE id = last_insert_rowid()\n"
             "  AND EXISTS (SELECT 1 FROM ticket_proposals p JOIN tickets t ON t.id = p.ticket_id\n"
             f"    WHERE p.proposal_key IN ({keys}) AND t.deleted_at IS NULL);")
    call3 = "\n".join(
        [f"INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (2, {n}, {sql_text(item)});"
         for n, item in enumerate(GROUP_ITEMS, 1)]
        + [f"INSERT INTO ticket_proposals (ticket_id, proposal_key, item) VALUES (2, {sql_text(k)}, {sql_text(item)});"
           for k, item in zip(GROUP_KEYS, GROUP_ITEMS)]
        + [f"INSERT INTO ticket_scope (ticket_id, entity, entity_id) VALUES (2, 'statements_of_fact', {k.rsplit(':', 1)[1]});"
           for k in GROUP_KEYS])
    return call1, call3


class PractitionerWordsGateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.transcript = Path(self.tmp.name) / "session.jsonl"
        self.write_transcript(turn_line(TURN))

    def tearDown(self):
        self.tmp.cleanup()

    def write_transcript(self, *lines):
        self.transcript.write_text("".join(json.dumps(line) + "\n" for line in lines), encoding="utf-8")

    def run_hook(self, sql, transcript=None):
        payload = {"hook_event_name": "PreToolUse", "session_id": "s-1",
                   "tool_name": "mcp__plugin_probanda_data__drafting_data__execute",
                   "tool_input": {"db_path": "C:/matter/submission.sqlite", "sql_script": sql},
                   "transcript_path": str(self.transcript) if transcript is None else transcript}
        return subprocess.run([sys.executable, str(SCRIPT)], input=json.dumps(payload).encode("utf-8"),
                              capture_output=True)

    def assertRefused(self, result, *fragments):
        self.assertEqual(result.returncode, 2, result.stderr)
        stderr = result.stderr.decode("utf-8")
        for fragment in fragments:
            self.assertIn(fragment, stderr)

    def test_refuses_the_recomposed_title_naming_field_and_nearest_turn(self):
        self.assertRefused(self.run_hook(update(RECOMPOSED)),
                           "field: title", f"wrote: {RECOMPOSED}", f"nearest turn: {TURN}")

    def test_accepts_a_title_cut_from_the_turn(self):
        self.assertEqual(self.run_hook(update(CUT)).returncode, 0)

    def test_ignores_case_and_runs_of_whitespace(self):
        self.assertEqual(self.run_hook(update("An  order for a list of documents")).returncode, 0)

    def test_compares_punctuation_as_written(self):
        self.write_transcript(turn_line("I want the list of documents. Verified by affidavit is what I am after."))
        self.assertRefused(self.run_hook(update("the list of documents verified by affidavit",
                                                intent="I want the list of documents.")), "field: title")

    def test_refuses_a_composed_intent(self):
        self.assertRefused(self.run_hook(update(CUT, intent="The practitioner wants a verified list.")),
                           "field: intent")

    def test_checks_an_outline_afresh_update(self):
        sql = (f"UPDATE tickets SET title = {sql_text(RECOMPOSED)}, priority = 6\n"
               "  WHERE id = 42 AND status = 'queued' AND rejected_at IS NULL;")
        self.assertRefused(self.run_hook(sql), "field: title", CEREMONY)

    def test_reads_non_ascii_text_intact(self):
        turn = "Quote Smith v. Jones — the implied-term test, café owner's point"
        self.write_transcript(turn_line(turn))
        self.assertEqual(self.run_hook(update("Smith v. Jones — the implied-term test", intent=turn)).returncode, 0)

    def test_the_fixed_gate_job_passes_and_is_the_text_jobs_md_gives(self):
        text = GATE_MD.read_text(encoding="utf-8")
        self.assertIn(sql_text(GATE_TITLE), text)
        self.assertIn(sql_text(GATE_INTENT), text)
        self.assertEqual(self.run_hook(update(GATE_TITLE, intent=GATE_INTENT)).returncode, 0)

    def test_the_stock_bundle_jobs_pass_and_are_the_text_jobs_md_gives(self):
        text = STOCK_MD.read_text(encoding="utf-8")
        for title, intent in STOCK_JOBS:
            with self.subTest(title=title):
                self.assertIn(f"**`{title}`.**", text)
                self.assertIn(f"- Intent: `{intent}`", text)
                self.assertEqual(self.run_hook(update(title, intent=intent)).returncode, 0)

    def test_the_letter_jobs_are_fixed_text_only_as_written(self):
        self.assertRefused(self.run_hook(update("Deliver", intent="Send it now")), "field: intent")
        self.assertRefused(self.run_hook(update("deliver", intent="Send this letter to its recipients and record it as sent.")),
                           "field: title")

    def test_the_counsel_review_jobs_pass_and_are_the_text_jobs_md_gives(self):
        text = STOCK_MD.read_text(encoding="utf-8")
        self.assertIn("**`Prepare the review pages`.**", text)
        self.assertIn("**`Counsel's review of <filings.title>`.**", text)
        for title, intent in REVIEW_JOBS:
            with self.subTest(title=title):
                self.assertIn(f"- Intent: `{intent}`", text)
                self.assertEqual(self.run_hook(update(title, intent=intent)).returncode, 0)

    def test_the_review_title_prefix_exempts_a_title_only(self):
        self.assertEqual(self.run_hook(update("Counsel's review of Application Response")).returncode, 0)
        self.assertEqual(self.run_hook(update(GATE_TITLE, intent="Counsel's review of this")).returncode, 2)

    def test_the_scrutiny_review_job_passes_and_is_the_text_jobs_md_gives(self):
        text = STOCK_MD.read_text(encoding="utf-8")
        self.assertIn("- Title: `Review scrutiny finding: <authorities.style_of_cause_or_title>", text)
        self.assertIn(f"- Intent: `{SCRUTINY_INTENT}`", text)
        self.assertEqual(self.run_hook(update(SCRUTINY_TITLE, intent=SCRUTINY_INTENT)).returncode, 0)

    def test_the_scrutiny_title_prefix_exempts_a_title_only(self):
        self.assertEqual(self.run_hook(update(SCRUTINY_TITLE)).returncode, 0)
        self.assertEqual(self.run_hook(update(GATE_TITLE, intent="Review scrutiny finding: this")).returncode, 2)

    def test_only_practitioner_turns_are_a_comparand(self):
        self.write_transcript(
            turn_line(TURN),
            turn_line(RECOMPOSED, isMeta=True),
            {"type": "user", "promptSource": None, "message": {"content": RECOMPOSED}},
            {"type": "user", "origin": {"kind": "human"}, "message": {"content": RECOMPOSED}},
            {"type": "user", "message": {"content": [{"type": "tool_result", "content": RECOMPOSED}]}},
            {"type": "assistant", "message": {"content": [{"type": "text", "text": RECOMPOSED}]}},
        )
        self.assertRefused(self.run_hook(update(RECOMPOSED)), "field: title")

    def command_line(self, args, **kw):
        body = f"<command-message>draft</command-message>\n<command-name>/draft</command-name>\n<command-args>{args}</command-args>"
        return {"type": "user", "origin": {"kind": "human"}, "message": {"role": "user", "content": body}, **kw}

    def test_the_text_typed_with_a_command_is_a_practitioner_turn(self):
        self.write_transcript(self.command_line(TURN))
        self.assertEqual(self.run_hook(update(CUT)).returncode, 0)
        self.assertRefused(self.run_hook(update(RECOMPOSED)), "field: title", f"nearest turn: {TURN}")

    def test_a_command_name_supplies_no_words(self):
        self.write_transcript(self.command_line(TURN))
        self.assertRefused(self.run_hook(update("draft")), "field: title")
        self.assertRefused(self.run_hook(update("/draft")), "field: title")

    def test_a_command_with_no_arguments_supplies_no_words(self):
        self.write_transcript(self.command_line(""))
        self.assertRefused(self.run_hook(update("draft")), "holds no practitioner turn")

    def test_the_skill_body_after_a_command_supplies_no_words(self):
        self.write_transcript(self.command_line(TURN),
                              turn_line(RECOMPOSED, isMeta=True, promptSource=None))
        self.assertRefused(self.run_hook(update(RECOMPOSED)), "field: title")

    def test_a_task_notification_is_not_a_practitioner_turn(self):
        self.write_transcript(
            turn_line(TURN, origin={"kind": "human"}),
            turn_line("<task-notification>" + RECOMPOSED, origin={"kind": "task-notification"}),
        )
        self.assertRefused(self.run_hook(update(RECOMPOSED)), "field: title")
        self.assertEqual(self.run_hook(update(CUT)).returncode, 0)

    def test_a_terminal_session_typed_or_queued_turn_counts(self):
        for source in ("typed", "queued"):
            self.write_transcript(turn_line(TURN, promptSource=source))
            self.assertEqual(self.run_hook(update(CUT)).returncode, 0, source)

    def test_a_message_sent_mid_turn_is_a_practitioner_turn(self):
        approval = f"Yes, note up {ITEM} first."
        self.write_transcript(queued_line(approval))
        self.assertEqual(self.run_hook(update(ITEM, intent=approval)).returncode, 0)
        for line in (queued_line(approval, origin={"kind": "task-notification", "producer": "session-task"}),
                     queued_line(approval, origin={"kind": "peer", "from": "uds:peer"}),
                     queued_line(approval, origin={"kind": "coordinator"}),
                     queued_line(approval, isMeta=True)):
            with self.subTest(line=line):
                self.write_transcript(line)
                self.assertRefused(self.run_hook(update(ITEM, intent=approval)), "holds no practitioner turn")

    def test_a_widget_value_is_struck_from_a_message_sent_mid_turn(self):
        self.write_transcript(widget_line(RECOMPOSED, "Something else"),
                              queued_line(f"Selected: {RECOMPOSED}\nAnswer: {TURN}"))
        self.assertRefused(self.run_hook(update(RECOMPOSED)), "field: title", "[widget value]")
        self.assertEqual(self.run_hook(update(CUT)).returncode, 0)

    def test_a_message_sent_mid_turn_with_an_image_counts_its_text_parts(self):
        approval = f"Yes, note up {ITEM} first."
        self.write_transcript(image_queued_line(approval))
        self.assertEqual(self.run_hook(update(ITEM, intent=approval)).returncode, 0)
        self.write_transcript(queued_line([IMAGE, IMAGE]))
        self.assertRefused(self.run_hook(update(ITEM, intent=approval)), "holds no practitioner turn")

    def test_a_message_sent_mid_turn_with_an_image_from_another_origin_supplies_no_words(self):
        approval = f"Yes, note up {ITEM} first."
        for line in (image_queued_line(approval, origin={"kind": "task-notification", "producer": "session-task"}),
                     image_queued_line(approval, origin={"kind": "peer", "from": "uds:peer"}),
                     image_queued_line(approval, origin={"kind": "coordinator"}),
                     image_queued_line(approval, isMeta=True)):
            with self.subTest(line=line):
                self.write_transcript(line)
                self.assertRefused(self.run_hook(update(ITEM, intent=approval)), "holds no practitioner turn")

    def test_reminders_are_cut_from_a_message_sent_mid_turn_with_an_image(self):
        for texts in ((REMINDER, TYPED), (REMINDER + TYPED,), (REMINDER + "\n" + TYPED,)):
            with self.subTest(texts=texts):
                self.write_transcript(image_queued_line(*texts))
                self.assertRefused(self.run_hook(update("Chase the guarantor", intent=TYPED)), "field: title")
                joined = "\n".join(texts)
                spanning = joined[joined.index("the overdue note."):joined.index(TYPED) + len("Take the note-up")]
                self.assertRefused(self.run_hook(update(spanning, intent=TYPED)), "field: title")
                self.assertEqual(self.run_hook(update("the note-up", intent=TYPED)).returncode, 0)
        self.write_transcript(image_queued_line(REMINDER, " \n"), image_queued_line(REMINDER))
        self.assertRefused(self.run_hook(update("Chase the guarantor", intent="Chase the guarantor")),
                           "holds no practitioner turn")

    def test_a_widget_value_is_struck_from_a_message_sent_mid_turn_with_an_image(self):
        self.write_transcript(widget_line(RECOMPOSED, "Something else"),
                              image_queued_line(f"Selected: {RECOMPOSED}\nAnswer: {TURN}"))
        self.assertRefused(self.run_hook(update(RECOMPOSED)), "field: title", "[widget value]")
        self.assertEqual(self.run_hook(update(CUT)).returncode, 0)

    def test_an_accepted_prompt_suggestion_or_originless_turn_is_not_a_practitioner_turn(self):
        self.write_transcript(
            turn_line(TURN, promptSource="suggestion_accepted"),
            {"type": "user", "promptSource": "sdk", "message": {"content": TURN}},
        )
        self.assertRefused(self.run_hook(update(CUT)))

    def test_a_widget_selection_supplies_no_words(self):
        self.write_transcript(turn_line(TURN), widget_line(RECOMPOSED, "Something else"),
                              turn_line(f"Selected: {RECOMPOSED}"))
        self.assertRefused(self.run_hook(update(RECOMPOSED)), "field: title", "[widget value]")

    def test_a_typed_answer_still_counts_when_a_later_card_reuses_it(self):
        self.write_transcript(turn_line(TURN), widget_line(CUT), turn_line(f"Selected: {CUT}"))
        self.assertEqual(self.run_hook(update(CUT)).returncode, 0)

    def test_typed_text_in_a_widget_submission_counts_and_whole_values_only_are_struck(self):
        self.write_transcript(widget_line("Yes", "No"),
                              turn_line("Proceed: Yes\nAnswer: Notice of application first, then the exhibit list audited"))
        self.assertEqual(self.run_hook(update("the exhibit list audited",
                                              intent="Notice of application first")).returncode, 0)

    def test_a_fast_path_job_takes_a_printed_proposal_title(self):
        self.write_transcript(turn_line("Take the note-up."),
                              *tool_lines("mcp__plugin_probanda_data__drafting_forms__render", RENDER))
        self.assertEqual(self.run_hook(update(PROPOSAL, intent=PROPOSAL)).returncode, 0)

    def test_a_fast_path_job_takes_a_printed_proposal_title_from_the_summary(self):
        self.write_transcript(turn_line("Take the note-up."),
                              *tool_lines("mcp__plugin_probanda_data__drafting_forms__render", SUMMARY_RENDER))
        self.assertEqual(self.run_hook(update(PROPOSAL, intent=PROPOSAL)).returncode, 0)
        self.assertEqual(self.run_hook(update(SHELVED, intent=SHELVED)).returncode, 0)
        self.assertRefused(self.run_hook(update("Chase the guarantor")), "field: title")
        self.assertRefused(self.run_hook(update("Serve the August notice to admit")), "field: title")

    def test_a_fast_path_job_takes_a_printed_proposal_title_from_a_board_card(self):
        self.write_transcript(turn_line("Take the note-up."),
                              *tool_lines("mcp__plugin_probanda_data__drafting_forms__board_card", CARD))
        self.assertEqual(self.run_hook(update(PROPOSAL, intent=PROPOSAL)).returncode, 0)
        self.assertEqual(self.run_hook(update(SHELVED, intent=SHELVED)).returncode, 0)
        self.assertRefused(self.run_hook(update("Serve the August notice to admit")), "field: title")
        self.assertRefused(self.run_hook(update("#13 Serve the August notice to admit · Shelved")), "field: title")

    def test_a_fast_path_job_takes_a_proposal_title_from_a_persisted_result(self):
        self.write_transcript(turn_line("Take the note-up."),
                              *persisted_lines("mcp__plugin_probanda_data__drafting_forms__render", RENDER))
        self.assertEqual(self.run_hook(update(PROPOSAL, intent=PROPOSAL)).returncode, 0)
        self.assertRefused(self.run_hook(update(PROPOSAL.lower(), intent=PROPOSAL)), "field: title")

    def test_a_proposal_approved_mid_turn_after_a_persisted_render_is_written(self):
        # #1358's E2E: the render was saved to a file, and the approval was sent while the session worked.
        approval = f"Yes, take {ITEM}."
        self.write_transcript(turn_line("Draft the opening submissions."),
                              *persisted_lines("mcp__plugin_probanda_data__drafting_forms__render", SUMMARY_RENDER),
                              queued_line(approval))
        self.assertEqual(self.run_hook(update(PROPOSAL, intent=PROPOSAL)).returncode, 0)
        self.assertEqual(self.run_hook(update(ITEM, intent=approval)).returncode, 0)

    def test_the_proposal_exemption_is_exact_and_needs_a_forms_result(self):
        self.write_transcript(turn_line("Take the note-up."),
                              *tool_lines("mcp__plugin_probanda_data__drafting_forms__render", RENDER))
        self.assertRefused(self.run_hook(update(PROPOSAL.lower(), intent=PROPOSAL)), "field: title")
        self.write_transcript(turn_line("Take the note-up."), *tool_lines("Bash", RENDER))
        self.assertRefused(self.run_hook(update(PROPOSAL, intent=PROPOSAL)), "field: title", "field: intent")

    def test_a_reminder_text_part_supplies_no_words(self):
        self.write_transcript(reminder_parts_line(REMINDER, TYPED))
        self.assertRefused(self.run_hook(update("Chase the guarantor", intent=TYPED)), "field: title")
        self.assertEqual(self.run_hook(update("the note-up", intent=TYPED)).returncode, 0)

    def test_a_reminder_prefixed_to_string_content_supplies_no_words(self):
        self.write_transcript(turn_line(REMINDER + "\n" + TYPED))
        self.assertRefused(self.run_hook(update("Chase the guarantor", intent=TYPED)), "field: title")
        self.assertEqual(self.run_hook(update("the note-up", intent=TYPED)).returncode, 0)

    def test_a_value_cannot_match_across_a_removed_reminder(self):
        self.write_transcript(turn_line(REMINDER + TYPED))
        self.assertRefused(self.run_hook(update("the overdue note. </system-reminder>Take the note-up", intent=TYPED)),
                           "field: title")
        self.write_transcript(turn_line("Draft the " + REMINDER + " opening submissions."))
        self.assertRefused(self.run_hook(update("Draft the opening submissions", intent="opening submissions.")),
                           "field: title")

    def test_a_record_holding_only_reminders_is_not_a_turn(self):
        self.write_transcript(turn_line(REMINDER), reminder_parts_line(REMINDER, " \n"))
        self.assertRefused(self.run_hook(update("Chase the guarantor", intent="Chase the guarantor")),
                           "holds no practitioner turn")
        self.write_transcript(turn_line(REMINDER), turn_line(TYPED))
        self.assertRefused(self.run_hook(update("Chase the guarantor", intent=TYPED)), "field: title")

    def test_a_long_nearest_turn_is_echoed_as_a_bounded_window(self):
        # A shorter shared run ("the order for a ") sits far from the longest, which is spread over doubled spaces.
        typed = "See the order for a hearing. " + "Background. " * 30 + "  ".join(TURN.split()) + " Further context." * 30
        self.write_transcript(turn_line(REMINDER * 20 + "\n" + typed))
        result = self.run_hook(update(RECOMPOSED))
        self.assertRefused(result, "field: title")
        stderr = result.stderr.decode("utf-8")
        self.assertNotIn("system-reminder", stderr)
        echo = next(line for line in stderr.splitlines() if line.startswith("  nearest turn: "))
        echo = echo[len("  nearest turn: "):]
        self.assertTrue(echo.startswith("…") and echo.endswith("…"), echo)
        self.assertLessEqual(len(echo.strip("…")), 300)
        self.assertIn(" list of documents", echo)

    def test_reminders_are_stripped_from_command_arguments_and_mid_turn_messages(self):
        for line in (self.command_line(REMINDER + TYPED), queued_line(REMINDER + TYPED)):
            with self.subTest(line=line):
                self.write_transcript(line)
                self.assertRefused(self.run_hook(update("Chase the guarantor", intent=TYPED)), "field: title")
                self.assertEqual(self.run_hook(update("the note-up", intent=TYPED)).returncode, 0)

    def test_leaves_writes_that_set_no_title_or_intent_alone(self):
        sql = ("UPDATE tickets SET status = 'wip', locked_by = 'sess-a1' WHERE id = 42 AND status = 'queued';\n"
               "INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (2, 1, 'Audit the exhibit list');\n"
               "DELETE FROM tickets WHERE id = 9;")
        self.assertEqual(self.run_hook(sql, transcript="").returncode, 0)

    def test_refuses_when_the_transcript_is_missing(self):
        missing = str(Path(self.tmp.name) / "absent.jsonl")
        self.assertRefused(self.run_hook(update(CUT), transcript=missing), missing)
        self.assertRefused(self.run_hook(update(CUT), transcript=""), "no transcript_path")

    def test_fails_closed_on_a_ticket_write_it_cannot_read(self):
        for sql in (f"UPDATE tickets SET (title, intent) = ({sql_text(CUT)}, {sql_text(TURN)}) WHERE id = 2;",
                    f"UPDATE tickets SET title = {sql_text(CUT)} || ' now' WHERE id = 2;",
                    "UPDATE main.tickets SET intent = (SELECT idea FROM seeds WHERE id = 1) WHERE id = 2;",
                    "UPDATE tickets SET title = 'unterminated WHERE id = 2;",
                    "UPDATE ticket_steps SET text = upper(text) WHERE ticket_id = 2 AND ordinal = 1;",
                    "UPDATE ticket_steps SET (text, done_at) = ('x', NULL) WHERE ticket_id = 2 AND ordinal = 1;"):
            with self.subTest(sql=sql):
                self.assertRefused(self.run_hook(sql), "cannot read the ticket fields")

    def write_earlier(self, *lines, name="earlier.jsonl"):
        path = Path(self.tmp.name) / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("".join(json.dumps(line) + "\n" for line in lines), encoding="utf-8")

    def test_earlier_session_words_quoted_back_and_confirmed_pass(self):
        self.write_earlier(turn_line(SEED))
        self.write_transcript(turn_line(TURN), block_line(SEED), turn_line(CONFIRM))
        self.assertEqual(self.run_hook(update(SEED, intent=SEED)).returncode, 0)

    def test_a_quoted_block_with_a_word_changed_is_refused(self):
        changed = "Does attornment defeat a stay?"
        self.write_earlier(turn_line(SEED))
        self.write_transcript(turn_line(TURN), block_line(changed), turn_line(CONFIRM))
        self.assertRefused(self.run_hook(update(changed, intent=changed)), "field: title")

    def test_a_quoted_block_with_no_earlier_transcript_is_refused(self):
        self.write_transcript(turn_line(TURN), block_line(SEED), turn_line(CONFIRM))
        self.assertRefused(self.run_hook(update(SEED, intent=SEED)), "0 of 0 transcripts searched")

    def test_a_quoted_block_with_no_later_turn_is_refused(self):
        self.write_earlier(turn_line(SEED))
        self.write_transcript(turn_line(TURN), block_line(SEED))
        self.assertRefused(self.run_hook(update(SEED, intent=SEED)), "field: title")

    def test_earlier_words_not_in_a_practitioner_turn_are_not_proof(self):
        self.write_transcript(turn_line(TURN), block_line(SEED), turn_line(CONFIRM))
        for lines in ([{"type": "assistant", "message": {"content": [{"type": "text", "text": SEED}]}}],
                      [widget_line(SEED), turn_line(f"Selected: {SEED}")]):
            with self.subTest(lines=lines):
                self.write_earlier(*lines)
                self.assertRefused(self.run_hook(update(SEED, intent=SEED)), "field: title")

    def test_a_quoted_block_joining_two_earlier_turns_is_refused(self):
        self.write_earlier(turn_line("Does attornment"), turn_line("defeat the stay?"))
        self.write_transcript(turn_line(TURN), block_line(SEED), turn_line(CONFIRM))
        self.assertRefused(self.run_hook(update(SEED, intent=SEED)), "field: title")

    def test_a_subagent_transcript_is_not_searched(self):
        self.write_earlier(turn_line(SEED), name="subagents/agent-x.jsonl")
        self.write_transcript(turn_line(TURN), block_line(SEED), turn_line(CONFIRM))
        self.assertRefused(self.run_hook(update(SEED, intent=SEED)), "field: title")

    def test_the_earlier_search_stops_at_its_deadline(self):
        spec = importlib.util.spec_from_file_location("practitioner_words_gate", SCRIPT)
        gate = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gate)
        self.write_earlier(turn_line(SEED))
        self.write_transcript(turn_line(TURN), block_line(SEED), turn_line(CONFIRM))
        proven, searched, total = gate.earlier_turns_matching({gate.norm(SEED)}, str(self.transcript),
                                                              deadline=time.monotonic() - 1)
        self.assertEqual((proven, searched, total), (set(), 0, 1))
        self.assertEqual(self.run_hook(update(SEED, intent=SEED)).returncode, 0)

    def test_an_approved_proposal_with_the_flag_passes(self):
        self.write_transcript(turn_line("Spin off the blockers."), reply_line(PROPOSAL_REPLY), turn_line("Yes"))
        self.assertEqual(self.run_hook(proposed_update()).returncode, 0)

    def test_a_proposal_approved_mid_turn_with_the_flag_passes(self):
        # #1358's shape: the yes is an attachment record, after tool records that follow the proposal.
        self.write_transcript(turn_line("Spin off the blockers."), reply_line(PROPOSAL_REPLY),
                              *tool_lines("Bash", {"ok": True}), queued_line("Yes."))
        self.assertEqual(self.run_hook(proposed_update()).returncode, 0)

    def test_an_approved_proposal_without_the_flag_is_refused(self):
        self.write_transcript(turn_line("Spin off the blockers."), reply_line(PROPOSAL_REPLY), turn_line("Yes"))
        flag_refusal = "does not set tickets.session_proposed = 1"
        self.assertRefused(self.run_hook(update(PROPOSED_TITLE, intent=PROPOSED_INTENT)), "field: title", flag_refusal)
        self.assertRefused(self.run_hook(proposed_update(flag="'1'")), "field: title", flag_refusal)

    def test_an_approved_proposal_update_needs_the_flag(self):
        sql = f"UPDATE tickets SET title = {sql_text(PROPOSED_TITLE)}{{}} WHERE id = 42 AND status = 'queued';"
        self.write_transcript(turn_line("Spin off the blockers."), reply_line(PROPOSAL_REPLY), turn_line("Yes"))
        self.assertEqual(self.run_hook(sql.format(", session_proposed = 1")).returncode, 0)
        self.assertRefused(self.run_hook(sql.format("")), "does not set tickets.session_proposed = 1")

    def test_a_proposal_no_practitioner_turn_followed_is_refused(self):
        self.write_transcript(turn_line("Spin off the blockers."), reply_line(PROPOSAL_REPLY))
        self.assertRefused(self.run_hook(proposed_update()), "field: title")

    def test_a_qualified_yes_is_not_an_approval(self):
        self.write_transcript(turn_line("Spin off the blockers."), reply_line(PROPOSAL_REPLY),
                              turn_line("Yes but shorten it"))
        self.assertRefused(self.run_hook(proposed_update()), "field: title")

    def test_an_approved_proposal_with_a_word_changed_is_refused(self):
        self.write_transcript(turn_line("Spin off the blockers."), reply_line(PROPOSAL_REPLY), turn_line("Yes"))
        self.assertRefused(self.run_hook(proposed_update(title="Confirm the day the guarantee was signed")),
                           "field: title")

    def test_a_later_practitioner_turn_makes_the_proposal_stale(self):
        self.write_transcript(turn_line("Spin off the blockers."), reply_line(PROPOSAL_REPLY), turn_line("Yes"),
                              turn_line("Also chase the guarantor"))
        self.assertRefused(self.run_hook(proposed_update()), "field: title")

    def test_a_proposal_only_inside_widget_markup_is_refused(self):
        self.write_transcript(turn_line("Spin off the blockers."), widget_line(PROPOSED_TITLE, PROPOSED_INTENT),
                              turn_line("Yes"))
        self.assertRefused(self.run_hook(proposed_update()), "field: title")

    def test_a_widget_selection_is_not_an_approval(self):
        for answer in ("Selected: Yes", "Yes"):
            with self.subTest(answer=answer):
                self.write_transcript(turn_line("Spin off the blockers."), reply_line(PROPOSAL_REPLY),
                                      widget_line("Yes", "No"), turn_line(answer))
                self.assertRefused(self.run_hook(proposed_update()), "field: title")

    def test_a_proposal_split_across_two_text_parts_is_refused(self):
        self.write_transcript(turn_line("Spin off the blockers."), reply_line("Title: Confirm the date the"),
                              reply_line("guarantee was signed"), turn_line("Yes"))
        self.assertRefused(self.run_hook(proposed_update()), "field: title")

    def test_a_subagent_proposal_is_refused(self):
        self.write_transcript(turn_line("Spin off the blockers."), reply_line(PROPOSAL_REPLY, isSidechain=True),
                              turn_line("Yes"))
        self.assertRefused(self.run_hook(proposed_update()), "field: title")

    def test_own_words_pass_with_or_without_the_flag(self):
        self.assertEqual(self.run_hook(update(CUT)).returncode, 0)
        self.assertEqual(self.run_hook(proposed_update(title=CUT, intent=TURN)).returncode, 0)

    # The gate covers an existing job's wording only: the creation of a job is never read.
    def test_a_new_job_passes_whatever_its_title_and_intent(self):
        self.write_transcript(turn_line("Spin off the blockers."), reply_line(PROPOSAL_REPLY),
                              turn_line("Yes but shorten it"))
        self.assertEqual(self.run_hook(insert(PROPOSED_TITLE, intent=PROPOSED_INTENT)).returncode, 0)
        self.assertEqual(self.run_hook(insert(RECOMPOSED, intent="The practitioner wants a verified list.")).returncode, 0)
        self.assertEqual(self.run_hook("INSERT INTO tickets (proceeding_id, title, intent) "
                                       "SELECT 1, idea, idea FROM seeds WHERE id = 1;").returncode, 0)

    def test_replaced_steps_in_the_sessions_words_are_refused_naming_the_ceremony(self):
        result = self.run_hook(replace_steps("'Audit the exhibit list'", "'Reconcile against the disclosure log'"))
        self.assertRefused(result, "ticket_steps.text is not an unbroken run", "field: ticket_steps.text",
                           "wrote: Audit the exhibit list", "wrote: Reconcile against the disclosure log", CEREMONY)

    def test_replaced_steps_split_from_a_pasted_list_pass(self):
        self.write_transcript(turn_line("1. Audit the exhibit list\n2. Reconcile against the disclosure log\n"
                                        "- Draft the cover note"))
        self.assertEqual(self.run_hook(replace_steps("'Audit the exhibit list'", "'Reconcile against the disclosure log'",
                                                     "'Draft the cover note'")).returncode, 0)
        values = ("DELETE FROM ticket_steps WHERE ticket_id = 2;\n"
                  "INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (2, 1, 'Audit the exhibit list'), "
                  "(2, 2, 'Reconcile against the disclosure log');")
        self.assertEqual(self.run_hook(values).returncode, 0)
        self.assertRefused(self.run_hook(values.replace("the disclosure log", "disclosure")), "field: ticket_steps.text")

    def test_a_bare_yes_does_not_adopt_a_proposed_step(self):
        self.write_transcript(turn_line("Divide it."), reply_line("I propose one step.\n\n1. Audit the exhibit list"), turn_line("Yes"))
        self.assertRefused(self.run_hook(replace_steps("'Audit the exhibit list'")),
                           "ticket_steps.text is not an unbroken run", "field: ticket_steps.text")

    def test_a_new_jobs_steps_written_with_no_delete_are_not_read(self):
        sql = ("INSERT INTO ticket_steps (ticket_id, ordinal, text) VALUES (20, 1, 'Whatever the session composed');\n"
               "INSERT INTO ticket_steps (ticket_id, ordinal, text) SELECT 20, 2, 'And more' FROM tickets WHERE id = 20;")
        self.assertEqual(self.run_hook(sql, transcript="").returncode, 0)
        self.assertEqual(self.run_hook("DELETE FROM ticket_steps WHERE ticket_id = 42;\n"
                                       "DELETE FROM tickets WHERE id = 42;", transcript="").returncode, 0)

    def test_an_in_place_step_rewrite_is_checked(self):
        self.assertRefused(self.run_hook(step_update("'Reconcile against the disclosure log'")),
                           "field: ticket_steps.text", "wrote: Reconcile against the disclosure log")
        self.assertEqual(self.run_hook(step_update(sql_text(CUT))).returncode, 0)

    def test_the_gate_jobs_result_rewrite_and_waiver_pass_as_jobs_gate_md_writes_them(self):
        text = GATE_MD.read_text(encoding="utf-8").replace("\r\n", "\n")
        blocks = [b for b in re.findall(r"^```sql\n(.*?)\n```$", text, re.S | re.M) if "UPDATE ticket_steps SET text" in b]
        self.assertEqual(len(blocks), 2, "§14's result rewrite and its waiver")
        self.assertIn("[rev 412]'", blocks[0])
        self.assertIn("SET text = text || ' — WAIVED: ' || ", blocks[1])
        for sql in blocks:
            with self.subTest(sql=sql):
                self.assertEqual(self.run_hook(sql, transcript="").returncode, 0)

    def test_a_done_at_stamp_passes_unchecked(self):
        sql = ("UPDATE ticket_steps SET done_at = strftime('%Y-%m-%dT%H:%M', 'now', 'localtime')\n"
               "  WHERE ticket_id = 2 AND ordinal = 1 AND EXISTS (SELECT 1 FROM tickets WHERE id = 2 AND locked_by = 'sess-a1');")
        self.assertEqual(self.run_hook(sql, transcript="").returncode, 0)

    def test_a_replaced_step_that_is_not_one_literal_fails_closed(self):
        for value in ("text || 'x'", "'Audit' || ' the exhibit list'"):
            with self.subTest(value=value):
                self.assertRefused(self.run_hook(replace_steps(value)), "cannot read the ticket fields")

    def test_a_stock_step_put_back_passes_and_is_the_text_jobs_stock_md_gives(self):
        text = STOCK_MD.read_text(encoding="utf-8")
        self.assertIn("Draft the chambers-availability letter", STOCK_STEPS)
        for step in STOCK_STEPS:
            with self.subTest(step=step):
                self.assertRegex(text, r"- Step \d+: `" + re.escape(step) + "`")
                self.assertEqual(self.run_hook(replace_steps(sql_text(step))).returncode, 0)

    # A grouped intake job's steps are Proposal items (jobs-create.md §3e).
    def board_card_opening(self, card=GROUP_CARD, tool="mcp__plugin_probanda_data__drafting_forms__board_card"):
        self.write_transcript(turn_line("Open the opening submissions."), *tool_lines(tool, card))

    def test_a_group_intake_create_passes_with_no_turn_beyond_the_opening(self):
        self.board_card_opening()
        for sql in group_create():
            with self.subTest(sql=sql[:40]):
                self.assertEqual(self.run_hook(sql).returncode, 0)

    def test_replaced_steps_equal_to_card_items_pass(self):
        self.board_card_opening()
        self.assertEqual(self.run_hook(replace_steps(*(sql_text(i) for i in GROUP_ITEMS[:2] + GROUP_ITEMS[3:]))).returncode, 0)

    def test_replaced_steps_equal_to_items_on_a_keys_line_pass(self):
        self.board_card_opening(JOB_CARD)
        self.assertEqual(self.run_hook(replace_steps(sql_text(GROUP_ITEMS[0]), sql_text(STORED),
                                                     sql_text(CURRENT), sql_text(GROUP_ITEMS[2]))).returncode, 0)

    def test_an_item_holding_the_separator_passes(self):
        self.board_card_opening()
        self.assertEqual(self.run_hook(replace_steps(sql_text(DOTTED))).returncode, 0)
        self.assertRefused(self.run_hook(replace_steps(sql_text("Admission 4: The defendant received the invoice"))),
                           "field: ticket_steps.text")

    def test_the_fixed_group_title_is_refused_on_an_existing_job(self):
        self.board_card_opening()
        self.assertRefused(self.run_hook(update(GROUP_TITLE, intent=GROUP_TITLE)), "field: title", "field: intent")

    def test_an_item_is_refused_as_a_title(self):
        self.board_card_opening()
        self.assertRefused(self.run_hook(update(GROUP_ITEMS[0], intent=GROUP_ITEMS[0])), "field: title", "field: intent")

    def test_a_composed_step_beside_card_items_is_refused(self):
        self.board_card_opening()
        self.assertRefused(self.run_hook(replace_steps(sql_text(GROUP_ITEMS[0]), "'Find the pinpoint in the Site Diary'")),
                           "field: ticket_steps.text", "wrote: Find the pinpoint in the Site Diary")

    def test_items_from_a_bash_result_are_refused(self):
        self.board_card_opening(tool="Bash")
        self.assertRefused(self.run_hook(replace_steps(sql_text(GROUP_ITEMS[0]))), "field: ticket_steps.text")
        self.board_card_opening(JOB_CARD, tool="Bash")
        self.assertRefused(self.run_hook(replace_steps(sql_text(STORED))), "field: ticket_steps.text")

    # An on-the-fly paragraph revision (paragraph-revision.md, draft/references/revise-on-the-fly.md).
    def selected(self, last_turn):
        """The ask, the reply showing the three texts and the selector, then the practitioner's answer."""
        self.write_transcript(turn_line(ASK), reply_line(SELECTOR), widget_line(*LABELS), turn_line(last_turn))

    def test_a_revision_in_the_practitioners_typed_words_passes(self):
        self.write_transcript(turn_line(ASK))
        self.assertEqual(self.run_hook(revision(REVISED, "proposed", "practitioner")).returncode, 0)
        self.write_transcript(turn_line(ASK), reply_line(SELECTOR), turn_line("Something else: The invoice arrived on 2 April 2025."))
        self.assertEqual(self.run_hook(revision("The invoice arrived on 2 April 2025.", "other", "practitioner")).returncode, 0)

    def test_a_widget_pick_of_the_proposed_text_passes_on_the_earlier_typed_turn(self):
        self.write_transcript(turn_line(ASK), reply_line(SELECTOR), widget_line(REVISED, ALTERNATIVE), turn_line(REVISED))
        self.assertEqual(self.run_hook(revision(REVISED, "proposed", "practitioner")).returncode, 0)

    def test_the_alternative_picked_in_the_widget_passes(self):
        self.selected("The model's alternative revision")
        self.assertEqual(self.run_hook(revision(ALTERNATIVE, "alternative", "model")).returncode, 0)

    def test_the_alternative_named_in_a_chat_reply_passes(self):
        self.write_transcript(turn_line(ASK), reply_line(SELECTOR), turn_line("Go with the alternative."))
        self.assertEqual(self.run_hook(revision(ALTERNATIVE, "alternative", "model")).returncode, 0)

    def test_the_alternative_from_an_older_reply_is_refused(self):
        self.write_transcript(turn_line(ASK), reply_line(SELECTOR), turn_line("Let me think about it."),
                              reply_line("Take your time."), turn_line("The alternative, please."))
        self.assertRefused(self.run_hook(revision(ALTERNATIVE, "alternative", "model")),
                           "field: paragraph_revisions.new_text", "no fenced code block")

    def test_the_alternative_is_refused_when_the_last_turn_does_not_name_it(self):
        self.selected("Your proposed revision")
        self.assertRefused(self.run_hook(revision(ALTERNATIVE, "alternative", "model")),
                           "field: paragraph_revisions.new_text", "does not name the alternative")

    def test_a_fabricated_revision_is_refused(self):
        self.selected("The model's alternative revision")
        fabricated = "The invoice was never delivered."
        for choice, origin, fragment in (("alternative", "model", "no fenced code block"),
                                         ("other", "practitioner", "not an unbroken run")):
            with self.subTest(origin=origin):
                self.assertRefused(self.run_hook(revision(fabricated, choice, origin)),
                                   "field: paragraph_revisions.new_text", f"wrote: {fabricated}", fragment)

    def test_a_revision_whose_update_writes_other_text_is_refused(self):
        self.write_transcript(turn_line(ASK))
        for sql in (revision(REVISED, "proposed", "practitioner", update_text=ALTERNATIVE),
                    revision(REVISED, "proposed", "practitioner").replace("UPDATE facts", "UPDATE submissions")):
            with self.subTest(sql=sql[:60]):
                self.assertRefused(self.run_hook(sql), "field: paragraph_revisions.new_text",
                                   "UPDATE facts SET postulate")

    def test_keeping_the_current_wording_needs_unchanged_text(self):
        self.assertEqual(self.run_hook(revision(OLD, "current", "practitioner"), transcript="").returncode, 0)
        self.assertRefused(self.run_hook(revision(REVISED, "current", "practitioner")),
                           "field: paragraph_revisions.new_text", "differs from old_text")

    def test_an_insert_select_revision_passes(self):
        self.write_transcript(turn_line(ASK))
        self.assertEqual(self.run_hook(revision(REVISED, "proposed", "practitioner", select=True)).returncode, 0)
        self.selected("The model's alternative revision")
        self.assertEqual(self.run_hook(revision(ALTERNATIVE, "alternative", "model", select=True)).returncode, 0)

    def test_a_revision_it_cannot_read_fails_closed(self):
        sql = revision(REVISED, "proposed", "practitioner").replace(f"{sql_text(REVISED)}, {sql_text(REVISED)}",
                                                                    f"upper({sql_text(REVISED)}), {sql_text(REVISED)}", 1)
        self.assertNotEqual(sql, revision(REVISED, "proposed", "practitioner"))
        self.assertRefused(self.run_hook(sql), "cannot read the paragraph revision")
        self.assertRefused(self.run_hook(revision(REVISED, "move", "practitioner")),
                           "cannot read the paragraph revision", "paragraph_revisions.choice 'move'")

    # A fact move (paragraph-revision.md §6): the section's own swap script, rows 31 and 32 at ordinals 3 and 4.
    def swap(self):
        text = REVISION_MD.read_text(encoding="utf-8")
        blocks = re.findall(r"```sql\n(.*?)\n```", text[text.index("## 6. Move"):], re.S)
        return next(b for b in blocks if b.startswith("UPDATE filing_facts"))

    A_ROW = "SELECT 'filing_facts', 31, 'ordinal', '3', '4', NULL, NULL, NULL, 'move', 'practitioner'"

    def moved(self, replacement):
        sql = self.swap().replace(self.A_ROW, replacement, 1)
        self.assertNotEqual(sql, self.swap())
        return sql

    def test_the_section_6_swap_passes_with_no_transcript(self):
        self.assertEqual(self.run_hook(self.swap()).returncode, 0)
        self.assertEqual(self.run_hook(self.swap(), transcript="").returncode, 0)

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


if __name__ == "__main__":
    unittest.main()
