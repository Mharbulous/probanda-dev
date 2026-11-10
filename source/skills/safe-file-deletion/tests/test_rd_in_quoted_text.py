"""#1387: on Bash and device_bash, rmdir/rd counts only when a Windows shell runs it.

A quoted regex such as `(st|nd|rd)` used to read as an `rd` command, and any
`-rn` elsewhere in the command as its recursive flag.
"""
import unittest

from test_redirect_delete_to_trash import DEVICE, HookTestCase


EXHIBIT_4 = (
    'cd "$HOME/mnt/L8443 Waypoint P-Note/0. DRAFT" && for f in "NOA security for Costs/Notice of'
    ' Application - Security for Costs (BCSC).docx" "2026-04-29 Security for Costs.docx" "NOA.docx";'
    ' do echo "=== $f"; pandoc "$f" -t plain --wrap=none 2>/dev/null | grep -n -i -E'
    ' "chen|affidavit #?[0-9]|[0-9](st|nd|rd) affidavit" | head -12; done;'
    ' grep -rn -i "chen" "2026-04-29 Claude" 2>/dev/null | head -12'
)


class RdInQuotedTextTests(HookTestCase):
    BASH_MUST_ALLOW = [
        'grep -rn "(st|nd|rd)" x',
        'echo "|rd)" -r',
        "rmdir somedir; grep -rn x .",
        "rmdir dir",
        "cmd /c rd emptydir",
    ]
    BASH_MUST_DENY = ["cmd /c rd /s /q d", "rm -rf x"]
    DEVICE_MUST_DENY = BASH_MUST_DENY + ["pwsh -c rd -Recurse x"]
    POWERSHELL_MUST_DENY = ["rd -Recurse x", "Get-ChildItem x -Recurse | rd"]

    def test_bash_and_device_allow_read_only_and_empty_dir_commands(self):
        for command in self.BASH_MUST_ALLOW:
            with self.subTest(tool="Bash", command=command):
                self.assertAllowedSilently(self.call("Bash", command, cwd=self.matter))
        for command in self.BASH_MUST_ALLOW + [EXHIBIT_4]:
            with self.subTest(tool=DEVICE, command=command):
                self.assertAllowedSilently(self.call(DEVICE, command))

    def test_recursive_rd_is_still_denied(self):
        for command in self.BASH_MUST_DENY:
            with self.subTest(tool="Bash", command=command):
                self.assertDenied(self.call("Bash", command, cwd=self.matter))
        for command in self.DEVICE_MUST_DENY:
            with self.subTest(tool=DEVICE, command=command):
                self.assertDenied(self.call(DEVICE, command))
        for command in self.POWERSHELL_MUST_DENY:
            with self.subTest(tool="PowerShell", command=command):
                self.assertDenied(self.call("PowerShell", command, cwd=self.matter))

    def test_deny_message_names_the_blocked_form(self):
        for tool in ("Bash", DEVICE):
            with self.subTest(tool=tool):
                reason = self.decision(self.call(tool, "cmd /c rd /s /q d", cwd=self.matter))["permissionDecisionReason"]
                self.assertIn("Blocked pattern: rmdir/rd with a recursive flag", reason)


if __name__ == "__main__":
    unittest.main()
