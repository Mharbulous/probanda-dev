// PreToolUse hook for Bash, PowerShell and the file-writing tools. Publication cannot be
// reliably undone, so a person confirms each approval and each publication. The hook does
// not refuse: it makes the app ask the person to approve the one tool call. It asks for:
//   - a write to the public repository: a push or remote change that names it, a gh command
//     that changes it, or a git push from a checkout whose remote is it;
//   - starting the publish-public workflow;
//   - a write to public-approved.json, or running approve_public.py. A shell command that
//     names either passes without asking only if it reads it or runs a single plain git add,
//     commit, push, pull, fetch, status, diff, log or show.
// Reading the public repository (gh repo view, git ls-remote, git clone) passes without asking.
const fs = require("fs");
const { spawnSync } = require("child_process");
let data = {};
try { data = JSON.parse(fs.readFileSync(0, "utf8")); } catch (e) { /* leave empty */ }
const input = data.tool_input || {};

function ask(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: reason }
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
    ask("This command changes the public repository Probanda-app/litigation. Approve it only if you want this change made.");
  }
  if (/\bgh\b/.test(command) && /publish-public/i.test(command) && /workflow\s+run|dispatches/i.test(command)) {
    ask("This command starts the publish-public workflow, which publishes public/ to the public repository. Publication cannot be reliably undone.");
  }
  if (/\bgit\b/.test(command) && /\bpush\b/.test(command)) {
    const at = command.match(/ -C (?:"([^"\n]*)"|'([^'\n]*)'|(\S+))/);
    const dir = (at && (at[1] || at[2] || at[3])) || data.cwd || ".";
    const remotes = spawnSync("git", ["-C", dir, "remote", "-v"], { encoding: "utf8" });
    if (PUBLIC_REPO.test(String(remotes.stdout || ""))) {
      ask("This checkout's remote is Probanda-app/litigation, so this push publishes to the public repository.");
    }
  }
  if (APPROVAL.test(command) && !(ALLOWED.test(command) && !CHAINING.test(command) && !/--output/.test(command))) {
    ask("This command names public-approved.json or approve_public.py and may approve files for publication.");
  }
} else {
  const target = String(input.file_path || input.notebook_path || "").replace(/\\/g, "/");
  if (/(?:^|\/)public-approved\.json$/i.test(target)) {
    ask("This write changes public-approved.json, the list of files approved for publication.");
  }
}
