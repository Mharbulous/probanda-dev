"""#1411: the temp-dir and worktree exemptions follow where a path really lands.

A link under temp or a worktree that points elsewhere, a `~name` home
reference, a symlinked temp dir and an 8.3 short temp path are all judged
after resolution, by rm's own rule: a trailing slash or /. follows the link,
otherwise only the parent is resolved.
"""
import contextlib
import importlib.util
import io
import json
import os
import unittest
from unittest import mock

from test_redirect_delete_to_trash import HOOK, HookTestCase


def make_link(link, target):
    try:
        os.symlink(target, link, target_is_directory=True)
    except OSError:                     # Windows without symlink rights: a junction
        import _winapi
        _winapi.CreateJunction(str(target), str(link))


def remove_link(link):
    if os.name == "nt":
        os.rmdir(link)                  # removes the link or junction, not its target
    else:
        os.unlink(link)


def short_path(path):
    import ctypes
    buf = ctypes.create_unicode_buffer(1024)
    ctypes.windll.kernel32.GetShortPathNameW(str(path), buf, 1024)
    return buf.value


class ResolvedLocationTests(HookTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.outside = cls.base / "outside"
        cls.outside.mkdir()
        (cls.outside / "keep.txt").write_text("x", encoding="utf-8")
        (cls.ostemp / "real.txt").write_text("x", encoding="utf-8")
        cls.tmp_alias = cls.base / "tmpalias"
        cls.links = [cls.ostemp / "link", cls.repo / "link"]
        for link in cls.links:
            make_link(link, cls.outside)
        make_link(cls.tmp_alias, cls.ostemp)
        # #1441: per root, a dir whose only entry is a link out, and plain dirs.
        cls.roots = (cls.ostemp, cls.repo)
        cls.glob_links = [root / "globlinks" / "link" for root in cls.roots]
        for root, link in zip(cls.roots, cls.glob_links):
            (root / "build").mkdir()
            (root / "[id]").mkdir()
            (root / "globplain" / "d").mkdir(parents=True)
            link.parent.mkdir()
            make_link(link, cls.outside)

    @classmethod
    def tearDownClass(cls):
        for link in cls.links + cls.glob_links + [cls.tmp_alias]:
            remove_link(link)
        super().tearDownClass()

    def with_temp(self, temp):
        self.env = {**self.env, "TEMP": str(temp), "TMP": str(temp), "TMPDIR": str(temp)}

    def assertNotAllowedUnchanged(self, result):
        out = self.decision(result)
        self.assertTrue(out["permissionDecision"] == "deny" or "updatedInput" in out, out)

    def test_followed_link_is_not_exempt(self):
        for link in self.links:
            for suffix in ("/", "/."):
                for cwd in (self.home, self.ostemp):
                    command = 'rm -rf "' + link.as_posix() + suffix + '"'
                    with self.subTest(command=command, cwd=cwd.name):
                        self.assertNotAllowedUnchanged(self.call("Bash", command, cwd=cwd))

    def test_link_itself_is_still_exempt(self):
        for link in self.links:
            for cwd in (self.home, self.ostemp):
                command = 'rm -rf "' + link.as_posix() + '"'
                with self.subTest(command=command, cwd=cwd.name):
                    self.assertAllowedSilently(self.call("Bash", command, cwd=cwd))

    def test_cd_then_followed_relative_link_is_not_exempt(self):
        command = 'cd "' + self.ostemp.as_posix() + '" && rm -rf link/'
        for cwd in (self.home, self.ostemp):
            with self.subTest(cwd=cwd.name):
                self.assertNotAllowedUnchanged(self.call("Bash", command, cwd=cwd))
        self.assertNotAllowedUnchanged(self.call("Bash", "rm -rf link/", cwd=self.ostemp))

    def test_chained_relative_followed_link_is_not_exempt(self):
        for root in self.roots:
            for command in ("rm -rf link/; true", "rm -rf link/ && echo done", "rm -rf globlinks/*/; true"):
                with self.subTest(command=command, cwd=root.name):
                    self.assertNotAllowedUnchanged(self.call("Bash", command, cwd=root))

    def test_glob_in_followed_component_is_not_exempt(self):
        for root in self.roots:
            d = (root / "globlinks").as_posix()
            for command in ("rm -rf " + d + "/*/", "rm -rf " + d + "/*/x", "find " + d + "/*/ -delete"):
                with self.subTest(command=command, cwd=root.name):
                    self.assertNotAllowedUnchanged(self.call("Bash", command, cwd=root))

    def test_glob_in_final_component_is_still_exempt(self):
        for root in self.roots:
            command = "rm -rf " + (root / "globlinks").as_posix() + "/*"
            with self.subTest(command=command):
                self.assertAllowedSilently(self.call("Bash", command, cwd=root))

    def test_chained_and_globbed_plain_deletes_are_unchanged(self):
        for root in self.roots:
            for command in ("rm -rf build/; true", "rm -rf build/ && echo done",
                            "rm -rf " + (root / "globplain").as_posix() + "/*/"):
                with self.subTest(command=command, cwd=root.name):
                    self.assertAllowedSilently(self.call("Bash", command, cwd=root))

    def test_targets_the_hook_cannot_tell_get_no_exemption(self):
        for command in ('"rm" -rf link/', "'rm' -rf link/", "rm -rf {link,build}/",
                        'rm -rf "$PWD/link/"; true', "builtin cd .. && rm -rf x", '"cd" .. && rm -rf x',
                        'echo "$(rm -rf link/)"', "ls | xargs rm", "cd ~ && rm -rf x"):
            with self.subTest(command=command):
                self.assertNotAllowedUnchanged(self.call("Bash", command, cwd=self.ostemp))

    def test_ordinary_chained_worktree_deletes_stay_allowed(self):
        for command in ('git commit -m "rm old files" -- x', "rm -f x 2>/dev/null",
                        "rm -rf build 2>&1 | tail -3", "cd build && rm -rf x", "rm -rf \\\n  build",
                        "rm -f " + self.repo.as_posix() + "/nothing-*.tmp; true", "rm -rf [id]/x; true",
                        'grep -rn "rm" src', "echo cd && rm -rf build", "X=$(cd build && pwd); rm -rf dist"):
            with self.subTest(command=command):
                self.assertAllowedSilently(self.call("Bash", command, cwd=self.repo))

    @unittest.skipIf(os.name == "nt", "Win32 collapses .. lexically, so it never climbs from a link target")
    def test_dotdot_after_link_climbs_from_its_target(self):
        command = 'rm -f "' + (self.ostemp / "link").as_posix() + '/../outside/keep.txt" ; true'
        self.assertNotAllowedUnchanged(self.call("Bash", command, cwd=self.ostemp))

    def test_tilde_name_from_temp_cwd_is_not_exempt(self):
        for command in ("rm -f ~root/x", "rm -rf ~Brahm/matter/x"):
            with self.subTest(command=command):
                self.assertNotAllowedUnchanged(self.call("Bash", command, cwd=self.ostemp))

    def test_unlinked_temp_and_worktree_deletes_are_unchanged(self):
        t = self.ostemp.as_posix()
        for command, cwd in (("rm -f " + t + "/real.txt", self.home),
                             ("rm -rf " + self.repo.as_posix() + "/build", self.home)):
            with self.subTest(command=command):
                self.assertAllowedSilently(self.call("Bash", command, cwd=cwd))
        home = self.ostemp / "h"
        self.env = {**self.env, "HOME": str(home), "USERPROFILE": str(home)}
        self.assertAllowedSilently(self.call("Bash", "rm -rf ~/build", cwd=self.ostemp))

    def test_symlinked_temp_dir_still_counts_as_temp(self):
        self.with_temp(self.tmp_alias)
        for target in (self.ostemp / "real.txt", self.tmp_alias / "real.txt"):
            with self.subTest(target=target):
                self.assertAllowedSilently(self.call("Bash", 'rm -f "' + target.as_posix() + '"'))

    @unittest.skipUnless(os.name == "nt", "8.3 short names are Windows-only")
    def test_short_and_long_temp_forms_match(self):
        short = short_path(self.ostemp).replace("\\", "/")
        long = self.ostemp.as_posix()
        if short.casefold() == long.casefold():
            self.skipTest("this volume has no 8.3 name for the fixture")
        for temp, target in ((short, long), (long, short)):
            self.with_temp(temp)
            with self.subTest(temp=temp):
                self.assertAllowedSilently(self.call("Bash", 'rm -f "' + target + '/real.txt"'))

    def test_resolution_error_is_not_exempt_and_does_not_fail_open(self):
        spec = importlib.util.spec_from_file_location("redirect_delete_to_trash", HOOK)
        hook = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(hook)
        payload = json.dumps({"tool_name": "Bash", "cwd": str(self.ostemp),
                              "tool_input": {"command": 'rm -f "' + self.ostemp.as_posix() + '/real.txt"'}})
        out = io.StringIO()
        with mock.patch.object(hook.os.path, "realpath", side_effect=OSError("boom")), \
                mock.patch("sys.stdin", io.TextIOWrapper(io.BytesIO(payload.encode("utf-8")))), \
                contextlib.redirect_stdout(out):
            hook.main()
        decision = json.loads(out.getvalue())["hookSpecificOutput"]
        self.assertEqual(decision["permissionDecision"], "deny")


if __name__ == "__main__":
    unittest.main()
