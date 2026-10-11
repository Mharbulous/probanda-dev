<!-- node id=draft/job title="Getting a job" parents=draft/session when="A job is being got: a Ready job dispatched or an In Progress job named for take-over, through its checks and read-back, until the plan is stamped." -->
<!-- edge to=draft/job/work weight=0 -->
<!-- edge to=draft/done weight=0 -->

<!-- rule id=draft.shelve.own-job when=job_held:true provenance="rules-DAG 6.3 substitute, 2026-10-10: pilot acceptance tests 2 and 3, contextual-rule-injection spec 16" -->
- **The session's own job:** shelving it ("shelve job #N" about the job this session holds) or releasing it ("release job #N") is applied at once with no confirmation, because the typed instruction is the practitioner's own act. Shelving puts it in Shelved. Releasing puts it back in Ready, unshelved, keeping its plan and every step already done for the next session to inherit (`/drafting-data` §10). The release is one `drafting_data__release_job` call with this session's token: `released` re-renders, and any other outcome wrote nothing and is reported. Either way, re-render, and from then on the session holds no job and takes no other, though an on-the-fly revision or reorder stays available (`references/revise-on-the-fly.md`): its "what next?" is one line saying a new `/draft` session takes the next Ready job.

<!-- rule id=draft.shelve.never-offer when=job_held:true provenance="rules-DAG 6.3 substitute, 2026-10-10: pilot acceptance tests 2 and 3, contextual-rule-injection spec 16" -->
Both are received, never offered: the session never suggests or recommends letting go of its job, and an unattended run never does either. The one exception is the release that ends a spin-off of blocker jobs (`references/job-session.md`, "An obstacle on any assigned job"), offered only as part of that choice and never on its own.

<!-- rule id=draft.shelve.taken-over when=job_held:true provenance="rules-DAG 6.3 substitute, 2026-10-10: pilot acceptance tests 2 and 3, contextual-rule-injection spec 16" -->
If the confirming read shows the job was taken over meanwhile, nothing was written; a shelving then gets the decision form below, and a release is reported and goes no further.
