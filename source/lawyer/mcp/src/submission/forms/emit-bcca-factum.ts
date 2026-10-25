// bcca-factum.md filed-face emitter (#648), per
// .claude/skills/publish/subskills/publish-bcca-factum/references/bcca-factum-contract.md (SSOT).
// Consumed by /publish with publish-bcca-factum, which fills the court's respondent's factum
// template. Like render-form32-filed-face.ts, a purpose-built renderer rather than a strip of the
// Factum.md mockup: it cannot emit a marker or comment, and missing content refuses (naming it)
// instead of printing a placeholder. It reuses render-bcca-factum.ts's fetchers, signer and
// authorities list, and numbers Part 3 the way renderSubmissionParagraphs does, so the para #
// columns the practitioner reviewed on the mockup are the ones filed.

import { ValidationError } from "../../errors.js";
import { passesBriefOnlyCap } from "./brief-only-cap.js";
import { buildLowerCourtRoleByRole, formatNameList, groupPartiesByRole, pluralizeRole, type CaptionParty } from "./components.js";
import { courtRecordCitation } from "./markers.js";
import {
  factumAuthorities,
  factumEnactments,
  factumRecordLabel,
  factumSigner,
  fetchChronology,
  fetchProseParagraphs,
} from "./render-bcca-factum.js";
import { factsPart, fetchFacts } from "./filing-facts.js";
import {
  exhibitNumbersFromOrderedIds,
  fetchDocumentLabels,
  fetchFactStatements,
  fetchFilingDocuments,
  fetchOrdersSought,
  fetchSubmissionFacts,
  fetchSubmissionLaw,
  fetchSubmissions,
  groupSubmissionFacts,
  groupSubmissionLaw,
  type FactStatementRow,
  type LawAssertionRow,
  type RenderContext,
} from "./render-vaniac-submissions.js";
import { fetchRhetoric, interleave, renderRhetoricFiled, type RhetoricRow } from "./render-rhetoric.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function oneLine(text: string): string {
  return text.replace(/\s*\n\s*/g, " ").trim();
}

function pushExcerpt(lines: string[], excerpt: string | null, cite: string | null): void {
  if (excerpt) for (const l of excerpt.split("\n")) if (l.trim() !== "") lines.push(`> ${l.trim()}`);
  if (cite) lines.push(`cite: ${cite}`);
}

function factCite(exhibitMap: Map<number, number>, labelMap: Map<number, string>, s: FactStatementRow): string | null {
  const parts: string[] = [];
  if (s.instrument_id !== null) {
    const instrumentLabel = labelMap.get(s.instrument_id);
    if (instrumentLabel !== undefined) parts.push(instrumentLabel);
    if (s.pinpoint) parts.push(s.pinpoint);
  } else if (s.pinpoint) {
    parts.push(s.pinpoint);
  }
  if (s.exhibit_id !== null) {
    const num = exhibitMap.get(s.exhibit_id);
    const exhibitLabel = num !== undefined ? `Ex. ${num}` : labelMap.get(s.exhibit_id);
    if (exhibitLabel !== undefined) parts.push(exhibitLabel);
    if (s.exhibit_pinpoint) parts.push(s.exhibit_pinpoint);
  }
  return parts.length === 0 ? null : parts.join(", ");
}

function lawCite(row: LawAssertionRow): string {
  let pin = row.pinpoint;
  if (pin && row.authority_citation && pin.startsWith(row.authority_citation)) {
    pin = pin.slice(row.authority_citation.length).replace(/^[\s,;]+/, "") || null;
  }
  return `${row.authority_title}, ${row.authority_citation}${pin ? `, ${pin}` : ""}`;
}

export function renderBccaFactumFiledFace(ctx: RenderContext, datedOn: string): string {
  const { filing, proceeding } = ctx;
  const refuse = (what: string) => {
    throw new ValidationError(`"${filing.title}": ${what} -- add it before this factum can be assembled.`);
  };
  if (filing.kind !== "bcca_factum") {
    throw new ValidationError(
      `"${filing.title}" is not a Court of Appeal respondent's factum, so it cannot be made as one.`
    );
  }
  if (!ISO_DATE.test(datedOn)) throw new ValidationError(`dated_on must be YYYY-MM-DD, got "${datedOn}".`);
  if (!proceeding.file_number) refuse("the proceeding has no court file number recorded");

  const captionParties: CaptionParty[] = ctx.parties.map((p) => ({ name: p.name, role: p.role, ordinal: p.ordinal }));
  const groups = groupPartiesByRole(captionParties);
  if (groups.length < 2) refuse(`only ${groups.length} party role(s) are recorded on the proceeding; an appeal needs an appellant and a respondent`);
  const firstAppellant = ctx.parties.find((p) => p.role.toLowerCase() === "appellant");
  const firstRespondent = ctx.parties.find((p) => p.role.toLowerCase() === "respondent");
  if (!firstAppellant || !firstRespondent) refuse(`a party with role "Appellant" and a party with role "Respondent" are needed for the short style`);
  const signer = factumSigner(ctx);
  if (!signer.roleLabel) refuse("no party of the proceeding is recorded as the client");
  const client = ctx.parties.find((p) => p.is_client === 1)!;

  const chronology = fetchChronology(ctx.dbPath, filing.id);
  if (chronology.length === 0) refuse("the chronology has no events");
  const prose = fetchProseParagraphs(ctx.dbPath, filing.id);
  const opening = prose.get("opening_statement") ?? [];
  if (opening.length === 0) refuse("the opening statement is not recorded");
  const place = (prose.get("signing_place") ?? []).join(" ");
  if (!place) refuse("the place of signing is not recorded");

  const factsPosition = prose.get("facts_position") ?? [];
  const facts = fetchFacts(ctx.dbPath, filing.id, factsPart("bcca_factum"));
  // A rhetorical paragraph placed in Part 1 is Part 1 content, as a fact is.
  const factsRhetoric = fetchRhetoric(ctx.dbPath, filing.id, "form", "facts");
  if (factsPosition.length === 0 && facts.length === 0 && factsRhetoric.length === 0) refuse("Part 1 has neither a position on the appellants' facts nor any fact");

  const submissions = fetchSubmissions(ctx.dbPath, filing.id, "form");
  if (submissions.length === 0) refuse("no submission is deployed to this factum (Parts 2 and 3 would be empty)");
  const submissionIds = submissions.map((s) => s.id);
  const lawBySubmission = groupSubmissionLaw(fetchSubmissionLaw(ctx.dbPath, submissionIds));
  const submissionFactRows = fetchSubmissionFacts(ctx.dbPath, submissionIds);
  const submissionFactStatements = fetchFactStatements(ctx.dbPath, [...new Set(submissionFactRows.map((f) => f.fact_id))]);
  const factsBySubmission = groupSubmissionFacts(submissionFactRows, submissionFactStatements, new Set(), new Map());
  const printedLaw = (la: { statements: LawAssertionRow[] }) =>
    la.statements.filter(passesBriefOnlyCap);
  const missingCitation = submissions.flatMap((s) =>
    (lawBySubmission.get(s.id) ?? []).flatMap((la) => printedLaw(la).filter((st) => st.authority_citation === null).map((st) => st.statement_id))
  );
  if (missingCitation.length > 0) refuse(`statement(s) of law ${missingCitation.join(", ")} cite an authority with no citation`);

  const orders = fetchOrdersSought(ctx.dbPath, filing.id, "form").filter((o) => o.crossed_out_on === null);
  if (orders.length === 0) refuse("no order sought is recorded for Part 4");

  const docs = fetchFilingDocuments(ctx.dbPath, filing.id);
  const exhibitMap = exhibitNumbersFromOrderedIds(docs.map((d) => d.document_id));
  const referenced = new Set<number>(docs.map((d) => d.document_id));
  for (const s of submissionFactStatements) {
    if (s.exhibit_id !== null) referenced.add(s.exhibit_id);
    if (s.instrument_id !== null) referenced.add(s.instrument_id);
  }
  const labelMap = fetchDocumentLabels(ctx.dbPath, [...referenced]);

  const body: string[] = [];
  body.push("## OPENING STATEMENT", "");
  opening.forEach((p) => body.push(oneLine(p), ""));

  let n = 0;
  // A rhetorical paragraph prints its wording on one line, its record excerpts as quote lines and
  // its citations as cite lines, numbered in the mockup's place (render-bcca-factum.ts).
  const rhetoricLines = (row: RhetoricRow) => renderRhetoricFiled({ ...row, wording: oneLine(row.wording) }, ++n, "", "cite: ");
  body.push("## PART 1 - STATEMENT OF FACTS", "");
  factsPosition.forEach((p) => body.push(`${++n}. ${oneLine(p)}`));
  for (const entry of interleave(facts, factsRhetoric, (f) => f.filing_ordinal)) {
    if (entry.kind === "rhetoric") {
      body.push(...rhetoricLines(entry.row));
      continue;
    }
    const f = entry.item;
    body.push(`${++n}. ${oneLine(f.postulate)}`);
    const cite = courtRecordCitation(f.court_record, f.court_record_pinpoint);
    if (cite) body.push(`cite: ${cite}`);
  }
  body.push("");

  body.push("## PART 2 - ISSUES ON APPEAL", "");
  submissions.forEach((s) => body.push(`${++n}. ${oneLine(s.contention)}`));
  body.push("");

  body.push("## PART 3 - ARGUMENT", "");
  const lawParas = new Map<number, number>();
  for (const entry of interleave(submissions, fetchRhetoric(ctx.dbPath, filing.id, "form", "submissions"), (s) => s.filing_ordinal)) {
    if (entry.kind === "rhetoric") {
      body.push(...rhetoricLines(entry.row));
      continue;
    }
    const s = entry.item;
    body.push(`${++n}. ${oneLine(s.contention)}`);
    for (const f of factsBySubmission.get(s.id) ?? []) {
      const cite = courtRecordCitation(f.courtRecord, f.courtRecordPinpoint);
      body.push(`${++n}. ${oneLine(f.postulate)}${cite ? ` ${cite}` : ""}`);
      for (const st of f.statements) {
        if (st.purpose !== "impeachment") pushExcerpt(body, st.exhibit_id !== null ? st.exhibit_excerpt : st.excerpt, factCite(exhibitMap, labelMap, st));
      }
    }
    for (const la of lawBySubmission.get(s.id) ?? []) {
      const prior = lawParas.get(la.lawAssertionId);
      n += 1;
      if (prior !== undefined) {
        body.push(`${n}. As set out in paragraph ${prior}, above, ${oneLine(la.proposition)}`);
        continue;
      }
      lawParas.set(la.lawAssertionId, n);
      body.push(`${n}. ${oneLine(la.proposition)}`);
      for (const st of printedLaw(la)) pushExcerpt(body, st.excerpt, lawCite(st));
    }
  }
  body.push("");

  body.push("## PART 4 - NATURE OF ORDER SOUGHT", "");
  // Before the lead-in, as the mockup prints them. Part 4 admits only numbered and plain paragraphs
  // (bcca-factum-contract.md), so a record's quote and cite lines cannot be carried here.
  for (const row of fetchRhetoric(ctx.dbPath, filing.id, "form", "orders")) body.push(`${++n}. ${oneLine(row.wording)}`);
  body.push(`${++n}. The ${signer.roleLabel!.toLowerCase()} ${signer.roleLabel!.endsWith("s") ? "seek" : "seeks"} an Order:`);
  orders.forEach((o) => body.push(oneLine(o.wording_override ?? o.wording)));
  body.push(`${++n}. All of which is respectfully submitted.`);

  const { enactments } = factumEnactments(ctx.dbPath, lawParas);
  const bare = enactments.find((e) => e.excerpts.length === 0);
  if (bare) refuse(`the enactment "${bare.title}" has no stored excerpt to reproduce in the Enactments appendix`);

  const clientGroup = groups.find((g) => g.role === client.role)!;
  const lowerCourtRoles = buildLowerCourtRoleByRole(ctx.parties);
  const partyGroups = groups.map((g) => ({
    role: pluralizeRole(g.role, g.names.length),
    names: g.names,
    ...(lowerCourtRoles[g.role] ? { lower_court_role: lowerCourtRoles[g.role] } : {}),
  }));
  const contacts = [groups[0], groups[groups.length - 1]].map((g) => {
    const rep = ctx.parties.find((p) => p.role === g.role)!;
    return {
      role: pluralizeRole(g.role, g.names.length),
      names: g.names,
      counsel_name: rep.counsel_name,
      counsel_firm: rep.counsel_firm,
      address: rep.address_for_service,
      phone: rep.counsel_phone,
      email: rep.counsel_email,
    };
  });
  const recordLabel = factumRecordLabel(signer.roleLabel);

  const front: string[] = ["---"];
  const put = (key: string, value: string | null | undefined) => {
    if (value !== null && value !== undefined && value !== "") front.push(`${key}: ${value}`);
  };
  put("file_number", proceeding.file_number);
  put("short_style", `${firstAppellant!.name} vs. ${firstRespondent!.name}`);
  if (proceeding.under_appeal_judge && proceeding.under_appeal_court && proceeding.under_appeal_pronounced) {
    put("under_appeal_judge", proceeding.under_appeal_judge);
    put("under_appeal_court", proceeding.under_appeal_court);
    put("under_appeal_pronounced", proceeding.under_appeal_pronounced);
  }
  if (proceeding.access_restrictions) {
    put("access_restrictions", JSON.stringify(proceeding.access_restrictions.split("\n").map((l) => l.trim()).filter((l) => l !== "")));
  }
  put("record_label", recordLabel);
  put("title", recordLabel.toUpperCase());
  put("filing_party_phrase", formatNameList(clientGroup.names));
  put("party_groups", JSON.stringify(partyGroups));
  put("contacts", JSON.stringify(contacts));
  put("chronology", JSON.stringify(chronology.map((c) => ({ date: c.event_date, event: oneLine(c.event) }))));
  put("authorities", JSON.stringify(factumAuthorities(ctx.dbPath, lawParas).map(({ authority_id, ...a }) => a)));
  put("enactments", JSON.stringify(enactments.map(({ authority_id, ...e }) => e)));
  put("signing_place", place);
  put("dated_on", datedOn);
  put("authorizing_name", signer.name);
  put("authorizing_line", signer.line);
  front.push("---", "");

  return [...front, ...body].join("\n").trimEnd() + "\n";
}
