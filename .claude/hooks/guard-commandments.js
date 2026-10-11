// PreToolUse hook for Bash and PowerShell. Refuses any shell command whose text names
// COMMANDMENTS.md, because deny rules do not see writes made by scripts, Set-Content,
// Move-Item, cp or mv. Reading the file is done with the Read tool instead.
const fs = require("fs");
let input = "";
try { input = fs.readFileSync(0, "utf8"); } catch (e) { /* no stdin */ }
let command = "";
try { command = String(JSON.parse(input).tool_input.command || ""); } catch (e) { /* leave empty */ }
if (/commandments\.md/i.test(command)) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        "Shell commands that name COMMANDMENTS.md are refused in this repository (commandment 1). Read it with the Read tool; a human makes any change."
    }
  }));
}
