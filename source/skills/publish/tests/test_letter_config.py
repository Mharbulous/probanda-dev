"""The letterhead and the author's identity come from the firm profile and the machine,
never from the skill or the payload.

The firm profile (practice_data__firm_profile's response) names the letterhead and holds
the firm name and roster. The signer's details come from the signer's roster entry, and
the preparer is this machine's `person` in the Roaming coclerk.json. Everything here runs
on synthetic assets.

Run: python -m unittest discover -s .claude/skills/publish/tests
"""
from __future__ import annotations

import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import support
from support import FIRM_NAME, LAWYER, PAYLOAD, STAFF


def parts_of(path):
    with zipfile.ZipFile(path) as z:
        return {name: z.read(name) for name in z.namelist()}


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.tmp = Path(self._tmp.name)
        self.appdata = self.tmp / "appdata"
        self.template = support.write_zip(self.tmp / "letterhead.docx",
                                          support.template_parts())

    def config(self, **config):
        support.write_config(self.appdata, config)

    def render(self, payload=PAYLOAD, roster=support.ROSTER):
        profile = support.write_profile(self.tmp / "profile.json", self.template, roster)
        return support.render(self.tmp, payload, self.appdata, profile)

    def render_ok(self, payload=PAYLOAD):
        proc, out = self.render(payload)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return parts_of(out)

    def assert_refused(self, needle, payload=PAYLOAD, roster=support.ROSTER):
        proc, out = self.render(payload, roster)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn(needle, proc.stderr)
        self.assertFalse(out.exists())


class TestConfiguredLetter(Base):
    def setUp(self):
        super().setUp()
        self.config(person=STAFF["key"])
        self.parts = self.render_ok()
        self.doc = self.parts["word/document.xml"].decode("utf-8")

    def test_every_xml_part_parses(self):
        for name, data in self.parts.items():
            if name.endswith((".xml", ".rels")):
                ET.fromstring(data)

    def test_the_header_and_footer_come_from_the_signers_roster_entry(self):
        header = self.parts["word/header3.xml"].decode("utf-8")
        footer = self.parts["word/footer3.xml"].decode("utf-8")
        self.assertIn(LAWYER["name"], header)
        self.assertIn(LAWYER["email"], header)
        self.assertIn(LAWYER["direct_line"], footer)
        self.assertIn(PAYLOAD["file_number"], footer)

    def test_the_closing_block_comes_from_the_roster_and_the_profile(self):
        for value in (FIRM_NAME, LAWYER["closing"], LAWYER["name"]):
            self.assertIn(value, self.doc)

    def test_the_initials_line_is_signer_then_preparer(self):
        self.assertIn(">%s/%s<" % (LAWYER["initials"], STAFF["initials"]), self.doc)

    def test_the_section_layout_is_the_templates(self):
        self.assertIn(support.SECT_PR, self.doc)


class TestRefusals(Base):
    def test_an_unset_person_is_named(self):
        self.config()
        self.assert_refused('"person"')

    def test_a_person_not_in_the_roster_is_named(self):
        self.config(person="nobody")
        self.assert_refused('person "nobody" is not a key in the firm roster')

    def test_a_payload_carrying_a_removed_override(self):
        self.config(person=STAFF["key"])
        self.assert_refused("author_name", {**PAYLOAD, "author_name": "Someone Else"})

    def test_a_signer_entry_missing_a_field_is_named(self):
        self.config(person=STAFF["key"])
        roster = [{**LAWYER, "closing": ""}, STAFF]
        self.assert_refused('roster entry "pe" has no closing', roster=roster)

    def test_a_letterhead_that_still_carries_a_body_image(self):
        self.config(person=STAFF["key"])
        self.template = support.write_zip(self.tmp / "unstripped.docx",
                                          support.template_parts(body_image=True))
        self.assert_refused("image relationship")

    def test_an_existing_output_is_not_overwritten(self):
        self.config(person=STAFF["key"])
        (self.tmp / "letter.docx").write_bytes(b"earlier letter")
        proc, out = self.render()
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("refusing to overwrite", proc.stderr)
        self.assertEqual(out.read_bytes(), b"earlier letter")


if __name__ == "__main__":
    unittest.main()
