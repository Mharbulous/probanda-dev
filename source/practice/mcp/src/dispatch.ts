import { dirname } from "node:path";

import { DataServerError, ValidationError } from "./errors.js";
import { buildToolDefinitions, type ToolDefinition } from "./schema-gen.js";
import { validateToolInput } from "./validate.js";
import type { PracticeStore } from "./practice/store.js";
import { callPracticeTool } from "./tools/practice/index.js";
import { matter_lookup } from "./tools/practice/reads.js";
import { caseDataQuery, caseDataExecute } from "./case/backend.js";
import { caseDataMigrate, type MigrateMode } from "./case/migrate.js";
import { resolveParticipant } from "./case/resolve-participant.js";
import { ingestAuthority, type AuthorityIngestRequest } from "./case/ingest-authority.js";
import { proceduralHistoryAppend, type ProceduralHistoryAppendArgs } from "./case/procedural-history.js";
import {
  timePipelineGet,
  timePipelineSet,
  timePipelineList,
  timePipelineDelete,
  timePipelineBulkApply,
  timePipelineExport,
} from "./time-pipeline/backend.js";
import { timecampingDataQuery, timecampingDataExecute, timecampingDataBulkUpsert } from "./timecamping/backend.js";
import { timecampingDataMigrate } from "./timecamping/migrate.js";
import { submissionDataQuery, submissionDataExecute } from "./submission/backend.js";
import { submissionDataMigrate } from "./submission/migrate.js";
import { submissionDataCreateWriting, type CreateWritingArgs } from "./submission/forms/layout-snapshot.js";
import { submissionDataCreateJobBoard, type CreateJobBoardArgs } from "./submission/forms/create-job-board.js";
import { submissionDataRecordFiled, type RecordFiledArgs } from "./submission/forms/filed-write.js";
import { submissionDataAssignJob, type AssignJobArgs } from "./submission/forms/assign-job.js";
import { submissionDataApprovePlan, type ApprovePlanArgs } from "./submission/forms/approve-plan.js";
import { submissionDataTrackSource, type TrackSourceArgs } from "./submission/forms/track-source.js";
import { submissionDataCompleteJob, type CompleteJobArgs } from "./submission/forms/complete-job.js";
import { submissionDataReleaseJob, type ReleaseJobArgs } from "./submission/forms/release-job.js";
import { submissionDataSetBoardGoal, type SetBoardGoalArgs } from "./submission/forms/board-goals.js";
import { submissionDataDeleteJob, type DeleteJobArgs } from "./submission/forms/delete-job.js";
import { submissionDataRecordSent, type RecordSentArgs } from "./submission/forms/sent-write.js";
import { resnapshotWriting } from "./submission/writing-snapshot.js";
import {
  nowStamp,
  submissionFormsBootstrap,
  submissionFormsEmitAffidavit,
  submissionFormsEmitBccaBook,
  submissionFormsEmitBccaFactum,
  submissionFormsEmitForm32,
  submissionFormsEmitForm33,
  submissionFormsPreFilingCheck,
  submissionFormsRender,
  submissionFormsRenderProceedingBoard,
  startBootstrapJob,
  type ClientContext,
  type PhaseTimings,
  type RenderMode,
} from "./submission/forms.js";
import { formCurrency } from "./submission/form-currency.js";
import { submissionFormsBoardCard, type BoardCardArgs } from "./submission/matter-pages.js";
import { lookUpMatter, matterToken, submissionFormsOpenSession } from "./submission/open-session.js";
import { bcscFormHarness, type HarnessArgs } from "./submission/bcsc-form-harness.js";
import {
  publishBccaFactum,
  publishGeneral,
  publishVaniacPackage,
  type PublishBccaFactumArgs,
  type PublishGeneralArgs,
  type PublishVaniacArgs,
} from "./submission/publish-tools.js";
import { assembleGeneral, type AssembleGeneralArgs } from "./submission/assemble-tools.js";
import { draftHarness, type DraftHarnessArgs } from "./submission/draft-harness.js";
import { readMessage, type ReadMessageArgs } from "./correspondence/message.js";
import { replyDraft, type ReplyDraftArgs } from "./correspondence/reply-draft.js";
import { type MatterDates, readMatterDates } from "./submission/matter-dates.js";
import { type MatterTodos, readMatterTodos } from "./submission/matter-todos.js";
import { backgroundJobStatus, markRenderedInForeground } from "./submission/render-job.js";
import { skillSourceRead, skillSourceList } from "./files/skill-source.js";
import { skillRulesApplicable, skillRulesCoverage } from "./files/skill-rules.js";
import { rulesAt, rulesAudit } from "./files/rules-dag.js";
import { rulesBranch, rulesMove, rulesProvisional, type BranchArgs, type MoveArgs, type ProvisionalArgs } from "./files/rules-position.js";
import { rulesLifecycle } from "./files/rules-lifecycle.js";
import { checkSources } from "./sources/check.js";
import { sourcesFetch } from "./sources/fetch.js";
import { knowledgeList, knowledgeRead, knowledgeRetire, knowledgeWrite } from "./knowledge/tools.js";
import { repoDocsRead, repoDocsWrite } from "./files/repo-docs.js";
import {
  appendManifest,
  fileDownload,
  fileFetched,
  lawFolderText,
  listDownloads,
  listLawFolder,
  writeScratch,
} from "./files/research-filing.js";
import { researchPreflight } from "./research/preflight.js";
import { legislationSearch } from "./files/legislation-search.js";
import { saveAnswerTool, type SaveAnswerArgs } from "./submission/forms/save-job-answer.js";
import { caseDataRootFromDbPath, caseDataRootFromMatterRoot } from "./files/matter-root.js";
import type { KnowledgeSeams } from "./knowledge/tree.js";
import type { MailState } from "./mail/config.js";
import type { ImapClientFactory } from "./mail/imap.js";
import { callMailTool } from "./mail/tools.js";

export interface DispatchContext {
  // The practice store: practice.db's items (SQLite via host Python — spec §5/§10), read
  // locally with no cloud call; a write is saved only when Probanda's Cloud accepts it.
  practiceDb: PracticeStore;
  // The mail credential, loaded at start and replaced in place by mail__configure_credential.
  mail: MailState;
  // Tests only: a fake IMAP client and a short timeout for the mail__* tools.
  imapFactory?: ImapClientFactory;
  mailTimeoutMs?: number;
}

let definitions: Map<string, ToolDefinition> | undefined;

export async function dispatchTool(
  context: DispatchContext,
  name: string,
  rawArgs: unknown
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    const result = await callTool(context, name, rawArgs);
    // The rules tools answer in XML for the model to read (rules-DAG spec §4.4), not JSON-encoded.
    if (name.startsWith("rules__")) {
      if (typeof result !== "string") throw new DataServerError(`${name} returned a ${typeof result}, not its XML`, "internal_error");
      return { content: [{ type: "text", text: result }] };
    }
    return textResult(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const payload = err instanceof DataServerError
      ? { error: { code: err.code, message } }
      : { error: { code: "data_error", message } };
    return { ...textResult(payload), isError: true };
  }
}

export async function callTool(
  context: DispatchContext,
  name: string,
  rawArgs: unknown
): Promise<unknown> {
  const definition = toolDefinition(name);
  const args = validateToolInput(definition, rawArgs);

  if (name.startsWith("practice_data__")) {
    return callPracticeTool(context.practiceDb, name, args);
  }

  if (name === "case_data__query") {
    return caseDataQuery(
      args.matter_root as string,
      args.sql as string,
      args.params as unknown[] | undefined
    );
  }

  if (name === "case_data__execute") {
    return caseDataExecute(
      args.matter_root as string,
      args.sql_script as string
    );
  }

  if (name === "case_data__resolve_participant") {
    return resolveParticipant(args.matter_root as string, args.name as string);
  }

  if (name === "case_data__ingest_authority") {
    return ingestAuthority(args as unknown as AuthorityIngestRequest);
  }

  if (name === "case_data__procedural_history_append") {
    return proceduralHistoryAppend(args as unknown as ProceduralHistoryAppendArgs);
  }

  if (name === "case_data__migrate") {
    const mode = args.mode as string;
    if (!["plan", "apply", "restore", "backups"].includes(mode)) {
      throw new ValidationError(
        `case_data__migrate: unknown mode ${JSON.stringify(mode)}; expected plan, apply, restore, or backups`
      );
    }
    return caseDataMigrate(args.matter_root as string, mode as MigrateMode, {
      planToken: args.plan_token as string | undefined,
      userConfirmation: args.user_confirmation as string | undefined,
      backupId: args.backup_id as string | undefined,
    });
  }

  if (name.startsWith("time_pipeline__")) {
    const operation = name.slice("time_pipeline__".length);
    switch (operation) {
      case "get":
        return timePipelineGet(args.namespace as string, args.key as string);
      case "set":
        return timePipelineSet(args.namespace as string, args.key as string, args.value as string);
      case "list":
        return timePipelineList(args.namespace as string, args.prefix as string | undefined);
      case "delete":
        return timePipelineDelete(args.namespace as string, args.key as string);
      case "bulk_apply":
        return timePipelineBulkApply(args.namespace as string, args.path as string);
      case "export":
        return timePipelineExport(args.namespace as string, args.prefix as string | undefined, args.path as string);
      default:
        throw new ValidationError(`Unknown tool "${name}"`);
    }
  }

  if (name === "timecamping_data__query") {
    return timecampingDataQuery(args.sql as string, args.params as unknown[] | undefined);
  }

  if (name === "timecamping_data__execute") {
    return timecampingDataExecute(args.sql_script as string);
  }

  if (name === "timecamping_data__bulk_upsert") {
    return timecampingDataBulkUpsert(args.path as string);
  }

  if (name === "timecamping_data__migrate") {
    return timecampingDataMigrate();
  }

  if (name === "drafting_data__query") {
    return submissionDataQuery(
      args.db_path as string,
      args.sql as string,
      args.params as unknown[] | undefined
    );
  }

  if (name === "drafting_data__execute") {
    return submissionDataExecute(args.db_path as string, args.sql_script as string);
  }

  if (name === "drafting_data__create_writing") {
    return submissionDataCreateWriting(args as unknown as CreateWritingArgs, {
      caseDataRoot: once(() => caseDataRootFromDbPath(args.db_path as string, process.env)),
    });
  }

  if (name === "drafting_data__create_job_board") {
    return submissionDataCreateJobBoard(args as unknown as CreateJobBoardArgs);
  }

  if (name === "drafting_data__record_sent") {
    return submissionDataRecordSent(args as unknown as RecordSentArgs);
  }

  if (name === "drafting_data__record_filed") {
    return submissionDataRecordFiled(args as unknown as RecordFiledArgs);
  }

  if (name === "drafting_data__assign_job") {
    return submissionDataAssignJob(args as unknown as AssignJobArgs);
  }

  if (name === "drafting_data__approve_plan") {
    return submissionDataApprovePlan(args as unknown as ApprovePlanArgs);
  }

  if (name === "drafting_data__track_source") {
    return submissionDataTrackSource(args as unknown as TrackSourceArgs);
  }

  if (name === "drafting_data__release_job") {
    return submissionDataReleaseJob(args as unknown as ReleaseJobArgs);
  }

  if (name === "drafting_data__set_board_goal") {
    return submissionDataSetBoardGoal(args as unknown as SetBoardGoalArgs);
  }

  if (name === "drafting_data__delete_job") {
    return submissionDataDeleteJob(args as unknown as DeleteJobArgs);
  }

  if (name === "drafting_data__complete_job") {
    const { client, todos, dates } = await pageContext(context, args, true);
    return submissionDataCompleteJob(args as unknown as CompleteJobArgs, client, todos?.todos, dates);
  }

  if (name === "drafting_data__resnapshot_writing") {
    return resnapshotWriting(args.db_path as string, args.filing_id as number, {
      jurisdiction: args.jurisdiction as { country: string; jurisdiction: string } | undefined,
    });
  }

  if (name === "drafting_data__migrate") {
    return submissionDataMigrate(args.db_path as string);
  }

  if (name === "drafting_forms__board_card") {
    const { client, dates } = await pageContext(context, args, false);
    return submissionFormsBoardCard(args as unknown as BoardCardArgs, client, undefined, dates);
  }

  if (name === "drafting_forms__render" && args.proceeding_id !== undefined) {
    // ADR 0018: a proceeding with no filing has a Job Board of its own and nothing else to render.
    const filingOnly = ["filing_id", "render_mode", "documents", "appeal_deadline", "presentation_dir"].filter((k) => args[k] !== undefined);
    if (filingOnly.length > 0) {
      throw new ValidationError(`drafting_forms__render.proceeding_id takes no ${filingOnly.join(", ")} -- those are a filing's`);
    }
    const { client, todos, dates } = await pageContext(context, args, args.draft_dir !== undefined);
    const result = submissionFormsRenderProceedingBoard(
      args.db_path as string,
      args.proceeding_id as number,
      client,
      undefined, // `now` is test-only -- dispatch never pins the clock.
      args.session_token as string | undefined,
      args.draft_dir as string | undefined,
      todos?.todos,
      dates
    );
    if (todos) insertPhase(result.timings, "todos", todos.ms);
    logTimings(name, result.timings);
    return result;
  }

  if (name === "drafting_forms__render") {
    if (args.filing_id === undefined) throw new ValidationError("drafting_forms__render needs filing_id, or proceeding_id for a proceeding with no filing");
    // Only a render that writes presentation copies rewrites the Litigation Strategy, so only it reads the registry.
    const { client, todos, dates } = await pageContext(context, args, args.draft_dir !== undefined || args.presentation_dir !== undefined);
    const result = submissionFormsRender(
      args.db_path as string,
      args.filing_id as number,
      client,
      (args.render_mode as RenderMode | undefined) ?? "mockup",
      args.documents as string[] | undefined,
      args.appeal_deadline as string | undefined,
      args.presentation_dir as string | undefined,
      undefined, // `now` is test-only -- dispatch never pins the clock.
      args.session_token as string | undefined,
      args.draft_dir as string | undefined,
      todos?.todos,
      dates
    );
    if (todos) insertPhase(result.timings, "todos", todos.ms);
    logTimings(name, result.timings);
    // #589: a successful mockup render (rendered_at is set only then) tells the background job this
    // filing is done, and reports the job's status.
    if (result.rendered_at === undefined) return result;
    markRenderedInForeground(args.db_path as string, args.filing_id as number);
    return { ...result, background_job: backgroundJobStatus(args.db_path as string) };
  }

  if (name === "drafting_forms__bootstrap") {
    const { client, todos, dates } = await pageContext(context, args, args.draft_dir !== undefined);
    const result = submissionFormsBootstrap(
      args.db_path as string,
      client,
      undefined, // `now` is test-only -- dispatch never pins the clock.
      args.draft_dir as string | undefined,
      todos?.todos,
      args.unattended === true,
      dates
    );
    if (todos) insertPhase(result.timings, "todos", todos.ms);
    const started = performance.now();
    const background_job = startBootstrapJob(result, client, dates);
    addJobPhase(result.timings, started);
    logTimings(name, result.timings);
    return { ...result, background_job };
  }

  if (name === "drafting_forms__open_session") {
    const { result, dates, matterDescription } = await submissionFormsOpenSession(
      args.matter_root as string,
      context.practiceDb,
      clientContext(args),
      args.unattended === true,
      args.filing_id as number | undefined
    );
    // #589: matter_lookup's client fields are the identity bootstrap used, so the job renders with it.
    const { client_name, client_no, matter_no } = result.matter_lookup;
    const started = performance.now();
    const background_job = startBootstrapJob(result, { clientName: client_name, clientNo: client_no, matterNo: matter_no, matterDescription }, dates);
    addJobPhase(result.timings, started);
    logTimings(name, result.timings);
    return { ...result, background_job };
  }

  if (name === "drafting_forms__form_currency") {
    return formCurrency(args.form_key as string, nowStamp().slice(0, 10));
  }

  if (name === "drafting_forms__emit_form32") {
    return submissionFormsEmitForm32(args.db_path as string, args.filing_id as number, args.case_data_folder as string | undefined, {}, {
      lenient: args.lenient as boolean | undefined,
      cover_notes: args.cover_notes as string[] | undefined,
    });
  }

  if (name === "drafting_forms__emit_bcca_book") {
    return submissionFormsEmitBccaBook(args.db_path as string, args.filing_id as number);
  }

  if (name === "drafting_forms__emit_bcca_factum") {
    return submissionFormsEmitBccaFactum(args.db_path as string, args.filing_id as number, args.dated_on as string);
  }

  if (name === "drafting_forms__emit_form33") {
    return submissionFormsEmitForm33(args.db_path as string, args.filing_id as number, args.case_data_folder as string | undefined, {}, {
      lenient: args.lenient as boolean | undefined,
      cover_notes: args.cover_notes as string[] | undefined,
    });
  }

  if (name === "drafting_forms__emit_affidavit") {
    return submissionFormsEmitAffidavit(args.db_path as string, args.filing_id as number, args.document_id as number, args.case_data_folder as string | undefined);
  }

  if (name === "drafting_forms__bcsc_form_harness") {
    return bcscFormHarness(args as unknown as HarnessArgs);
  }

  if (name === "drafting_forms__publish_general") {
    return publishGeneral(args as unknown as PublishGeneralArgs);
  }

  if (name === "drafting_forms__draft_harness") {
    return draftHarness(args as unknown as DraftHarnessArgs);
  }

  if (name === "drafting_forms__read_message") {
    return readMessage(args as unknown as ReadMessageArgs);
  }

  if (name === "drafting_forms__reply_draft") {
    return replyDraft(args as unknown as ReplyDraftArgs);
  }

  if (name === "drafting_forms__publish_bcca_factum") {
    return publishBccaFactum(args as unknown as PublishBccaFactumArgs);
  }

  if (name === "drafting_forms__publish_vaniac_package") {
    return publishVaniacPackage(args as unknown as PublishVaniacArgs);
  }

  if (name === "drafting_forms__assemble_general") {
    return assembleGeneral(args as unknown as AssembleGeneralArgs);
  }

  if (name === "drafting_forms__pre_filing_check") {
    return submissionFormsPreFilingCheck(args.db_path as string, args.filing_id as number, args.package_dir as string);
  }

  if (name === "skill_source__read") {
    return skillSourceRead(
      args.path as string,
      undefined,
      args.from as string | undefined,
      args.match as string | string[] | undefined
    );
  }

  if (name === "skill_source__list") {
    return skillSourceList(
      (args.dir as string | undefined) ?? "",
      (args.recursive as boolean | undefined) ?? false
    );
  }

  if (name === "skill_rules__applicable") {
    return skillRulesApplicable(
      args.skill as string,
      args.operation as string,
      args.facts as Record<string, unknown> | undefined
    );
  }

  if (name === "skill_rules__coverage") {
    return skillRulesCoverage(args.skill as string);
  }

  if (name === "rules__at") {
    return rulesAt(args.skill as string, args.path, args.facts as Record<string, unknown> | undefined);
  }

  if (name === "rules__audit") {
    return rulesAudit(
      args.skill as string,
      args.path,
      args.rule_id as string | undefined,
      args.facts as Record<string, unknown> | undefined
    );
  }

  if (name === "rules__move") {
    return rulesMove(args as unknown as MoveArgs);
  }

  if (name === "rules__branch") {
    return rulesBranch(args as unknown as BranchArgs);
  }

  if (name === "rules__provisional") {
    return rulesProvisional(args as unknown as ProvisionalArgs);
  }

  if (name === "rules__lifecycle") {
    return rulesLifecycle(args.db_path as string, args.since as string | undefined);
  }

  if (name === "sources__check") {
    return checkSources(args.files);
  }

  if (name === "knowledge__read") {
    return knowledgeRead(args.path, matterRootSeams(name, args.matter_root));
  }

  if (name === "knowledge__list") {
    return knowledgeList(
      {
        dir: args.dir as string | undefined,
        recursive: args.recursive as boolean | undefined,
        resolve: args.resolve as string | undefined,
        recipient: args.recipient as string | undefined,
      },
      matterRootSeams(name, args.matter_root)
    );
  }

  if (name === "knowledge__write") {
    return knowledgeWrite(args, {
      lookUpMatter: async (mattNum) =>
        (await matter_lookup(context.practiceDb, { matt_num: mattNum })).rows,
    });
  }

  if (name === "knowledge__retire") {
    return knowledgeRetire(args);
  }

  if (name === "sources__fetch") {
    return sourcesFetch(args);
  }

  if (name === "repo_docs__write") {
    return repoDocsWrite(
      args.path as string,
      args.content as string,
      (args.overwrite as boolean | undefined) ?? false
    );
  }

  if (name === "repo_docs__read") {
    return repoDocsRead(args.path as string);
  }

  if (name === "research_filing__list_downloads") {
    return listDownloads(args.since_mtime as string | undefined, args.filename as string | undefined);
  }

  if (name === "research_filing__list_law_folder") {
    return listLawFolder(args.destination_dir as string);
  }

  if (name === "research_filing__file_download") {
    return fileDownload(
      args.destination_dir as string,
      args.source_filename as string,
      args.destination_filename as string | undefined
    );
  }

  if (name === "research_filing__append_manifest") {
    return appendManifest(args.destination_dir as string, args.record);
  }

  if (name === "research_filing__save_answer") {
    return saveAnswerTool(args as unknown as SaveAnswerArgs);
  }

  if (name === "research_filing__write_scratch") {
    return writeScratch(
      args.matter_root as string,
      args.filename as string,
      args.text as string,
      args.kind as string | undefined
    );
  }

  if (name === "research_filing__law_folder_text") {
    return lawFolderText(args.matter_root as string, args.destination_dir as string);
  }

  if (name === "research_filing__legislation_search") {
    return legislationSearch(args.matter_root as string, args.path as string, args.terms, args.regex, args.pages);
  }

  if (name === "research_filing__file_fetched") {
    return fileFetched(args.url as string, args.destination_dir as string, args.filename as string, args.record);
  }

  if (name === "research__preflight") {
    return researchPreflight();
  }

  if (name.startsWith("mail__")) {
    return callMailTool(context, name, args);
  }

  throw new ValidationError(`Unknown tool "${name}"`);
}

/** #579: stdout carries the MCP protocol, so the per-phase timings go to stderr, which the host keeps in the server's log. */
function logTimings(name: string, timings: PhaseTimings): void {
  console.error(`[timings] ${name} ${JSON.stringify(timings)}`);
}

/** #589: starting the background job is part of the call, so its phase goes in ahead of `total`, which
 * stays last and grows by it. */
function addJobPhase(timings: PhaseTimings, started: number): void {
  insertPhase(timings, "background_job", Math.round((performance.now() - started) * 10) / 10);
}

function insertPhase(timings: PhaseTimings, phase: string, ms: number): void {
  const total = timings.pop();
  timings.push({ phase, ms });
  if (total) timings.push({ phase: "total", ms: Math.round((total.ms + ms) * 10) / 10 });
}

/** ADR 0021 D1: the matter's open to-dos for the Litigation Strategy, read only when the call writes the
 * page, and timed as its own phase. #883: a call that does not restate matter_no reads the matter
 * named by the folder the page sits in, as open_session did, so it never wipes a populated list.
 * #893: that folder's matter is looked up as open_session looks it up, and the one resolved
 * identity is the call's client, so the page's header and its to-dos name the same matter. */
async function pageContext(
  context: DispatchContext,
  args: ReturnType<typeof validateToolInput>,
  writesPage: boolean
): Promise<{ client: ClientContext; todos?: { todos: MatterTodos; ms: number }; dates?: MatterDates }> {
  const client = clientContext(args);
  // ADR 0013, second 2026-10-04 amendment: a filing's linked deadlines are Goal criteria, so every
  // call that builds its section reads them, by the matter_no it was given, and board_summary and
  // board_card agree with the page.
  if (!writesPage) return { client, dates: await readMatterDates(context.practiceDb, client.matterNo) };
  const started = performance.now();
  // The page sits in <matter>/0. DRAFT, and a presentation folder is always that folder's child.
  const draftDir = (args.draft_dir as string | undefined) ?? dirname(args.presentation_dir as string);
  const resolved = (await lookUpMatter(dirname(draftDir), context.practiceDb, client)).client;
  // A folder the lookup could not match still reads its own token, as #883 did.
  const matterNo = resolved.matterNo ?? matterToken(dirname(draftDir)) ?? undefined;
  const todos = await readMatterTodos(context.practiceDb, matterNo);
  // ADR 0013, 2026-10-04 amendments: the Job Board's dates, timed with the to-dos. They go to the
  // page write alone, never into a response or a log line; a linked deadline goes to its filing's
  // section as a dateless criterion.
  const dates = await readMatterDates(context.practiceDb, matterNo);
  return { client: resolved, todos: { todos, ms: Math.round((performance.now() - started) * 10) / 10 }, dates };
}

function clientContext(args: ReturnType<typeof validateToolInput>): ClientContext {
  return {
    clientName: args.client_name as string | undefined,
    clientNo: args.client_no as string | undefined,
    matterNo: args.matter_no as string | undefined,
  };
}

/** A knowledge read's seams: with `matter_root`, the case data root derived from that matter's
 * pointer when the per-user coclerk.json is absent (shared/knowledge-tree.md section 6). */
function matterRootSeams(name: string, matterRoot: unknown): KnowledgeSeams | undefined {
  if (matterRoot === undefined) return undefined;
  if (typeof matterRoot !== "string") throw new ValidationError(`${name}.matter_root must be a string`);
  return { caseDataRoot: once(() => caseDataRootFromMatterRoot(matterRoot, process.env)) };
}

/** `fn`'s first outcome, value or error, replayed on every later call: locate runs several times per read. */
function once<T>(fn: () => T): () => T {
  let outcome: { value: T } | { error: unknown } | undefined;
  return () => {
    if (!outcome) {
      try {
        outcome = { value: fn() };
      } catch (error) {
        outcome = { error };
      }
    }
    if ("error" in outcome) throw outcome.error;
    return outcome.value;
  };
}

function toolDefinition(name: string): ToolDefinition {
  if (!definitions) {
    definitions = new Map(buildToolDefinitions().map((tool) => [tool.name, tool]));
  }
  const definition = definitions.get(name);
  if (!definition) throw new ValidationError(`Unknown tool "${name}"`);
  return definition;
}

function textResult(result: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}
