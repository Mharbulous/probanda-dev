"""The Python entry-point registry and its TypeScript consumers, for check_plugin.py."""
import ast
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from check_plugin_sources import NotApplicable, server_path  # noqa: E402

# Python entry points the data runtime imports live from the skills tree. A rename
# in the file breaks the installed plugin with no failing test, so each entry pins
# the symbols, and `consumers` the runtime files whose `from <module> import ...`
# must stay a subset of them, as paths inside the source folder of `server`. An
# entry is checked in the plugin that ships that server. A symbol may be dotted
# one level ("Cls.meth").
ENTRY_POINT_REGISTRY = (
    {
        "path": ".claude/skills/drafting-data/references/scripts/migrate_engine.py",
        "symbols": ("run", "MigrateError", "MigrateError.as_dict", "TARGET_SCHEMA_VERSION"),
        "server": "data",
        "consumers": ("src/submission/migrate.ts",),
    },
)


# --- entry-point-registry ----------------------------------------------------------------

def entry_point_violations(py_path, symbols):
    """The file must exist, parse, and define every name in `symbols` at module top
    level. A dotted symbol ("Cls.meth") requires a top-level `class Cls` defining `meth`."""
    if not os.path.isfile(py_path):
        return [f"{py_path}: file not found"]
    try:
        with open(py_path, encoding="utf-8") as f:
            source = f.read()
        tree = ast.parse(source, filename=py_path)
    except (OSError, SyntaxError, ValueError) as exc:
        return [f"{py_path}: could not parse ({exc})"]

    top_names = set()
    class_methods = {}
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            top_names.add(node.name)
            if isinstance(node, ast.ClassDef):
                class_methods[node.name] = {
                    n.name for n in node.body
                    if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
                }
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            top_names.update(alias.asname or alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            top_names.update(t.id for t in targets if isinstance(t, ast.Name))

    violations = []
    for symbol in symbols:
        if "." in symbol:
            cls_name, meth_name = symbol.split(".", 1)
            if meth_name not in class_methods.get(cls_name, ()):
                violations.append(f"{py_path}: '{symbol}' not found at top level")
        elif symbol not in top_names:
            violations.append(f"{py_path}: '{symbol}' not found at top level")
    return violations


def consumer_import_violations(consumer_path, module_name, symbols):
    """Violations when a consumer imports a name from `module_name` that `symbols`
    does not pin -- the registry rotting out of sync with its own consumer."""
    if not os.path.isfile(consumer_path):
        return [f"{consumer_path}: consumer file not found"]
    with open(consumer_path, encoding="utf-8") as f:
        text = f.read()
    pinned = {s.split(".", 1)[0] for s in symbols}
    violations = []
    # `.+` (no DOTALL) stops at end-of-line, so the next statement is never swallowed.
    for m in re.finditer(rf"from\s+{re.escape(module_name)}\s+import\s+(.+)", text):
        for raw_name in m.group(1).split(","):
            name = raw_name.strip().split(" as ")[0].strip()
            if name and name not in pinned:
                violations.append(
                    f"{consumer_path}: imports '{name}' from {module_name} "
                    "but ENTRY_POINT_REGISTRY does not pin it")
    return violations


def check_entry_point_registry(repo, plugin):
    entries = [e for e in ENTRY_POINT_REGISTRY if e["server"] in plugin["servers"]]
    if not entries:
        raise NotApplicable(f"{plugin['name']} ships no server that imports a pinned entry point")
    ep_hits = []
    for entry in entries:
        ep_hits.extend(entry_point_violations(os.path.join(repo, *entry["path"].split("/")), entry["symbols"]))
        module_name = os.path.splitext(os.path.basename(entry["path"]))[0]
        for consumer in entry["consumers"]:
            ep_hits.extend(consumer_import_violations(
                server_path(repo, plugin, entry["server"], *consumer.split("/")), module_name, entry["symbols"]))
    return not ep_hits, "; ".join(ep_hits)
