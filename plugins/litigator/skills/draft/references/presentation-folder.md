Read when: session entry reported no draft folder, a render refuses with draft_dir_missing or presentation_dir_ambiguous, a render returns writing_folder_rename, or this session retitled a Writing (SKILL.md section 11, "The Writing's folder").
Assumes SKILL.md is loaded. Rules are not restated here.

## Section 11: The Writing's folder, case by case

- No draft folder at session entry: fail loudly ("no draft folder in {matter}"). Never create it.
- A render refuses with `draft_dir_missing`: the matter has no `0. DRAFT` folder beside its own `0. CASE DATA`. Say so in one line. When the matter's case data is still under the firm's `0. CASE DATA` folder, route it to `/matter-data` relocate, then render again. Never write a mockup anywhere else.
- None, or one found: the render uses it, creating the folder named after the Writing's title if needed. Nothing to do.
- Two or more (refused, `presentation_dir_ambiguous`, each candidate named): ask which, then pass that one as `presentation_dir`, once. The server records it, so later renders find it with `draft_dir` again. Name the rest in one line and leave them untouched.
- A render returns `writing_folder_rename` `{from, to}`: the Writing's folder still has the name an older build gave it, with its type's code, because it holds a file the renderer did not write. Offer the practitioner the rename from `from` to `to` in one question. On a yes, rename it with `file_ops__move`. If `file_ops__move` is not available in this session, the `file-manager` plugin is not enabled: tell the practitioner this step renames a folder and needs `file-manager`, and leave it. Never fall back to a shell move. On a no, leave it: the server keeps using it.
- After this session retitles a Writing, its folder keeps its name, and the mockups in it take the new title. Rename the folder only when the practitioner asks, as above.
