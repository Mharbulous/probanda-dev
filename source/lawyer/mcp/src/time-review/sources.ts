// The assembly gate's sources, by table name: the `expected_sources` list of
// timecamping-data/references/splice.sql (a test holds the two together). Kept apart from the store
// code so the tool schema can name them without pulling the store into every bundle.
export const GATE_SOURCES = [
  "timecamp_time_entries",
  "timecamp_computer_activities",
  "syncopaid_captures",
  "telus_calls",
  "gcal_events",
  "icloud_events",
  "sent_mail",
] as const;
export type GateSource = (typeof GATE_SOURCES)[number];

/** The statuses the gate counts as an outcome (splice.sql `missing`). Any other status is a source
 * still short. */
export const TERMINAL_STATUSES = ["fetched", "empty", "skipped"] as const;
