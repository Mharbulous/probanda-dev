// Filed-face transform for the submission form renderers (build ticket
// #359). Issue #358's design: the filed face is "the same documents as the
// mockup minus everything human-side -- work markers, Held in reserve,
// human-side subsections, source traces, HTML comments." One shared render
// pass builds each document's mockup content (render-documents.ts
// and friends); this module strips that markdown down to the filed face
// rather than threading a second render path through every renderer call
// site -- see forms.ts's submissionFormsRender for where render_mode
// selects this. Generic across filing kinds on purpose: renderSubmissionBody
// (the Held-in-reserve-producing helper) is shared between the VanIAC
// written argument and the BCSC Notice of Application's Part 3 (#321), so a
// VanIAC-only transform would silently leak reserved material on the BCSC
// side the day someone reaches for render_mode there.

import { fenceStep } from "./fence.js";
import { ALL_MARKER_GLYPHS, MOCKUP_ONLY_TAG } from "./markers.js";

// Frontmatter is always exactly the components.ts frontmatterHeader() block:
// a leading "---" line, the fixed fields, then any optional fields, some of
// them multi-line YAML lists, and a closing "---" line. The match runs lazily
// to the first line that is exactly "---", so no field value may be one.
// Practitioner-facing metadata (matter, client and Writing identity, revision,
// rendered timestamp, review lists) -- not exchanged text.
const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/;

// Every id-trace HTML comment the renderers append (the per-row
// `<!-- fact N -->` style traces).
const HTML_COMMENT_RE = /[ \t]*<!--[\s\S]*?-->/g;

// A whole work-message line the renderer tagged with mockupMessage (markers.ts). Must run before
// HTML_COMMENT_RE, which would strip the tag and leave the bare sentence behind.
export const MOCKUP_ONLY_LINE_RE = new RegExp(`^.*${MOCKUP_ONLY_TAG}[ \\t]*\\n?`, "gm");

// A whole gap line, the marker and a blank underline with its description in a comment
// (projections.ts gap: `🧩 ________ <!-- signer not chosen -->`). Must run before HTML_COMMENT_RE,
// which would strip the comment and leave a stray underline behind.
export const GAP_LINE_RE = /^🧩 _+ <!-- (.*) -->[ \t]*\n?/gm;

// Mockup-only sections, heading through to the next heading of the same or shallower level
// (or EOF). These headings are literal strings emitted only by these renderers, at whatever
// level that renderer nests them -- stripSections below matches at any level 2-6, since the
// BCCA response book emits "Positions not yet taken" as #### (it sits inside "### Part 2:
// Issues"), not the ## every other kind uses.
// "Held in reserve" retired (#380/#384): reserved material is derived, never
// queried onto a form/Written-Arguments document at all -- it prints on no
// face (forms.ts records its Proposals only, with no document).
// No renderer emits this heading any more.
const MOCKUP_ONLY_HEADINGS = [
  "Source trace",
  "Facts attributed to this witness, not yet in this statement",
  "Opposing points",
  // Application Response (build #386): opposing_orders with no filing_positions row for this
  // filing -- belt-and-suspenders, since Form 33's real filed face comes from the separate
  // assembly-mode emitter (assembly-application-response.ts), not this transform. BCCA stay
  // response (renderer compliance fix following #436): emitted as #### inside "### Part 2:
  // Issues" -- stripSections' level-aware matching handles both without a kind-specific branch.
  "Positions not yet taken",
  // BCCA factum (#648): opposing points no submission answers yet, the Enactments appendix's
  // held-back court rules, and the page budget estimate.
  "Points not yet answered",
  "Court rules not in this appendix",
  "Page budget",
  // The general renderer's Layout confirmation, Blind copies, Authorities cited and Page budget are
  // optional header fields (render-general.ts), which FRONTMATTER_RE drops with the header.
  // The legend of the symbols on a mockup, its last section (forms/legend.ts).
  "Legend",
];

// Human-side inline tags -- text, not glyphs, so the glyph strip alone
// would miss them. Order matters: these run before the glyph strip, since
// two of them still carry their glyph at match time. Then the general
// renderer's confirmation tags on a cited layout item, and the `terms`
// projection's tag on a clause citing a killed authority's statement, which
// would tell the forum what the practitioner rejected, and its statute-currency
// tag on a clause naming an enactment not shown `current` (the filed render
// refuses on that one first, forms.ts). Last, a proposition line's overruled
// tag (#1202): titles and citations carry both brackets and parentheses, so the
// match runs lazily to the ")" that immediately precedes ⛔ -- it depends on ⛔
// leading the line's markers (submission-paragraphs.ts), still present here
// because this runs before the glyph strip. After it, the failed-scrutiny tag
// (schema v46) on a proposition or clause line: a finding is free text and can
// hold parentheses, so the match runs greedily to the line's last ")". The tag
// is the last text before the line's markers, which hold none, and the
// overruled tag that may follow it on a proposition line is already gone. The
// settled tag (schema v47) runs with the killed tag, before the glyph strip like
// the others: a settled statement prints on the filed face, its tag never does.
// The contention line's no-stated-fact-needed tag (schema v48) runs beside it, on
// the same footing: the contention reaches the filed face, counsel's tag never does.
// The no-stated-law-needed tag (schema v60) runs beside the v48 one, on the same footing.
// The note-up tag (schema v51) runs after the failed-scrutiny tag: it is the last
// text on a statement's citation line, after any settled tag, and a note is free
// text that can hold parentheses, so the match runs greedily to the line's last ")".
// The quoting tag (schema v61) runs first: it sits right after a statement's
// pinpoint, before every other tag, so it runs lazily to the first ")" that ends
// the line or starts the next tag. A verified statement prints on the filed face;
// whose words its excerpt is, is for the human and never for the forum.
// Last, a rhetorical paragraph's label and its two advisory tells (schema v71,
// render-rhetoric.ts), on the same footing as the v48 tag: the paragraph's
// wording reaches the filed face, its label and tells never do.
const INLINE_TAG_RES: RegExp[] = [
  / \(quoting .*?\)(?= \(|\r?$)/gm,
  / \[facts [^\]]*\]/g,
  / 🧩 \[GAP -- no fact linked\]/g,
  / \[PRACTITIONER — total exceeds the Rule 24\(j\) cap; Rule 24\(h\) consent position required\]/g,
  / \[unverified: [^\]]*\]/g,
  / \[source changed: [^\]]*\]/g,
  / \(killed \d{4}-\d{2}-\d{2}\)/g,
  / \(settled by counsel \d{4}-\d{2}-\d{2} over scrutiny finding\)/g,
  / \(no stated fact needed, per counsel \d{4}-\d{2}-\d{2}\)/g,
  / \(no stated law needed, per counsel \d{4}-\d{2}-\d{2}\)/g,
  / \[currency: [^\]]*\]/g,
  / \(overruled: .*?\)(?= ⛔)/g,
  / \(scrutiny failed: .*\)/g,
  / \(note-up: .*\)/g,
  / \(rhetorical\)/g,
  / \(states law, no authority linked\)/g,
  / \(states fact beyond its record\)/g,
];

// Whole human-side message lines -- dropping just the glyph would leave
// bare prose that reads as a real (and wrong) assertion, so these are
// removed as complete lines. The general renderer's gap lines go by GAP_LINE_RE.
const MESSAGE_LINE_RES: RegExp[] = [
  /^🧩 no facts attributed to this witness$/m,
];

// Crossed-out paragraphs (order_sought.crossed_out_on, schema v10 #380):
// rendered inline on the venue form and the Written Arguments, mockup-only,
// as a single line wholly wrapped in ~~...~~ -- deliberately no glyph
// (work-markers.md rule 5: "crossed out ... not a marker -- strikethrough
// styling is its rendering"). Every delivered face omits the whole line,
// live paragraphs renumbering contiguously (terms-and-symbols.md's Deployment/
// Rendering rule -- "delivered whole minus mockup-only material"). Every
// renderer that emits a crossed-out line puts its entire visible content
// (wording, and any "-- supports order N" reference) inside the one ~~ span,
// so a whole-line match is sufficient; a cascade-struck submission likewise
// renders its struck contention line only, never a multi-line body, for the
// same reason. Run after the HTML-comment strip, so a struck line's own
// id-trace comment doesn't save it from this match.
//
// 🂡 (held-in-reserve), 🤥 (impeachment), and 🚩 (adverse, #390/#401) need no
// matching strip here: no renderer prints any of the three
// (#370). They stay in ALL_MARKER_GLYPHS as belt-and-suspenders.
//
// Residual risk, accepted (mirrors the glyph-in-verbatim-excerpt risk noted
// below): a tilde-wrapped span inside a verbatim-quoted excerpt of someone
// else's source text would strip too if it happens to occupy a whole line.
const STRUCK_LINE_RE = /^[ \t]*~~.*~~[ \t]*\n?/gm;

// Level-aware: a MOCKUP_ONLY_HEADINGS entry can appear at any markdown heading level (the BCCA
// response book emits "Positions not yet taken" as #### since it sits inside "### Part 2:
// Issues", not ##). A single hardcoded "## " lookahead would either miss a deeper heading
// entirely or, if widened blindly, swallow sibling ## sections after a nested ### one. Instead
// each match records its own level N and strips through to the next heading of level <= N (or
// EOF) -- for an existing level-2 section this reproduces the old "next ## " behavior exactly,
// since a level-2 section's own ### subheadings all have level > 2 and stay swallowed.
function stripSections(markdown: string): string {
  let out = markdown;
  for (const heading of MOCKUP_ONLY_HEADINGS) {
    const startRe = new RegExp(`\\n(#{2,6}) ${heading}\\n`);
    for (;;) {
      const start = out.match(startRe);
      if (!start || start.index === undefined) break;
      const level = start[1].length;
      const afterHeadingStart = start.index + start[0].length;
      const nextRe = new RegExp(`\\n#{1,${level}} `, "g");
      nextRe.lastIndex = afterHeadingStart;
      const next = nextRe.exec(out);
      const end = next ? next.index : out.length;
      out = out.slice(0, start.index) + out.slice(end);
    }
  }
  return out;
}

function stripGlyphs(markdown: string): string {
  let out = markdown;
  for (const glyph of ALL_MARKER_GLYPHS) {
    out = out.split(glyph).join("");
  }
  return out;
}

// Fenced verbatim-excerpt blocks are exact quotes -- never touched by the
// whitespace cleanup below, which exists only to tidy up the gaps a glyph
// or comment strip leaves in ordinary prose/table lines.
function tidy(markdown: string): string {
  let open = "";
  const lines = markdown.split("\n").map((line) => {
    const step = fenceStep(open, line);
    const inFence = open !== "";
    open = step.open;
    if (step.fence || inFence) return line;
    if (line.trim() === "") return "";
    // Collapse the whitespace runs a stripped glyph or tag leaves behind
    // (e.g. "(admission   )" -> "(admission)") without touching leading
    // indentation -- the renderer's numbered-list continuation lines carry
    // meaningful leading spaces (matching the "1. " prefix width) that a
    // blind whole-line collapse would flatten to one space.
    const match = line.match(/^(\s*)(.*)$/s);
    const [, lead, rest] = match ?? ["", "", line];
    const collapsedRest = rest
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\( /g, "(")
      .replace(/ \)/g, ")")
      .replace(/[ \t]+$/, "");
    return lead + collapsedRest;
  });
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd() + "\n";
}

/**
 * The mockup's document minus everything human-side (#358): the frontmatter
 * stamp block, HTML comment id-traces, work-marker glyphs, mockup-only
 * sections (Source trace / Facts attributed... / Opposing points), any
 * inline crossed-out (~~...~~) line rendered outside those sections (#380 --
 * a struck order/submission on the venue form or the Written Arguments), and
 * the handful of human-side inline/whole-line tags a glyph strip alone would
 * miss. Deliberately kept: fenced verbatim-excerpt blocks, the Evidence
 * Index's placeholder text ("(not recorded)", "undated"), and blank
 * signature lines -- none of that is a work marker.
 *
 * Residual risk, accepted: a marker glyph, a literal "<!--", or a tilde-
 * wrapped span inside a verbatim-quoted excerpt of someone else's source
 * text would strip too. The pictograph-leak scan (test/filed-face.test.mjs)
 * catches a *missing* glyph in ALL_MARKER_GLYPHS; it cannot catch this
 * converse case, which would need a real occurrence to surface.
 */
export function toFiledFace(markdown: string): string {
  let out = markdown.replace(FRONTMATTER_RE, "");
  out = out.replace(MOCKUP_ONLY_LINE_RE, "");
  out = out.replace(GAP_LINE_RE, "");
  out = out.replace(HTML_COMMENT_RE, "");
  out = stripSections(out);
  for (const re of INLINE_TAG_RES) out = out.replace(re, "");
  for (const re of MESSAGE_LINE_RES) out = out.replace(re, "");
  out = out.replace(STRUCK_LINE_RE, "");
  out = stripGlyphs(out);
  return tidy(out);
}
