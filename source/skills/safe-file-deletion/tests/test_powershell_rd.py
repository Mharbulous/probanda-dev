"""#1407: in PowerShell, rd and rmdir are Remove-Item and count as a delete.

On the PowerShell tool every rd/rmdir counts, whatever its flags. On Bash and
device_bash it counts once a Windows shell is invoked and the command names
powershell or pwsh. A cmd-only rd still needs cmd's /s switch, which the hook
finds in a glued cluster such as /q/s too.
"""
import unittest

from test_redirect_delete_to_trash import DEVICE, HookTestCase


PS_RD_LABEL = "Blocked pattern: PowerShell rd/rmdir (Remove-Item)"


class PowerShellRdTests(HookTestCase):
    PS_PLAIN = [
        "rd notes.docx",
        "rmdir notes.docx",
        "rmdir -Path notes.docx",
        "rd notes.docx -Confirm:$false",
        "Get-ChildItem *.docx | rd",
        "rmdir dir",
    ]
    PS_DELETES = PS_PLAIN + [
        "rd -Recurse x",
        "rd -r x",
        "rd -Force notes.docx",
        "rd -LiteralPath notes.docx",
        "cmd /c rd /S /Q d",
        "Remove-Item x",
        "cmd /c rd emptydir",                                      # #1407 decision 2
        "Select-String -Pattern '(st|nd|rd)' x.txt",               # #1407 decision 4
        'Get-ChildItem | Where-Object { $_.Name -eq "rmdir" }',    # #1407 decision 4
    ]
    BASH_MUST_DENY = [
        "pwsh -c rd notes.docx",
        "pwsh -c 'rmdir notes.docx'",
        "cmd /c powershell rd notes.docx",
        "cmd /c rd /q/s d",
        "cmd /c rd /Q/S d",
    ]
    BASH_MUST_ALLOW = [
        "cmd /c rd emptydir",
        "cmd /c rd emptydir && grep -rn x .",
    ]

    def test_powershell_rd_outside_worktree_is_denied(self):
        for command in self.PS_DELETES:
            with self.subTest(command=command):
                self.assertDenied(self.call("PowerShell", command, cwd=self.matter))

    def test_powershell_plain_rd_names_remove_item(self):
        for command in self.PS_PLAIN:
            with self.subTest(command=command):
                reason = self.decision(self.call("PowerShell", command, cwd=self.matter))["permissionDecisionReason"]
                self.assertIn(PS_RD_LABEL, reason)

    def test_powershell_rd_inside_worktree_or_temp_is_allowed(self):
        for cwd in (self.repo, self.ostemp):
            for command in self.PS_DELETES:
                with self.subTest(cwd=cwd.name, command=command):
                    self.assertAllowedSilently(self.call("PowerShell", command, cwd=cwd))

    def test_bash_and_device_powershell_rd_is_denied(self):
        for command in self.BASH_MUST_DENY:
            with self.subTest(tool="Bash", command=command):
                self.assertDenied(self.call("Bash", command, cwd=self.matter))
            with self.subTest(tool=DEVICE, command=command):
                self.assertDenied(self.call(DEVICE, command))

    def test_bash_and_device_cmd_rd_without_s_is_allowed(self):
        for command in self.BASH_MUST_ALLOW:
            with self.subTest(tool="Bash", command=command):
                self.assertAllowedSilently(self.call("Bash", command, cwd=self.matter))
            with self.subTest(tool=DEVICE, command=command):
                self.assertAllowedSilently(self.call(DEVICE, command))


if __name__ == "__main__":
    unittest.main()
