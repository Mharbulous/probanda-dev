# matter-skeleton — copy the firm's folder template into a new matter

Read `../shared/conventions.md` first.

Reached only from `initialize.md`, when the matter root exists but has no
`4. LAWYER BRIEF\` directly beneath it. This operation owns a new matter's folder
skeleton (#481): initialize's root proof is the step that needs the skeleton, so the
skeleton's source is recorded beside it rather than in a separate skill.

1. **Confirm the root.** A missing `4. LAWYER BRIEF\` also means a wrong folder. Show
   the practitioner the `matter_root` path and copy nothing until they confirm it is
   the new matter's own folder.
2. **Resolve the template.** It is `<parent of matter_root>\ADMIN\0. TEMPLATE\L### Litigation\`.
   The parent is the practitioner's document root, the folder that also holds
   `0. CASE DATA`. In Cowork, request access to the template folder itself, never to
   the document root.
3. **If the template cannot be listed** (missing, moved, or access refused), stop and
   ask the practitioner where it is. Never build a skeleton from memory, from another
   matter, or from folder names written in any skill file.
4. **Copy.** List the template recursively. Recreate every subfolder at the same
   relative path under `matter_root` and copy every file it contains. Copy the
   template's contents, not the `L### Litigation` folder itself. Never rename the
   matter root or overwrite anything already in it. If no tool available to the
   session can create folders in the matter root, stop and hand the copy to the
   practitioner.
5. **Verify.** List the matter root recursively with a host-side listing (not the
   Cowork sandbox mount, which can return stale entries) and confirm every template
   entry now exists at its relative path, then return to initialize's root proof.
