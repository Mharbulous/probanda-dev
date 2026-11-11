// Dispatch for the billing plugin's `timekeeping` server (src/timekeeping-index.ts): the
// time_pipeline__* store tools, the review_date__* records (issue 284) and the time_review__* day
// records (build plan slice 5), and nothing else.
// Kept apart from dispatch.ts so the `timekeeping` bundle holds only the modules these tools use.
import type { BulkApplyExpect } from "./kv/backend.js";
import { buildTimekeepingToolDefinitions } from "./schema-gen.js";
import { defineTool, dispatchFrom, type ToolReply } from "./tool-list.js";
import {
  timePipelineBulkApply,
  timePipelineDelete,
  timePipelineExport,
  timePipelineGet,
  timePipelineList,
  timePipelineSet,
} from "./time-pipeline/backend.js";
import {
  reviewDateClaim,
  reviewDateExport,
  reviewDateImportFile,
  reviewDateJudge,
  reviewDateRelease,
  reviewDateRenew,
  reviewDateStatus,
} from "./time-pipeline/review-date.js";
import { serveReviewPage, waitClick } from "./time-review/server.js";
import { timeReviewReadDay, timeReviewSaveEvidence, timeReviewStageDay } from "./time-review/tools.js";

type DateToken = { date: string; token: string };

// Dispatch never passes the review-date seams: the clock is the real one and env is process.env.
const tools = [
  defineTool<{ namespace: string; key: string }>("time_pipeline__get", (args) => timePipelineGet(args.namespace, args.key)),
  defineTool<{ namespace: string; key: string; value: string; expect_sha256?: string; expect_absent?: boolean }>(
    "time_pipeline__set",
    (args) => timePipelineSet(args.namespace, args.key, args.value, { expect_sha256: args.expect_sha256, expect_absent: args.expect_absent })
  ),
  defineTool<{ namespace: string; prefix?: string }>("time_pipeline__list", (args) => timePipelineList(args.namespace, args.prefix)),
  defineTool<{ namespace: string; key: string; expect_sha256?: string }>("time_pipeline__delete", (args) =>
    timePipelineDelete(args.namespace, args.key, process.env, args.expect_sha256)
  ),
  defineTool<{ namespace: string; path: string; preview?: boolean; expect?: BulkApplyExpect }>("time_pipeline__bulk_apply", (args) =>
    timePipelineBulkApply(args.namespace, args.path, args)
  ),
  defineTool<{ namespace: string; prefix?: string; path: string }>("time_pipeline__export", (args) =>
    timePipelineExport(args.namespace, args.prefix, args.path)
  ),

  defineTool<{ date: string; holder: string }>("review_date__claim", (args) => reviewDateClaim(args.date, args.holder)),
  defineTool<DateToken>("review_date__renew", (args) => reviewDateRenew(args.date, args.token)),
  defineTool<DateToken>("review_date__judge", (args) => reviewDateJudge(args.date, args.token)),
  defineTool<DateToken>("review_date__release", (args) => reviewDateRelease(args.date, args.token)),
  defineTool<{ dates: string[] }>("review_date__status", (args) => reviewDateStatus(args.dates)),
  defineTool<{ from: string; to: string; out_path: string }>("review_date__export", (args) =>
    reviewDateExport(args.from, args.to, args.out_path)
  ),
  defineTool<{ path: string; judged_by: string; dry_run: boolean }>("review_date__import_file", (args) =>
    reviewDateImportFile(args.path, args.judged_by, args.dry_run)
  ),

  defineTool<{ date: string; sources: unknown[]; rows: unknown[] }>("time_review__save_evidence", (args) =>
    timeReviewSaveEvidence(args.date, args.sources, args.rows)
  ),
  defineTool<{ date: string; token: string; blocks: unknown[] }>("time_review__stage_day", (args) =>
    timeReviewStageDay(args.date, args.token, args.blocks)
  ),
  defineTool<{ date: string }>("time_review__read_day", (args) => timeReviewReadDay(args.date)),
  defineTool<{ screens_dir?: string }>("time_review__serve_page", (args) => serveReviewPage(args.screens_dir)),
  defineTool<Record<string, never>>("time_review__wait_click", () => waitClick()),
];

const server = dispatchFrom(buildTimekeepingToolDefinitions, tools);

export function dispatchTimekeepingTool(name: string, rawArgs: unknown): Promise<ToolReply> {
  return server.dispatch(undefined, name, rawArgs);
}

export function callTimekeepingTool(name: string, rawArgs: unknown): Promise<unknown> {
  return server.call(undefined, name, rawArgs);
}
