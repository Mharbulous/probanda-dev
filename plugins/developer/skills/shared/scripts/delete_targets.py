"""Delete-target parsing shared by the delete hooks (lawyer's redirect-delete-to-trash and
file-manager's trash-rewrite), so both judge a delete by one copy of the rules.

The parsers read a lone delete's targets; the location checks say where a path really lands
(a Git worktree, the OS temp dir, a client matter folder). trash_targets() is the one test of
whether a lone delete may become a move to TRASH: both hooks call it, so the lawyer hook
stands aside for exactly the commands file-manager rewrites.
"""
import glob
import json
import os
import re
import sys
import tempfile
from pathlib import Path

WIN_ABS_RE = re.compile(r"^[A-Za-z]:[\\/]")
MSYS_ABS_RE = re.compile(r"^/([A-Za-z])/(.*)$")

# Rewriter. A word of a simple command: double-quoted (no escapes or backticks),
# single-quoted, or bare (no quotes, escapes, operators or parentheses).
WORD_RE = re.compile(r'"([^"\\`]*)"|\'([^\']*)\'|([^\s"\'\\;&|<>()`]+)')
REWRITE_COMMANDS = {"rm", "unlink"}
REWRITE_FLAGS = {"-r", "-R", "-f", "-rf", "-fr", "--recursive", "--force"}


def host_word(word):
    """An msys /c/... word as C:/..., anything else unchanged."""
    msys = MSYS_ABS_RE.match(word)
    return msys.group(1).upper() + ":/" + msys.group(2) if msys else word


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
#      relative to the litigation library (the parent of case_data_root), or
#      absolute for a folder outside it. The
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
        candidates = [os.path.join(roaming, "Probanda", "probanda.json")] + [
            os.path.join(roaming, "Coclerk", name) for name in ("probanda.json", "coclerk.json")]
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
        rows = con.execute("SELECT value FROM kv_store WHERE namespace = 'item'").fetchall()  # internals-ok: a query, not a message
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
        if isinstance(folder, str) and folder:
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
    # realpath on both sides: the target arrives fully resolved (landing), so a
    # recorded folder reached through a junction or symlink must resolve too.
    child = os.path.normcase(os.path.realpath(path))
    parent = os.path.normcase(os.path.realpath(root)).rstrip("\\/")
    return child == parent or child.startswith(parent + os.sep)


def in_matter_folder(path):
    """Either check holds: an ancestor (of the nearest existing part) holds a
    matter pointer file, or practice data's folder record names an ancestor."""
    d = nearest_existing(path)
    for anc in (d, *d.parents):
        try:
            if any((anc / name).is_file() for name in POINTER_NAMES):
                return True
        except OSError:
            # A read error (e.g. PermissionError from is_file) reads as "not a
            # matter folder": it must not leak into exempt()'s except and turn
            # a worktree/temp path into a denial.
            continue
    try:
        return any(_under(path, root) for root in matter_folder_roots())
    except OSError:
        return False


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
GLOB_CHARS = set("*?[")


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
    return [(t, (Path(cwd) / host_word(t if q == "single" else bash_home(t))).as_posix())
            for t, q in words[1:] if t not in REWRITE_FLAGS]


BASH_HOME_RE = re.compile(r"\$(?:(HOME|USERPROFILE)|\{(HOME|USERPROFILE)\})(?=/|$)")


def bash_home(word):
    """`word` with a leading $HOME/$USERPROFILE (braced or not) expanded. Claude
    Code on Windows runs hooks without HOME, so an unset one falls back to the
    user's home folder, as the `~/` form does."""
    m = BASH_HOME_RE.match(word)
    if m is None:
        return word
    home = os.environ.get(m.group(1) or m.group(2)) or os.path.expanduser("~")
    return home.replace("\\", "/") + word[m.end():]


def plain_parts(path):
    """No `.` or `..` component, and no dot-led component holding a glob (`.?`
    can match `..`). A dot-led name such as `.claude` is fine."""
    return all(not p.startswith(".") or (p not in (".", "..") and not GLOB_CHARS & set(p))
               for p in re.split(r"[\\/]", path))


PS_DELETE_COMMANDS = {"remove-item", "ri", "rm", "del", "erase", "rd", "rmdir"}
PS_SWITCH_RE = re.compile(r"-[A-Za-z]+")


# ---------------------------------------------------------------------------
# A lone delete that becomes a move to TRASH (file-manager's trash-rewrite hook).
# ---------------------------------------------------------------------------
# A target spelled as an absolute path: Windows, msys /c/..., or a leading $HOME/$USERPROFILE.
ABS_WORD_RE = re.compile(r"^(?:[A-Za-z]:[\\/]|/[A-Za-z]/|\$\{?(?:HOME|USERPROFILE)\}?/)")
UNRESOLVED_CHARS = set("*?[]{}$@,~`")
PS_TRASH_SWITCHES = {"-force", "-recurse", "-literalpath", "-path"}


def _trashable(path):
    """A literal path, with no glob, variable, tilde, `.` or `..` part, that is not
    exempt: outside a Git worktree and the OS temp dir, or inside a matter folder."""
    return (WIN_ABS_RE.match(path) is not None and not UNRESOLVED_CHARS & set(path)
            and plain_parts(path) and not exempt(path, False))


def trash_targets(tool_name, command, cwd):
    """The absolute host paths of a lone delete whose every target may move to TRASH, else None.

    Bash: a lone rm/unlink, flags -r/-f only, after an optional `cd <absolute dir> &&`, whose
    targets are spelled absolute and never end in a slash (rm would follow a link there).
    PowerShell: a lone Remove-Item or one of its aliases, switches -Force, -Recurse, -LiteralPath
    and -Path only, whose targets are Windows absolute paths. Every target must pass _trashable."""
    if tool_name == "Bash":
        targets = lone_rm_targets(command, cwd)
        if not targets or not all(ABS_WORD_RE.match(word) and not follows(word) for word, _ in targets):
            return None
        paths = [path for _, path in targets]
    elif tool_name == "PowerShell":
        words = split_simple_command(command.strip())
        if not words or words[0][0].lower() not in PS_DELETE_COMMANDS:
            return None
        switches = [w for w, _ in words[1:] if PS_SWITCH_RE.fullmatch(w)]
        if any(s.lower() not in PS_TRASH_SWITCHES for s in switches):
            return None
        paths = [w for w, _ in words[1:] if not PS_SWITCH_RE.fullmatch(w)]
    else:
        return None
    return paths if paths and all(_trashable(p) for p in paths) else None


# file-manager announces itself per session: its SessionStart hook writes a marker naming its
# plugin root, and a delete is rewritten only while that marker is present, its trash CLI is on
# disk and no settings file turns file-manager off. Claude Code tells a hook nothing about which
# plugins are enabled (a synced plugin is on without an enabledPlugins entry), so this is the
# signal; without it the lawyer hook denies.
MARKER_DIR = "probanda-file-manager-sessions"
SESSION_ID_RE = re.compile(r"[A-Za-z0-9_-]{1,128}")
TRASH_CLI = Path("files-mcp", "dist", "trash-cli.js")
MANAGED_SETTINGS = {
    "darwin": Path("/Library/Application Support/ClaudeCode/managed-settings.json"),
    "posix": Path("/etc/claude-code/managed-settings.json"),
}


def session_marker(session_id):
    """The marker file for this session, or None for a missing or odd session id."""
    if not isinstance(session_id, str) or not SESSION_ID_RE.fullmatch(session_id):
        return None
    return Path(tempfile.gettempdir(), MARKER_DIR, session_id)


def record_file_manager(session_id, plugin_root):
    """Writes this session's marker, naming file-manager's plugin root."""
    marker = session_marker(session_id)
    if marker is not None:
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text(plugin_root, encoding="utf-8")


def _settings_files(project_dir):
    claude = Path(project_dir, ".claude")
    files = [Path(os.path.expanduser("~"), ".claude", "settings.json"),
             claude / "settings.json", claude / "settings.local.json"]
    if os.name != "nt":
        files.append(MANAGED_SETTINGS["darwin" if sys.platform == "darwin" else "posix"])
    elif os.environ.get("ProgramFiles"):
        files.append(Path(os.environ["ProgramFiles"], "ClaudeCode", "managed-settings.json"))
    return files


def file_manager_off(project_dir):
    """True when any settings file sets a file-manager@<marketplace> entry of enabledPlugins
    to false, or a settings file is there but cannot be read."""
    for path in _settings_files(project_dir):
        if not path.is_file():
            continue
        try:
            plugins = json.loads(path.read_text(encoding="utf-8-sig")).get("enabledPlugins") or {}
            if any(name.split("@")[0] == "file-manager" and value is False for name, value in plugins.items()):
                return True
        except (OSError, ValueError, AttributeError):
            return True
    return False


def file_manager_root(payload):
    """file-manager's plugin root when its marker says it is enabled in this session, else None."""
    marker = session_marker(payload.get("session_id"))
    try:
        root = marker.read_text(encoding="utf-8").strip() if marker else ""
    except OSError:
        return None
    project = os.environ.get("CLAUDE_PROJECT_DIR") or payload.get("cwd") or os.getcwd()
    if not root or not Path(root, TRASH_CLI).is_file() or file_manager_off(project):
        return None
    return root


def _bash_quote(text):
    return "'" + text.replace("'", "'\\''") + "'"


def _ps_quote(text):
    return "'" + text.replace("'", "''") + "'"


def trash_command(tool_name, plugin_root, paths):
    """The command that moves each of `paths` to TRASH through file-manager's trash CLI."""
    cli = str(Path(plugin_root, TRASH_CLI))
    if tool_name == "PowerShell":
        return "& node " + " ".join(_ps_quote(w) for w in [cli, *paths])
    return "node " + " ".join(_bash_quote(w) for w in [cli, *paths])
