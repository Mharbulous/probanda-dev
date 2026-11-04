"""ingest-unattended leaves the session no route to compose a write or read an extractor's result."""

import re
import unittest
from pathlib import Path

UNATTENDED = (Path(__file__).resolve().parents[1] / "operations" / "ingest-unattended.md").read_text(encoding="utf-8")


class UnattendedNoSessionWrite(unittest.TestCase):
    def test_no_session_write_route(self):
        self.assertEqual(re.findall(r"matter_data__execute|ingest-extract\.md|ingest-verify\.md", UNATTENDED), [])


if __name__ == "__main__":
    unittest.main()
