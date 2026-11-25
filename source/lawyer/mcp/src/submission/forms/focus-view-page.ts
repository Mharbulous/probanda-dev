// drafting_forms__focus_view_page: points the open Arguments page at one card (../../page-api/focus.ts).
// The number is checked against the board's own data, built as the page builds it, so a session
// cannot point at a card the page does not have. It reports nothing about the page itself.

import { ValidationError } from "../../errors.js";
import { FOCUS_SECTIONS, type FocusSection, writeFocus } from "../../page-api/focus.js";
import { buildArgumentsData } from "./arguments-page.js";
import { BoardIndex, sameBoard } from "./board-members.js";
import { fetchFiling, isJobOnlyBoard } from "./query.js";

export interface FocusViewPageArgs {
  db_path: string;
  filing_id: number;
  page: "Arguments";
  section: FocusSection;
  /** The argument number, as the card's tag shows it (#2, or #2 for Rebuttal #2.a). Exactly one of number and item. */
  number?: number;
  /** The card's `arguments` row id. */
  item?: number;
}

export function submissionFormsFocusViewPage(args: FocusViewPageArgs, env: NodeJS.ProcessEnv = process.env): { focused: true; section: FocusSection; number: number; note: string } {
  if (args.page !== "Arguments") throw new ValidationError("Only the Arguments page can be pointed at a card.", "unsupported_page");
  if (!FOCUS_SECTIONS.includes(args.section)) throw new ValidationError(`section must be one of ${FOCUS_SECTIONS.join(", ")}.`, "invalid_section");
  const filing = fetchFiling(args.db_path, args.filing_id);
  // The page's Writings: every live Writing drawn on this filing's board, as a merged board's page holds them.
  const index = new BoardIndex(args.db_path);
  const board = index.survivorOf({ filing_id: filing.id, proceeding_id: filing.proceeding_id });
  const writings = index.filings
    .filter((f) => sameBoard(index.survivorOf({ filing_id: f.id, proceeding_id: f.proceeding_id }), board))
    .map((f) => fetchFiling(args.db_path, f.id))
    .filter((f) => !f.retired_on &&!isJobOnlyBoard(f));
  if (writings.length === 0) throw new ValidationError("That board holds no live Writing, so it has no Arguments page.", "no_page");
  const data = buildArgumentsData(args.db_path, writings);
  const cards = data[args.section];
  if ((args.number === undefined) === (args.item === undefined)) throw new ValidationError("Pass exactly one of number and item.", "invalid_target");
  const card = args.item !== undefined ? cards.find((c) => c.id === Number(args.item)) : cards.find((c) => c.number === args.number);
  if (card === undefined || card.number === null) {
    throw new ValidationError(`The ${args.section} tab has no card for ${args.item !== undefined ? `argument id ${args.item}` : `#${args.number}`}.`, "no_such_card");
  }
  const number = card.number;
  writeFocus(args.db_path, args.filing_id, args.section, number, env);
  return {
    focused: true,
    section: args.section,
    number,
    note: "An open Arguments page that can reach the data server opens this number within a few seconds. Whether it moved is not known here.",
  };
}
