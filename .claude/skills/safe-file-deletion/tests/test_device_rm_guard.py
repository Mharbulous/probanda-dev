"""device_bash: a lone non-recursive rm outside the matter folders is allowed,
rewritten so the device itself refuses any target whose parent directory lands
in or above $HOME/mnt before rm runs. Everything else on device_bash keeps
today's path: the mount soft-delete rewrite, or a deny.
"""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from test_redirect_delete_to_trash import DEVICE, HookTestCase


BASH = shutil.which("bash")


IN_MATTER = 'builtin echo "refused: $r is in a matter folder; use the file-manager trash tool" >&2; builtin exit 1'


def guarded(listed, flags="-f ", cd=""):
    """The rewrite the hook must emit, spelled out independently of the hook."""
    return (
        "( builtin unset -f rm realpath dirname basename cd unset exit echo test 2>/dev/null; "
        "unalias -a 2>/dev/null; "
        + cd
        + 'm=$(command -p realpath -m -- "$HOME/mnt") && ok=() && for t in ' + listed + "; do "
        'd=$(command -p dirname -- "$t") && r=$(command -p realpath -m -- "$d") || builtin exit 1; '
        'r="${r%/}"; '
        'if [[ -z $r ]]; then builtin echo "refused: / is above the matter folders; use the file-manager trash tool" >&2; '
        "builtin exit 1; fi; "
        'case "$r/" in "$m/"*) ' + IN_MATTER + ";; esac; "
        'case "$m/" in "$r/"*) builtin echo "refused: $r is above the matter folders; use the file-manager trash tool" >&2; '
        "builtin exit 1;; esac; "
        'for e in "$HOME"/mnt/*; do em=$(command -p realpath -m -- "$e") || builtin exit 1; '
        'em="${em%/}"; case "$r/" in "$em/"*) ' + IN_MATTER + ";; esac; done; "
        'ok+=("$t"); '
        "done && command -p rm " + flags + '-- "${ok[@]}" )'
    )


class DeviceRmRewriteTests(HookTestCase):
    def test_exact_rewrite_for_bare_target(self):
        command = "rm -f g-1.png"
        extra = {"description": "Clear OCR scratch"}
        expected = (
            "( builtin unset -f rm realpath dirname basename cd unset exit echo test 2>/dev/null; "
            'unalias -a 2>/dev/null; m=$(command -p realpath -m -- "$HOME/mnt") && ok=() && for t in g-1.png; '
            'do d=$(command -p dirname -- "$t") && r=$(command -p realpath -m -- "$d") || builtin exit 1; '
            'r="${r%/}"; if [[ -z $r ]]; then builtin echo "refused: / is above the matter folders; use '
            'the file-manager trash tool" >&2; builtin exit 1; fi; case "$r/" in "$m/"*) builtin echo "refused: $r is in '
            'a matter folder; use the file-manager trash tool" >&2; builtin exit 1;; esac; case "$m/" in "$r/"*) builtin '
            'echo "refused: $r is above the matter folders; use the file-manager trash tool" >&2; builtin exit 1;; esac; '
            'for e in "$HOME"/mnt/*; do em=$(command -p realpath -m -- "$e") || builtin exit 1; '
            'em="${em%/}"; case "$r/" in "$em/"*) builtin echo "refused: $r is in a matter folder; use '
            'the file-manager trash tool" >&2; builtin exit 1;; esac; done; ok+=("$t"); done && '
            'command -p rm -f -- "${ok[@]}" )'
        )
        self.assertRewritten(self.call(DEVICE, command, **extra), expected, {"command": command, **extra})

    def test_rewrite_keeps_each_target_quoting(self):
        cases = {
            "rm -f g-*": guarded("g-*"),
            "rm 'a b.txt'": guarded("'a b.txt'", flags=""),
            'rm --force "$HOME/ocr/a b.txt"': guarded('"$HOME/ocr/a b.txt"', flags="--force "),
            "rm -f ~/ocr/g-*.png /tmp/x": guarded("~/ocr/g-*.png /tmp/x"),
            "rm x -f": guarded("x"),
            "cd $HOME/ocr && rm -f g-*": guarded("g-*", cd="cd $HOME/ocr && "),
            "cd 'my dir' && rm a": guarded("a", flags="", cd="cd 'my dir' && "),
        }
        for command, expected in cases.items():
            with self.subTest(command=command):
                self.assertRewritten(self.call(DEVICE, command), expected, {"command": command})

    def test_ineligible_commands_stay_denied(self):
        for command in (
            "rm -r x", "rm -rf x", "rm -fr x", "rm -R x", "rm --recursive x", "rm -i x", "rm -f -- x",
            "rm -f", "rm -f '-r' x", "unlink x",
            "cd $HOME/mnt && rm -f x", "cd $HOME/mnt/L1 && rm -f x", "cd ~/mnt/L1 && rm -f x",
            'cd "$HOME/mnt/L1" && rm -f x', "\\rm x", '"rm" x',
            "rm -f a; rm -f b", "rm -f a && echo done", "cd x && rm -f a && echo done", "echo hi && rm -f a",
            "rm -f $VAR", 'rm -f "$TMP/x"', "rm -f `ls`", "rm -f {a,b}", "rm -f 'a{b'", "rm -f ~user/x",
            "rm -f '~/x'", "rm -f #x", "cd $D && rm -f x",
            "rm -f $HOME/mnt/L1", "rm -f ~/mnt", 'rm -f "$HOME/mnt/L1/x*.md"', "rm -f ~/mnt/L1/*",
            "bash x.sh", "./x.sh",
        ):
            with self.subTest(command=command):
                self.assertDenied(self.call(DEVICE, command))

    def test_mount_file_is_denied_not_moved(self):
        # Moving a file to TRASH is file-manager's file_ops__trash, never the hook's.
        self.assertDenied(self.call(DEVICE, 'rm "$HOME/mnt/L1/keep.txt"'))


class DeviceRmExecutionTests(HookTestCase):
    """Runs the rewritten command in a real bash with HOME set to a fixture
    holding mnt/L1/keep.txt, a scratch dir, and scratch/link -> mnt/L1."""

    def setUp(self):
        if BASH is None:
            self.fail("bash not found on PATH: the device rewrite cannot be executed")
        self.dev = Path(tempfile.mkdtemp(prefix="coclerk-device-home-"))
        self.keep = self.dev / "mnt" / "L1" / "keep.txt"
        self.keep.parent.mkdir(parents=True)
        self.keep.write_text("keep", encoding="utf-8")
        self.scratch = self.dev / "scratch"
        self.scratch.mkdir()
        self.link = self.scratch / "link"
        self.make_link(self.keep.parent, self.link)
        # A matter folder that is itself a link to a real mount outside HOME.
        self.outside = Path(tempfile.mkdtemp(prefix="coclerk-device-mount-"))
        self.outside_keep = self.outside / "keep.txt"
        self.outside_keep.write_text("keep", encoding="utf-8")
        self.mount_link = self.dev / "mnt" / "L2"
        self.make_link(self.outside, self.mount_link)
        self.device_env = {**os.environ, "HOME": str(self.dev)}

    @staticmethod
    def make_link(target, link):
        try:
            os.symlink(target, link, target_is_directory=True)
        except OSError:
            if os.name != "nt":
                raise
            import _winapi
            _winapi.CreateJunction(str(target), str(link))

    def tearDown(self):
        for link in (self.link, self.mount_link):
            try:
                os.unlink(link)
            except OSError:
                os.rmdir(link)           # a directory link or junction on Windows
        shutil.rmtree(self.dev)          # test fixtures under the OS temp dir
        shutil.rmtree(self.outside)

    def run_on_device(self, command):
        out = self.decision(self.call(DEVICE, command))
        self.assertEqual(out["permissionDecision"], "allow", out)
        return subprocess.run([BASH, "-c", out["updatedInput"]["command"]], cwd=self.dev,
                              env=self.device_env, capture_output=True, text=True)

    def assertRefused(self, command):
        result = self.run_on_device(command)
        self.assertNotEqual(result.returncode, 0, result.stderr)
        self.assertIn("refused:", result.stderr)
        self.assertIn("use the file-manager trash tool", result.stderr)
        self.assertTrue(self.keep.exists(), command)

    def test_scratch_delete_succeeds(self):
        for name in ("junk-1.png", "junk-2.png", "plain.txt"):
            (self.scratch / name).write_text("x", encoding="utf-8")
        for command in ("rm -f scratch/junk-*", "cd scratch && rm plain.txt"):
            with self.subTest(command=command):
                result = self.run_on_device(command)
                self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sorted(p.name for p in self.scratch.iterdir()), ["link"])
        self.assertTrue(self.keep.exists())

    def test_link_into_matter_folder_is_refused(self):
        self.assertRefused("rm -f scratch/link/keep.txt")

    def test_dot_dot_into_matter_folder_is_refused(self):
        self.assertRefused("rm -f scratch/../mnt/L1/keep.txt")

    def test_glob_through_link_is_refused(self):
        self.assertRefused("rm -f scratch/link/*.txt")

    def test_mount_spelled_without_home_prefix_is_refused(self):
        for command in ("rm -f ./mnt/L1/keep.txt", "rm -f $HOME/mn*/L1/keep.txt"):
            with self.subTest(command=command):
                self.assertRefused(command)

    def test_real_location_of_a_linked_matter_folder_is_refused(self):
        # Spelled as the test shell itself spells it: MSYS realpath leaves a
        # C:/ path as written, so on Windows the path is converted with cygpath.
        target = self.outside_keep.as_posix()
        if os.name == "nt":
            target = subprocess.run([BASH, "-c", 'cygpath -u "$1"', "_", str(self.outside_keep)],
                                    capture_output=True, text=True, check=True).stdout.strip()
        self.assertRefused("rm -f " + target)
        self.assertTrue(self.outside_keep.exists())

    def test_home_itself_is_refused(self):
        for command in ('rm -f "$HOME/"', "rm -f ~/"):
            with self.subTest(command=command):
                self.assertRefused(command)
        self.assertTrue(self.dev.is_dir())

    def test_cd_into_link_is_refused(self):
        self.assertRefused("cd scratch/link && rm -f keep.txt")


if __name__ == "__main__":
    unittest.main()
