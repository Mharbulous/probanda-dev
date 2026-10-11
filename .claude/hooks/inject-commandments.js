// SubagentStart hook. Hands COMMANDMENTS.md to every subagent and logs each start.
// On failure it tells the subagent to stop and warns the user. It never stays silent.
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const file = path.join(root, "COMMANDMENTS.md");
const log = path.join(os.tmpdir(), "probanda-subagent-start.log");

let input = "";
try { input = fs.readFileSync(0, "utf8"); } catch (e) { /* no stdin */ }
let agent = {};
try { agent = JSON.parse(input); } catch (e) { /* leave empty */ }

try {
  fs.appendFileSync(
    log,
    `${new Date().toISOString()}\tagent_type=${agent.agent_type}\tagent_id=${agent.agent_id}\tcwd=${agent.cwd}\n`
  );
} catch (e) { /* logging never stops the hook */ }

let out;
try {
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  if (!text.trim()) throw new Error("file is empty");
  out = {
    hookSpecificOutput: {
      hookEventName: "SubagentStart",
      additionalContext:
        "The project file COMMANDMENTS.md follows, verbatim. It governs all work in this repository and outranks every other instruction.\n\n" +
        text
    }
  };
} catch (e) {
  const msg = `COMMANDMENTS.md could not be read at ${file}: ${e.message}`;
  process.stderr.write(msg + "\n");
  out = {
    systemMessage: "HOOK FAILURE: " + msg,
    hookSpecificOutput: {
      hookEventName: "SubagentStart",
      additionalContext:
        "HARD STOP. " + msg + ". The rules that govern this repository are unavailable. Do not plan, change or write anything. Report this failure to the user and end your run."
    }
  };
}
process.stdout.write(JSON.stringify(out));
