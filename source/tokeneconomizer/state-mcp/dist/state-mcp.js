// Temporary server for Cowork spike test B6, removed after the run. Hand-written, with no
// build step and no dependencies: newline-delimited JSON-RPC over stdio. It keeps numbered
// blocks of TokenEconomizer state in one folder on the user's computer, adds new files there,
// and makes no network calls.
"use strict";
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SERVER = "b6-1";
const MAX_N = 10;
const MAX_LINES_CHARS = 4000;
const store = path.join(process.env.LOCALAPPDATA || os.homedir(), "TokenEconomizer", "b6");

const TOOLS = [
  {
    name: "save_state",
    description:
      "Saves one numbered block of TokenEconomizer state to a file on the user's computer so a later Cowork session can restore it. Writes nothing else.",
    inputSchema: {
      type: "object",
      properties: {
        n: { type: "integer", minimum: 1, maximum: MAX_N },
        lines: { type: "string", maxLength: MAX_LINES_CHARS },
      },
      required: ["n", "lines"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "restore_state",
    description:
      "Returns every block of TokenEconomizer state saved by save_state. Changes nothing except its own read log.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: false },
  },
];

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

function appendLog(name, entry) {
  fs.appendFileSync(path.join(store, name), JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
}

function saveState({ n, lines }) {
  if (!Number.isInteger(n) || n < 1 || n > MAX_N) throw new Error(`n must be an integer from 1 to ${MAX_N}`);
  if (typeof lines !== "string" || lines.length > MAX_LINES_CHARS) {
    throw new Error(`lines must be a string of at most ${MAX_LINES_CHARS} characters`);
  }
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(path.join(store, `save-${n}.txt`), lines, { flag: "wx" });
  const hash = sha256(lines);
  const bytes = Buffer.byteLength(lines, "utf8");
  appendLog("save-log.jsonl", { n, sha256: hash, bytes });
  return `saved n=${n} sha256=${hash} bytes=${bytes}`;
}

function restoreState() {
  fs.mkdirSync(store, { recursive: true });
  const blocks = [];
  for (let n = 1; n <= MAX_N; n++) {
    const file = path.join(store, `save-${n}.txt`);
    if (fs.existsSync(file)) blocks.push(fs.readFileSync(file, "utf8"));
  }
  const rest = blocks.join("\n");
  const hash = sha256(rest);
  appendLog("restore-log.jsonl", { count: blocks.length, sha256: hash });
  const first = { server: SERVER, platform: process.platform, store, count: blocks.length, sha256: hash };
  return JSON.stringify(first) + "\n" + rest;
}

function callTool({ name, arguments: args }) {
  try {
    if (name === "save_state") return { content: [{ type: "text", text: saveState(args || {}) }] };
    if (name === "restore_state") return { content: [{ type: "text", text: restoreState() }] };
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
