// The filler registry (spec §6 piece 7; shared/declared-layout.md section 2, `renderer`).
//
// A Writing's type file is found from its proceeding's forum, a knowledge-tree key
// (`CAN/BC/BCSC`, schema v28), and its stored kind (schema v29): the venue's kinds index in
// /draft's shipped tree names the file whose row lists the stored kind as an alias. A type
// declaring `renderer: bespoke` renders through the filler registered for that venue key plus
// kind, which maps to the existing render functions. Compose fails hard on a bespoke type with no
// registered filler, naming the venue, the kind and the missing filler. A `_NoVenue` type never
// has a filler.
//
// The shipped tree only, by resolveShippedRoot: the overlay (a firm's learned files) has no
// bespoke filler to offer. A `general` type never composes here: it renders from the Writing's
// stored layout (forms/render-general.ts), which creation resolved through the merged tree
// (forms/layout-snapshot.ts).

import { readFileSync } from "node:fs";

import { DataServerError } from "../../errors.js";
import { extractJsonBlock, validateTypeBlock } from "../../knowledge/declared-layout.js";
import { mergeKinds, NO_VENUE } from "../../knowledge/index.js";
import { parseKnowledgePath, shippedLayer, type KnowledgeSeams } from "../../knowledge/tree.js";
import { renderApplicationResponse } from "./render-application-response.js";
import { renderBccaFactum } from "./render-bcca-factum.js";
import { renderBccaStayResponse } from "./render-bcca-stay-response.js";
import { affidavitFileName, fetchAffidavits, renderAffidavit } from "./render-bcsc-affidavit.js";
import { renderWrittenArguments } from "./render-companions.js";
import { renderNoticeOfApplication } from "./render-notice-of-application.js";
import {
  renderConsentOrder,
  renderForm8DefaultJudgment,
  renderRequisitionConsent,
  renderRequisitionDefaultJudgment,
} from "./render-requisition.js";
import { renderEvidenceIndex, type RenderContext } from "./render-vaniac-submissions.js";
import { affidavitLabel, type WritingLabel } from "./writing-label.js";

/** How a filler emits its documents. The caller supplies both, so each document is timed and its
 * inventory entries stamped exactly as the render path always has. */
export interface FillerOutput<D> {
  /** One venue document, rendered and stamped under its own documentType, with its label for the Work Board's
   * Writings strip, the type's own when omitted. */
  document(documentType: string, fileName: string, render: () => string, label?: WritingLabel): D;
  /** Every witness statement, from one render call, all under the one documentType. */
  witnessStatements(): D[];
}

/** A venue's document(s) for one Writing, in the order the render path needs them. */
export type Filler = <D>(ctx: RenderContext, out: FillerOutput<D>) => D[];

export interface FillerKey {
  /** The venue's tree key, `<Country>/<Jurisdiction>/<Venue>`. */
  venue: string;
  /** The stored kind. */
  kind: string;
}

const VANIAC = "CAN/BC/Vancouver-International-Arbitration-Centre";
const BCSC = "CAN/BC/BCSC";
const BCCA = "CAN/BC/BCCA";

/** One companion per affidavit supporting a BCSC Notice of Application or Application Response (#1486). */
function supportingAffidavits<D>(ctx: RenderContext, out: FillerOutput<D>): D[] {
  return fetchAffidavits(ctx.dbPath, ctx.filing.id).map((a) =>
    out.document("Affidavit", affidavitFileName(a), () => renderAffidavit(ctx, a), affidavitLabel(a))
  );
}

const FILLERS: readonly (FillerKey & { filler: Filler })[] = [
  {
    venue: VANIAC,
    kind: "submissions_package",
    // #380's resolution: for a VanIAC filing, the Written Arguments IS the venue document -- its
    // pointer rows read document='form', and no separate 'written_argument' companion is appended.
    filler: (ctx, out) => [
      out.document("Written_arguments", "Written Arguments.md", () => renderWrittenArguments(ctx, "form")),
      out.document("Evidence_index", "Evidence Index.md", () => renderEvidenceIndex(ctx)),
      ...out.witnessStatements(),
    ],
  },
  {
    venue: BCSC,
    kind: "notice_of_application",
    filler: (ctx, out) => [
      out.document("Notice_of_application", "Notice of Application.md", () => renderNoticeOfApplication(ctx)),
      ...supportingAffidavits(ctx, out),
    ],
  },
  {
    venue: BCSC,
    kind: "requisition_default_judgment",
    filler: (ctx, out) => [
      out.document("Requisition", "Form 17 Draft Requisition.md", () => renderRequisitionDefaultJudgment(ctx)),
      out.document("Default_judgment", "Form 8 Default Judgment.md", () => renderForm8DefaultJudgment(ctx)),
    ],
  },
  {
    venue: BCSC,
    kind: "requisition_consent",
    filler: (ctx, out) => [
      out.document("Requisition", "Requisition for Consent Order.md", () => renderRequisitionConsent(ctx)),
      out.document("Consent_order", "Consent Order.md", () => renderConsentOrder(ctx)),
    ],
  },
  {
    venue: BCSC,
    kind: "application_response",
    filler: (ctx, out) => [
      out.document("Application_response", "Application Response.md", () => renderApplicationResponse(ctx)),
      ...supportingAffidavits(ctx, out),
    ],
  },
  {
    venue: BCCA,
    kind: "bcca_stay_response",
    // Like VanIAC (#380 item 5), the written argument inside the response book IS the substantive
    // venue document (#436).
    filler: (ctx, out) => [out.document("Response_book", "Response Book.md", () => renderBccaStayResponse(ctx))],
  },
  {
    venue: BCCA,
    kind: "bcca_factum",
    // The factum IS the substantive venue document too (#648).
    filler: (ctx, out) => [out.document("Factum", "Factum.md", () => renderBccaFactum(ctx))],
  },
];

/** Every registered venue key plus kind. */
export const REGISTERED_FILLERS: readonly FillerKey[] = FILLERS.map(({ venue, kind }) => ({ venue, kind }));

/** How the registry names a filler in a refusal. */
export function fillerName(key: FillerKey): string {
  return `${key.venue} + ${key.kind}`;
}

export interface TypeFile {
  /** The type file's knowledge path, e.g. `draft/CAN/BC/BCSC/Documents/notice-of-application.md`. */
  file: string;
  /** Its validated layout block. */
  block: Record<string, unknown>;
}

function readShipped(path: string, seams: KnowledgeSeams): string {
  const kp = parseKnowledgePath(path, "type file lookup");
  const { layer } = shippedLayer(kp.skill as string, kp.rest, seams);
  try {
    return readFileSync(layer.abs, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    throw new DataServerError(`${path}: not in /draft's shipped knowledge tree (${layer.abs})`, "type_file_missing");
  }
}

/**
 * The type file for a venue key and a stored kind, from /draft's shipped tree, its layout block
 * validated. Fails hard on a venue key that is not three segments, a venue with no kinds index, a
 * kind no row (or more than one) lists as an alias, and a block the validator refuses.
 */
export function resolveTypeFile(venue: string, kind: string, seams: KnowledgeSeams = {}): TypeFile {
  const segments = venue.split("/");
  if (segments.length !== 3 || segments.some((segment) => segment === "")) {
    throw new DataServerError(`forum "${venue}" is not a knowledge-tree key <Country>/<Jurisdiction>/<Venue>`, "invalid_forum");
  }
  const noVenue = segments[2] === NO_VENUE;
  const documents = `draft/${venue}/Documents`;
  const indexPath = `${documents}/kinds.json`;
  let doc: unknown;
  try {
    doc = JSON.parse(readShipped(indexPath, seams));
  } catch (err) {
    if (err instanceof DataServerError) throw err;
    throw new DataServerError(`${indexPath}: not valid JSON: ${(err as Error).message}`, "invalid_index");
  }
  const rows = mergeKinds({ doc, file: indexPath }, null, noVenue).kinds.filter((row) => row.aliases.some((alias) => alias.name === kind));
  if (rows.length !== 1) {
    throw new DataServerError(
      `${indexPath}: ${rows.length === 0 ? "no row lists" : `${rows.length} rows list`} kind "${kind}" as an alias` +
        `${rows.length === 0 ? "" : ` (${rows.map((row) => row.file).join(", ")})`}; a stored kind names exactly one type file`,
      "kind_unresolved"
    );
  }
  const file = `${documents}/${rows[0].file}.md`;
  const block = extractJsonBlock(readShipped(file, seams), file, true);
  validateTypeBlock(block, file, { noVenue });
  return { file, block: block as Record<string, unknown> };
}

/**
 * Compose: the filler a Writing renders through. A bespoke type with no registered filler fails
 * hard, naming the venue, the kind and the missing filler. A general type has no filler: it
 * renders from its stored layout, so composing one fails hard too.
 */
export function composeFiller(venue: string, kind: string, seams: KnowledgeSeams = {}): TypeFile & { filler: Filler } {
  const type = resolveTypeFile(venue, kind, seams);
  if (type.block.renderer !== "bespoke") {
    throw new DataServerError(
      `${type.file}: renderer "${type.block.renderer}" has no filler; a general type renders from the Writing's stored layout snapshot, never through compose`,
      "no_renderer"
    );
  }
  const registered = venue.split("/")[2] === NO_VENUE ? undefined : FILLERS.find((entry) => entry.venue === venue && entry.kind === kind);
  if (registered === undefined) {
    throw new DataServerError(
      `${type.file} declares renderer "bespoke", but no filler is registered for venue ${venue}, kind ${kind}: ` +
        `the missing filler is "${fillerName({ venue, kind })}"`,
      "no_filler"
    );
  }
  return { ...type, filler: registered.filler };
}

/**
 * The kind a new Writing of a bespoke type stores: the first candidate that render's own resolver,
 * composeFiller, takes to the same type file. create_writing passes the kind as given, then the
 * resolved row's aliases, so a file stem such as `notice-of-application` is stored as the alias the
 * filler is registered under. Refuses kind_unresolved, naming the kinds render accepts at the
 * venue, when no candidate resolves; any other composeFiller failure propagates.
 */
export function rendererKind(venue: string, typeFile: string, candidates: readonly string[], seams: KnowledgeSeams = {}): string {
  for (const kind of candidates) {
    try {
      if (composeFiller(venue, kind, seams).file === typeFile) return kind;
    } catch (err) {
      if (!(err instanceof DataServerError && (err.code === "kind_unresolved" || err.code === "no_filler"))) throw err;
    }
  }
  const accepted = FILLERS.filter((entry) => entry.venue === venue).map((entry) => entry.kind);
  throw new DataServerError(
    `${typeFile} declares renderer "bespoke", but render accepts none of ${candidates.map((kind) => `"${kind}"`).join(", ")} for it; ` +
      `the kinds render accepts at ${venue} are ${accepted.length > 0 ? accepted.join(", ") : "none"}`,
    "kind_unresolved"
  );
}
