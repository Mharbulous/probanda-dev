# billing — Vision

`billing` owns two data pools: the timekeeping records (the evidence of what the lawyer did, sorted to matters, TimeCamp corrected and time entries drafted) and billing. It is optional. A practitioner who does not track time this way leaves it out and keeps firm records and trust in `lawyer`.

It requires `lawyer`, and names nothing in any other plugin. Its `timekeeping` server serves the time-pipeline store (`time_pipeline__*`) and the per-date review records (`review_date__*`). Its other store tools stay in `lawyer`'s `data` server for now. Each store keeps its one gatekeeper: only `/timecamping-data` touches the timecamping database and only `/time-pipeline-data` touches the time-pipeline store.

Billing's core dependency is its `timekeeping` server. TimeCamp is one optional source of time evidence. Nothing the `timekeeping` server serves may need TimeCamp. No new work may add a TimeCamp name to that server or make any billing step newly require a TimeCamp account. The TimeCamp names the server already carries are known debt, frozen by `source/lawyer/mcp/test/timekeeping-timecamp-names.unit.test.mjs`, which the map "Billing without TimeCamp" retires (issue 283, directed 2026-11-10).

The vision, the design principles and the anti-patterns that govern all the Probanda plugins are in the `VISION.md` of the `lawyer` plugin. They apply here unchanged.
