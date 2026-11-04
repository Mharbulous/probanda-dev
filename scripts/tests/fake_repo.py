"""
Shared fake-repo builder for the script tests: the one place that knows the shape of
source/assignment.json and source/<plugin>/plugin.json.
"""

import json
from pathlib import Path

EMPTY = {"requires": [], "skills": [], "agents": [], "hooks": {}, "servers": []}


def assignment_path(root):
    return Path(root) / "source" / "assignment.json"


def write_assignment(root, plugins=None, *, raw=None, omit=False, status="cutover", plugin_json=False):
    """Write source/assignment.json under root from {plugin: {skills, agents, hooks, servers, requires}}.

    Missing keys of each plugin are filled with empty values. raw writes that exact text instead,
    and omit leaves the file out (removing one already there). plugin_json also writes a
    source/<plugin>/plugin.json of "{}" for each plugin that has none.
    """
    path = assignment_path(root)
    if omit:
        path.unlink(missing_ok=True)
        return None
    path.parent.mkdir(parents=True, exist_ok=True)
    full = {name: {**EMPTY, **(spec or {})} for name, spec in (plugins or {}).items()}
    path.write_text(raw if raw is not None else json.dumps({"status": status, "plugins": full}), encoding="utf-8")
    if plugin_json:
        for name in full:
            manifest = path.parent / name / "plugin.json"
            if not manifest.exists():
                manifest.parent.mkdir(parents=True, exist_ok=True)
                manifest.write_text("{}", encoding="utf-8")
    return full
