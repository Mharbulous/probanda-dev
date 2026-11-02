import { practiceToolDefinitions } from "./schema/practice.js";
import { caseDataToolDefinitions } from "./schema/case-data.js";
import { timePipelineToolDefinitions } from "./schema/time-pipeline.js";
import { looseThreadsToolDefinitions } from "./schema/loose-threads.js";
import { timecampingToolDefinitions } from "./schema/timecamping.js";
import { fileToolDefinitions } from "./schema/file.js";
import { submissionDataToolDefinitions } from "./schema/submission-data.js";
import { submissionFormsToolDefinitions } from "./schema/submission-forms.js";
import { fileOpsToolDefinitions } from "./schema/file-ops.js";
import { housekeepingToolDefinitions } from "./schema/housekeeping.js";
import { mailToolDefinitions } from "./schema/mail.js";
import { calendarToolDefinitions } from "./schema/calendar.js";
import { contactsToolDefinitions } from "./schema/contacts.js";
import { cloudKeyToolDefinitions } from "./schema/cloud-key.js";
import { suggestionToolDefinitions } from "./schema/suggestions.js";
import type { ToolDefinition } from "./schema/shared.js";

export type { ToolDefinition } from "./schema/shared.js";
export {
  practiceToolDefinitions,
  caseDataToolDefinitions,
  timePipelineToolDefinitions,
  looseThreadsToolDefinitions,
  timecampingToolDefinitions,
  fileToolDefinitions,
  submissionDataToolDefinitions,
  submissionFormsToolDefinitions,
  fileOpsToolDefinitions,
  housekeepingToolDefinitions,
  mailToolDefinitions,
  calendarToolDefinitions,
  contactsToolDefinitions,
  cloudKeyToolDefinitions,
};

// The one tool list every host and every session sees: local-backed practice
// tools, local-backed matter-data tools, and the host-side file surface. This
// litigation runtime has no Supabase surface and no layer-3 legal-commons
// namespace. The application-state/application-engine namespaces (Phase 2,
// decision memo Option C) retired 2026-08-27 (#374) with the application
// pipeline they served.
export function buildToolDefinitions(): ToolDefinition[] {
  return [
    ...practiceToolDefinitions(),
    ...caseDataToolDefinitions(),
    ...timePipelineToolDefinitions(),
    ...looseThreadsToolDefinitions(),
    ...timecampingToolDefinitions(),
    ...submissionDataToolDefinitions(),
    ...submissionFormsToolDefinitions(),
    ...fileToolDefinitions(),
    ...cloudKeyToolDefinitions(),
    ...suggestionToolDefinitions(),
  ];
}

// The lawyer plugin's `contacts-calendars-email` server: the mail, calendar and
// contacts tools, apart from the data server so the app lists them as their own connector.
export function buildContactsCalendarsEmailToolDefinitions(): ToolDefinition[] {
  return [
    ...mailToolDefinitions(),
    ...calendarToolDefinitions(),
    ...contactsToolDefinitions(),
  ];
}

// The file-manager plugin's `files` server: every tool that renames, moves or
// deletes a user's file (docs/Plans/2026-10-14_file-admin-plugin.md).
export function buildFileManagerToolDefinitions(): ToolDefinition[] {
  return [
    ...fileOpsToolDefinitions(),
    ...housekeepingToolDefinitions(),
  ];
}
