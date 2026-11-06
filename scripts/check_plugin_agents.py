"""Agent grants, recital-rule mirrors and hook matchers, for check_plugin.py."""
import glob
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import plugin_layout  # noqa: E402
from check_plugin_sources import SHARED_TREE, NotApplicable, ships_skill, ships_agent, agents_dir  # noqa: E402
from check_plugin_skill_md import read_frontmatter_lines  # noqa: E402

FETCH_TOOL = "sources__fetch"
# The only agent files that may grant sources__fetch.
FETCH_GRANT_AGENTS = ("localize-helper.md", "law-getter.md")

# A Cowork Project session reaches plugin MCP servers through the desktop bridge,
# which renames every tool `mcp__remote-devices__<name>`, and a subagent grant that
# matches no live tool is dropped silently.
PLAIN_PREFIX = "mcp__plugin_"
BRIDGE_PREFIX = "mcp__remote-devices__"

RECITAL_RULE_SOURCE = ".claude/skills/shared/authority-claim-verification.md"
# The copies of the recital rule: files under .claude/skills/, each checked in the
# plugin that ships its skill (shared/ ships in every plugin), and agent files,
# each checked in the plugin that ships the agent.
RECITAL_RULE_SKILL_MIRRORS = (
    "shared/legal-audit-protocol.md",
    "case-brief/agents/brief.md",
    "verify-law/agents/verify-claim.md",
    "matter-data/agents/verify-edges.md",
    "matter-data/agents/extract-caselaw.md",
    "matter-data/agents/verify-caselaw.md",
)
RECITAL_RULE_AGENT_MIRRORS = ("verify-claim", "verify-edges", "extract-caselaw", "verify-caselaw")
RECITAL_RULE_BLOCK = re.compile(r"<!-- recital-rule: begin.*?<!-- recital-rule: end -->", re.S)

# Hook events whose matcher is a pattern over tool names, and over agent names.
TOOL_EVENTS = ("PreToolUse", "PostToolUse")
AGENT_EVENTS = ("SubagentStart", "SubagentStop")
# A plugin tool (`plugin_<plugin>_<server>__`) and a plugin agent (`<plugin>:<agent>`)
# named in a matcher.
MATCHER_TOOL = re.compile(r"plugin_([A-Za-z0-9-]+)_([A-Za-z0-9-]+)__")
MATCHER_AGENT = re.compile(r"([A-Za-z0-9-]+):([A-Za-z0-9-]+)")


# --- agent grants ------------------------------------------------------------------------------

def agent_tools(agent_md_path):
    """The entries of an agent file's frontmatter `tools:` list."""
    tools, in_tools = [], False
    for line in read_frontmatter_lines(agent_md_path):
        line = line.rstrip("\r")
        if line.startswith("tools:"):
            in_tools = True
        elif in_tools and line.lstrip().startswith("- "):
            tools.append(line.lstrip()[2:].strip())
        elif in_tools and line.strip():
            in_tools = False
    return tools


def fetch_grants(plugin_name):
    """The plain and the bridged name of sources__fetch, for the plugin that ships the
    data server."""
    return (f"mcp__plugin_{plugin_name}_data__{FETCH_TOOL}",
            f"mcp__remote-devices__plugin_{plugin_name}_data__{FETCH_TOOL}")


def fetch_grant_allowlist_violations(agents_dir, grants, expect_grant=True):
    """`sources__fetch` is granted only by the agent files in FETCH_GRANT_AGENTS, by at
    least one agent, and by each listed agent that is present under both names in
    `grants`. A listed agent that is absent passes. `expect_grant` is False for a
    plugin that ships none of the listed agents, where no grant at all is right."""
    present = sorted(os.listdir(agents_dir)) if os.path.isdir(agents_dir) else []
    granting = {}
    for fn in present:
        if fn.endswith(".md"):
            tools = [t for t in agent_tools(os.path.join(agents_dir, fn)) if t == FETCH_TOOL or t.endswith("__" + FETCH_TOOL)]
            if tools:
                granting[fn] = tools
    if not granting:
        return [f"no agent grants {FETCH_TOOL}"] if expect_grant else []
    hits = [f"{fn} grants {FETCH_TOOL} but is not in FETCH_GRANT_AGENTS ({', '.join(FETCH_GRANT_AGENTS)})"
            for fn in granting if fn not in FETCH_GRANT_AGENTS]
    for fn in FETCH_GRANT_AGENTS:
        if fn in present:
            hits += [f"{fn} does not grant {name}" for name in grants if name not in granting.get(fn, [])]
    return hits


def agent_bridged_grant_violations(agents_dir):
    """Every `mcp__plugin_` grant in an agent file is also declared under its bridged
    name, and the bridged grants mirror the plain ones exactly: no server-level
    `mcp__remote-devices` entry and no wildcard."""
    paths = sorted(glob.glob(os.path.join(agents_dir, "*.md")))
    if not paths:
        return ["no plugin agent files found"]
    hits, checked = [], 0
    for path in paths:
        fn = os.path.basename(path)
        tools = agent_tools(path)
        plain = {t for t in tools if t.startswith(PLAIN_PREFIX)}
        bridged = {t for t in tools if t.startswith(BRIDGE_PREFIX)}
        if "mcp__remote-devices" in tools:
            hits.append(f"{fn} grants the whole bridge server")
        if any("*" in t for t in tools):
            hits.append(f"{fn} grants a wildcard tool")
        want = {BRIDGE_PREFIX + t[len("mcp__"):] for t in plain}
        hits += [f"{fn} lacks the bridged twin {t}" for t in sorted(want - bridged)]
        hits += [f"{fn} grants {t} with no plain twin" for t in sorted(bridged - want)]
        checked += bool(plain)
    if not checked:
        hits.append("no agent declares a plugin MCP tool; the parser is likely broken")
    return hits


# --- write-up-agent-tools --------------------------------------------------------------------------
# The agents that write and check a sent suggestion's technical write-up on the practitioner's
# machine (docs/Plans/2026-10-25_suggestion-design.md, decision 18) read only the card, the
# environment facts in their prompt and Probanda's shipped files. Their tool lists are the guard:
# each may grant only the shipped-file reads below, under both names, and must grant the read. Any
# other tool (a file read, a shell, the web, mail, matter or practice data) fails, as does a missing
# `tools:` list, since an agent without one is given every tool, and an `mcpServers:` entry.
WRITE_UP_AGENTS = ("technical-writer", "spec-backstop")
WRITE_UP_TOOLS = ("skill_source__read", "skill_source__list")
WRITE_UP_REQUIRED = ("skill_source__read",)


def write_up_tool_names(data_plugin, tools):
    """The plain and bridged names of `tools` on the data server of `data_plugin`."""
    return [f"{prefix}plugin_{data_plugin}_data__{t}" for t in tools for prefix in ("mcp__", BRIDGE_PREFIX)]


def write_up_agent_violations(agents_dir, data_plugin, agents=WRITE_UP_AGENTS):
    """Every grant of a write-up agent beyond the shipped-file reads, and every agent missing or
    lacking its read."""
    allowed = set(write_up_tool_names(data_plugin, WRITE_UP_TOOLS))
    required = write_up_tool_names(data_plugin, WRITE_UP_REQUIRED)
    hits = []
    for agent in agents:
        path = os.path.join(agents_dir, f"{agent}.md")
        if not os.path.isfile(path):
            hits.append(f"{agent}.md is missing")
            continue
        lines = [line.rstrip("\r") for line in read_frontmatter_lines(path)]
        if not any(line.startswith("tools:") for line in lines):
            hits.append(f"{agent}.md has no tools list, so it would be given every tool")
            continue
        if any(line.startswith("mcpServers:") for line in lines):
            hits.append(f"{agent}.md declares its own MCP servers")
        tools = agent_tools(path)
        if not tools:
            hits.append(f"{agent}.md lists its tools in a form this check cannot read; use a `- ` list")
            continue
        hits += [f"{agent}.md grants {t}, which reaches beyond Probanda's shipped files" for t in tools if t not in allowed]
        hits += [f"{agent}.md does not grant {t}" for t in required if t not in tools]
    return hits


def check_write_up_agent_tools(repo, plugin):
    owner = plugin_layout.server_owner(repo, "data")["name"]
    shipped = [a for a in WRITE_UP_AGENTS if ships_agent(plugin, a)]
    if plugin["name"] != owner and not shipped:
        raise NotApplicable(f"{plugin['name']} ships neither write-up agent")
    hits = [f"{a} ships in {plugin['name']}, not in {owner}" for a in shipped if plugin["name"] != owner]
    if plugin["name"] == owner:
        hits += [f"{owner} does not ship {a} (source/assignment.json)" for a in WRITE_UP_AGENTS if a not in shipped]
        hits += write_up_agent_violations(agents_dir(repo, plugin), owner)
    return not hits, "; ".join(hits)


# --- recital-rule-mirror -------------------------------------------------------------------------

def recital_rule_blocks(path):
    """Every marked recital-rule block in a file, line endings normalised to LF."""
    with open(path, encoding="utf-8") as f:
        return RECITAL_RULE_BLOCK.findall(f.read().replace("\r\n", "\n"))


def recital_rule_mirrors(plugin):
    """The copies of the recital rule the plugin ships, as repo-relative paths."""
    skills = [f".claude/skills/{rel}" for rel in RECITAL_RULE_SKILL_MIRRORS
              if rel.split("/")[0] == SHARED_TREE or ships_skill(plugin, rel.split("/")[0])]
    agents = [f"{plugin['source']}/agents/{a}.md" for a in RECITAL_RULE_AGENT_MIRRORS if ships_agent(plugin, a)]
    return tuple(skills + agents)


def recital_rule_mirror_violations(repo, source, mirrors):
    """Every copy of the recital rule (authority-claim-verification.md §3) that is
    missing, duplicated, or not identical to the source's block. Subagents read no
    repo files, so each prompt carries the rule inline."""
    found = recital_rule_blocks(os.path.join(repo, source))
    if len(found) != 1:
        return [f"{source}: expected 1 recital-rule block, found {len(found)}"]
    hits = []
    for rel in mirrors:
        path = os.path.join(repo, rel)
        if not os.path.isfile(path):
            hits.append(f"{rel}: file missing")
            continue
        blocks = recital_rule_blocks(path)
        if len(blocks) != 1:
            hits.append(f"{rel}: expected 1 recital-rule block, found {len(blocks)}")
        elif blocks[0] != found[0]:
            hits.append(f"{rel}: block differs from {source}")
    return hits


# --- hook-matchers --------------------------------------------------------------------------------

def hook_matcher_violations(manifest, plugin, servers, agents):
    """(hits, matchers read) for the hook matchers of one plugin.json. A matcher that
    names a plugin tool must name a server that plugin ships, and one that names a
    plugin agent must name an agent that plugin ships: a matcher that names anything
    else matches nothing, so its hook never runs. `servers` and `agents` are {plugin
    name: what it ships} for every built plugin. The named plugin must also be this
    one or one it requires. A matcher that names a host tool, or a
    pattern tied to no plugin, passes."""
    reachable = {plugin["name"], *plugin["requires"]}
    hits, count = [], 0
    for event in TOOL_EVENTS + AGENT_EVENTS:
        pattern, ships, kind = (MATCHER_TOOL, servers, "server") if event in TOOL_EVENTS \
            else (MATCHER_AGENT, agents, "agent")
        for group in manifest.get("hooks", {}).get(event, []):
            matcher = group.get("matcher")
            if not matcher:
                continue
            count += 1
            named = pattern.findall(matcher)
            if kind == "server" and "plugin_" in matcher and not named:
                hits.append(f"{event} matcher {matcher!r} names a plugin tool this check cannot read")
            for owner, unit in named:
                if owner not in ships:
                    hits.append(f"{event} matcher names {kind} '{unit}' of '{owner}', which is not a built plugin")
                elif unit not in ships[owner]:
                    hits.append(f"{event} matcher names {kind} '{unit}', which '{owner}' does not ship")
                elif owner not in reachable:
                    hits.append(f"{event} matcher names {kind} '{unit}' of '{owner}', which "
                                f"'{plugin['name']}' does not require")
    return hits, count


def check_recital_rule_mirror(repo, plugin):
    recital_hits = recital_rule_mirror_violations(repo, RECITAL_RULE_SOURCE, recital_rule_mirrors(plugin))
    return not recital_hits, "; ".join(recital_hits)


def agents_name_mcp_tool(folder):
    """Whether any agent file in folder names an MCP tool, read as text rather than
    parsed, so a broken parser still fails agent_bridged_grant_violations."""
    return any("mcp__" in Path(p).read_text(encoding="utf-8") for p in glob.glob(os.path.join(folder, "*.md")))


def check_agent_bridged_grants(repo, plugin):
    folder = agents_dir(repo, plugin)
    if not agents_name_mcp_tool(folder):
        raise NotApplicable(f"no agent of {plugin['name']} names an MCP tool")
    bridge_hits = agent_bridged_grant_violations(folder)
    return not bridge_hits, "; ".join(bridge_hits)
