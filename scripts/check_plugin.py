#!/usr/bin/env python3
"""Invariant checks for the Probanda plugin. Standard library only.

Usage:
  python scripts/check_plugin.py                         run every check; exit 1 on any FAIL
  python scripts/check_plugin.py skill-source-baseline   rewrite the shipped-tree-purity ratchet baseline

Ported from CoClerk's plugin-packager `direct_mode.py check litigation`, with
every path and identifier moved to this repo: skill sources under
.claude/skills/ (the keys of a plugin's roster.json, plus shared/ and
legal-commons/), plugin sources under source/<plugin>/, and the built plugin
under plugins/<plugin>/.

The checks run once for each plugin the repo builds (plugin_layout.py: the one
plugin probanda while source/assignment.json is "planned", every plugin in it at
"cutover"), then the checks across plugins run once. Each check prints one
`[PASS]` or `[FAIL]` line, or an `[N/A]` line saying why it does not apply to a
plugin that does not ship the skill, agent or server it guards; there are no
silent skips. The baselines live in check_plugin_baselines/ beside this file.
"""
import glob
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import check_file_ops  # noqa: E402
import check_internals  # noqa: E402
import check_layering  # noqa: E402
import plugin_layout  # noqa: E402
from check_plugin_sources import (  # noqa: E402
    BASELINES, COMMONS_SKILL, SHARED_TREE, EXTRA_TREES, PUBLIC_SKILLS, COMMONS_AGENTS, COMMONS_FORBIDDEN,
    RESERVED_NAME, HOST_PATH, WORKTREE_PATH, NotApplicable, skills_root, source_path, server_path,
    ships_skill, ships_agent, agents_dir, agent_names, roster, packaged_assets, extra_trees,
    public_skill_dirs, public_skills, skill_names, skill_md, grep_tree, grep_dir, check_roster_sanity,
    check_reserved_name, check_inverse_reference, check_commons_encapsulation, check_dependencies)
from check_plugin_skill_md import (  # noqa: E402
    XML_TAG, DESCRIPTION_MAX_CHARS, DESCRIPTION_WARN_CHARS, read_frontmatter_lines, extract_field,
    scalar_value, description_length, preamble_lines, stamp_skill_md, check_description_no_xml_tags,
    check_description_length)
from check_plugin_refs import (  # noqa: E402
    TREE_PREFIX, REF_EXPLICIT, REF_MDLINK, REF_BACKTICK, REF_PRESENCE_GLOB, HAS_EXT, URL_SCHEME, DRIVE,
    RUNTIME_DIRS, RUNTIME_FILES, PLACEHOLDER, reference_candidates, reference_resolves, broken_references,
    reference_hit_verdict, check_no_absolute_repo_paths)
from check_plugin_entry_points import (  # noqa: E402
    ENTRY_POINT_REGISTRY, entry_point_violations, consumer_import_violations, check_entry_point_registry)
from check_plugin_bundles import (  # noqa: E402
    SOURCES_ALLOWED_HOSTS, _BUNDLE_MODULE, _SOURCES_NETWORK_CALL, _TOP_LEVEL_FUNCTION, DATA_BUNDLE,
    PURITY_SERVERS, DATA_FUNCTION_PATHS, _FUNCTIONS_PATH, HOST_PATH_SERVERS, sources_host_guard_violations,
    bundle_purity_hits, check_bundle_purity, check_sources_host_guard, check_bundle_no_host_path,
    BAKED_SCHEMA, ENGINE_TARGET, check_bundle_schema_ceiling)
from check_plugin_agents import (  # noqa: E402
    FETCH_TOOL, FETCH_GRANT_AGENTS, PLAIN_PREFIX, BRIDGE_PREFIX, RECITAL_RULE_SOURCE,
    RECITAL_RULE_SKILL_MIRRORS, RECITAL_RULE_AGENT_MIRRORS, RECITAL_RULE_BLOCK, TOOL_EVENTS, AGENT_EVENTS,
    MATCHER_TOOL, MATCHER_AGENT, agent_tools, fetch_grants, fetch_grant_allowlist_violations,
    agent_bridged_grant_violations, recital_rule_blocks, recital_rule_mirrors,
    recital_rule_mirror_violations, hook_matcher_violations, check_recital_rule_mirror, agents_name_mcp_tool,
    check_agent_bridged_grants)
from check_plugin_tree import (  # noqa: E402
    SHIPPED_PREFIX, VISION_FILE, TREE_EXCLUDE_DIRS, TREE_TEXT_EXTS, TRANSIENT_ASSET_PREFIX, MATTER_CODE,
    UTBMS_TASK_CODES, UTBMS_CONTEXT, SKILL_SOURCE_BASELINE, sha256_file, shipped_manifest,
    skill_source_expected, matter_codes, _text_of, skill_source_hit_counts, shipped_tree_purity,
    check_shipped_tree_purity)

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir))

# Skills-tree paths the data runtime resolves at call time (resolveShippedRoot). A
# rename on either side breaks every write that needs the file, and only on an
# installed copy. Each entry pins the `literal` that names the path in `source`, a
# path inside the source folder of `server`, and the `path` some built plugin must
# ship under skills/. An entry is checked in the plugin that ships that server.
SHIPPED_PATH_REGISTRY = (
    {"path": "matter-data/references/triggers.sql", "literal": '"matter-data/references/triggers.sql"',
     "source": "src/case/backend.ts", "server": "data"},
    {"path": "file-naming/scripts/name_gate.py", "literal": '"file-naming/scripts/name_gate.py"',
     "source": "src/housekeeping/name-gate.ts", "server": "data"},
    # migrateScriptsDir builds `${skill}/references/scripts/migrate_engine.py` from these names.
    {"path": "matter-data/references/scripts/migrate_engine.py", "literal": 'migrateScriptsDir("matter-data"',
     "source": "src/repo-root.ts", "server": "data"},
    {"path": "timecamping-data/references/scripts/migrate_engine.py",
     "literal": 'migrateScriptsDir("timecamping-data"', "source": "src/repo-root.ts", "server": "data"},
    {"path": "drafting-data/references/scripts/migrate_engine.py", "literal": 'migrateScriptsDir("drafting-data"',
     "source": "src/repo-root.ts", "server": "data"},
)

# Known `rel -> ref` reference-resolution hits. A listed hit passes; an unlisted one
# fails; a listed entry that no longer hits fails as stale, so the list only shrinks.
# Hand-edited, never regenerated.
REFERENCE_UNSHIPPED_BASELINE = os.path.join(BASELINES, "reference_unshipped_baseline.json")


# --- repo layout -------------------------------------------------------------------
# A `plugin` argument is one spec of built_plugins(): its name, source folder, the
# plugins it requires, its servers, and the skills and agents the assignment gives it
# (None while the one plugin ships everything).

def built_plugins(repo):
    """{name: spec} for every plugin the repo builds (plugin_layout.plugins)."""
    return plugin_layout.plugins(repo)


def server_owner(repo, server):
    """The one built plugin that ships a server."""
    owners = [p for p in built_plugins(repo).values() if server in p["servers"]]
    if len(owners) != 1:
        raise ValueError(f"{len(owners)} built plugins ship the {server} server, expected 1")
    return owners[0]


def write_skill_source_baseline(repo, path=SKILL_SOURCE_BASELINE):
    """Rewrite the ratchet baseline from what the sources say should ship, in every
    built plugin."""
    counts = {"host_path": {}, "matter_code": {}}
    for plugin in built_plugins(repo).values():
        rels = sorted(skill_source_expected(skills_root(repo), sorted(roster(repo, plugin)),
                                            packaged_assets(repo, plugin), extra_trees(plugin)))
        for scan, found in skill_source_hit_counts(repo, plugin, rels).items():
            counts[scan].update(found)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(counts, f, indent=2, sort_keys=True)
        f.write("\n")
    return counts


# --- the checks ----------------------------------------------------------------------------------
# Each returns (ok, detail). A check of one plugin takes (repo, plugin) and raises
# NotApplicable when the plugin does not ship what it guards.


def check_reference_resolution(repo, plugin):
    assets = packaged_assets(repo, plugin)
    shipped = skill_source_expected(skills_root(repo), sorted(roster(repo, plugin)), assets, extra_trees(plugin))
    ref_hits = []
    for s in skill_names(repo, plugin):
        if os.path.isdir(os.path.join(skills_root(repo), s)):
            ref_hits.extend(broken_references(repo, s, assets, shipped))
    with open(REFERENCE_UNSHIPPED_BASELINE, encoding="utf-8") as f:
        known = set(json.load(f)["known_unshipped"])
    # The list is one for the repo. An entry of a skill another plugin ships is that
    # plugin's to hit, so it is not stale here.
    elsewhere = {s for other in built_plugins(repo).values() if other["name"] != plugin["name"]
                 for s in skill_names(repo, other)}
    known = {entry for entry in known if entry.split("/", 1)[0] not in elsewhere}
    ref_fail, n_known = reference_hit_verdict([f"{rel} -> {ref}" for rel, ref in ref_hits], known)
    if ref_fail:
        return False, "; ".join(ref_fail)
    return True, f"{n_known} known unshipped" if n_known else ""


def check_shipped_path_registry(repo, plugin):
    entries = [e for e in SHIPPED_PATH_REGISTRY if e["server"] in plugin["servers"]]
    if not entries:
        raise NotApplicable(f"{plugin['name']} ships no server that resolves a pinned skills-tree path")
    hits = []
    for entry in entries:
        source = server_path(repo, plugin, entry["server"], *entry["source"].split("/"))
        with open(source, encoding="utf-8") as f:
            text = f.read()
        if entry["literal"] not in text:
            hits.append(f"{entry['source']} no longer holds {entry['literal']}")
        if not glob.glob(os.path.join(repo, "plugins", "*", "skills", *entry["path"].split("/"))):
            hits.append(f"no built plugin ships skills/{entry['path']}")
    return not hits, "; ".join(hits)


def check_fetch_grant_allowlist(repo, plugin):
    listed_here = any(ships_agent(plugin, fn[:-len(".md")]) for fn in FETCH_GRANT_AGENTS)
    fetch_hits = fetch_grant_allowlist_violations(
        agents_dir(repo, plugin), fetch_grants(server_owner(repo, "data")["name"]), expect_grant=listed_here)
    return not fetch_hits, "; ".join(fetch_hits)


def check_hook_matchers(repo, plugin):
    with open(source_path(repo, plugin, "plugin.json"), encoding="utf-8") as f:
        manifest = json.load(f)
    plugins = built_plugins(repo)
    hits, count = hook_matcher_violations(
        manifest, plugin, {name: p["servers"] for name, p in plugins.items()},
        {name: agent_names(repo, p) for name, p in plugins.items()}, strict=plugin_layout.is_cutover(repo))
    if not count:
        raise NotApplicable(f"{plugin['name']} declares no hook matcher")
    return not hits, "; ".join(hits) if hits else f"{count} matchers read"


def check_unique_names(repo):
    hits = []
    for kind, names_of in (("skill", skill_names), ("agent", agent_names)):
        owners = {}
        for plugin in built_plugins(repo).values():
            for name in names_of(repo, plugin):
                owners.setdefault(name, []).append(plugin["name"])
        hits += [f"{kind} '{name}' ships in {' and '.join(found)}"
                 for name, found in sorted(owners.items()) if len(found) > 1]
    return not hits, "; ".join(hits)


def check_layering_rule(repo):
    """check_layering.py's verdict: its --report run until cutover, its strict run from then."""
    try:
        _shared, _upward, _ruling, found, unruled, stale, todo = check_layering.judge(Path(repo))
    except SystemExit as exc:
        return False, str(exc)
    strict = plugin_layout.is_cutover(repo)
    hits = [f"no ruling: {f} names {t}" for f, t in unruled]
    hits += [f"stale ruling (nothing matches it): {f} names {t}" for f, t in stale]
    if strict:
        hits += [f"still to fix: {f} names {t}" for f, t in todo]
    if hits:
        return False, "; ".join(hits)
    return True, f"{len(found)} upward pairs" + (f", {len(todo)} still to fix before cutover" if todo else "")


def check_file_ops_rule(repo):
    """check_file_ops.py's verdict."""
    try:
        findings, ruling, found, unruled, over, stale, bad = check_file_ops.judge(Path(repo))
    except SystemExit as exc:
        return False, str(exc)
    hits = check_file_ops.problems(findings, ruling, unruled, over, stale, bad)
    if hits:
        return False, "; ".join(hits)
    return True, f"{len(found)} (file, operation) pairs"


def check_internals_rule(repo):
    """check_internals.py's verdict: no Probanda internal term in a hook refusal, a page template or a
    file name the data server builds (shared/internals-confidentiality.md)."""
    hits = check_internals.violations(Path(repo))
    return (False, "; ".join(hits)) if hits else (True, "no internal term in user-visible text")


CHECKS = (
    ("roster-sanity: every shipped skill maps to a source SKILL.md", check_roster_sanity),
    ("reserved-name: no shipped skill name contains the reserved word 'claude'", check_reserved_name),
    ("description-no-xml-tags: no source description contains an XML tag", check_description_no_xml_tags),
    (f"description-length: no source description exceeds {DESCRIPTION_MAX_CHARS} characters",
     check_description_length),
    ("no-absolute-repo-paths: skill sources use relative references", check_no_absolute_repo_paths),
    ("reference-resolution: every file reference in a skill source resolves and ships",
     check_reference_resolution),
    ("entry-point-registry: pinned Python entry-point symbols exist and match their consumers' imports",
     check_entry_point_registry),
    ("shipped-path-registry: every skills-tree path the data server resolves is named in its source and "
     "ships in a built plugin", check_shipped_path_registry),
    ("bundle-purity: no canlii or files dist bundle carries 'supabase' or 'legal_commons__'; the data "
     "bundle carries no 'legal_commons__', no '/rest/v1/' and no 'functions/v1/' path but items-write, "
     "items-sync, items-seed, key-request-submit and key-request-status", check_bundle_purity),
    ("sources-host-guard: the data server's sources module fetches only over https from allowed "
     "hosts, SOURCES_ALLOWED_HOSTS as expected, guarded before every request", check_sources_host_guard),
    ("fetch-grant-allowlist: only allowlisted agents grant sources__fetch, each present one under "
     "both its plain and bridged names", check_fetch_grant_allowlist),
    ("recital-rule-mirror: every inline copy of the recital rule matches "
     "authority-claim-verification.md §3", check_recital_rule_mirror),
    ("bundle-no-host-path: no dist bundle contains an absolute host path", check_bundle_no_host_path),
    ("bundle-schema-ceiling: the data bundle is built against the drafting-data migration source's "
     "target schema version", check_bundle_schema_ceiling),
    ("inverse-reference: no roster skill or non-commons agent names a commons agent outside the plugin "
     "that ships it", check_inverse_reference),
    ("shipped-tree-purity: the built plugin's skills folder is exactly the roster + extra-tree source "
     "(roster SKILL.md + preamble), VISION.md ships from source, with no host path or matter code "
     "over baseline", check_shipped_tree_purity),
    ("agent-bridged-grants: every plugin MCP grant in an agent has its bridged twin and nothing more",
     check_agent_bridged_grants),
    ("commons-encapsulation: the legal-commons gatekeeper skill names no local DB file",
     check_commons_encapsulation),
    ("hook-matchers: every hook matcher that names a plugin tool or a plugin agent names one that "
     "plugin ships", check_hook_matchers),
    ("dependencies: plugin.json's dependencies are the plugins source/assignment.json says it requires",
     check_dependencies),
)
# Checks across the plugins built. Each takes (repo).
REPO_CHECKS = (
    ("unique-names: no skill name and no agent name ships in two plugins", check_unique_names),
    ("layering: every upward reference between the plugins of source/assignment.json has a ruling "
     "(scripts/check_layering.py)", check_layering_rule),
    ("file-ops: every file-changing operation outside file-manager has a ruling (scripts/check_file_ops.py)",
     check_file_ops_rule),
    ("internals: no hook refusal, page template or built file name holds a Probanda internal term "
     "(scripts/check_internals.py)", check_internals_rule),
)


def run_checks(repo):
    """[(plugin name, label, ok, detail)] for every check of every built plugin, then
    the checks across plugins, under the plugin name None. `ok` is None for a check
    that does not apply to the plugin. A check that raises is a FAIL."""
    runs = [(plugin["name"], label, fn, (repo, plugin))
            for plugin in built_plugins(repo).values() for label, fn in CHECKS]
    runs += [(None, label, fn, (repo,)) for label, fn in REPO_CHECKS]
    results = []
    for name, label, fn, args in runs:
        try:
            ok, detail = fn(*args)
        except NotApplicable as exc:
            ok, detail = None, f"does not apply: {exc}"
        except Exception as exc:  # reported as a FAIL, never skipped
            ok, detail = False, f"could not run: {type(exc).__name__}: {exc}"
        results.append((name, label, ok, detail))
    return results


def main(argv):
    # A detail can quote a reference with a character the console cannot encode.
    sys.stdout.reconfigure(errors="backslashreplace")
    if argv[1:] == ["skill-source-baseline"]:
        counts = write_skill_source_baseline(REPO)
        for scan in ("host_path", "matter_code"):
            print(f"{scan}: {sum(counts[scan].values())} hits in {len(counts[scan])} files")
        print("wrote", SKILL_SOURCE_BASELINE)
        return 0
    if argv[1:]:
        print(__doc__)
        return 2
    plugins = built_plugins(REPO)
    results = run_checks(REPO)
    marks = {True: "PASS", False: "FAIL", None: "N/A"}
    for name in [*plugins, None]:
        if name is None:
            print("Checks across the plugins built:")
        else:
            print(f"Invariant checks for '{name}' ({len(skill_names(REPO, plugins[name]))} skills):")
        for owner, label, ok, detail in results:
            if owner == name:
                print(f"  [{marks[ok]}] {label}" + (f" — {detail}" if detail else ""))
    failures = [label for _owner, label, ok, _ in results if ok is False]
    if failures:
        print(f"\nCHECK FAILED — {len(failures)} invariant(s) violated.")
        return 1
    print("\nALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
