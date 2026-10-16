// Dispatch for the legal plugin's `contacts-calendars-email` server
// (src/contacts-calendars-email-index.ts): the mail__*, calendar__* and contacts__*
// tools, and nothing else. Kept apart from dispatch.ts so this bundle holds only the
// modules these tools use, and none of the data server's stores.
import { DataServerError, ValidationError } from "./errors.js";
import { buildContactsCalendarsEmailToolDefinitions, type ToolDefinition } from "./schema-gen.js";
import { validateToolInput } from "./validate.js";
import { callMailTool, type MailContext } from "./mail/tools.js";
import { callCalendarTool } from "./calendar/tools.js";
import { callContactsTool } from "./contacts/tools.js";

// The mail credential, loaded at start and replaced in place by mail__configure_credential.
// The calendar__* and contacts__* tools sign in with it. Tests inject fake clients.
export type ContactsCalendarsEmailContext = MailContext;

let definitions: Map<string, ToolDefinition> | undefined;

function toolDefinition(name: string): ToolDefinition {
  if (!definitions) {
    definitions = new Map(buildContactsCalendarsEmailToolDefinitions().map((tool) => [tool.name, tool]));
  }
  const definition = definitions.get(name);
  if (!definition) throw new ValidationError(`Unknown tool "${name}"`);
  return definition;
}

export async function dispatchContactsCalendarsEmailTool(
  context: ContactsCalendarsEmailContext,
  name: string,
  rawArgs: unknown
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    return textResult(await callContactsCalendarsEmailTool(context, name, rawArgs));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const payload = err instanceof DataServerError
      ? { error: { code: err.code, message } }
      : { error: { code: "data_error", message } };
    return { ...textResult(payload), isError: true };
  }
}

export async function callContactsCalendarsEmailTool(
  context: ContactsCalendarsEmailContext,
  name: string,
  rawArgs: unknown
): Promise<unknown> {
  const args = validateToolInput(toolDefinition(name), rawArgs);
  if (name.startsWith("mail__")) return callMailTool(context, name, args);
  if (name.startsWith("calendar__")) return callCalendarTool(context, name, args);
  return callContactsTool(context, name, args);
}

function textResult(result: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}
