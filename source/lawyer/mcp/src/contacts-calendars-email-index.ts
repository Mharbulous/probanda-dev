// The lawyer plugin's `contacts-calendars-email` server: the mail, calendar and contacts
// tools, under the name "Contacts, Calendars & Email". A fourth entry point in this
// package, bundled by scripts/bundle.mjs to
// source/lawyer/contacts-calendars-email-mcp/dist/contacts-calendars-email-mcp.js.
// It imports nothing from the data server's stores, so the bundle holds none of their schema text.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { pathToFileURL } from "node:url";

import { dispatchContactsCalendarsEmailTool } from "./contacts-calendars-email-dispatch.js";
import { loadMailConfig } from "./mail/config.js";
import { buildContactsCalendarsEmailToolDefinitions } from "./schema-gen.js";

export async function start(): Promise<void> {
  // The loader never throws, so mail__configure_credential is always served.
  const context = { mail: await loadMailConfig() };
  const server = new Server(
    { name: "Contacts, Calendars & Email", title: "Contacts, Calendars & Email", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: buildContactsCalendarsEmailToolDefinitions(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    dispatchContactsCalendarsEmailTool(context, request.params.name, request.params.arguments ?? {})
  );

  await server.connect(new StdioServerTransport());
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  start().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    process.exit(1);
  });
}
