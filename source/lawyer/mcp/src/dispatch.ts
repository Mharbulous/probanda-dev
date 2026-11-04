import { dirname } from "node:path";

import { DataServerError, ValidationError } from "./errors.js";
import { buildToolDefinitions } from "./schema-gen.js";
import { defineTool, dispatchFrom, jsonText, type Tool } from "./tool-list.js";
import type { ToolInput } from "./validate.js";
import type { PracticeStore } from "./practice/store.js";
import { callPracticeTool, practiceTools } from "./tools/practice/index.js";
import { matter_lookup } from "./tools/practice/reads.js";
import { caseDataQuery, caseDataExecute } from "./case/backend.js";
import { acquireCaseLock, matterRevision } from "./case/case-lock.js";
import { caseDataMigrate, type MigrateMode } from "./case/migrate.js";
import { caseDataRelocate, type RelocateMode } from "./case/relocate.js";
import { resolveParticipant } from "./case/resolve-participant.js";
import { ingestAuthority, type AuthorityIngestRequest } from "./case/ingest-authority.js";
import { stageResult } from "./case/stage-result.js";
import { assertLiveRun, dispatchInputs, ingestRun, type IngestRunArgs } from "./case/ingest-run.js";
import { ingestResult, type IngestResultArgs } from "./case/ingest-result.js";
import { generatorSql, type Generator } from "./case/execute-generator.js";
import { proceduralHistoryAppend, type ProceduralHistoryAppendArgs } from "./case/procedural-history.js";
import { relocateSource, type RelocateSourceRequest } from "./case/relocate-source.js";
import { housekeepingLog, type HousekeepingLogRequest } from "./case/housekeeping-log.js";
import { repointDocuments, type RepointDocumentsRequest } from "./submission/repoint-documents.js";
import {
  timePipelineGet,
  timePipelineSet,
  timePipelineList,
  timePipelineDelete,
  timePipelineBulkApply,
  timePipelineExport,
} from "./time-pipeline/backend.js";
import { timecampingDataQuery, timecampingDataExecute, timecampingDataBulkUpsert } from "./timecamping/backend.js";
import { timecampingCalls, type CallsArgs } from "./timecamping/calls.js";
import { timecampingDataMigrate } from "./timecamping/migrate.js";
import { submissionDataQuery, submissionDataExecute } from "./submission/backend.js";
import { submissionDataMigrate } from "./submission/migrate.js";
import { looseThreadsCapture, looseThreadsRead, looseThreadsUpdate, type CaptureArgs, type ReadArgs, type UpdateArgs } from "./loose-threads/tools.js";
import { submissionDataCreateWriting, type CreateWritingArgs } from "./submission/forms/layout-snapshot.js";
import { submissionDataCreateMilestone, type CreateMilestoneArgs } from "./submission/forms/create-milestone.js";
import { submissionDataMergeMilestones, type MergeMilestonesArgs } from "./submission/forms/merge-milestones.js";
import { submissionDataRecordFiled, type RecordFiledArgs } from "./submission/forms/filed-write.js";
import { submissionDataRecordServed, type RecordServedArgs } from "./submission/forms/served-write.js";
import { submissionDataAssignJob, type AssignJobArgs } from "./submission/forms/assign-job.js";
import { submissionDataTakeJob, type TakeJobArgs } from "./submission/forms/take-job.js";
import { submissionDataCreateJob, type CreateJobArgs } from "./submission/forms/create-job.js";
import { submissionDataApprovePlan, type ApprovePlanArgs } from "./submission/forms/approve-plan.js";
import { submissionDataTrackSource, type TrackSourceArgs } from "./submission/forms/track-source.js";
import { submissionDataSetStep, type SetStepArgs } from "./submission/forms/set-step.js";
import { submissionDataRewriteJob, type RewriteJobArgs } from "./submission/forms/rewrite-job.js";
import { submissionDataTouchJob, withJobActivity, type JobIdentity, type TouchJobArgs } from "./submission/forms/job-activity.js";
import { submissionDataCompleteJob, type CompleteJobArgs } from "./submission/forms/complete-job.js";
import { submissionDataAttachToBoard, type AttachToBoardArgs } from "./submission/forms/attach-to-board.js";
import { submissionDataReleaseJob, type ReleaseJobArgs } from "./submission/forms/release-job.js";
import { submissionDataSetBoardGoal, type SetBoardGoalArgs } from "./submission/forms/board-goals.js";
import { submissionDataRecordViewed, type RecordViewedArgs } from "./submission/forms/board-viewed.js";
import { submissionDataDeleteJob, type DeleteJobArgs } from "./submission/forms/delete-job.js";
import { submissionDataMergeJobs, type MergeJobsArgs } from "./submission/forms/merge-jobs.js";
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
import { submissionFormsApplyEdit, submissionFormsPreviewEdit, type ApplyEditArgs, type PreviewEditArgs } from "./submission/forms/quick-edit.js";
import { submissionFormsBoardCard, type BoardCardArgs } from "./submission/matter-pages.js";
import { submissionFormsFocusViewPage, type FocusViewPageArgs } from "./submission/forms/focus-view-page.js";
import { lookUpMatter, matterRootFor, matterToken, submissionFormsOpenSession } from "./submission/open-session.js";
import { inOneCall } from "./call-memo.js";
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
import { preferencesRead, preferencesWrite } from "./preferences/tools.js";
import { suggestionTools } from "./suggestions/tools.js";
import { repoDocsRead, repoDocsWrite } from "./files/repo-docs.js";
import { pagesPreview, pagesTemplate, type PreviewArgs } from "./pages/preview.js";
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
import { matterFolder, researchFolder, type MatterFolderArgs } from "./files/matter-folder.js";
import { pdfPageImages } from "./files/extract/page-images.js";
import { pdfPagesCompare } from "./files/extract/page-compare.js";
import { saveAnswerTool, type SaveAnswerArgs } from "./submission/forms/save-job-answer.js";
import { caseDataRootFromDbPath, caseDataRootFromMatterRoot } from "./files/matter-root.js";
import { keyRequestTools } from "./key-request/tools.js";
import type { KnowledgeSeams } from "./knowledge/tree.js";

export interface DispatchContext {
  // The practice store: practice.db's items (SQLite via host Python — spec §5/§10), read
  // locally with no cloud call; a write is saved only when Probanda's Cloud accepts it.
  practiceDb: PracticeStore;
}

type MatterArgs = { matter_root: string };

/** An inline sql_script in a run the orchestrator began is refused above this many bytes (est., spec §2.5). */
const INLINE_SQL_CAP = 8 * 1024;

// The data server's tools, paired with buildToolDefinitions by name (#183).
export const dataTools: Tool<DispatchContext>[] = [
  ...practiceTools.map(({ name }) =>
    defineTool(name, (args: ToolInput, context: DispatchContext) => callPracticeTool(context.practiceDb, name, args))),

  defineTool("matter_data__query", (args: MatterArgs & { sql: string; params?: unknown[] }) =>
    caseDataQuery(args.matter_root, args.sql, args.params)),
  defineTool("matter_data__execute", async (args: MatterArgs & { sql_script?: string; generator?: Generator; run_id?: string; expected_revision?: number }) => {
    if ((args.sql_script === undefined) === (args.generator === undefined)) {
      throw new ValidationError("matter_data__execute takes sql_script or generator, not both and not neither");
    }
    const sql = args.generator !== undefined ? generatorSql(args.matter_root, args.generator) : (args.sql_script as string);
    const runId = args.run_id;
    // The lease is checked inside the case lock, so a takeover cannot come between check and write
    // (N6). Spec §2.5: the inline cap binds only a run the orchestrator began, so D1's ingest paths
    // and large callers outside a run are unaffected (N3).
    const precheck = async () => {
      // Checked inside the case lock: the write lands against the state its caller showed the practitioner.
      if (args.expected_revision !== undefined && matterRevision(args.matter_root) !== args.expected_revision) {
        throw new DataServerError("This matter has changed since these changes were worked out, so they were not applied. Nothing was written.", "stale_revision");
      }
      if (runId === undefined) return;
      const run = await assertLiveRun(args.matter_root, runId);
      if (run.orchestrator && args.sql_script !== undefined && Buffer.byteLength(args.sql_script, "utf-8") > INLINE_SQL_CAP) {
        throw new ValidationError("too long to send inline: use a generator or ingest_result", "too_long");
      }
    };
    return caseDataExecute(args.matter_root, sql, process.env, precheck);
  }),
  defineTool("matter_data__ingest_run", (args: IngestRunArgs) => ingestRun(args)),
  defineTool("matter_data__ingest_result", (args: IngestResultArgs) => ingestResult(args)),
  defineTool("matter_data__dispatch_inputs", (args: { dispatch_id: string }) => dispatchInputs(args.dispatch_id)),
  defineTool("matter_data__resolve_participant", (args: MatterArgs & { name: string }) => resolveParticipant(args.matter_root, args.name)),
  defineTool("matter_data__stage_result", (args: { result: unknown }) => stageResult(args.result)),
  defineTool("matter_data__ingest_authority", (args: AuthorityIngestRequest) => ingestAuthority(args)),
  defineTool("matter_data__relocate_source", (args: RelocateSourceRequest) => relocateSource(args)),
  defineTool("matter_data__housekeeping_log", (args: HousekeepingLogRequest) => housekeepingLog(args)),
  defineTool("matter_data__procedural_history_append", async (args: ProceduralHistoryAppendArgs) => {
    // The file is read, edited and renamed, so two sessions must take turns (group locking spec 7.2).
    const lock = await acquireCaseLock(args.matter_root);
    try {
      return proceduralHistoryAppend(args);
    } finally {
      lock.release();
    }
  }),
  defineTool(
    "matter_data__migrate",
    (args: MatterArgs & { mode: string; plan_token?: string; user_confirmation?: string; backup_id?: string }) => {
      const mode = args.mode;
      if (!["plan", "apply", "restore", "backups"].includes(mode)) {
        throw new ValidationError(
          `matter_data__migrate: unknown mode ${JSON.stringify(mode)}; expected plan, apply, restore, or backups`
        );
      }
      return caseDataMigrate(args.matter_root, mode as MigrateMode, {
        planToken: args.plan_token,
        userConfirmation: args.user_confirmation,
        backupId: args.backup_id,
      });
    }
  ),
  defineTool("matter_data__relocate", (args: MatterArgs & { mode: string }) => {
    const mode = args.mode;
    if (!["plan", "apply"].includes(mode)) {
      throw new ValidationError(
        `matter_data__relocate: unknown mode ${JSON.stringify(mode)}; expected plan or apply`
      );
    }
    return caseDataRelocate(args.matter_root, mode as RelocateMode);
  }),

  defineTool("time_pipeline__get", (args: { namespace: string; key: string }) => timePipelineGet(args.namespace, args.key)),
  defineTool("time_pipeline__set", (args: { namespace: string; key: string; value: string }) =>
    timePipelineSet(args.namespace, args.key, args.value)),
  defineTool("time_pipeline__list", (args: { namespace: string; prefix?: string }) => timePipelineList(args.namespace, args.prefix)),
  defineTool("time_pipeline__delete", (args: { namespace: string; key: string }) => timePipelineDelete(args.namespace, args.key)),
  defineTool("time_pipeline__bulk_apply", (args: { namespace: string; path: string }) => timePipelineBulkApply(args.namespace, args.path)),
  defineTool("time_pipeline__export", (args: { namespace: string; prefix?: string; path: string }) =>
    timePipelineExport(args.namespace, args.prefix, args.path)),

  defineTool("timecamping_data__query", (args: { sql: string; params?: unknown[] }) => timecampingDataQuery(args.sql, args.params)),
  defineTool("timecamping_data__execute", (args: { sql_script: string }) => timecampingDataExecute(args.sql_script)),
  defineTool("timecamping_data__bulk_upsert", (args: { path: string }) => timecampingDataBulkUpsert(args.path)),
  defineTool("timecamping_data__calls", (args: CallsArgs, context: DispatchContext) => timecampingCalls(args, context.practiceDb)),
  defineTool("timecamping_data__migrate", () => timecampingDataMigrate()),

  defineTool("drafting_data__query", (args: { db_path: string; sql: string; params?: unknown[] }) =>
    submissionDataQuery(args.db_path, args.sql, args.params)),
  defineTool("drafting_data__execute", (args: { db_path: string; sql_script: string }) => submissionDataExecute(args.db_path, args.sql_script, process.env, true)),
  defineTool("loose_threads__capture", (args: CaptureArgs) => looseThreadsCapture(args)),
  defineTool("loose_threads__read", (args: ReadArgs) => looseThreadsRead(args)),
  defineTool("loose_threads__update", (args: UpdateArgs) => looseThreadsUpdate(args)),
  defineTool("drafting_data__repoint_documents", (args: RepointDocumentsRequest) => repointDocuments(args)),
  defineTool("drafting_data__create_writing", (args: CreateWritingArgs) =>
    submissionDataCreateWriting(args, {
      caseDataRoot: once(() => caseDataRootFromDbPath(args.db_path, process.env)),
    })),
  defineTool("drafting_data__create_milestone", (args: CreateMilestoneArgs) => submissionDataCreateMilestone(args)),
  defineTool("drafting_data__merge_milestones", (args: MergeMilestonesArgs) => submissionDataMergeMilestones(args)),
  defineTool("drafting_data__record_sent", (args: RecordSentArgs) => submissionDataRecordSent(args)),
  defineTool("drafting_data__record_filed", (args: RecordFiledArgs) => submissionDataRecordFiled(args)),
  defineTool("drafting_data__record_served", (args: RecordServedArgs) => submissionDataRecordServed(args)),
  defineTool("drafting_data__create_job", (args: CreateJobArgs) => submissionDataCreateJob(args)),
  defineTool("drafting_data__assign_job", (args: AssignJobArgs) => submissionDataAssignJob(args)),
  defineTool("drafting_data__take_job", (args: TakeJobArgs) => submissionDataTakeJob(args)),
  defineTool("drafting_data__approve_plan", (args: ApprovePlanArgs) => submissionDataApprovePlan(args)),
  defineTool("drafting_data__track_source", (args: TrackSourceArgs) => submissionDataTrackSource(args)),
  defineTool("drafting_data__set_step", (args: SetStepArgs) => submissionDataSetStep(args)),
  defineTool("drafting_data__rewrite_job", (args: RewriteJobArgs) => submissionDataRewriteJob(args)),
  defineTool("drafting_data__touch_job", (args: TouchJobArgs) => submissionDataTouchJob(args)),
  defineTool("drafting_data__release_job", (args: ReleaseJobArgs) => submissionDataReleaseJob(args)),
  defineTool("drafting_data__set_board_goal", (args: SetBoardGoalArgs) => submissionDataSetBoardGoal(args)),
  defineTool("drafting_data__record_viewed", (args: RecordViewedArgs) => submissionDataRecordViewed(args)),
  defineTool("drafting_data__delete_job", (args: DeleteJobArgs) => submissionDataDeleteJob(args)),
  defineTool("drafting_data__merge_jobs", (args: MergeJobsArgs) => submissionDataMergeJobs(args)),
  defineTool(
    "drafting_data__resnapshot_writing",
    (args: { db_path: string; filing_id: number; jurisdiction?: { country: string; jurisdiction: string } }) =>
      resnapshotWriting(args.db_path, args.filing_id, { jurisdiction: args.jurisdiction })
  ),
  defineTool("drafting_data__migrate", (args: { db_path: string }) => submissionDataMigrate(args.db_path)),
  defineTool("drafting_data__complete_job", async (args: CompleteJobArgs & PageArgs, context: DispatchContext) => {
    const { client, todos, dates } = await pageContext(context, args, true);
    return submissionDataCompleteJob(args, client, todos?.todos, dates);
  }),

  defineTool("drafting_data__attach_to_board", async (args: AttachToBoardArgs & PageArgs, context: DispatchContext) => {
    const { client, todos, dates } = await pageContext(context, args, true);
    return submissionDataAttachToBoard(args, client, todos?.todos, dates);
  }),

  defineTool("drafting_forms__board_card", async (args: BoardCardArgs & PageArgs, context: DispatchContext) => {
    const { client, dates } = await pageContext(context, args, false);
    return submissionFormsBoardCard(args, client, undefined, dates);
  }),
  defineTool("drafting_forms__focus_view_page", (args: FocusViewPageArgs) => submissionFormsFocusViewPage(args)),
  defineTool("drafting_forms__render", (args: RenderArgs, context: DispatchContext) =>
    args.proceeding_id !== undefined ? renderProceedingBoard(args, args.proceeding_id, context) : renderFiling(args, context)),
  defineTool("drafting_forms__preview_edit", (args: PreviewEditArgs) => submissionFormsPreviewEdit(args)),
  defineTool("drafting_forms__apply_edit", async (args: ApplyEditArgs & PageArgs, context: DispatchContext) => {
    const applied = await submissionFormsApplyEdit(args);
    if (!applied.applied || applied.filing_id === undefined) return applied;
    // Re-render as drafting_forms__render renders, so the session presents the new revision.
    const { preview_token: _token, ...renderArgs } = args;
    return { ...applied, render: await renderFiling({ ...renderArgs, filing_id: applied.filing_id }, context) };
  }),
  defineTool("drafting_forms__bootstrap", async (args: PageArgs & { db_path: string; unattended?: boolean }, context: DispatchContext) => {
    const { client, todos, dates } = await pageContext(context, args, args.draft_dir !== undefined);
    const result = submissionFormsBootstrap(
      args.db_path,
      client,
      undefined, // `now` is test-only -- dispatch never pins the clock.
      args.draft_dir,
      todos?.todos,
      args.unattended === true,
      dates
    );
    if (todos) insertPhase(result.timings, "todos", todos.ms);
    const started = performance.now();
    const background_job = startBootstrapJob(result, client, dates);
    addJobPhase(result.timings, started);
    return { ...result, background_job };
  }),
  defineTool(
    "drafting_forms__open_session",
    async (args: PageArgs & { matter_root?: string; project_id?: string; unattended?: boolean; filing_id?: number }, context: DispatchContext) => {
      // The Project's matter lookup shares the call's one practice snapshot; the job below starts outside it.
      const { result, dates, matterDescription } = await inOneCall(async () =>
        submissionFormsOpenSession(await matterRootFor(args, context.practiceDb), context.practiceDb, clientContext(args), args.unattended === true, args.filing_id)
      );
      // #589: matter_lookup's client fields are the identity bootstrap used, so the job renders with it.
      const { client_name, client_no, matter_no } = result.matter_lookup;
      const started = performance.now();
      const background_job = startBootstrapJob(result, { clientName: client_name, clientNo: client_no, matterNo: matter_no, matterDescription }, dates, true);
      addJobPhase(result.timings, started);
      return { ...result, background_job };
    }
  ),
  defineTool("drafting_forms__form_currency", (args: { form_key: string }) => formCurrency(args.form_key, nowStamp().slice(0, 10))),
  defineTool("drafting_forms__emit_form32", (args: EmitBcscFormArgs) =>
    submissionFormsEmitForm32(args.db_path, args.filing_id, args.case_data_folder, {}, {
      lenient: args.lenient,
      cover_notes: args.cover_notes,
    })),
  defineTool("drafting_forms__emit_bcca_book", (args: { db_path: string; filing_id: number }) =>
    submissionFormsEmitBccaBook(args.db_path, args.filing_id)),
  defineTool("drafting_forms__emit_bcca_factum", (args: { db_path: string; filing_id: number; dated_on: string }) =>
    submissionFormsEmitBccaFactum(args.db_path, args.filing_id, args.dated_on)),
  defineTool("drafting_forms__emit_form33", (args: EmitBcscFormArgs) =>
    submissionFormsEmitForm33(args.db_path, args.filing_id, args.case_data_folder, {}, {
      lenient: args.lenient,
      cover_notes: args.cover_notes,
    })),
  defineTool("drafting_forms__emit_affidavit", (args: { db_path: string; filing_id: number; document_id: number; case_data_folder?: string }) =>
    submissionFormsEmitAffidavit(args.db_path, args.filing_id, args.document_id, args.case_data_folder)),
  // Each of these takes `env` second, so the context is never passed through to it.
  defineTool("drafting_forms__bcsc_form_harness", (args: HarnessArgs) => bcscFormHarness(args)),
  defineTool("drafting_forms__publish_general", (args: PublishGeneralArgs) => publishGeneral(args)),
  defineTool("drafting_forms__draft_harness", (args: DraftHarnessArgs) => draftHarness(args)),
  defineTool("drafting_forms__read_message", (args: ReadMessageArgs) => readMessage(args)),
  defineTool("drafting_forms__reply_draft", (args: ReplyDraftArgs) => replyDraft(args)),
  defineTool("drafting_forms__publish_bcca_factum", (args: PublishBccaFactumArgs) => publishBccaFactum(args)),
  defineTool("drafting_forms__publish_vaniac_package", (args: PublishVaniacArgs) => publishVaniacPackage(args)),
  defineTool("drafting_forms__assemble_general", (args: AssembleGeneralArgs) => assembleGeneral(args)),
  defineTool("drafting_forms__pre_filing_check", (args: { db_path: string; filing_id: number; package_dir: string }) =>
    submissionFormsPreFilingCheck(args.db_path, args.filing_id, args.package_dir)),

  defineTool("skill_source__read", (args: { path: string; from?: string; match?: string | string[] }) =>
    skillSourceRead(args.path, undefined, args.from, args.match)),
  defineTool("skill_source__list", (args: { dir?: string; recursive?: boolean }) => skillSourceList(args.dir ?? "", args.recursive ?? false)),
  defineTool("skill_rules__applicable", (args: { skill: string; operation: string; facts?: Record<string, unknown> }) =>
    skillRulesApplicable(args.skill, args.operation, args.facts)),
  defineTool("skill_rules__coverage", (args: { skill: string }) => skillRulesCoverage(args.skill)),
  defineTool("rules__at", (args: { skill: string; path?: unknown; facts?: Record<string, unknown> }) => rulesAt(args.skill, args.path, args.facts)),
  defineTool("rules__audit", (args: { skill: string; path?: unknown; rule_id?: string; facts?: Record<string, unknown> }) =>
    rulesAudit(args.skill, args.path, args.rule_id, args.facts)),
  defineTool("rules__move", (args: MoveArgs) => rulesMove(args)),
  defineTool("rules__branch", (args: BranchArgs) => rulesBranch(args)),
  defineTool("rules__provisional", (args: ProvisionalArgs) => rulesProvisional(args)),
  defineTool("rules__lifecycle", (args: { db_path: string; since?: string }) => rulesLifecycle(args.db_path, args.since)),

  defineTool("sources__check", (args: { files?: unknown }) => checkSources(args.files)),
  defineTool("sources__fetch", (args: { url?: unknown; match?: unknown; save?: unknown }) => sourcesFetch(args)),

  defineTool("knowledge__read", (args: { path?: unknown; matter_root?: unknown }) =>
    knowledgeRead(args.path, matterRootSeams("knowledge__read", args.matter_root))),
  defineTool("knowledge__list", (args: { dir?: string; recursive?: boolean; resolve?: string; recipient?: string; matter_root?: unknown }) =>
    knowledgeList(
      { dir: args.dir, recursive: args.recursive, resolve: args.resolve, recipient: args.recipient },
      matterRootSeams("knowledge__list", args.matter_root)
    )),
  defineTool("knowledge__write", (args: ToolInput, context: DispatchContext) =>
    knowledgeWrite(args, {
      lookUpMatter: async (mattNum) =>
        (await matter_lookup(context.practiceDb, { matt_num: mattNum })).rows,
    })),
  defineTool("knowledge__retire", (args: ToolInput) => knowledgeRetire(args)),
  defineTool("preferences__read", (args: ToolInput) => preferencesRead(args)),
  defineTool("preferences__write", (args: ToolInput) => preferencesWrite(args)),

  ...suggestionTools,

  defineTool("pages__template", (args: { page: string }) => pagesTemplate(args.page)),
  defineTool("pages__preview", (args: PreviewArgs, context: DispatchContext) => pagesPreview(args, context.practiceDb)),

  defineTool("repo_docs__write", (args: { path: string; content: string; overwrite?: boolean }) =>
    repoDocsWrite(args.path, args.content, args.overwrite ?? false)),
  defineTool("repo_docs__read", (args: { path: string }) => repoDocsRead(args.path)),

  defineTool("research_filing__list_downloads", (args: { since_mtime?: string; filename?: string }) => listDownloads(args.since_mtime, args.filename)),
  defineTool("research_filing__list_law_folder", (args: { destination_dir: string }) => listLawFolder(args.destination_dir)),
  defineTool("research_filing__file_download", (args: JobIdentity & { destination_dir: string; source_filename: string; destination_filename?: string }) =>
    withJobActivity("research_filing__file_download", args, () =>
      fileDownload(args.destination_dir, args.source_filename, args.destination_filename))),
  defineTool("research_filing__append_manifest", (args: JobIdentity & { destination_dir: string; record?: unknown }) =>
    withJobActivity("research_filing__append_manifest", args, () => appendManifest(args.destination_dir, args.record))),
  defineTool("research_filing__save_answer", (args: SaveAnswerArgs) => saveAnswerTool(args)),
  defineTool("research_filing__write_scratch", (args: JobIdentity & { matter_root: string; filename: string; text: string; kind?: string }) =>
    withJobActivity("research_filing__write_scratch", args, () => writeScratch(args.matter_root, args.filename, args.text, args.kind))),
  defineTool(
    "research_filing__law_folder_text",
    (args: { matter_root: string; destination_dir: string; file?: unknown; pattern?: unknown; context?: unknown; max_matches?: unknown }) =>
      lawFolderText(args.matter_root, args.destination_dir, {
        file: args.file ?? undefined,
        pattern: args.pattern ?? undefined,
        context: args.context ?? undefined,
        max_matches: args.max_matches ?? undefined,
      })
  ),
  defineTool("research_filing__legislation_search", (args: { matter_root: string; path: string; terms?: unknown; regex?: unknown; pages?: unknown; pinpoint?: unknown }) =>
    legislationSearch(args.matter_root, args.path, args.terms, args.regex, args.pages, {}, args.pinpoint)),
  defineTool("research_filing__matter_folder", (args: MatterFolderArgs) => matterFolder(args)),
  defineTool("research_filing__research_folder", (args: MatterFolderArgs) => researchFolder(args)),
  defineTool("research_filing__file_fetched", (args: JobIdentity & { url: string; destination_dir: string; filename: string; record?: unknown }) =>
    withJobActivity("research_filing__file_fetched", args, () => fileFetched(args.url, args.destination_dir, args.filename, args.record))),
  defineTool("research__preflight", () => researchPreflight()),
  defineTool("pdf_pages__images", (args: { path: string; pages?: string; tiles?: boolean; destination_dir?: string }) =>
    pdfPageImages({ path: args.path, pages: args.pages, tiles: args.tiles, destination_dir: args.destination_dir })),
  defineTool("pdf_pages__compare", (args: { a: string; b: string; pages?: string; destination_dir: string }) =>
    pdfPagesCompare({ a: args.a, b: args.b, pages: args.pages, destination_dir: args.destination_dir })),

  ...keyRequestTools,
];

function replyText(name: string, result: unknown): string {
  if (!name.startsWith("rules__")) return jsonText(name, result);
  // The rules tools answer in XML for the model to read (rules-DAG spec §4.4), not JSON-encoded.
  if (typeof result !== "string") throw new DataServerError(`${name} returned a ${typeof result}, not its XML`, "internal_error");
  return result;
}

export const { call: callTool, dispatch: dispatchTool } = dispatchFrom(buildToolDefinitions, dataTools, replyText);

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

type PageArgs = { client_name?: string; client_no?: string; matter_no?: string; draft_dir?: string; presentation_dir?: string };

type RenderArgs = PageArgs & {
  db_path: string;
  filing_id?: number;
  proceeding_id?: number;
  render_mode?: RenderMode;
  documents?: string[];
  appeal_deadline?: string;
  session_token?: string;
};

type EmitBcscFormArgs = { db_path: string; filing_id: number; case_data_folder?: string; lenient?: boolean; cover_notes?: string[] };

async function renderProceedingBoard(args: RenderArgs, proceedingId: number, context: DispatchContext): Promise<unknown> {
  // ADR 0018: a proceeding with no filing has a Work Board of its own and nothing else to render.
  const filingOnly = (["filing_id", "render_mode", "documents", "appeal_deadline", "presentation_dir"] as const).filter((k) => args[k] !== undefined);
  if (filingOnly.length > 0) {
    throw new ValidationError(`drafting_forms__render.proceeding_id takes no ${filingOnly.join(", ")} -- those are a filing's`);
  }
  const { client, todos, dates } = await pageContext(context, args, args.draft_dir !== undefined);
  const result = submissionFormsRenderProceedingBoard(
    args.db_path,
    proceedingId,
    client,
    undefined, // `now` is test-only -- dispatch never pins the clock.
    args.session_token,
    args.draft_dir,
    todos?.todos,
    dates
  );
  if (todos) insertPhase(result.timings, "todos", todos.ms);
  return result;
}

async function renderFiling(args: RenderArgs, context: DispatchContext): Promise<unknown> {
  const filingId = args.filing_id;
  if (filingId === undefined) throw new ValidationError("drafting_forms__render needs filing_id, or proceeding_id for a proceeding with no filing");
  // Only a render under draft_dir or presentation_dir rewrites the Litigation Strategy, so only it reads the registry.
  const { client, todos, dates } = await pageContext(context, args, args.draft_dir !== undefined || args.presentation_dir !== undefined);
  const result = submissionFormsRender(
    args.db_path,
    filingId,
    client,
    args.render_mode ?? "mockup",
    args.documents,
    args.appeal_deadline,
    args.presentation_dir,
    undefined, // `now` is test-only -- dispatch never pins the clock.
    args.session_token,
    args.draft_dir,
    todos?.todos,
    dates
  );
  if (todos) insertPhase(result.timings, "todos", todos.ms);
  // #589: a successful mockup render (rendered_at is set only then) tells the background job this
  // filing is done, and reports the job's status.
  if (result.rendered_at === undefined) return result;
  markRenderedInForeground(args.db_path, filingId);
  return { ...result, background_job: backgroundJobStatus(args.db_path) };
}

/** ADR 0021 D1: the matter's open to-dos for the Litigation Strategy, read only when the call writes the
 * page, and timed as its own phase. #883: a call that does not restate matter_no reads the matter
 * named by the folder the page sits in, as open_session did, so it never wipes a populated list.
 * #893: that folder's matter is looked up as open_session looks it up, and the one resolved
 * identity is the call's client, so the page's header and its to-dos name the same matter. */
async function pageContext(
  context: DispatchContext,
  args: PageArgs,
  writesPage: boolean
): Promise<{ client: ClientContext; todos?: { todos: MatterTodos; ms: number }; dates?: MatterDates }> {
  const client = clientContext(args);
  // ADR 0013, second 2026-10-04 amendment: a filing's linked deadlines are Goal criteria, so every
  // call that builds its section reads them, by the matter_no it was given, and board_summary and
  // board_card agree with the page.
  if (!writesPage) return { client, dates: await readMatterDates(context.practiceDb, client.matterNo) };
  const started = performance.now();
  // The page sits in <matter>/0. DRAFT, and a Writing's folder is always that folder's child.
  const draftDir = args.draft_dir ?? dirname(args.presentation_dir as string);
  const resolved = (await lookUpMatter(dirname(draftDir), context.practiceDb, client)).client;
  // A folder the lookup could not match still reads its own token, as #883 did.
  const matterNo = resolved.matterNo ?? matterToken(dirname(draftDir)) ?? undefined;
  const todos = await readMatterTodos(context.practiceDb, matterNo);
  // ADR 0013, 2026-10-04 amendments: the Work Board's dates, timed with the to-dos. They go to the
  // page write alone, never into a response or a log line; a linked deadline goes to its filing's
  // section as a dateless criterion.
  const dates = await readMatterDates(context.practiceDb, matterNo);
  return { client: resolved, todos: { todos, ms: Math.round((performance.now() - started) * 10) / 10 }, dates };
}

function clientContext(args: PageArgs): ClientContext {
  return { clientName: args.client_name, clientNo: args.client_no, matterNo: args.matter_no };
}

/** A knowledge read's seams: with `matter_root`, the case data root derived from that matter's
 * pointer when the per-user probanda.json is absent (shared/knowledge-tree.md section 6). */
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
