import { AUDIENCES } from "../knowledge/index.js";
import { type ToolDefinition, SQL_PARAMS } from "./shared.js";

function submissionDataPrefixed(name: string): string {
  return `drafting_data__${name}`;
}

// The one-way approval gate approves one exact call; expect_revision ties it to the records the
// practitioner saw, without hashing the database (plan 2026-10-28, step 0).
const EXPECT_REVISION =
  "expect_revision is the database revision the practitioner approved the act at (the `revision` of the render " +
  "or query shown to them); a revision that has moved since is refused with revision_moved, writing nothing.";

// Drafting-data connection-discipline surface (build ticket #294, issue 291
// §6 / issue 292). SQL and schema stay authored inside the /drafting-data
// skill (build ticket #295); this backend holds no table or column names.
// `query` and `execute` are generic primitives against one SQLite database per
// matter; `migrate` is a runner whose schema and migration SQL live in the
// skill's scripts, reached over PYTHONPATH and never embedded here. Only the
// /drafting-data skill (and, per issue 291 §4, dispatcher/worker agents for
// query) may call these tools.
export function submissionDataToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: submissionDataPrefixed("query"),
      description:
        "Run a read-only SELECT/WITH/PRAGMA statement against one matter's submission database -- exactly one statement per call (split multi-statement SQL into separate calls). " +
        "Fails clearly if the database does not exist yet -- run drafting_data__migrate first.",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          sql: { type: "string" },
          params: SQL_PARAMS,
        },
        required: ["db_path", "sql"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: submissionDataPrefixed("execute"),
      description:
        "Run a write SQL script against one matter's submission database in a single transaction, with no " +
        "compare-and-swap. A filing (Writing) is created through drafting_data__create_writing, never here, " +
        "a Milestone with no Writing is created through drafting_data__create_milestone, never here, a general " +
        "Writing is recorded as sent through drafting_data__record_sent, any other Writing is recorded as filed through " +
        "drafting_data__record_filed, and a Writing is recorded as served through drafting_data__record_served: a script " +
        "that leaves a filing's filed_on or sent_copy_id holding a value it did not hold is refused whole, writing " +
        "nothing (clearing filed_on stays an update). A drafting Writing's stored layout is " +
        "re-snapshotted through drafting_data__resnapshot_writing, a job is created through drafting_data__create_job, " +
        "a job is assigned through drafting_data__assign_job, " +
        "a job's unchanged plan is approved through drafting_data__approve_plan, " +
        "a job is completed through drafting_data__complete_job, a job is released through drafting_data__release_job, " +
        "a job step's status is set through drafting_data__set_step, " +
        "a job is deleted through drafting_data__delete_job, " +
        "and a duplicate job is merged into another through drafting_data__merge_jobs. " +
        "The result carries changes, the number of rows the script inserted, updated or deleted, rows written " +
        "by triggers included; on a script that writes only job tables, changes 0 means its guards matched " +
        "nothing and nothing was written. " +
        "A non-success result, a rejection included, does not prove the script did not " +
        "commit: follow the execute row of /drafting-data's Operation Routing table before any retry.",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          sql_script: { type: "string" },
        },
        required: ["db_path", "sql_script"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: submissionDataPrefixed("repoint_documents"),
      description:
        "After a file was moved or renamed, point every stored document row still naming its old place at the new one: " +
        "/drafting-data's references/document-paths.md \"Re-point after a move\" as one call. old_path and new_path are " +
        "in the stored form (relative to the matter root, backslash separators); a row matches the old place in the stored " +
        "or the absolute form, ignoring case. The drafting database is found from matter_root's pointer. Returns " +
        "{database, repointed}: repointed lists the ids re-pointed, and an empty list is the normal result; database false " +
        "means the matter has no drafting database, so nothing was read or written. Running it twice is safe. " +
        "A non-success result does not prove nothing committed: call it again, which re-reads first.",
      inputSchema: {
        type: "object",
        properties: {
          matter_root: { type: "string" },
          old_path: { type: "string" },
          new_path: { type: "string" },
        },
        required: ["matter_root", "old_path", "new_path"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: submissionDataPrefixed("create_writing"),
      description:
        "Create one Writing (a filings row) on a proceeding: the one door for a new Writing, because only this tool writes " +
        "its stored layout (layout_snapshot) and needs_forum_parts, and the needs-forum guard reads both at INSERT. " +
        "It resolves the type file from /draft's knowledge tree by `tree` (country, jurisdiction, and a venue folder or " +
        "_NoVenue) and `kind` (a row's file stem or alias in that folder's kinds index, naming exactly one row by itself; for a bespoke type " +
        "the Writing stores the alias drafting_forms__render accepts, so `notice-of-application` is stored as `notice_of_application`), reads it and the venue's venue.md with the firm's " +
        "overlay and corrections merged, validates the layout, records each cited rule_ref's passage hash, and inserts the row " +
        "in one transaction. `recipient` is required under _NoVenue, where it must equal the matched row's recipient, and refused elsewhere. A venue key must equal the " +
        "proceeding's forum exactly (forum_mismatch); a _NoVenue key fits any proceeding, forum or none. The signer defaults " +
        "to this machine's `person` when the firm roster marks that person an active lawyer; a passed signer_key must be one; " +
        "a type declaring signer: party takes signer_party_id, a party of the proceeding. Refusals write nothing: kind_unresolved, recipient_mismatch, " +
        "invalid_layout (an unknown part source, a needs-forum type under _NoVenue), projection_not_built, forum_mismatch, " +
        "needs_forum, invalid_signer. On a proceeding's first Writing the same transaction moves every draft attached to the " +
        "proceeding's own Milestone (a client letter or reply, ADR 0042) onto the new Writing's board, which takes that " +
        "board's place, so each stays on one board. Returns filing_id, needs_forum_parts, the stored layout and venue " +
        "blocks, the signer, type_file, venue_file, learned and attachments_moved (how many drafts it moved; 0 on a " +
        "database below schema v67). A Milestone with no Writing is never created here: its kind is refused with " +
        "reserved_kind, and drafting_data__create_milestone creates it.",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          proceeding_id: { type: "number" },
          tree: {
            type: "object",
            properties: {
              country: { type: "string" },
              jurisdiction: { type: "string" },
              venue: { type: "string" },
            },
            required: ["country", "jurisdiction", "venue"],
            additionalProperties: false,
          },
          kind: { type: "string" },
          recipient: { type: "string", enum: [...AUDIENCES] },
          title: { type: "string" },
          subkind: { type: "string", enum: ["default_judgment", "consent"] },
          round: { type: "string", enum: ["opening", "response", "reply", "non_participation"] },
          signer_key: { type: "string" },
          signer_party_id: { type: "number" },
        },
        required: ["db_path", "proceeding_id", "tree", "kind", "title"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: submissionDataPrefixed("create_milestone"),
      description:
        "Create one Milestone with no Writing on a proceeding: the one door for a board that holds work no Writing " +
        "carries, such as finding, stamping or scanning a paper original. It is not a Writing and is never called one. " +
        "`title` is the board's name in the practitioner's own words. The proceeding must already have a Writing: one " +
        "with none keeps its own Milestone, which already holds jobs with no Writing, and the call is refused with " +
        "no_writing. The board has a Milestone page (`Milestone <id>.html`) and jobs, and never a mockup, " +
        "a Writing folder, a view page, completion criteria, Proposals or ingest inputs; this tool writes no " +
        "job. It shows only the jobs and loose threads whose filing_id is the returned filing_id, so a job with no " +
        "filing_id stays on the Writings' boards. Its state is Open, or Closed once it is retired. Refusals write " +
        "nothing: invalid_title (a blank title), no_writing. Opening or closing one bumps the database revision, so " +
        "each Writing's mockups read stale once. Returns filing_id, the id drafting_forms__render, " +
        "drafting_forms__board_card and each job's filing_id take for this board, proceeding_id and title.",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          proceeding_id: { type: "number" },
          title: { type: "string" },
        },
        required: ["db_path", "proceeding_id", "title"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: submissionDataPrefixed("merge_milestones"),
      description:
        "Merge two Milestones whose goals the practitioner has confirmed overlap or cohere (docs/ADRs/0010). First " +
        "show the practitioner both boards' statements of goals (drafting_forms__board_card's goals lane) side by side, " +
        "propose one combined goal as the reply's only fenced code block, and in the same turn ask whether to merge them " +
        "with that goal, saying that each Writing stays a separate filing with its own documents and numbering and " +
        "that only the Milestone page, view pages and goal combine; call this only after their next turn is a bare " +
        "yes, or their own goal sentence, and pass confirmed: true. goal_statement is the merged board's one goal, " +
        "the fenced block character for character or the practitioner's sentence; it is written as confirmed and " +
        "passes the practitioner-words gate as drafting_data__set_board_goal's confirmed statement does. " +
        "goal_description, only with it, is the line the closed Goal card shows. A goal naming drafting, or a " +
        "description joining several goals, is still written, and the note ends with a framing warning to relay " +
        "once. Without goal_statement the board's goal status is needs_consolidation, and the next /draft opening " +
        "asks once for one combined goal. Either way every earlier statement of both boards is kept under the " +
        "survivor's `merged` as history only, never drawn on the Goal card, board_summary or board_card once the " +
        "board holds one goal. " +
        "boards names the two, each by exactly one of filing_id (a Writing's board or a Milestone with no Writing) and " +
        "proceeding_id (a pre-filing proceeding's board). Boards in different proceedings may merge. The survivor is " +
        "a Writing's board over a Milestone with no Writing over a pre-filing board, and within a kind the lower id. " +
        "The survivor's page then draws the merged boards as one board: one Completion Criteria card and one set of " +
        "lanes holding every board's jobs, each job naming the Writing it serves. board_summary reads that one board by " +
        "any of its Writings' ids, and board_card by the survivor's (an absorbed board's refuses board_merged). Criteria combine by id and read unmet while any Writing's is unmet; " +
        "each Writing's own gate still blocks only its own filing. One set of view pages spans all its Writings, named " +
        "by the survivor's id; the absorbed board's " +
        "pages move to TRASH at the next page write. Boards it had absorbed move to the survivor. No job, loose " +
        "thread or Writing row is written. " +
        "Once a pre-filing board is merged, its proceeding's first Writing joins the survivor. One db_meta row per " +
        "absorbed board, key `board_member:filing:<id>` or `board_member:proceeding:<id>`. Refusals write nothing: " +
        "invalid_boards, invalid_board, not_confirmed, invalid_session_token, invalid_statement, invalid_description, " +
        "not_found, board_retired, proceeding_has_writing, board_merged (name its survivor instead), same_board. " +
        "Returns survivor, absorbed (each {filing_id, proceeding_id}), goal_status (confirmed or needs_consolidation) " +
        "and a note.",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          boards: {
            type: "array",
            minItems: 2,
            maxItems: 2,
            items: { type: "object", properties: { filing_id: { type: "number" }, proceeding_id: { type: "number" } }, additionalProperties: false },
          },
          confirmed: { type: "boolean" },
          session_token: { type: "string" },
          goal_statement: { type: "string" },
          goal_description: { type: "string" },
        },
        required: ["db_path", "boards", "confirmed", "session_token"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: submissionDataPrefixed("record_sent"),
      description:
        "Record a general Writing as sent (the Sent write): the one door for a general Writing's Sent date. Only an active " +
        "roster lawyer (this machine's `person`) may record it, and a Writing with no stored text is refused with no_stored_text. It first applies the " +
        "pre-send hold: it reads the latest render's inventory and never renders (render_first when that render is older " +
        "than the revision), and while primary-authority, excerpts, noting-up or recipients (as the type declares them) is unmet it " +
        "writes the Pre-send gate job, one step per unmet criterion, and refuses with held, unless send_anyway carries " +
        "the practitioner's own words, which it records verbatim as each open step's WAIVED form. It then compares the sent " +
        "copy (sent_copy_path: a .eml, .pdf or .msg file; or sent_copy_text: pasted text) with the stored text and refuses " +
        "sent_copy_mismatch listing, for each paragraph or clause the copy lacks (up to 20, with a count of the rest), its part, its " +
        "stored text in full and the closest span of the sent copy in full, in the message and in error.details.passages; " +
        "a .msg is recorded by path and not compared, and the " +
        "result says so. Then, in one transaction, it writes the sent copy's documents row, sent_copy_id, the signer " +
        "snapshot and filed_on (sent_on), which freezes the exhibits and moves the revision. It retires nothing and " +
        "offers no retirement: the Writing stays on its Milestone until the practitioner retires it. Refusals: invalid_sent_on, " +
        "invalid_sent_copy, invalid_send_anyway, not_found, writing_retired, already_sent, not_a_general_writing, " +
        "person_unset, not_a_lawyer, not_active, invalid_signer, no_stored_text, parties_drift (a party's counsel or address " +
        "for service cannot be read from case data; nothing was written), render_first, no_billing_anchor, held, " +
        "pre_send_gate_changed (the Pre-send gate job changed during the call; nothing was written), sent_copy_mismatch. " +
        "The same transaction first writes the party rows it was sent with (parties_snapshot), counsel and the address for " +
        "service read from case data. " + EXPECT_REVISION,
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          filing_id: { type: "number" },
          sent_on: { type: "string" },
          sent_copy_path: { type: "string" },
          sent_copy_text: { type: "string" },
          send_anyway: { type: "string" },
          expect_revision: { type: "number" },
        },
        required: ["db_path", "filing_id", "sent_on", "expect_revision"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: submissionDataPrefixed("record_filed"),
      description:
        "Record a Writing that is not a general Writing as filed on filed_on (YYYY-MM-DD): the one door for its filing date. " +
        "In one transaction it writes the party rows the Writing is filed with (parties_snapshot), names, roles and flags " +
        "from parties and counsel and the address for service read from case data, then sets filed_on, which freezes the " +
        "exhibits and moves the revision. A Writing that already has party rows (a filed_on cleared in error) keeps them. " +
        "Clearing a filed_on set in error stays an ordinary update. Refusals write nothing: invalid_filed_on, not_found, " +
        "writing_retired, served_writing (a Notice of Application or Application Response recorded as served under " +
        "amended Rule 8-1, whose registry filing is a job step), already_filed, general_writing (record it as sent " +
        "through drafting_data__record_sent), " +
        "parties_drift (a party's counsel or address for service cannot be read from case data), revision_moved (the " +
        "database changed during the call). Returns filing_id, filed_on, parties_snapshot_rows, the new revision and a note. " +
        EXPECT_REVISION,
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          filing_id: { type: "number" },
          filed_on: { type: "string" },
          expect_revision: { type: "number" },
        },
        required: ["db_path", "filing_id", "filed_on", "expect_revision"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: submissionDataPrefixed("record_served"),
      description:
        "Record a Notice of Application or Application Response as served on served_on (YYYY-MM-DD), under amended Rule " +
        "8-1 (B.C. Reg. 105/2026), which serves it before it is filed. In one transaction it writes the party rows the " +
        "Writing is served with (parties_snapshot), a documents row 'Served copy — <title>' dated served_on with " +
        "served_copy_path when given, sent_copy_id pointing at it, and filed_on = served_on, which freezes the Writing as " +
        "served and moves the revision. Its lifecycle then reads Served until Heard; the later registry filing is a step " +
        "of the Set down for hearing or File the served response job, never a write here. Anyone may record it. Refusals " +
        "write nothing: invalid_served_on, invalid_served_copy (served_copy_path is not on disk), not_found, " +
        "milestone_only, writing_retired, already_filed, not_served_kind (any other kind: record_filed or record_sent), " +
        "parties_drift, revision_moved. Returns filing_id, served_on, sent_copy_id, parties_snapshot_rows, the new " +
        "revision and a note. " +
        EXPECT_REVISION,
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          filing_id: { type: "number" },
          served_on: { type: "string" },
          served_copy_path: { type: "string" },
          expect_revision: { type: "number" },
        },
        required: ["db_path", "filing_id", "served_on", "expect_revision"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: submissionDataPrefixed("create_job"),
      description:
        "Create a job (a tickets row) in one call and one transaction: the row, its steps (ordinal 1, 2, 3... in order, " +
        "at least one), scope rows, the edges from existing jobs it waits on (blocks), its conflict pairs, its conversion " +
        "records (proposal_keys, copied from the card) and the loose thread it consumes (seed_id), under the duplicate " +
        "guard its kind takes. Each guard is /drafting-data's documented condition, tested before the row exists, so it " +
        "never matches the job it guards: none (an unguarded create); live_key (a queued or wip, unshelved job holds one " +
        "of proposal_keys: the fast path and a job outlined from Proposals, jobs-create.md §3); never_held_key (any job " +
        "not deleted ever held one of proposal_keys: intake, §3e); title_live_with_step (a queued or wip, unshelved job " +
        "on the Writing with one of this call's titles already holds a step: counsel's review, jobs-stock.md §3c, whose " +
        "second job is passed in companions); title_and_step_any_status (any job on the Writing, not deleted, has this " +
        "title and one of these step texts: a pass finding, §3g); scrutiny_statement (a queued or wip, unshelved " +
        "'Review scrutiny finding: ' job is scoped to the statement in scope: §3d); holder_lock (held_ticket_id no " +
        "longer carries session_token: a spin-off blocker, §3f, which copies the held job's scope). filing_id is the " +
        "Writing's or Milestone's id, or null for a proceeding-scoped job, and is never left out. priority is an " +
        "integer, or top (one above the highest queued) or bottom (one below the lowest), read inside the write: on a " +
        "Writing's job, that Writing's queue with the proceeding-scoped jobs; on a Milestone's job, the Milestone's " +
        "alone; on a proceeding-scoped job, every queued job in the proceeding. created_by is this session's " +
        "session_token, passed only where /drafting-data says the create writes it (tickets.created_by, schema v72). " +
        "Outcomes: created (ticket_id, companion_ids, the priority written) or guarded (nothing was written; holder_id is " +
        "the job that fired the guard, when one is still there). It moves no revision. Refusals write nothing: " +
        "invalid_<field>, and an error from the database (a missing blocker, a work job with no billing_anchor). " +
        "Returns outcome, ticket_id, companion_ids, priority, holder_id and a note.",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          proceeding_id: { type: "number" },
          filing_id: { anyOf: [{ type: "number" }, { type: "null" }] },
          title: { type: "string" },
          intent: { type: "string" },
          kind: { type: "string", enum: ["work", "charting"] },
          priority: { anyOf: [{ type: "number" }, { type: "string", enum: ["top", "bottom"] }] },
          billing_anchor: { type: "string" },
          steps: { type: "array", items: { type: "string" } },
          scope: {
            type: "array",
            items: {
              type: "object",
              properties: { entity: { type: "string" }, entity_id: { anyOf: [{ type: "number" }, { type: "null" }] } },
              required: ["entity", "entity_id"],
              additionalProperties: false,
            },
          },
          blocks: { type: "array", items: { type: "number" }, description: "Existing jobs this job waits on (ticket_blocks.blocker_id)" },
          conflicts: { type: "array", items: { type: "number" } },
          proposal_keys: {
            type: "array",
            items: {
              type: "object",
              properties: { key: { type: "string" }, item: { type: "string" } },
              required: ["key", "item"],
              additionalProperties: false,
            },
          },
          seed_id: { type: "number" },
          created_by: { type: "string" },
          guard: {
            type: "string",
            enum: ["none", "live_key", "never_held_key", "title_live_with_step", "title_and_step_any_status", "scrutiny_statement", "holder_lock"],
          },
          session_token: { type: "string", description: "holder_lock only" },
          held_ticket_id: { type: "number", description: "holder_lock only" },
          companions: {
            type: "array",
            description: "title_live_with_step only: further jobs written after this one, sharing its fields but title, intent, steps and scope",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                intent: { type: "string" },
                steps: { type: "array", items: { type: "string" } },
                scope: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { entity: { type: "string" }, entity_id: { anyOf: [{ type: "number" }, { type: "null" }] } },
                    required: ["entity", "entity_id"],
                    additionalProperties: false,
                  },
                },
                blocked_by_lead: { type: "boolean" },
              },
              required: ["title", "intent", "steps"],
              additionalProperties: false,
            },
          },
        },
        required: ["db_path", "proceeding_id", "title", "intent", "kind", "priority", "steps", "guard"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: submissionDataPrefixed("assign_job"),
      description:
        "Assign a job (a tickets row) to this session in one call: the guarded assigning write followed by its confirm-read. " +
        "By default the write matches only a job that is queued, unlocked and not shelved (rejected_at NULL). takeover: true " +
        "admits a wip job held by another session; pass it only after the practitioner's explicit yes to the take-over " +
        "prompt. takeover: true needs expected_holder, the `holder:` tag off the job's card (drafting_forms__board_card with " +
        "jobs), and the write lands only while that holder is still on the row. A shelved, completed or superseded job is " +
        "never assigned. A session that created any job (tickets.created_by, schema v72) is assigned only a job it " +
        "created, by take-over or otherwise. A job is not assigned before its bring-forward date (tickets.bf_on, schema " +
        "v74), a start date and never a deadline; a take-over does not read it. session_token is the one drafting_forms__open_session or drafting_forms__bootstrap returned; this " +
        "tool mints none. The outcome is read off the confirm-read: assigned (the row carries this session's token; changes " +
        "is 0 when it already did), lost_race (another session's token is on the row: re-render and say the job was just " +
        "taken), holder_changed (a take-over found another holder than expected_holder: nothing was written; re-render and " +
        "ask afresh), not_created_here (this session created jobs and this is not one of them: nothing was written; say so " +
        "in one line), before_bf (the job is held until its bring-forward date, the returned bf_on: nothing was written; " +
        "say so in one line, and never propose changing or clearing the date, which only the practitioner does), " +
        "no_match (no token: the guards matched nothing, and the returned status and rejected_at show why). " +
        "Never retry to win. It moves no revision. Refusals write nothing: invalid_ticket_id, invalid_session_token, " +
        "invalid_expected_holder, not_found. Returns ticket_id, outcome, changes, locked_by, locked_at, status, rejected_at, " +
        "bf_on and a note.",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          ticket_id: { type: "number" },
          session_token: { type: "string" },
          takeover: { type: "boolean" },
          expected_holder: { type: "string" },
        },
        required: ["db_path", "ticket_id", "session_token"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: submissionDataPrefixed("approve_plan"),
      description:
        "Approve the plan of the job (a tickets row) this session holds, as its steps stand, in one call: the guarded " +
        "stamp of plan_approved_at followed by its confirm-read. The write matches only a job holding this session's token " +
        "whose plan is not yet approved, so a re-approval confirmed unaltered writes nothing. A change to the steps (the " +
        "Change path) stays the SQL in /drafting-data's jobs-run.md §5. session_token is the one " +
        "drafting_forms__open_session or drafting_forms__bootstrap returned; this tool mints none. The outcome is read off " +
        "the confirm-read: approved (changes 1), already_approved (this session's token, plan_approved_at already set; " +
        "changes 0), not_held (another session's token is on the row: taken over), shelved (no lock, rejected_at set), " +
        "completed, no_match (the guards matched nothing, and the returned status shows why). Never retry. It moves no " +
        "revision. Refusals write nothing: invalid_ticket_id, invalid_session_token, not_found, no_steps (the job has no " +
        "steps, so no plan to approve), plan_marker_only (the job's only step is the plan marker, so it has no plan yet). " +
        "Returns ticket_id, outcome, changes, plan_approved_at, locked_by, status, " +
        "rejected_at and a note.",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          ticket_id: { type: "number" },
          session_token: { type: "string" },
        },
        required: ["db_path", "ticket_id", "session_token"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: submissionDataPrefixed("track_source"),
      description:
        "Record the sources to get on the job (a tickets row) this session holds, and close them, in one call. A source " +
        "to get is a decision, an enactment or a file the job's work has named and is about to retrieve or read; it is the " +
        "job's own record beside its steps and never a step. add takes {kind, label} items, kind one of decision, " +
        "legislation, file, label one line of at most 200 characters: a citation, an instrument's title and citation, or a " +
        "file name, with no statement of law, no deadline and no date other than the one inside a citation. Adding an item " +
        "already open on the job changes nothing, and adding a closed one reopens it. close takes {kind, label, outcome, " +
        "reason?} items, outcome got or not_retrieved, reason one line of at most 60 characters. Every write matches only " +
        "a job holding this session's token, so a call with neither add nor close is the lock read before a dispatch. " +
        "session_token is the one drafting_forms__open_session or drafting_forms__bootstrap returned; this tool mints " +
        "none. The outcome is read off the confirm-read: recorded (the job is this session's), not_held (another " +
        "session's token is on the row: taken over), shelved, completed, no_match; on any but recorded nothing was " +
        "written and nothing is dispatched for the job. Never retry. It moves no revision. Refusals write nothing: " +
        "invalid_ticket_id, invalid_session_token, invalid_item, not_found, schema_below_v76 (say once that the matter's " +
        "database needs the v76 migration, and carry on with the work). Returns ticket_id, outcome, sources (every source " +
        "on the job, open and closed), open, unknown (close items naming no source on the job), locked_by, status, " +
        "rejected_at and a note.",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          ticket_id: { type: "number" },
          session_token: { type: "string" },
          add: {
            type: "array",
            items: {
              type: "object",
              properties: { kind: { type: "string", enum: ["decision", "legislation", "file"] }, label: { type: "string" } },
              required: ["kind", "label"],
              additionalProperties: false,
            },
          },
          close: {
            type: "array",
            items: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["decision", "legislation", "file"] },
                label: { type: "string" },
                outcome: { type: "string", enum: ["got", "not_retrieved"] },
                reason: { type: "string" },
              },
              required: ["kind", "label", "outcome"],
              additionalProperties: false,
            },
          },
        },
        required: ["db_path", "ticket_id", "session_token"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: submissionDataPrefixed("set_step"),
      description:
        "Set one step's status on the job (a tickets row) this session holds, in one call: the guarded write, then the " +
        "confirm-read. status is open (clears the status), retry (the step is blocked by a missing credential or an " +
        "unreachable source and is tried again later; such a step is never stamped done), cancelled or deferred (only on " +
        "the practitioner's own words, passed verbatim as practitioner_words and stored with the step), or waiting (the " +
        "step waits on an external process, such as a Westlaw run: wait_until is set to now plus wait_minutes, default 5, " +
        "and the result's note says `setting timer for N minutes`). wait_until is the minute the session checks the " +
        "process again: never a deadline and never time remaining, never shown as a countdown, and never put in a " +
        "handover or a loose thread. Once it has passed the step reads as open. A done step (done_at set) is frozen and " +
        "takes no status. The write matches only a job holding this session's token. session_token is the one " +
        "drafting_forms__open_session or drafting_forms__bootstrap returned; this tool mints none. The outcome is read off " +
        "the confirm-read: set (changes 1), not_held (the job is not this session's: taken over, shelved or completed), " +
        "done (the step is done and was left as it is), no_match (no such step, or the guards matched nothing). Never " +
        "retry to win. It moves no revision. Refusals write nothing: invalid_ticket_id, invalid_ordinal, " +
        "invalid_session_token, invalid_status, invalid_wait_minutes, practitioner_words_required, " +
        "invalid_practitioner_words, not_found, schema_below_v78 (say once that the matter's database needs the v78 " +
        "migration, and leave the step open). Returns ticket_id, ordinal, outcome, changes, done_at, status, wait_until, " +
        "status_note, locked_by and a note.",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          ticket_id: { type: "number" },
          ordinal: { type: "number" },
          session_token: { type: "string" },
          status: { type: "string", enum: ["open", "retry", "cancelled", "deferred", "waiting"] },
          wait_minutes: { type: "number" },
          practitioner_words: { type: "string" },
        },
        required: ["db_path", "ticket_id", "ordinal", "session_token", "status"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: submissionDataPrefixed("release_job"),
      description:
        "Return a wip job (a tickets row) to Ready in one call: the guarded releasing write followed by its confirm-read. " +
        "Only the status (back to queued) and the lock change; the plan, its approval, the steps and their stamps, scope " +
        "and proposals stay. By default the write matches only a wip job holding this session's token. expected_holder, " +
        "the `holder:` tag off the job's card (drafting_forms__board_card with jobs), releases another session's job " +
        "instead, and the write lands only while that holder is still on the row and the job is not shelved; pass it only " +
        "after the practitioner chose Return it to Ready on /draft's take-over form. session_token is the one " +
        "drafting_forms__open_session or drafting_forms__bootstrap returned; this tool mints none. The outcome is read off " +
        "the confirm-read: released (changes 1), taken_over (another holder is on the row, or with expected_holder the " +
        "holder changed since the card was read: nothing was written; re-render), shelved (no lock, rejected_at set), " +
        "completed, no_match (the guards matched nothing, and the returned status shows why). Never retry to win. It " +
        "moves no revision. Refusals write nothing: invalid_ticket_id, invalid_session_token, invalid_expected_holder, " +
        "not_found. Returns ticket_id, outcome, changes, locked_by, locked_at, status, rejected_at and a note.",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          ticket_id: { type: "number" },
          session_token: { type: "string" },
          expected_holder: { type: "string" },
        },
        required: ["db_path", "ticket_id", "session_token"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: submissionDataPrefixed("delete_job"),
      description:
        "Delete one or several mistaken jobs (tickets rows) in one call, only on the practitioner's typed instruction: a " +
        "guarded stamping write per job, all in one transaction, then a confirm-read per job. A job is deleted when it is " +
        "queued (shelved or not), or wip and held by this session's token; the holder check and the deleted_at stamp are " +
        "one statement. A wip job held by this session goes back to queued with its lock cleared in the same write, so a " +
        "restore gives a Ready job with no lock. Nothing else moves: the delete is a soft deleted_at stamp, and every row " +
        "pointing at the job stays. session_token is the one drafting_forms__open_session or drafting_forms__bootstrap " +
        "returned; this tool mints none. Per job, the outcome is read off the confirm-read: deleted (changes 1), " +
        "held_elsewhere (wip in another session: nothing written; never re-run), refused_status (completed or superseded), " +
        "already_deleted, not_found. It moves no revision. Refusals write nothing: invalid_ticket_ids, " +
        "invalid_session_token. Returns jobs, one {ticket_id, outcome, changes, status, locked_at, rejected_at, " +
        "deleted_at, note} per id.",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          ticket_ids: { type: "array", items: { type: "number" }, minItems: 1 },
          session_token: { type: "string" },
        },
        required: ["db_path", "ticket_ids", "session_token"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: submissionDataPrefixed("merge_jobs"),
      description:
        "Merge a duplicate job into the job that survives, in one call, only after the practitioner's bare yes to the " +
        "proposed merge (a hook refuses it otherwise): every statement under one guard in one transaction, then a " +
        "confirm-read. The absorbed job's undone steps are appended after the survivor's, so the survivor's done steps " +
        "keep their stamps; its scope rows and Proposal keys are copied to the survivor where the survivor lacks them; " +
        "jobs waiting on it wait on the survivor; the survivor's plan approval is cleared when steps were added; and " +
        "the absorbed job is superseded by the survivor (superseded_by), never deleted. The survivor is Ready or held " +
        "by this session; the absorbed job is Ready. session_token is the one drafting_forms__open_session or " +
        "drafting_forms__bootstrap returned; this tool mints none. Outcomes: merged, or a refusal that writes nothing " +
        "and names refused_job: held_elsewhere (in progress in another session; never re-run), held_here (the absorbed " +
        "job is this session's own: make it the survivor), completed, superseded, shelved, deleted, different_writing " +
        "(a different Writing, or a General Job with a Writing Job), different_proceeding, either_or (the absorbed job " +
        "has an either/or partner), blocked (either job waits on a job outside the pair that is not completed), and " +
        "no_match (a job changed between the read and the write). It moves no revision and renders nothing: re-render " +
        "after it. Refusals write nothing: invalid_ticket_id, same_job, invalid_session_token, not_found. Returns " +
        "{survivor_id, absorbed_id, outcome, refused_job?, steps_added, scope_added, keys_added, blocks_moved, " +
        "absorbed_status, superseded_by, note}.",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          survivor_id: { type: "number" },
          absorbed_id: { type: "number" },
          session_token: { type: "string" },
        },
        required: ["db_path", "survivor_id", "absorbed_id", "session_token"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: submissionDataPrefixed("complete_job"),
      description:
        "Complete the job (a tickets row) this session holds in one call: the supersession of its queued conflict partners, " +
        "then the completion, both guarded on this session's token, then the confirm-read. Before either, while any of its " +
        "steps is open, to be retried or waiting (a waiting step whose minute has passed included), nothing is written and " +
        "the outcome is steps_open, with open_steps naming each one; a step cancelled or deferred on the practitioner's " +
        "words (drafting_data__set_step) counts as resolved. A wip conflict partner is never " +
        "touched. session_token is the one drafting_forms__open_session or drafting_forms__bootstrap returned; draft_dir is " +
        "the draft_dir open_session returned. The outcome is read off the confirm-read: completed (status completed, no " +
        "lock; changes 1 means this call completed it, 0 that another session did), not_held (another session's token is " +
        "on the row: taken over), shelved (no lock, rejected_at set), no_match (the guards matched nothing), steps_open. Only when this " +
        "call completed the job (changes 1) are the matter's Milestone pages and Litigation Strategy rewritten, by the render a " +
        "session runs with draft_dir: the job's filing's, or for a job with no filing_id the first live filing's in its " +
        "proceeding, or the proceeding's own when it has no filing. pages_written: false with pages_refused means the Milestone " +
        "pages are stale and the session must say so; the completion still stands. It moves no revision. Refusals " +
        "write nothing: invalid_ticket_id, invalid_session_token, not_found. Returns ticket_id, outcome, superseded, " +
        "changes, status, completed_at, locked_by, rejected_at, pages_written, milestone_path (the rendered filing's or " +
        "proceeding's Milestone page), board_changed, board_moves, pages_refused, open_steps on steps_open, and a note.",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          ticket_id: { type: "number" },
          session_token: { type: "string" },
          draft_dir: { type: "string" },
        },
        required: ["db_path", "ticket_id", "session_token", "draft_dir"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: submissionDataPrefixed("set_board_goal"),
      description:
        "Record one Milestone's statement of goals: the card labelled Goal at the top of the board, " +
        "drafting_forms__render's board_summary `Goal:` line and drafting_forms__board_card's goals lane. Pass exactly " +
        "one of filing_id (a Writing's board or a Milestone with no Writing) and proceeding_id (a pre-filing " +
        "proceeding's board; one that has a Writing is refused, proceeding_has_writing). status is confirmed (the " +
        "statement the practitioner approved), inferred (the session's own wording after the practitioner declined, " +
        "never treated as confirmed) or declined (the practitioner declined and nothing is inferred yet). statement " +
        "is the whole text, stored verbatim with its indentation and line breaks; it is required for confirmed and " +
        "inferred and refused for declined. A goal is one outcome (an order obtained, a settlement reached, a claim " +
        "defended), not a document or a step. description is the line the closed card shows; omitted, the stored one " +
        "stays, else the board's default: `Goal not set` while no statement is stored, and once one is, the Writing's " +
        "or Milestone's title, or `Proceeding <id>`. A statement or description naming drafting, or a description " +
        "joining several goals (`; `, ` + `, ` & `), is still written, and the note ends with a framing warning to relay " +
        "once. session_token is the one drafting_forms__open_session or drafting_forms__bootstrap " +
        "returned. A confirmed write passes the practitioner-words gate: the statement is an unbroken run of one " +
        "practitioner turn, or the one fenced code block in the session's reply before the practitioner's last turn, " +
        "character for character, and that turn is a bare yes. An inferred or declined write needs no approval. One " +
        "db_meta row per board, key `board_goal:filing:<id>` or `board_goal:proceeding:<id>`, value JSON " +
        "{description, statement, status, approved_at, session_token, updated_at}, approved_at set only for " +
        "confirmed. The write replaces the board's row and removes the rows of boards that no longer exist " +
        "(stale_keys_removed). It moves no revision. Re-render to show it. A merged board (drafting_data__merge_milestones) " +
        "holds one goal, its own; each earlier statement of the boards merged into it is kept, with its own status, " +
        "under `merged` as history only. A merged board left needs_consolidation (merged without a goal, or before " +
        "2026-10-22) reads that status until this tool writes its own statement, which makes it hold one goal again. " +
        "merged_index (1-based, as board_card's `### To combine <n>` lists them) writes that history entry instead, " +
        "confirmed or inferred, and the board's own statement is kept. A board merged into another is refused " +
        "(board_merged): set the goal on its survivor. Refusals write nothing: invalid_board, " +
        "invalid_session_token, invalid_status, invalid_statement, invalid_description, not_found, " +
        "proceeding_has_writing, board_merged, invalid_merged_index. Returns key, filing_id or proceeding_id, description (null: the default), statement, " +
        "status, approved_at, updated_at, session_wording (true when inferred), stale_keys_removed and a note.",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          filing_id: { type: "number" },
          proceeding_id: { type: "number" },
          description: { type: "string" },
          statement: { type: ["string", "null"] },
          status: { type: "string", enum: ["confirmed", "inferred", "declined"] },
          session_token: { type: "string" },
          merged_index: { type: "number" },
        },
        required: ["db_path", "status", "session_token"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: submissionDataPrefixed("record_viewed"),
      description:
        "Record that the practitioner was just shown pages, so the Milestone's thumbnails put the most recently " +
        "viewed first and a view page's tile stops being dashed. Call it right after presenting a view page or a " +
        "Writing's mockup as a file card, with the exact paths presented, in the order presented; never for a Milestone " +
        "or Litigation Strategy page. Each path is matched by its file name to a thumbnail: a board's view " +
        "page (view_page_paths), or a live Writing's document by its mockup, by its folder too " +
        "when several thumbnails share the name. Each moves to the front of its board's order, so the last " +
        "path ends up first. One db_meta row per board, key `board_viewed:filing:<id>` or " +
        "`board_viewed:proceeding:<id>` by the board's survivor, value a JSON array of item keys, most recent first, " +
        "with no time. It moves no revision, touches no job, and does not rewrite the page: the order shows the " +
        "next time the page is written. Refusals write nothing: invalid_paths, not_a_strip_item, ambiguous_path. " +
        "Returns keys (the rows written) and a note.",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          paths: { type: "array", items: { type: "string" } },
        },
        required: ["db_path", "paths"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: false, openWorldHint: false },
    },
    {
      name: submissionDataPrefixed("resnapshot_writing"),
      description:
        "Re-snapshot a Writing's stored layout (the dedicated re-snapshot write), run only on the practitioner's explicit " +
        "instruction through /draft, and only while the Writing is drafting. It resolves the stored kind again from /draft's " +
        "knowledge tree, reads the type file and the venue's venue.md with the firm's overlay and corrections merged, validates " +
        "the layout, records each cited rule_ref's passage hash, and rewrites layout_snapshot and needs_forum_parts in one " +
        "write, which moves the revision and re-runs the needs-forum guard. The tree key is the proceeding's forum; a Writing " +
        "on a proceeding with no forum re-snapshots under _NoVenue in the writer's jurisdiction, which the caller passes as " +
        "`jurisdiction` {country, jurisdiction} and never infers. Refusals write nothing: invalid_filing_id, not_found, " +
        "writing_not_drafting (sent or retired), invalid_forum, jurisdiction_required, kind_unresolved, invalid_layout, " +
        "projection_not_built. Returns filing_id, needs_forum_parts, type_file and the new revision.",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
          filing_id: { type: "number" },
          jurisdiction: {
            type: "object",
            properties: {
              country: { type: "string" },
              jurisdiction: { type: "string" },
            },
            required: ["country", "jurisdiction"],
            additionalProperties: false,
          },
        },
        required: ["db_path", "filing_id"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
    {
      name: submissionDataPrefixed("migrate"),
      description:
        "Create or upgrade one matter's submission database to the current schema. The sole schema-" +
        "guard bypass, run as a separate process spawn from query/execute so neither carries a bypass " +
        "path. Run this before the first query or execute against a new database. WITHHELD (issue 812) " +
        "when the migration source would take the database past the schema version this plugin bundle " +
        "was built against: the call fails with code schema_ahead_of_bundle and the database, its recorded " +
        "version and its backups are left untouched -- nothing is copied aside for a migration that never " +
        "ran. The remedy is to rebuild and reinstall the plugin, not to retry. To apply an in-progress hop " +
        "on purpose, set COCLERK_SUBMISSION_ALLOW_UNBUILT_SCHEMA=1 in the server's environment and restart " +
        "it; every database migrated that way stays unrenderable until a matching bundle is installed. REFUSED, code " +
        "counsel_not_reconciled, on the v43 hop that drops the submission copy of counsel of record, while any counsel " +
        "offer or parties_drift row stands: the refusal names each row, nothing is written (a database older than v42 is " +
        "first taken to v42 so its parties can be linked), and each is decided by /drafting-data filing-checklists " +
        "section 0 before migrating again.",
      inputSchema: {
        type: "object",
        properties: {
          db_path: { type: "string" },
        },
        required: ["db_path"],
        additionalProperties: false,
      },
      annotations: { destructiveHint: true, openWorldHint: false },
    },
  ];
}
