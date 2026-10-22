#!/usr/bin/env python3
"""Refuse a paragraph revision, a confirmed statement of goals, or a merge of Job Boards or of jobs the practitioner did not approve (#784).

Hook event: PreToolUse on drafting_data__execute, drafting_data__set_board_goal,
drafting_data__merge_job_boards and drafting_data__merge_jobs (a merge passes only when the last
practitioner turn is a bare yes).
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

The gate also runs on drafting_data__set_board_goal, which records a Job Board's statement of
goals (2026-10-14 Job Board goal card spec). A confirmed statement is the practitioner's: it passes
when it is an unbroken run of one practitioner turn, or when it is, character for character, the one
fenced code block in the session's visible reply before the practitioner's last turn and that turn
is a bare yes (APPROVALS, the whole turn), as an on-the-fly revision is approved. An inferred or
declined write passes unchecked: the tool records an inferred statement as the session's wording,
never as confirmed, and a declined one carries no statement.

Exit 0 allows the call; exit 2 refuses it and the session reads stderr. A refusal
echoes the nearest turn, bounded: whole within 300 characters, else 300 characters
centred on the longest run it shares with the value written. The gate
fails CLOSED: a checked write it cannot read, a missing transcript, or any error
of its own refuses the call and says why.
"""
import difflib
import html
import json
import re
import sys

PREFIX = "Refused (practitioner-words gate, #784): "
TYPED_SOURCES = {"sdk", "typed", "queued"}
STRUCK = " \x00 "
GAP = " \x01 "  # where a system-reminder block was cut out of a turn
REMINDER = re.compile(r"<system-reminder>.*?</system-reminder>", re.S)
ECHO = 300  # the most of a nearest turn a refusal shows
COMMAND_ARGS = re.compile(r"<command-args>(.*?)</command-args>", re.S)
DATA_VALUE = re.compile(r"""data-value\s*=\s*(?:"([^"]*)"|'([^']*)')""")
FENCE = re.compile(r"^```[^\n]*\n(.*?)^```", re.M | re.S)
# A whole practitioner turn that approves the session's proposal, as approval() normalizes it.
APPROVALS = {"yes", "approved", "approve", "agreed", "go ahead", "yes, go ahead", "ok", "okay", "do it"}
SET_ENDS = {"where", "from", "returning", "order", "limit"}
COMPOUND = {"union", "intersect", "except"}
REVISIONS = "paragraph_revisions"
REVISION_READ = ("choice", "origin", "entity", "field", "old_text", "new_text")
REVISION_CHOICES = ("current", "proposed", "alternative", "other")  # any other choice is refused as unreadable
REVISION_FIELD = "paragraph_revisions.new_text"
REVISION_CLOSING = ("An on-the-fly revision writes one paragraph the practitioner approved: shown whole as the only "
                    "fenced code block in the reply before their last turn, exactly as saved, and approved by a bare "
                    "yes typed as that turn. One approval admits one write. Its UPDATE writes the same literal as "
                    "new_text, and 'current' writes old_text unchanged.")
GOAL_TOOL = "drafting_data__set_board_goal"  # a Job Board's statement of goals
MERGE_TOOL = "drafting_data__merge_job_boards"  # two Job Boards joined on the practitioner's yes
MERGE_JOBS_TOOL = "drafting_data__merge_jobs"  # a duplicate job merged into another on the practitioner's yes
GOAL_FIELD = "drafting_data__set_board_goal.statement"
MOVE_ENTITY = "filing_facts"  # a fact move (paragraph-revision.md §6): the ordinals, no wording
MOVE_FIELD = "paragraph_revisions.old_text/new_text"
MOVE_CLOSING = ("A fact move records field 'ordinal', choice 'move' and origin 'practitioner', with old_text and new_text "
                "the ordinals as text: old_text the ordinal its UPDATE filing_facts guards on in WHERE ... ordinal = "
                "and new_text the ordinal it sets, for the row WHERE id = entity_id (paragraph-revision.md §6).")

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
        raise Unreadable(f"{field} is set to something other than one string literal")
    return value[0][1]


def insert_columns(toks, j, table):
    """(an INSERT INTO <table>'s column names, index just past its column list)."""
    if toks[j:j + 1] == [("name", "as")]:
        j += 2
    if toks[j:j + 1] != [("p", "(")]:
        raise Unreadable(f"an INSERT INTO {table} with no column list")
    cols, n = split(toks[j + 1:], ("p", ","))
    return [c[0][1] if len(c) == 1 else None for c in cols], j + n + 2


def insert_values(toks, j, cols, table):
    """(each row's value tokens, by VALUES or by INSERT ... SELECT (the select list split on
    top-level commas, stopping at FROM), index just past them)."""
    rows = []
    if toks[j:j + 1] == [("name", "values")]:
        j += 1
        while toks[j:j + 1] == [("p", "(")]:
            values, n = split(toks[j + 1:], ("p", ","))
            if len(values) != len(cols):
                raise Unreadable(f"an INSERT INTO {table} whose VALUES do not match its columns")
            rows.append(values)
            j += n + 2
            if toks[j:j + 1] != [("p", ",")]:
                break
            j += 1
    elif toks[j:j + 1] == [("name", "select")]:
        items, n = split(toks[j + 1:], ("p", ","), lambda t: t == ("name", "from"))
        if len(items) != len(cols):
            raise Unreadable(f"an INSERT INTO {table} ... SELECT whose select list does not match its columns")
        rows.append(items)
        j += n + 1
        if any(t[0] == "name" and t[1] in COMPOUND for t in toks[j:]):
            raise Unreadable(f"an INSERT INTO {table} ... SELECT with a compound select")
    else:
        raise Unreadable(f"an INSERT INTO {table} that is neither INSERT ... VALUES nor INSERT ... SELECT")
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
    cols, j = insert_columns(toks, j, REVISIONS)
    missing = [c for c in REVISION_READ if c not in cols]
    if missing:
        raise Unreadable(f"an INSERT INTO {REVISIONS} that names no {', '.join(missing)}")
    rows, _ = insert_values(toks, j, cols, REVISIONS)
    for row in rows:
        read = {c: literal(f"{REVISIONS}.{c}", row[cols.index(c)]) for c in REVISION_READ}
        if read["entity"] == MOVE_ENTITY:
            # A move takes its own branch (move_failures), so the wording checks never see it.
            value = row[cols.index("entity_id")] if "entity_id" in cols else []
            if len(value) != 1 or value[0][0] != "num":
                raise Unreadable(f"{REVISIONS}.entity_id of a fact move is something other than one integer literal")
            read["entity_id"] = str(int(value[0][1]))
            yield read
            continue
        if read["choice"] not in REVISION_CHOICES:
            raise Unreadable(f"{REVISIONS}.choice {read['choice']!r}, which is none of {', '.join(REVISION_CHOICES)}")
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
        wrote = f"  field: {MOVE_FIELD}\n  wrote: entity_id {row['entity_id']}, old_text {row['old_text']}, new_text {row['new_text']}"
        if (row["field"], row["choice"], row["origin"]) != ("ordinal", "move", "practitioner"):
            out.append(f"a {MOVE_ENTITY} audit row is a fact move and needs field 'ordinal', choice 'move' and origin "
                       f"'practitioner'; this one writes field {row['field']!r}, choice {row['choice']!r} and origin "
                       f"{row['origin']!r}.\n{wrote}")
        elif not any(new == row["new_text"] and row["entity_id"] in ids and row["old_text"] in ordinals
                     for new, ids, ordinals in updates):
            out.append(f"{MOVE_FIELD} match no UPDATE {MOVE_ENTITY} SET ordinal = {row['new_text']} WHERE id = "
                       f"{row['entity_id']} AND ordinal = {row['old_text']} in this script, so the audited move is not "
                       f"the move written.\n{wrote}")
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
                    out.append(f"{REVISION_FIELD} differs from old_text, and the choice 'current' keeps the "
                               f"wording unchanged.\n{wrote}\n  old_text: {row['old_text']}")
            elif not sets_literal(stmts, row["entity"], row["field"], new):
                out.append(f"{REVISION_FIELD} is not the literal an UPDATE {row['entity']} SET {row['field']} "
                           f"in this script writes, so the audited text is not the text written.\n{wrote}")
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


def text_of(content):
    if isinstance(content, list):
        return "\n".join(part.get("text", "") for part in content
                         if isinstance(part, dict) and part.get("type") == "text")
    return content if isinstance(content, str) else ""


def words(text):
    """text with every system-reminder block cut out, or "" when that leaves no words (#1366)."""
    text = REMINDER.sub(GAP, text)
    return text if text.replace(GAP, "").strip() else ""


def strike(turn, values):
    for value in sorted(values, key=len, reverse=True):
        turn = re.sub(r"(?<!\w)" + re.escape(value) + r"(?!\w)", STRUCK, turn)
    return turn


def approval(turn):
    """Whether a turn, its struck widget values and cut reminders removed, is a bare yes."""
    return norm(turn.replace(STRUCK.strip(), " ").replace(GAP.strip(), " ")).rstrip(".!") in APPROVALS


def fences(text):
    """Each fenced code block's content in text, its final newline dropped."""
    return [b[:-1] if b.endswith("\n") else b for b in FENCE.findall(text)]


def read_transcript(path):
    """(practitioner turns with earlier widget values struck, the last practitioner turn with no
    widget value struck, every fenced block, as shown, of the session's visible reply (text parts
    and SendUserMessage messages) between the previous practitioner turn and the last, and the
    scripts of drafting_data__execute calls since the last practitioner turn that a result has
    answered)."""
    turns, widget_values = [], set()
    last_raw, last_fences = "", ()
    shown, executes, executed = [], {}, []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            try:
                rec = json.loads(line)
            except ValueError:
                continue  # a line the harness is still writing
            content = (rec.get("message") or {}).get("content")
            parts = [p for p in content if isinstance(p, dict)] if isinstance(content, list) else []
            if rec.get("type") == "assistant":
                for part in parts:
                    if part.get("type") == "text" and not rec.get("isSidechain"):
                        shown += fences(part.get("text") or "")
                    if part.get("type") != "tool_use":
                        continue
                    name = part.get("name") or ""
                    tool_input = part.get("input") or {}
                    if name.endswith("SendUserMessage") and not rec.get("isSidechain"):
                        message = tool_input.get("message")
                        shown += fences(message if isinstance(message, str) else "")
                    elif name.endswith("drafting_data__execute") and not rec.get("isSidechain"):
                        executes[part.get("id")] = tool_input.get("sql_script") or ""
                    if name.endswith("show_widget"):
                        code = "\n".join(v for v in (part.get("input") or {}).values() if isinstance(v, str))
                        widget_values |= {html.unescape(a or b) for a, b in DATA_VALUE.findall(code)
                                          if (a or b).strip()}
            elif rec.get("type") == "user":
                for part in parts:
                    if part.get("type") == "tool_result" and part.get("tool_use_id") in executes:
                        executed.append(executes.pop(part.get("tool_use_id")))
                origin = rec.get("origin")
                if rec.get("isMeta") or not isinstance(origin, dict) or origin.get("kind") != "human":
                    continue
                turn = words(text_of(content))
                if rec.get("promptSource") is None:
                    # A slash command carries no promptSource: only its arguments are the practitioner's words.
                    args = COMMAND_ARGS.search(turn) if "<command-name>" in turn else None
                    if not args:
                        continue
                    turn = words(args.group(1))
                elif rec["promptSource"] not in TYPED_SOURCES:
                    continue
                if turn:
                    turns.append(strike(turn, widget_values))
                    last_raw, last_fences = turn, tuple(shown)
                    shown, executes, executed = [], {}, []
            elif rec.get("type") == "attachment":
                queued = rec.get("attachment") or {}
                origin = queued.get("origin")
                if (queued.get("type") == "queued_command" and not queued.get("isMeta") and isinstance(origin, dict)
                        and origin.get("kind") == "human"):
                    turn = words(text_of(queued.get("prompt")))
                    if turn:
                        turns.append(strike(turn, widget_values))
                        last_raw, last_fences = turn, tuple(shown)
                        shown, executes, executed = [], {}, []
    return turns, last_raw, last_fences, executed


def norm(text):
    return " ".join(text.split()).casefold()


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
    sys.stderr.write(PREFIX + message + "\n")
    return 2


def board_goal(payload):
    """A confirmed statement of goals: a run of one practitioner turn, or the one fenced block shown
    before the last turn, approved by a bare yes. Inferred and declined pass: the session's wording."""
    tool_input = payload.get("tool_input") or {}
    statement = tool_input.get("statement")
    if tool_input.get("status") != "confirmed" or not isinstance(statement, str) or not statement.strip():
        return 0  # not confirmed, or a confirmed write with no statement, which the tool itself refuses
    path = payload.get("transcript_path") or ""
    if not path:
        return refuse("the hook input names no transcript_path, so there is no record of what the "
                      "practitioner approved to check the statement of goals against.")
    try:
        turns, last_raw, last_fences, _ = read_transcript(path)
    except OSError as exc:
        return refuse(f"cannot read the session transcript at {path}: {exc}")
    if any(norm(statement) in norm(turn) for turn in turns):
        return 0
    if len(last_fences) == 1 and last_fences[0] == statement and approval(last_raw):
        return 0
    nearest_turn = f"\n  nearest turn: {echo(statement, nearest(statement, turns))}" if turns else ""
    return refuse(f"a confirmed statement of goals is neither an unbroken run of one thing the practitioner "
                  f"said in this session nor the one fenced code block in the session's reply before the "
                  f"practitioner's last turn, approved by a bare yes.\n  field: {GOAL_FIELD}\n"
                  f"  wrote: {statement}\n  shown: {len(last_fences)} fenced block(s){nearest_turn}\n"
                  "Show the whole statement as the only fenced code block in one reply, exactly as it will be "
                  "saved, and record it as confirmed only after the practitioner's next turn is a bare yes. "
                  "Until then it is not confirmed: record it as inferred if the practitioner declined.")


def bare_yes(payload, needs, how):
    """A merge passes only when the practitioner's last turn is a bare yes. `needs` names what the
    merge needs confirmed, `how` what the session shows before asking."""
    path = payload.get("transcript_path") or ""
    if not path:
        return refuse("the hook input names no transcript_path, so there is no record of the "
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
    """A merge of two Job Boards (docs/ADRs/0010), after the session showed both boards' statements
    of goals and asked whether they cohere."""
    return bare_yes(payload, "a merge of two Job Boards needs the practitioner's confirmation that their goals overlap "
                    "or cohere", "Show both boards' statements of goals side by side, ask whether to merge them")


def merge_jobs(payload):
    """A merge of a duplicate job into another (jobs-closeout.md §9c), after the session named both
    jobs and the combined steps and asked whether to merge them."""
    args = payload.get("tool_input") or {}
    return bare_yes(payload, f"a merge of Job {args.get('absorbed_id')} into Job {args.get('survivor_id')} needs the "
                    "practitioner's confirmation", "Name both jobs and the combined steps, ask whether to merge them")


def main():
    payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    if (payload.get("tool_name") or "").endswith(GOAL_TOOL):
        return board_goal(payload)
    if (payload.get("tool_name") or "").endswith(MERGE_TOOL):
        return merge_boards(payload)
    if (payload.get("tool_name") or "").endswith(MERGE_JOBS_TOOL):
        return merge_jobs(payload)
    script = (payload.get("tool_input") or {}).get("sql_script") or ""
    try:
        revisions, stmts = revision_writes(script)
    except Unreadable as exc:
        return refuse(f"cannot read the paragraph revision this script writes: {exc}. Write "
                      "paragraph_revisions.choice, origin, entity, field, old_text and new_text as plain "
                      "string literals, in INSERT ... VALUES or INSERT ... SELECT, as paragraph-revision.md shows.")
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
        return refuse("the hook input names no transcript_path, so there is no record of "
                      "what the practitioner approved to check the paragraph revision against.")
    try:
        turns, last_raw, last_fences, executed = read_transcript(path)
    except OSError as exc:
        return refuse(f"cannot read the session transcript at {path}: {exc}")
    if any(wrote_wording(earlier) for earlier in executed):
        return refuse(f"a paragraph revision was already written, or attempted, since the practitioner's last "
                      f"turn, and one approval admits one paragraph.\n  field: {REVISION_FIELD}\n"
                      f"  wrote: {wording[0]['new_text']}\n{REVISION_CLOSING}")
    revision_refusals = revision_failures(revisions, stmts, turns, last_raw, last_fences)
    if revision_refusals:
        return refuse("\n".join(revision_refusals + [REVISION_CLOSING]))
    return 0


if __name__ == "__main__":
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    try:
        sys.exit(main())
    except Exception as exc:  # the gate's own failure refuses the call (#784, decision 5)
        sys.exit(refuse(f"the gate itself failed: {exc!r}"))
