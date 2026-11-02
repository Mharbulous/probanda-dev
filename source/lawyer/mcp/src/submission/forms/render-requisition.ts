// BCSC requisition renderers -- default judgment (Form 17 + Form 8) and
// consent order (Form 17 subkind=consent + Consent Order) -- build ticket
// #297, design doc 291 §5, issue #288 §2.2 inventory, issue #293 consent
// desk order precedent. `filings.subkind` was the order-type discriminator
// (issue #293 §3.1); since schema v29 the kind itself is
// (requisition_default_judgment | requisition_consent), and subkind keeps
// the same value. Schema v10 (#380) renamed relief_items ->
// order_sought and replaced disposition with the derived-deployment /
// crossed_out_on model; these renderers only ever read document='form' rows
// (fetchOrdersSought), so the deployment filter is the join itself.

import {
  BLANK_UNDERLINE,
  frontmatterHeader,
  requisitionWrapper,
  signatureBlock,
  styleOfProceedingCaption,
  type CaptionParty,
  type FrontmatterFields,
} from "./components.js";
import { gapMarker } from "./markers.js";
import { recordCriterionGlyphs, recordGlyphs, type MarkerInventory } from "./proposal-inventory.js";
import { captionHeadingFor } from "./query.js";
import { fetchFilingDocuments, fetchOrdersSought, orderReviewMarkerFor, reviewMarkerFor, type RenderContext } from "./render-vaniac-submissions.js";
import { rows } from "../query-rows.js";

interface AlternativeRow {
  id: number;
  wording: string;
  template_key: string | null;
  template_values: string | null;
  crossed_out_on: string | null;
}

/** Alternatives are a proceeding-scoped chain off order_sought.alternative_to, not a per-filing
 * pointer -- unaffected by the v10 pointer-table hop beyond the table rename. An alternative is an
 * ordinary order_sought row (schema.sql:193), so crossed_out_on is its own fact, not the
 * primary's (#832). */
function fetchAlternatives(dbPath: string, chosenId: number): AlternativeRow[] {
  return rows<AlternativeRow>(
    dbPath,
    `SELECT id, wording, template_key, template_values, crossed_out_on
     FROM order_sought WHERE alternative_to = ?`,
    [chosenId]
  );
}

/** #960: the orders a Form 8 deploys by placement rather than by pointer row -- every alternative,
 * struck or live, chained under a form-deployed primary (renderForm8DefaultJudgment renders each
 * one). Empty for every other filing kind, since no other renderer reads alternative_to. The reserve
 * inventory unions this into its deployed set, so a placed alternative counts as deployed, not reserved. */
export function fetchPlacedAlternativeIds(dbPath: string, filing: { id: number; kind: string }): number[] {
  if (filing.kind !== "requisition_default_judgment") return [];
  return rows<{ id: number }>(
    dbPath,
    `SELECT o.id FROM order_sought o
     JOIN filing_orders fo ON fo.order_sought_id = o.alternative_to
     WHERE fo.filing_id = ? AND fo.document = 'form'`,
    [filing.id]
  ).map((r) => r.id);
}

function frontmatterFor(ctx: RenderContext, documentType: string): string {
  const fields: FrontmatterFields = {
    clientName: ctx.clientName,
    clientNo: ctx.clientNo,
    matterNo: ctx.matterNo,
    matterDescription: ctx.matterDescription,
    venue: ctx.proceeding.court_or_centre ?? captionHeadingFor(ctx.filing, ctx.proceeding).display_label,
    proceedingFileNo: ctx.proceeding.file_number ?? "",
    documentType,
    documentName: ctx.filing.title,
    documentDate: BLANK_UNDERLINE,
    revision: ctx.revision,
    rendered: ctx.rendered,
  };
  return frontmatterHeader(fields);
}

function captionParties(ctx: RenderContext): CaptionParty[] {
  return ctx.parties.map((p) => ({ name: p.name, role: p.role, ordinal: p.ordinal }));
}

/** The two renderTemplate fallbacks for a key this renderer cannot turn into an operative
 * provision. Exported so forms.ts's filed gate can find them: both survive the filed face's
 * glyph strip as a grammatical, signable order that orders nothing ("THIS COURT ORDERS that
 * the defendant(s) Corbin Vasey (template not chosen)."), so the filed render refuses rather
 * than deliver one (#825; Brahm's call 2026-09-22, covering the null and the unrecognized key
 * together -- a key nobody recognized is no more orderable than no key at all). */
export const TEMPLATE_NOT_CHOSEN = "(template not chosen)";
export const UNRECOGNIZED_TEMPLATE_KEY = 'unrecognized template_key "';

/**
 * Renders a Form 8 operative/interest/costs provision from its closed
 * template set. Key strings are this renderer's own contract (schema.sql's
 * template_key column carries no CHECK constraint pinning them) -- the
 * skill populating order_sought.template_key must use these exact values.
 */
function renderTemplate(key: string | null, valuesJson: string | null): string {
  if (!key) return `${gapMarker("unchosen")} ${TEMPLATE_NOT_CHOSEN}`;
  let values: Record<string, unknown> = {};
  if (valuesJson) {
    try {
      values = JSON.parse(valuesJson) as Record<string, unknown>;
    } catch {
      values = {};
    }
  }
  switch (key) {
    case "sum_certain":
      return `pay to the plaintiff(s) the sum of $${Number(values.amount ?? 0).toLocaleString("en-US")}`;
    case "damages_to_be_assessed":
      return "pay to the plaintiff(s) damages to be assessed";
    case "delivery_or_assessed_value":
      return `deliver up ${values.description ?? "(not recorded)"}, or pay the assessed value of it if delivery cannot be made`;
    case "assessed_value_for_operative":
      return "pay to the plaintiff(s) the assessed value of the goods claimed";
    case "interest_as_claimed":
      return `pay to the plaintiff(s) interest as claimed in the amount of $${Number(values.amount ?? 0).toLocaleString("en-US")}`;
    case "interest_coia":
      return "interest under the Court Order Interest Act";
    case "costs_fixed":
      return `pay to the plaintiff(s) costs in the fixed amount of $${Number(values.amount ?? 0).toLocaleString("en-US")}`;
    case "costs_to_be_assessed":
      return "pay to the plaintiff(s) costs to be assessed";
    default:
      return `${gapMarker("not_recorded")} ${UNRECOGNIZED_TEMPLATE_KEY}${key}"`;
  }
}

/** Site 26 (#829): a live order's "(template not chosen)" ⬜ is the practitioner's template choice,
 * keyed on the order. Not recordGlyphs: GLYPH_SLUGS maps ⬜ to the checklist's `unchosen`, which
 * names different work. The unrecognized-key 🏷️ records nothing -- a key outside renderTemplate's
 * set is a data defect in whatever wrote it, not a choice left open, and #825 keeps it off the
 * filed face. */
function recordTemplateChoice(inv: MarkerInventory, r: { id: number; wording: string; template_key: string | null }): void {
  if (!r.template_key) inv.push({ generating: true, slug: "choose-template", marker: "⬜", table: "order_sought", id: r.id, item: r.wording, doc: "" });
}

export function renderRequisitionDefaultJudgment(ctx: RenderContext): string {
  const defendants = ctx.parties.filter((p) => /defendant/i.test(p.role));
  const plaintiff = ctx.parties.find((p) => p.is_client === 1) ?? ctx.parties.find((p) => p.is_applicant === 1);
  const docs = fetchFilingDocuments(ctx.dbPath, ctx.filing.id);

  const caption = styleOfProceedingCaption(captionParties(ctx), {
    heading: captionHeadingFor(ctx.filing, ctx.proceeding),
    registry: ctx.proceeding.registry,
    fileNumber: ctx.proceeding.file_number,
    titleLine: "REQUISITION - GENERAL",
  });

  // The form's own blank fields: each 🧩 is an open item keyed on its field (#1226, as #1219). The
  // Form 8 below keys its defendants on the same field, so the Practice Board counts that gap once.
  const defendantNames = defendants.map((d) => d.name).join(", ") || gapMarker("gap");
  const filedBy = plaintiff ? `${plaintiff.role}, ${plaintiff.name}` : gapMarker("gap");
  recordCriterionGlyphs(ctx.inventory, defendantNames, ["🧩"], { table: "form_fields", id: 0, item: "Defendants" });
  recordCriterionGlyphs(ctx.inventory, filedBy, ["🧩"], { table: "form_fields", id: 1, item: "Filed by" });
  const required =
    `Search for a Response to Civil Claim filed on behalf of the Defendant, ${defendantNames} ` +
    "and if no Response to Civil Claim has been filed, please enter default judgment.";

  const checklist: string[] = [];
  const draftOrderDoc = docs.find((d) => d.role === "order");
  const affidavitDoc = docs.find((d) => d.role === "affidavit");
  // Site 25: both ⬜s key on this filing's own row, so the qualifier says which of the two
  // supporting documents is missing and the item is the checklist line's own text -- the filing
  // title would give the two Proposals identical titles (plan A3).
  const orderItem = "Draft default judgment";
  const affidavitItem = "Affidavit of service and non-delivery of a response to civil claim";
  const orderGap = draftOrderDoc ? "" : gapMarker("unchosen");
  const affidavitGap = affidavitDoc ? "" : gapMarker("unchosen");
  recordGlyphs(ctx.inventory, orderGap, ["⬜"], { table: "filings", id: ctx.filing.id, qualifier: "order", item: orderItem });
  recordGlyphs(ctx.inventory, affidavitGap, ["⬜"], { table: "filings", id: ctx.filing.id, qualifier: "affidavit", item: affidavitItem });
  checklist.push(`${orderGap ? `${orderGap} ` : ""}${orderItem}`);
  checklist.push(`${affidavitGap ? `${affidavitGap} ` : ""}${affidavitItem}`);

  const lines: string[] = [];
  lines.push(frontmatterFor(ctx, "Requisition"));
  lines.push("");
  lines.push(
    requisitionWrapper({
      captionMarkdown: caption,
      titleLine: "REQUISITION - GENERAL",
      filedBy,
      required,
      checklistLeadIn: "This requisition is supported by the following:",
      checklist,
    })
  );
  lines.push("");
  if (plaintiff) lines.push(signatureBlock({ name: plaintiff.name, role: plaintiff.role, counselName: plaintiff.counsel_name }, false));

  return lines.join("\n").trimEnd() + "\n";
}

export function renderForm8DefaultJudgment(ctx: RenderContext): string {
  const defendants = ctx.parties.filter((p) => /defendant/i.test(p.role));
  // Deployment is the join itself (document='form') -- no disposition filter
  // needed any more (schema v10, #380). A crossed-out chosen order still
  // renders here today's design has no requisition-side strikethrough
  // precedent; crossed_out_on is read defensively below in case a filing
  // ever carries one, matching the NoA/Consent Order inline convention.
  const chosen = fetchOrdersSought(ctx.dbPath, ctx.filing.id, "form");
  const defendantNames = defendants.map((d) => d.name).join(", ") || gapMarker("gap");
  // Printed in the preamble and in every provision, recorded once, on the requisition's own key.
  recordCriterionGlyphs(ctx.inventory, defendantNames, ["🧩"], { table: "form_fields", id: 0, item: "Defendants" });

  const caption = styleOfProceedingCaption(captionParties(ctx), {
    heading: captionHeadingFor(ctx.filing, ctx.proceeding),
    registry: ctx.proceeding.registry,
    fileNumber: ctx.proceeding.file_number,
    titleLine: "DEFAULT JUDGMENT",
  });

  const lines: string[] = [];
  lines.push(frontmatterFor(ctx, "Default_judgment"));
  lines.push("");
  lines.push(caption);
  lines.push("");
  lines.push(
    `The plaintiff(s) having filed and served a notice of civil claim and the defendant(s) ${defendantNames} ` +
      "having failed to file and serve a response to civil claim within the time allowed;"
  );
  lines.push("");

  let opNum = 0;
  chosen.forEach((r) => {
    if (r.crossed_out_on !== null) {
      lines.push(`~~the defendant(s) ${defendantNames} ${renderTemplate(r.template_key, r.template_values)}~~ <!-- order crossed-out ${r.id} -->`);
      lines.push("");
    } else {
      opNum += 1;
      const prefix = opNum === 1 ? "THIS COURT ORDERS" : "THIS COURT FURTHER ORDERS";
      // No 🦵 on a requisition's face, primary or alternative (#960): a requisition files no
      // argument, so no submission is owed to its orders and the marker named no work.
      recordTemplateChoice(ctx.inventory, r);
      // 🧐 reads the whole composed line, since its ⬜/🏷️ template fallback and the defendants' 🧩
      // print inside the provision text (design §3).
      const provision = `${prefix} that the defendant(s) ${defendantNames} ${renderTemplate(r.template_key, r.template_values)}.`;
      const review = orderReviewMarkerFor(ctx.review, ctx.inventory, provision, r);
      lines.push(`${provision}${review ? ` ${review}` : ""} <!-- order_sought_id ${r.id} -->`);
      lines.push("");
    }
    // #832: the chain renders under a crossed-out primary as well as a live one. alternative_to is
    // placement, not a state cascade -- terms-and-symbols.md's Cascade paragraph runs orders ->
    // submissions -> facts/law assertions and has no alternative_to leg, so an alternative whose own
    // crossed_out_on is ∅ is live relief and must reach the mockup, the practitioner's only review
    // surface. Returning early here hid it from every surface.
    const alternatives = fetchAlternatives(ctx.dbPath, r.id);
    for (const alt of alternatives) {
      // #810 gave this line its own sentence lead, because the ⬜ used to stand in for one and the
      // filed face -- which strips every glyph -- delivered a bare fragment. #826 then struck the
      // ⬜ itself (work-markers.md §6): the marker was unconditional, so it named no work and could
      // never clear, and an alternative order is relief the practitioner drafted and seeks. A null
      // template_key still marks the line through renderTemplate.
      if (alt.crossed_out_on !== null) {
        // #832: struck in the data, so struck on the face -- the primary branch's shape, with
        // "in the alternative," inside the one ~~ span so filed-face.ts's whole-line drop catches
        // it. Without this the practitioner's own decision not to pursue reached the court as a
        // live operative sentence: #825's gate reads template_key only, and after #826 the line
        // carries no glyph for the filed-face strip to remove.
        lines.push(`~~in the alternative, the defendant(s) ${defendantNames} ${renderTemplate(alt.template_key, alt.template_values)}~~ <!-- order crossed-out ${alt.id} -->`);
        continue;
      }
      recordTemplateChoice(ctx.inventory, alt);
      const altProvision =
        `THIS COURT FURTHER ORDERS that, in the alternative, the defendant(s) ${defendantNames} ` +
        `${renderTemplate(alt.template_key, alt.template_values)}.`;
      const altReview = reviewMarkerFor(ctx.review, ctx.inventory, altProvision, "order_sought", alt.id, alt.wording);
      lines.push(`${altProvision}${altReview ? ` ${altReview}` : ""} <!-- order_sought_id ${alt.id} -->`);
    }
    if (alternatives.length > 0) lines.push("");
  });

  return lines.join("\n").trimEnd() + "\n";
}

/**
 * Requisition for Consent Order -- fixed 4-item checklist per the single
 * filed precedent (issue #293 §1); generality beyond that one instance is
 * unconfirmed (§4 of that doc). No supporting-materials list (the draft
 * order travels as item 2's own attachment, not a listed document).
 */
export function renderRequisitionConsent(ctx: RenderContext): string {
  const applicant = ctx.parties.find((p) => p.is_applicant === 1) ?? ctx.parties.find((p) => p.is_client === 1);
  const filedBy = applicant ? `${applicant.role}, ${applicant.name}` : gapMarker("gap");
  recordCriterionGlyphs(ctx.inventory, filedBy, ["🧩"], { table: "form_fields", id: 0, item: "Filed by" });

  const caption = styleOfProceedingCaption(captionParties(ctx), {
    heading: captionHeadingFor(ctx.filing, ctx.proceeding),
    registry: ctx.proceeding.registry,
    fileNumber: ctx.proceeding.file_number,
    titleLine: "REQUISITION FOR CONSENT ORDER",
  });

  const checklist = [
    "The rule or other enactment relied on is Rule 8-3.",
    "Attached to this requisition is a draft of the order required.",
    "Each party affected has consented to the order.",
    "No party is under a legal disability.",
  ];

  const lines: string[] = [];
  lines.push(frontmatterFor(ctx, "Requisition"));
  lines.push("");
  lines.push(
    requisitionWrapper({
      captionMarkdown: caption,
      titleLine: "REQUISITION FOR CONSENT ORDER",
      filedBy,
      required: "An order by consent.",
      checklist,
    })
  );
  lines.push("");
  if (applicant) lines.push(signatureBlock({ name: applicant.name, role: applicant.role, counselName: applicant.counsel_name }, false));

  return lines.join("\n").trimEnd() + "\n";
}

export function renderConsentOrder(ctx: RenderContext): string {
  const applicants = ctx.parties.filter((p) => p.is_applicant === 1);
  const applicantNames = applicants.map((p) => p.name).join(", ") || ctx.parties.find((p) => p.is_client === 1)?.name || gapMarker("gap");
  recordCriterionGlyphs(ctx.inventory, applicantNames, ["🧩"], { table: "form_fields", id: 1, item: "Applicants" });
  const relief = fetchOrdersSought(ctx.dbPath, ctx.filing.id, "form");
  const withCounsel = ctx.parties.filter((p) => p.counsel_name);

  const caption = styleOfProceedingCaption(captionParties(ctx), {
    heading: captionHeadingFor(ctx.filing, ctx.proceeding),
    registry: ctx.proceeding.registry,
    fileNumber: ctx.proceeding.file_number,
    titleLine: "CONSENT ORDER",
  });

  const lines: string[] = [];
  lines.push(frontmatterFor(ctx, "Consent_order"));
  lines.push("");
  lines.push(caption);
  lines.push("");
  lines.push(`BEFORE A REGISTRAR )  ${ctx.rendered.slice(0, 10)}  )  )`);
  lines.push("");
  lines.push(`ON THE APPLICATION of ${applicantNames} without a hearing and by consent;`);
  lines.push("");
  lines.push("THIS COURT ORDERS that:");
  // Crossed-out (order_sought.crossed_out_on, schema v10 #380 -- was a
  // disposition='reserved' trailing "Held in reserve" list, #384 retires
  // that section): renders inline, in filing order, unnumbered, struck, no
  // glyph -- same two-counter convention as the NoA's Part 1.
  let includedOrderNum = 0;
  let crossedOutOrderNum = 0;
  relief.forEach((r) => {
    const wording = r.wording_override ?? r.wording;
    if (r.crossed_out_on !== null) {
      crossedOutOrderNum += 1;
      lines.push(`~~${wording}~~ <!-- order crossed-out ${crossedOutOrderNum} -->`);
      return;
    }
    includedOrderNum += 1;
    // No 🦵 on a requisition's face (#960), as in the Form 8 above.
    const review = orderReviewMarkerFor(ctx.review, ctx.inventory, "", r);
    lines.push(`${includedOrderNum}. ${wording}${review ? ` ${review}` : ""} <!-- order ${includedOrderNum} -->`);
  });
  lines.push("");
  lines.push("THE FOLLOWING PARTIES APPROVE THE FORM OF THIS ORDER AND CONSENT TO EACH OF THE ORDERS, IF ANY, THAT ARE INDICATED ABOVE AS BEING BY CONSENT");
  lines.push("");
  for (const party of withCounsel) {
    lines.push(`Signature of ${party.counsel_name}, lawyer for the ${party.role}, ${party.name}`);
    lines.push(`${party.counsel_name}`);
    lines.push("");
  }
  lines.push("By the Court.");
  lines.push("");
  lines.push("Registrar");

  return lines.join("\n").trimEnd() + "\n";
}
