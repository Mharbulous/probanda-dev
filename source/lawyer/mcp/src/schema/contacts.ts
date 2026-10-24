import type { ToolDefinition } from "./shared.js";

// The contacts__* tools: the practitioner's address book over CardDAV, signed in
// with the Probanda mail connector's credential. Read-only; no tool writes a
// contact. Served by the `data` server only.
export function contactsToolDefinitions(): ToolDefinition[] {
  const errors =
    " Errors: `dav_not_configured` (run mail__configure_credential with the contacts fields), `dav_auth` (the " +
    "server refused the sign-in), `dav_timeout` (no answer within 30 s; retry once), `dav_error`.";
  return [
    {
      name: "contacts__search",
      description:
        "Search the Probanda mail connector's contacts by name, organization, email or phone number (case-insensitive, " +
        "partial match; phone digits are compared ignoring spaces and punctuation, from 3 digits). With no query, " +
        "lists contacts alphabetically. Returns {total, returned, contacts: [{url, name, organization?, emails, " +
        "phones}]}. Read-only." +
        errors,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Text to look for. Omit to list all." },
          limit: { type: "integer", minimum: 1, description: "Default 50." },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: "contacts__get",
      description:
        "Get full details of one contact by the url from contacts__search: {url, etag, uid, name, prefix?, firstName?, " +
        "middleName?, lastName?, suffix?, organization?, department?, jobTitle?, emails: [{label?, value, " +
        "preferred?}], phones: [same], addresses: [{label?, preferred?, poBox?, extended?, street, city, region, " +
        "postalCode, country}], birthday?, notes?}. Only an https url on the configured contacts server, or on a " +
        "server it moved the account to during this session's sign-in, is accepted; any other url is refused, so the " +
        "password is never sent elsewhere. Read-only." +
        errors,
      inputSchema: {
        type: "object",
        properties: { url: { type: "string", description: "Contact url from contacts__search" } },
        required: ["url"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
  ];
}
