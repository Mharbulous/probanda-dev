// board_card's lanes as text: the goals, criteria, attached and court file lanes, and
// the card that joins them with board-summary.ts's live lane (board-card.ts is the entry point).

import { collapsedText, derivedOf, generalTail, jobCardLines, proposalLines } from "./board-job-text.js";
import { criterionLine, jobsIn, proposedHeading, proposedOf, renderLiveLanes, shelvedHeading, shelvedProposalsOf } from "./board-summary.js";
import type { CourtFileAffidavit } from "./court-file-affidavits.js";
import type { LegalMemo, MemoSource, MemoStatus } from "./forms/legal-memos-page.js";
import { type AttachedDraft, type Category, type WorkBoardData } from "./forms/render-work-board.js";

const LIVE: ReadonlySet<Category> = new Set(["ready", "wip", "bring_forward", "waiting"]);

/** board_card's goals lane: `## Goal (<status>)`, the description, then the statement verbatim when
 * there is one; while the board needs consolidation, each earlier statement under
 * `### To combine <n> (<status>)`, n being its merged_index. */
function goalsLines(section: WorkBoardData): string[] {
  const g = section.goals;
  return [
    `## Goal (${g.status ?? "none"})`,
    g.description,
    ...(g.statement === null ? [] : [g.statement]),
    ...(g.to_combine ?? []).flatMap((m, i) => [`### To combine ${i + 1} (${m.status})`, m.statement]),
  ];
}

/** board_card's criteria lane: the head line and one line per criterion in board order, with items. */
function goalLines(section: WorkBoardData): string[] {
  if (section.goal === undefined) return [];
  const criteria = section.criteria ?? [];
  return [`🎯 Completion criteria: ${section.goal.state}${section.goal.text === null ? "" : ` — ${section.goal.text}`}`, ...criteria.map((c) => criterionLine(c, criteria, true))];
}

/** `goal` is the criteria lane's former name, still accepted for it; `goals` is the statement of goals. */
export type CardLane = "goals" | "criteria" | "live" | "goal" | "proposed" | "completed" | "rejected" | "attached" | "court_file" | "memos";

/** board_card's lanes, in the order a card prints them. */
export const CARD_LANES: readonly CardLane[] = ["goals", "criteria", "live", "proposed", "completed", "rejected", "attached", "court_file", "memos"];

const MEMO_SOURCE_LABELS: Record<MemoSource, string> = { research_memo: "research memo", westlaw: "Westlaw Deep Research report", note_up: "note-up record" };
const MEMO_STATUS_LABELS: Record<MemoStatus, string> = { in_progress: "in progress", started: "started", completed: "completed", shelved: "shelved", no_job: "no job" };

/** The memos lane: the Legal Memos page's memos (legal-memos-page.ts), newest first, as
 * `- <title> · <source> · <status> · <date> · v<n>[ (earlier: v<m>, …)] · <path from 6. LAW>[ · not in the law folder]`,
 * then `  issue: "<the job's question>"` per job question (`  issue: none (no job saved it)` with no job,
 * `  issue: none recorded` when its jobs recorded none), `  facts: "<fact>"; …` or `  facts: none`, and
 * `  jobs: #<id> <title>; …` when a job saved it. */
function memosLines(memos: LegalMemo[]): string[] {
  return [
    `## Legal Memos (${memos.length})`,
    ...memos.flatMap((m) => {
      const head = [`- ${m.title}`, MEMO_SOURCE_LABELS[m.source], MEMO_STATUS_LABELS[m.status], m.date ?? "no date"];
      head.push(`v${m.version}${m.earlier.length === 0 ? "" : ` (earlier: ${m.earlier.map((n) => `v${n}`).join(", ")})`}`, m.file);
      if (!m.on_disk) head.push("not in the law folder");
      return [
        head.join(" · "),
        ...(m.issues.length > 0 ? m.issues.map((i) => `  issue: ${JSON.stringify(i)}`) : [m.jobs.length === 0 ? "  issue: none (no job saved it)" : "  issue: none recorded"]),
        `  facts: ${m.facts.length === 0 ? "none" : m.facts.map((f) => JSON.stringify(f)).join("; ")}`,
        ...(m.jobs.length === 0 ? [] : [`  jobs: ${m.jobs.map((j) => `#${j.id} ${j.title}`).join("; ")}`]),
      ];
    }),
  ];
}

const ATTACHMENT_KIND_LABELS: Record<AttachedDraft["kind"], string> = { client_letter: "client letter", reply: "reply", opposing_filing: "opposing filing" };

/** The attached lane (schema v67, ADR 0042), the same fields as the page's cards: each draft attached
 * to the board, in id order, as `- attachment <id> · <code, or kind> · <stored path>`, then
 * ` · no Writing: shown on this proceeding's lowest-id live Writing's board` on a row of the
 * proceeding shown on a Writing's board, then its state: ` · missing`, ` · not in the draft folder`,
 * ` · unreadable (<code>)`, or ` · modified <date>` and on a client letter ` · review: <status>`
 * (`no review line` when its first line is none), then ` · pending: #<id>, …` or ` · pending: none`. */
function attachedLines(attached: AttachedDraft[]): string[] {
  return [
    `## Attached (${attached.length})`,
    ...attached.map((a) => {
      const parts = [`- attachment ${a.id}`, a.code ?? ATTACHMENT_KIND_LABELS[a.kind], a.path];
      if (a.code_error !== undefined) parts.push(`code check failed (${a.code_error})`);
      if (a.proceeding_wide) parts.push("no Writing: shown on this proceeding's lowest-id live Writing's board");
      if (a.state === "missing") parts.push("missing");
      else if (a.state === "outside") parts.push("not in the draft folder");
      else if (a.state === "unreadable") parts.push(`unreadable (${a.error ?? "error"})`);
      else {
        parts.push(`modified ${a.modified}`);
        if (a.kind === "client_letter") parts.push(`review: ${a.review ?? "no review line"}`);
      }
      parts.push(`pending: ${a.jobs.length === 0 ? "none" : a.jobs.map((j) => `#${j.id}`).join(", ")}`);
      return parts.join(" · ");
    }),
  ];
}

/** The court file lane: each affidavit the filing relies on, reconciled against the court-file folder's
 * names (court-file-affidavits.ts), as `- <label> · court file: <file name>` or `· court file: none found`
 * (with `(<note>)` when the folder could not be settled), then ` · mismatch: <text>` when the court file
 * and drafting data disagree. */
function courtFileLines(rows: CourtFileAffidavit[]): string[] {
  return [
    `## Court File (${rows.length})`,
    ...rows.map((a) => {
      const parts = [`- ${a.label}`, a.court_file === null ? `court file: none found${a.note ? ` (${a.note})` : ""}` : `court file: ${a.court_file.file_name}`];
      if (a.mismatch !== null) parts.push(`mismatch: ${a.mismatch}`);
      return parts.join(" · ");
    }),
  ];
}

/** The selected parts of a section in a fixed grammar: each job asked for in board order, then each
 * lane asked for in CARD_LANES order, then the key lookup. `attached` is the section's attachments
 * as found on disk, read only when the attached lane is asked for, and `memos` likewise. */
export function renderBoardCard(
  section: WorkBoardData,
  jobs: number[],
  lanes: CardLane[],
  key: string | undefined,
  attached: AttachedDraft[] = [],
  courtFile: CourtFileAffidavit[] = [],
  memos: LegalMemo[] = []
): string {
  const derived = derivedOf(section);
  const lines: string[] = [];
  for (const t of section.tickets) if (jobs.includes(t.id)) lines.push(...jobCardLines(t, derived, section.seeds, section.meta.rendered));
  for (const lane of CARD_LANES) {
    if (!lanes.includes(lane)) continue;
    // A Milestone with no Writing has no Proposals and no court file: those lanes print nothing, as its criteria lane does.
    if (section.meta.job_only && (lane === "proposed" || lane === "court_file")) continue;
    if (lane === "goals") lines.push(...goalsLines(section));
    if (lane === "criteria") lines.push(...goalLines(section));
    if (lane === "live") lines.push(...renderLiveLanes(section));
    if (lane === "proposed") lines.push(proposedHeading(section), ...proposedOf(section).flatMap(proposalLines));
    if (lane === "completed") lines.push(`## Completed (${jobsIn(section, "completed").length})`, ...jobsIn(section, "completed").map((t) => collapsedText(t) + generalTail(t)));
    if (lane === "rejected") lines.push(shelvedHeading(section), ...jobsIn(section, "rejected").map((t) => collapsedText(t) + generalTail(t)), ...shelvedProposalsOf(section).flatMap(proposalLines));
    if (lane === "attached") lines.push(...attachedLines(attached));
    if (lane === "court_file") lines.push(...courtFileLines(courtFile));
    if (lane === "memos") lines.push(...memosLines(memos));
  }
  if (key !== undefined) {
    const holder = section.tickets.find((t) => LIVE.has(t.category) && t.proposal_keys.includes(key));
    const proposal = section.proposals.find((p) => p.key === key);
    if (holder !== undefined) lines.push(...jobCardLines(holder, derived, section.seeds, section.meta.rendered));
    else if (proposal === undefined) lines.push(`(no job or Proposal carries ${key})`);
    else lines.push(proposal.lane === "rejected" ? shelvedHeading(section) : proposedHeading(section), ...proposalLines(proposal));
  }
  return lines.join("\n");
}
