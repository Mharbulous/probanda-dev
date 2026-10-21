// The data server, started alone with no key stored, lists the key tools
// (docs/Specs/2026-10-20_move-key-request-tools-to-lawyer-plugin-spec.md, criterion 1, and
// docs/Specs/2026-10-20_key-request-tool-missing-in-session-spec.md, criterion 1).
// Their behaviour is key-request.unit.test.mjs.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const MCP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const STATE = await mkdtemp(join(tmpdir(), "probanda-key-request-server-"));
after(() => rm(STATE, { recursive: true, force: true }));

test("the data server started alone lists the key tools with no key stored", async () => {
  const env = { ...process.env, LOCALAPPDATA: STATE };
  delete env.LEGAL_COMMONS_SUPABASE_KEY;
  delete env.SUPABASE_SERVICE_ROLE_KEY;
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(MCP_ROOT, "build", "index.js")],
    cwd: MCP_ROOT,
    env,
    stderr: "ignore",
  });
  const client = new Client({ name: "key-request-server-test", version: "0.0.0" });
  await client.connect(transport);
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const name of ["cloud_key__configure_credential", "key_request__status", "key_request__submit"]) {
      assert.ok(names.includes(name), `${name} is listed`);
    }
  } finally {
    await client.close();
  }
});
