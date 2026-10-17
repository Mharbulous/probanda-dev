#!/usr/bin/env python3
"""Claude Code PreToolUse hook (matcher: Bash|PowerShell|mcp__(.+__)?device_bash).

Refuses hard deletes issued outside a Git worktree and the OS temp dir, and
points to the file-manager plugin's file_ops__trash tool, which moves the item to
<workspace root>/TRASH/<same relative path>. It never moves a file itself, so
without file-manager no file Probanda did not create is deleted or moved.

Policy (scope rules, rationale): .claude/skills/safe-file-deletion/SKILL.md

Decision rule
  1. Not a shell tool, or no destructive pattern in the command, in a shell
     script it runs, or in an encoded command it carries  -> allow.
  2. Bash only: every location the command touches (the session cwd plus any
     absolute path or `~` form in the command or in that script or encoded
     text) really lands, through any link, inside a Git worktree or the OS temp
     dir, and none inside a client matter folder (a matter pointer file on an
     ancestor, or practice data's folder record) -> allow. So is a lone rm/unlink, after an optional `cd <absolute
     dir> &&`, whose every target resolves there. Every rm/unlink target,
     chained or not, counts as a location, and a glob in a component rm follows
     counts by each match; an rm whose targets cannot be told gets no exemption.
     device_bash runs on another machine, so nothing is exempted
     by probing this one.
  3. device_bash only: a lone non-recursive `rm`
     (flags only -f/--force), after an optional `cd <word> &&`, whose words
     expand nothing but globs, a leading `$HOME/` or a bare `~/`, with no
     target or cd word spelled under $HOME/mnt, and no hidden script or encoded
     command -> allow, rewritten into a subshell that resolves each target's
     parent directory on the device and refuses, before rm runs, any that lands
     in or above $HOME/mnt or in the real location of any $HOME/mnt entry.
     Any error in this step falls through to 4.
  4. Otherwise -> deny (JSON permissionDecision on stdout, exit 0), naming the
     file_ops__trash tool.

Registered in the project's .claude/settings.json and in
~/.claude/settings.json. Fails OPEN on any unexpected error: a bug here must
never be able to block all shell use.
"""
import base64
import codecs
import glob
import json
import os
import re
import sys
import tempfile
from pathlib import Path

# ---------------------------------------------------------------------------
# DESTRUCTIVE_PATTERNS -- extend here. Non-exhaustive by design.
#
# CMD_START anchors a bare command name to a command position (start of the
# string, after a shell operator / quote / substitution / block brace, after a
# wrapper such as sudo, xargs, find -exec, or after `do`, `then`, `else` or
# `time` where that word is itself in command position) so that "term",
# "confirm" and "docker run --rm" do not match. Those four are anchored rather
# than listed as bare wrappers because they are ordinary English words: a
# commit message reading "things to do rm the old files" must stay allowed,
# while `for f in *; do rm "$f"; done` must not. One optional leading backslash is tolerated,
# since `\rm` is `rm` with alias lookup suppressed.
# Python/.NET call patterns match anywhere.
# ---------------------------------------------------------------------------
CMD_START_TEMPLATE = (
    r"(?:^|[;&|(`'\"\n]|\$\(%s"
    r"|(?<!\S)(?:sudo|doas|env|command|builtin|exec|nohup|nice|timeout|xargs"
    r"|-exec|-execdir|-ok)(?:\s+(?:-\S+|\d+\S*))*\s"
    r"|(?:^|[;&|(`\n])\s*(?:do|then|else|time)\s)"
    r"\s*\\?"
)
CMD_END = r"(?![\w-])"

# A brace group runs what is inside it, so `{` opens a command position -- but
# only where the shell means a block. Bash requires a space after the brace
# (`{ rm x; }`), which is exactly what separates a block from brace expansion
# (`echo {rm,ls}` must stay allowed); a PowerShell script block needs no space
# (`% {ri $_}`). In both shells a `$` or `@` before the brace makes it a
# variable or a hashtable, never a block. The two spellings are incompatible,
# so each tool compiles its own copy of the pattern list.
BASH_BRACE = r"|(?<![\$@])\{(?=[ \t])"
PS_BRACE = r"|(?<![\$@])\{"

# POSIX `rmdir` and cmd's `rd` / `rmdir` refuse to touch a non-empty directory,
# so on their own they cannot lose data -- and blocking them dead-ends the one
# bit of TRASH housekeeping the policy needs (removing the folder once it is
# emptied). cmd's rd and rmdir count only when /s turns them into a tree
# delete. On Bash they need a Windows shell: POSIX rmdir cannot recurse
# (#1387). In PowerShell `rd` and `rmdir` are Remove-Item and delete a file
# outright, so they count on the PowerShell tool, and on Bash wherever
# powershell or pwsh is named (#1407).
EMPTY_DIR_ONLY = "rmdir/rd with a recursive flag"
POWERSHELL_RD = "PowerShell rd/rmdir (Remove-Item)"
PWSH_WORD_RE = re.compile(r"(?<![\w-])(?:powershell|pwsh)(?:\.exe)?(?![\w-])", re.IGNORECASE)
# cmd.exe's only recursive switch is /s. It accepts it in any case and glued to
# its neighbours, so `/S /Q`, `/s/q` and `/q/s` are the same tree delete as
# `/s /q`.
RECURSIVE_FLAG_RE = re.compile(r"(?:^|\s)(?:/\w+)*/s(?![\w-])", re.IGNORECASE)

def _destructive_patterns(brace):
    """Compile the pattern list against one shell's brace-group spelling."""
    CMD_START = CMD_START_TEMPLATE % brace
    patterns = [
        ("POSIX rm/unlink",           CMD_START + r"(?:rm|unlink)" + CMD_END),
        ("find -delete",              r"(?<![\w-])find(?![\w-]).*\s-delete" + CMD_END),
        ("cmd.exe del/erase",         CMD_START + r"(?:del|erase)" + CMD_END),
        ("PowerShell Remove-Item",    CMD_START + r"(?:remove-item|ri)" + CMD_END),
        (EMPTY_DIR_ONLY,              CMD_START + r"(?:rmdir|rd)" + CMD_END),
        ("Python os.remove/unlink",   r"\bos\.(?:remove|unlink|rmdir|removedirs)\s*\("),
        # `rimraf` names nothing but a recursive delete, so -- like shutil.rmtree --
        # it counts wherever it appears, not only in command position (`npx rimraf`,
        # `pnpm exec rimraf`). Inside a worktree or the temp dir this never fires,
        # so a build script's `npx rimraf dist` is unaffected.
        ("rimraf",                    r"(?<![\w-])rimraf(?![\w-])"),
        ("Python shutil.rmtree",      r"\bshutil\.rmtree\s*\("),
        ("Python .unlink()/.rmdir()", r"\.(?:unlink|rmdir)\s*\("),
        (".NET Delete()",             r"(?:::|\.)Delete\s*\("),
    ]
    return [(label, re.compile(rx, re.IGNORECASE)) for label, rx in patterns]


BASH_PATTERNS = _destructive_patterns(BASH_BRACE)
POWERSHELL_PATTERNS = _destructive_patterns(PS_BRACE)

# Cowork's device shell is an MCP tool whose host prefix varies
# (mcp__remote-devices__device_bash); its parameter is also named `command`.
TOOL_RE = re.compile(r"Bash|PowerShell|mcp__(.+__)?device_bash")
TRASH_DIRNAME = "TRASH"

# Tokens: double-quoted, single-quoted, or bare.
TOKEN_RE = re.compile(r'"([^"]*)"|\'([^\']*)\'|(\S+)')
WIN_ABS_RE = re.compile(r"^[A-Za-z]:[\\/]")
MSYS_ABS_RE = re.compile(r"^/([A-Za-z])/(.*)$")
# Absolute paths embedded inside a larger token, e.g. the body of
# `python -c "import shutil; shutil.rmtree(r'C:\\matter\\x')"`.
EMBEDDED_WIN_RE = re.compile(r"(?<![\w:])[A-Za-z]:[\\/][^\"'\r\n|<>&;]*")
EMBEDDED_MSYS_RE = re.compile(r"(?<![\w:])/[A-Za-z]/[^\"'\r\n|<>&;]*")

# Rewriter. A word of a simple command: double-quoted (no escapes or backticks),
# single-quoted, or bare (no quotes, escapes, operators or parentheses).
WORD_RE = re.compile(r'"([^"\\`]*)"|\'([^\']*)\'|([^\s"\'\\;&|<>()`]+)')
REWRITE_COMMANDS = {"rm", "unlink"}
REWRITE_FLAGS = {"-r", "-R", "-f", "-rf", "-fr", "--recursive", "--force"}
HOME_VAR = "$HOME/"
DEVICE_MOUNT = "mnt"             # device_bash addresses a matter as $HOME/mnt/<folder>/...


# A Windows shell being invoked by this command. The hook cannot parse that
# shell's script text (a PowerShell -Command string, a cmd /c tail), so once a
# shell is seen the delete aliases count wherever they appear as a word.
#   cmd(.exe): a /c, /k or /r switch within 200 chars on the same line (bounded,
#     so a line with many "cmd" words stays linear), or fed by a pipe/heredoc.
#   powershell/pwsh(.exe): in command position (start, after an operator, a
#     newline, a $( or a wrapper such as sudo/env), optionally path-prefixed, or
#     anywhere when followed by a -switch (Start-Process pwsh -ArgumentList ...).
#     A bare mention in prose or a quoted string does not open the gate.
#     An installed path needs quoting ("C:\Program Files\PowerShell\7\pwsh.exe"),
#     so one optional quote may open the path prefix and one may close it.
#   $COMSPEC / %COMSPEC% are cmd under another name.
WIN_SHELL_RE = re.compile(
    r"(?<![\w-])(?:cmd(?:\.exe)?|\$COMSPEC|%COMSPEC%)(?![\w-])"
    r"(?:[^\n;&|]{0,200}?(?<![\w-])/(?:\S*?/)?[ckr](?![\w-])|\s*<<)"
    r"|\|\s*cmd(?:\.exe)?(?![\w-])"
    r"|(?:^|[;&|(`\n]|\$\("
    r"|(?<!\S)(?:sudo|doas|env|command|builtin|exec|nohup|nice|timeout|xargs"
    r"|-exec|-execdir|-ok)(?:\s+(?:-\S+|\d+\S*))*\s"
    r"|(?<!\S)\w+=\S*\s)"
    r"\s*['\"]?[^\s;&|'\"`]*?(?:powershell|pwsh)(?:\.exe)?(?![\w-])"
    r"|(?<![\w-])(?:powershell|pwsh)(?:\.exe)?['\"]?\s+-", re.IGNORECASE)
WIN_ONLY = {"cmd.exe del/erase", "PowerShell Remove-Item", EMPTY_DIR_ONLY}
WIN_SHELL_PATTERNS = [
    (label, re.compile(r"(?<![\w$-])(?:" + names + r")" + CMD_END, re.IGNORECASE))
    for label, names in [
        ("POSIX rm/unlink", "rm|unlink"),
        ("cmd.exe del/erase", "del|erase"),
        ("PowerShell Remove-Item", "remove-item|ri"),
        (EMPTY_DIR_ONLY, "rmdir|rd"),
    ]
]


# A heredoc whose body is only stored, never run (#643): cat or tee not piped
# anywhere, a git commit or gh reading its message from stdin, or `$(cat <<...)`
# as the argument of such a git/gh command. The delimiter must be quoted, so the
# body is literal text in which no $(...) or backtick runs. Any other heredoc --
# an interpreter, an unquoted or `<<-` delimiter, two on one line, a missing
# terminator -- leaves the whole command scanned as it is.
HEREDOC_OP_RE = re.compile(r"(?<!<)<<(?!<)")
QUOTED_DELIM_RE = re.compile(r"\s*(?:'(\w+)'|\"(\w+)\")")
# A pipe or a process substitution hands the stored text to another command.
PIPED_RE = re.compile(r"(?<!\|)\|(?!\|)|[<>]\(")
SEGMENT_SPLIT_RE = re.compile(r"[;&|]+")
STORE_HEAD_RES = [
    re.compile(r"\s*(?:cat|tee)(?:\s[^$`()]*)?"),
    re.compile(r"\s*(?:git\s+commit|gh)\s[^$`()]*\$\(\s*cat\s*"),
]
STDIN_MESSAGE_RES = [
    re.compile(r"\s*git\s+commit\s(?:[^;&|$`()]*\s)?(?:-F|--file)(?:\s+|=)-(?:\s|$)"),
    re.compile(r"\s*gh\s(?:[^;&|$`()]*\s)?(?:--body-file|-F)(?:\s+|=)-(?:\s|$)"),
]


def _stored_delimiter(line, op):
    delim = QUOTED_DELIM_RE.match(line, op.end())
    if delim is None or PIPED_RE.search(line):
        return None
    head = SEGMENT_SPLIT_RE.split(line[:op.start()])[-1]
    rest = head + " " + line[delim.end():]
    if any(rx.fullmatch(head) for rx in STORE_HEAD_RES) or any(rx.match(rest) for rx in STDIN_MESSAGE_RES):
        return delim.group(1) or delim.group(2)
    return None


def strip_stored_heredocs(command):
    """The command with every stored heredoc's body and terminator line removed,
    or the command unchanged if any heredoc in it is not clearly stored."""
    lines = command.split("\n")
    kept, i = [], 0
    while i < len(lines):
        line = lines[i]
        kept.append(line)
        i += 1
        ops = list(HEREDOC_OP_RE.finditer(line))
        if not ops:
            continue
        delim = _stored_delimiter(line, ops[0]) if len(ops) == 1 else None
        if delim is None:
            return command
        end = next((j for j in range(i, len(lines)) if lines[j].rstrip("\r") == delim), None)
        if end is None:
            return command
        i = end + 1
    return "\n".join(kept)


def find_destructive(command, tool_name):
    if tool_name == "PowerShell":
        patterns = list(POWERSHELL_PATTERNS)
    else:
        patterns = [p for p in BASH_PATTERNS if p[0] not in WIN_ONLY]
    if WIN_SHELL_RE.search(command):
        patterns += WIN_SHELL_PATTERNS
    for label, rx in patterns:
        if not rx.search(command):
            continue
        if label == EMPTY_DIR_ONLY:
            if tool_name == "PowerShell" or PWSH_WORD_RE.search(command):
                return POWERSHELL_RD
            if not RECURSIVE_FLAG_RE.search(command):
                continue      # empty directories only: no data can be lost
        return label
    return None


# Text a command runs without spelling it out (#645), revealed one level deep.
#   Both need the shell word in command position (start, after an operator, a
#     newline, a $( or a wrapper such as sudo, env, VAR=x, then or do), so a
#     script or switch that is only mentioned in prose is not read.
#   A shell script it runs: .ps1, .sh, .bat or .cmd named in command position
#     (./x.sh, & x.ps1, a bare path), after bash/sh/zsh/source/. (flags
#     allowed), after cmd /c (/k, /r, msys //c, an optional `call`), or
#     anywhere in a pwsh/powershell invocation (-File, -f, or positional).
#     Python and other interpreters are not read.
#   An -EncodedCommand payload: base64 of UTF-16LE, with the switch spelled as
#     -ec or any prefix of -EncodedCommand, after - or /, among pwsh's own
#     switches (reading stops at -Command or -File, whose text is not a switch).
#   The script regex bounds every repeat (a path to 260 chars, a pwsh
#     argument tail to 200) so a long line cannot make the scan blow up.
SCRIPT_START = (
    r"(?:^|[;&|(`{\n]|\$\("
    r"|(?<!\S)(?:sudo|doas|env|command|builtin|exec|nohup|nice|timeout|time|then|do|else)"
    r"(?:\s+(?:-\S{1,40}|\d+\S{0,20})){0,10}\s|(?<!\S)\w+=\S{0,260}\s)\s*"
)
PWSH = r"['\"]?[^\s;&|'\"`]{0,260}?(?:pwsh|powershell)(?:\.exe)?['\"]?\s+"
SCRIPT_EXT = r"\.(?:ps1|sh|bat|cmd)"
SCRIPT_PATH = (r"(?:\"([^\"\n]{1,260}?" + SCRIPT_EXT + r")\"|'([^'\n]{1,260}?" + SCRIPT_EXT + r")'"
               r"|([^\s;&|'\"`()]{1,260}?" + SCRIPT_EXT + r"))(?![\w.])")
SCRIPT_RUN_RE = re.compile(
    SCRIPT_START +
    r"(?:(?:bash|sh|zsh|source|\.)(?:\s+-\S{1,40}){0,10}\s+"
    r"|(?:cmd(?:\.exe)?|%COMSPEC%|\$COMSPEC)\s+/{1,2}[ckr]\s+(?:call\s+)?"
    r"|" + PWSH + r"(?:[^\n;&|]{0,200}?\s)?)?"
    + SCRIPT_PATH, re.IGNORECASE)
PWSH_ARGS_RE = re.compile(SCRIPT_START + PWSH + r"([^\n;&|]*)", re.IGNORECASE)
SWITCH_RE = re.compile(r"[-/](\w+)")
DEVICE_SCRIPT = "shell script run on another machine"
UNREADABLE_SCRIPT = "unreadable script"
UNDECODABLE = "undecodable encoded command"


def _encoded_payloads(command):
    for invocation in PWSH_ARGS_RE.finditer(command):
        words = invocation.group(1).split()
        for word, value in zip(words, words[1:]):
            switch = SWITCH_RE.fullmatch(word)
            name = switch.group(1).lower() if switch else ""
            if name and ("command".startswith(name) or "file".startswith(name)):
                break
            if name == "ec" or (name and "encodedcommand".startswith(name)):
                yield value.strip("'\"")


def _read_script(path):
    data = path.read_bytes()
    if data.startswith((codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE)):
        return data.decode("utf-16", errors="replace")
    return data.decode("utf-8-sig", errors="replace")


def reveal_hidden(command, tool_name, cwd):
    """(label, texts): the first delete found in text the command runs without
    spelling it out, or the reason that text cannot be seen; and every text
    revealed, so its paths count as locations."""
    found = []
    for payload in _encoded_payloads(command):
        try:
            text = base64.b64decode(payload, validate=True).decode("utf-16-le")
        except ValueError:              # binascii.Error and UnicodeDecodeError both
            found.append((UNDECODABLE, ""))
            continue
        label = find_destructive(text, "PowerShell")
        found.append((label and label + " (in an encoded command)", text))
    for m in SCRIPT_RUN_RE.finditer(command):
        name = next(g for g in m.groups() if g)
        if tool_name not in ("Bash", "PowerShell"):
            found.append((DEVICE_SCRIPT, ""))       # the script is on the device, not here
            continue
        spelled = expand_vars(name)
        msys = MSYS_ABS_RE.match(spelled)
        if msys:
            spelled = msys.group(1).upper() + ":/" + msys.group(2)
        path = Path(cwd) / spelled
        if not path.is_file():
            continue                                  # nothing runs, so nothing is deleted
        try:
            body = _read_script(path)
        except OSError:
            found.append((UNREADABLE_SCRIPT + " " + str(path), ""))
            continue
        # .bat/.cmd are read with the PowerShell pattern set, which includes del/erase.
        label = find_destructive(body, "Bash" if name.lower().endswith(".sh") else "PowerShell")
        found.append((label and label + " (in " + str(path) + ")", body))
    return next((label for label, _ in found if label), None), [revealed for _, revealed in found]


def _clean(tok):
    return tok.strip().rstrip("\\/;,)\"'")


HOME_FORM_RE = re.compile(r"\$(HOME|USERPROFILE)\b|\$\{(HOME|USERPROFILE)\}|%(?i:(HOME|USERPROFILE))%")


def expand_vars(command):
    """Resolve the home-directory path forms before scanning.

    The hook sees the command before the shell expands it, and this project's
    house style writes Windows paths as `$HOME/...` with forward slashes. Left
    unexpanded, such a path is not recognisable as absolute and a matter-file
    delete would slip through. Only the home forms expand: expanding every
    variable let prose such as `%COMSPEC%` conjure a system path (#643).
    """
    home = os.path.expanduser("~").replace("\\", "/")

    def home_value(m):
        # Claude Code on Windows starts the hook without HOME set (spec
        # 2026-10-16). An unset or empty home variable falls back to the
        # folder expanduser finds, as the `~/` form already does, so the
        # hook can still see where the path points.
        name = next(g for g in m.groups() if g).upper()
        return os.environ.get(name) or home

    text = HOME_FORM_RE.sub(home_value, command)
    return re.sub(r"(?<![\w~])~(?=/)", home, text)


def extract_abs_paths(command):
    """Absolute-looking paths in the command, most precise first.

    Whole tokens are read first (they handle quoted paths containing spaces
    exactly), then a raw scan catches paths buried inside a larger token.
    """
    command = expand_vars(command)
    found = []

    def add(text):
        if text and text not in found:
            found.append(text)

    for m in TOKEN_RE.finditer(command):
        tok = _clean(next(g for g in m.groups() if g is not None))
        msys = MSYS_ABS_RE.match(tok)
        if m.group(3) is not None and tok.startswith("~"):
            add(os.path.expanduser(tok))           # ~name/...; left as ~... when unknown
        elif msys:                                 # /c/Users/... -> C:/Users/...
            add(msys.group(1).upper() + ":/" + msys.group(2))
        elif WIN_ABS_RE.match(tok):
            add(tok)
        elif tok.startswith("/") and tok.count("/") >= 2:   # POSIX path, not a /s flag
            add(tok)

    for m in EMBEDDED_WIN_RE.finditer(command):
        add(_clean(m.group(0)))
    for m in EMBEDDED_MSYS_RE.finditer(command):
        raw = _clean(m.group(0))
        msys = MSYS_ABS_RE.match(raw)
        if msys:
            add(msys.group(1).upper() + ":/" + msys.group(2))

    return [Path(p) for p in found]


# The invoking shell's own binary is never a location the command touches: a
# shell launched by its full path must not turn a delete inside a worktree into
# a deny (#643). Only a path that ends at the binary is exempt: a raw-scan
# match that runs on into its arguments may carry the real target.
SHELL_BINARY_RE = re.compile(r"[\\/](?:cmd|pwsh|powershell)\.exe$", re.IGNORECASE)

# A directory prepended to PATH (`export PATH="/c/Program Files/dotnet:$PATH"`)
# is a search location, not a delete target. Only a path that ends at the
# `:$PATH` reference is exempt.
PATH_ENTRY_RE = re.compile(r":\$\{?PATH\}?$")


def nearest_existing(path):
    p = Path(os.path.abspath(path))
    while not os.path.exists(p) and p.parent != p:     # os.path: False, not EACCES, under /root
        p = p.parent
    return p


def in_git_worktree(path):
    d = nearest_existing(path)
    for anc in (d, *d.parents):
        if (anc / ".git").exists():        # .git dir (repo) or .git file (linked worktree)
            return True
    return False


def in_temp_dir(path):
    tmp = Path(os.path.realpath(tempfile.gettempdir()))
    try:
        Path(os.path.abspath(path)).relative_to(tmp)
        return True
    except ValueError:
        return False


# ---------------------------------------------------------------------------
# Client matter folders (spec 2026-10-16). A location inside one is never
# exempt: a matter-folder hit only ever adds protection, so a matter folder
# inside a Git worktree or the OS temp dir is refused too. A folder is
# recognised two independent ways, so a lawyer deleting one marker file does
# not leave the folder unprotected:
#   1. an ancestor holds a matter pointer file (coclerk.json, or probanda.json
#      once the rename lands);
#   2. practice data's local record of matter folders names an ancestor: the
#      `folder` data field on `matter` items in practice.db
#      (<case_data_root>/_practice/practice.db, opened read-only), a path
#      relative to the litigation library (the parent of case_data_root). The
#      Roaming device settings file names case_data_root; COCLERK_CONFIG_PATH
#      names another settings file to read in its place.
# Any read error keeps the hook's existing behaviour: the failing check reads
# as "not a matter folder" and the worktree/temp rules alone decide.
# ---------------------------------------------------------------------------
POINTER_NAMES = ("coclerk.json", "probanda.json")


def _case_data_root():
    """case_data_root from the device settings file, or None."""
    override = os.environ.get("COCLERK_CONFIG_PATH")
    if override:
        candidates = [override]
    else:
        roaming = os.environ.get("APPDATA") or os.path.join(os.path.expanduser("~"), "AppData", "Roaming")
        candidates = [os.path.join(roaming, "Coclerk", name) for name in ("probanda.json", "coclerk.json")]
    for candidate in candidates:
        try:
            with open(candidate, encoding="utf-8") as fh:
                root = json.load(fh).get("case_data_root")
        except (OSError, ValueError, AttributeError):
            continue
        if isinstance(root, str) and root:
            return root
    return None


def recorded_matter_folders():
    """The absolute path of each matter folder practice data records, or [] when
    the record cannot be read: the check then adds nothing."""
    import sqlite3
    root = _case_data_root()
    if not root:
        return []
    db = os.path.join(root, "_practice", "practice.db")
    if not os.path.isfile(db):
        return []
    library = os.path.dirname(os.path.abspath(root))
    con = sqlite3.connect("file:" + Path(db).as_posix() + "?mode=ro", uri=True)
    try:
        rows = con.execute("SELECT value FROM kv_store WHERE namespace = 'item'").fetchall()
    finally:
        con.close()
    folders = []
    for (value,) in rows:
        try:
            item = json.loads(value)
        except ValueError:
            continue
        if not isinstance(item, dict) or item.get("kind") != "matter":
            continue
        data = item.get("data")
        folder = data.get("folder") if isinstance(data, dict) else None
        if isinstance(folder, str) and folder and not os.path.isabs(folder):
            folders.append(os.path.join(library, folder))
    return folders


_matter_folders = None


def matter_folder_roots():
    global _matter_folders
    if _matter_folders is None:
        try:
            _matter_folders = recorded_matter_folders()
        except Exception:
            _matter_folders = []
    return _matter_folders


def _under(path, root):
    child = os.path.normcase(os.path.abspath(path))
    parent = os.path.normcase(os.path.abspath(root)).rstrip("\\/")
    return child == parent or child.startswith(parent + os.sep)


def in_matter_folder(path):
    """Either check holds: an ancestor (of the nearest existing part) holds a
    matter pointer file, or practice data's folder record names an ancestor."""
    d = nearest_existing(path)
    for anc in (d, *d.parents):
        if any((anc / name).is_file() for name in POINTER_NAMES):
            return True
    return any(_under(path, root) for root in matter_folder_roots())


def follows(word):
    """rm follows a link only when the target ends in a slash or /."""
    return re.search(r"[\\/]\.?$", str(word)) is not None


def landing(path, follow):
    """Where `path` really lands: fully resolved when `follow`, else only its
    parent is resolved and the last name kept. Missing parts are re-appended.
    No lexical abspath first: on POSIX a `..` after a link climbs from its target."""
    if follow:
        return Path(os.path.realpath(path))
    head, name = os.path.split(path)
    return Path(os.path.realpath(head), name)


# The component holding a glob character, from that character to the next separator.
GLOB_PART_RE = re.compile(r"[*?[][^\\/]*")


def landings(path, follow):
    """Every place `path` lands under rm's rule. A glob in a component rm
    follows (any but the last, or the last when `follow`) is judged by each
    real match, not by its spelling. With no match the shell passes the
    pattern on as written, so that literal path is judged."""
    path = str(path)
    glob_end = max((m.end() for m in GLOB_PART_RE.finditer(path)), default=None)
    if glob_end is None or (glob_end == len(path) and not follow):
        return [landing(path, follow)]
    matches = glob.glob(path[:glob_end]) or [path[:glob_end]]
    return [landing(m + path[glob_end:], follow) for m in matches]


def exempt(path, follow=None):
    """True when `path` really lands inside a Git worktree or the OS temp dir,
    and not inside a client matter folder: a matter-folder hit only ever adds
    protection (spec 2026-10-16, §9 Q1). follow=None (rm's rule unknown)
    requires both landings to be exempt. A `~` form that did not expand, or a
    path or glob that fails to resolve, is not exempt."""
    if str(path).startswith("~"):
        return False
    rules = (False, True) if follow is None else (follow,)
    try:
        return all((in_git_worktree(t) or in_temp_dir(t)) and not in_matter_folder(t)
                   for f in rules for t in landings(path, f))
    except (OSError, ValueError, RuntimeError):
        return False


def split_simple_command(command):
    """Words of a single simple command, or None when splitting it would take
    real shell parsing (operators, escapes, substitutions, adjacent quotes)."""
    if "\n" in command or "\r" in command:
        return None
    words, pos = [], 0
    while True:
        while pos < len(command) and command[pos] in " \t":
            pos += 1
        if pos == len(command):
            return words
        m = WORD_RE.match(command, pos)
        if m is None or (m.end() < len(command) and command[m.end()] not in " \t"):
            return None
        dq, sq, bare = m.groups()
        if dq is not None:
            words.append((dq, "double"))
        elif sq is not None:
            words.append((sq, "single"))
        else:
            words.append((bare, "bare"))
        pos = m.end()


def lone_rm_targets(command, cwd):
    """(word, path) for each target of a single rm/unlink, after an optional
    `cd <absolute dir> &&`, with the word joined to the directory it runs in."""
    head, sep, tail = command.partition("&&")
    cd = split_simple_command(head) if sep else None
    if cd and len(cd) == 2 and cd[0][0] == "cd" and Path(cd[1][0]).is_absolute():
        cwd, command = cd[1][0], tail
    words = split_simple_command(command) or [("", "")]
    if words[0][0] not in REWRITE_COMMANDS:
        return []
    return [(t, (Path(cwd) / t).as_posix()) for t, _ in words[1:] if t not in REWRITE_FLAGS]


def cwd_free(targets):
    """Every target of a lone rm/unlink resolves into a Git worktree or the OS
    temp dir with no variable, brace, tilde or dot-led part."""
    return targets != [] and all(
        "/." not in path and not set("${") & set(path) and not word.startswith("~")
        and exempt(path, follows(word))
        for word, path in targets)


RM_RE = BASH_PATTERNS[0][1]
CD_COMMANDS = {"cd", "pushd", "popd"}
CD_RE = re.compile(r"\s*(?:(?:builtin|command)\s+)?\\?(?:cd|pushd|popd)(?![\w./-])")
# A redirection on an rm (`2>/dev/null`, `2>&1`, `&>log`) names no target.
REDIRECT_RE = re.compile(r"(?<!\S)(?:\d+|&)?(?:>>?|<)&?\s*[^\s;&|<>]*")
# A word carrying quotes or escapes; with them removed it may spell a command (`"rm"`, `r''m`, `\cd`).
QUOTED_WORD_RE = re.compile(r"(?:\"[^\"]*\"|'[^']*'|\\.|[^\s\"'\\;&|<>()])+")


def spelled_command(text):
    """What the command word of `text` spells once its quotes and escapes are removed."""
    m = QUOTED_WORD_RE.search(text)
    return re.sub(r"[\"'$\\]", "", m.group(0)) if m else ""


def shell_segments(command):
    """(text, bare) for each run of the command between ; & | and newlines
    outside quotes. `bare` empties each quoted span that runs nothing (no $( or
    backtick), so a delete word inside a quoted message is not read as a command."""
    segments, text, bare, i = [], "", "", 0
    while i < len(command):
        ch = command[i]
        if ch == "\\":
            escaped = " " if command[i + 1:i + 2] == "\n" else command[i:i + 2]   # line continuation
            text += escaped
            bare += escaped
            i += 2
            continue
        if ch in "\"'":
            end = i + 1
            while end < len(command) and command[end] != ch:
                end += 2 if ch == '"' and command[end] == "\\" else 1
            span = command[i:end + 1]
            text += span
            bare += span if ch == '"' and ("$(" in span or "`" in span) else ch + ch
            i = end + 1
            continue
        if ch in ";|\n" or (ch == "&" and command[i - 1:i] not in ("<", ">") and command[i + 1:i + 2] != ">"):
            segments.append((text, bare))
            text = bare = ""
        else:
            text += ch
            bare += ch
        i += 1
    segments.append((text, bare))
    return segments


def host_word(word):
    """An msys /c/... word as C:/..., anything else unchanged."""
    msys = MSYS_ABS_RE.match(word)
    return msys.group(1).upper() + ":/" + msys.group(2) if msys else word


def rm_targets(command, cwd):
    """(word, path) for every target of every rm/unlink in the command, each
    joined to the directory it runs in after any `cd`. None when some rm/unlink's
    words or directory cannot be told: then no exemption applies (ADR 0014)."""
    targets = []
    for text, bare in shell_segments(command):
        spelled = spelled_command(text)
        if RM_RE.search(bare) or spelled in REWRITE_COMMANDS:
            words = split_simple_command(REDIRECT_RE.sub("", text).strip())
            if not words or words[0][0] not in REWRITE_COMMANDS or cwd is None:
                return None
            for word, _ in words[1:]:
                if word.startswith("-"):
                    continue
                path = host_word(expand_vars(word))
                if path.startswith("~") or set("${`") & set(path):
                    return None                       # a target only the shell can expand
                targets.append((word, (Path(cwd) / path).as_posix()))
        elif CD_RE.match(bare) or spelled in CD_COMMANDS:
            words = split_simple_command(text.strip())
            known = (words and len(words) == 2 and words[0][0] == "cd"
                     and not words[1][0].startswith(("~", "-")) and not set("${`") & set(words[1][0]))
            cwd = Path(cwd, host_word(words[1][0])) if known and cwd is not None else None
    return targets


DEVICE_RM_FLAGS = {"-f", "--force"}


def device_word(text, quoting):
    """The word re-emitted for the device shell with its original quoting, or
    None when it could expand to anything but a glob, a leading $HOME/ or a
    bare ~/ (or a bare leading # would start a comment)."""
    rest = text[len(HOME_VAR):] if text.startswith(HOME_VAR) else text
    if "$" in rest or "`" in text or "{" in text:
        return None
    if text.startswith("~") and not (quoting == "bare" and text.startswith("~/")):
        return None
    if quoting == "bare" and text.startswith("#"):
        return None
    if quoting == "single":
        return "'" + text + "'"
    if quoting == "double":
        return '"' + text + '"'
    return text


def device_refusal(message):
    return 'builtin echo "refused: ' + message + '; use file_ops__trash" >&2; builtin exit 1'


def under_mount(text, quoting):
    """A word spelled as $HOME/mnt or under it (a bare ~/ read as $HOME/)."""
    spelled = HOME_VAR + text[2:] if quoting == "bare" and text.startswith("~/") else text
    return spelled == HOME_VAR + DEVICE_MOUNT or spelled.startswith(HOME_VAR + DEVICE_MOUNT + "/")


def device_rm_rewrite(command):
    """A lone non-recursive rm on the device, after an optional `cd <word> &&`,
    rewritten so the device refuses every target whose parent directory really
    lands in or above $HOME/mnt, or in any $HOME/mnt entry's real location,
    before rm runs; None when not eligible. Only the parent is resolved: a
    non-recursive rm never follows the last component. Each glob expands once,
    and rm gets exactly the targets that were checked."""
    prefix = ""
    head, sep, tail = command.partition(" && ")
    cd_words = split_simple_command(head) if sep else None
    if cd_words and len(cd_words) == 2 and cd_words[0] == ("cd", "bare"):
        cd = device_word(*cd_words[1])
        if cd is None or under_mount(*cd_words[1]):
            return None
        prefix, command = "cd " + cd + " && ", tail
    words = split_simple_command(command)
    if not words or words[0] != ("rm", "bare"):
        return None
    flags, targets = [], []
    for text, quoting in words[1:]:
        if text.startswith("-"):
            if text not in DEVICE_RM_FLAGS:
                return None
            flags.append(text)
            continue
        word = device_word(text, quoting)
        if word is None or under_mount(text, quoting):
            return None
        targets.append(word)
    if not targets:
        return None
    in_matter = device_refusal("$r is in a matter folder")
    return (
        "( builtin unset -f rm realpath dirname basename cd unset exit echo test 2>/dev/null; "
        "unalias -a 2>/dev/null; "
        + prefix
        + 'm=$(command -p realpath -m -- "$HOME/mnt") && ok=() && for t in ' + " ".join(targets) + "; do "
        + 'd=$(command -p dirname -- "$t") && r=$(command -p realpath -m -- "$d") || builtin exit 1; '
        + 'r="${r%/}"; '
        + "if [[ -z $r ]]; then " + device_refusal("/ is above the matter folders") + "; fi; "
        + 'case "$r/" in "$m/"*) ' + in_matter + ";; esac; "
        + 'case "$m/" in "$r/"*) ' + device_refusal("$r is above the matter folders") + ";; esac; "
        + 'for e in "$HOME"/mnt/*; do em=$(command -p realpath -m -- "$e") || builtin exit 1; '
        + 'em="${em%/}"; case "$r/" in "$em/"*) ' + in_matter + ";; esac; done; "
        + 'ok+=("$t"); '
        + "done && command -p rm " + "".join(f + " " for f in flags) + '-- "${ok[@]}" )'
    )


def block_message(label, offending):
    lines = [
        "Do not delete this directly - call the file-manager tool file_ops__trash with this"
        " path; it moves the item to <root>/" + TRASH_DIRNAME + "/<same relative path>.",
        "Blocked pattern: " + label,
    ]
    if offending is not None:
        lines.append("Location outside any Git worktree: " + str(Path(os.path.abspath(offending))))
    lines.append(
        "If file_ops__trash is not available in this session, the file-manager plugin is not"
        " enabled and this deletion is refused: tell the practitioner that it needs file-manager."
        " Never fall back to a shell move or delete, or the Write tool."
    )
    lines.append(
        "Then retry your original task using the moved file's new location if needed."
    )
    return "\n".join(lines)


def emit(decision, reason, updated_input=None):
    output = {
        "hookEventName": "PreToolUse",
        "permissionDecision": decision,
        "permissionDecisionReason": reason,
    }
    if updated_input is not None:
        output["updatedInput"] = updated_input
    sys.stdout.write(json.dumps({"hookSpecificOutput": output}) + "\n")


def main():
    payload = json.load(sys.stdin)
    tool_name = payload.get("tool_name") or ""
    if not TOOL_RE.fullmatch(tool_name):
        return 0
    tool_input = payload.get("tool_input") or {}
    command = tool_input.get("command")
    if not isinstance(command, str) or not command.strip():
        return 0

    scanned = command if tool_name == "PowerShell" else strip_stored_heredocs(command)
    cwd = Path(payload.get("cwd") or os.getcwd())
    hidden_label, hidden = reveal_hidden(scanned, tool_name, cwd)
    label = find_destructive(scanned, tool_name) or hidden_label
    if label is None:
        return 0

    if cwd_free(lone_rm_targets(command, cwd) if tool_name == "Bash" else []):
        return 0

    offending = None
    if tool_name in ("Bash", "PowerShell"):
        # A relative rm target counts too, chained or not: through a link it can leave the cwd.
        targets = rm_targets(scanned, cwd) if tool_name == "Bash" else []
        locations = [(cwd, True), *[(p, None) for p in extract_abs_paths("\n".join([scanned, *hidden]))],
                     *[(path, follows(word)) for word, path in targets or []]]
        offending = next(
            (loc for loc, follow in locations
             if not (SHELL_BINARY_RE.search(str(loc)) or PATH_ENTRY_RE.search(str(loc))
                     or exempt(loc, follow))),
            None,
        )
        if offending is None and targets is not None:
            return 0

    if tool_name not in ("Bash", "PowerShell"):
        # Its own handler: a bug here must deny, never fail open through main()'s.
        try:
            guarded = device_rm_rewrite(command) if hidden_label is None else None
        except Exception:
            guarded = None
        if guarded is not None:
            emit("allow", "rm guarded on the device: refuses any target in or above the matter folders",
                 {**tool_input, "command": guarded})
            return 0

    emit("deny", block_message(label, offending))
    return 0


if __name__ == "__main__":
    try:
        try:
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
        sys.exit(main())
    except SystemExit:
        raise
    except Exception as exc:  # fail OPEN, loudly
        sys.stderr.write(
            "redirect-delete-to-trash hook error (allowing command): "
            + type(exc).__name__ + ": " + str(exc) + "\n"
        )
        sys.exit(0)
