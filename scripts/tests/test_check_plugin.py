#!/usr/bin/env python3
"""
scripts/check_plugin.py against a throwaway fixture repo built under tempfile.

The fixture is a minimal Probanda repo that passes every check. Each planted-
violation test breaks exactly one invariant and asserts that its check, and only
its check, reports FAIL. The shipped-tree-purity tests are ported from CoClerk's
plugin-packager tests/test_shipped_tree_purity.py; the manifest comes from the
fixture's own plugins/probanda/ tree instead of CoClerk's build_plugin.py.

The real repo tree is only ever read here (the committed baseline), never written.

Run: python -m pytest -q scripts/tests/test_check_plugin.py
"""

import contextlib
import hashlib
import importlib.util
import io
import json
import os
import shutil
import tempfile
import unittest
from unittest import mock

SCRIPTS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_spec = importlib.util.spec_from_file_location("check_plugin", os.path.join(SCRIPTS, "check_plugin.py"))
check_plugin = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check_plugin)

VERSION = "0.1.0"
ASSETS = {"alpha": ("templates",)}
DOCX_BYTES = b"PK\x03\x04\x00\x00binary\x00template"
SOURCE_SKILL_MD = """\
---
name: alpha
description: Fixture roster skill.
---

# alpha source

See `references/rules.md`.
"""
COMMONS_SKILL_MD = """\
---
name: legal-commons
description: Fixture commons gatekeeper.
---

# legal-commons
"""
RECITAL_BLOCK = ("<!-- recital-rule: begin. Source: x. -->\n"
                 "**Whose reasons are they?** Support comes only from the court's own reasons.\n"
                 "<!-- recital-rule: end -->")
PLAIN = "mcp__plugin_probanda_data__"
BRIDGED = "mcp__remote-devices__plugin_probanda_data__"
ENGINE = """\
TARGET_SCHEMA_VERSION = 3


class MigrateError(RuntimeError):
    def as_dict(self):
        return {}


def run(request):
    return {}
"""
DATA_BUNDLE = """\
// src/index.ts
var serverName = "data";

// src/submission/schema-ceiling.ts
var BAKED_SCHEMA_VERSION = false ? null : 3;

// src/sources/hosts.ts
var SOURCES_ALLOWED_HOSTS = ["www.bclaws.gov.bc.ca", "bclaws.gov.bc.ca", "vaniac.org", "laws-lois.justice.gc.ca"];

// src/sources/fetch.ts
import https from "node:https";
function assertSourcesHost(url, allowed) {
  if (url.protocol !== "https:") throw new Error("https only");
  if (!allowed.includes(url.hostname)) throw new Error("host not allowed");
}
function requestSource(url, allowed, transport) {
  assertSourcesHost(url, allowed);
  return transport.request(url);
}
function createSourceFetcher(hosts, transport) {
  return (url) => requestSource(url, hosts(), transport);
}
var HTTPS_TRANSPORT = { request: https.request };
var sourcesFetcher = createSourceFetcher(() => SOURCES_ALLOWED_HOSTS, HTTPS_TRANSPORT);
"""

CHECK_NAMES = [
    "roster-sanity", "reserved-name", "description-no-xml-tags", "description-length",
    "no-absolute-repo-paths", "reference-resolution", "entry-point-registry", "bundle-purity",
    "sources-host-guard", "fetch-grant-allowlist", "recital-rule-mirror", "bundle-no-host-path",
    "bundle-schema-ceiling", "inverse-reference", "shipped-tree-purity", "agent-bridged-grants", "commons-encapsulation",
    "hook-matchers", "dependencies", "unique-names", "layering", "file-ops",
]
# One matcher of each kind the hook-matchers check reads, and two it lets through.
HOOKS = {
    "PreToolUse": [{"matcher": "Bash|mcp__(.+__)?plugin_probanda_data__sources__fetch", "hooks": []},
                   {"matcher": "mcp__.+mail_(send_email|forward_email)", "hooks": []}],
    "SubagentStart": [{"matcher": "probanda:localize-helper", "hooks": []}],
}


def write(root, rel, data):
    path = os.path.join(root, *rel.split("/"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data if isinstance(data, bytes) else data.encode("utf-8"))


def read(root, rel):
    with open(os.path.join(root, *rel.split("/")), "rb") as f:
        return f.read()


def agent(tools, body="# Fixture agent\n"):
    lines = ["---", "name: fixture", "description: Fixture agent.", "model: opus", "tools:"]
    lines += [f"  - {tool}" for tool in tools]
    return "\n".join(lines + ["---", "", body])


def skill_md(name, description):
    return f"---\nname: {name}\ndescription: {description}\n---\n\n# {name}\n"


class Fixture:
    """A repo whose roster names one skill, `alpha`, and whose plugins/probanda/ is a
    correct build of its sources."""

    def __init__(self):
        self.root = os.path.realpath(tempfile.mkdtemp(prefix="check-plugin-"))
        src = "source/probanda/"
        self.roster = {"alpha": ["templates"]}
        self.write(src + "plugin.json", json.dumps({"name": "probanda", "version": VERSION, "hooks": HOOKS}) + "\n")
        self.write(src + "VISION.md", "# vision\n")
        for name in ("localize-helper", "legislation-fetcher"):
            self.write(f"{src}agents/{name}.md", agent([PLAIN + "sources__fetch", BRIDGED + "sources__fetch"]))
        for name in ("verify-claim", "verify-edges", "extract-caselaw", "verify-caselaw"):
            self.write(f"{src}agents/{name}.md",
                       agent([PLAIN + "skill_source__read", BRIDGED + "skill_source__read"], RECITAL_BLOCK + "\n"))
        for name in check_plugin.COMMONS_AGENTS:
            self.write(f"{src}agents/{name}.md", agent([], f"# {name}\n"))
        self.write(src + "mcp/dist/litigation-mcp.js", DATA_BUNDLE)
        self.write(src + "canlii-mcp/dist/canlii-mcp.js", "// src/index.ts\nvar canlii = 1;\n")
        self.write(src + "commons-mcp/dist/legal-commons-mcp.js",
                   '// src/index.ts\nvar client = "supabase"; var tool = "legal_commons__browse";\n')
        self.write(src + "mcp/src/submission/migrate.ts", "from migrate_engine import MigrateError, run\n")

        s = ".claude/skills/"
        self.write(s + "alpha/SKILL.md", SOURCE_SKILL_MD)
        self.write(s + "alpha/references/rules.md", "rules\n")
        self.write(s + "alpha/references/schema.sql", "-- fixture\n")
        self.write(s + "alpha/scripts/run.py", "print('alpha')\n")
        self.write(s + "alpha/templates/form.docx", DOCX_BYTES)
        self.write(s + "alpha/templates/~$form.docx", b"\x00lock")
        self.write(s + "alpha/notes.txt", "not allowlisted, not an asset\n")
        self.write(s + "alpha/tests/test_alpha.py", "excluded\n")
        self.write(s + "alpha/evals/evals.json", "{}\n")
        self.write(s + "alpha/sessions/run.json", "{}\n")
        self.write(s + "alpha/determinizing-tests/baseline.md", "excluded\n")
        self.write(s + "alpha/.pytest_cache/README.md", "excluded\n")
        self.write(s + "alpha/scripts/__pycache__/run.cpython-314.pyc", b"\x00bytecode")
        self.write(s + "alpha/scripts/stale.pyc", b"\x00bytecode")
        self.write(s + "legal-commons/SKILL.md", COMMONS_SKILL_MD)
        self.write(s + "not-in-roster/SKILL.md", skill_md("not-in-roster", "Not shipped."))
        self.write(check_plugin.RECITAL_RULE_SOURCE, f"# Source\n\n{RECITAL_BLOCK}\n")
        for mirror in check_plugin.RECITAL_RULE_SKILL_MIRRORS:
            self.write(s + mirror, f"# Mirror\n\n{RECITAL_BLOCK}\n")
        self.write(s + "drafting-data/references/scripts/migrate_engine.py", ENGINE)
        self.build()

    def write(self, rel, data):
        write(self.root, rel, data)

    def assign(self):
        """Write source/assignment.json: still "planned", so the one plugin probanda is
        built, with every skill folder and agent file placed in one target plugin."""
        skills = set(os.listdir(check_plugin.skills_root(self.root))) - {"shared"}
        skills |= set(check_plugin.public_skill_dirs(self.root))
        agents = [fn[:-3] for fn in os.listdir(os.path.join(self.root, "source", "probanda", "agents"))]
        self.write("source/assignment.json", json.dumps({"status": "planned", "plugins": {"litigator": {
            "requires": [], "skills": sorted(skills), "agents": sorted(agents), "hooks": {},
            "servers": ["data", "canlii", "commons"]}}}) + "\n")

    @property
    def plugin(self):
        return check_plugin.built_plugins(self.root)["probanda"]

    def set_roster(self, roster):
        self.roster = roster
        self.write("source/probanda/roster.json", json.dumps(roster) + "\n")

    def build(self):
        """Write roster.json and plugins/probanda/ as a correct build of the sources would."""
        self.set_roster(self.roster)
        self.assign()
        shutil.rmtree(os.path.join(self.root, "plugins", "probanda"), ignore_errors=True)
        skills = check_plugin.skills_root(self.root)
        assets = {s: tuple(d) for s, d in self.roster.items() if d}
        for rel in check_plugin.skill_source_expected(skills, sorted(self.roster), assets):
            data = read(skills, rel)
            if rel.split("/")[0] in self.roster and rel.endswith("/SKILL.md") and rel.count("/") == 1:
                data = check_plugin.stamp_skill_md(data.decode("utf-8"), "probanda", VERSION).encode("utf-8")
            self.write("plugins/probanda/skills/" + rel, data)
        self.write("plugins/probanda/VISION.md", read(self.root, "source/probanda/VISION.md"))

    def results(self):
        self.assign()
        return {label.split(":", 1)[0]: (ok, detail)
                for _plugin, label, ok, detail in check_plugin.run_checks(self.root)}

    def manifest(self):
        return check_plugin.shipped_manifest(self.root, self.plugin)

    def source_sha(self, rel):
        return hashlib.sha256(read(check_plugin.skills_root(self.root), rel)).hexdigest()

    def purity(self, manifest=None, baseline=None):
        return check_plugin.shipped_tree_purity(
            self.root, self.plugin, self.manifest() if manifest is None else manifest, ["alpha"], ASSETS,
            baseline or {"host_path": {}, "matter_code": {}}, version=VERSION)

    def cleanup(self):
        shutil.rmtree(self.root, ignore_errors=True)


class FixtureTest(unittest.TestCase):
    def setUp(self):
        self.fixture = Fixture()
        self.addCleanup(self.fixture.cleanup)
        # The committed list names the real repo's skills, so every entry is stale against the fixture.
        self.fixture.write("reference_unshipped_baseline.json", json.dumps({"known_unshipped": []}) + "\n")
        patcher = mock.patch.object(check_plugin, "REFERENCE_UNSHIPPED_BASELINE",
                                    os.path.join(self.fixture.root, "reference_unshipped_baseline.json"))
        patcher.start()
        self.addCleanup(patcher.stop)

    def assertOnlyFails(self, name, fragment):
        """`name` fails with a detail mentioning `fragment`; every other check passes."""
        results = self.fixture.results()
        ok, detail = results[name]
        self.assertFalse(ok, f"{name} passed a planted violation")
        self.assertIn(fragment, detail)
        others = {n: d for n, (o, d) in results.items() if o is not True and n != name}
        self.assertEqual(others, {}, "other checks failed too")


class TestCleanFixture(FixtureTest):

    def test_every_check_runs_and_passes(self):
        results = self.fixture.results()
        self.assertEqual(list(results), CHECK_NAMES)
        self.assertEqual({n: d for n, (ok, d) in results.items() if ok is not True}, {})

    def test_commons_bundle_is_exempt_from_purity(self):
        self.assertIn(b"supabase", read(self.fixture.root, "source/probanda/commons-mcp/dist/legal-commons-mcp.js"))
        self.assertTrue(self.fixture.results()["bundle-purity"][0])

    def test_main_prints_one_line_per_check_and_exits_by_verdict(self):
        def run_main():
            out = io.TextIOWrapper(io.BytesIO(), encoding="utf-8")   # main() reconfigures stdout
            with mock.patch.object(check_plugin, "REPO", self.fixture.root), contextlib.redirect_stdout(out):
                code = check_plugin.main(["check_plugin.py"])
            out.flush()
            return code, out.buffer.getvalue().decode("utf-8")

        code, out = run_main()
        self.assertEqual(code, 0, out)
        self.assertEqual(out.count("  [PASS] "), len(CHECK_NAMES))
        self.assertIn("ALL CHECKS PASSED", out)

        self.fixture.write("source/probanda/canlii-mcp/dist/canlii-mcp.js", "var x = 'supabase';\n")
        code, out = run_main()
        self.assertEqual(code, 1)
        self.assertIn("  [FAIL] bundle-purity: ", out)
        self.assertIn(" — found: canlii-mcp/dist: supabase", out)
        self.assertIn("CHECK FAILED — 1 invariant(s) violated.", out)


class TestPlantedViolations(FixtureTest):
    """One planted violation per check; each must fail its own check and no other."""

    def test_roster_sanity(self):
        self.fixture.set_roster({"alpha": ["templates"], "beta": []})
        self.assertOnlyFails("roster-sanity", "missing source for: beta")

    def test_reserved_name(self):
        self.fixture.write(".claude/skills/claude-helper/SKILL.md", skill_md("claude-helper", "Reserved."))
        self.fixture.roster["claude-helper"] = []
        self.fixture.build()
        self.assertOnlyFails("reserved-name", "claude-helper")

    def test_description_no_xml_tags(self):
        self.fixture.write(".claude/skills/alpha/SKILL.md",
                           SOURCE_SKILL_MD.replace("Fixture roster skill.", "Writes docs/<run-date>/ output."))
        self.fixture.build()
        self.assertOnlyFails("description-no-xml-tags", "alpha: <run-date>")

    def test_description_length(self):
        self.fixture.write(".claude/skills/alpha/SKILL.md",
                           SOURCE_SKILL_MD.replace("Fixture roster skill.", "x" * 1100))
        self.fixture.build()
        self.assertOnlyFails("description-length", "alpha: 1100 chars, 76 over")

    def test_description_near_limit_passes_with_advisory(self):
        self.fixture.write(".claude/skills/alpha/SKILL.md",
                           SOURCE_SKILL_MD.replace("Fixture roster skill.", "x" * 1000))
        self.fixture.build()
        ok, detail = self.fixture.results()["description-length"]
        self.assertTrue(ok)
        self.assertIn("NEAR LIMIT", detail)

    def test_no_absolute_repo_paths(self):
        # Under tests/, which never ships, so the host-path ratchet is not involved.
        absolute = os.path.join(self.fixture.root, ".claude", "skills", "alpha", "references", "rules.md")
        self.fixture.write(".claude/skills/alpha/tests/notes.md", f"see {absolute}\n")
        self.assertOnlyFails("no-absolute-repo-paths", "alpha/tests/notes.md")

    def test_reference_resolution(self):
        self.fixture.write(".claude/skills/alpha/SKILL.md", SOURCE_SKILL_MD + "And `references/missing.md`.\n")
        self.fixture.build()
        self.assertOnlyFails("reference-resolution", "alpha/SKILL.md -> references/missing.md")

    def test_entry_point_registry(self):
        self.fixture.write(".claude/skills/drafting-data/references/scripts/migrate_engine.py",
                           ENGINE.replace("def run(request):", "def run2(request):"))
        self.assertOnlyFails("entry-point-registry", "'run' not found at top level")

    def test_bundle_purity(self):
        self.fixture.write("source/probanda/canlii-mcp/dist/canlii-mcp.js",
                           '// src/index.ts\nvar tool = "legal_commons__browse";\n')
        self.assertOnlyFails("bundle-purity", "canlii-mcp/dist: legal_commons__")

    def test_sources_host_guard(self):
        self.fixture.write("source/probanda/mcp/dist/litigation-mcp.js",
                           DATA_BUNDLE.replace("  assertSourcesHost(url, allowed);\n  return", "  return"))
        self.assertOnlyFails("sources-host-guard", "in requestSource is not preceded by assertSourcesHost")

    def test_fetch_grant_allowlist(self):
        self.fixture.write("source/probanda/agents/third.md",
                           agent([PLAIN + "sources__fetch", BRIDGED + "sources__fetch"]))
        self.assertOnlyFails("fetch-grant-allowlist", "third.md grants sources__fetch but is not in FETCH_GRANT_AGENTS")

    def test_recital_rule_mirror(self):
        self.fixture.write("source/probanda/agents/verify-claim.md",
                           agent([PLAIN + "skill_source__read", BRIDGED + "skill_source__read"],
                                 RECITAL_BLOCK.replace("own reasons", "own reasons, or a quoted authority") + "\n"))
        self.assertOnlyFails("recital-rule-mirror", "source/probanda/agents/verify-claim.md: block differs")

    def test_bundle_no_host_path(self):
        self.fixture.write("source/probanda/mcp/dist/litigation-mcp.js",
                           DATA_BUNDLE.replace('var serverName = "data";', 'var root = "/home/someone/repo";'))
        self.assertOnlyFails("bundle-no-host-path", "mcp/dist/litigation-mcp.js: '/home/someone/'")

    def test_bundle_schema_ceiling(self):
        self.fixture.write("source/probanda/mcp/dist/litigation-mcp.js",
                           DATA_BUNDLE.replace("false ? null : 3;", "false ? null : 2;"))
        self.assertOnlyFails("bundle-schema-ceiling", "targets schema 3 but the data bundle was built against 2")

    def test_inverse_reference(self):
        self.fixture.write(".claude/skills/alpha/references/rules.md", "Ask the troubleshooter agent.\n")
        self.fixture.build()
        self.assertOnlyFails("inverse-reference", "'troubleshooter' in alpha/references/rules.md")

    def test_inverse_reference_ignores_the_commons_agents_own_files(self):
        self.assertIn(b"troubleshooter", read(self.fixture.root, "source/probanda/agents/troubleshooter.md"))
        self.assertTrue(self.fixture.results()["inverse-reference"][0])

    def test_shipped_tree_purity(self):
        self.fixture.write("plugins/probanda/skills/alpha/references/rules.md", "edited in the build\n")
        self.assertOnlyFails("shipped-tree-purity", "differs from source: skills/alpha/references/rules.md")

    def test_agent_bridged_grants(self):
        self.fixture.write("source/probanda/agents/helper.md", agent([PLAIN + "matter_data__query"]))
        self.assertOnlyFails("agent-bridged-grants", f"helper.md lacks the bridged twin {BRIDGED}matter_data__query")

    def test_commons_encapsulation(self):
        self.fixture.write(".claude/skills/legal-commons/SKILL.md", COMMONS_SKILL_MD + "Reads practice.db.\n")
        self.fixture.build()
        self.assertOnlyFails("commons-encapsulation", "legal-commons/SKILL.md has 'practice.db'")


class TestSelection(FixtureTest):
    """The check's own selection of what ships (ported from the build half of CoClerk's
    test_shipped_tree_purity.py, which tested the selection on the build side)."""

    def test_expected_is_exactly_roster_and_extra_tree_selection(self):
        expected = check_plugin.skill_source_expected(check_plugin.skills_root(self.fixture.root), ["alpha"], ASSETS)
        self.assertEqual(expected, {
            "alpha/SKILL.md",
            "alpha/references/rules.md",
            "alpha/references/schema.sql",
            "alpha/scripts/run.py",
            "alpha/templates/form.docx",
            "legal-commons/SKILL.md",
            "shared/authority-claim-verification.md",
            "shared/legal-audit-protocol.md",
        })

    def test_skill_md_is_source_plus_preamble(self):
        self.assertIn(f"\n<!-- practice v{VERSION} -->\n",
                      check_plugin.stamp_skill_md(SOURCE_SKILL_MD, "practice", VERSION))
        stamped = check_plugin.stamp_skill_md(SOURCE_SKILL_MD, "probanda", VERSION)
        frontmatter, body = SOURCE_SKILL_MD.split("---\n\n", 1)
        self.assertTrue(stamped.startswith(frontmatter + "---\n"))
        first_body_line = stamped[len(frontmatter + "---\n"):].split("\n")[1]
        self.assertEqual(first_body_line, f"<!-- probanda v{VERSION} -->")
        self.assertTrue(stamped.endswith("\n\n" + body))

    def test_extra_trees_ship_unstamped(self):
        self.assertEqual(read(self.fixture.root, "plugins/probanda/skills/legal-commons/SKILL.md"),
                         COMMONS_SKILL_MD.encode("utf-8"))


class TestShippedTreePurity(FixtureTest):
    """Ported from CoClerk's test_shipped_tree_purity.py."""

    def test_clean_payload_passes_and_reports_totals(self):
        hits, summary = self.fixture.purity()
        self.assertEqual(hits, [])
        self.assertIn("8 shipped-tree entries", summary)
        self.assertIn("host-path 0 hits in 0 files", summary)
        self.assertIn("matter-code 0 hits in 0 files", summary)

    def test_each_selection_rule_is_checked_independently_of_the_build(self):
        manifest = self.fixture.manifest()
        sha = "0" * 64
        cases = {
            "skills/alpha/tests/test_alpha.py": ("excluded path shipped", sha),
            "skills/alpha/scripts/stale.pyc": ("excluded path shipped", sha),
            "skills/alpha/notes.txt": ("neither allowlisted text nor a declared asset", sha),
            "skills/not-in-roster/SKILL.md": ("not a roster skill or an extra tree", sha),
            "skills/alpha/SKILL.md": ("SKILL.md not source + preamble", self.fixture.source_sha("alpha/SKILL.md")),
            "skills/gone/x.md": ("no source file", sha),
        }
        for arcname, (expected, entry_sha) in cases.items():
            with self.subTest(arcname=arcname):
                hits, _ = self.fixture.purity(manifest + [(entry_sha, arcname)])
                self.assertTrue(any(h.startswith(expected) and arcname in h for h in hits), hits)

    def test_stamp_for_a_different_version_fails(self):
        hits, _ = check_plugin.shipped_tree_purity(
            self.fixture.root, self.fixture.plugin, self.fixture.manifest(), ["alpha"], ASSETS,
            {"host_path": {}, "matter_code": {}}, version="9.9.9")
        self.assertEqual(hits, ["SKILL.md not source + preamble: skills/alpha/SKILL.md"])

    def test_shipped_confirmation_sidecar_fails(self):
        rel = "alpha/references/CAN/BC/BCSC/x.md.confirmations.local.json"
        self.fixture.write(".claude/skills/" + rel, '{"file": "x.md", "items": []}\n')
        self.fixture.build()
        self.assertIn("skills/" + rel, {arcname for _sha, arcname in self.fixture.manifest()})
        hits, _ = self.fixture.purity()
        self.assertEqual(hits, [f"confirmation sidecar shipped: skills/{rel}"])

    def test_byte_mismatch_and_missing_entry_fail(self):
        tampered = [((("f" * 64) if a == "skills/shared/legal-audit-protocol.md" else s), a)
                    for s, a in self.fixture.manifest() if a != "skills/alpha/references/rules.md"]
        hits, _ = self.fixture.purity(tampered)
        self.assertIn("differs from source: skills/shared/legal-audit-protocol.md", hits)
        self.assertIn("missing from payload: skills/alpha/references/rules.md", hits)

    def test_vision_dropped_or_changed_fails(self):
        manifest = self.fixture.manifest()
        dropped = [(s, a) for s, a in manifest if a != "VISION.md"]
        self.assertIn("missing from payload: VISION.md", self.fixture.purity(dropped)[0])
        changed = [(("f" * 64) if a == "VISION.md" else s, a) for s, a in manifest]
        self.assertIn("differs from source: VISION.md", self.fixture.purity(changed)[0])

    def test_host_path_ratchet(self):
        self.fixture.write(".claude/skills/alpha/references/rules.md",
                           "see C:\\" + "Users\\someone and /Users/someone/x\n")
        self.fixture.build()
        key = ".claude/skills/alpha/references/rules.md"

        hits, _ = self.fixture.purity()
        self.assertEqual(hits, [f"host_path hits over baseline in {key}: 2 (baseline 0)"])

        hits, summary = self.fixture.purity(baseline={"host_path": {key: 2}, "matter_code": {}})
        self.assertEqual(hits, [])
        self.assertIn("host-path 2 hits in 1 files", summary)

        hits, _ = self.fixture.purity(baseline={"host_path": {key: 1}, "matter_code": {}})
        self.assertEqual(hits, [f"host_path hits over baseline in {key}: 2 (baseline 1)"])

    def test_matter_code_ratchet_covers_tree_agents_and_fixtures_and_never_prints_the_code(self):
        self.fixture.write(".claude/skills/shared/conventions.md", "matter L1234 and L5678\n")
        self.fixture.write("source/probanda/agents/helper.md", "---\nname: helper\n---\n# helper for L9999\n")
        self.fixture.write("source/probanda/mcp/test/fixtures/rule-overlay/r.json", '{"matter": "L4321"}\n')
        self.fixture.build()

        hits, _ = self.fixture.purity()
        self.assertEqual(sorted(hits), [
            "matter_code hits over baseline in .claude/skills/shared/conventions.md: 2 (baseline 0)",
            "matter_code hits over baseline in source/probanda/agents/helper.md: 1 (baseline 0)",
            "matter_code hits over baseline in source/probanda/mcp/test/fixtures/rule-overlay/r.json: 1 (baseline 0)",
        ])
        for code in ("L1234", "L5678", "L9999", "L4321"):
            self.assertFalse(any(code in h for h in hits))

        baseline = {"host_path": {}, "matter_code": {
            ".claude/skills/shared/conventions.md": 2, "source/probanda/agents/helper.md": 1,
            "source/probanda/mcp/test/fixtures/rule-overlay/r.json": 1}}
        hits, summary = self.fixture.purity(baseline=baseline)
        self.assertEqual(hits, [])
        self.assertIn("matter-code 4 hits in 3 files", summary)

    def test_one_more_utbms_code_used_as_utbms_does_not_fail_the_ratchet(self):
        self.fixture.write(".claude/skills/alpha/references/rules.md",
                           "| L330 | Depositions |\nDeposition prep for trial -> L330/A101\nre L1234 file\n")
        self.fixture.build()
        key = ".claude/skills/alpha/references/rules.md"
        hits, _ = self.fixture.purity()
        self.assertEqual(hits, [f"matter_code hits over baseline in {key}: 1 (baseline 0)"])

    def test_binary_asset_is_not_scanned_as_text(self):
        self.fixture.write(".claude/skills/alpha/templates/form.docx", b"\x00C:\\" + b"Users\\x L1234")
        self.fixture.build()
        hits, _ = self.fixture.purity()
        self.assertEqual(hits, [])


class TestPublicSkill(FixtureTest):
    """A skill under public/ ships whole and unstamped, and lives in one place only."""

    PUBLIC = "public/plugins/practice/skills/"

    def setUp(self):
        super().setUp()
        self.fixture.write(self.PUBLIC + "beta/SKILL.md", skill_md("beta", "A public skill."))
        self.fixture.write(self.PUBLIC + "beta/references/style.md", "style\n")
        for rel in ("beta/SKILL.md", "beta/references/style.md"):
            self.fixture.write("plugins/probanda/skills/" + rel, read(self.fixture.root, self.PUBLIC + rel))

    def test_public_skill_shipped_as_it_is_passes_every_check(self):
        self.assertEqual({n: d for n, (ok, d) in self.fixture.results().items() if not ok}, {})
        self.assertIn("beta", check_plugin.skill_names(self.fixture.root, self.fixture.plugin))

    def test_stamped_or_edited_copy_fails(self):
        self.fixture.write("plugins/probanda/skills/beta/SKILL.md", skill_md("beta", "Edited."))
        self.assertOnlyFails("shipped-tree-purity", "differs from its public source: skills/beta/SKILL.md")

    def test_public_file_missing_from_the_build_fails(self):
        os.remove(os.path.join(self.fixture.root, "plugins", "probanda", "skills", "beta", "references", "style.md"))
        self.assertOnlyFails("shipped-tree-purity", "missing from payload: skills/beta/references/style.md")

    def test_shipped_file_with_no_public_source_fails(self):
        self.fixture.write("plugins/probanda/skills/beta/extra.md", "x\n")
        self.assertOnlyFails("shipped-tree-purity", "no public source file: skills/beta/extra.md")

    def test_skill_in_both_places_fails(self):
        self.fixture.write(".claude/skills/beta/SKILL.md", skill_md("beta", "A private copy."))
        self.assertOnlyFails("shipped-tree-purity", "skill in both public/ and .claude/skills/: beta")

    def test_overlong_public_description_fails(self):
        self.fixture.write(self.PUBLIC + "beta/SKILL.md", skill_md("beta", "x" * 1100))
        self.fixture.write("plugins/probanda/skills/beta/SKILL.md", read(self.fixture.root, self.PUBLIC + "beta/SKILL.md"))
        self.assertOnlyFails("description-length", "beta: 1100 chars")


class TestReferenceToUnshippedFile(FixtureTest):
    """reference-resolution: a target inside the skills tree must also ship, because an
    install reads the shipped tree and has nothing else."""

    def setUp(self):
        super().setUp()
        self.fixture.write(".claude/skills/alpha/SKILL.md",
                           SOURCE_SKILL_MD + "See `tests/test_alpha.py`.\n")
        self.shipped = check_plugin.skill_source_expected(
            check_plugin.skills_root(self.fixture.root), ["alpha"], ASSETS)

    def resolves(self, ref, shipped=None):
        return check_plugin.reference_resolves(self.fixture.root, ref, "alpha", "alpha", False, ASSETS, shipped)

    def test_reference_to_unshipped_file_fails(self):
        self.assertNotIn("alpha/tests/test_alpha.py", self.shipped)
        self.assertTrue(self.resolves("tests/test_alpha.py"))
        self.assertFalse(self.resolves("tests/test_alpha.py", self.shipped))
        self.assertTrue(self.resolves("references/rules.md", self.shipped))
        self.assertEqual(check_plugin.broken_references(self.fixture.root, "alpha", ASSETS, self.shipped),
                         [("alpha/SKILL.md", "tests/test_alpha.py (resolves but does not ship)")])
        self.assertEqual(check_plugin.broken_references(self.fixture.root, "alpha", ASSETS), [])

    def test_known_unshipped_list_passes_listed_and_fails_unlisted_and_stale(self):
        listed = "alpha/SKILL.md -> tests/test_alpha.py (resolves but does not ship)"
        unlisted = "alpha/SKILL.md -> tests/test_beta.py (resolves but does not ship)"
        self.assertEqual(check_plugin.reference_hit_verdict([listed], {listed}), ([], 1))
        self.assertEqual(check_plugin.reference_hit_verdict([listed, unlisted], {listed}), ([unlisted], 1))
        self.assertEqual(check_plugin.reference_hit_verdict([], {listed}),
                         ([f"stale known-unshipped entry: {listed}"], 0))


class TestHookMatchers(FixtureTest):
    """hook-matchers: a matcher that names a plugin tool or agent names one that plugin ships."""

    def plant(self, event, matcher):
        hooks = {**HOOKS, event: HOOKS.get(event, []) + [{"matcher": matcher, "hooks": []}]}
        self.fixture.write("source/probanda/plugin.json",
                           json.dumps({"name": "probanda", "version": VERSION, "hooks": hooks}) + "\n")

    def test_server_the_plugin_does_not_ship_fails(self):
        self.plant("PreToolUse", "mcp__(.+__)?plugin_probanda_westlaw__search")
        self.assertOnlyFails("hook-matchers", "PreToolUse matcher names server 'westlaw', which 'probanda' does not ship")

    def test_tool_of_a_plugin_that_is_not_built_fails(self):
        self.plant("PostToolUse", "Bash|mcp__plugin_practice_data__rules__audit")
        self.assertOnlyFails("hook-matchers", "names server 'data' of 'practice', which is not a built plugin")

    def test_plugin_tool_the_check_cannot_read_fails(self):
        self.plant("PreToolUse", "mcp__plugin_.+__rules__audit")
        self.assertOnlyFails("hook-matchers", "names a plugin tool this check cannot read")

    def test_agent_the_plugin_does_not_ship_fails(self):
        self.plant("SubagentStop", "probanda:ghost")
        self.assertOnlyFails("hook-matchers", "SubagentStop matcher names agent 'ghost', which 'probanda' does not ship")

    def test_host_tools_and_host_agents_pass(self):
        hooks = {"PreToolUse": [{"matcher": "Read|Write|SendUserFile|mcp__(.+__)?device_.*", "hooks": []},
                                {"matcher": "mcp__.+mail_(send_email|forward_email)", "hooks": []}],
                 "SubagentStart": [{"matcher": "Explore", "hooks": []}],
                 "SessionStart": [{"hooks": []}]}
        self.fixture.write("source/probanda/plugin.json",
                           json.dumps({"name": "probanda", "version": VERSION, "hooks": hooks}) + "\n")
        self.assertEqual(self.fixture.results()["hook-matchers"], (True, "3 matchers read"))

    def test_plugin_with_no_matcher_is_not_applicable(self):
        self.fixture.write("source/probanda/plugin.json", json.dumps({"name": "probanda", "version": VERSION}) + "\n")
        ok, detail = self.fixture.results()["hook-matchers"]
        self.assertIsNone(ok)
        self.assertEqual(detail, "does not apply: probanda declares no hook matcher")

    def violations(self, hooks, strict):
        litigator = {"name": "litigator", "requires": ["practice"]}
        servers = {"practice": ["data"], "research": ["canlii"], "litigator": []}
        agents = {"practice": ["docket-clerk"], "research": ["verify-claim"], "litigator": ["marshal-facts"]}
        return check_plugin.hook_matcher_violations({"hooks": hooks}, litigator, servers, agents, strict)[0]

    def test_at_cutover_a_matcher_names_only_its_own_plugin_or_one_it_requires(self):
        hooks = {"PreToolUse": [{"matcher": "mcp__(.+__)?plugin_practice_data__x|mcp__plugin_research_canlii__y"}],
                 "SubagentStart": [{"matcher": "practice:docket-clerk|litigator:marshal-facts|research:verify-claim"}]}
        self.assertEqual(self.violations(hooks, strict=True), [
            "PreToolUse matcher names server 'canlii' of 'research', which 'litigator' does not require",
            "SubagentStart matcher names agent 'verify-claim' of 'research', which 'litigator' does not require"])
        self.assertEqual(self.violations(hooks, strict=False), [])

    def test_a_server_named_under_the_wrong_plugin_fails(self):
        hooks = {"PreToolUse": [{"matcher": "mcp__plugin_practice_canlii__y"}]}
        self.assertEqual(self.violations(hooks, strict=True),
                         ["PreToolUse matcher names server 'canlii', which 'practice' does not ship"])


SPEC = {"requires": [], "skills": [], "agents": [], "hooks": {}, "servers": []}


class TestAcrossPlugins(unittest.TestCase):
    """unique-names and layering, on a small repo with two plugins in its assignment."""

    def setUp(self):
        self.root = os.path.realpath(tempfile.mkdtemp(prefix="check-plugin-"))
        self.addCleanup(shutil.rmtree, self.root, ignore_errors=True)

    def assign(self, status, practice, litigator):
        write(self.root, "source/assignment.json", json.dumps({"status": status, "plugins": {
            "practice": {**SPEC, **practice}, "litigator": {**SPEC, "requires": ["practice"], **litigator}}}))
        for name, given in (("practice", practice), ("litigator", litigator)):
            write(self.root, f"source/{name}/roster.json", json.dumps({s: [] for s in given.get("skills", [])}))

    def test_unique_names_passes_when_no_name_ships_twice(self):
        self.assign("cutover", {"skills": ["show-me"], "agents": ["clerk"]}, {"skills": ["draft"], "agents": ["marshal"]})
        self.assertEqual(check_plugin.check_unique_names(self.root), (True, ""))

    def test_skill_or_agent_in_two_plugins_fails(self):
        self.assign("cutover", {"skills": ["show-me", "draft"], "agents": ["clerk"]},
                    {"skills": ["draft"], "agents": ["clerk", "marshal"]})
        self.assertEqual(check_plugin.check_unique_names(self.root),
                         (False, "skill 'draft' ships in practice and litigator; agent 'clerk' ships in practice and litigator"))

    def layering(self, status, rulings):
        self.assign(status, {"skills": ["show-me"]}, {"skills": ["matter-data"]})
        write(self.root, ".claude/skills/show-me/SKILL.md", "Ask `/matter-data` first.\n")
        write(self.root, ".claude/skills/matter-data/SKILL.md", "Present it with /show-me.\n")
        write(self.root, "source/layering.json", json.dumps(rulings))
        return check_plugin.check_layering_rule(self.root)

    PAIR = {"file": ".claude/skills/show-me/SKILL.md", "target": "matter-data"}

    def test_upward_reference_with_no_ruling_fails_before_and_at_cutover(self):
        for status in ("planned", "cutover"):
            with self.subTest(status=status):
                self.assertEqual(self.layering(status, {"allowed": [], "todo": []}),
                                 (False, "no ruling: .claude/skills/show-me/SKILL.md names matter-data"))

    def test_reference_still_to_fix_passes_until_cutover_and_fails_at_it(self):
        rulings = {"allowed": [], "todo": [self.PAIR]}
        self.assertEqual(self.layering("planned", rulings), (True, "1 upward pairs, 1 still to fix before cutover"))
        self.assertEqual(self.layering("cutover", rulings),
                         (False, "still to fix: .claude/skills/show-me/SKILL.md names matter-data"))

    def test_allowed_reference_passes_at_cutover_and_a_stale_ruling_fails(self):
        self.assertEqual(self.layering("cutover", {"allowed": [self.PAIR], "todo": []}), (True, "1 upward pairs"))
        stale = {"file": ".claude/skills/show-me/SKILL.md", "target": "draft"}
        ok, detail = self.layering("planned", {"allowed": [self.PAIR, stale], "todo": []})
        self.assertFalse(ok)
        self.assertIn("stale ruling (nothing matches it): .claude/skills/show-me/SKILL.md names draft", detail)

    def test_skill_folder_with_no_plugin_fails_instead_of_ending_the_run(self):
        write(self.root, ".claude/skills/orphan/SKILL.md", "x\n")
        ok, detail = self.layering("planned", {"allowed": [self.PAIR], "todo": []})
        self.assertFalse(ok)
        self.assertIn("has no plugin in source/assignment.json", detail)


class TestSecondPlugin(FixtureTest):
    """A plugin that ships no server, agent or skill of its own: each check that guards
    one says it does not apply, and the rest run against that plugin's own folders."""

    NOT_APPLICABLE = {
        "entry-point-registry": "solicitor ships no server that imports a pinned entry point",
        "bundle-purity": "solicitor ships neither the data nor the canlii server",
        "sources-host-guard": "solicitor does not ship the data server",
        "fetch-grant-allowlist": "solicitor ships no agent",
        "bundle-no-host-path": "solicitor ships no server",
        "bundle-schema-ceiling": "solicitor does not ship the data server",
        "agent-bridged-grants": "solicitor ships no agent",
        "commons-encapsulation": "solicitor does not ship the legal-commons skill",
        "hook-matchers": "solicitor declares no hook matcher",
    }

    def setUp(self):
        super().setUp()
        self.fixture.write("source/solicitor/plugin.json", json.dumps(
            {"name": "solicitor", "version": "0.2.0", "dependencies": ["probanda"]}) + "\n")
        self.fixture.write("source/solicitor/roster.json", "{}\n")
        self.fixture.write("source/solicitor/VISION.md", "# solicitor\n")
        self.fixture.write("plugins/solicitor/VISION.md", "# solicitor\n")
        skills = check_plugin.skills_root(self.fixture.root)
        for rel in check_plugin.skill_source_expected(skills, [], {}, ("shared",)):
            self.fixture.write("plugins/solicitor/skills/" + rel, read(skills, rel))
        solicitor = {"name": "solicitor", "source": "source/solicitor", "requires": ["probanda"],
                     "servers": [], "skills": [], "agents": []}
        patcher = mock.patch.object(check_plugin, "built_plugins",
                                    return_value={"probanda": self.fixture.plugin, "solicitor": solicitor})
        patcher.start()
        self.addCleanup(patcher.stop)

    def results(self, plugin):
        return {label.split(":", 1)[0]: (ok, detail)
                for owner, label, ok, detail in check_plugin.run_checks(self.fixture.root) if owner == plugin}

    def test_each_plugin_is_checked_and_what_it_does_not_ship_is_not_applicable(self):
        self.assertEqual({n: d for n, (ok, d) in self.results("probanda").items() if ok is not True}, {})
        solicitor = self.results("solicitor")
        self.assertEqual(list(solicitor), CHECK_NAMES[:-3])
        self.assertEqual({n: d for n, (ok, d) in solicitor.items() if ok is None},
                         {n: f"does not apply: {why}" for n, why in self.NOT_APPLICABLE.items()})
        self.assertEqual({n: d for n, (ok, d) in solicitor.items() if ok is False}, {})
        self.assertEqual({n: ok for n, (ok, _) in self.results(None).items()}, {"unique-names": True, "layering": True, "file-ops": True})

    def test_a_plugin_is_checked_against_its_own_built_folder_and_stamp(self):
        self.fixture.write("plugins/solicitor/skills/shared/legal-audit-protocol.md", "edited in the build\n")
        ok, detail = self.results("solicitor")["shipped-tree-purity"]
        self.assertFalse(ok)
        self.assertEqual(detail, "differs from source: skills/shared/legal-audit-protocol.md")
        self.assertTrue(self.results("probanda")["shipped-tree-purity"][0])

    def test_dependencies_that_differ_from_the_assignment_fail(self):
        for declared in ({}, {"dependencies": []}, {"dependencies": ["probanda", "research"]}):
            with self.subTest(declared=declared):
                self.fixture.write("source/solicitor/plugin.json", json.dumps(
                    {"name": "solicitor", "version": "0.2.0", **declared}) + "\n")
                ok, detail = self.results("solicitor")["dependencies"]
                self.assertFalse(ok)
                self.assertEqual(detail, f"plugin.json declares {sorted(declared.get('dependencies', []))}, "
                                         "but source/assignment.json requires ['probanda']")
        self.assertEqual(self.results("probanda")["dependencies"], (True, ""))

    def test_main_prints_a_section_for_each_plugin_and_one_across_them(self):
        out = io.TextIOWrapper(io.BytesIO(), encoding="utf-8")   # main() reconfigures stdout
        with mock.patch.object(check_plugin, "REPO", self.fixture.root), contextlib.redirect_stdout(out):
            code = check_plugin.main(["check_plugin.py"])
        out.flush()
        text = out.buffer.getvalue().decode("utf-8")
        self.assertEqual(code, 0, text)
        self.assertIn("Invariant checks for 'probanda' (2 skills):", text)
        self.assertIn("Invariant checks for 'solicitor' (0 skills):", text)
        self.assertIn("Checks across the plugins built:", text)
        self.assertIn("  [N/A] sources-host-guard: ", text)
        self.assertIn(" — does not apply: solicitor does not ship the data server", text)
        self.assertEqual(text.count("  [N/A] "), len(self.NOT_APPLICABLE))


class TestMatterCodePattern(unittest.TestCase):
    """Three- and four-digit matter codes count; nothing wider does."""

    def test_counts_three_and_four_digit_codes_only(self):
        for text, expected in (("4165.L153", ["L153"]), ("re L4443 file", ["L4443"]),
                               ("L12345", []), ("LX153", [])):
            with self.subTest(text=text):
                self.assertEqual(check_plugin.MATTER_CODE.findall(text), expected)


class TestMatterCodes(unittest.TestCase):
    """UTBMS task codes on a UTBMS-context line are not matter codes; every matter
    reference still is, including three-digit ones."""

    def assertCodes(self, cases):
        for text, expected in cases:
            with self.subTest(text=text):
                self.assertEqual(check_plugin.matter_codes(text), expected)

    def test_utbms_codes_used_as_utbms_are_not_counted(self):
        self.assertCodes((
            ("| L150 | Trial Preparation and Trial | Trial binders |", []),
            ("Telephone call with client re: settlement offer  L150/A106  Draft", []),
            ('  "utbms_task": "L120",', []),
            ("pre-trial pleading work -> L120, discovery -> L130 (task code)", []),
            ("Correct a UTBMS code: entry 1 should be L150, not L120", []),
            ("classifies a block as L140 (Documents) ... coded it L510/A103", []),
        ))

    def test_matter_references_still_count(self):
        self.assertCodes((
            ("4165.L153", ["L153"]),
            ("re L4443 file", ["L4443"]),
            ("L166 DartJ re costs", ["L166"]),
        ))

    def test_collision_policy(self):
        self.assertCodes((
            ("L160 DartJ re appeal", ["L160"]),
            ("L160 appeal work, coded L160/A103", []),
            ("L153 call with client  L120/A106", ["L153"]),
            ("L4443 billed under UTBMS L150", ["L4443"]),
        ))


class TestCommittedBaselines(unittest.TestCase):
    """The committed baselines are paths and positive counts, nothing else."""

    def test_skill_source_baseline_shape_and_no_matched_text(self):
        with open(check_plugin.SKILL_SOURCE_BASELINE, encoding="utf-8") as f:
            text = f.read()
        data = json.loads(text)
        self.assertEqual(set(data), {"host_path", "matter_code"})
        for scan, entries in data.items():
            for path, n in entries.items():
                with self.subTest(scan=scan, path=path):
                    self.assertTrue(path.startswith((".claude/skills/", "source/probanda/agents/",
                                                     "source/probanda/mcp/test/fixtures/rule-overlay/")))
                    self.assertIsInstance(n, int)
                    self.assertGreater(n, 0)
        self.assertIsNone(check_plugin.MATTER_CODE.search(text))
        self.assertIsNone(check_plugin.HOST_PATH.search(text))

    def test_reference_baseline_is_a_list(self):
        with open(check_plugin.REFERENCE_UNSHIPPED_BASELINE, encoding="utf-8") as f:
            self.assertIsInstance(json.load(f)["known_unshipped"], list)


if __name__ == "__main__":
    unittest.main()
