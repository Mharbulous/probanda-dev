<!-- node id=rpos/job title="A job" parents=rpos/session when="A job is being got" -->
<!-- edge to=rpos/job/work weight=0.7 -->

<!-- rule id=rpos.job.hold when=job_held:true -->
Job rule H: releasing is received, never offered.

<!-- rule id=rpos.job.steps when=job_steps:many -->
Job rule M: read the plan back step by step.
