<!-- node id=rdag/job title="A job" parents=rdag when="The practitioner picks a job to work" -->
<!-- edge to=rdag/job/release weight=0.12 -->

<!-- rule id=rdag.job.hold -->
First.

<!-- rule id=rdag.job.other overrides=rdag.job.hold reason="Same node" -->
Second.
