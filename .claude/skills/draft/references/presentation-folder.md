Read when: session entry reported no draft folder, a render refuses with presentation_dir_dated or presentation_dir_ambiguous, or this session retitled a Writing (SKILL.md section 11, "The presentation folder").
Assumes SKILL.md is loaded. Rules are not restated here.

## Section 11: The presentation folder, case by case

- No draft folder at session entry: fail loudly ("no draft folder in {matter}"). Never create it.
- None, or one undated: the render uses it, creating the undated one if needed. Nothing to do.
- One dated (refused, `presentation_dir_dated`): if renameable, rename it to the undated form and render again with `draft_dir`. In Cowork, request access to the draft folder itself for the rename, never to the matter root or a parent. If not renameable, ask the practitioner to rename by hand, or say it stays. If it stays, render into it once by passing it as `presentation_dir` instead of `draft_dir`, and note the dated name in one line.
- Two or more (refused, `presentation_dir_ambiguous`, each candidate named): ask which, then treat that one as the single case. If the undated name is taken, it stays. Pass it, renamed or not, as `presentation_dir`, never `draft_dir` again, which would refuse the same way. Name the rest in one line and leave them untouched.
- After this session retitles a Writing, rename its old presentation folder (the folder of the presentation paths an earlier render returned) to end with the new title, under the same safeguard, before the next render. The server matches only the current title.
