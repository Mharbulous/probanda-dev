#!/usr/bin/env python3
"""
check_internals: a seeded internal term in a hook refusal, a page template, a file-name
builder or a mockup comment is flagged; product vocabulary, code and SessionStart notes are not; the repo is clean.

Run: python -m pytest -q scripts/tests/test_check_internals.py
"""

import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path

import fake_repo

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("check_internals", os.path.join(SCRIPTS, "check_internals.py"))
check_internals = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_internals)

GATE = '''#!/usr/bin/env python3
"""A gate. Its docstring may name drafting_forms__render and Filing 3 freely."""
import json
QUERY = "SELECT value FROM kv_store WHERE namespace = 'item'"  # internals-ok: a query, not a message
REASON = "Refused: {reason}"
'''
NOTE = '''#!/usr/bin/env python3
NOTE = "Before the first lookup, call practice_data__config_status and read it."
'''
PAGE = '''<!doctype html><html><head><style>.x{{}}</style>
<script>const filing_id = 1; render("drafting_forms__render");</script></head>
<body><h1 data-filing-id="7">Work Board 7</h1><p>{text}</p></body></html>
'''
SERVER = '''import {{ join }} from "node:path";
function filingFolderName(id: number): string {{
  return {name};
}}
export function isWritingName(name: string): boolean {{
  return name === "drafting_forms__render";
}}
export function writeIt(dir: string, ids: number[]) {{
  throw new Error(`drafting_forms__render: ${{ids.join(", ")}} could not be written`);
  throw refused({err}, "not_written");
  return join(dir, {leaf});
}}
export function renderIt(ctx: Ctx, lines: string[]) {{
  lines.push({mockup});
}}
'''


def make_repo(root, reason="Refused: that page is for the practitioner to view.",
              text="A Writing on its Work Board, with its Loose Threads.",
              name='`${id} Notice of Application`', leaf='"Notice of Application.md"',
              err='`"${title}" was not written`', mockup='`Order 1 <!-- order_sought_id ${r.id} -->`'):
    assignment = {
        "lawyer": {"requires": [], "skills": [], "agents": [], "servers": [],
                   "hooks": {"gate": "source/lawyer/hooks/gate.py", "note": "source/lawyer/hooks/note.py"}},
        "developer": {"requires": ["lawyer"], "skills": [], "agents": [], "servers": [],
                      "hooks": {"dev": "source/developer/hooks/dev.py"}},
    }
    plugin = {"name": "lawyer", "hooks": {
        "PreToolUse": [{"matcher": "Read", "hooks": [
            {"type": "command", "command": "python3", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/gate.py"]}]}],
        "SessionStart": [{"hooks": [
            {"type": "command", "command": "python3", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/note.py"]}]}],
    }}
    developer = {"name": "developer", "hooks": {"PreToolUse": [{"matcher": "Read", "hooks": [
        {"type": "command", "command": "python3", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/dev.py"]}]}]}}
    files = {
        "source/lawyer/plugin.json": json.dumps(plugin),
        "source/developer/plugin.json": json.dumps(developer),
        "source/lawyer/hooks/gate.py": GATE.replace("{reason}", reason.replace('"', '\\"')),
        "source/lawyer/hooks/note.py": NOTE,
        "source/developer/hooks/dev.py": 'REASON = "Refused: use suggestion_box__submit to file it."\n',
        "source/lawyer/mcp/src/templates/milestone/milestone.html": PAGE.format(text=text),
        "source/lawyer/mcp/src/submission/names.ts": SERVER.format(name=name, leaf=leaf, err=err, mockup=mockup),
        "source/lawyer/mcp/src/submission/names.test.ts": 'const p = join(dir, "Unstructured.md");\n',
    }
    fake_repo.write_assignment(root, assignment)
    for rel, body in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(body, encoding="utf-8")


class CheckInternalsTest(unittest.TestCase):
    def found(self, **seed):
        with tempfile.TemporaryDirectory() as tmp:
            make_repo(Path(tmp), **seed)
            return check_internals.violations(Path(tmp))

    def test_a_clean_tree_passes(self):
        # Product vocabulary, code, attributes, docstrings, a SessionStart note, the developer
        # plugin, a test file, an array join and an is-function are never read as user-visible text.
        self.assertEqual(self.found(), [])

    def test_a_seeded_term_in_a_hook_refusal_is_flagged(self):
        for reason, label in [("Refused: call drafting_forms__render first.", "tool name"),
                              ("Refused (#784): the gate refused it.", "issue number"),
                              ("Refused: see shared/html-pages.md for why.", "skill file"),
                              ("Refused: set COCLERK_HTML_DEV=1 to develop.", "environment variable"),
                              ("Refused: an INSERT INTO paragraph_revisions with no columns.", "SQL")]:
            with self.subTest(reason=reason):
                found = self.found(reason=reason)
                self.assertEqual(len(found), 1, found)
                self.assertIn("source/lawyer/hooks/gate.py:5: hook message holds " + label, found[0])

    def test_a_seeded_term_in_a_page_template_is_flagged(self):
        found = self.found(text="Open the Unstructured Writing by its filing id.")
        self.assertEqual(sorted(f.split(" holds ")[1] for f in found),
                         ["filing id `filing id`", "stock type name `Unstructured`"])
        self.assertTrue(all("milestone.html:3: page text" in f for f in found), found)

    def test_a_seeded_term_in_a_file_name_builder_is_flagged(self):
        found = self.found(name='`Filing ${id}`')
        self.assertEqual(len(found), 1, found)
        self.assertIn("names.ts:3: file name holds filing folder", found[0])
        found = self.found(leaf='"UNS Notice of Application", "Unstructured.md"')
        self.assertEqual(sorted(f.split(" holds ")[1] for f in found),
                         ["stock type name `UNS`", "stock type name `Unstructured.md`"])

    def test_a_seeded_term_in_a_data_server_error_is_flagged(self):
        for err, label in [("`Filing ${id}: it was not written`", "filing id"),
                           ("`${title}: hearing_details.time_estimate_minutes is not set`", "column name"),
                           ("`db_meta ${key} is not JSON`", "table name"),
                           ("`no row: SELECT value FROM tickets returned nothing`", "SQL")]:
            with self.subTest(err=err):
                found = self.found(err=err)
                self.assertEqual(len(found), 1, found)
                self.assertIn("names.ts:10: error message holds " + label, found[0])

    def test_a_filing_id_in_a_mockup_comment_is_flagged(self):
        # A row-id trace such as order_sought_id is not this check's business.
        for mockup in ["`<!-- filing ${ctx.filing.id} proceeding ${ctx.proceeding.id} -->`",
                       "`<!-- proceeding ${ctx.proceeding.id} -->`"]:
            with self.subTest(mockup=mockup):
                found = self.found(mockup=mockup)
                self.assertEqual(len(found), 1, found)
                self.assertIn("names.ts:14: mockup comment holds record id", found[0])

    def test_the_exemption_marker_clears_one_line(self):
        found = self.found(leaf='"mockups", `Filing ${ids[0]}`); // internals-ok: moves the old folder away')
        self.assertEqual(found, [])

    def test_the_repo_is_clean(self):
        self.assertEqual(check_internals.violations(), [])


if __name__ == "__main__":
    unittest.main()
