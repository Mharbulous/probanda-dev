---
name: rdag
description: Fixture skill for the rules-DAG lint tests.
---

<!-- atom id=rdag.core ops=always -->
A core rule that lives in SKILL.md.

<!-- atom-vocabulary -->
| Operation | Meaning |
|---|---|
| `release` | Letting go of a job |
| `obstacle` | An obstacle in a job |

| Fact | Values |
|---|---|
| `job_held` | `true`, `false` |
| `obstacle` | `none`, `in_job`, `separate_work` |
<!-- /atom-vocabulary -->

<!-- atom id=rdag.shelve.never-offer ops=release,obstacle when=job_held:true -->
Shelving and releasing are received, never offered.

<!-- atom id=rdag.obstacle.spin-off ops=obstacle,release when=obstacle:separate_work defeats=rdag.shelve.never-offer -->
On separate work, offer the spin-off and the release that ends it.
