// bcca-book.md filed-face emitter (publish-bcca-book interchange contract), per
// source/skills/publish/subskills/publish-bcca-book/references/bcca-book-contract.md (SSOT).
// Produces the frontmatter-only data file /publish with publish-bcca-book
// fills into court-ready .docx files: the Response Book's cover page and
// table of contents, and the Book of Authorities' cover page and table of contents.
// Two filing kinds reach it. A bcca_stay_response filing gets both halves (four documents);
// a bcca_factum filing gets the Book of Authorities alone (#731), so the four response_book_*
// keys are omitted as a group and two documents are filled.
//
// Like render-form32-filed-face.ts, this is a purpose-built renderer, not a strip pass over
// render-bcca-stay-response.ts's mockup: the mockup's cover/TOC rows carry gap markers and
// "TBD" page cells (a review surface); bcca-book.md may carry neither -- a missing
// cover-critical field refuses (naming it) rather than emitting a placeholder. It reuses
// the mockup's own party-grouping (components.ts's groupPartiesByRole/pluralizeRole/
// formatNameList/buildLowerCourtRoleByRole) and TOC row-building
// (render-bcca-stay-response.ts's buildTocRows) so the mockup the practitioner reviewed
// and the filed cover/TOC content never diverge. No body content -- the contract is
// frontmatter-only, so unlike form-32/form-33 there is no paragraph prose here at all.

import { ValidationError } from "../../errors.js";
import {
  buildLowerCourtRoleByRole,
  formatNameList,
  groupPartiesByRole,
  pluralizeRole,
  type CaptionParty,
} from "./components.js";
import {
  buildTocRows,
  fetchAffidavitDetails,
  fetchCitedAuthorities,
  fetchOpposingAuthoritiesCount,
  type AffidavitDetailRow,
  type AuthorityListRow,
  type BookPart,
  type TocRow,
} from "./render-bcca-stay-response.js";
import { factumBookAuthorities } from "./render-bcca-factum.js";
import { exhibitNumbersFromOrderedIds, fetchFilingDocuments } from "./exhibit-documents.js";
import type { RenderContext } from "./render-context.js";
import type { PartyRow } from "./query.js";

/** "Respondents" -> "Respondents'"; "Respondent" -> "Respondent's" -- the possessive prefix
 * response_book_title/boa_title need ("Respondents' Response Book"). */
function possessive(name: string): string {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

function firstPartyWithRole(parties: PartyRow[], role: string): PartyRow | undefined {
  return parties.find((p) => p.role.toLowerCase() === role.toLowerCase());
}

interface PartyGroupEntry {
  role: string;
  names: string[];
  lower_court_role?: string;
}

interface ContactEntry {
  role: string;
  names: string[];
  counsel_name: string | null;
  counsel_firm: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
}

interface BoaTocEntry {
  authority: string;
  citation: string | null;
  part: number;
}

/**
 * Renders one bcca_stay_response or bcca_factum filing's bcca-book.md filed face. Deterministic
 * from the database alone (ctx.rendered is never read).
 *
 * Throws ValidationError rather than emitting a partial file when a cover-critical field
 * cannot be composed -- naming the specific missing field, per the contract's "Refusal
 * conditions" section and its "content" half of the division of discipline.
 */
export function renderBccaBookFiledFace(ctx: RenderContext): string {
  if (ctx.filing.kind !== "bcca_stay_response" && ctx.filing.kind !== "bcca_factum") {
    throw new ValidationError(
      `"${ctx.filing.title}" is not a Court of Appeal stay-application response or respondent's factum, so it has no book to make.`
    );
  }
  const isFactum = ctx.filing.kind === "bcca_factum";

  const proceeding = ctx.proceeding;

  const fileNumber = proceeding.file_number;
  if (!fileNumber) {
    throw new ValidationError(
      `"${ctx.filing.title}": the proceeding has no court file number recorded -- add it before this document can be assembled.`
    );
  }
  const registry = proceeding.registry;
  if (!registry) {
    throw new ValidationError(
      `"${ctx.filing.title}": the proceeding has no registry recorded -- add it before this document can be assembled.`
    );
  }

  const captionParties: CaptionParty[] = ctx.parties.map((p) => ({ name: p.name, role: p.role, ordinal: p.ordinal }));
  const roleGroups = groupPartiesByRole(captionParties);
  if (roleGroups.length < 2) {
    throw new ValidationError(
      `"${ctx.filing.title}": only ${roleGroups.length} party role(s) are recorded on the proceeding -- an appeal needs both an appellant and a respondent party before this document can be assembled.`
    );
  }

  const firstAppellant = firstPartyWithRole(ctx.parties, "Appellant");
  const firstRespondent = firstPartyWithRole(ctx.parties, "Respondent");
  if (!firstAppellant || !firstRespondent) {
    throw new ValidationError(
      `"${ctx.filing.title}": the proceeding needs a party with role "Appellant" and a party with role "Respondent" to compose the short style of cause -- add the missing role before this document can be assembled.`
    );
  }
  const shortStyle = `${firstAppellant.name} vs. ${firstRespondent.name}`;

  const client = ctx.parties.find((p) => p.is_client === 1);
  const clientGroup = client ? roleGroups.find((g) => g.role === client.role) : undefined;
  if (!clientGroup) {
    throw new ValidationError(
      `"${ctx.filing.title}": no party of the proceeding is recorded as the client -- each book's title line needs to know the filing party's role. Record the responding party as the client before this document can be assembled.`
    );
  }
  const filingPartyLabel = possessive(pluralizeRole(clientGroup.role, clientGroup.names.length));

  const lowerCourtRoles = buildLowerCourtRoleByRole(ctx.parties);
  const partyGroups: PartyGroupEntry[] = roleGroups.map((g) => {
    const entry: PartyGroupEntry = { role: pluralizeRole(g.role, g.names.length), names: g.names };
    const lcr = lowerCourtRoles[g.role];
    if (lcr) entry.lower_court_role = lcr;
    return entry;
  });

  const contacts: ContactEntry[] = roleGroups.map((g) => {
    const rep = ctx.parties.find((p) => p.role === g.role);
    return {
      role: pluralizeRole(g.role, g.names.length),
      names: g.names,
      counsel_name: rep?.counsel_name ?? null,
      counsel_firm: rep?.counsel_firm ?? null,
      address: rep?.address_for_service ?? null,
      phone: rep?.counsel_phone ?? null,
      email: rep?.counsel_email ?? null,
    };
  });

  // The BOA half, both kinds. A factum's book lists the factum's own Appendix: List of
  // Authorities -- same authorities, same citation text, same alphabetical order (#731) -- so it
  // comes from render-bcca-factum.ts, not from the stay response's delta list, which excludes
  // opposing_authorities. The delta list also drops an authority cited only by leads (#850).
  const boaSource: { authority: string; citation: string | null }[] = isFactum
    ? factumBookAuthorities(ctx.dbPath, ctx.filing.id)
    : fetchCitedAuthorities(ctx.dbPath, ctx.filing.id, proceeding.id).map((a: AuthorityListRow) => ({
        authority: a.style_of_cause_or_title,
        citation: a.citation,
      }));
  // One part file per authority, in table order.
  const boaToc: BoaTocEntry[] = boaSource.map((a, i) => ({ authority: a.authority, citation: a.citation, part: i }));
  const boaParts: BookPart[] = boaToc.map((r) => ({ bookmark: r.citation ? `${r.authority}, ${r.citation}` : r.authority }));

  // The response-book half is the stay response's alone: a factum filing's book is the Book of
  // Authorities by itself, so all four response_book_* keys are omitted as one group.
  let responseBook: { rows: TocRow[]; parts: BookPart[] } | null = null;
  if (!isFactum) {
    const docs = fetchFilingDocuments(ctx.dbPath, ctx.filing.id);
    const affidavitDetails: Map<number, AffidavitDetailRow> = fetchAffidavitDetails(ctx.dbPath, docs.map((d) => d.document_id));
    const exhibitMap = exhibitNumbersFromOrderedIds(docs.map((d) => d.document_id));
    const unverifiedDelta = fetchOpposingAuthoritiesCount(ctx.dbPath, proceeding.id) === 0;
    responseBook = buildTocRows(
      docs,
      affidavitDetails,
      exhibitMap,
      ctx.dbPath,
      boaToc.length > 0,
      unverifiedDelta,
      (what) => {
        throw new ValidationError(
          `"${ctx.filing.title}": the response book's table of contents cannot be composed -- ${what} is missing. Add it before this document can be assembled.`
        );
      }
    );
  }

  const lines: string[] = [];
  lines.push("---");
  lines.push(`file_number: ${fileNumber}`);
  lines.push(`registry: ${registry}`);
  lines.push(`short_style: ${shortStyle}`);
  if (proceeding.under_appeal_judge) lines.push(`under_appeal_judge: ${proceeding.under_appeal_judge}`);
  if (proceeding.under_appeal_court) lines.push(`under_appeal_court: ${proceeding.under_appeal_court}`);
  if (proceeding.under_appeal_pronounced) lines.push(`under_appeal_pronounced: ${proceeding.under_appeal_pronounced}`);
  if (proceeding.access_restrictions) {
    lines.push(`access_restrictions: ${JSON.stringify(proceeding.access_restrictions.split("\n"))}`);
  }
  if (responseBook) {
    lines.push(`response_book_record_label: Response Book`);
    lines.push(`response_book_title: ${filingPartyLabel} Response Book`);
  }
  lines.push(`boa_record_label: Book of Authorities`);
  lines.push(`boa_title: ${filingPartyLabel} Book of Authorities`);
  const filingPartyPhrase = formatNameList(clientGroup.names);
  if (filingPartyPhrase) lines.push(`filing_party_phrase: ${filingPartyPhrase}`);
  lines.push(`party_groups: ${JSON.stringify(partyGroups)}`);
  lines.push(`contacts: ${JSON.stringify(contacts)}`);
  if (responseBook) {
    lines.push(`response_book_toc: ${JSON.stringify(responseBook.rows)}`);
    lines.push(`response_book_parts: ${JSON.stringify(responseBook.parts)}`);
  }
  lines.push(`boa_toc: ${JSON.stringify(boaToc)}`);
  lines.push(`boa_parts: ${JSON.stringify(boaParts)}`);
  lines.push("---");

  return lines.join("\n").trimEnd() + "\n";
}
