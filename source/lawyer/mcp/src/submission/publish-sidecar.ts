// The publish sidecar of the Form 32 and Form 33 emitters (planning/1. Design/
// 2026-10-09_publish-never-blocks-warning-cover-spec.md): form-32-publish.json / form-33-publish.json,
// written beside the substance file. publish-bcsc-form's asm32/asm33 read it in place of a blank-form
// Generate run's context.json: its `caption` is the style of proceeding and the other caption fields,
// read here from the drafting database (counsel from case data, as partiesFor reads it), and its
// `warnings` are what the filler prints on the document's NOT FINAL cover page. The sidecar's grammar
// is owned by source/skills/publish/subskills/publish-bcsc-form/references/assembly-input-contract.md.

import { groupPartiesByRole, pluralizeRole } from "./forms/components.js";
import type { RenderContext } from "./forms/render-context.js";
import { criterionLine, filingBoardData } from "./matter-pages.js";

/** One cover-page line. `missing_datum` is information the form needs and the database does not hold,
 * `unmet_criterion` a completion criterion unmet or not yet derived (the gate's open steps included),
 * `other` anything else the practitioner must see before signing. */
export interface PublishWarning {
  kind: "missing_datum" | "unmet_criterion" | "other";
  field_or_id: string;
  message: string;
}

/** The sidecar's file name beside its substance file: form-32.md -> form-32-publish.json. */
export function publishFileName(substanceFile: string): string {
  return substanceFile.replace(/\.md$/, "-publish.json");
}

/**
 * The caption context the templates read (the keys a Generate run's context.json carried), as the
 * mockup prints it: parties grouped by role in ordinal order, the applicant, the parties to be served.
 * A value the database does not hold is null; asm32/asm33 print a placeholder for it and list it on
 * the cover. `correction_required` is empty because the emitter has already passed the party drift gate.
 */
export function captionContext(ctx: RenderContext): Record<string, unknown> {
  const groups = groupPartiesByRole(ctx.parties.map((p) => ({ name: p.name, role: p.role, ordinal: p.ordinal })));
  const caption = (g: { names: string[] } | undefined) => (g === undefined ? null : g.names.map((n) => n.toUpperCase()).join("\n"));
  const role = (g: { role: string; names: string[] } | undefined) => (g === undefined ? null : pluralizeRole(g.role, g.names.length));
  const client = ctx.parties.find((p) => p.is_client === 1);
  // As render-notice-of-application.ts names them: the applicant, else the client; the parties to be served.
  const applicant = ctx.parties.find((p) => p.is_applicant === 1) ?? client;
  const served = ctx.parties.filter((p) => p.to_be_served === 1).map((p) => p.name);
  return {
    court_file_number: ctx.proceeding.file_number,
    // The registry is read here and nowhere else in the caption: the one place the proceeding's
    // registry name reaches asm32/asm33 (see the Form 32 registry-name spec of 2026-10-09).
    registry: ctx.proceeding.registry,
    court_location: ctx.proceeding.courthouse_address,
    plaintiff_caption: caption(groups[0]),
    plaintiff_role: role(groups[0]),
    defendant_caption: caption(groups[1]),
    defendant_role: role(groups[1]),
    additional_captions: groups.slice(2).map((g) => ({ caption: caption(g), role_label: role(g) })),
    correction_required: [],
    client_name: client?.name ?? null,
    lawyer_name: client?.counsel_name ?? null,
    applicant_names: applicant?.name ?? null,
    to_affected_parties: served.length > 0 ? served.join(", ") : null,
    // The .docx is named from it, so no character Windows forbids in a file name survives.
    title: ctx.filing.title.replace(/[\\/:*?"<>|]/g, "_").trim(),
  };
}

/**
 * The filing's completion criteria as board_card's criteria lane reads them: each criterion not met,
 * with its counts, then the gate criterion's items (its open steps, or the open jobs holding it), and
 * each item the practitioner suppressed. States no date: the matter's deadlines are not read here.
 */
export function boardWarnings(ctx: RenderContext): PublishWarning[] {
  const section = filingBoardData(ctx.dbPath, ctx.filing, ctx.proceeding, {}, ctx.rendered, ctx.revision);
  const criteria = section.criteria ?? [];
  const warnings: PublishWarning[] = [];
  for (const c of criteria) {
    if (c.state !== "met") {
      warnings.push({ kind: "unmet_criterion", field_or_id: c.id, message: criterionLine(c, criteria, false).replace(/^- /, "") });
      if (c.id === "gate") for (const item of c.items) warnings.push({ kind: "unmet_criterion", field_or_id: "gate", message: `Pre-filing gate: ${item}` });
    }
    for (const item of c.items) {
      if (item.startsWith("🤫 ")) warnings.push({ kind: "other", field_or_id: c.id, message: `Suppressed: ${item.slice("🤫 ".length)}` });
    }
  }
  return warnings;
}

/** The sidecar's text: the caption and every warning, the session's notes last. */
export function publishSidecar(ctx: RenderContext, emitterWarnings: PublishWarning[], coverNotes: string[]): { json: string; warnings: PublishWarning[] } {
  const warnings = [
    ...emitterWarnings,
    ...boardWarnings(ctx),
    ...coverNotes.map((message): PublishWarning => ({ kind: "other", field_or_id: "session", message })),
  ];
  return { json: JSON.stringify({ caption: captionContext(ctx), warnings }, null, 2) + "\n", warnings };
}
