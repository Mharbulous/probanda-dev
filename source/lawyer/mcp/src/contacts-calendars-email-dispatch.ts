// Dispatch for the lawyer plugin's `contacts-calendars-email` server
// (src/contacts-calendars-email-index.ts): the mail__*, calendar__* and contacts__*
// tools, and nothing else. Kept apart from dispatch.ts so this bundle holds only the
// modules these tools use, and none of the data server's stores.
import { buildContactsCalendarsEmailToolDefinitions } from "./schema-gen.js";
import { dispatchFrom, type Tool, type ToolReply } from "./tool-list.js";
import { mailTools, type MailContext } from "./mail/tools.js";
import { calendarTools } from "./calendar/tools.js";
import { contactsTools } from "./contacts/tools.js";

// The mail credential, loaded at start and replaced in place by mail__configure_credential.
// The calendar__* and contacts__* tools sign in with it. Tests inject fake clients.
export type ContactsCalendarsEmailContext = MailContext;

const tools: Tool<ContactsCalendarsEmailContext>[] = [...mailTools, ...calendarTools, ...contactsTools];

const server = dispatchFrom(buildContactsCalendarsEmailToolDefinitions, tools);

export function dispatchContactsCalendarsEmailTool(
  context: ContactsCalendarsEmailContext,
  name: string,
  rawArgs: unknown
): Promise<ToolReply> {
  return server.dispatch(context, name, rawArgs);
}

export function callContactsCalendarsEmailTool(
  context: ContactsCalendarsEmailContext,
  name: string,
  rawArgs: unknown
): Promise<unknown> {
  return server.call(context, name, rawArgs);
}
