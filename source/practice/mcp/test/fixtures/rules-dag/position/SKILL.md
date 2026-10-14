---
name: rpos
description: Fixture skill for the rules-position tests.
---

<!-- atom id=rpos.core ops=always -->
A core rule that lives in SKILL.md.

<!-- atom-vocabulary -->
| Operation | Meaning |
|---|---|
| `release` | Letting go of a job |

| Fact | Values |
|---|---|
| `job_held` | `true`, `false` |
| `job_steps` | `one`, `many` |
| `obstacle` | `none`, `in_job`, `separate_work` |
| `unattended` | `true`, `false` |
| `host` | `cowork`, `code`, `remote_device` |
<!-- /atom-vocabulary -->

<!-- atom id=rpos.release.never-offer ops=release when=job_held:true -->
Releasing is received, never offered.
