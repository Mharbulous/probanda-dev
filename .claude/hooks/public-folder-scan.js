// PreToolUse hook for the file-writing tools. public/ is the only source of the public
// repository, so it never holds a Trade Secret or Client Information (COMMANDMENTS.md). Before a file
// under public/ is written, this hook has scripts/check_public_tree.py check the content the
// write would leave, and refuses the write if it finds a problem or cannot be run.
// Do not restrict: SQL built-ins, column names any schema uses and legal terms of art
// (created_at, group_concat, style_of_cause), standard licence text, CRLF endings, a file
// type off the allowlist, or an unfinished CHANGELOG.md entry. None is a Trade Secret or
// Client Information. The format checks belong to the full-tree check run by approve_public and CI.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
let raw = "";
try { raw = fs.readFileSync(0, "utf8"); } catch (e) { /* no stdin */ }
let data = {};
try { data = JSON.parse(raw); } catch (e) { /* leave empty */ }
const input = data.tool_input || {};
const named = String(input.file_path || input.notebook_path || "");
const repo = process.env.CLAUDE_PROJECT_DIR || data.cwd || ".";
const folder = path.resolve(repo, "public") + path.sep;

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason }
  }));
  process.exit(0);
}

if (named && path.resolve(data.cwd || repo, named).toLowerCase().startsWith(folder.toLowerCase())) {
  const script = path.join(repo, "scripts", "check_public_tree.py");
  let ran = false;
  for (const python of ["python", "python3"]) {
    const result = spawnSync(python, [script, "--hook", "--repo", repo], { input: raw, encoding: "utf8" });
    if (result.error) continue;
    ran = true;
    if (result.status !== 0) {
      deny("This write would put content in public/ that may not be published:\n"
        + String(result.stdout || result.stderr || "").trim());
    }
    break;
  }
  if (!ran) deny("Could not run scripts/check_public_tree.py, so a write to public/ cannot be checked.");
}
