# Conforming a BC Supreme Court form to an amendment

Repo session only. A template, emitter, renderer or type file changes only in the repository, and reaches an install only through a repackage. A session in Cowork or on an installed plugin that meets a `form_currency` warning says it and stops here.

The warning comes from `drafting_forms__form_currency` (ADR 0038). It names the form and the amending regulation, and says nothing about what changed. This checklist finds the change by a diff and states none of it.

1. **Name the form and the regulation** from the warning. Get the official text of the new form: the amending order's schedule saved on disk (B.C. Reg. 105/2026 is `Engineering/bcsc-rules-inputs/oic-264-2026.txt`: Forms 17, 32 and 33 from line 261, Form 33.01 from line 472, Forms 68 and 117.1 from line 530), or the form's page on bclaws through `sources__fetch`.
2. **Diff the official text** against each shipped piece of the form:
   - the Word template named by the identity file's `template` (dump its text);
   - the emitter, `source/probanda/mcp/src/submission/forms/render-form32-filed-face.ts` or `render-form33-filed-face.ts`, and its golden, `source/probanda/mcp/test/fixtures/form-32-emitted.md` or `form-33-emitted.md`;
   - the mockup renderer, `render-notice-of-application.ts` or `render-application-response.ts`;
   - the type file, `.claude/skills/draft/references/CAN/BC/BCSC/Documents/notice-of-application.md` or `application-response.md`.
3. **Update** the template, emitter, renderer, type file, `assembly-input-contract.md` (beside this file) and their tests. Where the identity file carries a "Form instructions" table (Form 32), list each bracketed instruction of the new form in it, verbatim, with the check that proves it. Regenerate each golden only after reading its diff.
4. **Record conformance** on the form's identity file, `.claude/skills/publish/references/CAN/BC/BCSC/Documents/<stem>.md`: append the regulation under `conformed_to:` as a block-list item (`  - B.C. Reg. 105/2026`), and set `version` and `version_source` when the official PDF is saved. Add `page_url` only when a source is truly recorded.
5. **Touch `rule-freshness.json` only to delete the entry**, once its `sections` is empty and every form in its `forms` is conformed (`shared/docket-clerk/references/rule-freshness.md`, Snapshot maintenance).
6. **Ship:** build and run the form's tests, `npm run bundle` in an isolated copy, commit, then `/repackage`.
