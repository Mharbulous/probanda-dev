// /file-naming's name gate, run host-side for /housekeeping's resolve (spec §B9.1, §B9.4).
//
// The grammar stays in `source/skills/file-naming/scripts/name_gate.py`; nothing here parses a
// name. runPythonDriver passes no argv, so a small driver feeds the gate's own CLI entry point
// (`name_gate.main(argv)`) once per flag-token set, all in one spawn, and collects each call's
// printed results.

import { existsSync } from "node:fs";
import { win32 as pathWin32 } from "node:path";

import { DataServerError } from "../errors.js";
import { pythonDriverFile } from "../python-driver.js";
import { runPythonDriver } from "../python-spawn.js";
import { READ_TIMEOUT_MS } from "../python-timeout.js";
import { installedPluginLabel, resolveShippedRoot } from "../repo-root.js";

const DRIVER = `import contextlib, io, json, sys
import name_gate
payload = json.load(sys.stdin)
out = []
for group in payload["groups"]:
    buf = io.StringIO()
    # "./" keeps a name that starts with "-" from reading as an option; the gate takes the basename.
    argv = ["--registry", payload["registry"], "--files", *["./" + n for n in group["names"]], "--flag-tokens", ",".join(group["flag_tokens"])]
    with contextlib.redirect_stdout(buf):
        code = name_gate.main(argv)
    if code:
        raise SystemExit("name_gate.py exited %s" % code)
    out.append(json.loads(buf.getvalue())["results"])
json.dump({"groups": out}, sys.stdout)
`;

export interface GateResult {
  name: string;
  verdict: "conforms" | "fails";
  reason: string;
  flags: string[];
  /** The CODE token as written, only when the name conforms. */
  code: string | null;
}

export interface GateGroup {
  names: string[];
  flag_tokens: string[];
}

/**
 * The file-naming skill folder, holding `scripts/name_gate.py` and `references/code-registry.md`.
 * Resolved lazily, per call, install-first (resolveShippedRoot), in the shape of
 * caseDataMigrateScriptsDir: a missing root is a clear per-call error, not a startup crash.
 */
export function fileNamingSkillDir(env: NodeJS.ProcessEnv = process.env, installRoot?: string): string {
  const shipped = resolveShippedRoot("file-naming/scripts/name_gate.py", env, {
    code: "repo_root_missing",
    subject: "the file-naming name gate",
    plugin: "lawyer",
    installRoot,
  });
  const dir = pathWin32.join(shipped.root, "file-naming");
  for (const rel of [["scripts", "name_gate.py"], ["references", "code-registry.md"]]) {
    if (!existsSync(pathWin32.join(dir, ...rel))) {
      throw new DataServerError(
        `${rel.join("\\")} not found under ${dir} -- ` +
          (shipped.shipped_from === "install"
            ? `${installedPluginLabel(shipped)}'s bundled skill source lacks it; reinstall the plugin and fully restart`
            : "the installed bundle predates this phase, or the repo has moved; reinstall the plugin and fully restart"),
        "repo_root_missing"
      );
    }
  }
  return dir;
}

/** Runs the gate over every group in one spawn. Returns one result list per group, in order. */
export function runNameGate(groups: GateGroup[], env: NodeJS.ProcessEnv = process.env): GateResult[][] {
  const live = groups.filter((g) => g.names.length > 0);
  if (live.length === 0) return groups.map(() => []);
  const dir = fileNamingSkillDir(env);
  const parsed = runPythonDriver({
    label: "file-naming name gate",
    driver: pythonDriverFile("housekeeping-name-gate", DRIVER),
    payload: JSON.stringify({ registry: pathWin32.join(dir, "references", "code-registry.md"), groups: live }),
    env,
    timeoutMs: READ_TIMEOUT_MS,
    extraEnv: { PYTHONPATH: pathWin32.join(dir, "scripts") },
  }) as { groups: GateResult[][] };
  let next = 0;
  return groups.map((g) => (g.names.length > 0 ? parsed.groups[next++] : []));
}
