import { type ToolDefinition, objectSchema } from "./shared.js";

// Probanda's Cloud key: the one credential every server reads
// (source/mcp-shared/commons-key.js), and the request a practitioner with none
// sends for one. Hand-written. Routed in dispatch.ts to src/key-request/.
export function cloudKeyToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "cloud_key__configure_credential",
      description:
        "One-time setup: returns a link to a page on this computer where the practitioner pastes the key Probanda gave them. " +
        "The one key serves every access to Probanda's Cloud: practice writes, the Suggestion Box and the legal commons. " +
        "The key is typed on that page, never in chat and never as a tool argument. " +
        "Send the link, and when the practitioner says it is done, call practice_data__config_status, whose cloud_credential then reads present. " +
        "A practitioner who has no key asks Probanda for one with key_request__submit. " +
        "The page checks the key against Probanda's Cloud before saving it in Windows Credential Manager, as the generic credential Probanda/cloud-key: " +
        "the same store inside and outside the Claude app, kept through a reinstall, and never logged or echoed back. " +
        "To forget the key on this computer, the practitioner removes that entry under Control Panel, Credential Manager, Windows Credentials. " +
        "That check confirms only that the key works, not who it was issued to or whether they were verified.",
      inputSchema: objectSchema([], []),
      annotations: { destructiveHint: true },
    },
    {
      name: "key_request__submit",
      description:
        "For a computer with no Probanda key (practice_data__config_status reports cloud_credential: missing): returns a link to a page on this computer where the practitioner " +
        "asks Probanda for a key. They type there what verifying a practising lawyer requires (full name, year of call, an optional call date and firm name, " +
        "for British Columbia) and an email and optional phone for contact. Those details are typed on that page, never in chat and never as a tool argument, and go to Probanda's Cloud and nowhere else. " +
        "Probanda verifies the person and sends the key to the email address their firm's website or the directory lists, never the typed one; they then paste it on cloud_key__configure_credential's page. " +
        "Send the link, and when the practitioner says it is sent, call key_request__status. Refused when this computer already holds a key.",
      inputSchema: objectSchema([], []),
    },
    {
      name: "key_request__status",
      description:
        "Report where this computer's request for Probanda's key stands: {requested, request_id, status, requested_at, decided_at, next}. " +
        "status is pending, issued or declined; requested is false when no request was sent from this computer. next says what to do. Sends no personal detail. " +
        "The only answer to whether Probanda verified the practitioner: issued with decided_at covers the request sent from this computer. " +
        "Probanda's Cloud holds no verification record for a key itself, so a present key is not proof of verification.",
      inputSchema: objectSchema([], []),
      annotations: { readOnlyHint: true },
    },
  ];
}
