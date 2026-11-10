#!/usr/bin/env python3
"""Refuse a paragraph revision, a confirmed statement of goals, a merge of Work Boards or of jobs, or a reopen of a completed job the practitioner did not approve (#784).

Hook event: PreToolUse on drafting_data__execute, drafting_data__set_board_goal,
drafting_data__merge_milestones, drafting_data__merge_jobs, drafting_data__assign_job with reopen
(a merge or a reopen passes only when the last practitioner turn is a bare yes) and drafting_forms__apply_edit.
A job's title, intent and steps, and a marker suppression's note, are not read: their wording
needs no practitioner approval (docs/Specs/2026-10-20_approved-research-issues-pass-job-words-gate-spec.md).

Each check reads this session's transcript. The transcript is the
harness's own record, so the session being checked does not author the
comparand. A practitioner turn is a `user` line with no isMeta, origin kind
"human", and promptSource "sdk" (desktop and Cowork) or "typed"/"queued" (a
terminal session). A message sent mid-turn is an attachment record instead, a
queued_command with origin kind "human", and its prompt counts the same way
(#1358). Sent with an image, that prompt is a list of parts: its text parts count
and its images contribute no words (#1456). A subagent's task-notification also
carries "sdk", and an accepted prompt suggestion is the app's words, so neither
counts. The text typed after a slash command's name (the command-args) counts as
one practitioner turn, though its record has no promptSource. The command's name
and tags contribute no words, and the isMeta skill body that follows the command
stays excluded. An unbroken run of a turn ignores case and runs of whitespace;
punctuation and word order count.

The harness puts its own context inside those records as <system-reminder> blocks,
in a text part ahead of the typed text or prefixed to it. A reminder is not the
practitioner's words: every complete block is cut out of a turn before matching, a
value cannot match across the cut, and a record left with no words is not a turn
(#1366).

A widget submission arrives as a practitioner turn too, echoing the values the
session wrote into the widget. So every data-value from the session's earlier
show_widget calls is struck out of each turn before matching: a selection
supplies no words, and a typed answer still does.

The gate also reads every INSERT INTO paragraph_revisions, by VALUES or by INSERT ... SELECT: an
on-the-fly revision of one reviewed paragraph (paragraph-revision.md). Its choice, origin,
entity, field, old_text and new_text must each be a plain string literal, and a choice other than
'current', 'proposed', 'alternative' or 'other' is refused as unreadable. A choice of 'current'
passes when new_text equals old_text, and nothing else is checked. Any other choice is a wording
revision and needs an UPDATE <entity> ... SET <field> = '<new_text>' in the same script, the
identical literal, which ties the audited text to the text written. A wording revision is one
paragraph, shown whole and approved: the session's visible reply (not a subagent's) between the
previous practitioner turn and the last one holds exactly one fenced code block, counting the text
parts and every SendUserMessage message, and that block's content, its final newline dropped, is
new_text character for character. A second block in that reply is a second pending paragraph and
refuses. The last practitioner turn, its reminders cut, is a bare yes (APPROVALS, the whole turn).
An AskUserQuestion answer or a widget selection is not a typed turn, so it never approves. Origin
'practitioner' (choice 'proposed' or 'other') also needs new_text to be an unbroken run of one
practitioner turn, as above. One approval admits one wording revision: a script writing two is
refused, and so is one written after an earlier drafting_data__execute call since the last
practitioner turn, already answered, wrote one (a refused attempt counts, so a refusal is never
retried on the same approval). The table's CHECKs tie the choice to the origin, so the gate does
not pair them. Known limit: the gate reads the
audit row only. A bare substance UPDATE with no audit row is not gated, as one under a job is not;
the route's own text requires the audit row, and the foreign-scope read stays the session's, as
every scope read is.

A paragraph_revisions row whose entity is 'filing_facts' is a fact move (paragraph-revision.md §6)
and takes its own branch; the wording checks above never see it. Its entity_id must be one integer
literal, and its field, choice and origin must be 'ordinal', 'move' and 'practitioner'. The same
script must hold an UPDATE filing_facts SET ordinal = <n> whose WHERE clause, at parenthesis depth 0
(a subquery is skipped), tests id = <entity_id> and ordinal = <m>, with n equal to new_text and m to
old_text. A move carries no wording: it changes a fact's place in the list, not words the
practitioner must have written, and a job session writes filing_facts ungated already. So no
transcript check applies, a keyword test on the last turn would prove nothing, and a script whose
only checked write is a passing move needs no transcript.

The gate also runs on drafting_data__set_board_goal, which records a Work Board's statement of
goals (2026-10-14 Work Board goal card spec). A confirmed statement is the practitioner's: it passes
when it is an unbroken run of one practitioner turn, or when it is, character for character, the one
fenced code block in the session's visible reply before the practitioner's last turn and that turn
is a bare yes (APPROVALS, the whole turn), as an on-the-fly revision is approved. An inferred or
declined write passes unchecked: the tool records an inferred statement as the session's wording,
never as confirmed, and a declined one carries no statement.

A merge of two Work Boards with a goal_statement, the merged board's one goal written as confirmed
(docs/ADRs/0010, 2026-10-22 goals amendment), passes when the practitioner's last turn holds that
statement as an unbroken run: they typed their own goal in answer to the merge question. Otherwise
the statement must pass the check a confirmed statement of goals passes, and the last turn must be
a bare yes, so one bare yes to the shown statement confirms both the merge and the goal.

drafting_forms__apply_edit writes the statements of one drafting_forms__preview_edit preview, a quick
edit (paragraph-revision.md section 8). The gate reads that preview's own result in this session's
transcript, by its preview_token: a tool result is the server's record, never the session's words. It
allows the call only when (1) the session's visible reply between the previous practitioner turn and
the last holds exactly the preview's diff blocks, each a fenced code block whose content, its final
newline dropped, is one block's text character for character, and no other fenced block; (2) the last
practitioner turn is a bare yes; (3) no apply_edit call and no wording revision since that turn has
been answered: one approval admits one write; and (4) a reworded paragraph the preview carries with
choice 'proposed' is an unbroken run of one practitioner turn. A preview result the transcript holds
only as a persisted-output stub cannot be read, so it refuses. A wording revision by
drafting_data__execute is likewise refused once an apply_edit since the last turn has been answered.

Exit 0 allows the call; exit 2 refuses it and the session reads stderr. A refusal
echoes the nearest turn, bounded: whole within 300 characters, else 300 characters
centred on the longest run it shares with the value written. The gate
fails CLOSED: a checked write it cannot read, a missing transcript, or any error
of its own refuses the call and says why.
"""
import difflib
import json
import re
import sys
from pathlib import Path

try:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "shared" / "scripts"))
    import hook_io
    from transcript import GAP, STRUCK, approval, fences, norm, practitioner_turns
except Exception as exc:  # a crash would let the call through
    sys.stderr.write(f"Refused: practitioner-words-gate cannot load its helper: {exc!r}\n")
    sys.exit(2)

PREFIX = "Refused: "
ECHO = 300  # the most of a nearest turn a refusal shows
SET_ENDS = {"where", "from", "returning", "order", "limit"}
COMPOUND = {"union", "intersect", "except"}
REVISIONS = "paragraph_revisions"
REVISION_READ = ("choice", "origin", "entity", "field", "old_text", "new_text")
# Plain words for each read column, for a refusal (shared/internals-confidentiality.md).
PLAIN = {"choice": "choice", "origin": "origin", "entity": "subject", "field": "field",
         "old_text": "old text", "new_text": "new text"}
REVISION_CHOICES = ("current", "proposed", "alternative", "other")  # any other choice is refused as unreadable
REVISION_FIELD = "the revised text"
REVISION_CLOSING = ("An on-the-fly revision writes one paragraph the practitioner approved: shown whole as the only "
                    "fenced code block in the reply before their last turn, exactly as saved, and approved by a bare "
                    "yes typed as that turn. One approval admits one write. The revised text recorded is exactly the "
                    "text written into the paragraph, and keeping the current wording records the old text unchanged.")
GOAL_TOOL = "drafting_data__set_board_goal"  # a Work Board's statement of goals
MERGE_TOOL = "drafting_data__merge_milestones"  # two Work Boards joined on the practitioner's yes
MERGE_JOBS_TOOL = "drafting_data__merge_jobs"  # a duplicate job merged into another on the practitioner's yes
ASSIGN_TOOL = "drafting_data__assign_job"  # with reopen: a completed job reopened on the practitioner's yes
GOAL_FIELD = "the statement of goals"
MERGE_GOAL_FIELD = "the merged board's statement of goals"
PREVIEW_TOOL = "drafting_forms__preview_edit"
APPLY_TOOL = "drafting_forms__apply_edit"  # a quick edit's write (paragraph-revision.md section 8)
APPLY_CLOSING = ("A quick edit is applied after the practitioner saw its preview: the session's reply before their last turn "
                 "prints each of the preview's diff blocks verbatim as its own fenced code block, and no other, and their "
                 "last turn is a bare yes. One approval admits one write. A changed edit is previewed again.")
MOVE_ENTITY = "filing_facts"  # a fact move (paragraph-revision.md §6): the ordinals, no wording
MOVE_FIELD = "the fact's old and new places"
MOVE_CLOSING = ("A fact move is recorded as a move of the fact's place, on the practitioner's word, with the fact's old "
                "and new places as text, and the same script moves that fact from its old place to its new one, as "
                "the paragraph-revision rules show for moving a fact.")

TOKEN = re.compile(r"""
    (?P<space>\s+) | (?P<comment>--[^\n]*|/\*.*?\*/)
  | (?P<str>'(?:[^']|'')*')
  | (?P<quoted>"(?:[^"]|"")*"|`[^`]*`|\[[^\]]*\])
  | (?P<name>[A-Za-z_][A-Za-z0-9_$]*)
  | (?P<num>\d+)
  | (?P<p>.)
""", re.S | re.X)


class Unreadable(Exception):
    """A paragraph_revisions write whose checked columns are not plain string literals."""


def tokens(script):
    out = []
    for m in TOKEN.finditer(script):
        kind, text = m.lastgroup, m.group()
        if kind in ("space", "comment"):
            continue
        if kind == "str":
            out.append(("str", text[1:-1].replace("''", "'")))
        elif kind == "quoted":
            out.append(("name", text[1:-1].replace('""', '"').lower()))
        elif kind == "name":
            out.append(("name", text.lower()))
        elif kind == "num":
            out.append(("num", text))
        elif text == "'":
            raise Unreadable("an unterminated string literal")
        else:
            out.append(("p", text))
    return out


def split(toks, sep, stop=lambda t: False):
    """Split toks on top-level `sep`, ending at the first top-level token `stop` accepts
    or at an unmatched ')'. Returns (parts, index just past the last part)."""
    parts, cur, depth, i = [], [], 0, 0
    while i < len(toks):
        t = toks[i]
        if depth == 0 and (t == ("p", ")") or stop(t)):
            break
        depth += {("p", "("): 1, ("p", ")"): -1}.get(t, 0)
        if depth == 0 and t == sep:
            parts.append(cur)
            cur = []
        else:
            cur.append(t)
        i += 1
    parts.append(cur)
    return parts, i


def table_at(toks, i, table):
    """Index just past a `table` name at toks[i], schema prefix allowed, else None."""
    if toks[i + 1:i + 2] == [("p", ".")]:
        i += 2
    return i + 1 if toks[i:i + 1] == [("name", table)] else None


def literal(field, value):
    if len(value) != 1 or value[0][0] != "str":
        raise Unreadable(f"{field} is something other than one plain quoted value")
    return value[0][1]


def insert_columns(toks, j):
    """(an INSERT INTO <table>'s column names, index just past its column list)."""
    if toks[j:j + 1] == [("name", "as")]:
        j += 2
    if toks[j:j + 1] != [("p", "(")]:
        raise Unreadable("a record written with no list of its fields")
    cols, n = split(toks[j + 1:], ("p", ","))
    return [c[0][1] if len(c) == 1 else None for c in cols], j + n + 2


def insert_values(toks, j, cols):
    """(each row's value tokens, by VALUES or by INSERT ... SELECT (the select list split on
    top-level commas, stopping at FROM), index just past them)."""
    rows = []
    if toks[j:j + 1] == [("name", "values")]:
        j += 1
        while toks[j:j + 1] == [("p", "(")]:
            values, n = split(toks[j + 1:], ("p", ","))
            if len(values) != len(cols):
                raise Unreadable("a record whose values do not match its fields")
            rows.append(values)
            j += n + 2
            if toks[j:j + 1] != [("p", ",")]:
                break
            j += 1
    elif toks[j:j + 1] == [("name", "select")]:
        items, n = split(toks[j + 1:], ("p", ","), lambda t: t == ("name", "from"))
        if len(items) != len(cols):
            raise Unreadable("a record whose selected values do not match its fields")
        rows.append(items)
        j += n + 1
        if any(t[0] == "name" and t[1] in COMPOUND for t in toks[j:]):
            raise Unreadable("a record selected from more than one query")
    else:
        raise Unreadable("a record written neither as a list of values nor as one selection")
    return rows, j


def statements(toks):
    stmts, cur = [], []
    for t in toks:
        if t == ("p", ";"):
            stmts.append(cur)
            cur = []
        else:
            cur.append(t)
    return stmts + [cur]


def revision_inserts(toks, j):
    """Each row an INSERT INTO paragraph_revisions writes, as {column: string} for REVISION_READ."""
    cols, j = insert_columns(toks, j)
    missing = [c for c in REVISION_READ if c not in cols]
    if missing:
        raise Unreadable(f"a revision record that leaves out its {', '.join(PLAIN[c] for c in missing)}")
    rows, _ = insert_values(toks, j, cols)
    for row in rows:
        read = {c: literal(f"the revision's {PLAIN[c]}", row[cols.index(c)]) for c in REVISION_READ}
        if read["entity"] == MOVE_ENTITY:
            # A move takes its own branch (move_failures), so the wording checks never see it.
            value = row[cols.index("entity_id")] if "entity_id" in cols else []
            if len(value) != 1 or value[0][0] != "num":
                raise Unreadable("the fact a move names is something other than one plain number")
            read["entity_id"] = str(int(value[0][1]))
            yield read
            continue
        if read["choice"] not in REVISION_CHOICES:
            raise Unreadable(f"the revision's choice {read['choice']!r}, which is none of {', '.join(REVISION_CHOICES)}")
        yield read


def sets_literal(stmts, table, column, value):
    """Whether some statement is UPDATE <table> ... SET <column> = '<value>', the identical literal."""
    for stmt in stmts:
        for k, t in enumerate(stmt):
            if t != ("name", "update"):
                continue
            j = table_at(stmt, k + 3 if stmt[k + 1:k + 2] == [("name", "or")] else k + 1, table)
            if j is None:
                continue
            if stmt[j:j + 1] == [("name", "as")]:
                j += 2
            if stmt[j:j + 1] != [("name", "set")]:
                continue
            sets, _ = split(stmt[j + 1:], ("p", ","), lambda t: t[0] == "name" and t[1] in SET_ENDS)
            if [("name", column), ("p", "="), ("str", value)] in sets:
                return True
    return False


def number_after(toks, name):
    """Every integer literal in toks, as text, that follows `<name> =` (a qualified name too)."""
    return {str(int(toks[k + 2][1])) for k in range(len(toks) - 2)
            if toks[k] == ("name", name) and toks[k + 1] == ("p", "=") and toks[k + 2][0] == "num"}


def ordinal_updates(stmts):
    """(ordinal set, ids, ordinals) for each UPDATE filing_facts SET ordinal = <n>: the ids and
    ordinals its WHERE clause tests with `= <integer>` at parenthesis depth 0 (a subquery is skipped)."""
    out = []
    for stmt in stmts:
        for k, t in enumerate(stmt):
            if t != ("name", "update"):
                continue
            j = table_at(stmt, k + 3 if stmt[k + 1:k + 2] == [("name", "or")] else k + 1, MOVE_ENTITY)
            if j is None:
                continue
            if stmt[j:j + 1] == [("name", "as")]:
                j += 2
            if stmt[j:j + 1] != [("name", "set")]:
                continue
            sets, n = split(stmt[j + 1:], ("p", ","), lambda t: t[0] == "name" and t[1] in SET_ENDS)
            ordinal = [s[2][1] for s in sets if len(s) == 3 and s[:2] == [("name", "ordinal"), ("p", "=")] and s[2][0] == "num"]
            rest = stmt[j + 1 + n:]
            if len(ordinal) != 1 or rest[:1] != [("name", "where")]:
                continue
            where, depth = [], 0
            for tok in rest[1:]:
                if tok == ("p", "("):
                    depth += 1
                elif tok == ("p", ")"):
                    depth -= 1
                elif depth == 0:
                    where.append(tok)
            out.append((str(int(ordinal[0])), number_after(where, "id"), number_after(where, "ordinal")))
    return out


def move_failures(moves, stmts):
    """Each refusal fact-move rows earn: field 'ordinal', choice 'move' and origin 'practitioner',
    and an UPDATE filing_facts in the same script that sets new_text as the ordinal of the row
    entity_id, guarded on old_text as its ordinal. A move carries no wording, so no transcript."""
    out, updates = [], ordinal_updates(stmts)
    for row in moves:
        wrote = f"  field: {MOVE_FIELD}\n  wrote: fact {row['entity_id']}, from place {row['old_text']} to place {row['new_text']}"
        if (row["field"], row["choice"], row["origin"]) != ("ordinal", "move", "practitioner"):
            out.append(f"a record of a fact move must say it moves the fact's place, as a move, on the practitioner's "
                       f"word; this one says {row['field']!r}, {row['choice']!r} and {row['origin']!r}.\n{wrote}")
        elif not any(new == row["new_text"] and row["entity_id"] in ids and row["old_text"] in ordinals
                     for new, ids, ordinals in updates):
            out.append(f"this script does not move fact {row['entity_id']} from place {row['old_text']} to place "
                       f"{row['new_text']}, so the recorded move is not the move made.\n{wrote}")
    return out


def revision_writes(script):
    """(every row an INSERT INTO paragraph_revisions writes, the script's statements)."""
    if not re.search(r"(?i)\bparagraph_revisions\b", script):
        return [], []
    stmts = statements(tokens(script))
    rows = []
    for stmt in stmts:
        for k, t in enumerate(stmt):
            if t == ("name", "into"):
                j = table_at(stmt, k + 1, REVISIONS)
                if j is not None:
                    rows += revision_inserts(stmt, j)
    return rows, stmts


def wrote_wording(script):
    """Whether an earlier script wrote a wording revision: a paragraph_revisions row neither
    'current' nor a fact move. A script the gate cannot read counts, so the gate fails closed."""
    try:
        rows, _ = revision_writes(script)
    except Unreadable:
        return True
    return any(row["entity"] != MOVE_ENTITY and row["choice"] != "current" for row in rows)


def revision_failures(rows, stmts, turns=None, last_raw="", last_fences=()):
    """Each refusal paragraph_revisions rows earn. Without turns, only the checks that need no
    transcript: 'current' keeps old_text, and any other choice's new_text is the literal an
    UPDATE <entity> SET <field> writes in the same script. With turns, the authorship checks:
    one fence, exactly new_text, approved by a bare yes, and for the practitioner's origin a
    run of one turn."""
    out = []
    for row in rows:
        new, wrote = row["new_text"], f"  field: {REVISION_FIELD}\n  wrote: {row['new_text']}"
        if turns is None:
            if row["choice"] == "current":
                if new != row["old_text"]:
                    out.append(f"{REVISION_FIELD} differs from the text it replaces, and keeping the current "
                               f"wording leaves it unchanged.\n{wrote}\n  was: {row['old_text']}")
            elif not sets_literal(stmts, row["entity"], row["field"], new):
                out.append(f"{REVISION_FIELD} is not the text this script writes into the paragraph, so the "
                           f"record would not match the paragraph.\n{wrote}")
        elif row["choice"] == "current":
            continue
        elif len(last_fences) != 1:
            out.append(f"{REVISION_FIELD} needs exactly one fenced code block, the revised paragraph, in the "
                       f"session's visible reply before the practitioner's last turn; that reply holds "
                       f"{len(last_fences)}.\n{wrote}")
        elif last_fences[0] != new:
            out.append(f"{REVISION_FIELD} is not, character for character, the one fenced code block in the "
                       f"session's visible reply before the practitioner's last turn.\n{wrote}\n"
                       f"  shown: {last_fences[0]}")
        elif not approval(last_raw):
            out.append(f"{REVISION_FIELD} was shown, but the practitioner's last turn is not a bare yes "
                       f"approving it.\n{wrote}\n  last turn: {echo(new, last_raw)}")
        elif row["origin"] == "model":
            continue
        elif not any(norm(new) in norm(turn) for turn in turns):
            nearest_turn = f"\n  nearest turn: {echo(new, nearest(new, turns))}" if turns else ""
            out.append(f"{REVISION_FIELD} is not an unbroken run of one thing the practitioner said in this "
                       f"session.\n{wrote}{nearest_turn}")
    return out


def read_transcript(path):
    """(practitioner turns with earlier widget values struck, the last practitioner turn with no
    widget value struck, every fenced block, as shown, of the session's visible reply (text parts
    and SendUserMessage messages) between the previous practitioner turn and the last, and the
    scripts of drafting_data__execute calls since the last practitioner turn that a result has
    answered)."""
    *segments, tail = practitioner_turns(path)
    last = segments[-1] if segments else None
    last_raw = last.raw if last else ""
    last_fences = tuple(block for part in last.reply for block in fences(part)) if last else ()
    executed = [call.input.get("sql_script") or "" for call in tail.calls
                if call.name.endswith("drafting_data__execute") and not call.sidechain and call.result is not None]
    return [segment.struck for segment in segments], last_raw, last_fences, executed


def quick_edits(path):
    """(every drafting_forms__preview_edit result in this session, by its preview_token, as
    {"diff": block texts, "rewords": [...]}; the drafting_forms__apply_edit calls since the last
    practitioner turn that a result has answered)."""
    *segments, tail = practitioner_turns(path)
    previews = {}
    for segment in segments + [tail]:
        for call in segment.calls:
            if not call.name.endswith(PREVIEW_TOOL) or call.sidechain or call.result is None:
                continue
            try:
                parsed = json.loads(call.result)
            except ValueError:
                continue
            if not isinstance(parsed, dict) or not isinstance(parsed.get("preview_token"), str):
                continue
            diff = parsed.get("diff") if isinstance(parsed.get("diff"), list) else []
            rewords = parsed.get("rewords") if isinstance(parsed.get("rewords"), list) else []
            previews[parsed["preview_token"]] = {
                "diff": [d["text"] for d in diff if isinstance(d, dict) and isinstance(d.get("text"), str)],
                "rewords": [r for r in rewords if isinstance(r, dict) and isinstance(r.get("new_text"), str)],
            }
    applied = [call for call in tail.calls
               if call.name.endswith(APPLY_TOOL) and not call.sidechain and call.result is not None]
    return previews, applied


def apply_gate(payload):
    """A quick edit's write: the preview's diff blocks shown verbatim and alone, a bare yes as the last
    turn, no other write since it, and a reword marked as the practitioner's own wording a run of one turn."""
    token = (payload.get("tool_input") or {}).get("preview_token")
    if not isinstance(token, str) or not token:
        return refuse(f"the call names no preview, so there is nothing the practitioner saw to apply.\n{APPLY_CLOSING}")
    path = payload.get("transcript_path") or ""
    if not path:
        return refuse("the session transcript is not available, so there is no record of what the "
                      "practitioner saw and approved.")
    try:
        turns, last_raw, last_fences, executed = read_transcript(path)
        previews, applied = quick_edits(path)
    except OSError as exc:
        return refuse(f"cannot read the session transcript at {path}: {exc}")
    preview = previews.get(token)
    if preview is None:
        return refuse(f"no preview in this session issued preview_token {token!r}, so there is no preview the "
                      f"practitioner saw for this call to apply.\n{APPLY_CLOSING}")
    out = []
    blocks = preview["diff"]
    if sorted(last_fences) != sorted(blocks):
        out.append(f"the session's visible reply before the practitioner's last turn holds {len(last_fences)} fenced "
                   f"code block(s), and they are not the preview's {len(blocks)} diff block(s), each verbatim and no other.")
    elif not approval(last_raw):
        out.append(f"the preview was shown, but the practitioner's last turn is not a bare yes approving it.\n"
                   f"  last turn: {echo(' '.join(blocks), last_raw)}")
    if applied or any(wrote_wording(earlier) for earlier in executed):
        out.append("an edit was already applied, or a paragraph revision written or attempted, since the "
                   "practitioner's last turn, and one approval admits one write.")
    for reword in preview["rewords"]:
        new = reword["new_text"]
        if reword.get("choice") != "alternative" and not any(norm(new) in norm(turn) for turn in turns):
            nearest_turn = f"\n  nearest turn: {echo(new, nearest(new, turns))}" if turns else ""
            out.append(f"the reworded paragraph is recorded as the practitioner's own wording, but it is not an "
                       f"unbroken run of one thing the practitioner said in this session.\n"
                       f"  field: {REVISION_FIELD}\n  wrote: {new}{nearest_turn}")
    if out:
        return refuse("\n".join(out + [APPLY_CLOSING]))
    return 0


def nearest(value, turns):
    def shared_run(turn):
        a, b = norm(value), norm(turn)
        return difflib.SequenceMatcher(None, a, b, autojunk=False).find_longest_match(0, len(a), 0, len(b)).size
    return max(turns, key=shared_run)


def echo(value, turn):
    """The turn as a refusal shows it: whole within ECHO characters, else ECHO characters centred
    on the longest run it shares with value, with an ellipsis at each cut (#1366). The window is
    cut from the turn as norm() sees it, so it centres on the run nearest() measured."""
    flat = " ".join(turn.split())
    if len(flat) <= ECHO:
        return turn.replace(STRUCK, " [widget value] ").replace(GAP, " ").strip()
    a, b = norm(value), [c.casefold() for c in flat]
    run = difflib.SequenceMatcher(None, a, b, autojunk=False).find_longest_match(0, len(a), 0, len(b))
    start = min(max(run.b + run.size // 2 - ECHO // 2, 0), len(flat) - ECHO)
    cut = flat[start:start + ECHO].replace(STRUCK.strip(), "[widget value]").replace(GAP.strip(), "")
    return ("…" if start else "") + " ".join(cut.split()) + ("…" if start + ECHO < len(flat) else "")


def refuse(message):
    return hook_io.refuse(PREFIX + message)


def board_goal(payload):
    """A confirmed statement of goals: a run of one practitioner turn, or the one fenced block shown
    before the last turn, approved by a bare yes. Inferred and declined pass: the session's wording."""
    tool_input = payload.get("tool_input") or {}
    statement = tool_input.get("statement")
    if tool_input.get("status") != "confirmed" or not isinstance(statement, str) or not statement.strip():
        return 0  # not confirmed, or a confirmed write with no statement, which the tool itself refuses
    path = payload.get("transcript_path") or ""
    if not path:
        return refuse("the session transcript is not available, so there is no record of what the "
                      "practitioner approved to check the statement of goals against.")
    try:
        turns, last_raw, last_fences, _ = read_transcript(path)
    except OSError as exc:
        return refuse(f"cannot read the session transcript at {path}: {exc}")
    failure = goal_failure(statement, GOAL_FIELD, turns, last_raw, last_fences)
    if failure is None:
        return 0
    return refuse(failure + " Until then it is not confirmed: record it as inferred if the practitioner declined.")


def goal_failure(statement, field, turns, last_raw, last_fences):
    """None when a confirmed statement of goals is a run of one practitioner turn, or the one fenced
    block shown before the last turn, approved by a bare yes; else the refusal's text."""
    if any(norm(statement) in norm(turn) for turn in turns):
        return None
    if len(last_fences) == 1 and last_fences[0] == statement and approval(last_raw):
        return None
    nearest_turn = f"\n  nearest turn: {echo(statement, nearest(statement, turns))}" if turns else ""
    return (f"a confirmed statement of goals is neither an unbroken run of one thing the practitioner "
            f"said in this session nor the one fenced code block in the session's reply before the "
            f"practitioner's last turn, approved by a bare yes.\n  field: {field}\n"
            f"  wrote: {statement}\n  shown: {len(last_fences)} fenced block(s){nearest_turn}\n"
            "Show the whole statement as the only fenced code block in one reply, exactly as it will be "
            "saved, and record it as confirmed only after the practitioner's next turn is a bare yes.")


def bare_yes(payload, needs, how):
    """A merge passes only when the practitioner's last turn is a bare yes. `needs` names what the
    merge needs confirmed, `how` what the session shows before asking."""
    path = payload.get("transcript_path") or ""
    if not path:
        return refuse("the session transcript is not available, so there is no record of the "
                      "practitioner confirming the merge.")
    try:
        last_raw = read_transcript(path)[1]
    except OSError as exc:
        return refuse(f"cannot read the session transcript at {path}: {exc}")
    if approval(last_raw):
        return 0
    return refuse(f"{needs}, and their last turn is not a bare yes.\n"
                  f"  last turn: {last_raw[:120] or '(none)'}\n"
                  f"{how}, and call the tool only after the practitioner's next turn is a bare yes.")


def merge_boards(payload):
    """A merge of two Work Boards (docs/ADRs/0010), after the session showed both boards' statements
    of goals and asked whether they cohere. A goal_statement held by the last turn passes; any other
    passes goal_failure and then needs the bare yes."""
    statement = (payload.get("tool_input") or {}).get("goal_statement")
    path = payload.get("transcript_path") or ""
    if isinstance(statement, str) and statement.strip() and path:
        try:
            turns, last_raw, last_fences, _ = read_transcript(path)
        except OSError as exc:
            return refuse(f"cannot read the session transcript at {path}: {exc}")
        if turns and norm(statement) in norm(turns[-1]):
            return 0
        failure = goal_failure(statement, MERGE_GOAL_FIELD, turns, last_raw, last_fences)
        if failure is not None:
            return refuse(failure + " Or merge with no statement of goals, which leaves the board needing one.")
    return bare_yes(payload, "a merge of two Work Boards needs the practitioner's confirmation that their goals overlap "
                    "or cohere", "Show both boards' statements of goals side by side, ask whether to merge them")


def merge_jobs(payload):
    """A merge of a duplicate job into another (jobs-closeout.md §9c), after the session named both
    jobs and the combined steps and asked whether to merge them."""
    args = payload.get("tool_input") or {}
    return bare_yes(payload, f"a merge of Job {args.get('absorbed_id')} into Job {args.get('survivor_id')} needs the "
                    "practitioner's confirmation", "Name both jobs and the combined steps, ask whether to merge them")


def main():
    payload = hook_io.payload()
    if (payload.get("tool_name") or "").endswith(GOAL_TOOL):
        return board_goal(payload)
    if (payload.get("tool_name") or "").endswith(MERGE_TOOL):
        return merge_boards(payload)
    if (payload.get("tool_name") or "").endswith(MERGE_JOBS_TOOL):
        return merge_jobs(payload)
    if (payload.get("tool_name") or "").endswith(ASSIGN_TOOL):
        args = payload.get("tool_input") or {}
        if args.get("reopen") is not True:
            return 0
        return bare_yes(payload, f"reopening completed Job {args.get('ticket_id')} needs the practitioner's confirmation",
                        "Name the job and the date it was completed, ask whether to reopen it")
    if (payload.get("tool_name") or "").endswith(APPLY_TOOL):
        return apply_gate(payload)
    script = (payload.get("tool_input") or {}).get("sql_script") or ""
    try:
        revisions, stmts = revision_writes(script)
    except Unreadable as exc:
        return refuse(f"cannot read the paragraph revision this script writes: {exc}. Write the revision "
                      "record's choice, origin, subject, field, old text and new text as plain quoted values, "
                      "as the paragraph-revision rules show.")
    moves = [row for row in revisions if row["entity"] == MOVE_ENTITY]
    revisions = [row for row in revisions if row["entity"] != MOVE_ENTITY]
    move_refusals = move_failures(moves, stmts)
    if move_refusals:
        return refuse("\n".join(move_refusals + [MOVE_CLOSING]))
    revision_refusals = revision_failures(revisions, stmts)
    if revision_refusals:
        return refuse("\n".join(revision_refusals + [REVISION_CLOSING]))
    wording = [row for row in revisions if row["choice"] != "current"]
    if len(wording) > 1:
        return refuse(f"this script writes {len(wording)} paragraph revisions, and one approval admits one "
                      f"paragraph.\n" + "\n".join(f"  wrote: {row['new_text']}" for row in wording)
                      + f"\n{REVISION_CLOSING}")
    if not wording:
        return 0
    path = payload.get("transcript_path") or ""
    if not path:
        return refuse("the session transcript is not available, so there is no record of "
                      "what the practitioner approved to check the paragraph revision against.")
    try:
        turns, last_raw, last_fences, executed = read_transcript(path)
    except OSError as exc:
        return refuse(f"cannot read the session transcript at {path}: {exc}")
    if any(wrote_wording(earlier) for earlier in executed) or quick_edits(path)[1]:
        return refuse(f"a paragraph revision was already written, or attempted, since the practitioner's last "
                      f"turn, and one approval admits one paragraph.\n  field: {REVISION_FIELD}\n"
                      f"  wrote: {wording[0]['new_text']}\n{REVISION_CLOSING}")
    revision_refusals = revision_failures(revisions, stmts, turns, last_raw, last_fences)
    if revision_refusals:
        return refuse("\n".join(revision_refusals + [REVISION_CLOSING]))
    return 0


if __name__ == "__main__":
    # the gate's own failure refuses the call (#784, decision 5)
    hook_io.run(main, "practitioner-words-gate", closed=lambda exc: refuse(f"the check itself failed: {exc!r}"))
