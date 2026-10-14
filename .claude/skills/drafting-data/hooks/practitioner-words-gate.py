#!/usr/bin/env python3
"""Refuse new wording on an existing job that is not the practitioner's own words (#784).

Hook event: PreToolUse on drafting_data__execute. The gate protects an existing job's
wording and never reads the creation of a job: an INSERT INTO tickets, in any form, is not
read. It checks every tickets.title and tickets.intent an UPDATE tickets sets; every
ticket_steps.text an INSERT INTO ticket_steps writes, by VALUES or by INSERT ... SELECT,
in a script that also deletes from ticket_steps (the shape that replaces an existing job's
steps: jobs-run.md §5, jobs-create.md §3a); and every ticket_steps.text an UPDATE
ticket_steps sets to a string literal, except a literal ending in " [rev N]" (jobs-gate.md
§14's result line). A `text || '<literal>' ...` value keeps the step's own words and appends
literals (§14's waiver), so it passes unchecked. A step written with no delete in its script
is a new job's step and is not read. It also checks every marker_suppressions.note an INSERT
INTO or UPDATE marker_suppressions writes (v69, filing-checklists.md §6): counsel's words for a
suppression, never a printed title or the session's paraphrase. Each checked value must be an unbroken run
of one practitioner turn in this session's transcript. The transcript is the
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
stays excluded. Case and runs of whitespace are ignored; punctuation and word
order are not.

The harness puts its own context inside those records as <system-reminder> blocks,
in a text part ahead of the typed text or prefixed to it. A reminder is not the
practitioner's words: every complete block is cut out of a turn before matching, a
value cannot match across the cut, and a record left with no words is not a turn
(#1366).

A widget submission arrives as a practitioner turn too, echoing the values the
session wrote into the widget. So every data-value from the session's earlier
show_widget calls is struck out of each turn before matching: a selection
supplies no words, and a typed answer still does.

A value no turn of this session holds passes by a second route: words the practitioner
wrote in an earlier session, quoted back. The session's own visible reply (not a
subagent's) holds a fenced code block whose whole content is the value, a practitioner
turn follows that reply, and some practitioner turn of another transcript in the same
folder holds the block's content as an unbroken run. The folder is searched newest
first, not into subfolders (a subagent's prompts are the session's), and only until
DEADLINE_SECONDS. A loose thread is not evidence: the session writes loose threads itself.

A tickets.title or tickets.intent no turn holds also passes as an approved proposal when it
stood, as an unbroken run of one text part, in the session's visible reply (not a subagent's,
not a tool call's input) since the previous practitioner turn, the next and last practitioner
turn is a bare yes (APPROVALS, the whole turn), and the statement writing it sets
session_proposed = 1. A step text never passes that way: steps carry no session_proposed flag,
so a proposed step is adopted by the practitioner pasting it back (shared/paralegal-posture.md
section 3), which makes it a run of their own turn.

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

Exempt: jobs-gate.md §14's fixed gate job text, jobs-stock.md §3b's stock
bundle jobs' fixed title, intent and step text, §3c's counsel's review jobs' fixed text (the
review job's title by its "Counsel's review of " prefix), §3d's scrutiny review job's
fixed intent and step (its title by its "Review scrutiny finding: " prefix), and a value
equal, character for character, to a Proposal title an earlier drafting_forms__*
tool result printed (a fast-path job's fixed text from the record), inline or
persisted to a file. A ticket_steps.text is also exempt when it equals, character for
character, a Proposal item such a result printed: the item on a detail line under Proposed
or Shelved, a string on a job's `keys:` line, or a board_data proposal's item (a
grouped intake job's steps, jobs-create.md §3e). An item never passes as a title or intent.
A tickets.title or ticket_steps.text is also exempt when it is an unbroken run of a job card's own
words such a result printed: the card's head line, its intent or one of its steps (/draft's pickup
review shortens a title or splits a step by cutting, adding no word). Never a tickets.intent.
No exemption applies to a marker_suppressions.note: fixed text and printed titles are a job's.
The gate cannot see which job holds a key, so this trusts the record as the title exemption
does: printed by a drafting_forms__* result in this session.

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
import time
from pathlib import Path

PREFIX = "Refused (practitioner-words gate, #784): "
TYPED_SOURCES = {"sdk", "typed", "queued"}
STRUCK = " \x00 "
GAP = " \x01 "  # where a system-reminder block was cut out of a turn
REMINDER = re.compile(r"<system-reminder>.*?</system-reminder>", re.S)
ECHO = 300  # the most of a nearest turn a refusal shows
COMMAND_ARGS = re.compile(r"<command-args>(.*?)</command-args>", re.S)
DATA_VALUE = re.compile(r"""data-value\s*=\s*(?:"([^"]*)"|'([^']*)')""")
FENCE = re.compile(r"^```[^\n]*\n(.*?)^```", re.M | re.S)
WORD = re.compile(r"[A-Za-z0-9]+")
# A whole practitioner turn that approves the session's proposal, as approval() normalizes it.
APPROVALS = {"yes", "approved", "approve", "agreed", "go ahead", "yes, go ahead", "ok", "okay", "do it"}
FLAG = [("name", "session_proposed"), ("p", "="), ("num", "1")]
# The plugin's hook timeout is 10 s; a cancelled hook does not refuse, so the gate stops first.
DEADLINE_SECONDS = 5

# jobs-gate.md §14's fixed gate job, and jobs-stock.md §3b's stock bundle jobs, §3c's
# counsel's review jobs and §3d's scrutiny review job, steps included: machine-composed text
# that §3 exempts by name.
FIXED_TEXT = {
    "Pre-filing consistency gate",
    "Run the pre-filing checks on the assembled package and clear or waive every failure "
    "before the Writing is presented as ready to file.",
    "Availability letter",
    "Obtain the court's availability for the hearing of this application by letter.",
    "File and serve",
    "File this Writing in the registry, serve it, and record the filing date and any "
    "affidavit of service.",
    "Application book",
    "Prepare the application book: render its title page and index, then bind them "
    "with the documents and fill in the page numbers.",
    "Draft the letter",
    "Draft this letter and render its mockup for review.",
    "Deliver",
    "Send this letter to its recipients and record it as sent.",
    "Draft this memo and render its mockup for review.",
    "Circulate this memo or put it on file, and record it as sent.",
    "Prepare the review pages",
    "Extract the source pages each paragraph of this Writing relies on into the presentation "
    "folder, ready for counsel's review.",
    "Counsel reviews every paragraph of this Writing, in document order, against its source pages.",
    "Counsel reviews the scrutinizer's finding on this statement of law against the source and confirms, "
    "revises or drops the statement.",
    "Draft the chambers-availability letter",
    "File in the registry and record the filing date",
    "Serve the filed documents",
    "Affidavit of service, or n/a",
    "Render the title page and index",
    "Bind the book and fill in the page numbers",
    "Send the letter to its recipients",
    "Record the letter as sent",
    "Draft the memo",
    "Circulate the memo or put it on file",
    "Record the memo as sent",
    "Extract the source pages into the presentation folder",
    "Review every paragraph and resolve every discussion point",
    "Review the finding against the source and confirm, revise or drop the statement",
}
# §3c's review job title is its prefix and the Writing's own title; §3d's is its prefix, the
# authority's title and the statement's id.
REVIEW_TITLE_PREFIXES = ("Counsel's review of ", "Review scrutiny finding: ")
CHECKED = ("title", "intent")
STEP_TEXT = "ticket_steps.text"
SUPPRESSIONS = "marker_suppressions"
NOTE_FIELD = "marker_suppressions.note"  # counsel's words verbatim (v69, filing-checklists.md §6)
REV_TOKEN = re.compile(r" \[rev \d+\]$")  # jobs-gate.md §14's result line ends with it
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
    """A checked job write whose title, intent or step text is not a plain string literal."""


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


def qualified(field):
    return field if "." in field else f"tickets.{field}"


def literal(field, value):
    if len(value) != 1 or value[0][0] != "str":
        raise Unreadable(f"{qualified(field)} is set to something other than one string literal")
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


def step_inserts(toks, j):
    """Every ticket_steps.text an INSERT INTO ticket_steps writes, by VALUES or by INSERT ... SELECT."""
    cols, j = insert_columns(toks, j, "ticket_steps")
    if "text" not in cols:
        return
    k = cols.index("text")
    rows, j = insert_values(toks, j, cols, "ticket_steps")
    for row in rows:
        yield STEP_TEXT, literal(STEP_TEXT, row[k]), False
    if ("name", "text") in toks[j:]:
        raise Unreadable("an INSERT INTO ticket_steps that also sets text after its values")


def note_inserts(toks, j):
    """Every marker_suppressions.note an INSERT INTO marker_suppressions writes, by VALUES or by INSERT ... SELECT."""
    cols, j = insert_columns(toks, j, SUPPRESSIONS)
    if "note" not in cols:
        return
    k = cols.index("note")
    rows, _ = insert_values(toks, j, cols, SUPPRESSIONS)
    for row in rows:
        yield NOTE_FIELD, literal(NOTE_FIELD, row[k]), False


def note_updates(toks, j):
    """Every marker_suppressions.note an UPDATE marker_suppressions sets."""
    if toks[j:j + 1] == [("name", "as")]:
        j += 2
    if toks[j:j + 1] != [("name", "set")]:
        raise Unreadable(f"an UPDATE {SUPPRESSIONS} with no SET")
    sets, _ = split(toks[j + 1:], ("p", ","), lambda t: t[0] == "name" and t[1] in SET_ENDS)
    for assignment in sets:
        if assignment[:1] == [("p", "(")]:
            if ("name", "note") in assignment:
                raise Unreadable(f"an UPDATE {SUPPRESSIONS} that sets note as a row value")
        elif assignment[:2] == [("name", "note"), ("p", "=")]:
            yield NOTE_FIELD, literal(NOTE_FIELD, assignment[2:]), False


def appends(value):
    """Whether value is `text || '<literal>' || ...`: the step's own words kept, literals appended."""
    rest = value[1:]
    return value[:1] == [("name", "text")] and len(rest) > 0 and len(rest) % 3 == 0 and all(
        rest[i:i + 2] == [("p", "|"), ("p", "|")] and rest[i + 2][0] == "str" for i in range(0, len(rest), 3))


def step_updates(toks, j):
    """Every ticket_steps.text an UPDATE ticket_steps sets to a literal, except §14's result line."""
    if toks[j:j + 1] == [("name", "as")]:
        j += 2
    if toks[j:j + 1] != [("name", "set")]:
        raise Unreadable("an UPDATE ticket_steps with no SET")
    sets, _ = split(toks[j + 1:], ("p", ","), lambda t: t[0] == "name" and t[1] in SET_ENDS)
    for assignment in sets:
        if assignment[:1] == [("p", "(")]:
            if ("name", "text") in assignment:
                raise Unreadable("an UPDATE ticket_steps that sets text as a row value")
        elif assignment[:2] == [("name", "text"), ("p", "=")] and not appends(assignment[2:]):
            value = literal(STEP_TEXT, assignment[2:])
            if not REV_TOKEN.search(value):
                yield STEP_TEXT, value, False


def update_writes(toks, j):
    if toks[j:j + 1] == [("name", "as")]:
        j += 2
    if toks[j:j + 1] != [("name", "set")]:
        raise Unreadable("an UPDATE tickets with no SET")
    sets, _ = split(toks[j + 1:], ("p", ","), lambda t: t[0] == "name" and t[1] in SET_ENDS)
    flagged = FLAG in sets
    for assignment in sets:
        if assignment[:1] == [("p", "(")]:
            if any(t in (("name", "title"), ("name", "intent")) for t in assignment):
                raise Unreadable("an UPDATE tickets that sets title or intent as a row value")
        elif assignment[:1] and assignment[0][1] in CHECKED and assignment[1:2] == [("p", "=")]:
            yield assignment[0][1], literal(assignment[0][1], assignment[2:]), flagged


def statements(toks):
    stmts, cur = [], []
    for t in toks:
        if t == ("p", ";"):
            stmts.append(cur)
            cur = []
        else:
            cur.append(t)
    return stmts + [cur]


def deletes_steps(stmt):
    return any(t == ("name", "delete") and stmt[k + 1:k + 2] == [("name", "from")]
               and table_at(stmt, k + 2, "ticket_steps") is not None for k, t in enumerate(stmt))


def ticket_writes(script):
    """Every (field, value, flagged) the script writes that the gate checks: tickets.title and
    tickets.intent by UPDATE tickets, flagged when the statement sets session_proposed = 1, and
    ticket_steps.text (field STEP_TEXT, never flagged) by an INSERT INTO ticket_steps in a script
    that deletes from ticket_steps, or by an UPDATE ticket_steps. An INSERT INTO tickets creates a
    job and is not read. Also marker_suppressions.note (field NOTE_FIELD, never flagged), counsel's
    words for a suppression, by INSERT or UPDATE."""
    if not re.search(r"(?i)\btickets\b|\bticket_steps\b|\bmarker_suppressions\b", script):
        return []
    stmts = statements(tokens(script))
    replaces = any(deletes_steps(stmt) for stmt in stmts)
    written = []
    for stmt in stmts:
        for k, t in enumerate(stmt):
            if t == ("name", "into"):
                j = table_at(stmt, k + 1, "ticket_steps")
                if j is not None and replaces:
                    written += step_inserts(stmt, j)
                j = table_at(stmt, k + 1, SUPPRESSIONS)
                if j is not None:
                    written += note_inserts(stmt, j)
            elif t == ("name", "update"):
                start = k + 3 if stmt[k + 1:k + 2] == [("name", "or")] else k + 1
                j = table_at(stmt, start, "tickets")
                if j is not None:
                    written += update_writes(stmt, j)
                j = table_at(stmt, start, "ticket_steps")
                if j is not None:
                    written += step_updates(stmt, j)
                j = table_at(stmt, start, SUPPRESSIONS)
                if j is not None:
                    written += note_updates(stmt, j)
    return written


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


# A Proposal's line; a shelved job's `- Job #<id> <title> · Shelved` line under Shelved
# (`- #<id> <title>` before the headline summary) is not one.
SUMMARY_LINE = re.compile(r"^- (?!#\d|Job #\d)(\S+) (.+)$")


def summary_titles(text):
    """Every `- <glyph> <title>` line's title under a `## Proposed` or `## Shelved` heading,
    up to the next `## ` heading: a drafting_forms__board_card lane's lines, and a board_summary's
    from before it printed those lanes as counts (#1365)."""
    titles, inside = set(), False
    for line in text.split("\n"):
        if line.startswith("## "):
            inside = line.startswith("## Proposed") or line.startswith("## Shelved")
        elif inside:
            match = SUMMARY_LINE.match(line)
            if match:
                titles.add(match.group(2))
    return titles


ITEM_MARK = " · item: "
LANE_MARK = " · lane: "
JSON_STRING = re.compile(r'"(?:[^"\\]|\\.)*"')


def summary_items(text):
    """Every Proposal item a card prints: each `  key: <key> · item: <item> · lane: <lane>` line's
    item under a `## Proposed` or `## Shelved` heading, and every JSON string on a job's
    `  keys: ` line anywhere. The item runs from the first item marker, since a key never holds
    " · ", to the last lane marker, so an item holding " · " survives."""
    items, inside = set(), False
    for line in text.split("\n"):
        if line.startswith("## "):
            inside = line.startswith("## Proposed") or line.startswith("## Shelved")
        elif line.startswith("  keys: "):
            items |= {json.loads(s) for s in JSON_STRING.findall(line)}
        elif inside and line.startswith("  key: ") and ITEM_MARK in line and LANE_MARK in line:
            start, end = line.index(ITEM_MARK) + len(ITEM_MARK), line.rindex(LANE_MARK)
            if end >= start:
                items.add(line[start:end])
    return items


JOB_HEAD = re.compile(r"^- Job #\d+ (.+)$")
STEP_MARK = re.compile(r"(?:^| · )\d+ [☐☑] ")
DONE_STAMP = re.compile(r" \([^()]*\)$")


def card_texts(text):
    """Every job card's own words a card prints: the head line after `- Job #<id> ` (the title and
    its chips), the `  intent: ` text, and each step's text on the `  steps: ` line, its done stamp
    dropped. /draft's pickup review cuts a short title or a split step from these
    (draft/references/job-session.md, the pickup review)."""
    texts = set()
    for line in text.split("\n"):
        head = JOB_HEAD.match(line)
        if head:
            texts.add(head.group(1))
        elif line.startswith("  intent: "):
            texts.add(line[len("  intent: "):])
        elif line.startswith("  steps: "):
            texts |= {DONE_STAMP.sub("", s) for s in STEP_MARK.split(line[len("  steps: "):]) if s}
    return texts


def proposal_text(result_text):
    """(Proposal titles, Proposal items, job card texts) in one tool result's JSON text: a
    board_data-shaped `proposals` list's, and those printed in any string value, such as a
    board_card result's `card`."""
    try:
        stack, titles, items, cards = [json.loads(result_text)], set(), set(), set()
    except ValueError:
        return set(), set(), set()
    while stack:
        node = stack.pop()
        if isinstance(node, dict):
            proposals = node.get("proposals")
            if isinstance(proposals, list):
                titles |= {p["title"] for p in proposals if isinstance(p, dict) and isinstance(p.get("title"), str)}
                items |= {p["item"] for p in proposals if isinstance(p, dict) and isinstance(p.get("item"), str)}
            stack.extend(node.values())
        elif isinstance(node, list):
            stack.extend(node)
        elif isinstance(node, str):
            titles |= summary_titles(node)
            items |= summary_items(node)
            cards |= card_texts(node)
    return titles, items, cards


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
    """(practitioner turns with earlier widget values struck, Proposal titles printed, Proposal
    items printed, normed fenced blocks of the session's own replies that a later practitioner
    turn followed, the text parts of the session's visible reply before the last practitioner
    turn when that turn is a bare yes, else [], the last practitioner turn with no widget value
    struck, every fenced block, as shown, of the session's visible reply (text parts and
    SendUserMessage messages) between the previous practitioner turn and the last, and the
    scripts of drafting_data__execute calls since the last practitioner turn that a result
    has answered)."""
    turns, widget_values, forms_calls, titles, items, cards = [], set(), set(), set(), set(), set()
    pending, confirmed = set(), set()
    visible, proposal = [], []
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
                        pending |= {norm(b) for b in FENCE.findall(part.get("text") or "") if norm(b)}
                        visible.append(part.get("text") or "")
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
                    elif "drafting_forms__" in name:
                        forms_calls.add(part.get("id"))
            elif rec.get("type") == "user":
                for part in parts:
                    if part.get("type") == "tool_result" and part.get("tool_use_id") in executes:
                        executed.append(executes.pop(part.get("tool_use_id")))
                    if part.get("type") == "tool_result" and part.get("tool_use_id") in forms_calls:
                        result = text_of(part.get("content"))
                        if result.startswith("<persisted-output>"):
                            result = text_of(rec.get("toolUseResult"))  # the full result the stub stands in for
                        printed_titles, printed_items, printed_cards = proposal_text(result)
                        titles |= printed_titles
                        items |= printed_items
                        cards |= printed_cards
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
                    confirmed |= pending
                    pending = set()
                    proposal = visible if approval(turns[-1]) else []
                    visible = []
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
                        confirmed |= pending
                        pending = set()
                        proposal = visible if approval(turns[-1]) else []
                        visible = []
    # a block no turn followed is dropped
    return turns, titles, items, cards, confirmed, proposal, last_raw, last_fences, executed


def norm(text):
    return " ".join(text.split()).casefold()


def earlier_turns_matching(blocks, current_path, deadline):
    """(the blocks some practitioner turn of another transcript beside current_path holds,
    transcripts searched, transcripts there). Newest first, not recursive, until deadline."""
    current = Path(current_path)
    files = sorted((p for p in current.parent.glob("*.jsonl") if p.name != current.name),
                   key=lambda p: p.stat().st_mtime, reverse=True)
    proven, searched = set(), 0
    for path in files:
        if proven == blocks or time.monotonic() >= deadline:
            break
        searched += 1
        raw = path.read_text(encoding="utf-8").lower()
        # Parse only a file holding each block's longest word; a block with no word is always parsed.
        todo = {b for b in blocks - proven if max(WORD.findall(b), key=len, default="") in raw}
        if todo:
            turns = [norm(turn) for turn in read_transcript(path)[0]]
            proven |= {b for b in todo if any(b in turn for turn in turns)}
    return proven, searched, len(files)


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


def main():
    start = time.monotonic()
    payload = json.loads(sys.stdin.buffer.read().decode("utf-8"))
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
    try:
        # Fixed text is a job's: it never passes as counsel's suppression note.
        written = [(f, v, flagged) for f, v, flagged in ticket_writes(script)
                   if f == NOTE_FIELD
                   or (v not in FIXED_TEXT and not (f == "title" and v.startswith(REVIEW_TITLE_PREFIXES)))]
    except Unreadable as exc:
        return refuse(f"cannot read the practitioner's wording this script writes: {exc}. Write "
                      "tickets.title, tickets.intent, ticket_steps.text and marker_suppressions.note as plain "
                      "string literals, in UPDATE ... SET, INSERT ... VALUES or INSERT ... SELECT, as "
                      "jobs-create.md, jobs-run.md and filing-checklists.md §6 show.")
    revision_refusals = revision_failures(revisions, stmts)
    if revision_refusals:
        return refuse("\n".join(revision_refusals + [REVISION_CLOSING]))
    wording = [row for row in revisions if row["choice"] != "current"]
    if len(wording) > 1:
        return refuse(f"this script writes {len(wording)} paragraph revisions, and one approval admits one "
                      f"paragraph.\n" + "\n".join(f"  wrote: {row['new_text']}" for row in wording)
                      + f"\n{REVISION_CLOSING}")
    if not written and not wording:
        return 0
    path = payload.get("transcript_path") or ""
    if not path:
        return refuse("the hook input names no transcript_path, so there is no record of "
                      "what the practitioner said to check the job's wording against.")
    try:
        turns, titles, items, cards, confirmed, proposal, last_raw, last_fences, executed = read_transcript(path)
    except OSError as exc:
        return refuse(f"cannot read the session transcript at {path}: {exc}")
    if wording and any(wrote_wording(earlier) for earlier in executed):
        return refuse(f"a paragraph revision was already written, or attempted, since the practitioner's last "
                      f"turn, and one approval admits one paragraph.\n  field: {REVISION_FIELD}\n"
                      f"  wrote: {wording[0]['new_text']}\n{REVISION_CLOSING}")
    revision_refusals = revision_failures(revisions, stmts, turns, last_raw, last_fences)
    if revision_refusals:
        return refuse("\n".join(revision_refusals + [REVISION_CLOSING]))
    # A printed item passes as a step only: a bare item is never a title or intent. A printed title
    # never passes as counsel's suppression note, which is only ever their own words.
    written = [(f, v, flagged) for f, v, flagged in written
               if (f == NOTE_FIELD or v not in titles) and not (f == STEP_TEXT and v in items)]
    # A title or step cut from a job card's own printed words adds none (/draft's pickup review).
    cut = {norm(c) for c in cards}
    written = [(f, v, flagged) for f, v, flagged in written
               if not (f in ("title", STEP_TEXT) and any(norm(v) in c for c in cut))]
    if not written:
        return 0
    if not turns:
        return refuse(f"the session transcript at {path} holds no practitioner turn to "
                      "check the job's wording against.")
    failing = [(f, v, flagged) for f, v, flagged in written if not any(norm(v) in norm(turn) for turn in turns)]
    quoted = {norm(v) for f, v, flagged in failing if norm(v) in confirmed}
    # Only a quoted and confirmed value sends the gate to the earlier transcripts.
    proven, searched, total = (earlier_turns_matching(quoted, path, start + DEADLINE_SECONDS)
                               if quoted else (set(), 0, 0))
    stopped = ", stopped at the gate's time limit" if searched < total else ""
    # The bare-yes route is a title's or intent's only: a step carries no session_proposed flag.
    proposed = {(f, norm(v)) for f, v, flagged in failing
                if f in CHECKED and any(norm(v) in norm(part) for part in proposal)}
    failures = [
        f"{qualified(field)} stood in the session's visible reply and the practitioner's last turn "
        f"approved it, but the statement writing it does not set tickets.session_proposed = 1.\n"
        f"  field: {field}\n  wrote: {value}"
        if (field, norm(value)) in proposed else
        f"{qualified(field)} was quoted in a block and confirmed, but no other transcript in "
        f"{Path(path).parent} holds it as an unbroken run of one practitioner turn "
        f"({searched} of {total} transcripts searched{stopped}).\n"
        f"  field: {field}\n  wrote: {value}"
        if norm(value) in quoted else
        f"{qualified(field)} is not an unbroken run of one thing the practitioner said in this session.\n"
        f"  field: {field}\n  wrote: {value}\n"
        f"  nearest turn: {echo(value, nearest(value, turns))}"
        for field, value, flagged in failing
        if norm(value) not in proven and not (flagged and (field, norm(value)) in proposed)
    ]
    if not failures:
        return 0
    return refuse("\n".join(failures) + "\nCut each from one answer, no word swapped, moved "
                  "or added. Case and spacing are ignored; punctuation is not. A value the "
                  "session wrote into a widget is not their words, even when a selection "
                  "echoes it back, and shows here as [widget value]. Words the practitioner "
                  "wrote in an earlier session may be quoted back in a fenced code block holding "
                  "only those words, one block per value, and pass once the practitioner replies "
                  "after the block. A title or intent the session showed in its visible reply passes "
                  "when the exact text stood there, the next and last practitioner turn is a bare "
                  "yes, and the write sets tickets.session_proposed = 1. A title or step cut from "
                  "a job card a drafting_forms__ result printed, no word added, passes. For wording the session "
                  "proposes: Show the proposed wording in one code block, introduce it with the "
                  "fixed sentence in shared/paralegal-posture.md section 3, and ask the practitioner "
                  "to copy it, edit it if needed, and paste it back.")


if __name__ == "__main__":
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    try:
        sys.exit(main())
    except Exception as exc:  # the gate's own failure refuses the call (#784, decision 5)
        sys.exit(refuse(f"the gate itself failed: {exc!r}"))
