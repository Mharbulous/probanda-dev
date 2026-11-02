// Temporary server for Cowork spike test P1, removed after the run. Hand-written, with no
// build step and no dependencies: newline-delimited JSON-RPC over stdio. Its one tool adds a
// line to one file on the user's computer, to show whether a hook's call reached it. It makes
// no network calls, and it answers {} so the call adds nothing to the session.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const SERVER = "p1-1";
const store = path.join(process.env.APPDATA || os.homedir(), "Probanda", "te-p1");

const TOOLS = [
  {
    name: "probe_hit",
    description: "TokenEconomizer test tool, called by a plugin hook. Adds one line to its own log file. Not for use in a conversation.",
    inputSchema: {
      type: "object",
      properties: {
        form: { type: "string", maxLength: 40 },
        event: { type: "string", maxLength: 40 },
        session: { type: "string", maxLength: 80 },
        cwd: { type: "string", maxLength: 300 },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
];

function probeHit({ form, event, session, cwd }) {
  fs.mkdirSync(store, { recursive: true });
  const entry = { at: new Date().toISOString(), server: SERVER, form, event, session, cwd };
  fs.appendFileSync(path.join(store, "hits.jsonl"), JSON.stringify(entry) + "\n");
  return "{}";
}

function callTool({ name, arguments: args }) {
  try {
    if (name === "probe_hit") return { content: [{ type: "text", text: probeHit(args || {}) }] };
    throw new Error(`unknown tool ${name}`);
  } catch (err) {
    return { content: [{ type: "text", text: err.message }], isError: true };
  }
}

function send(message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
}

function handle(line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    send({ id: null, error: { code: -32700, message: "parse error" } });
    return;
  }
  const { id, method, params } = request;
  if (id === undefined) return;
  if (method === "initialize") {
    send({
      id,
      result: {
        protocolVersion: (params && params.protocolVersion) || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "state", version: SERVER },
      },
    });
  } else if (method === "ping") {
    send({ id, result: {} });
  } else if (method === "tools/list") {
    send({ id, result: { tools: TOOLS } });
  } else if (method === "tools/call") {
    send({ id, result: callTool(params || {}) });
  } else {
    send({ id, error: { code: -32601, message: `unknown method ${method}` } });
  }
}

let buffered = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffered += chunk;
  let end;
  while ((end = buffered.indexOf("\n")) >= 0) {
    const line = buffered.slice(0, end).trim();
    buffered = buffered.slice(end + 1);
    if (line) handle(line);
  }
});
