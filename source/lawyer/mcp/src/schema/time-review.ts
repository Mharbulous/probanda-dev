import { BILL_BASIS, MATTER_BASIS } from "../time-review/flags.js";
import { GATE_SOURCES } from "../time-review/sources.js";
import type { ToolDefinition } from "./shared.js";

const ROUTE =
  " Only the /time-pipeline-data skill may call this tool -- see time_pipeline__get for how a caller from another skill's workflow satisfies that.";

// Day-evidence and block records on billing's `timekeeping` server (build plan slice 5). Code, not
// the reviewer, sets a block's flags and state from the bases the reviewer states.
export function timeReviewToolDefinitions(): ToolDefinition[] {
  const SOURCE = { type: "string", enum: [...GATE_SOURCES] };
  return [
    {
      name: "time_review__save_evidence",
      description:
        "Save one day's evidence as a day_evidence record (replacing any earlier save for the date). `sources` says what the gather step got from each of the assembly gate's seven sources: { source, status }, status being the fetch status filed for it (fetched, empty and skipped count as an outcome; anything else leaves the source short). `rows` are the day's evidence rows, each naming its `source`, which must be listed in `sources`. Returns { status: \"saved\", sha256, complete, short } -- short lists the sources with no outcome -- or { status: \"judged\", judged_at, judged_by } when the date is already judged, which writes nothing." + ROUTE,
      inputSchema: {
        type: "object",
        properties: {
          date: { type: "string" },
          sources: {
            type: "array",
            items: {
              type: "object",
              properties: { source: SOURCE, status: { type: "string" } },
              required: ["source", "status"],
              additionalProperties: false,
            },
          },
          rows: { type: "array", items: { type: "object", properties: { source: SOURCE }, required: ["source"] } },
        },
        required: ["date", "sources", "rows"],
        additionalProperties: false,
      },
    },
    {
      name: "time_review__stage_day",
      description:
        "Stage one day's reviewed blocks, holding the claim `token` that review_date__claim gave for the date. For each block state its start, end, matter, description, the basis of the matter (`matter_basis`, one value), what goes on the bill (`bill_basis`, a list that is empty when nothing is in doubt) and its evidence ({ source, ref }). Code sets the block's `flags` and `state` (flagged or auto_assigned) from the bases: you cannot pass either, and a block that states any doubtful value is always flagged. Staging again before the date is judged replaces the date's blocks. Returns { status: \"staged\", blocks: [{ id, state, flags }] }, or a refusal that writes nothing: judged, held (another run holds the claim), claim_lost (this token holds none), evidence_missing (no day_evidence saved for the date), evidence_short (a gate source has no outcome in it; `short` names them)." + ROUTE,
      inputSchema: {
        type: "object",
        properties: {
          date: { type: "string" },
          token: { type: "string" },
          blocks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                start: { type: "string" },
                end: { type: "string" },
                matter: { type: "string" },
                description: { type: "string" },
                matter_basis: { type: "string", enum: Object.keys(MATTER_BASIS) },
                bill_basis: { type: "array", items: { type: "string", enum: [...BILL_BASIS] } },
                evidence: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { source: SOURCE, ref: { type: "string" } },
                    required: ["source", "ref"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["start", "end", "matter", "description", "matter_basis", "bill_basis", "evidence"],
              additionalProperties: false,
            },
          },
        },
        required: ["date", "token", "blocks"],
        additionalProperties: false,
      },
    },
    {
      name: "time_review__read_day",
      description:
        "Read one day: { date, clear, evidence, blocks }. `clear` is true when the date is judged and no block on it is flagged. `evidence` is the saved day_evidence record, or null; `blocks` are the staged block records in order, each with its flags and state; `readings` holds the saved reading of each screenshot the blocks cite, by capture id (null where none is saved). A block made by a split and waiting for its redraft has `redraft.status` pending. Writes nothing and opens no image." + ROUTE,
      inputSchema: {
        type: "object",
        properties: { date: { type: "string" } },
        required: ["date"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: "time_review__serve_page",
      description:
        "Serve the time review page: a fixed page built from the stored blocks, day evidence and saved screenshot readings, with no model drawing it. It shows each block as a card (matter, description, times, state, flags, evidence rows, the screenshot slideshow with each saved reading) and has a date picker, a matter filter, Previous, Next and Next flagged, and on every card the Approve, Correct and Write off buttons, which save the act to the block through the page's own listener, and Split here (at a screenshot), Merge with next and Undo, which restructure the blocks the same way. `screens_dir` is the absolute path of the `syncopaid-screens` folder holding the decrypted PNGs; leave it out and the cards show no images. Returns { url, screenshots, blocks }: give the practitioner the url to open in Chrome on this PC. Serving drops every earlier page and any unread click. Does not open or read an image." + ROUTE,
      inputSchema: {
        type: "object",
        properties: { screens_dir: { type: "string" } },
        additionalProperties: false,
      },
    },
    {
      name: "time_review__wait_click",
      description:
        "Wait for a click on the served time review page. Returns { status: \"clicked\", act, block, clicked_at } for the oldest unread click (and marks it read), or { status: \"pending\", waited_ms } when about 45 seconds pass with none: call it again. The page's Approve, Correct and Write off buttons have already saved the act to the block when the click arrives here (`act` is approve, correct or write_off, `block` the block id). Read the block with time_review__read_day. After an approve or a correct, write a changed matter or description to TimeCamp, read the entry back and report the outcome with time_review__record_timecamp. A `split`, `merge` or `undo` click has also been saved already, by the page: `blocks` lists the blocks it made or restored. After a `split`, redraft both halves with time_review__redraft; a merge or an undo needs nothing from you, and none of the three touches TimeCamp." + ROUTE,
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "time_review__record_timecamp",
      description:
        "Save, on one block, how its write to TimeCamp went after the practitioner approved or corrected it on the page: `saved` (written and the read-back matched), `unchanged` (TimeCamp already held the block's matter and description), `staff_left_alone` (a staff entry: its TimeCamp note is the staff member's and is never changed) or `error` (the write failed or the read-back did not match; `message` is required and shows on the card). Refused for a block no click has approved or corrected. It cannot approve a block, change its state or edit its fields: only a click on the page does that." + ROUTE,
      inputSchema: {
        type: "object",
        properties: {
          block: { type: "string" },
          status: { type: "string", enum: ["saved", "unchanged", "staff_left_alone", "error"] },
          message: { type: "string" },
        },
        required: ["block", "status"],
        additionalProperties: false,
      },
    },
    {
      name: "time_review__redraft",
      description:
        "Save the redrafted matter and description of one half made by a split on the page, and end its pending redraft. Draft both halves from the day's stored evidence and the saved screenshot readings that `time_review__read_day` returns (`evidence`, `readings`): never open, view or dispatch a reader for any image. Refused for a block with no redraft waiting. The half stays flagged: only a click on the page approves it. Nothing is written to TimeCamp." + ROUTE,
      inputSchema: {
        type: "object",
        properties: { block: { type: "string" }, matter: { type: "string" }, description: { type: "string" } },
        required: ["block", "matter", "description"],
        additionalProperties: false,
      },
    },
    {
      name: "time_review__mark_issued",
      description:
        "Mark blocks as on an issued invoice, when /issue-invoice issues it: from then on the page's Unmerge and Unsplit, and any further split or merge, are refused for those blocks and for the blocks they were made from, because the issued record is final and a later correction is an adjustment. `blocks` are the block ids the invoice's lines rest on; `invoice` is the invoice number. Marking a block already marked changes nothing." + ROUTE,
      inputSchema: {
        type: "object",
        properties: { blocks: { type: "array", items: { type: "string" } }, invoice: { type: "string" } },
        required: ["blocks", "invoice"],
        additionalProperties: false,
      },
    },
  ];
}
