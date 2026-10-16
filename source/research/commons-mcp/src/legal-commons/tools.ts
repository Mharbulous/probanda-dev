import { ValidationError } from "../errors.js";
import { serveKeyPage } from "../key-page.js";
import type { LegalCommonsClient } from "./client.js";
import { persistLegalCommonsCredential } from "./config.js";
import { findRulePeriods, pushRulePeriods, recordRulePeriodVerification, retireRulePeriod } from "./rule-periods.js";

// Runtime logic for the layer-3 gatekeeper namespace. Five reads + one write,
// all matter-free (spec §6/§7). Tool definitions live in schema-gen.ts alongside
// the other hand-written namespaces; this file is the dispatch + implementation.
//
// The structural severance backstop is the PUSH SIGNATURE: there is no matter_id
// parameter anywhere below, so a matter reference is unrepresentable in a push.
//
// Candidate retrieval is zero-vendor (spec §9 amendment, 2026-07-13): Claude
// emits a retrieval packet (rephrasings + doctrine_tag + citations) and the
// find_candidates RPC unions FTS + trigram + citation/tag filters in Postgres.
// Claude still makes the duplicate/variant/distinct call — the runtime only
// shortlists.

export function isLegalCommonsToolName(name: string): boolean {
  return name.startsWith("legal_commons__");
}

export function callLegalCommonsTool(
  client: LegalCommonsClient,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "legal_commons__resolve_by_id":
      return resolveById(client, args);
    case "legal_commons__find_candidates":
      return findCandidates(client, args);
    case "legal_commons__lookup_by_citation":
      return lookupByCitation(client, args);
    case "legal_commons__browse":
      return browse(client, args);
    case "legal_commons__search":
      return search(client, args);
    case "legal_commons__treatment_chain":
      return treatmentChain(client, args);
    case "legal_commons__push":
      return push(client, args);
    case "legal_commons__amend_principle_text":
      return amendPrincipleText(client, args);
    case "legal_commons__amend_criterion_text":
      return amendCriterionText(client, args);
    case "legal_commons__amend_authority_edge":
      return amendAuthorityEdge(client, args);
    case "legal_commons__link_authority":
      return linkAuthority(client, args);
    case "legal_commons__unlink_authority":
      return unlinkAuthority(client, args);
    case "legal_commons__merge_authority":
      return mergeAuthority(client, args);
    case "legal_commons__record_treatment":
      return recordTreatment(client, args);
    case "legal_commons__stamp_verified":
      return stampVerified(client, args);
    case "legal_commons__amend_authority":
      return amendAuthority(client, args);
    case "legal_commons__rule_period_push":
      return pushRulePeriods(client, args);
    case "legal_commons__rule_period_find":
      return findRulePeriods(client, args);
    case "legal_commons__rule_period_record_verification":
      return recordRulePeriodVerification(client, args);
    case "legal_commons__rule_period_retire":
      return retireRulePeriod(client, args);
    case "legal_commons__configure_credential":
      return configureCredential(client);
    case "legal_commons__configure_status":
      return configureStatus(client);
    default:
      throw new ValidationError(`Unknown legal-commons tool "${name}"`);
  }
}

// configure_credential — one-time delivery workaround for handover 135 / Check
// 7 (see dpapi-store.ts / config.ts). Cowork never injects a plugin's
// userConfig secret into its spawned MCP server's environment, so the static
// pool credential cannot arrive as an env var in a Cowork session. This tool
// serves a local page (key-page.ts) where the practitioner pastes the key, so
// it never passes through the chat; the page's save persists it to a
// host-backed, DPAPI-encrypted file and updates the live client so the rest of
// this session works immediately without a restart.
// Same PP-1 permission-prompt discipline as every other legal_commons__* call
// — never allowlisted, so a stray/malicious call still surfaces to the user.
async function configureCredential(client: LegalCommonsClient): Promise<unknown> {
  const url = await serveKeyPage((typed) => saveCredential(client, typed));
  return {
    status: "awaiting_key",
    url,
    next:
      "Send the practitioner this link and ask them to paste the key on that page, never in chat. " +
      "When they say it is done, call legal_commons__configure_status. The link works only on this computer, until a new link is made or the server restarts.",
  };
}

async function saveCredential(client: LegalCommonsClient, typed: string): Promise<{ persisted: boolean; warning?: string }> {
  // Trim: a key pasted from a password manager routinely carries a trailing
  // newline, which would otherwise persist and surface later as an opaque 401.
  const staticKey = typed.trim();
  if (!staticKey) throw new ValidationError("paste the key");
  // The publishable/anon key is the other key on the same Supabase project and
  // the easy one to grab by mistake. It has no grants on legal_commons, so it
  // would fail every later call — reject it here with the reason, not there.
  if (staticKey.startsWith("sb_publishable_")) {
    throw new ValidationError(
      "that is the project's publishable key, which cannot reach the legal commons — " +
      "paste the key Probanda gave you for this computer instead"
    );
  }

  // Set live BEFORE persisting, so a disk failure leaves this session working
  // with the key the caller just supplied rather than stranding it.
  const previousKey = client.staticKey();
  client.setStaticKey(staticKey);

  // One cheap authenticated read, so a wrong-but-plausible key fails here with
  // a clear cause instead of on some later push. On failure the previous key is
  // restored — a bad key must not knock out an already-working session.
  try {
    await client.get("principle", { select: "principle_id" }, { limit: 1 });
  } catch (error) {
    client.setStaticKey(previousKey);
    throw new ValidationError(
      `that key did not work against the legal-commons pool: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  // Persist failure is reported, not swallowed: the key works and stays live for
  // this session, but the caller must know it will not survive a restart.
  try {
    await persistLegalCommonsCredential(staticKey);
  } catch (error) {
    return {
      persisted: false,
      warning:
        "the key works and is active for this session, but could not be saved to disk, so it must " +
        `be entered again after a restart: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  return { persisted: true };
}

// configure_status — lets a caller confirm whether this machine already has a
// credential (and which one, by hint) without re-entering the key. The hint is
// truncated on both ends; the raw key is never returned by any tool.
async function configureStatus(client: LegalCommonsClient): Promise<unknown> {
  return { configured: client.hasStaticKey(), key_hint: client.redactedKeyHint() };
}

// resolve_by_id — follows the one redirect hop internally and returns the
// principle + full variant cluster + criteria + authorities in one call. Callers
// never see redirect mechanics; this contract is what layer 2's do-nothing merge
// posture depends on (spec §3 D7).
async function resolveById(client: LegalCommonsClient, args: Record<string, unknown>): Promise<unknown> {
  return client.rpc("resolve_principle", { p_id: String(args.id) });
}

// find_candidates — the push-time dedup retrieval step. Takes Claude's retrieval
// packet and returns the shortlist for Claude to adjudicate. No embedding: the
// RPC unions full-text search + trigram similarity over the rephrasings, a
// citation join, and a doctrine-tag bucket (spec §9).
async function findCandidates(client: LegalCommonsClient, args: Record<string, unknown>): Promise<unknown> {
  return client.rpc("find_candidates", {
    p_rephrasings: Array.isArray(args.rephrasings) ? args.rephrasings : [],
    p_doctrine_tag: args.doctrine_tag ?? null,
    p_citations: Array.isArray(args.citations) ? args.citations : [],
    p_k: typeof args.k === "number" ? args.k : 20,
  });
}

async function lookupByCitation(client: LegalCommonsClient, args: Record<string, unknown>): Promise<unknown> {
  return client.rpc("lookup_by_citation", { p_citation: String(args.citation) });
}

// browse — keyword browse (spec §3 D7). An RPC, not a table GET: Supabase's API
// log keeps every request's address and not its body, so the keyword must
// travel in the body.
async function browse(client: LegalCommonsClient, args: Record<string, unknown>): Promise<unknown> {
  return client.rpc("browse_principles", {
    p_keyword: String(args.keyword),
    p_limit: typeof args.limit === "number" ? args.limit : 50,
  });
}

// search — meaning search. The commons-find Edge Function embeds the text and
// replies with only the matching principles' prose and their authorities'
// citations and pinpoints, best match first: the pool's finer structure stays in
// the cloud (Commandment 4). The text travels in the body, never the address.
async function search(client: LegalCommonsClient, args: Record<string, unknown>): Promise<unknown> {
  return client.callFunction("commons-find", {
    text: String(args.text),
    limit: typeof args.limit === "number" ? args.limit : 5,
  });
}

async function treatmentChain(client: LegalCommonsClient, args: Record<string, unknown>): Promise<unknown> {
  return client.rpc("treatment_chain", { p_authority_id: String(args.authority_id) });
}

// push — the one write. Mints the (already compressed, generalized, severed)
// principle in one Postgres transaction (the push_principle function) together
// with its authorities (upsert-by-citation) and criteria (replace by
// criterion_order), returning the minted cloud principle id. Matter-free by
// signature — no matter_id. The doctrine_tag feeds the retrieval bucket; the
// search vector is a generated column, so nothing to embed.
async function push(client: LegalCommonsClient, args: Record<string, unknown>): Promise<unknown> {
  // The RPC writes each authority's relationship and treatment stamp as given,
  // so they are checked here (vocabulary constants below).
  for (const [i, a] of (Array.isArray(args.authorities) ? args.authorities : []).entries()) {
    const auth = (a ?? {}) as Record<string, unknown>;
    if (auth.relationship !== undefined && auth.relationship !== null) {
      requireOneOf(`push.authorities[${i}].relationship`, auth.relationship, RELATIONSHIP_VALUES);
    }
    if (auth.treatment !== undefined && auth.treatment !== null) {
      requireOneOf(`push.authorities[${i}].treatment`, auth.treatment, EDGE_TREATMENT_VALUES);
    }
  }
  return client.rpc("push_principle", {
    p_text: String(args.text),
    p_jurisdiction: args.jurisdiction ?? null,
    p_variant_of: args.variant_of ?? null,
    p_variant_note: args.variant_note ?? null,
    p_doctrine_tag: args.doctrine_tag ?? null,
    p_authorities: Array.isArray(args.authorities) ? args.authorities : [],
    p_criteria: Array.isArray(args.criteria) ? args.criteria : [],
  });
}

// ---------------------------------------------------------------------------
// Currency ops. The pool's currency tables (`treatment`, plus
// `principle_authority.treatment` / `treated_by_authority_id` and
// `authority.last_verified_at`) had no writer until 2026-09-08, so a pooled
// authority a higher court overruled stayed "good law" forever. These three ops
// are that writer. Currency never rewrites pooled principle text: a superseding
// formulation is pushed as a variant and the old authority gets a treatment
// edge (design decision D6).
// ---------------------------------------------------------------------------

// The three vocabularies, tense-separated on purpose (D7), and the single place
// they are enforced — every one of these pool columns is bare `text`, so nothing
// in Postgres refuses a typo. Each value's definition, and which column takes it,
// is in `.claude/skills/shared/treatment-vocabulary.md` and nowhere else; these
// lists hold only the code values. Design:
// `docs/Specs/2026-10-15_per-principle-treatment-vocabulary-spec.md`.
//
// TREATMENT_VALUES — present tense, what the treating decision DOES to the
// treated one; the `treatment` edge's own vocabulary. `not_considered` is the
// oral-reasons note.
export const TREATMENT_VALUES = [
  "follows",
  "applies",
  "approves",
  "explains",
  "harmonizes",
  "refers_to",
  "distinguishes",
  "limits",
  "declines_to_extend",
  "declines_to_follow",
  "declines_to_apply",
  "questions",
  "disapproves",
  "overrules",
  "departs_from",
  "abrogates",
  "affirms",
  "varies",
  "reverses",
  "superseded_by_statute",
  "not_considered",
] as const;

// RELATIONSHIP_VALUES — present tense, what an authority does for a principle;
// `principle_authority.relationship`. Never appellate history, never `answered`
// (case-data decision 48: it never crosses).
export const RELATIONSHIP_VALUES = [
  "establishes",
  "extends",
  "reformulates",
  "follows",
  "applies",
  "approves",
  "explains",
  "harmonizes",
  "refers_to",
  "considers",
  "distinguishes",
  "limits",
  "declines_to_extend",
  "declines_to_follow",
  "declines_to_apply",
  "questions",
  "disapproves",
  "overrules",
  "departs_from",
  "abrogates",
  "superseded_by_statute",
] as const;

// EDGE_TREATMENT_VALUES — past tense, what has BEEN DONE to the treated
// authority; stamped on `principle_authority.treatment` (and carried by push).
export const EDGE_TREATMENT_VALUES = [
  "affirmed",
  "reversed",
  "varied",
  "distinguished",
  "overruled",
  "superseded_by_statute",
  "abrogated",
] as const;

function requireOneOf(label: string, value: unknown, allowed: readonly string[]): string {
  const text = String(value);
  if (!allowed.includes(text)) {
    throw new ValidationError(`${label} must be one of: ${allowed.join(", ")} (got "${text}")`);
  }
  return text;
}

// record_treatment — the one currency write that spans two tables (the treating
// authority row and the treatment edge, plus the optional edge stamp), so it is
// an RPC rather than a direct PostgREST write. The treating authority is
// upserted by citation, exactly as push does, because an overruling or oral
// decision is usually not pooled yet.
async function recordTreatment(client: LegalCommonsClient, args: Record<string, unknown>): Promise<unknown> {
  const treating = args.treating;
  if (typeof treating !== "object" || treating === null || Array.isArray(treating)) {
    throw new ValidationError("record_treatment requires treating as an object with a citation");
  }
  const citation = String((treating as Record<string, unknown>).citation ?? "").trim();
  if (!citation) throw new ValidationError("record_treatment requires treating.citation");

  const treatment = requireOneOf("record_treatment.treatment", args.treatment, TREATMENT_VALUES);
  // Null/absent is the oral-note case: a note about what a judge said orally
  // does not restate what a principle's authority now is, so no edge is stamped.
  const edgeTreatment =
    args.edge_treatment === undefined || args.edge_treatment === null
      ? null
      : requireOneOf("record_treatment.edge_treatment", args.edge_treatment, EDGE_TREATMENT_VALUES);

  return client.rpc("record_treatment", {
    p_treating: treating,
    p_treated_authority_id: String(args.treated_authority_id),
    p_treatment: treatment,
    p_scope: args.scope ?? null,
    p_edge_treatment: edgeTreatment,
  });
}

// stamp_verified — record that this authority was noted up and is still good
// law as at a date. Defaults to now, which is the ordinary case (a citator sweep
// just ran); an explicit date is for stamping as at when the check was made.
async function stampVerified(client: LegalCommonsClient, args: Record<string, unknown>): Promise<unknown> {
  const authorityId = String(args.authority_id);
  const lastVerifiedAt = typeof args.last_verified_at === "string" ? args.last_verified_at : nowIso();
  const rows = await client.patch(
    "authority",
    { authority_id: `eq.${authorityId}` },
    { last_verified_at: lastVerifiedAt, updated_at: nowIso() }
  );
  if (rows.length === 0) throw new ValidationError(`no pooled authority ${authorityId}`);
  return { stamped: true, authority: rows[0] };
}

// amend_authority — correct an authority row's own identity fields. push_principle
// never updates an existing citation row, so nothing else can: this is what a
// later transcript upgrade of an oral decision calls when the reasons acquire a
// real citation, title and url.
async function amendAuthority(client: LegalCommonsClient, args: Record<string, unknown>): Promise<unknown> {
  const authorityId = String(args.authority_id);

  const body: Record<string, unknown> = {};
  for (const field of ["title", "url", "authority_type"]) {
    if (typeof args[field] === "string") body[field] = args[field];
  }
  if (Object.keys(body).length === 0) {
    throw new ValidationError("amend_authority needs at least one of title, url, authority_type");
  }
  body.updated_at = nowIso();

  const rows = await client.patch("authority", { authority_id: `eq.${authorityId}` }, body);
  if (rows.length === 0) throw new ValidationError(`no pooled authority ${authorityId}`);
  return { amended: true, authority: rows[0] };
}

// ---------------------------------------------------------------------------
// Amend ops. The pool is append-only by construction — push mints and nothing
// else writes — but adjudication is Claude-judged and `authority.citation` has
// no unique constraint, so duplicate authorities, missing or over-pushed edges,
// and text defects are recurring defect classes rather than one-off accidents
// (the A4 pilot produced all four in a single matter). These four ops are the
// correction surface. Each is a single-statement amend, so they write tables
// directly rather than through an RPC; nothing here needs a transaction.
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

// Every other foreign key into authority(). Merging repoints these wholesale —
// only principle_authority has collision semantics (see mergeAuthority).
const AUTHORITY_REFS: ReadonlyArray<readonly [string, string]> = [
  ["criterion", "authority_id"],
  ["criterion", "treated_by_authority_id"],
  ["principle_authority", "treated_by_authority_id"],
  ["treatment", "treating_authority_id"],
  ["treatment", "treated_authority_id"],
];

// amend_principle_text — correct a pooled principle's canonical statement.
// search_vector is a generated column, so retrieval re-indexes itself.
async function amendPrincipleText(client: LegalCommonsClient, args: Record<string, unknown>): Promise<unknown> {
  const principleId = String(args.principle_id);
  const rows = await client.patch(
    "principle",
    { principle_id: `eq.${principleId}` },
    { text: String(args.text), updated_at: nowIso() }
  );
  if (rows.length === 0) throw new ValidationError(`no pooled principle ${principleId}`);
  return { amended: true, principle: rows[0] };
}

// amend_criterion_text — correct one criterion's description. A principle's
// criteria carry the same defect classes as its text (the A4 pilot left a
// mischaracterization in a criterion while the principle text above it was
// already right), so the text op alone cannot reach every wording defect.
async function amendCriterionText(client: LegalCommonsClient, args: Record<string, unknown>): Promise<unknown> {
  const criterionId = String(args.criterion_id);
  const rows = await client.patch(
    "criterion",
    { criterion_id: `eq.${criterionId}` },
    { description: String(args.description), updated_at: nowIso() }
  );
  if (rows.length === 0) throw new ValidationError(`no pooled criterion ${criterionId}`);
  return { amended: true, criterion: rows[0] };
}

// amend_authority_edge — correct what an edge asserts about its authority.
// `proposition` and `finding` are authored at push time, so an unverified or
// wrong claim about a real case is fixed here rather than by unlinking and
// re-linking (which would silently drop the rest of the edge).
async function amendAuthorityEdge(client: LegalCommonsClient, args: Record<string, unknown>): Promise<unknown> {
  const principleId = String(args.principle_id);
  const authorityId = String(args.authority_id);

  const body: Record<string, unknown> = {};
  for (const field of ["proposition", "finding", "relationship"]) {
    if (typeof args[field] === "string") body[field] = args[field];
  }
  if (body.relationship !== undefined) {
    requireOneOf("amend_authority_edge.relationship", body.relationship, RELATIONSHIP_VALUES);
  }
  if (typeof args.obiter === "boolean") body.obiter = args.obiter;
  if (Object.keys(body).length === 0) {
    throw new ValidationError("amend_authority_edge needs at least one of proposition, finding, relationship, obiter");
  }
  body.updated_at = nowIso();

  const rows = await client.patch(
    "principle_authority",
    { principle_id: `eq.${principleId}`, authority_id: `eq.${authorityId}` },
    body
  );
  if (rows.length === 0) throw new ValidationError(`no edge ${principleId} -> ${authorityId}`);
  return { amended: true, edge: rows[0] };
}

// link_authority — attach an already-pooled authority to a principle. The
// composite primary key makes a re-link fail loudly rather than silently
// overwrite the existing edge's proposition.
async function linkAuthority(client: LegalCommonsClient, args: Record<string, unknown>): Promise<unknown> {
  const relationship =
    args.relationship === undefined || args.relationship === null
      ? null
      : requireOneOf("link_authority.relationship", args.relationship, RELATIONSHIP_VALUES);
  const rows = await client.insert("principle_authority", {
    principle_id: String(args.principle_id),
    authority_id: String(args.authority_id),
    proposition: args.proposition ?? null,
    finding: args.finding ?? null,
    relationship,
    obiter: typeof args.obiter === "boolean" ? args.obiter : null,
  });
  return { linked: true, edge: rows[0] ?? null };
}

// unlink_authority — drop one principle-authority edge. The authority row
// itself stays pooled; other principles may stand on it.
async function unlinkAuthority(client: LegalCommonsClient, args: Record<string, unknown>): Promise<unknown> {
  const principleId = String(args.principle_id);
  const authorityId = String(args.authority_id);
  const rows = await client.delete("principle_authority", {
    principle_id: `eq.${principleId}`,
    authority_id: `eq.${authorityId}`,
  });
  if (rows.length === 0) throw new ValidationError(`no edge ${principleId} -> ${authorityId}`);
  return { unlinked: true, edge: rows[0] };
}

// merge_authority — fold a duplicate authority into its canonical row: repoint
// every reference, then delete the duplicate. The final delete is FK-guarded —
// anything still pointing at the duplicate fails loudly and names its table.
// Re-runnable: each step is a no-op once applied.
async function mergeAuthority(client: LegalCommonsClient, args: Record<string, unknown>): Promise<unknown> {
  const duplicateId = String(args.duplicate_authority_id);
  const canonicalId = String(args.canonical_authority_id);
  if (duplicateId === canonicalId) {
    throw new ValidationError("duplicate_authority_id and canonical_authority_id are the same authority");
  }

  const canonical = await client.get("authority", { authority_id: `eq.${canonicalId}`, select: "authority_id" });
  if (canonical.length === 0) throw new ValidationError(`no pooled authority ${canonicalId} to merge into`);

  // principle_authority is keyed (principle_id, authority_id), so a principle
  // already citing the canonical authority cannot also hold a repointed edge —
  // its duplicate edge is redundant and gets dropped instead.
  const dupEdges = await client.get("principle_authority", { authority_id: `eq.${duplicateId}`, select: "principle_id" });
  const canonicalEdges = await client.get("principle_authority", { authority_id: `eq.${canonicalId}`, select: "principle_id" });
  const alreadyCanonical = new Set(canonicalEdges.map((edge) => String(edge.principle_id)));

  const repointed: string[] = [];
  const droppedAsRedundant: string[] = [];
  for (const edge of dupEdges) {
    const principleId = String(edge.principle_id);
    const filters = { principle_id: `eq.${principleId}`, authority_id: `eq.${duplicateId}` };
    if (alreadyCanonical.has(principleId)) {
      await client.delete("principle_authority", filters);
      droppedAsRedundant.push(principleId);
    } else {
      await client.patch("principle_authority", filters, { authority_id: canonicalId, updated_at: nowIso() });
      repointed.push(principleId);
    }
  }

  for (const [table, column] of AUTHORITY_REFS) {
    await client.patch(table, { [column]: `eq.${duplicateId}` }, { [column]: canonicalId, updated_at: nowIso() });
  }

  const deleted = await client.delete("authority", { authority_id: `eq.${duplicateId}` });
  return {
    merged: true,
    duplicate_authority_id: duplicateId,
    canonical_authority_id: canonicalId,
    edges_repointed: repointed,
    edges_dropped_as_redundant: droppedAsRedundant,
    duplicate_deleted: deleted.length > 0,
  };
}
