// The Loose Threads page's placeholder fixture (map #125, #141): hand-written synthetic data for a
// fixture-mode preview, the meta and data renderViewPageHtml takes. No real person, entity or matter, and
// no machine path (#140). Its api block has port 0 and no token or database, as #138 sets for a preview,
// so the page shows its buttons disabled and writes nothing.

import type { LooseIdeasData } from "../submission/forms/loose-ideas-page.js";
import type { ViewPageMeta } from "../submission/view-pages.js";

export const LOOSE_THREADS_FIXTURE: { meta: ViewPageMeta; data: LooseIdeasData } = {
  meta: { filing: "Opening Submissions Package", matter: "L4801", client: "Ashbourne", revision: 12, rendered: "2026-01-15 09:00" },
  data: {
    groups: [
      { key: "decision", label: "Practitioner decisions", colour: "#6E4F8E", count: 1 },
      { key: "research", label: "Research", colour: "#8E6620", count: 1 },
    ],
    ideas: [
      { id: 1, rank: 1, idea: "The client prefers to settle before the hearing.", group: "decision", group_label: "Practitioner decisions", reason: "A decision already made shapes the reply.", job: "Draft a settlement offer letter.", surfaced_by: "draft", origin: "from Job #2", deferred_at: null },
      { id: 2, rank: 2, idea: "Is there authority on waiver of delivery by silence?", group: "research", group_label: "Research", reason: "The other side may argue waiver.", job: "Research waiver by silence.", surfaced_by: "legal-research", origin: null, deferred_at: null },
      { id: 3, rank: null, idea: "Consider a standing exhibit-numbering convention.", group: null, group_label: null, reason: null, job: null, surfaced_by: "draft", origin: "from Notice of Application for Document Production", deferred_at: null },
      { id: 4, rank: null, idea: "Ask whether the expert can report sooner.", group: null, group_label: null, reason: null, job: null, surfaced_by: "practitioner", origin: null, deferred_at: "2026-01-12T10:00" },
    ],
    resolved: [
      { id: 5, idea: "Check the limitation date.", how: "job", at: "2026-01-11T09:00", job_id: 7, job_title: "Confirm the limitation date" },
      { id: 6, idea: "Mention the weather on the day of delivery.", how: "discarded", at: "2026-01-10T15:00", job_id: null, job_title: null },
      { id: 7, idea: "The Work Board could show hearing dates.", how: "suggested", at: "2026-01-09T11:00", job_id: null, job_title: null },
    ],
    api: { port: 0, db_path: "", proceeding_id: 1, token: "" },
  },
};
