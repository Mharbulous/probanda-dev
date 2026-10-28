// The /housekeeping approval page (spec Part A2/A3, §B7.2, §B7.5), rendered whole from
// proposal.json. Self-contained: inline CSS and script, no external request (the server's CSP
// enforces it). Every value from the proposal reaches the DOM through textContent, never as HTML.
// Look and structure follow the committed mockup 2026-09-25_housekeeping-approval-page-mockup.html.
//
// One line per offered row, grouped by action: the file, an arrow, the one proposed action, and a
// radio pair, Approve and Leave as is, starting on Leave as is. A `stuck` or `misfiled` row is
// information only: no radio pair, no group box, and not counted. The page posts one entry per
// approved row, keyed by row id, carrying `approve: true` and nothing else; none at all is a valid
// approval. After approval it renders read-only.
//
// The page, its stylesheet and its script are template files under ./templates (map #125, #137).
// The stylesheet is the mockup's: the Milestone / Litigation Strategy palette and system font
// stack, dark mode through prefers-color-scheme, a sticky footer tally. The script keeps plain
// ES5-style strings: no backticks.

import { type ComposedTemplate, composeTemplate, type TemplateSet } from "../compose-template.js";
import { ACTION_GROUPS, type Approval, INFORMATION_ONLY, type Proposal } from "./proposal.js";
import approvalCss from "./templates/approval.css.js";
import approvalHtml from "./templates/approval.html.js";
import approvalJs from "./templates/approval.js.js";

export const APPROVAL_TEMPLATE: TemplateSet = {
  entry: "approval.html",
  files: { "approval.html": approvalHtml, "approval.css": approvalCss, "approval.js": approvalJs },
};

const PAGE = composeTemplate(APPROVAL_TEMPLATE.entry, APPROVAL_TEMPLATE.files);
const CSS = "\n" + approvalCss + "\n";

/** `page` is the composed template, a preview's own in place of the page's. */
export function renderApprovalPage(proposal: Proposal, approval: Approval | null, page: ComposedTemplate = PAGE): string {
  const data = JSON.stringify({ proposal, approval, groups: Object.entries(ACTION_GROUPS), info: INFORMATION_ONLY }).replace(/</g, "\\u003c");
  const matter = proposal.matter_root.split(/[\\/]/).filter(Boolean).pop() ?? proposal.matter_root;
  // The matter name goes in the title, just before its closing tag.
  const titleEnd = page.head.indexOf("</title>");
  if (titleEnd < 0) throw new Error("the approval page's template has no </title> before its data marker");
  return page.head.slice(0, titleEnd) + escapeHtml(matter) + page.head.slice(titleEnd) + data + page.tail;
}

/** The page shown for a token that no longer works. */
export function stalePage(): string {
  return simplePage(
    "This page is out of date",
    "A newer housekeeping run has started for this matter, or the Claude session that made this page has ended. Nothing was approved from it. Go back to Claude."
  );
}

export function simplePage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${CSS}</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p></main></body></html>
`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
