# Tests

Run everything with `node scripts/test.mjs` after a build (`npm test` builds first), or one tier with `node scripts/test.mjs unit`. The runner prints the five slowest files on every run.

Three rules:

1. **Start from the template database.** A test that needs a migrated submission database calls `freshSubmissionDb(dbPath)` from `helpers/template-db.mjs`, which copies a database migrated once per schema change. Only a test whose subject is migration itself calls `submissionDataMigrate` directly.
2. **Pick the tier by filename suffix.** `*.unit.test.mjs` uses no Python and no browser. `*.db.test.mjs` uses host Python and SQLite. `*.e2e.test.mjs` drives a browser, a spawned server or the render job's child processes, and runs one file at a time. A test file without one of these suffixes fails the run.
3. **Stay in budget.** A unit file must finish within 5 s, and each db test within 30 s, timed in its tier. Going over fails the run, except under the CI switch below. A test that migrates its own database instead of copying the template is the usual cause. The budgets are tuned to the local machine, so CI sets `COCLERK_TEST_NO_BUDGETS=1` (only the exact value `1` counts): the runner still prints each over-budget line, marked "not enforced", and only a test failure fails the run. Never set it locally.
