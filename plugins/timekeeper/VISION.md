# timekeeper — Vision

`timekeeper` owns automated time tracking: capturing the evidence of what the lawyer did, sorting it to matters, correcting TimeCamp and drafting time entries. It is optional. A practitioner who does not track time this way leaves it out and keeps firm records, billing, invoices and trust in `lawyer`.

It requires `lawyer`, and names nothing in any other plugin. Its tools stay in `lawyer`'s `data` server for now. Each store keeps its one gatekeeper: only `/timecamping-data` touches the timecamping database and only `/time-pipeline-data` touches the time-pipeline store.

The vision, the design principles and the anti-patterns that govern all the Probanda plugins are in the `VISION.md` of the `lawyer` plugin. They apply here unchanged.
