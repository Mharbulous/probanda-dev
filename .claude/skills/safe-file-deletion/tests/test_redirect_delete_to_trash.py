import base64
import codecs
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SKILL_ROOT.parents[2]
HOOK = SKILL_ROOT / "hooks" / "redirect-delete-to-trash.py"
PLUGIN_JSON = REPO_ROOT / "source" / "practice" / "plugin.json"
PLUGIN_HOOK_ARG = "${CLAUDE_PLUGIN_ROOT}/skills/safe-file-deletion/hooks/redirect-delete-to-trash.py"

DEVICE = "mcp__remote-devices__device_bash"
DEVICE_ROOT = "$HOME/mnt/L4801 Merrow v. Tidewater"


class HookTestCase(unittest.TestCase):
    """Fixtures live under one temp base, but the hook runs with TEMP/TMP/TMPDIR
    pointed at a subfolder of it, so the matter fixture is not OS-temp-exempt."""

    @classmethod
    def setUpClass(cls):
        cls.base = Path(tempfile.mkdtemp(prefix="coclerk-trash-hook-"))
        cls.ostemp = cls.base / "ostemp"
        cls.home = cls.base / "home"
        cls.matter = cls.base / "matter"
        cls.repo = cls.base / "repo"
        for d in (cls.ostemp, cls.home, cls.matter / "0. DRAFT" / "empty", cls.repo / ".git"):
            d.mkdir(parents=True)
        (cls.matter / "coclerk.json").write_text("{}", encoding="utf-8")
        (cls.matter / "0. DRAFT" / "x.md").write_text("x", encoding="utf-8")
        cls.m = cls.matter.as_posix()
        cls.env = {
            **os.environ,
            "TEMP": str(cls.ostemp), "TMP": str(cls.ostemp), "TMPDIR": str(cls.ostemp),
            "HOME": str(cls.home), "USERPROFILE": str(cls.home),
        }

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.base)    # test fixture under the OS temp dir

    def run_hook(self, stdin_text):
        return subprocess.run(
            [sys.executable, str(HOOK)],
            input=stdin_text, capture_output=True, text=True, encoding="utf-8", env=self.env,
        )

    def call(self, tool_name, command, cwd=None, **extra_input):
        payload = {
            "tool_name": tool_name,
            "tool_input": {"command": command, **extra_input},
            "cwd": str(cwd or self.home),
        }
        return self.run_hook(json.dumps(payload))

    def decision(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)["hookSpecificOutput"]

    def assertAllowedSilently(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), "")

    def assertDenied(self, result):
        out = self.decision(result)
        self.assertEqual(out["permissionDecision"], "deny")
        self.assertNotIn("updatedInput", out)
        self.assertTrue(out["permissionDecisionReason"].startswith(
            "Do not delete this directly - call the file-admin tool file_ops__trash with this path;"
        ))

    def assertRewritten(self, result, expected_command, original_input):
        out = self.decision(result)
        self.assertEqual(out["hookEventName"], "PreToolUse")
        self.assertEqual(out["permissionDecision"], "allow")
        self.assertEqual(out["updatedInput"], {**original_input, "command": expected_command})


class DeviceBashGateTests(HookTestCase):
    def test_device_bash_delete_is_seen(self):
        for tool in (DEVICE, "mcp__foo__device_bash", "mcp__device_bash"):
            with self.subTest(tool=tool):
                self.assertDenied(self.call(tool, 'rm "' + DEVICE_ROOT + '/0. DRAFT/*.md"'))

    def test_device_bash_non_delete_is_allowed(self):
        self.assertAllowedSilently(self.call(DEVICE, 'ls "' + DEVICE_ROOT + '/0. DRAFT"'))

    def test_tool_name_must_match_whole(self):
        for tool in ("device_bash", DEVICE + "_extra", "Bash2"):
            with self.subTest(tool=tool):
                self.assertAllowedSilently(self.call(tool, 'rm "' + DEVICE_ROOT + '/0. DRAFT/*.md"'))


class RewriteTests(HookTestCase):
    def test_bash_rm_in_matter_becomes_move_to_trash(self):
        command = 'rm "' + self.m + '/0. DRAFT/x.md"'
        extra = {"description": "Remove stale draft", "timeout": 30000}
        expected = (
            'mkdir -p "' + self.m + '/TRASH/0. DRAFT" && mv --backup=numbered "'
            + self.m + '/0. DRAFT/x.md" "' + self.m + '/TRASH/0. DRAFT/x.md"'
        )
        self.assertRewritten(self.call("Bash", command, **extra), expected, {"command": command, **extra})

    def test_device_bash_rm_keeps_home_literal(self):
        command = 'rm -r "' + DEVICE_ROOT + '/0. DRAFT/SUB Claimant Opening Submissions"'
        extra = {"description": "Trash stale mockup folder"}
        expected = (
            'mkdir -p "$HOME/mnt/L4801 Merrow v. Tidewater/TRASH/0. DRAFT" && mv --backup=numbered '
            '"$HOME/mnt/L4801 Merrow v. Tidewater/0. DRAFT/SUB Claimant Opening Submissions" '
            '"$HOME/mnt/L4801 Merrow v. Tidewater/TRASH/0. DRAFT/SUB Claimant Opening Submissions"'
        )
        for tool in (DEVICE, "mcp__foo__device_bash"):
            with self.subTest(tool=tool):
                self.assertRewritten(self.call(tool, command, **extra), expected, {"command": command, **extra})

    def test_multiple_targets_chain_one_move_each(self):
        command = 'rm -f "' + DEVICE_ROOT + '/a.md" ' + '"' + DEVICE_ROOT + '/0. DRAFT/b.md"'
        expected = (
            'mkdir -p "$HOME/mnt/L4801 Merrow v. Tidewater/TRASH" && mv --backup=numbered '
            '"$HOME/mnt/L4801 Merrow v. Tidewater/a.md" "$HOME/mnt/L4801 Merrow v. Tidewater/TRASH/a.md"'
            ' && mkdir -p "$HOME/mnt/L4801 Merrow v. Tidewater/TRASH/0. DRAFT" && mv --backup=numbered '
            '"$HOME/mnt/L4801 Merrow v. Tidewater/0. DRAFT/b.md" '
            '"$HOME/mnt/L4801 Merrow v. Tidewater/TRASH/0. DRAFT/b.md"'
        )
        self.assertRewritten(self.call(DEVICE, command), expected, {"command": command})


class ExemptTests(HookTestCase):
    def test_rm_inside_git_worktree_is_allowed_unchanged(self):
        self.assertAllowedSilently(self.call("Bash", "rm x.md", cwd=self.repo))

    def test_rm_under_os_temp_is_allowed_unchanged(self):
        target = (self.ostemp / "whatever").as_posix()
        self.assertAllowedSilently(self.call("Bash", 'rm "' + target + '"', cwd=self.ostemp))

    def test_rm_of_temp_targets_ignores_a_non_temp_cwd(self):
        t = self.ostemp.as_posix()
        for command in ("rm -f " + t + "/v-*.png", "rm -f " + t + "/v-1.png", "cd " + t + " && rm -f v-*.png"):
            with self.subTest(command=command):
                self.assertAllowedSilently(self.call("Bash", command))

    def test_temp_exemption_keeps_other_checks(self):
        t = self.ostemp.as_posix()
        for command in ("rm -f v-*.png", "rm " + t + '/x "' + self.m + '/0. DRAFT/x.md"',
                        "cd " + t + "; rm -f v.png", "cd " + t + " && rm -f ~/v.png", "rm -f " + t + "/.?/.?/v"):
            with self.subTest(command=command):
                self.assertDenied(self.call("Bash", command))

    def test_empty_rmdir_is_allowed_unchanged(self):
        self.assertAllowedSilently(self.call("Bash", 'rmdir "' + self.m + '/0. DRAFT/empty"'))

    def test_non_shell_tool_is_allowed(self):
        payload = {"tool_name": "Edit", "tool_input": {"file_path": self.m + "/x.md"}, "cwd": self.m}
        self.assertAllowedSilently(self.run_hook(json.dumps(payload)))


class DenyTests(HookTestCase):
    def test_unparseable_or_protected_deletes_are_denied(self):
        cases = {
            "glob": 'rm "' + self.m + '/0. DRAFT/*.md"',
            "chain": "cd x && rm y",
            "find -delete": "find . -delete",
            "already in TRASH": 'rm "' + self.m + '/TRASH/old.md"',
            "workspace root": 'rm -r "' + self.m + '"',
            "marker": 'rm "' + self.m + '/coclerk.json"',
            "unlisted flag": 'rm -i "' + self.m + '/0. DRAFT/x.md"',
            "relative path": "rm x.md",
        }
        for name, command in cases.items():
            with self.subTest(case=name):
                self.assertDenied(self.call("Bash", command, cwd=self.matter))

    def test_device_bash_outside_the_mount_is_denied(self):
        for command in ('rm "' + DEVICE_ROOT + '/TRASH/old.md"', 'rm -r "' + DEVICE_ROOT + '"'):
            with self.subTest(command=command):
                self.assertDenied(self.call(DEVICE, command))

    def test_powershell_remove_item_is_denied(self):
        self.assertDenied(self.call("PowerShell", 'Remove-Item "' + self.m + '/x"'))

    def test_malformed_input_fails_open_loudly(self):
        result = self.run_hook("not json")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout.strip(), "")
        self.assertIn("hook error", result.stderr)


class NestedQuoteTests(HookTestCase):
    """A path inside a nested-quote command substitution is split so its token
    ends in a quote; left on, it pushes a worktree root up to its parent (#695)."""

    def test_extracted_paths_have_no_trailing_quote(self):
        spec = importlib.util.spec_from_file_location("redirect_delete_to_trash", HOOK)
        hook = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(hook)
        double = 'git remote set-url origin "$(cd "$HOME/Git/repo" && git remote get-url origin)"'
        for command in (double, "git remote set-url origin \"$(cd '$HOME/Git/repo' && git remote get-url origin)\""):
            with self.subTest(command=command):
                for path in hook.extract_abs_paths(command):
                    self.assertFalse(str(path).endswith(('"', "'")), path)
        self.assertIn(Path(os.path.expanduser("~")) / "Git" / "repo", hook.extract_abs_paths(double))

    def test_worktree_root_in_nested_quotes_is_inside_the_worktree(self):
        target = (self.ostemp / "whatever").as_posix()
        root = self.repo.as_posix()
        for inner in ('"' + root + '"', "'" + root + "'"):
            command = ('rm "' + target + '" && git remote set-url origin "$(cd ' + inner
                       + ' && git remote get-url origin)"')
            with self.subTest(command=command):
                self.assertAllowedSilently(self.call("Bash", command, cwd=self.repo))

    def test_quoted_target_outside_worktree_and_temp_is_still_denied(self):
        self.assertDenied(self.call("Bash", 'rm "' + self.home.as_posix() + '/x"', cwd=self.repo))


class WindowsShellGateTests(HookTestCase):
    """del/erase and Remove-Item/ri count on the PowerShell tool always, and on
    Bash/device_bash only when the command invokes a Windows shell (#540)."""

    BASH_MUST_BLOCK = [
        "cmd /c del x",
        "cmd //c del x",
        "MSYS_NO_PATHCONV=1 cmd /q/c del x",
        "cmd.exe /k erase x",
        "cmd /r del x",
        "CMD /C DEL X",
        "C:/Windows/System32/cmd.exe /c del x",
        "/c/Windows/System32/cmd.exe /c del x",
        'cmd /c "del x"',
        "cd y && cmd /c del x",
        "echo $(cmd /c del x)",
        "echo 'del x' | cmd",
        "cmd <<'EOF'\ndel x\nEOF",
        "cmd /c rd /s /q d",
        "cmd /c rmdir /s /q d",
        "cmd /c ri x",
        "Start-Process cmd -ArgumentList '/c del x'",
        "pwsh -Command del x",
        "pwsh -c del x",
        "powershell del x",
        'powershell -Command "del x"',
        "pwsh -NoProfile -Command del x",
        "pwsh -NoProfile -ExecutionPolicy Bypass -Command del x",
        "powershell -ep Bypass -c del x",
        "pwsh -Command '& {del x}'",
        "Start-Process pwsh -ArgumentList '-c del x'",
        "echo 'del x' | pwsh",
        "MSYS_NO_PATHCONV=1 pwsh -c del x",
        "timeout 5 pwsh -Command del x",
        "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -Command del x",
        "pwsh -Command ri x",
        "pwsh -Command Remove-Item -Recurse x",
        "pwsh -Command rm -r x",
        # An installed shell path needs quoting, and $COMSPEC/%COMSPEC% are cmd
        # under another name. The quote anchor used to catch these; the shell
        # gate has to catch them now.
        '"C:/Program Files/PowerShell/7/pwsh.exe" -c del x',
        '"C:/Program Files/PowerShell/7/pwsh.exe" -Command "Remove-Item x"',
        "'/c/Program Files/PowerShell/7/pwsh.exe' -NoProfile -c 'ri x'",
        '"C:/Windows/System32/cmd.exe" /c del x',
        '"powershell.exe" -Command del x',
        "'pwsh' -c 'del x'",
        "$COMSPEC /c del x",
        '"$COMSPEC" /c del x',
        "%COMSPEC% /c del x",
        # cmd.exe takes its switches in any case and glued to a neighbour.
        "cmd /c rd /S /Q d",
        "cmd /c rd /s/q d",
        "cmd /c rd /q /s d",
        'cmd /c rmdir /S /Q "C:/m/d"',
        # rimraf names nothing but a recursive delete, wherever it appears.
        "npx rimraf dist",
        "pnpm exec rimraf build",
    ]
    POWERSHELL_MUST_BLOCK = [
        "del x",
        "ri x",
        "Remove-Item x",
        "rm x",
        "rd -Recurse x",
        "cmd /c del x",
        "cmd /c rd /S /Q d",
        '& "C:/Program Files/PowerShell/7/pwsh.exe" -c del x',
        "[IO.File]::Delete('x')",
    ]
    HEREDOC_ALIASES = [
        "python - <<'EOF'\nL = list(range(20))\ndel L[4:12]\nEOF",
        "python - <<'EOF'\nerase = 1\nEOF",
        "python - <<'EOF'\nri = 5\nEOF",
    ]
    BASH_MUST_ALLOW = HEREDOC_ALIASES + [
        'python -c "del d[0]"',
        "echo 'del me'",
        'echo "pwsh rm"',
        "git commit -m 'pwsh rm'",
        "grep -rn 'pwsh' src | grep rm",
        "cat <<'EOF' > notes.md\nThe PowerShell tool is separate.\nwe never rm -rf here\nEOF",
        "cmd //c dir",
        "cmd /c rd emptydir",
        "pwsh -Command Get-Content form.txt",
        "gcc -c ri.c",
        "ls /c rm",
        "docker run --rm img",
    ]
    POWERSHELL_MUST_ALLOW = ["$ri = 5", "Get-ChildItem -Filter ri*"]

    def test_bash_windows_shell_deletes_are_denied(self):
        for command in self.BASH_MUST_BLOCK:
            with self.subTest(command=command):
                self.assertDenied(self.call("Bash", command, cwd=self.matter))

    def test_powershell_tool_deletes_are_denied(self):
        for command in self.POWERSHELL_MUST_BLOCK:
            with self.subTest(command=command):
                self.assertDenied(self.call("PowerShell", command, cwd=self.matter))

    def test_device_bash_windows_shell_delete_is_denied(self):
        self.assertDenied(self.call(DEVICE, "pwsh -c del x"))

    def test_bash_non_deletes_are_allowed(self):
        for command in self.BASH_MUST_ALLOW:
            with self.subTest(command=command):
                self.assertAllowedSilently(self.call("Bash", command, cwd=self.matter))

    def test_device_bash_heredoc_aliases_are_allowed(self):
        for command in self.HEREDOC_ALIASES:
            with self.subTest(command=command):
                self.assertAllowedSilently(self.call(DEVICE, command))

    def test_powershell_non_deletes_are_allowed(self):
        for command in self.POWERSHELL_MUST_ALLOW:
            with self.subTest(command=command):
                self.assertAllowedSilently(self.call("PowerShell", command, cwd=self.matter))

    def test_empty_rmdir_in_matter_cwd_is_allowed(self):
        self.assertAllowedSilently(self.call("Bash", 'rmdir "' + self.m + '/0. DRAFT/empty"', cwd=self.matter))

    def test_shell_gate_scan_is_linear(self):
        spec = importlib.util.spec_from_file_location("redirect_delete_to_trash", HOOK)
        hook = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(hook)
        start = time.perf_counter()
        hook.find_destructive("cmd /x " * 5000, "Bash")
        self.assertLess(time.perf_counter() - start, 1.0)


class CommandPositionTests(HookTestCase):
    """A delete counts wherever the shell would really run it: inside a loop or
    conditional body, inside a brace group or script block, behind `time`, or
    written `\\rm` to skip an alias (#632). Each blocked form is paired with a
    look-alike that must stay allowed -- brace expansion, a variable reference,
    a hashtable, or the same words sitting in prose."""

    BASH_MUST_BLOCK = [
        'for f in *.tmp; do rm "$f"; done',
        'for f in *.tmp\ndo\n  rm "$f"\ndone',
        'while read f; do unlink "$f"; done',
        "if [ -f x ]; then rm x; fi",
        "if [ -f x ]; then true; else rm x; fi",
        "{ rm x; }",
        "ls && { rm x; }",
        "\\rm -rf x",
        "sudo \\rm x",
        "time rm x",
    ]
    BASH_MUST_ALLOW = [
        "echo {rm,ls}",                          # brace expansion, not a group
        'echo "${rm}"',
        'mv a.txt "${rmdir_name}/b.txt"',
        'python -c "d = {}; print(d)"',
        'for f in *; ' + 'do echo "$f"; done',   # a loop that deletes nothing
        'git commit -m "things to ' + 'do rm the old files"',   # prose, not a loop
        'echo "run ' + 'time rm here"',                         # prose, not a wrapper
    ]
    POWERSHELL_MUST_BLOCK = [
        "if ($true) {Remove-Item x}",
        "Get-ChildItem *.tmp | ForEach-Object { Remove-Item $_ }",
        "gci | % {ri $_}",
        "foreach ($f in $files) { del $f }",
    ]
    POWERSHELL_MUST_ALLOW = [
        "$h = @{rm = 1}",                        # hashtable key, not a block
        'Write-Host "${rm}"',
    ]

    def test_bash_command_position_deletes_are_denied(self):
        for command in self.BASH_MUST_BLOCK:
            with self.subTest(command=command):
                self.assertDenied(self.call("Bash", command, cwd=self.matter))

    def test_bash_look_alikes_are_allowed(self):
        for command in self.BASH_MUST_ALLOW:
            with self.subTest(command=command):
                self.assertAllowedSilently(self.call("Bash", command, cwd=self.matter))

    def test_powershell_script_block_deletes_are_denied(self):
        for command in self.POWERSHELL_MUST_BLOCK:
            with self.subTest(command=command):
                self.assertDenied(self.call("PowerShell", command, cwd=self.matter))

    def test_powershell_look_alikes_are_allowed(self):
        for command in self.POWERSHELL_MUST_ALLOW:
            with self.subTest(command=command):
                self.assertAllowedSilently(self.call("PowerShell", command, cwd=self.matter))

    def test_bash_brace_group_needs_a_space_powershell_block_does_not(self):
        spec = importlib.util.spec_from_file_location("redirect_delete_to_trash", HOOK)
        hook = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(hook)
        self.assertIsNone(hook.find_destructive("{rm x}", "Bash"))
        self.assertIsNotNone(hook.find_destructive("{ri x}", "PowerShell"))


class StoredTextTests(HookTestCase):
    """Text that is only stored -- a quoted heredoc fed to cat, tee, a git
    commit message or a gh body -- supplies neither the delete label nor the
    location (#643). Each allowed form is paired with the executable form of
    the same text, which must still be denied."""

    PWSH = '"C:/Program Files/PowerShell/7/pwsh.exe"'
    STORED_MUST_ALLOW = [
        "cat > notes.md <<'EOF'\nRun " + PWSH + ' -c "ri old.txt" to clean up.\nEOF',
        'cat <<"EOF" > notes.md\ncmd /c del x\nEOF',
        "tee notes.md <<'EOF'\nrm -rf x\nEOF",
        "git commit -F - <<'EOF'\nStop the %COMSPEC% /c del fallback.\nEOF",
        "git commit --file=- <<'EOF'\npwsh -c del x\nEOF",
        'git commit -m "$(cat <<\'EOF\'\nDrop the pwsh -c ri x fallback.\nEOF\n)"',
        "gh issue comment 1 --body-file - <<'EOF'\nnpx rimraf dist\nEOF",
        "gh pr comment 1 -F - <<'EOF'\ncmd /c del x\nEOF",
        "cat > a.md <<'A'\nrm -rf x\nA\ncat > b.md <<'B'\ndel y | cmd\nB",
    ]
    EXECUTED_MUST_BLOCK = [
        PWSH + ' -c "ri old.txt"',
        "cmd /c del x",
        "rm -rf x",
        "%COMSPEC% /c del x",
        "npx rimraf dist",
        # Interpreters run their heredoc: script text, not data (#645 boundary).
        "bash <<'EOF'\nrm -rf x\nEOF",
        "pwsh -Command - <<'EOF'\ndel x\nEOF",
        "python - <<'PY'\nimport shutil; shutil.rmtree('x')\nPY",
        'bash -c "$(cat <<\'EOF\'\npwsh -c del x\nEOF\n)"',
        # A stored heredoc followed by a real delete.
        "cat > notes.md <<'EOF'\nbenign\nEOF\nrm -rf x",
        "python - <<'PY'\nsubprocess.run(['npx', 'rimraf', 'x'])\nPY",
        # cat piped or process-substituted into a shell runs the body.
        "cat <<'EOF' | bash\nrm -rf x\nEOF",
        "cat <<'EOF' > >(bash)\nrm -rf x\nEOF",
        "tee <<'EOF' >(bash)\nrm -rf x\nEOF",
        # A backgrounded sink does not make the next command a sink.
        "cat /dev/null & bash <<'EOF'\nrm -rf x\nEOF",
        "git commit -F - & bash <<'EOF'\nrm -rf x\nEOF",
        'gh --version & bash -c "$(cat <<\'EOF\'\nrm -rf x\nEOF\n)"',
        # Unclear forms keep today's full scan.
        "cat > f <<EOF\n$(rm -rf x)\nEOF",
        "cat > f <<-'EOF'\n\trm -rf x\n\tEOF",
        "cat > f <<'EOF'\nrm -rf x",
        "cat > a <<'A'; bash <<'B'\nA\nrm -rf x\nB",
    ]

    def test_stored_text_is_allowed(self):
        for tool in ("Bash", DEVICE):
            for command in self.STORED_MUST_ALLOW:
                with self.subTest(tool=tool, command=command):
                    self.assertAllowedSilently(self.call(tool, command, cwd=self.matter))

    def test_executed_text_is_denied(self):
        for command in self.EXECUTED_MUST_BLOCK:
            with self.subTest(command=command):
                self.assertDenied(self.call("Bash", command, cwd=self.matter))

    def test_comspec_in_prose_names_no_location(self):
        # From a worktree cwd, %COMSPEC% used to expand into C:\WINDOWS\system32\cmd.exe.
        self.assertAllowedSilently(self.call("Bash", 'git commit -m "no %COMSPEC% /c del x"', cwd=self.repo))

    def test_home_forms_still_locate_a_delete(self):
        for target in ("%USERPROFILE%/x", "%userprofile%/x", "%HOME%/x", "$HOME/x", "${HOME}/x",
                       "$USERPROFILE/x", "${USERPROFILE}/x", "~/x"):
            with self.subTest(target=target):
                self.assertDenied(self.call("Bash", 'cmd /c del "' + target + '"', cwd=self.repo))

    def test_shell_binary_path_is_not_a_location(self):
        self.assertAllowedSilently(self.call("Bash", self.PWSH + ' -c "ri build/old.log"', cwd=self.repo))
        out = self.decision(self.call("Bash", self.PWSH + ' -c "ri ' + self.m + '/0. DRAFT/x.md"', cwd=self.repo))
        self.assertEqual(out["permissionDecision"], "deny")
        self.assertNotIn("pwsh.exe", out["permissionDecisionReason"])

    def test_shell_binary_does_not_hide_the_target(self):
        target = self.m + "/0. DRAFT/x.md"
        for command in ('cmd /c "C:/Windows/System32/cmd.exe /c del ' + target + '"',
                        'pwsh -c "C:/Windows/System32/cmd.exe /c del ' + target + '"'):
            with self.subTest(command=command):
                self.assertDenied(self.call("Bash", command, cwd=self.repo))

    def test_path_entry_is_not_a_location(self):
        for entry in ('"/c/Program Files/dotnet:$PATH"', '"C:/Program Files/dotnet:${PATH}"'):
            with self.subTest(entry=entry):
                self.assertAllowedSilently(
                    self.call("Bash", "export PATH=" + entry + "\nrm -rf build", cwd=self.repo))

    def test_path_entry_does_not_hide_the_target(self):
        command = 'export PATH="/c/Program Files/dotnet:$PATH"\nrm -rf "' + self.m + '/0. DRAFT"'
        self.assertDenied(self.call("Bash", command, cwd=self.repo))


def encode(text):
    return base64.b64encode(text.encode("utf-16-le")).decode("ascii")


class HiddenTextTests(HookTestCase):
    """Text a command runs without spelling it out (#645): a shell script it
    runs is read and scanned one level deep, and an -EncodedCommand payload is
    decoded and scanned. Each deny form is paired with a benign look-alike."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        empty = cls.m + "/0. DRAFT/empty"
        scripts = {
            "cleanup.ps1": 'Remove-Item -Recurse "0. DRAFT/empty"',
            "read.ps1": "Get-ChildItem .",
            "cleanup.sh": 'rm -rf "0. DRAFT/empty"',
            "read.sh": "ls",
            "cleanup.bat": 'rd /s /q "0. DRAFT\\empty"',
            "read.bat": "dir",
        }
        for name, text in scripts.items():
            (cls.matter / name).write_text(text, encoding="utf-8")
        (cls.matter / "wide.ps1").write_bytes(
            codecs.BOM_UTF16_LE + ("Remove-Item -Recurse '" + empty + "'").encode("utf-16-le"))
        (cls.matter / "odd.ps1").write_bytes(b"Get-ChildItem \xff\xfe .")
        # In the repo, but its delete names a matter path.
        (cls.repo / "reach.ps1").write_text('Remove-Item -Recurse "' + empty + '"', encoding="utf-8")
        (cls.repo / "reach-read.ps1").write_text('Get-ChildItem "' + empty + '"', encoding="utf-8")

    SCRIPT_RUNS = [
        ("Bash", "pwsh -File {}.ps1"),
        ("Bash", "pwsh -f {}.ps1"),
        ("Bash", 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{}.ps1"'),
        ("Bash", "bash {}.sh"),
        ("Bash", "sh -e ./{}.sh"),
        ("Bash", "./{}.sh"),
        ("Bash", "source {}.sh"),
        ("Bash", ". ./{}.sh"),
        ("Bash", "ls && bash {}.sh"),
        ("Bash", "cmd /c {}.bat"),
        ("Bash", "cmd //c call {}.bat"),
        ("PowerShell", "& ./{}.ps1"),
        ("PowerShell", '& "{}.ps1"'),
        ("PowerShell", ". .\\{}.ps1"),
        ("PowerShell", ".\\{}.ps1"),
        ("PowerShell", "pwsh -File {}.ps1"),
        ("PowerShell", "cmd /c {}.bat"),
        ("Bash", "sudo ./{}.sh"),
        ("Bash", "nohup bash {}.sh"),
        ("Bash", "timeout 60 bash {}.sh"),
        ("Bash", "DEBUG=1 bash {}.sh"),
        ("Bash", "if true; then bash {}.sh; fi"),
    ]

    def test_script_that_deletes_is_denied(self):
        for tool, form in self.SCRIPT_RUNS:
            with self.subTest(tool=tool, form=form):
                self.assertDenied(self.call(tool, form.format("cleanup"), cwd=self.matter))

    def test_script_that_only_reads_is_allowed(self):
        for tool, form in self.SCRIPT_RUNS:
            with self.subTest(tool=tool, form=form):
                self.assertAllowedSilently(self.call(tool, form.format("read"), cwd=self.matter))

    def test_absolute_script_path_is_read(self):
        self.assertDenied(self.call("Bash", 'bash "' + self.m + '/cleanup.sh"', cwd=self.repo))
        self.assertAllowedSilently(self.call("Bash", 'bash "' + self.m + '/read.sh"', cwd=self.repo))

    def test_script_text_supplies_the_location(self):
        r = self.repo.as_posix()
        self.assertDenied(self.call("Bash", "pwsh -File " + r + "/reach.ps1", cwd=self.repo))
        self.assertAllowedSilently(self.call("Bash", "pwsh -File " + r + "/reach-read.ps1", cwd=self.repo))

    def test_script_encodings_are_read_leniently(self):
        self.assertDenied(self.call("PowerShell", "& ./wide.ps1", cwd=self.matter))
        self.assertAllowedSilently(self.call("PowerShell", "& ./odd.ps1", cwd=self.matter))

    def test_missing_script_is_allowed(self):
        self.assertAllowedSilently(self.call("Bash", "bash ./missing.sh", cwd=self.matter))

    def test_script_that_is_only_named_is_not_read(self):
        for tool, command in (("Bash", "cat cleanup.sh"), ("Bash", "git add cleanup.ps1"),
                              ("Bash", 'echo "run ./cleanup.sh later"'),
                              ("PowerShell", "Get-Content cleanup.ps1")):
            with self.subTest(command=command):
                self.assertAllowedSilently(self.call(tool, command, cwd=self.matter))

    def lock(self, path):
        """Hold path unreadable to the hook's process until the handle closes."""
        path.write_text("ls", encoding="utf-8")
        handle = open(path, "rb+")
        self.addCleanup(handle.close)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            os.chmod(path, 0)

    def test_unreadable_script_is_treated_as_a_delete(self):
        self.lock(self.matter / "locked.sh")
        self.lock(self.repo / "locked.sh")
        self.assertDenied(self.call("Bash", "bash ./locked.sh", cwd=self.matter))
        self.assertAllowedSilently(self.call("Bash", "bash ./locked.sh", cwd=self.repo))

    ENCODED_FLAGS = ["-EncodedCommand", "-encodedcommand", "-enc", "-e", "-ec", "-encoded", "/enc"]

    def test_encoded_delete_is_denied(self):
        payload = encode('Remove-Item -Recurse "' + self.m + '/0. DRAFT/empty"')
        for tool in ("Bash", "PowerShell"):
            for flag in self.ENCODED_FLAGS:
                with self.subTest(tool=tool, flag=flag):
                    self.assertDenied(self.call(tool, "pwsh -NoProfile " + flag + " " + payload, cwd=self.repo))

    def test_encoded_non_delete_is_allowed(self):
        payload = encode('Get-ChildItem "' + self.m + '/0. DRAFT"')
        for tool in ("Bash", "PowerShell"):
            for flag in self.ENCODED_FLAGS:
                with self.subTest(tool=tool, flag=flag):
                    self.assertAllowedSilently(self.call(tool, "powershell.exe " + flag + " " + payload,
                                                         cwd=self.matter))

    def test_encoded_switch_look_alikes_are_allowed(self):
        for tool, command in (("Bash", 'pwsh -Command "Set-Content out.txt -Value hi -Enc utf8"'),
                              ("Bash", 'echo "use pwsh -e foo"'),
                              ("Bash", 'git commit -m "pwsh -e flag"'),
                              ("PowerShell", "pwsh -File read.ps1 -e notbase64")):
            with self.subTest(command=command):
                self.assertAllowedSilently(self.call(tool, command, cwd=self.matter))

    def test_encoded_payload_supplies_the_location(self):
        payload = encode('Remove-Item -Recurse "' + self.m + '/0. DRAFT/empty"')
        self.assertDenied(self.call("Bash", "rm -rf build; pwsh -enc " + payload, cwd=self.repo))

    def test_undecodable_payload_is_treated_as_a_delete(self):
        for payload in ("not*base64", "QQ=="):      # bad base64; one byte is not UTF-16LE
            with self.subTest(payload=payload):
                self.assertDenied(self.call("Bash", "pwsh -enc " + payload, cwd=self.matter))
                self.assertAllowedSilently(self.call("Bash", "pwsh -enc " + payload, cwd=self.repo))

    def test_device_bash_script_run_is_denied(self):
        for command in ('bash "' + DEVICE_ROOT + '/read.sh"', "pwsh -File read.ps1", "cmd /c read.bat",
                        "./read.sh"):
            with self.subTest(command=command):
                self.assertDenied(self.call(DEVICE, command))

    def test_hidden_text_scan_is_linear(self):
        spec = importlib.util.spec_from_file_location("redirect_delete_to_trash", HOOK)
        hook = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(hook)
        start = time.perf_counter()
        hook.reveal_hidden("(pwsh a.b " * 5000, "Bash", self.repo)
        self.assertLess(time.perf_counter() - start, 1.0)

    def test_device_bash_encoded_command_is_decoded(self):
        self.assertAllowedSilently(self.call(DEVICE, "pwsh -enc " + encode("Get-ChildItem .")))
        self.assertDenied(self.call(DEVICE, "pwsh -enc " + encode("Remove-Item x")))


class PluginRegistrationTests(unittest.TestCase):
    def test_plugin_matcher_covers_shell_and_device_tools(self):
        manifest = json.loads(PLUGIN_JSON.read_text(encoding="utf-8"))
        entries = [
            entry for entry in manifest["hooks"]["PreToolUse"]
            if any(PLUGIN_HOOK_ARG in h.get("args", []) for h in entry["hooks"])
        ]
        self.assertEqual(len(entries), 1)
        matcher = re.compile(entries[0]["matcher"])
        for name in ("Bash", "PowerShell", DEVICE, "mcp__foo__device_bash"):
            self.assertTrue(matcher.fullmatch(name), name)
        self.assertFalse(matcher.fullmatch("mcp__plugin_practice_data__case_data__query"))


if __name__ == "__main__":
    unittest.main()
