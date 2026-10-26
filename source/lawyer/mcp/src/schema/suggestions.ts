import type { ToolDefinition } from "./shared.js";

// The Suggestion Box and this computer's suggestion store (src/suggestions/). Hand-written. Routed in
// dispatch.ts. suggestion_box__submit and suggestion_box__status moved here from the researcher
// plugin's commons server (docs/Plans/2026-10-25_suggestion-implementation-lifecycle.md, open decision 5 (a)).
export function suggestionToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "suggestion_box__submit",
      description:
        "Send one suggestion about the plugin, which the practitioner has expressly said to submit, to Probanda's Cloud, using the key cloud_key__configure_credential stores. " +
        "The exact text is first saved on this computer, then sent; when it cannot be sent now it is sent again each time Probanda starts, until it arrives (after seven starts that cannot reach Probanda, it stops). " +
        "title and body are a complete summary of the post, even when items are sent: they must name no person, entity, matter, document or path. " +
        "source is user for the practitioner's own words (through /lawyer:suggestion), assisted for a suggestion Probanda drafted and the person confirmed, " +
        "or llm for a vetted loose thread (through /draft's Suggestion Box). " +
        "skill, optional, is the name of the one skill the suggestion is about; omit it when the suggestion is about no single skill. " +
        "items, optional, at most 10: one per pain, each with where it arises, its done_test, its constraints and its changes, each change decidable on its own and marked " +
        "origin probanda (Probanda's idea) or lawyer (the person's idea). " +
        "previews, optional, at most 4, for UI Previews only: each a label, whether it is the chosen one, an optional reason, and exactly one of its html built from placeholder data, never from the matter, " +
        "or the path of a fixture preview that a board preview tool returned, whose text the server reads and sends as its html; a path outside the fixture preview folder, or to a file that does not end with the fixture marker line, such as a real-data preview, is refused. " +
        "The server adds the lawyer plugin's name and version itself. " +
        "Every string, including every one nested in items and previews, is screened before anything is saved or sent: refused when it holds a personal email address, a user-profile path naming a real user, " +
        "or a matter folder name; when a string other than a Preview's html is over 2,000 characters; when the items together are over 50,000 characters; or when a Preview's html is over 200,000 characters. " +
        "The refusal names the kind of hit, never the text, and nothing is saved. " +
        "Returns {record_id, status, suggestion_id, items_saved, previews_saved, mockup_saved, not_sent_because}: status is \"Submitted ✓\" when Probanda's Cloud confirmed it, " +
        "or \"Not sent, will retry\", with not_sent_because no_key (this computer has no Probanda key yet; it is sent once one is set) or not_reached. " +
        "items_saved and previews_saved are true only when Probanda's Cloud confirms it saved them.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          body: { type: "string" },
          source: { type: "string", enum: ["user", "llm", "assisted"] },
          skill: { type: "string" },
          items: {
            type: "array",
            maxItems: 10,
            items: {
              type: "object",
              properties: {
                pain: { type: "string" },
                where: { type: "string" },
                done_test: { type: "string" },
                constraints: { type: "array", items: { type: "string" } },
                changes: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      change: { type: "string" },
                      origin: { type: "string", enum: ["probanda", "lawyer"] },
                    },
                    required: ["change", "origin"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["pain", "where", "done_test", "constraints", "changes"],
              additionalProperties: false,
            },
          },
          previews: {
            type: "array",
            maxItems: 4,
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                chosen: { type: "boolean" },
                reason: { type: "string" },
                html: { type: "string" },
                path: { type: "string" },
              },
              required: ["label", "chosen"],
              additionalProperties: false,
            },
          },
        },
        required: ["title", "body", "source"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: false, openWorldHint: true },
    },
    {
      name: "suggestion_box__status",
      description:
        "Read from Probanda's Cloud the badge of every suggestion this computer sent that is not withdrawn (or of the suggestion_ids given, 1 to 50), and keep it on this computer. " +
        "A withdrawn suggestion is never asked about. Returns {suggestions: [{suggestion_id, title, badge, shown_badge}], changed: [suggestion_id], past_suggestions_path}. " +
        "badge is Submitted, Under Review, Approved, Approved (n of m), Declined, Implemented in <plugin> <version> or Withdrawn; shown_badge is the one last shown to the practitioner. " +
        "When changed is not empty, past_suggestions_path is the Past suggestions page, written from this computer's copy: present it as a file card, say nothing about it in chat, " +
        "then call suggestion_log__write({op: \"seen\", suggestion_ids: changed}). With nothing sent it returns empty lists and calls nothing. Refused when this computer has no key.",
      inputSchema: {
        type: "object",
        properties: {
          suggestion_ids: { type: "array", maxItems: 50, items: { type: "string" } },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    {
      name: "suggestion_box__past_suggestions",
      description:
        "Write the Past suggestions page from this computer's copy of every suggestion it sent, word for word, with each one's status, and a Withdraw button on each, and return {past_suggestions_path}. " +
        "Present it as a file card and never read it. Asks Probanda's Cloud nothing.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    {
      name: "suggestion_card__check",
      description:
        "Check a suggestion card's text, before it is sent, against this computer's own records: the words of three or more letters and the numbers of four or more digits in its client, matter, contact, folder-name, document-title and file-name records " +
        "(less the plugin's lists of generic legal, folder and common English words and the firm's own name), matched whole-word and ignoring case; and for email addresses, paths, dates and amounts. " +
        "Pass every part that would be sent: pain_point, items, context_lines (the constraint and evidence lines), comment, raw_observation (its lines), mockup (its HTML) and environment_facts (as suggestion_card__environment_facts returned them). " +
        "Nothing is sent, stored or logged, and no record's text is returned. " +
        "Returns {passed, hits, records, complete}. Each hit gives part, index (the item or line, from 0) or field (the environment fact), start and end (where the match lies in that text, end exclusive), " +
        "kind (record, email, path, date or amount), sources (for a record token, which records hold it), text (readable on the card, or generated by the tool), " +
        "offer (for readable text: remove_only for a record token, email or path; remove_or_send_anyway for a date or amount; null for generated text), " +
        "action (prompt for readable text; remove_line for a raw-observation line or an environment fact; remove_mockup for the mockup) and defect (true for generated text). " +
        "records gives each record source as read, none, partial or unavailable; complete is false when any is partial or unavailable. Never quote a matched span back in chat.",
      inputSchema: {
        type: "object",
        properties: {
          pain_point: { type: "string" },
          items: { type: "array", maxItems: 50, items: { type: "string" } },
          context_lines: { type: "array", maxItems: 50, items: { type: "string" } },
          comment: { type: "string" },
          raw_observation: { type: "array", maxItems: 50, items: { type: "string" } },
          mockup: { type: "string" },
          environment_facts: { type: "object" },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: "suggestion_card__environment_facts",
      description:
        "The technical details about Probanda on this computer that a suggestion carries: each Probanda plugin (lawyer, researcher, litigator, solicitor, file-manager, timekeeper, developer), installed or not, with its version; " +
        "for each installed one, when tool_names is given, which of its tools this session sees and which expected ones are missing (missing is null for a server whose tools this plugin does not know); " +
        "every other tool as a count only; the host (Cowork or Code, read from how this session's Probanda tool names are written; unknown when none is given); and the operating system. " +
        "Pass tool_names: every tool name this session sees, exactly as written, Probanda's and every other. It holds no user name, host name or path. " +
        "Returns {plugins: [{plugin, installed, version, servers?: [{server, visible, missing}]}], other_tools, host, os: {platform, release, arch}}.",
      inputSchema: {
        type: "object",
        properties: {
          tool_names: { type: "array", maxItems: 5000, items: { type: "string", maxLength: 300 } },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: "suggestion_log__read",
      description:
        "Read this computer's suggestion store: the suggestions it sent or is sending to the Probanda team, and those it holds unposted. " +
        "Returns {suggestions: [{record_id, suggestion_id, title, sent_on, status, badge, shown_badge, withdrawn}], held: [{held_id, held_on, draft}]}; each list is empty when there is nothing in it. " +
        "status is \"Sending...\", \"Submitted ✓\", \"Not sent, will retry\", \"Not sent; Probanda could not be reached\" or \"Withdrawn\"; suggestion_id is null until Probanda's Cloud confirmed it. " +
        "A held `draft` is a suggestion drafted while this computer had no Probanda key, exactly as it was shown to the person.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: "suggestion_log__write",
      description:
        "Update this computer's suggestion store. `op: \"seen\"` takes `suggestion_ids`, after the Past suggestions page showing their new badges was presented, and records each badge as shown. " +
        "`op: \"hold\"` takes `draft`, the suggestion exactly as shown to the person ({title, body, source, items, skill}), when it cannot be posted because this computer has no Probanda key, and returns its `held_id`. " +
        "Nothing held is ever posted unseen: once the key is set, show the held draft again and post only on the person's yes. " +
        "`op: \"release\"` takes `held_id` and removes that held draft, after it is posted or when the person drops it. An id not in the store is `not_found`.",
      inputSchema: {
        type: "object",
        properties: {
          op: { type: "string", enum: ["seen", "hold", "release"] },
          suggestion_ids: { type: "array", items: { type: "string" } },
          draft: { type: "object" },
          held_id: { type: "string" },
        },
        required: ["op"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
  ];
}
