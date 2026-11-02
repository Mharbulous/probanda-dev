#!/usr/bin/env python3
"""Flag a Probanda internal term in text a practitioner sees.

Usage:
  python scripts/check_internals.py      list every hit; exit 1 on any

The runtime doctrine `.claude/skills/shared/internals-confidentiality.md` keeps
Probanda's internals out of everything user-visible. This lint enforces it where
the text is fixed in source, in four places:

  hook messages    every prose string in a shipped hook script that a plugin.json
                   wires to an event other than SessionStart, because a refusal is
                   quoted to the practitioner verbatim. A SessionStart note only
                   briefs the session, so it may name tools. Docstrings are not read.
  page templates   the visible text of each HTML template under
                   source/lawyer/mcp/src/templates/ (scripts, styles, comments,
                   tags and attributes removed).
  file names       each line of the data server's TypeScript source (tests excluded)
                   that builds a path: the arguments of a join(, resolve( or basename(
                   call (as a function or on path, never an array's .join(), and each
                   return line of a top-level function whose name says it builds a
                   name, folder, directory, path or label (filingFolderName, typeLabel).
  error messages   each error the data server's submission code throws or refuses with,
                   and each refusal's `detail`, which the drafting skills quote verbatim:
                   no Writing named by its row id, no table.column, no db_meta or
                   snapshot table, no SQL. A bare column name (affidavit_number) and a
                   tool's own parameter names are not caught.
  mockup comments  each line of the data server's submission code whose string writes an
                   HTML comment naming a filing or proceeding by its id, because a mockup
                   lies in the practitioner's own draft folder.

A line holding the marker `internals-ok` is exempt: code that is not a message (a
query) or that must name an old internal path to move it away. The developer plugin
is not checked. "Work Board", "Writing" and "Loose Threads" are product vocabulary
and never flagged.

Exit codes: 0 clean, 1 a hit. Standard library only.
"""
import ast
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import plugin_layout  # noqa: E402

REPO = Path(__file__).resolve().parent.parent
EXEMPT = "internals-ok"
TEMPLATES = Path("source/lawyer/mcp/src/templates")
SERVER_SRC = Path("source/lawyer/mcp/src")
NOT_CHECKED = ("developer",)

# (label, pattern). Each is a term the doctrine lists as internal.
TERMS = [
    ("tool name", re.compile(r"\b[a-z][a-z0-9]*(?:_[a-z0-9]+)*__[a-z][a-z0-9_]*\b")),
    ("filing id", re.compile(r"\bfiling[_ ]ids?\b", re.I)),
    ("folder code", re.compile(r"\bfolder[_ ]codes?\b", re.I)),
    ("stock type", re.compile(r"\bstock[_ ](?:type|kind)s?\b", re.I)),
    ("rule id", re.compile(r"\brule[_ ]ids?\b", re.I)),
    ("node path", re.compile(r"\bnode[_ ](?:path|id)s?\b", re.I)),
    ("schema term", re.compile(r"\b(?:db_path|session_token|layout_snapshot|General_writing)\b")),
    ("schema version", re.compile(r"\bschema v\d+\b", re.I)),
    ("SQL", re.compile(r"\b(?:SELECT .+ FROM|INSERT INTO|UPDATE \w+ SET|DELETE FROM)\b")),
    ("stock type name", re.compile(r"\bUnstructured(?:\.md)?\b|\bUNS\b")),
    ("filing folder", re.compile(r"\bFiling (?:\d+|<id>|\$\{|\{)")),
    ("skill file", re.compile(r"\bSKILL\.md\b|\b(?:skills|references|shared|hooks)/[\w./-]+\.(?:md|py)\b")),
    ("environment variable", re.compile(r"\bCOCLERK_[A-Z_]+\b")),
    ("design record", re.compile(r"\bADR \d+\b|\bdocs/adrs?/", re.I)),
    ("issue number", re.compile(r"(?<![\w&])#\d{3,}\b")),
]

PATH_CALL = re.compile(r"(?:(?<![.\w])|(?<![.\w])path\.)(?:join|resolve|basename)\(")
STRING = re.compile(r"\"[^\"]*\"|'[^']*'|`[^`]*`")
INTERPOLATION = re.compile(r"\$\{[^}]*\}")  # code inside a template literal, not its text
# A top-level function, and whether its name says it builds a file or folder name or a label.
FUNCTION = re.compile(r"^(?:export\s+)?(?:async\s+)?function\s+(\w+)")
NAME_BUILDER = re.compile(r"^(?!is[A-Z]|has[A-Z])(?:\w*(?:Name|Folder|Dir|Path|Label)s?(?:For\w*)?|(?:name|folder|dir|path|label)\w*)$")


def hits(text):
    """Each (label, matched text) the doctrine forbids in `text`."""
    return [(label, m.group(0)) for label, rx in TERMS for m in rx.finditer(text)]


def wired_beyond_session_start(repo):
    """The file names of hook scripts some plugin.json runs on an event other than SessionStart."""
    names = set()
    for manifest in (repo / "source").glob("*/plugin.json"):
        for event, groups in json.loads(manifest.read_text(encoding="utf-8")).get("hooks", {}).items():
            if event == "SessionStart":
                continue
            for group in groups:
                for hook in group.get("hooks", []):
                    names |= {Path(arg).name for arg in hook.get("args", []) if arg.endswith(".py")}
    return names


def hook_scripts(repo):
    wired = wired_beyond_session_start(repo)
    return sorted({path for plugin, spec in plugin_layout.plugins(repo).items() if plugin not in NOT_CHECKED
                   for path in plugin_layout.hook_scripts(repo, spec) if path.name in wired})


def docstring_ids(tree):
    ids = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            body = node.body
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
                ids.add(id(body[0].value))
    return ids


def prose_strings(source):
    """(line, text) of each prose string: three or more words, not a docstring. An f-string's
    literal parts are joined with `{}` where each value goes."""
    tree = ast.parse(source)
    skip = docstring_ids(tree)
    lines = source.splitlines()
    out = []
    for node in ast.walk(tree):  # breadth first, so an f-string is met before its parts
        if isinstance(node, ast.JoinedStr):
            text = "".join(v.value if isinstance(v, ast.Constant) else "{}" for v in node.values)
            skip |= {id(v) for v in node.values}
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in skip:
            text = node.value
        else:
            continue
        if len(text.split()) < 3:
            continue
        if any(EXEMPT in line for line in lines[node.lineno - 1:node.end_lineno]):
            continue
        out.append((node.lineno, text))
    return out


def check_hooks(repo):
    found = []
    for path in hook_scripts(repo):
        if not path.is_file():
            continue
        for line, text in prose_strings(path.read_text(encoding="utf-8")):
            for label, term in hits(text):
                found.append(f"{path.relative_to(repo).as_posix()}:{line}: hook message holds {label} `{term}`")
    return found


class _Visible(HTMLParser):
    """The text of an HTML page a reader sees, with its line numbers."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.hidden = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.hidden += 1

    def handle_endtag(self, tag):
        if tag in ("script", "style") and self.hidden:
            self.hidden -= 1

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append((self.getpos()[0], data))


def check_templates(repo):
    found = []
    for path in sorted((repo / TEMPLATES).rglob("*.html")):
        lines = path.read_text(encoding="utf-8").splitlines()
        parser = _Visible()
        parser.feed("\n".join(lines))
        parser.close()
        for line, data in parser.parts:
            if EXEMPT in lines[line - 1]:
                continue
            for label, term in hits(data):
                found.append(f"{path.relative_to(repo).as_posix()}:{line}: page text holds {label} `{term}`")
    return found


def path_arguments(line):
    """The argument text of each path call on one line, up to its closing parenthesis
    (or the line's end when the call runs on), so a message elsewhere on the line is not read."""
    out = []
    for m in PATH_CALL.finditer(line):
        depth, end = 1, len(line)
        for i in range(m.end(), len(line)):
            depth += {"(": 1, ")": -1}.get(line[i], 0)
            if depth == 0:
                end = i
                break
        out.append(line[m.end():end])
    return out


def check_file_names(repo):
    found = []
    for path in sorted((repo / SERVER_SRC).rglob("*.ts")):
        if path.name.endswith((".test.ts", ".d.ts")) or "templates" in path.relative_to(repo / SERVER_SRC).parts:
            continue
        builder = False
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            header = FUNCTION.match(line)
            if header:
                builder = bool(NAME_BUILDER.search(header.group(1)))
            if EXEMPT in line or line.lstrip().startswith(("//", "*", "/*")):
                continue
            built = path_arguments(line)
            if builder and line.lstrip().startswith("return "):
                built.append(line)
            text = " ".join(INTERPOLATION.sub("{}", s) for s in STRING.findall(" ".join(built)))
            for label, term in hits(text):
                found.append(f"{path.relative_to(repo).as_posix()}:{n}: file name holds {label} `{term}`")
    return found


# What a data-server error may not name: the Writing by its row id, a table.column, a database
# table or SQL. A tool's own parameter names stay: a call the session got wrong names them.
ERROR_TERMS = [
    ("filing id", re.compile(r"\b[Ff]iling (?:\d+|\{\}|<id>)")),
    ("column name", re.compile(r"\b[a-z]+(?:_[a-z]+)*\.[a-z]+_[a-z_]+\b")),
    ("table name", re.compile(r"\bdb_meta\b|\b\w+_snapshot row\b")),
    ("SQL", TERMS[[label for label, _ in TERMS].index("SQL")][1]),
]
ERROR_START = re.compile(r"new \w*Error\(\s*|\b(?:refused?|bad)\(\s*|\bdetail:\s*")


def check_errors(repo):
    """The message of each error the data server throws, and each refusal's `detail`, in the
    submission code the drafting skills quote verbatim."""
    found = []
    for path in sorted((repo / SERVER_SRC / "submission").rglob("*.ts")):
        if path.name.endswith((".test.ts", ".d.ts")):
            continue
        text = path.read_text(encoding="utf-8")
        lines = text.splitlines()
        for m in ERROR_START.finditer(text):
            first = STRING.match(text, m.end())
            if first is None:
                continue
            # A message may run on over `+` joins: read the strings up to the call's end.
            end = text.find("\n", first.end())
            chunk = text[m.end():text.find(");", m.end()) if text.find(");", m.end()) != -1 else end]
            line = text.count("\n", 0, m.start()) + 1
            if any(EXEMPT in lines[i] for i in range(line - 1, line - 1 + chunk.count("\n") + 1)):
                continue
            message = " ".join(INTERPOLATION.sub("{}", s) for s in STRING.findall(chunk))
            for label, rx in ERROR_TERMS:
                for hit in rx.finditer(message):
                    found.append(f"{path.relative_to(repo).as_posix()}:{line}: error message holds {label} `{hit.group(0)}`")
    return found


# An HTML comment that names a filing or proceeding by an interpolated id, read before
# INTERPOLATION removes the `${...}`.
MOCKUP_ID_COMMENT = re.compile(r"<!--[^>]*\b(?:filing|proceeding)(?:_id)? \$\{")


def check_mockup_comments(repo):
    """Each string in the submission code that writes a filing or proceeding id into a mockup."""
    found = []
    for path in sorted((repo / SERVER_SRC / "submission").rglob("*.ts")):
        if path.name.endswith((".test.ts", ".d.ts")):
            continue
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if EXEMPT in line:
                continue
            for s in STRING.findall(line):
                hit = MOCKUP_ID_COMMENT.search(s)
                if hit:
                    found.append(f"{path.relative_to(repo).as_posix()}:{n}: mockup comment holds record id `{hit.group(0)}`")
    return found


def violations(repo=REPO):
    repo = Path(repo)
    return (check_hooks(repo) + check_templates(repo) + check_file_names(repo) + check_errors(repo)
            + check_mockup_comments(repo))


def main():
    found = violations()
    for line in found:
        print(line)
    print(f"check_internals: {len(found)} hit(s)")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
