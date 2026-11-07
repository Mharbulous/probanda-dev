// Byte-identity pins for the housekeeping approval page's move to template files (map #125, #137).
// Each hash was taken from the inline-string page.ts before the move. A mismatch reports the two
// hashes only, never the page.

import test from "node:test";
import { assertSha256Pin } from "./helpers/sha256-pin.mjs";

const { renderApprovalPage, simplePage, stalePage } = await import("../build/housekeeping/page.js");

const H = "b".repeat(64);
const row = (id, action, extra) => ({
  row_id: id,
  current_path: "3. CORRESPONDENCE\\" + id + ".pdf",
  hash: H,
  ingest_outcome: "ingested",
  source_ids: [],
  section: "offered",
  action,
  name_checks: [],
  notes: [],
  ...extra,
});
const NAME = "2026-01-05 LF Smith re Offer <draft>.pdf";

/** Every action kind, a `<` and `</script>` in the data, and HTML specials in the matter name. */
const proposal = {
  run_id: "20260924-100000-pin1",
  matter_root: "C:\\Matters\\O'Brien & <Sons> \"Ltd\"",
  created_at: "2026-09-24T20:40:13.000Z",
  header: { open_in_word: ["open.docx"], folders_not_looked_inside: ["Old </script> stuff"], finished_line: "Finished 2 files." },
  folders: [{ path: "3. CORRESPONDENCE", exists: true }],
  draft_folder: "0. DRAFT",
  rows: [
    row("file", { kind: "file", name: NAME, folder: "3. CORRESPONDENCE", create_folder: true }),
    row("rename", { kind: "rename", name: NAME }),
    row("move", { kind: "move", folder: "6. LAW", file_no_ingest: true }),
    row("draft", { kind: "draft" }),
    row("dup", { kind: "duplicate" }, { twin: { path: "x.pdf", ingested: true } }),
    row("brown", { kind: "misfiled", matter: "L998" }),
    row("scan", { kind: "unreadable" }, { ingest_outcome: "failed" }),
    row("stuck", { kind: "stuck", reason: "no rule — yet" }),
    row("q", { kind: "file", name: NAME, folder: "3. CORRESPONDENCE", answer: "Counterclaim", final: true }),
    row("done", undefined, { section: "ingested_only", notes: ["stored as privileged"] }),
    row("later", undefined, { section: "deferred" }),
  ],
  rule_gaps: [],
};
const approval = { run_id: proposal.run_id, approved_at: "2026-09-24T21:00:00.000Z", rows: [{ row_id: "file", approve: true }] };

// Re-pinned 2026-11-06: the page's script retries Submit once on a network error (local-page move).
test("the approval page renders byte-identically to the inline page.ts it replaced", () => {
  assertSha256Pin(renderApprovalPage(proposal, null), "046b4cf5d4faeb2e8d610d6549cb60583f3fda58e1d1df03f6d3770cdf265d13", "renderApprovalPage(open)");
  assertSha256Pin(renderApprovalPage(proposal, approval), "682ea3097b07f2e2a891b37b0a208b9fd3c7e613dcfb660c0756773e719986fa", "renderApprovalPage(approved)");
  assertSha256Pin(renderApprovalPage({ ...proposal, matter_root: "/" }, null), "08f61d900f53350308acace453322d1c21c6b6b82b5eea242aff2925ee9525d8", "renderApprovalPage(root matter)");
});

// Re-pinned 2026-11-07: the stale page now says the link expires when a newer run is served or after 30 days (4bddcf6).
test("the simple pages render byte-identically to the inline page.ts they replaced", () => {
  assertSha256Pin(stalePage(), "6d1332fe5fd40318738a33ecf78e5a2616a90303a1141c1cd6a634ee1a59bebd", "stalePage");
  assertSha256Pin(simplePage("A <b> & \"c\"", "It's <gone>."), "f0582f75fcbd30c02b3804361ac6489a6941566ca265fc402ebede0781e7b984", "simplePage");
});
