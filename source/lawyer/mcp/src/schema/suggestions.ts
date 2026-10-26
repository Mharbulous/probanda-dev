import type { ToolDefinition } from "./shared.js";

// The Suggestion Box and this computer's suggestion store (src/suggestions/). Hand-written. Routed in
// dispatch.ts. suggestion_box__status moved here from the researcher plugin's commons server
// (docs/Plans/2026-10-25_suggestion-implementation-lifecycle.md, open decision 5 (a)). No tool sends a
// suggestion: the card's Submit Suggestion does (decision 10), so suggestion_box__submit is gone.
export function suggestionToolDefinitions(): ToolDefinition[] {
  return [
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
      name: "suggestion_card__build",
      description:
        "Build a suggestion card, Suggestion-<id>.html, from a scrubbed draft, and return {built: true, card_id, card_path, check_complete}. " +
        "Nothing is sent: the practitioner's Submit Suggestion on the card sends it, and Dismiss sends nothing. Present card_path as a file card with no chat text at all, then call suggestion_card__wait. " +
        "The card shows, in its own fixed order and words, the origin cue (origin practitioner: \"You suggested:\"; probanda: \"Probanda noticed:\"), the pain_point, the items, a mockup link when any item is visual, " +
        "the context_lines (constraint and evidence lines) and the raw_observation lines, a comment box, and Submit Suggestion and Dismiss. " +
        "Each block's text is the practitioner's own phrases reshaped, with every name and indirect identifier replaced by one of the brackets [client], [matter], [person], [document], [file], [date], [amount]; any other bracketed word is refused. " +
        "guess: true marks a block that holds words the practitioner did not use; the card labels it for them to edit. visual: true marks an item that changes how something looks (layout, colour, typography or page structure). " +
        "source is user for the practitioner's own suggestion, assisted for one Probanda offered and they accepted, llm for a loose thread. skill, optional, names the one skill it is about. " +
        "tool_names: every tool name this session sees, exactly as written, for the card's technical details. held_id, optional: a held draft from suggestion_log__read that this card offers, which then leaves the store. " +
        "The full check runs first, over everything the card would send, against this computer's client, matter, contact, folder, document and file records and for emails, paths, dates and amounts. " +
        "While it finds a match in the pain point, an item or a context line, no card is built: it returns {built: false, hits: [{part, id, index, start, end, kind, offer}]}, each where a match lies in that block's text (end exclusive), never the text; " +
        "replace each with its bracket, or reword, and call again. A match in the technical details or the raw observation is removed without asking. check_complete is false when some records could not be read.",
      inputSchema: {
        type: "object",
        properties: {
          origin: { type: "string", enum: ["practitioner", "probanda"] },
          source: { type: "string", enum: ["user", "assisted", "llm"] },
          skill: { type: "string" },
          pain_point: {
            type: "object",
            properties: { text: { type: "string" }, guess: { type: "boolean" } },
            required: ["text"],
            additionalProperties: false,
          },
          items: {
            type: "array",
            minItems: 1,
            maxItems: 10,
            items: {
              type: "object",
              properties: { text: { type: "string" }, guess: { type: "boolean" }, visual: { type: "boolean" } },
              required: ["text"],
              additionalProperties: false,
            },
          },
          context_lines: {
            type: "array",
            maxItems: 20,
            items: {
              type: "object",
              properties: { kind: { type: "string", enum: ["constraint", "evidence"] }, text: { type: "string" }, guess: { type: "boolean" } },
              required: ["kind", "text"],
              additionalProperties: false,
            },
          },
          raw_observation: { type: "array", maxItems: 50, items: { type: "string" } },
          tool_names: { type: "array", maxItems: 5000, items: { type: "string", maxLength: 300 } },
          held_id: { type: "string" },
        },
        required: ["origin", "source", "pain_point", "items"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    {
      name: "suggestion_card__wait",
      description:
        "Wait on a shown suggestion card for the practitioner's click. While this waits, the card's mockup link works. Returns as soon as one happens: " +
        "{event: \"submitted\"} (the card sent it and shows its status) or {event: \"dismissed\"} (nothing was sent): say nothing about it in chat and carry on with the work. " +
        "{event: \"mockup\", items, constraints, placeholders}: the practitioner asked for a mockup of the visual items; write one self-contained HTML page that shows all of them together, " +
        "honouring every constraint, whose visible text is only lines from placeholders, each used whole, with inline styles and nothing that loads or runs (no script, link, image, address or url()), " +
        "then call suggestion_card__attach_mockup and wait again. After about 45 s it returns {event: \"pending\"}, not an error: call again. " +
        "Submit and Dismiss work without anyone waiting, so a practitioner who speaks in chat is answered and the card keeps working.",
      inputSchema: {
        type: "object",
        properties: { card_id: { type: "string" } },
        required: ["card_id"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    {
      name: "suggestion_card__attach_mockup",
      description:
        "Put a mockup on a card after suggestion_card__wait returned event mockup, and return {card_id, mockup_path}. Present mockup_path as a second file card, with no chat text, then call suggestion_card__wait again. " +
        "html is one self-contained page under 1 MB: elements for text and layout only (no script, link, a href, img, iframe, form or svg), only style, class, colspan and rowspan attributes, no url() or address, no style that adds text, " +
        "and visible text only from the placeholders the wait returned, each used whole, with nothing that reads as a date, amount, email or path. " +
        "A mockup that breaks a rule, or holds a word found in this computer's records, is refused with the rule broken; build it again.",
      inputSchema: {
        type: "object",
        properties: { card_id: { type: "string" }, html: { type: "string" } },
        required: ["card_id", "html"],
        additionalProperties: false,
      },
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
        "Read this computer's suggestion store: the suggestions it sent or is sending to the Probanda team, the held drafts an earlier version kept unposted, and the cards still open. " +
        "Returns {suggestions: [{record_id, suggestion_id, title, sent_on, status, badge, shown_badge, withdrawn}], held: [{held_id, held_on, draft}], open_cards: [{card_id, created_at, card_path}]}; each list is empty when there is nothing in it. " +
        "status is \"Sending...\", \"Submitted ✓\", \"Not sent, will retry\", \"Not sent; Probanda could not be reached\" or \"Withdrawn\"; suggestion_id is null until Probanda's Cloud confirmed it. " +
        "A held `draft` is a suggestion drafted, before suggestions were shown as cards, while this computer had no Probanda key: offer each once, as a card built with its held_id. " +
        "An open card is one neither submitted nor dismissed: to show it again, present its card_path and call suggestion_card__wait.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: "suggestion_log__write",
      description:
        "Update this computer's suggestion store. `op: \"seen\"` takes `suggestion_ids`, after the Past suggestions page showing their new badges was presented, and records each badge as shown. " +
        "`op: \"release\"` takes `held_id` and removes that held draft without offering it. An id not in the store is `not_found`.",
      inputSchema: {
        type: "object",
        properties: {
          op: { type: "string", enum: ["seen", "release"] },
          suggestion_ids: { type: "array", items: { type: "string" } },
          held_id: { type: "string" },
        },
        required: ["op"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
  ];
}
