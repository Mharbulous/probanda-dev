// PreToolUse hook for Bash, PowerShell and the file-writing tools. Only a human publishes to
// the public repository and only a human approves a file for publication (COMMANDMENTS.md).
// It refuses, for an LLM:
//   - a write to the public repository: a push or remote change that names it, a gh command
//     that changes it, or a git push from a checkout whose remote is it;
//   - starting the publish-public workflow;
//   - a write to public-approved.json, or running approve_public.py. A shell command that
//     names either may only read it or run a single plain git add, commit, push, pull, fetch,
//     status, diff, log or show.
// Reading the public repository (gh repo view, git ls-remote, git clone) is not refused.
const fs = require("fs");
const { spawnSync } = require("child_process");
let data = {};
try { data = JSON.parse(fs.readFileSync(0, "utf8")); } catch (e) { /* leave empty */ }
const input = data.tool_input || {};

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason }
  }));
  process.exit(0);
}

const PUBLIC_REPO = /probanda-app[\\/]litigation/i;
const APPROVAL = /public-approved\.json|approve_public/i;
const ALLOWED = /^(?:git(?: -C (?:"[^"\n]*"|'[^'\n]*'|\S+))? (?:add|commit|push|pull|fetch|status|diff|log|show)|cat|head|tail|wc|grep)(?: |$)/;
const CHAINING = /[;&|<>`\n\r]|\$\(|\$\{/;
const REPO_WRITE = /\bpush\b|\bremote\s+(?:add|set-url)\b|\bgh\s+(?:repo\s+(?:edit|delete|rename|archive|create|sync)|release|workflow|secret|variable)\b|\bgh\s+api\b.*(?:\s-X|--method|\s-f|\s-F|--field|--input)\b/i;

if (typeof input.command === "string") {
  const command = input.command;
  if (PUBLIC_REPO.test(command) && REPO_WRITE.test(command)) {
    deny("Only a human publishes to Probanda-app/litigation. Publication is the publish-public workflow, started by hand from the Actions tab of the development repository.");
  }
  if (/\bgh\b/.test(command) && /publish-public/i.test(command) && /workflow\s+run|dispatches/i.test(command)) {
    deny("Only a human starts the publish-public workflow.");
  }
  if (/\bgit\b/.test(command) && /\bpush\b/.test(command)) {
    const at = command.match(/ -C (?:"([^"\n]*)"|'([^'\n]*)'|(\S+))/);
    const dir = (at && (at[1] || at[2] || at[3])) || data.cwd || ".";
    const remotes = spawnSync("git", ["-C", dir, "remote", "-v"], { encoding: "utf8" });
    if (PUBLIC_REPO.test(String(remotes.stdout || ""))) {
      deny("This checkout's remote is Probanda-app/litigation. Only a human publishes to it.");
    }
  }
  if (APPROVAL.test(command) && !(ALLOWED.test(command) && !CHAINING.test(command) && !/--output/.test(command))) {
    deny("Only a human approves files for publication. A shell command that names public-approved.json or approve_public.py may only read it or run a single plain git add, commit, push, pull, fetch, status, diff, log or show.");
  }
} else {
  const target = String(input.file_path || input.notebook_path || "").replace(/\\/g, "/");
  if (/(?:^|\/)public-approved\.json$/i.test(target)) {
    deny("Only a human approves files for publication: public-approved.json is written by `python scripts/approve_public.py`, run by a person.");
  }
}
