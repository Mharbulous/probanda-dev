// The environment facts a suggestion carries (docs/Plans/2026-10-25_suggestion-design.md, decision 19),
// read from an invented install layout whose paths, environment and computer hold a planted user name
// and host name. The facts hold neither, and no path; with Cowork's tools absent the host is Code.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { environmentFacts, reduceToolNames } = await import("../build/suggestions/environment.js");
const { buildToolDefinitions } = await import("../build/schema-gen.js");

const USER = "zqxuser";
const HOST = "zqx-laptop";

// The `claude plugin install` layout: <cache>/<marketplace>/<plugin>/<version>/, under a home folder
// named for the planted user.
function installLayout(t) {
  const dir = mkdtempSync(join(tmpdir(), `probanda-env-${USER}-`));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, "home", USER);
  const cache = join(home, ".claude", "plugins", "cache", `${HOST}-market`);
  const plugin = (name, version) => {
    const root = join(cache, name, version);
    mkdirSync(join(root, ".claude-plugin"), { recursive: true });
    mkdirSync(join(root, "skills", "shared"), { recursive: true });
    writeFileSync(join(root, ".claude-plugin", "plugin.json"), JSON.stringify({ name, version }));
    return root;
  };
  const lawyer = plugin("lawyer", "0.9.14");
  plugin("researcher", "0.9.14");
  plugin("file-manager", `0.9.3-${USER}`); // a version holding the user name is dropped
  plugin("developer", "0.1.29");
  plugin("not-probanda", "1.0.0");
  const env = { HOME: home, USER, LOGNAME: USER, HOSTNAME: HOST, PATH: process.env.PATH };
  return { lawyer, home, env };
}

const lawyerTools = buildToolDefinitions().map((d) => d.name);

test("the facts name each plugin, installed or not, with its version, and no user name, host name or path", (t) => {
  const { lawyer, home, env } = installLayout(t);
  const toolNames = [
    ...lawyerTools.filter((name) => name !== "practice_data__matter_lookup").map((name) => `mcp__plugin_lawyer_data__${name}`),
    "mcp__plugin_researcher_canlii__browse_legislation",
    `mcp__plugin_lawyer_data__${USER}_tool`, // not a tool lawyer ships, and it holds the user name
    "Read", "Bash", "mcp__other_server__thing", "mcp__plugin_probanda_data__old",
  ];
  const facts = environmentFacts(toolNames, {
    installRoot: lawyer, env, platform: "linux", release: `6.1.0-${HOST}`, arch: "x64", hostname: HOST, username: USER,
  });

  const serialized = JSON.stringify(facts);
  for (const secret of [USER, HOST, home, lawyer]) assert.ok(!serialized.includes(secret), `facts hold ${secret}`);
  assert.doesNotMatch(serialized, /[\\/]/, "facts hold no path");

  assert.deepEqual(facts.plugins.map((p) => [p.plugin, p.installed, p.version]), [
    ["lawyer", true, "0.9.14"],
    ["researcher", true, "0.9.14"],
    ["litigator", false, null],
    ["solicitor", false, null],
    ["file-manager", true, null],
    ["billing", false, null],
    ["timekeeper", false, null],
    ["developer", true, "0.1.29"],
  ]);
  const lawyerFacts = facts.plugins[0];
  const data = lawyerFacts.servers.find((s) => s.server === "data");
  assert.deepEqual(data.missing, ["practice_data__matter_lookup"]);
  assert.ok(data.visible.includes("suggestion_card__check"));
  assert.equal(data.visible.length, lawyerTools.length - 1);
  const mail = lawyerFacts.servers.find((s) => s.server === "contacts-calendars-email");
  assert.deepEqual(mail.visible, []);
  assert.ok(mail.missing.length > 0);
  const researcher = facts.plugins[1];
  assert.deepEqual(researcher.servers, [
    { server: "canlii", visible: ["browse_legislation"], missing: null },
    { server: "commons", visible: [], missing: null },
  ]);
  assert.equal(facts.plugins[2].servers, undefined, "a plugin not installed lists no tools");
  assert.equal(facts.other_tools, 4);
  assert.equal(facts.host, "Code");
  assert.deepEqual(facts.os, { platform: "Linux", release: null, arch: "x64" });
});

test("with Cowork's tools absent and no Claude Code marker the host is Code from the plain tool names", (t) => {
  const { lawyer, env } = installLayout(t);
  const facts = environmentFacts(["mcp__plugin_lawyer_data__suggestion_card__check", "Read"], { installRoot: lawyer, env });
  assert.equal(env.CLAUDECODE, undefined);
  assert.equal(facts.host, "Code");
});

test("bridged Probanda tool names mean Cowork; no tool names at all leave the host to the process", (t) => {
  const { lawyer, env } = installLayout(t);
  const bridged = environmentFacts(["mcp__remote-devices__plugin_lawyer_data__suggestion_card__check"], { installRoot: lawyer, env });
  assert.equal(bridged.host, "Cowork");
  assert.deepEqual(bridged.plugins[0].servers[0].visible, ["suggestion_card__check"]);
  const none = environmentFacts(undefined, { installRoot: lawyer, env });
  assert.equal(none.host, "unknown");
  assert.equal(none.other_tools, null);
  assert.equal(none.plugins[0].servers, undefined);
  assert.equal(environmentFacts(undefined, { installRoot: lawyer, env: { ...env, CLAUDECODE: "1" } }).host, "Code");
});

test("a checkout run reports lawyer installed, with no version, and no sibling", () => {
  const facts = environmentFacts([], { installRoot: join(tmpdir(), "no-such-install"), env: { PATH: process.env.PATH } });
  assert.deepEqual(facts.plugins.filter((p) => p.installed).map((p) => [p.plugin, p.version]), [["lawyer", null]]);
});

test("tool names reduce to Probanda's own and a count of the rest", () => {
  const { probanda, others } = reduceToolNames([
    "mcp__plugin_lawyer_data__preferences__read",
    "mcp__plugin_lawyer_data__preferences__read",
    "mcp__plugin_file-manager_files__file_ops__move",
    "mcp__plugin_billing_timecamp__entries",
    "mcp__plugin_lawyer_nosuchserver__x",
    "Write",
  ]);
  assert.deepEqual(probanda.map((t) => [t.plugin, t.server, t.tool]), [
    ["lawyer", "data", "preferences__read"],
    ["file-manager", "files", "file_ops__move"],
    ["billing", "timecamp", "entries"],
  ]);
  assert.equal(others, 2);
});
