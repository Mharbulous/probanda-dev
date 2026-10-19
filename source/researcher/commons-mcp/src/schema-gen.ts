import { type FieldDefinition } from "./registry.js";
import { EDGE_TREATMENT_VALUES, RELATIONSHIP_VALUES, TREATMENT_VALUES } from "./legal-commons/tools.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, Record<string, unknown>>;
    required?: string[];
    additionalProperties: false;
  };
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
  };
}

function schemaFor(field: FieldDefinition): Record<string, unknown> {
  const type =
    field.type === "num" ? "number" :
    field.type === "bool" ? "boolean" :
    field.type === "obj" ? "object" :
    "string";
  const schema: Record<string, unknown> = { type };
  if (field.enum) {
    schema.enum = field.type === "num" ? field.enum.map(Number) : field.enum;
  }
  if (field.encrypted) schema["x-encrypted"] = true;
  if (field.blindIndex) schema["x-blindIndex"] = true;
  return schema;
}

function objectSchema(
  fields: FieldDefinition[],
  required: string[] = []
): ToolDefinition["inputSchema"] {
  return {
    type: "object",
    properties: Object.fromEntries(fields.map((field) => [field.name, schemaFor(field)])),
    required: required.length > 0 ? required : undefined,
    additionalProperties: false,
  };
}

function legalCommonsPrefixed(name: string): string {
  return `legal_commons__${name}`;
}

// Layer-3 gatekeeper namespace (spec §6/§7). Five reads + one write, all
// matter-free — there is deliberately no matter_id on any of them. Not
// registry-generated (the pool has its own schema/client); hand-written like the
// practice namespace. Routed in dispatch.ts.
export function legalCommonsToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: legalCommonsPrefixed("resolve_by_id"),
      description:
        "Resolve a pooled principle by id, following the one redirect hop internally. Returns the principle plus its full variant cluster, criteria, and authorities.",
      inputSchema: objectSchema([{ name: "id", type: "str" }], ["id"]),
    },
    {
      name: legalCommonsPrefixed("find_candidates"),
      description:
        "Shortlist pooled principles for push-time dedup adjudication, using a retrieval packet: full-text + trigram over the rephrasings, a citation join, and a doctrine-tag bucket (no embedding). Pass several rephrasings of the principle so paraphrases are caught. Returns candidates with which filter matched and a score. Defaults to k=20.",
      inputSchema: {
        type: "object",
        properties: {
          rephrasings: { type: "array", items: { type: "string" } },
          doctrine_tag: { type: "string" },
          citations: { type: "array", items: { type: "string" } },
          k: { type: "number" },
        },
        additionalProperties: false,
      },
    },
    {
      name: legalCommonsPrefixed("lookup_by_citation"),
      description: "Find pooled authorities by exact public citation, with the principles they stand for.",
      inputSchema: objectSchema([{ name: "citation", type: "str" }], ["citation"]),
    },
    {
      name: legalCommonsPrefixed("browse"),
      description: "Keyword-browse pooled principles by case-insensitive substring match on their text. Defaults to limit 50.",
      inputSchema: objectSchema([
        { name: "keyword", type: "str" },
        { name: "limit", type: "num" },
      ], ["keyword"]),
    },
    {
      name: legalCommonsPrefixed("search"),
      description:
        "Search pooled principles by meaning, so a question worded differently from the pooled prose still finds it. Returns, best match first, each matching principle's id and prose with its authorities' citations and pinpoints. Defaults to limit 5, at most 10.",
      inputSchema: objectSchema([
        { name: "text", type: "str" },
        { name: "limit", type: "num" },
      ], ["text"]),
    },
    {
      name: legalCommonsPrefixed("treatment_chain"),
      description: "Return the directed authority-treats-authority chain leading to the given pooled authority.",
      inputSchema: objectSchema([{ name: "authority_id", type: "str" }], ["authority_id"]),
    },
    {
      name: legalCommonsPrefixed("push"),
      description:
        "Publish one generalized, matter-free principle to the shared pool in a single transaction: mint the principle, attach authorities (upsert by citation), replace criteria by order, and optionally link it as a variant. Returns the minted cloud principle id. Matter-free by signature — there is no matter_id. " +
        `Each authority's \`relationship\` is one of: ${RELATIONSHIP_VALUES.join(", ")}; its \`treatment\` stamp is one of: ${EDGE_TREATMENT_VALUES.join(", ")}.`,
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
          jurisdiction: { type: "string" },
          doctrine_tag: { type: "string" },
          variant_of: { type: "string" },
          variant_note: { type: "string" },
          authorities: {
            type: "array",
            items: {
              type: "object",
              properties: {
                citation: { type: "string" },
                url: { type: "string" },
                title: { type: "string" },
                authority_type: { type: "string" },
                jurisdiction: { type: "string" },
                disposition: { type: "string" },
                proposition: { type: "string" },
                finding: { type: "string" },
                relationship: { type: "string" },
                obiter: { type: "boolean" },
                treatment: { type: "string" },
                last_verified_at: { type: "string" },
              },
              required: ["citation"],
              additionalProperties: false,
            },
          },
          criteria: {
            type: "array",
            items: {
              type: "object",
              properties: {
                description: { type: "string" },
                criterion_order: { type: "number" },
                requirement_type: { type: "string" },
                burden_of_proof: { type: "string" },
                in_force_date: { type: "string" },
                repeal_date: { type: "string" },
              },
              required: ["description", "criterion_order"],
              additionalProperties: false,
            },
          },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
    {
      name: legalCommonsPrefixed("amend_principle_text"),
      description:
        "Correct the canonical text of an already-pooled principle. Use only to fix a defect in the statement itself — a principle that says something materially different belongs in a new push, not an amendment.",
      inputSchema: objectSchema([
        { name: "principle_id", type: "str" },
        { name: "text", type: "str" },
      ], ["principle_id", "text"]),
    },
    {
      name: legalCommonsPrefixed("amend_criterion_text"),
      description:
        "Correct the description of one criterion belonging to an already-pooled principle. Same rule as amending principle text — fix a defect in the statement, do not restate it as different law.",
      inputSchema: objectSchema([
        { name: "criterion_id", type: "str" },
        { name: "description", type: "str" },
      ], ["criterion_id", "description"]),
    },
    {
      name: legalCommonsPrefixed("amend_authority_edge"),
      description:
        "Correct what an existing principle-authority edge asserts about its authority — the proposition it is cited for, the finding, the relationship, or whether it is obiter. Pass only the fields to change. Use when an edge misstates what the case actually held. " +
        `\`relationship\` is one of: ${RELATIONSHIP_VALUES.join(", ")}.`,
      inputSchema: objectSchema([
        { name: "principle_id", type: "str" },
        { name: "authority_id", type: "str" },
        { name: "proposition", type: "str" },
        { name: "finding", type: "str" },
        { name: "relationship", type: "str" },
        { name: "obiter", type: "bool" },
      ], ["principle_id", "authority_id"]),
    },
    {
      name: legalCommonsPrefixed("link_authority"),
      description:
        "Attach an already-pooled authority to an already-pooled principle. Fails if the edge already exists — amend the existing edge rather than re-linking. " +
        `\`relationship\` is one of: ${RELATIONSHIP_VALUES.join(", ")}.`,
      inputSchema: objectSchema([
        { name: "principle_id", type: "str" },
        { name: "authority_id", type: "str" },
        { name: "proposition", type: "str" },
        { name: "finding", type: "str" },
        { name: "relationship", type: "str" },
        { name: "obiter", type: "bool" },
      ], ["principle_id", "authority_id"]),
    },
    {
      name: legalCommonsPrefixed("unlink_authority"),
      description:
        "Remove one principle-authority edge, e.g. an authority pushed onto a principle it does not stand for. The authority itself stays pooled for other principles.",
      inputSchema: objectSchema([
        { name: "principle_id", type: "str" },
        { name: "authority_id", type: "str" },
      ], ["principle_id", "authority_id"]),
    },
    {
      name: legalCommonsPrefixed("merge_authority"),
      description:
        "Fold a duplicate authority row into its canonical row: repoint every reference to it, then delete the duplicate. Use when the same case was pooled twice under differently-formatted citations. Returns which edges were repointed and which were dropped as already-canonical.",
      inputSchema: objectSchema([
        { name: "duplicate_authority_id", type: "str" },
        { name: "canonical_authority_id", type: "str" },
      ], ["duplicate_authority_id", "canonical_authority_id"]),
    },
    {
      name: legalCommonsPrefixed("record_treatment"),
      description:
        "Record that one authority has treated another: upsert the treating authority by citation (mint it if the pool does not hold it yet), write the directed treatment edge, and optionally stamp the treated authority's principle edges. " +
        `\`treatment\` is present tense — what the treating decision does — one of: ${TREATMENT_VALUES.join(", ")}. ` +
        `\`edge_treatment\` is past tense — what has been done to the treated authority — one of: ${EDGE_TREATMENT_VALUES.join(", ")}; ` +
        "omit it for an oral-decision treatment note, which records the treatment edge only. Optional `scope` narrows a treatment to part of the decision.",
      inputSchema: {
        type: "object",
        properties: {
          treating: {
            type: "object",
            properties: {
              citation: { type: "string" },
              title: { type: "string" },
              url: { type: "string" },
              authority_type: { type: "string" },
              jurisdiction: { type: "string" },
              disposition: { type: "string" },
              last_verified_at: { type: "string" },
            },
            required: ["citation"],
            additionalProperties: false,
          },
          treated_authority_id: { type: "string" },
          treatment: { type: "string" },
          scope: { type: "string" },
          edge_treatment: { type: "string" },
        },
        required: ["treating", "treated_authority_id", "treatment"],
        additionalProperties: false,
      },
    },
    {
      name: legalCommonsPrefixed("stamp_verified"),
      description:
        "Record that a pooled authority was noted up and is still good law, stamping its last-verified date. Defaults to now; pass last_verified_at to stamp as at when the check was actually made.",
      inputSchema: objectSchema([
        { name: "authority_id", type: "str" },
        { name: "last_verified_at", type: "str" },
      ], ["authority_id"]),
    },
    {
      name: legalCommonsPrefixed("amend_authority"),
      description:
        "Correct an already-pooled authority's own identity fields — title, url, authority_type. Pass only the fields to change. This is what a later transcript upgrade of an oral decision calls; push never updates an existing authority row.",
      inputSchema: objectSchema([
        { name: "authority_id", type: "str" },
        { name: "title", type: "str" },
        { name: "url", type: "str" },
        { name: "authority_type", type: "str" },
      ], ["authority_id"]),
    },
    {
      name: legalCommonsPrefixed("rule_period_push"),
      description:
        "Share locally verified court-rule overlay records with the pool, in one transaction. Each record is a deadline-rule row in the rule-overlay shape " +
        "(jurisdiction, enactment, amending_instrument, deadline_type, rule_ref, offset, verbatim, source, effective_from/effective_to, ...) with status \"verified\". " +
        "Refused before any network call when a record has a field outside that shape, lacks a required field, or holds a client matter code. " +
        "A record identical in effect to a live pooled row for the same key is not duplicated. Returns the contributor id and, per record, its pool id and whether it was new.",
      inputSchema: {
        type: "object",
        properties: {
          records: { type: "array", items: { type: "object" } },
        },
        required: ["records"],
        additionalProperties: false,
      },
    },
    {
      name: legalCommonsPrefixed("rule_period_find"),
      description:
        "Find pooled court-rule records for one enactment (by its citation, e.g. \"B.C. Reg. 168/2009\"), optionally narrowed by amending regulation, rule_ref or deadline_type. " +
        "Each row carries its status (proposed, corroborated, disputed or retired), its record, its verifications, and `mine` when this install contributed it. " +
        "Rows from different contributors for one key are all returned; the pool never picks one.",
      inputSchema: objectSchema([
        { name: "jurisdiction", type: "str" },
        { name: "enactment", type: "str" },
        { name: "amending_reg", type: "str" },
        { name: "rule_ref", type: "str" },
        { name: "deadline_type", type: "str" },
      ], ["jurisdiction", "enactment"]),
      annotations: { readOnlyHint: true },
    },
    {
      name: legalCommonsPrefixed("rule_period_record_verification"),
      description:
        "Record this install's live re-check of one pooled court-rule record against its primary source: whether its verbatim quote was found, and when the source was fetched. " +
        "A matched check from an install other than the contributor's makes the row corroborated. A later check by the same install replaces its earlier one.",
      inputSchema: objectSchema([
        { name: "id", type: "str" },
        { name: "quote_matched", type: "bool" },
        { name: "source_fetched_at", type: "str" },
      ], ["id", "quote_matched", "source_fetched_at"]),
    },
    {
      name: legalCommonsPrefixed("rule_period_retire"),
      description:
        "Retire one pooled court-rule record, with a reason. The contributing install may retire its own row. Any install may retire a row by naming, in shipped_version, " +
        "the plugin version that now ships the same rule.",
      inputSchema: objectSchema([
        { name: "id", type: "str" },
        { name: "reason", type: "str" },
        { name: "shipped_version", type: "str" },
      ], ["id", "reason"]),
    },
    {
      name: legalCommonsPrefixed("configure_credential"),
      description:
        "One-time setup: returns a link to a page on this computer where the practitioner pastes the key Probanda gave them " +
        "(the same key serves legal_commons__* and suggestion_box__submit). The key is typed on that page, never in chat and never as a tool argument. " +
        "Send the link, and when the practitioner says it is done, call legal_commons__configure_status. " +
        "The page checks the key against the pool before saving it; it is persisted host-side, encrypted at rest, and never logged or echoed back.",
      inputSchema: objectSchema([], []),
      annotations: { destructiveHint: true },
    },
    {
      name: legalCommonsPrefixed("configure_status"),
      description:
        "Report whether this machine already has a legal-commons pool credential stored, plus a " +
        "redacted hint identifying which key it is. Use before asking the user for a key, so an " +
        "already-configured machine is not prompted again. Never returns the key itself.",
      inputSchema: objectSchema([], []),
      annotations: { readOnlyHint: true },
    },
  ];
}

function troubleshootPrefixed(name: string): string {
  return `troubleshoot__${name}`;
}

const STORE_CONTENT_RULE =
  " The store holds generic tooling knowledge only and must contain no client or matter content.";

// Troubleshooting store namespace: known fixes for tool, connector, plugin and
// MCP failures, in a separate Supabase project from the pool. Hand-written like
// the pool namespace. Routed in dispatch.ts.
export function troubleshootToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: troubleshootPrefixed("search"),
      description:
        "Search the troubleshooting store for known fixes by symptom or error text, ranking entries tagged with any of the named tools higher. " +
        "Returns {entries: [...]} ranked by match and confirmation count; an empty list means the store answered and holds nothing matching. k defaults to 10 and is held to 1-50." +
        STORE_CONTENT_RULE,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          tools: { type: "array", items: { type: "string" } },
          k: { type: "number" },
        },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
    {
      name: troubleshootPrefixed("record"),
      description:
        "Write one fix the practitioner has confirmed worked: a generic symptom, the tools involved, the exact error strings, the cause, the fix, and an optional public source URL. " +
        "Refused before any network call when the text holds a personal email address, a user-profile path naming a real user, a matter folder name, or a string over 2,000 characters; " +
        "the refusal names the kind of hit, never the text. Returns {entry_id, confirmed_count}." +
        STORE_CONTENT_RULE,
      inputSchema: {
        type: "object",
        properties: {
          symptom: { type: "string" },
          tools: { type: "array", items: { type: "string" } },
          error_strings: { type: "array", items: { type: "string" } },
          cause: { type: "string" },
          fix: { type: "string" },
          source_url: { type: "string" },
        },
        required: ["symptom", "cause", "fix"],
        additionalProperties: false,
      },
    },
    {
      name: troubleshootPrefixed("confirm_fix"),
      description:
        "Record that an existing store entry's fix worked again: increments its confirmed_count and stamps when. " +
        "Use instead of record only when search already holds an entry with the same cause and the same fix. Fails when the entry_id is unknown." +
        STORE_CONTENT_RULE,
      inputSchema: objectSchema([{ name: "entry_id", type: "str" }], ["entry_id"]),
    },
    {
      name: troubleshootPrefixed("configure_credential"),
      description:
        "One-time setup: store the troubleshooting store's Supabase project URL and its sb_secret_ key. " +
        "The store is a separate project from the legal-commons pool, so the pool's URL or key is refused. " +
        "The pair is checked against the store before it is saved, persisted host-side encrypted at rest, and never logged or echoed back." +
        STORE_CONTENT_RULE,
      inputSchema: objectSchema([
        { name: "project_url", type: "str" },
        { name: "static_key", type: "str" },
      ], ["project_url", "static_key"]),
      annotations: { destructiveHint: true },
    },
    {
      name: troubleshootPrefixed("configure_status"),
      description:
        "Report whether this machine has a troubleshooting-store credential, the store's project URL, and a redacted hint " +
        "identifying the key. Never returns the key itself." +
        STORE_CONTENT_RULE,
      inputSchema: objectSchema([], []),
      annotations: { readOnlyHint: true },
    },
  ];
}

function suggestionBoxPrefixed(name: string): string {
  return `suggestion_box__${name}`;
}

// Suggestion Box namespace: a suggestion about the plugin that the practitioner
// expressly submits, saved in Probanda's Cloud with the legal-commons key.
// Hand-written like the other namespaces. Routed in dispatch.ts.
export function suggestionBoxToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: suggestionBoxPrefixed("submit"),
      description:
        "Save one suggestion about the plugin, which the practitioner has expressly said to submit, in Probanda's Cloud, using the key legal_commons__configure_credential stores. " +
        "title and body are a complete summary of the post, even when items are sent: they must name no person, entity, matter, document or path. " +
        "source is user for the practitioner's own words (through /lawyer:suggestion), assisted for a suggestion Probanda drafted and the person confirmed, " +
        "or llm for a vetted loose thread (through /draft's Suggestion Box). " +
        "skill, optional, is the name of the one skill the suggestion is about (draft for /draft's Suggestion Box); omit it when the suggestion is about no single skill. " +
        "items, optional, at most 10: one per pain, each with where it arises, its done_test, its constraints and its changes, each change decidable on its own and marked " +
        "origin probanda (Probanda's idea) or lawyer (the person's idea). " +
        "previews, optional, at most 4, for UI Previews only: each a label, whether it is the chosen one, an optional reason, and its html built from placeholder data, never from the matter. " +
        "The server adds the researcher plugin's version itself. " +
        "Every string, including every one nested in items and previews, is screened before any network call: refused when it holds a personal email address, a user-profile path naming a real user, " +
        "or a matter folder name; when a string other than a Preview's html is over 2,000 characters; when the items together are over 50,000 characters; or when a Preview's html is over 200,000 characters. " +
        "The refusal names the kind of hit, never the text. Refused when this computer has no key. " +
        "Returns {suggestion_id, items_saved, previews_saved}; items_saved and previews_saved are true only when Probanda's Cloud confirms it saved them.",
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
              },
              required: ["label", "chosen", "html"],
              additionalProperties: false,
            },
          },
        },
        required: ["title", "body", "source"],
        additionalProperties: false,
      },
    },
    {
      name: suggestionBoxPrefixed("status"),
      description:
        "Read the status of suggestions this device submitted, by the suggestion_id values suggestion_box__submit returned (1 to 50). " +
        "Returns {statuses: [{suggestion_id, status, triaged_at}]} and nothing else of a suggestion; an ID Probanda's Cloud does not hold is omitted. " +
        "status is new, approved, approved in part or rejected; triaged_at is null until triage. Refused when this computer has no key.",
      inputSchema: {
        type: "object",
        properties: {
          suggestion_ids: { type: "array", maxItems: 50, items: { type: "string" } },
        },
        required: ["suggestion_ids"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
  ];
}

// The one tool list every host and every session sees: the layer-3 legal-commons
// pool namespace, the troubleshooting store namespace and the Suggestion Box
// namespace. Local practice and case data live in the Probanda plugin.
export function buildToolDefinitions(): ToolDefinition[] {
  return [
    ...legalCommonsToolDefinitions(),
    ...troubleshootToolDefinitions(),
    ...suggestionBoxToolDefinitions(),
  ];
}
