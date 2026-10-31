# TokenEconomizer in Cowork: keep state between sessions (Option B), or fall back (Option A)

Brahm's ruling of 2026-10-31: print-and-paste is for diagnosis only, and the adaptation either keeps
TokenEconomizer's state between Cowork sessions with no action from the user (Option B) or is shown
not to be feasible, in which case it falls back to the loop guard within a session (Option A).
Option A never runs unless Option B has been tried and failed.

Why this is needed, and the facts it rests on, are in
`docs/Specs/2026-10-28_tokeneconomizer-cowork-adaptation-spec.md`: the red run's R5 and facts
(nothing outlasts a Cowork session, a hook cannot reach the PC, the linked folder is visible from the
PC shell at `~/mnt/<folder name>`), spike test S2 (the model made a hook-asked tool call at 10 of 10
prompts, at about 400 tokens each) and the section "Persistence (Option B)", which holds the verdict.
The 2026-10-31 saves wrote to `~/te-cowork-runs`, the PC shell sandbox's own home, not under `~/mnt/`,
so they never reached the PC. This plan continues step e of
`docs/Plans/2026-10-29_tokeneconomizer-green-build.md`.

## Option B

```text
OPTION B: the model carries TokenEconomizer's state between Cowork sessions

Goal. After a one-time setup (linking one folder to the Cowork project), TokenEconomizer keeps its
learned envelope, ledger and events between Cowork sessions with no action from the user, and
records its own cost, so step e runs without pasting.

Design. A hook cannot reach the PC, but the model can, through the PC shell at
~/mnt/<linked folder>. The plugin's SessionStart hook asks the model to restore the state file
from the linked folder into /root/.tokeneconomizer. Its Stop hook asks the model to save every
5th turn and after any turn with a judge call. If the linked folder is missing, the ask says to
skip, and the plugin behaves exactly as it does today. Nothing is added to lawyer's data server.
Micro-skills facts are not carried: every Cowork session shares one state key (/home/claude), so
facts from different projects would mix.

Cheap tests first. Each is one Cowork session in te-cowork-test. Stop at the first FAIL and
record it in the spec's "Persistence (Option B)" section with its evidence.

B1. The linked folder reaches the PC. No code. Brahm links the folder te-cowork-runs in his PC
    home folder to te-cowork-test. A pasted prompt writes, through the PC shell, a one-line marker
    and a 3 KB base64 file to ~/mnt/te-cowork-runs/b1/. A PC session checks both files with
    sha256sum. PASS: both exist on the PC, byte-identical.
B2. The round trip a restore needs. No code. A new Cowork session reads the B1 files through the
    PC shell and writes them into /tmp in the container with its own shell. PASS: the sha256 in
    the container matches B1's.
B3. The fold counts tokens in Cowork. Fork code. Find why the 2026-10-31 fold recorded transcript
    null and "transcript unreadable" (the hook input on a Cowork resume), and fix it so the fold
    reads /root/.claude/projects/-home-claude/<session id>.jsonl. Fork test first, run by path.
    PASS: a Cowork session's ledger line has effective tokens. Both options need this, so a FAIL
    here is recorded but does not by itself favour Option A.
B4. The hook-asked carry is reliable and cheap. A probe release (patch) whose SessionStart hook
    asks for a restore and whose Stop hook asks for a save after every turn (every turn only for
    the test). Ten ordinary prompts. Record, per ask, whether the model did it, the tool calls it
    added and their effective tokens (from B3's ledger, or each call's size if B3 failed).
    PASS: at least 9 of 10 asks done, and a median of at most 2,000 effective tokens per save
    (a quarter of one side call, 8,067 in R4). Brahm can change the 2,000 before B4 runs.

Verdict. Option B passes when B1, B2 and B4 pass. Write "Option B verdict: PASS" or
"Option B verdict: FAIL (B<n>)" in the spec's "Persistence (Option B)" section, with the date
and each test's evidence. On FAIL, Brahm reads the evidence and rules, in the spec, whether to fall
back to Option A or try a changed Option B.

Build (only after PASS).
1. Fork: `te carry pack` writes a compact state file (envelope turns, ledger lines and events
   since the last save) and `te carry unpack <file>` restores it. The SessionStart and Stop hooks
   emit the asks, with the linked folder named in the hook command (TE_CARRY_FOLDER). The fixed
   envelope of 38 stays until 5 turns are learned. Fork tests by path, commit, push.
2. probanda-dev: refresh source/tokeneconomizer/ from the fork as CLAUDE.md's "TokenEconomizer"
   section says, set TE_CARRY_FOLDER in the six hook commands, release with /release (a patch:
   without the linked folder everything keeps working as before). The listing and README say how
   to link the folder.
3. Rerun step d's staged loop, then run step e from the carried state with no pasting.

Done. Two Cowork sessions in a row: the second restores the first's state without being asked
by Brahm, and its `te status --json` shows the first session's turns and ledger lines.
```

## Option A

```text
OPTION A: the loop guard within a session only (fallback)

Gate. This is the first act, and nothing else in this plan runs before it. Read the spec's
"Persistence (Option B)" section. Continue only if all three hold:
  1. it says "Option B verdict: FAIL", naming the failed test (B1, B2 or B4);
  2. each test that ran has its evidence recorded beside it;
  3. it records Brahm's ruling to fall back to Option A, dated on or after the verdict.
Otherwise stop, change nothing, and report "Option B has not been tried and failed; Option A not
started". A PASS verdict, a missing section, "not yet tried" or a missing ruling all stop here.

Goal. TokenEconomizer ships for Cowork as it is today: the loop guard acts within a session with
the fixed envelope of 38, learns nothing and keeps no record there, and the listing says so.

Steps.
1. Payback test (step e), once. Ten Cowork sessions, saved by hand at each session's end: through
   the linked folder if B1 passed, otherwise by print-and-paste. This is a one-off test, not
   product behaviour. Count redirects from events.jsonl as the plan's step e says.
2. Decide by step e's rule. If the guard does not repay its cost, Brahm rules what the plugin does
   in Cowork (for example, no Cowork install), and the listing says so.
3. If it repays: the marketplace description and the plugin README say that in Cowork it guards
   stuck turns within a session, learns nothing and keeps no record. The spec's conclusion and
   one line of CLAUDE.md's "TokenEconomizer" section say the same. Release with /release.

Done. The step e verdict and Brahm's ruling are in the spec, and the listing matches them.
```
