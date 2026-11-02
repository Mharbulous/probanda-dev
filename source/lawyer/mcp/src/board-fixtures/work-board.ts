// The Work Board's placeholder fixture (map #125, #141): hand-written synthetic data for a fixture-mode
// preview. No real person, entity or matter, and no machine path (#140). Every panel, a flag, a BF date,
// a non-billable matter and a read-failure note are present, so a preview shows each way a card draws.

import type { PracticeBoardData } from "../submission/forms/practice-board-shell.js";

export const WORK_BOARD_FIXTURE: PracticeBoardData = {
  meta: { rendered: "2026-01-15 09:00", today: "2026-01-15", horizon_days: 14 },
  panels: {
    overdue: [
      { kind: "deadline", label: "Serve list of documents", date: "2026-01-09", flag: null, bf_date: null, matter: "L4801", client: "Ashbourne", matter_status: "active", billable: true },
    ],
    due_today: [
      { kind: "deadline", label: "File application response", date: "2026-01-15", flag: null, bf_date: null, matter: "L4801", client: "Ashbourne", matter_status: "active", billable: true },
      { kind: "todo", label: "Call the client about the settlement offer", date: "2026-01-15", flag: null, bf_date: null, matter: "L4802", client: "Bramblewood", matter_status: "active", billable: true },
    ],
    coming_up: [
      { kind: "event", label: "Chambers hearing", date: "2026-01-20", flag: null, bf_date: null, matter: "L4801", client: "Ashbourne", matter_status: "active", billable: true },
      { kind: "deadline", label: "Reply to notice to admit", date: "2026-01-22", flag: "Provisional: depends on the date of service", bf_date: null, matter: "L4802", client: "Bramblewood", matter_status: "active", billable: true },
      { kind: "deadline", label: "Deliver expert report", date: "2026-01-27", flag: "Dates conflict", bf_date: null, matter: "L4803", client: "Cobblestone", matter_status: "active", billable: false },
    ],
    other: [
      { kind: "todo", label: "Update the conflicts register", date: null, flag: null, bf_date: "2026-02-02", matter: "A0001", client: "Firm", matter_status: null, billable: false },
      { kind: "todo", label: "Review the draft retainer letter", date: null, flag: null, bf_date: null, matter: "L4803", client: "Cobblestone", matter_status: "pending", billable: true },
    ],
  },
  notes: ["The deadlines for L4804 could not be read: the sample note a failed read shows."],
  conflicted: 1,
  excluded_test_matters: 1,
};
