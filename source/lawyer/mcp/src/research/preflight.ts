// research__preflight: the /legal-research dependencies this runtime can see, checked before any
// research dispatch so a missing one is named once, up front, instead of when the step that needs
// it fails. Read-only, no arguments, no matter content. CanLII's key and the pooled layer's
// credential are not checked here: their status tools belong to other servers, and /legal-research's
// step 0 calls them beside this one (spec 2026-10-06_research-preflight-dependency-check §12).
//
// Each probe reuses the path the real step takes, so the report cannot drift from it: the extractor
// through extractDocuments (the same call research_filing__law_folder_text makes), the knowledge
// tree through knowledgeList (the same call law-getter's publisher-map lookup makes).

import { tmpdir } from "node:os";
import { join } from "node:path";

import { knowledgeList } from "../knowledge/tools.js";
import type { KnowledgeSeams } from "../knowledge/tree.js";
import { extractDocuments, type ExtractedDocument } from "../submission/pre-filing/extract.js";

export type PreflightRow = "extractor.pdf" | "extractor.docx" | "knowledge_tree";

export interface PreflightIssue {
  row: PreflightRow;
  /** The failing call's own message, verbatim. */
  detail: string;
  /** What the research run loses while this row is not ok. */
  caps: string;
  fix: string;
}

export interface PreflightResult {
  extractor: { pdf: "ok" | "missing"; docx: "ok" | "missing" };
  knowledge_tree: "ok" | "error";
  /** Westlaw reachability is law-getter's own hard stop, never probed here. */
  chrome: "not_checked";
  issues: PreflightIssue[];
}

export interface PreflightSeams extends KnowledgeSeams {
  /** Test seam only: replaces the host-Python extraction call. */
  extract?: (paths: string[]) => ExtractedDocument[];
}

// A path that never exists. The extractor imports its PDF library before it opens the file, so a
// missing library fails the whole call, while a working one reports only this file unreadable.
const PROBE_STEM = join(tmpdir(), "coclerk-research-preflight-probe-absent");

const CAPS: Record<PreflightRow, string> = {
  "extractor.pdf": "every PDF in 6. LAW comes back UNREAD, so the audit cannot read it",
  "extractor.docx": "every .docx in 6. LAW comes back UNREAD, so the audit cannot read it",
  knowledge_tree: "law-getter cannot read its publisher map, so no statute text is retrieved",
};

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function probeExtractor(ext: ".pdf" | ".docx", extract: (paths: string[]) => ExtractedDocument[]): string | null {
  try {
    extract([PROBE_STEM + ext]);
    return null;
  } catch (err) {
    return errorText(err);
  }
}

function extractorFix(detail: string): string {
  return /pip install pypdf/.test(detail)
    ? "Run `pip install pypdf` for the Python the detail names. No restart is needed."
    : "Install Python 3, or set COCLERK_PYTHON to a Python that has pypdf.";
}

export function researchPreflight(seams: PreflightSeams = {}): PreflightResult {
  const extract = seams.extract ?? extractDocuments;
  const issues: PreflightIssue[] = [];

  const pdf = probeExtractor(".pdf", extract);
  if (pdf !== null) issues.push({ row: "extractor.pdf", detail: pdf, caps: CAPS["extractor.pdf"], fix: extractorFix(pdf) });
  const docx = probeExtractor(".docx", extract);
  if (docx !== null) issues.push({ row: "extractor.docx", detail: docx, caps: CAPS["extractor.docx"], fix: extractorFix(docx) });

  let tree: string | null = null;
  try {
    knowledgeList({ dir: "legal-research" }, seams);
  } catch (err) {
    tree = errorText(err);
  }
  if (tree !== null) {
    issues.push({ row: "knowledge_tree", detail: tree, caps: CAPS.knowledge_tree, fix: "Do what the detail says: it names the file and the setting." });
  }

  return {
    extractor: { pdf: pdf === null ? "ok" : "missing", docx: docx === null ? "ok" : "missing" },
    knowledge_tree: tree === null ? "ok" : "error",
    chrome: "not_checked",
    issues,
  };
}
