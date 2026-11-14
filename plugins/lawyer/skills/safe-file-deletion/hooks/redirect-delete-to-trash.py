#!/usr/bin/env python3
"""Claude Code PreToolUse hook (matcher: Bash|PowerShell|mcp__(.+__)?device_bash).

Refuses hard deletes issued outside a Git worktree and the OS temp dir, and
points to the file-manager plugin's file_ops__trash tool, which moves the item to
<matter root>/TRASH/<same relative path>, or for a path in no matter to
~/TRASH/<path relative to home> (<drive>:/TRASH/... outside home). While
file-manager is enabled in the session, a lone delete that its trash-rewrite hook
turns into a move is rewritten here the same way (rule 3b). Without file-manager
this hook moves nothing, so no file Probanda did not create is deleted or moved.

Policy (scope rules, rationale): source/skills/safe-file-deletion/SKILL.md

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
     PowerShell: a lone delete command whose every argument is a bare
     switch or an absolute path landing there -> allow.
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
  3b. Bash and PowerShell: a lone delete that delete_targets.trash_targets
     accepts (every target a literal absolute path outside a worktree and the
     temp dir, or in a matter folder), while delete_targets.file_manager_root
     finds file-manager's session marker -> allow, rewritten into the same call
     to file-manager's trash CLI that file-manager's own hook returns, so the
     two never conflict (a deny here would beat its allow). Any doubt or error
     in this step falls through to 4.
  4. Otherwise -> deny (JSON permissionDecision on stdout, exit 0), naming the
     file_ops__trash tool.

Do not restrict (the policy covers none of these; each was once a false deny):
  - A lone delete of absolute temp or worktree targets from any cwd, in any
    spelling: msys /c/..., a leading $HOME/$USERPROFILE (expanded even when
    the hook runs without HOME, as Claude Code on Windows does), or a
    lone PowerShell delete. The cwd is not touched by such a delete. A target
    in a client matter folder is still refused.
  - A dot-led folder such as ~/.claude: it is a worktree like any other.
    Only a `.` or `..` component, or a dot-led glob (`.?` matches `..`),
    defeats the lone-delete exemption.
  - An rm word that is only printed or searched (`grep "rm -rf" f`, a
    printf of a hook payload piped to `python hook.py`): nothing is deleted.
    It still counts when a shell could run it (`bash -c "rm x"`, a pipe or
    redirect into a shell, `$(...)`).

Registered in source/lawyer/plugin.json (shipped with the lawyer plugin) and, on
a dev machine, in ~/.claude/settings.json. Fails OPEN on any unexpected error:
a bug here must never be able to block all shell use.
"""
import base64
import codecs
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "shared" / "scripts"))
import hook_io  # noqa: E402
from delete_targets import (  # noqa: E402
    MSYS_ABS_RE, PS_DELETE_COMMANDS, PS_SWITCH_RE, REWRITE_COMMANDS, WIN_ABS_RE,
    exempt, file_manager_root, follows, host_word, lone_rm_targets, plain_parts, split_simple_command,
    trash_command, trash_targets,
)

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
# Absolute paths embedded inside a larger token, e.g. the body of
# `python -c "import shutil; shutil.rmtree(r'C:\\matter\\x')"`.
EMBEDDED_WIN_RE = re.compile(r"(?<![\w:])[A-Za-z]:[\\/][^\"'\r\n|<>&;]*")
EMBEDDED_MSYS_RE = re.compile(r"(?<![\w:])/[A-Za-z]/[^\"'\r\n|<>&;]*")

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


# Commands that print or search their arguments and never run them, and a
# Python interpreter running a named script (stdin is its data, not shell text).
NON_RUNNING = {"grep", "egrep", "fgrep", "rg", "echo", "printf"}
PY_NAME_RE = re.compile(r"python[\d.]*|py")


def rm_only_printed(command):
    """True when every simple command is a NON_RUNNING one, or a Python script
    run with no rm/unlink word, so an rm word in the text is only an argument
    printed or searched (`grep "rm -rf" f`), never run. `bash -c "rm x"`,
    `echo "rm x" | bash` and an rm inside a `$(...)` still count."""
    word_rx = WIN_SHELL_PATTERNS[0][1]
    for text, _ in shell_segments(command):
        if not text.strip():
            continue
        if "$(" in text or "`" in text:
            return False
        words = split_simple_command(text.strip())
        if not words:
            return False
        name = re.split(r"[\\/]", words[0][0])[-1].lower()
        name = name[:-4] if name.endswith(".exe") else name
        if name in NON_RUNNING:
            continue
        if (PY_NAME_RE.fullmatch(name) and len(words) > 1 and words[1][0].endswith(".py")
                and not words[1][0].startswith("-") and not word_rx.search(text)):
            continue
        return False
    return True


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
        if label == "POSIX rm/unlink" and tool_name == "Bash" and rm_only_printed(command):
            continue          # the rm word is only printed or searched, never run
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






def cwd_free(targets):
    """Every target of a lone rm/unlink resolves into a Git worktree or the OS
    temp dir, outside any client matter folder, with no variable (but a leading
    home form), brace, tilde, `.` or `..` part."""
    return targets != [] and all(
        plain_parts(path) and not set("${") & set(path) and not word.startswith("~")
        and exempt(path, follows(word))
        for word, path in targets)




def ps_lone_free(command):
    """A lone PowerShell delete (a PS_DELETE_COMMANDS name) whose every argument is a bare
    switch or an absolute path landing in a Git worktree or the OS temp dir,
    outside any client matter folder. A `-Name:value` switch, a comma list, a
    variable or a relative word fails."""
    words = split_simple_command(command.strip())
    if not words or words[0][0].lower() not in PS_DELETE_COMMANDS:
        return False
    targets = [t for t, _ in words[1:] if not PS_SWITCH_RE.fullmatch(t)]
    return targets != [] and all(
        WIN_ABS_RE.match(t) and not set("$@,{}~") & set(t) and plain_parts(t) and exempt(t)
        for t in targets)


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




def rm_targets(command, cwd):
    """(word, path) for every target of every rm/unlink in the command, each
    joined to the directory it runs in after any `cd`. None when some rm/unlink's
    words or directory cannot be told: then no exemption applies (ADR 0014)."""
    targets = []
    for text, bare in shell_segments(command):
        spelled = spelled_command(text)
        # Quote marks dropped first: a closing quote is no command start, so
        # `git -C "<repo>" rm x` is git's rm. A quoted rm the shell runs
        # (`"rm" x`, `""rm x`) is still caught, by `spelled`.
        if RM_RE.search(re.sub(r"[\"']", "", bare)) or spelled in REWRITE_COMMANDS:
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
    return 'builtin echo "refused: ' + message + '; use the file-manager trash tool" >&2; builtin exit 1'


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
        "Do not delete this directly - move this path with the file-manager plugin's trash tool;"
        " call it once per path. It moves a matter file to <matter root>/" + TRASH_DIRNAME + "/<same relative"
        " path>, and any other path to ~/" + TRASH_DIRNAME + "/<path relative to home>, or"
        " <drive>:/" + TRASH_DIRNAME + "/<path relative to the drive root> outside home.",
        "With file-manager enabled, a lone rm or Remove-Item naming literal absolute paths is moved"
        " to " + TRASH_DIRNAME + " automatically; this command is not one (a chain, a glob, a"
        " variable, a relative path or another delete command).",
        "Blocked pattern: " + label,
    ]
    if offending is not None:
        lines.append("Location outside any Git worktree: " + str(Path(os.path.abspath(offending))))
    lines.append(
        "If that trash tool is not available in this session, the file-manager plugin is not"
        " enabled and this deletion is refused: ask the practitioner to delete it themselves or"
        " to enable file-manager. Never fall back to a shell move or delete, or the Write tool."
    )
    lines.append(
        "Then retry your original task using the moved file's new location if needed."
    )
    return "\n".join(lines)


def main():
    payload = hook_io.payload()
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
    if tool_name == "PowerShell" and ps_lone_free(command):
        return 0

    if tool_name in ("Bash", "PowerShell") and hidden_label is None:
        # Its own handler: any doubt here must fall through to the deny, never fail open.
        try:
            paths = trash_targets(tool_name, command, cwd)
            root = file_manager_root(payload) if paths is not None else None
        except Exception:
            root = None
        if root is not None:
            # The rewrite file-manager's own hook returns, so the two never disagree.
            return hook_io.pre_tool("allow", "delete moved to TRASH by file-manager",
                                    updatedInput={**tool_input, "command": trash_command(tool_name, root, paths)})

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
            return hook_io.pre_tool("allow", "rm guarded on the device: refuses any target in or above the matter folders",
                                    updatedInput={**tool_input, "command": guarded})

    return hook_io.deny(block_message(label, offending))


if __name__ == "__main__":
    hook_io.run(main, "redirect-delete-to-trash")
