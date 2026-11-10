# billing — Vision

`billing` owns two data pools: the timekeeping records (the evidence of what the lawyer did, sorted to matters, TimeCamp corrected and time entries drafted) and billing. It is optional. A practitioner who does not track time this way leaves it out and keeps firm records and trust in `lawyer`.

It requires `lawyer`, and names nothing in any other plugin. Its store tools stay in `lawyer`'s `data` server for now. Each store keeps its one gatekeeper: only `/timecamping-data` touches the timecamping database and only `/time-pipeline-data` touches the time-pipeline store.

The vision, the design principles and the anti-patterns that govern all the Probanda plugins are in the `VISION.md` of the `lawyer` plugin. They apply here unchanged.
