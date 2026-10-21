// housekeeping__preview (map #125; contract #138, built #142): the approval page rendered with a
// session's overrides in place of its template files (APPROVAL_TEMPLATE; pages__template serves
// their text), against the placeholder fixture or one run's real proposal. It writes the preview and
// returns its path, never its HTML (src/pages/preview-file.ts).
//
// A fixture preview goes in the fixture preview folder, before approval or, with `approved`, after.
// A real-data preview goes in the run's own folder, drawing the run's proposal and its approval as
// recorded. Its Approve button posts to no server, so a click approves nothing. The fixture's
// matter_root is a bare folder name, so it is drawn directly, never through validateProposal.

import { fixturePreviewDir, composeWithOverrides, writePreview } from "../pages/preview-file.js";
import { HOUSEKEEPING_FIXTURE } from "./fixture.js";
import { APPROVAL_TEMPLATE, renderApprovalPage } from "./page.js";
import { existingRunDir, openMatter, readApproval, requireProposal } from "./run-dir.js";
import { ValidationError } from "../errors.js";

const BASE = "Housekeeping approval";

export interface HousekeepingPreviewArgs {
  overrides?: Record<string, string>;
  data: "fixture" | "real";
  approved?: boolean;
  matter_root?: string;
  run_id?: string;
}

export function housekeepingPreview(args: HousekeepingPreviewArgs): { path: string } {
  const composed = composeWithOverrides(APPROVAL_TEMPLATE, args.overrides);
  if (args.data === "fixture") {
    if (args.matter_root !== undefined || args.run_id !== undefined) throw new ValidationError("fixture data takes no matter_root or run_id");
    const { proposal, approval } = HOUSEKEEPING_FIXTURE;
    return { path: writePreview(fixturePreviewDir(), BASE, renderApprovalPage(proposal, args.approved ? approval : null, composed), true) };
  }
  if (args.matter_root === undefined || args.run_id === undefined) throw new ValidationError("real data needs matter_root and run_id");
  if (args.approved !== undefined) throw new ValidationError("real data draws the run's approval as recorded: it takes no approved");
  const matter = openMatter(args.matter_root);
  const runDir = existingRunDir(matter, args.run_id);
  const html = renderApprovalPage(requireProposal(runDir, args.run_id, matter.root), readApproval(runDir, args.run_id).approval, composed);
  return { path: writePreview(runDir, BASE, html, false) };
}
