"""Tests for dedupe_core and the icloud-imap setup script.

Synthetic RFC 822 messages and an in-memory IMAP server; no network.
Run from this folder:  python -m unittest test_dedupe_core
"""
import importlib.util
import io
import json
import os
import re
import sys
import tempfile
import unittest
from email.message import EmailMessage
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import dedupe_core as core  # noqa: E402

LONG_FOLDER = "1. OPEN FILES/Smith v. Jones (2024)/Pleadings"


# --- synthetic messages ---------------------------------------------------------------------

def make_message(mid="<a1@example.com>", body="Hello there.\n", received="from a by b; Mon, 1 Jan 2026",
                 attachments=(), subject="Status update", extra_headers=()):
    m = EmailMessage()
    m["Received"] = received
    m["From"] = "Sender <sender@example.com>"
    m["To"] = "lawyer@example.ca"
    m["Subject"] = subject
    m["Date"] = "Mon, 01 Jan 2026 10:00:00 -0800"
    m["Message-ID"] = mid
    for k, v in extra_headers:
        m[k] = v
    m.set_content(body)
    for name, data in attachments:
        m.add_attachment(data, maintype="application", subtype="pdf", filename=name)
    return m.as_bytes(policy=m.policy.clone(linesep="\r\n"))


# --- an in-memory IMAP server ---------------------------------------------------------------

_QUOTED = re.compile(r'^"(?:[^"\\]|\\.)*"$')


def unquote_strict(arg):
    if not _QUOTED.match(arg):
        raise AssertionError(f"mailbox argument not a valid IMAP quoted string: {arg!r}")
    return re.sub(r"\\(.)", r"\1", arg[1:-1])


class FakeIMAP:
    """Enough of imaplib.IMAP4 for ImapMailbox. Records every command. Has no expunge
    or close method, so calling either fails the test."""

    def __init__(self, folders, capabilities=("IMAP4REV1", "MOVE"), fail_move_on=None):
        # folders: {display name: {"uidvalidity": int, "flags": [...], "messages": {uid: raw}}}
        self.folders = {}
        for name, spec in folders.items():
            self.folders[name] = {"uidvalidity": spec.get("uidvalidity", 7),
                                  "flags": spec.get("flags", []),
                                  "messages": {u: {"raw": r, "flags": []} for u, r in spec["messages"].items()},
                                  "next_uid": max(spec["messages"] or [0]) + 1}
            for u in spec.get("deleted", ()):
                self.folders[name]["messages"][u]["flags"].append("\\Deleted")
        self.capabilities = capabilities
        self.commands = []
        self.selected = None
        self.readonly = None
        self.fail_move_on = fail_move_on

    def _name(self, quoted):
        return core.decode_mutf7(unquote_strict(quoted))

    def list(self, directory, pattern):
        self.commands.append(("LIST", directory, pattern))
        lines = []
        for name, f in self.folders.items():
            flags = " ".join(f["flags"])
            enc = core.encode_mutf7(name).replace("\\", "\\\\").replace('"', '\\"')
            lines.append(f'({flags}) "/" "{enc}"'.encode("ascii"))
        return "OK", lines

    def select(self, mailbox, readonly=False):
        name = self._name(mailbox)
        self.commands.append(("EXAMINE" if readonly else "SELECT", mailbox))
        if name not in self.folders:
            return "NO", [b"no such mailbox"]
        self.selected, self.readonly = name, readonly
        self._uv = self.folders[name]["uidvalidity"]
        return "OK", [str(len(self.folders[name]["messages"])).encode()]

    def response(self, code):
        return code, [str(self._uv).encode()]

    def status(self, mailbox, items):
        name = self._name(mailbox)
        return "OK", [f'"{name}" (UIDVALIDITY {self.folders[name]["uidvalidity"]})'.encode()]

    def uid(self, command, *args):
        command = command.upper()
        self.commands.append(("UID " + command,) + tuple(a for a in args if a is not None))
        box = self.folders[self.selected]["messages"]
        if command == "SEARCH":
            return "OK", [" ".join(str(u) for u in sorted(box)).encode()]
        if command == "FETCH":
            uids = [int(x) for x in args[0].split(",")]
            data = []
            for n, u in enumerate(uids):
                if u not in box:
                    continue
                raw = box[u]["raw"]
                flags = " ".join(box[u]["flags"])
                if n % 2:  # some servers put UID after the literal
                    data.append((f'{n + 1} (FLAGS ({flags}) RFC822.SIZE {len(raw)} '
                                 f'INTERNALDATE "01-Jan-2026 10:00:00 -0800" BODY[] {{{len(raw)}}}'.encode(), raw))
                    data.append(f" UID {u})".encode())
                else:
                    data.append((f'{n + 1} (UID {u} FLAGS ({flags}) RFC822.SIZE {len(raw)} '
                                 f'INTERNALDATE "01-Jan-2026 10:00:00 -0800" BODY[] {{{len(raw)}}}'.encode(), raw))
                    data.append(b")")
            return "OK", data
        if command in ("MOVE", "COPY", "STORE"):
            if self.readonly:
                return "NO", [b"read-only mailbox"]
            uid = int(args[0])
            if command == "STORE":
                box[uid]["flags"].append("\\Deleted")
                return "OK", [None]
            if self.fail_move_on is not None and uid == self.fail_move_on:
                return "NO", [b"simulated failure"]
            dest = self.folders[self._name(args[1])]
            dest["messages"][dest["next_uid"]] = {"raw": box[uid]["raw"], "flags": []}
            dest["next_uid"] += 1
            if command == "MOVE":
                del box[uid]
            return "OK", [None]
        raise AssertionError(f"unexpected UID command {command}")

    def logout(self):
        self.commands.append(("LOGOUT",))
        return "BYE", [b""]


def mailbox(folders, **kw):
    folders = dict(folders)
    folders.setdefault("Deleted Messages", {"flags": ["\\HasNoChildren", "\\Trash"], "messages": {}})
    fake = FakeIMAP(folders, **kw)
    return fake, core.ImapMailbox(fake)


def run(fake_mb, argv, out_dir):
    out = io.StringIO()
    code = core.run("icloud-imap", lambda: fake_mb, argv + ["--out-dir", out_dir], out=out)
    return code, json.loads(out.getvalue())


def verbs(fake):
    return [c[0] for c in fake.commands]


class Base(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.out_dir = self._tmp.name

    def tearDown(self):
        self._tmp.cleanup()


# --- tier 1 ---------------------------------------------------------------------------------

class TestTier1(Base):
    def folder(self):
        a = make_message(mid="<a@x>", body="Alpha.\n")
        b = make_message(mid="<b@x>", body="Beta.\n")
        return {"INBOX": {"flags": ["\\HasNoChildren"], "messages": {3: a, 5: b, 9: a, 12: a}}}

    def test_identical_copies_grouped_and_highest_uid_kept(self):
        fake, mb = mailbox(self.folder())
        code, rep = run(mb, ["INBOX"], self.out_dir)
        self.assertEqual(code, 0, rep)
        groups = rep["tier1"]["groups"]
        self.assertEqual(len(groups), 1)
        self.assertEqual(groups[0]["keep"]["uid"], 12)
        self.assertEqual(sorted(c["uid"] for c in groups[0]["remove"]), [3, 9])
        self.assertEqual(rep["folders"][0]["tier1_to_remove"], 2)

    def test_dry_run_moves_nothing_and_opens_read_only(self):
        fake, mb = mailbox(self.folder())
        code, rep = run(mb, ["INBOX"], self.out_dir)
        self.assertEqual(rep["moved"], [])
        self.assertTrue(rep["dry_run"])
        self.assertNotIn("SELECT", verbs(fake))
        self.assertIn("EXAMINE", verbs(fake))
        for v in ("UID MOVE", "UID COPY", "UID STORE"):
            self.assertNotIn(v, verbs(fake))
        self.assertEqual(sorted(fake.folders["INBOX"]["messages"]), [3, 5, 9, 12])

    def test_apply_moves_older_copies_to_trash(self):
        fake, mb = mailbox(self.folder())
        code, rep = run(mb, ["INBOX", "--apply"], self.out_dir)
        self.assertEqual(code, 0, rep)
        self.assertEqual(sorted(m["uid"] for m in rep["moved"]), [3, 9])
        self.assertEqual(sorted(fake.folders["INBOX"]["messages"]), [5, 12])
        self.assertEqual(len(fake.folders["Deleted Messages"]["messages"]), 2)

    def test_apply_stops_on_error_and_reports_what_moved(self):
        fake, mb = mailbox(self.folder(), fail_move_on=3)  # removals run newest first: 9, then 3
        code, rep = run(mb, ["INBOX", "--apply"], self.out_dir)
        self.assertEqual(code, 2)
        self.assertEqual(rep["status"], "error")
        self.assertEqual([m["uid"] for m in rep["moved"]], [9])
        self.assertIn(3, fake.folders["INBOX"]["messages"])
        self.assertNotIn(9, fake.folders["INBOX"]["messages"])

    def test_across_folders_keeps_copy_in_first_listed_folder(self):
        a = make_message(mid="<a@x>")
        fake, mb = mailbox({"Archive": {"messages": {1: a}}, "INBOX": {"messages": {50: a}}})
        code, rep = run(mb, ["Archive", "INBOX", "--across-folders"], self.out_dir)
        g = rep["tier1"]["groups"][0]
        self.assertEqual((g["keep"]["folder"], g["keep"]["uid"]), ("Archive", 1))
        self.assertEqual([(c["folder"], c["uid"]) for c in g["remove"]], [("INBOX", 50)])
        # without the flag each folder is separate, so nothing is a duplicate
        fake, mb = mailbox({"Archive": {"messages": {1: a}}, "INBOX": {"messages": {50: a}}})
        code, rep = run(mb, ["Archive", "INBOX"], self.out_dir)
        self.assertEqual(rep["tier1"]["groups"], [])

    def test_messages_already_flagged_deleted_are_ignored(self):
        a = make_message()
        fake, mb = mailbox({"INBOX": {"messages": {1: a, 2: a}, "deleted": [2]}})
        code, rep = run(mb, ["INBOX"], self.out_dir)
        self.assertEqual(rep["tier1"]["groups"], [])

    def test_all_skips_trash(self):
        a = make_message()
        fake, mb = mailbox({"INBOX": {"messages": {1: a, 2: a}}})
        fake.folders["Deleted Messages"]["messages"] = {1: {"raw": a, "flags": []}, 2: {"raw": a, "flags": []}}
        code, rep = run(mb, ["--all"], self.out_dir)
        self.assertEqual([f["folder"] for f in rep["folders"]], ["INBOX"])
        self.assertIn("Deleted Messages", rep["folders_skipped"])


# --- tier 2 ---------------------------------------------------------------------------------

class TestTier2(Base):
    def test_same_message_id_different_bytes_goes_to_comparison(self):
        plain = make_message(mid="<m@x>", body="Please see below.\n", received="from a by b; 1 Jan")
        richer = make_message(mid="<m@x>", body="Please see below.\nAlso: hearing moved to May.\n",
                              received="from c by d; 2 Jan", attachments=[("order.pdf", b"%PDF-1.4 order")])
        fake, mb = mailbox({"INBOX": {"messages": {4: plain, 8: richer}}})
        code, rep = run(mb, ["INBOX"], self.out_dir)
        self.assertEqual(code, 0, rep)
        self.assertEqual(rep["tier1"]["groups"], [], "tier 1 must leave non-identical copies alone")
        self.assertEqual(rep["moved"], [])
        self.assertEqual(rep["tier2"]["groups"], 1)
        with open(rep["tier2"]["comparison_file"], encoding="utf-8") as fh:
            cmp = json.load(fh)
        g = cmp["groups"][0]
        self.assertEqual(g["message_id"], "<m@x>")
        by_uid = {c["uid"]: c for c in g["copies"]}
        self.assertEqual(set(by_uid), {4, 8})
        for c in g["copies"]:
            for field in ("folder", "uid", "uidvalidity", "date", "size", "sha256", "body_sha256",
                          "attachments", "differing_headers"):
                self.assertIn(field, c)
        self.assertNotEqual(by_uid[4]["body_sha256"], by_uid[8]["body_sha256"])
        self.assertIn("received", by_uid[4]["differing_transport_headers"])
        self.assertIn("content-type", by_uid[8]["differing_headers"])
        att = by_uid[8]["attachments"]
        self.assertEqual(att[0]["filename"], "order.pdf")
        self.assertEqual(att[0]["size"], len(b"%PDF-1.4 order"))
        self.assertEqual(att[0]["sha256"], core.sha256(b"%PDF-1.4 order"))
        self.assertEqual(by_uid[4]["attachments"], [])
        diff = g["body_diffs"][0]["diff"]
        self.assertRegex(diff, r"(?m)^[-+]Also: hearing moved to May\.$")
        hint = g["hints"][0]
        self.assertTrue(hint["attachments_i_subset_of_j"] or hint["attachments_j_subset_of_i"])

    def test_tier2_runs_only_on_tier1_survivors(self):
        a = make_message(mid="<m@x>", body="One.\n")
        b = make_message(mid="<m@x>", body="One. Two.\n")
        fake, mb = mailbox({"INBOX": {"messages": {1: a, 2: a, 3: b}}})
        code, rep = run(mb, ["INBOX"], self.out_dir)
        self.assertEqual([c["uid"] for c in rep["tier1"]["groups"][0]["remove"]], [1])
        uids = sorted(c["uid"] for c in rep["tier2"]["proposed"][0]["copies"])
        self.assertEqual(uids, [2, 3])

    def test_diff_is_length_capped(self):
        a = make_message(mid="<m@x>", body="".join(f"line {n}\n" for n in range(3000)))
        b = make_message(mid="<m@x>", body="".join(f"other {n}\n" for n in range(3000)))
        fake, mb = mailbox({"INBOX": {"messages": {1: a, 2: b}}})
        code, rep = run(mb, ["INBOX"], self.out_dir)
        with open(rep["tier2"]["comparison_file"], encoding="utf-8") as fh:
            d = json.load(fh)["groups"][0]["body_diffs"][0]
        self.assertTrue(d["truncated"])
        self.assertLess(len(d["diff"]), core.DIFF_CAP + 100)


# --- --move-uids ----------------------------------------------------------------------------

class TestMoveUids(Base):
    def setup_group(self):
        c1 = make_message(mid="<m@x>", body="v1\n")
        c2 = make_message(mid="<m@x>", body="v1\nv2\n")
        c3 = make_message(mid="<m@x>", body="v1\nv2\nv3\n")
        other = make_message(mid="<o@x>", body="unrelated\n")
        fake, mb = mailbox({"INBOX": {"uidvalidity": 99, "messages": {1: c1, 2: c2, 3: c3, 4: other}}})
        code, rep = run(mb, ["INBOX"], self.out_dir)
        with open(rep["tier2"]["comparison_file"], encoding="utf-8") as fh:
            cmp = json.load(fh)
        return fake, cmp

    def write(self, obj, name):
        path = os.path.join(self.out_dir, name)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(obj, fh)
        return path

    def test_moves_only_the_listed_uids(self):
        fake, cmp = self.setup_group()
        verdicts = {"groups": [{"group_id": "g1", "decision": "remove", "keep": [{"folder": "INBOX", "uid": 3}],
                                "remove": [{"folder": "INBOX", "uid": 1}], "reason": "subsumed"}]}
        moves = core.moves_from_verdicts(cmp, verdicts)
        self.assertEqual([(m["uid"], m["uidvalidity"]) for m in moves["moves"]], [(1, 99)])
        path = self.write(moves, "moves.json")
        mb = core.ImapMailbox(fake)
        fake.commands.clear()
        code, rep = run(mb, ["--move-uids", path], self.out_dir)
        self.assertEqual(code, 0, rep)
        self.assertEqual([m["uid"] for m in rep["moved"]], [1])
        self.assertEqual(sorted(fake.folders["INBOX"]["messages"]), [2, 3, 4])
        moved_cmds = [c for c in fake.commands if c[0] == "UID MOVE"]
        self.assertEqual([c[1] for c in moved_cmds], ["1"])
        self.assertNotIn("UID SEARCH", verbs(fake), "--move-uids must not rescan for more to move")

    def test_refuses_a_message_that_changed(self):
        fake, cmp = self.setup_group()
        moves = {"moves": [
            {"folder": "INBOX", "uid": 1, "uidvalidity": 99, "sha256": cmp["groups"][0]["copies"][2]["sha256"]},
        ]}
        # copies are ordered highest UID first, so copy 2 is UID 1; corrupt UID 2's hash instead
        moves["moves"].append({"folder": "INBOX", "uid": 2, "uidvalidity": 99, "sha256": "0" * 64})
        path = self.write(moves, "moves.json")
        code, rep = run(core.ImapMailbox(fake), ["--move-uids", path], self.out_dir)
        self.assertEqual(code, 2)
        self.assertEqual([m["uid"] for m in rep["moved"]], [1])
        self.assertIn(2, fake.folders["INBOX"]["messages"])

    def test_refuses_changed_uidvalidity(self):
        fake, cmp = self.setup_group()
        c = cmp["groups"][0]["copies"][0]
        path = self.write({"moves": [{"folder": "INBOX", "uid": c["uid"], "uidvalidity": 1,
                                      "sha256": c["sha256"]}]}, "moves.json")
        code, rep = run(core.ImapMailbox(fake), ["--move-uids", path], self.out_dir)
        self.assertEqual(code, 2)
        self.assertEqual(rep["moved"], [])

    def test_verdict_cannot_remove_every_copy_or_a_stranger(self):
        fake, cmp = self.setup_group()
        all_copies = [{"folder": "INBOX", "uid": u} for u in (1, 2, 3)]
        with self.assertRaises(core.DedupeError):
            core.moves_from_verdicts(cmp, {"groups": [{"group_id": "g1", "decision": "remove",
                                                       "remove": all_copies}]})
        with self.assertRaises(core.DedupeError):
            core.moves_from_verdicts(cmp, {"groups": [{"group_id": "g1", "decision": "remove",
                                                       "remove": [{"folder": "INBOX", "uid": 4}]}]})

    def test_keep_all_and_unapproved_groups_move_nothing(self):
        fake, cmp = self.setup_group()
        v = {"groups": [{"group_id": "g1", "decision": "keep_all", "remove": [], "reason": "each unique"}]}
        self.assertEqual(core.moves_from_verdicts(cmp, v), {"moves": []})
        v = {"groups": [{"group_id": "g1", "decision": "remove", "remove": [{"folder": "INBOX", "uid": 1}]}]}
        self.assertEqual(core.moves_from_verdicts(cmp, v, approved_groups=set()), {"moves": []})


# --- never expunge --------------------------------------------------------------------------

class TestNeverExpunge(Base):
    def test_no_run_ever_expunges_or_closes(self):
        a = make_message(mid="<a@x>")
        b1 = make_message(mid="<b@x>", body="x\n")
        b2 = make_message(mid="<b@x>", body="x\ny\n")
        for caps in (("IMAP4REV1", "MOVE"), ("IMAP4REV1",)):
            fake, mb = mailbox({"INBOX": {"messages": {1: a, 2: a, 3: b1, 4: b2}}}, capabilities=caps)
            run(mb, ["INBOX", "--apply"], self.out_dir)
            cmp_path = os.path.join(self.out_dir, "tier2-comparison.json")
            with open(cmp_path, encoding="utf-8") as fh:
                cmp = json.load(fh)
            g = cmp["groups"][0]
            moves = core.moves_from_verdicts(cmp, {"groups": [{"group_id": "g1", "decision": "remove",
                                                               "remove": [{"folder": "INBOX", "uid": 3}]}]})
            path = os.path.join(self.out_dir, "moves.json")
            with open(path, "w", encoding="utf-8") as fh:
                json.dump(moves, fh)
            code, rep = run(core.ImapMailbox(fake), ["--move-uids", path], self.out_dir)
            self.assertEqual(code, 0, rep)
            self.assertFalse(rep["expunged"])
            for cmd in fake.commands:
                self.assertNotIn(cmd[0], ("EXPUNGE", "UID EXPUNGE", "CLOSE"))
            self.assertFalse(hasattr(fake, "expunge"))
            self.assertEqual(len(g["copies"]), 2)
        # without MOVE the source is flagged \Deleted, never expunged: it is still there
        self.assertIn("\\Deleted", fake.folders["INBOX"]["messages"][3]["flags"])

    def test_core_source_never_issues_expunge(self):
        with open(os.path.join(HERE, "dedupe_core.py"), encoding="utf-8") as fh:
            src = fh.read()
        self.assertNotRegex(src, r"\.(expunge|close)\s*\(")
        self.assertNotRegex(src, r"uid\(\s*[\"']EXPUNGE")


# --- folder names ---------------------------------------------------------------------------

class TestFolderNames(unittest.TestCase):
    def test_quoting_spaces_slashes_parentheses(self):
        for name in (LONG_FOLDER, "Clients (closed)/2025", "a\"b\\c"):
            q = core.quote_mailbox(name)
            self.assertRegex(q, _QUOTED.pattern)
            self.assertEqual(core.decode_mutf7(unquote_strict(q)), name)
        self.assertEqual(core.quote_mailbox(LONG_FOLDER), '"1. OPEN FILES/Smith v. Jones (2024)/Pleadings"')
        self.assertEqual(core.quote_mailbox('a"b\\c'), '"a\\"b\\\\c"')

    def test_modified_utf7(self):
        self.assertEqual(core.encode_mutf7("~peter/mail/台北/日本語"),
                         "~peter/mail/&U,BTFw-/&ZeVnLIqe-")
        self.assertEqual(core.encode_mutf7("R&D"), "R&-D")
        for name in ("Café über", "R&D", "日本語", "plain"):
            self.assertEqual(core.decode_mutf7(core.encode_mutf7(name)), name)

    def test_folder_with_special_characters_end_to_end(self):
        a = make_message()
        name = LONG_FOLDER + " (été)"
        fake, mb = mailbox({name: {"messages": {1: a, 2: a}}})
        with tempfile.TemporaryDirectory() as d:
            code, rep = run(mb, [name, "--apply"], d)
        self.assertEqual(code, 0, rep)
        sent = [c[1] for c in fake.commands if c[0] in ("EXAMINE", "SELECT")]
        self.assertTrue(sent)
        for arg in sent:
            self.assertEqual(arg, core.quote_mailbox(name))
        trash_args = [c[2] for c in fake.commands if c[0] == "UID MOVE"]
        self.assertEqual(trash_args, ['"Deleted Messages"'])

    def test_parse_list_response(self):
        data = [b'(\\HasNoChildren \\Trash) "/" "Deleted Messages"',
                b'(\\HasNoChildren) "/" INBOX',
                b'(\\HasChildren) "/" "1. OPEN FILES/Smith v. Jones (2024)/Pleadings"',
                (b'(\\HasNoChildren) "/" {14}', b'Odd "name" (x)'),
                b'(\\Noselect) "/" "Caf&AOk-"']
        got = core.parse_list_response(data)
        self.assertEqual([f["name"] for f in got],
                         ["Deleted Messages", "INBOX", LONG_FOLDER, 'Odd "name" (x)', "Café"])
        self.assertIn("\\trash", got[0]["flags"])

    def test_unknown_folder_fails_closed(self):
        fake, mb = mailbox({"INBOX": {"messages": {}}})
        with tempfile.TemporaryDirectory() as d:
            code, rep = run(mb, ["Nope", "--apply"], d)
        self.assertEqual(code, 2)
        self.assertEqual(rep["moved"], [])


# --- credentials and the icloud-imap script -------------------------------------------------

def load_icloud():
    spec = importlib.util.spec_from_file_location("icloud_imap", os.path.join(HERE, "icloud-imap.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestCredentials(Base):
    def test_password_never_in_report(self):
        secret = "abcd-efgh-ijkl-mnop"

        def connect():
            raise core.DedupeError(f"server said: bad password {secret}")
        with mock.patch.dict(os.environ, {"MAIL_USER": "me@icloud.com", "MAIL_PASSWORD": secret}):
            out = io.StringIO()
            code = core.run("icloud-imap", connect, ["INBOX", "--out-dir", self.out_dir], out=out)
        self.assertEqual(code, 2)
        self.assertNotIn(secret, out.getvalue())
        for name in os.listdir(self.out_dir):
            with open(os.path.join(self.out_dir, name), encoding="utf-8") as fh:
                self.assertNotIn(secret, fh.read())

    def test_missing_credentials_fail_closed(self):
        env = {k: v for k, v in os.environ.items() if k not in ("MAIL_USER", "MAIL_PASSWORD")}
        with mock.patch.dict(os.environ, env, clear=True), mock.patch.dict(sys.modules, {"keyring": None}):
            with self.assertRaises(core.DedupeError):
                core.resolve_credentials("icloud-imap", "imap.mail.me.com")

    def test_icloud_signs_in_with_apple_id_on_993(self):
        mod = load_icloud()
        a = make_message()
        fake = FakeIMAP({"INBOX": {"messages": {1: a}},
                         "Deleted Messages": {"flags": ["\\Trash"], "messages": {}}})
        calls = {}

        def fake_ssl(host, port, timeout=None):
            calls["host"], calls["port"] = host, port
            fake.login = lambda u, p: calls.update(user=u) or ("OK", [b""])
            return fake
        env = {"MAIL_USER": "someone@icloud.com", "MAIL_PASSWORD": "app-specific"}
        env_clear = {k: v for k, v in os.environ.items() if k != "MAIL_HOST"}
        env_clear.update(env)
        with mock.patch.dict(os.environ, env_clear, clear=True), \
                mock.patch.object(mod.imaplib, "IMAP4_SSL", fake_ssl):
            mb = mod.connect()
        self.assertEqual((calls["host"], calls["port"]), ("imap.mail.me.com", 993))
        self.assertEqual(calls["user"], "someone@icloud.com")
        self.assertEqual(mb.trash_folder(), "Deleted Messages")
        self.assertEqual(mod.SETUP_ID, "icloud-imap")


if __name__ == "__main__":
    unittest.main()
