#!/usr/bin/env python3
"""Build plugins/probanda from CoClerk's packaged litigation and legal-commons plugins.

Usage: python scripts/import_from_coclerk.py --coclerk <path to a CoClerk checkout>

Phase 1 of the move. CoClerk stays the source of truth: its packager builds
litigation-latest.plugin and legal-commons-latest.plugin, and this script turns
those two archives into the single Probanda plugin:

- renames every plugin identifier (litigation and legal-commons become probanda);
- merges in legal-commons' read side only: its gatekeeper skill, the read-only
  law-librarian and troubleshooter agents, and its MCP server under the key
  "commons". The push skills (consolidation-push, rule-sharing) stay in CoClerk,
  and a hook blocks the commons write tools;
- replaces plugins/probanda wholesale, so nothing is ever edited by hand there.

Standard library only. Re-run after every CoClerk repackage.
"""
import argparse
import json
import re
import shutil
import sys
import zipfile
from pathlib import Path

VERSION = "0.1.0"
REPO = Path(__file__).resolve().parent.parent
TARGET = REPO / "plugins" / "probanda"

# legal-commons entries that ship. Everything else in that archive is left out.
COMMONS_AGENTS = {"agents/law-librarian.md", "agents/troubleshooter.md"}
COMMONS_SKILLS = {"legal-commons"}  # native source copied from .claude/skills

# The commons tools that write to the shared pool. Option (a): blocked for now.
COMMONS_WRITE_TOOLS = (
    "push|amend_authority|amend_authority_edge|amend_criterion_text|amend_principle_text"
    "|link_authority|unlink_authority|merge_authority|record_treatment|stamp_verified"
    "|rule_period_push|rule_period_record_verification|rule_period_retire"
)

TEXT_SUFFIXES = {".md", ".py", ".json", ".js", ".txt", ".html", ".css", ".csv", ".yaml", ".yml"}

# Order matters: the specific commons prefix before the general ones.
RENAMES = [
    (re.compile(r"plugin_legal-commons_pool__"), "plugin_probanda_commons__"),
    (re.compile(r"plugin_litigation_"), "plugin_probanda_"),
    (re.compile(r"\blegal-commons:(?=[a-z])"), "probanda:"),
    (re.compile(r"\blitigation:(?=[a-z])"), "probanda:"),
    (re.compile(r"<!-- litigation v[0-9.]+ -->"), f"<!-- probanda v{VERSION} -->"),
    (re.compile(r"\blitigation plugin\b"), "Probanda plugin"),
    (re.compile(r"\bLitigation plugin\b"), "Probanda plugin"),
]


def rename(text):
    for pattern, replacement in RENAMES:
        text = pattern.sub(replacement, text)
    return text


def write(rel, data):
    path = TARGET / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    if Path(rel).suffix.lower() in TEXT_SUFFIXES:
        data = rename(data.decode("utf-8")).encode("utf-8")
    path.write_bytes(data)
    if Path(rel).suffix == ".py":
        path.chmod(0o755)


def manifest(litigation_manifest):
    hooks = json.loads(rename(json.dumps(litigation_manifest["hooks"])))
    hooks["PreToolUse"].append({
        "matcher": rf"mcp__(.+__)?plugin_probanda_commons__legal_commons__({COMMONS_WRITE_TOOLS})",
        "hooks": [{
            "type": "command",
            "command": "python3",
            "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/commons-read-only.py"],
            "timeout": 10,
            "statusMessage": "Commons read-only guard",
        }],
    })
    return {
        "name": "probanda",
        "displayName": "Probanda",
        "version": VERSION,
        "description": "A litigation practice plugin for British Columbia lawyers: matters, billing, "
                       "deadlines, court forms, case analysis and legal research.",
        "author": {"name": "Mharbulous", "url": "https://github.com/Mharbulous"},
        "homepage": "https://github.com/Mharbulous/probanda",
        "repository": "https://github.com/Mharbulous/probanda",
        "mcpServers": "./.mcp.json",
        "hooks": hooks,
    }


GUARD = '''#!/usr/bin/env python3
"""Block the shared legal-commons pool's write tools (Probanda phase 1).

Probanda ships the commons read side only. Pushing matter-derived principles or
rule records to the shared pool is withheld until COMMANDMENTS.md says how it may
be done, so every write tool is refused here.
"""
import json
import sys

json.load(sys.stdin)
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": (
            "Probanda's shared legal-commons pool is read-only for now. Writing to it "
            "(push, amend, link, merge, record, stamp, retire) is not available in this "
            "plugin. Tell the user the write was not made."
        ),
    }
}))
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--coclerk", required=True, type=Path, help="path to a CoClerk checkout")
    coclerk = parser.parse_args().coclerk.resolve()

    lit_zip = zipfile.ZipFile(coclerk / "litigation-latest.plugin")
    com_zip = zipfile.ZipFile(coclerk / "legal-commons-latest.plugin")
    commons_skill_src = coclerk / ".claude" / "skills"

    if TARGET.exists():
        shutil.rmtree(TARGET)
    TARGET.mkdir(parents=True)

    for entry in lit_zip.namelist():
        if entry.endswith("/") or entry in (".claude-plugin/plugin.json", ".mcp.json"):
            continue
        write(entry, lit_zip.read(entry))

    for entry in com_zip.namelist():
        if entry in COMMONS_AGENTS:
            write(entry, com_zip.read(entry))
        elif entry.startswith("mcp/") and not entry.endswith("/"):
            write("commons-mcp/" + entry[len("mcp/"):], com_zip.read(entry))

    for skill in sorted(COMMONS_SKILLS):
        src = commons_skill_src / skill
        for path in sorted(src.rglob("*")):
            if path.is_file() and "tests" not in path.relative_to(src).parts:
                write(f"skills/{skill}/{path.relative_to(src).as_posix()}", path.read_bytes())

    lit_manifest = json.loads(lit_zip.read(".claude-plugin/plugin.json"))
    lit_mcp = json.loads(lit_zip.read(".mcp.json"))
    com_mcp = json.loads(com_zip.read(".mcp.json"))
    mcp = dict(lit_mcp)
    mcp["commons"] = {
        "command": com_mcp["pool"]["command"],
        "args": [a.replace("${CLAUDE_PLUGIN_ROOT}/mcp/", "${CLAUDE_PLUGIN_ROOT}/commons-mcp/")
                 for a in com_mcp["pool"]["args"]],
    }

    (TARGET / ".claude-plugin").mkdir(exist_ok=True)
    (TARGET / ".claude-plugin" / "plugin.json").write_text(
        json.dumps(manifest(lit_manifest), indent=2) + "\n", encoding="utf-8")
    (TARGET / ".mcp.json").write_text(json.dumps(mcp, indent=2) + "\n", encoding="utf-8")
    guard = TARGET / "hooks" / "commons-read-only.py"
    guard.parent.mkdir(exist_ok=True)
    guard.write_text(GUARD, encoding="utf-8")
    guard.chmod(0o755)
    (TARGET / "README.md").write_text(
        "# Probanda plugin\n\n"
        "Everything in this folder is generated by `scripts/import_from_coclerk.py` from CoClerk's "
        "packaged litigation and legal-commons plugins. Never edit it by hand here: change the "
        "source in CoClerk, repackage there, and re-run the import.\n",
        encoding="utf-8")

    leftovers = []
    for path in TARGET.rglob("*"):
        if path.is_file() and path.suffix.lower() in TEXT_SUFFIXES:
            text = path.read_text(encoding="utf-8", errors="replace")
            for needle in ("plugin_litigation_", "plugin_legal-commons_", "litigation:docket-clerk"):
                if needle in text:
                    leftovers.append(f"{path.relative_to(REPO)}: {needle}")
    files = sum(1 for p in TARGET.rglob("*") if p.is_file())
    print(f"plugins/probanda: {files} files from litigation and legal-commons")
    if leftovers:
        print("Old plugin identifiers left after renaming:", *leftovers, sep="\n  ")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
