"""Tests for "work on loose threads": the held job works the threads without a pick question.

A session holding the job whose intent is working the loose threads asked which thread to take,
captured the reply as another loose thread and stopped. These pin the route that replaced that,
the exceptions it needs in the rules it crosses, and its routing.

Run: python -m pytest .claude/skills/draft/tests/test_loose_threads_work.py -q
"""

import re
import unittest
from pathlib import Path


DRAFT = Path(__file__).resolve().parents[1]
REFS = DRAFT / "references"
ROUTE = "**Working the threads without a pick.**"


def read(path):
    return path.read_text(encoding="utf-8")


def flat(text):
    return " ".join(text.split())


def atom(text, atom_id):
    """An atom's tag line and body, up to the next atom tag or heading."""
    start = text.index(f"<!-- atom id={atom_id} ")
    rest = text[start:]
    ends = [m.start() for m in re.finditer(r"\n(?:<!-- atom |#)", rest)]
    return rest[:ends[0]] if ends else rest


def tag(text, atom_id):
    line = re.search(rf"^<!-- atom id={re.escape(atom_id)} (.*?) -->$", text, re.M)
    return line.group(1)


def vocabulary(skill_text):
    """The operation and fact names SKILL.md's atom-vocabulary block declares."""
    block = skill_text[skill_text.index("<!-- atom-vocabulary -->"):skill_text.index("<!-- /atom-vocabulary -->")]
    ops, facts, mode = set(), {}, None
    for line in block.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if cells[0] in ("Operation", "Fact"):
            mode = cells[0]
            continue
        names = re.findall(r"`([^`]+)`", cells[0])
        if mode == "Operation":
            ops.update(names)
        elif mode == "Fact" and names:
            facts[names[0]] = re.findall(r"`([^`]+)`", cells[1])
    return ops, facts


class TriageRouteTest(unittest.TestCase):
    """(a), (b), (e): loose-thread-triage.md."""

    @classmethod
    def setUpClass(cls):
        cls.triage = read(REFS / "loose-thread-triage.md")
        start = cls.triage.index(ROUTE)
        cls.route = cls.triage[start:cls.triage.index("**Step 4.", start)]

    def bullet(self, opening):
        start = self.route.index(opening)
        end = self.route.find("\n", start)
        return self.route[start:end if end != -1 else None]

    def test_the_route_sits_between_step_3_and_step_4(self):
        self.assertLess(self.triage.index("**Step 3."), self.triage.index(ROUTE))
        self.assertLess(self.triage.index(ROUTE), self.triage.index("**Step 4."))

    def test_the_route_asks_no_pick_question(self):
        self.assertIn("Ask no question about which thread to take.", self.route)
        self.assertIn("The choice is the session's and is never asked.", self.route)
        self.assertIn("No pick question and no list of options.", self.route)

    def test_step_3_waits_unless_the_route_runs(self):
        step3 = self.triage[self.triage.index("**Step 3."):self.triage.index(ROUTE)]
        self.assertIn("Then wait, unless the route below is running.", step3)

    def test_step_4_covers_outlining_and_discarding_only(self):
        step4 = self.triage[self.triage.index("**Step 4."):self.triage.index("**Checking plugin threads")]
        self.assertIn("**Step 4. Outline or discard only on the practitioner's word.**", step4)
        self.assertIn("which threads to outline as jobs of their own and which to discard", step4)
        self.assertIn("Which thread the working route above takes is the session's choice, never asked here.", step4)
        self.assertNotIn("which threads to pursue", step4)

    def test_the_route_runs_on_the_instruction_or_in_the_held_job(self):
        self.assertIn("This route runs when the practitioner says to work on the loose threads, and in a session "
                      "whose held job's recorded intent is to work them, where a bare \"continue\" is enough.",
                      self.route)
        self.assertIn("Steps 4 and 5 do not run", self.route)
        self.assertIn("is never captured as a loose thread", self.route)

    def test_it_re_ranks_first_when_an_open_thread_is_unranked(self):
        rerank = self.bullet("- **Re-rank first.**")
        self.assertIn("When any open thread that is not deferred is unranked, run Step 2 in full", rerank)
        self.assertIn("then Step 3 without its wait", rerank)
        self.assertLess(self.route.index("- **Re-rank first.**"), self.route.index("- **Take the top thread:**"))

    def test_it_takes_the_top_thread_that_is_neither_deferred_nor_tooling(self):
        top = self.bullet("- **Take the top thread:**")
        self.assertIn("the best-ranked open thread that is neither deferred nor in the `tooling` group", top)
        self.assertIn("`tooling` threads stay for the Suggestion Box", top)
        self.assertIn("are not run through `references/suggestion-box.md` from here", top)

    def test_it_works_the_thread_inside_the_held_job(self):
        work = self.bullet("- **Work it inside the held job**")
        self.assertIn("No job is created for the thread.", work)
        self.assertIn("Never discard a thread here: a discard is Step 4's.", work)

    def test_it_consumes_the_thread_by_the_held_job_write(self):
        consume = self.bullet("- **Consume it**")
        self.assertIn("`/drafting-data`'s held-job consumption write "
                      "(\"Consuming a loose thread the held job worked\") with its confirm-read", consume)
        self.assertIn("A thread stopped part-way stays open.", consume)

    def test_it_reports_in_one_paragraph_or_less(self):
        report = self.bullet("- **Report in one paragraph or less:**")
        self.assertIn("the count of `tooling` threads left for the Suggestion Box", report)

    def test_discards_still_need_the_practitioners_yes(self):
        self.assertIn("Never infer a discard from a low rank.", self.triage)
        self.assertIn("- **Discard.** Applied only on their yes", self.triage)

    def test_the_triage_file_carries_no_atom_tag(self):
        self.assertNotIn("<!-- atom", self.triage)


class ExceptionsTest(unittest.TestCase):
    """(c), (d): the rules the route crosses state its one exception."""

    @classmethod
    def setUpClass(cls):
        cls.job_session = read(REFS / "job-session.md")
        cls.skill = read(DRAFT / "SKILL.md")

    def test_an_assigned_job_consumes_no_thread_but_the_loose_threads_job(self):
        rules = flat(atom(self.job_session, "draft.blocked-job.rules"))
        self.assertIn("Such a session outlines and consumes no loose thread, with one exception: a job whose intent "
                      "is working the loose threads works and consumes the threads it takes", rules)
        self.assertIn("and still creates no job for them. Every other assigned job is bound as before.", rules)

    def test_the_loose_threads_job_atom_exists(self):
        self.assertEqual(tag(self.job_session, "draft.execute.loose-threads-job"),
                         "ops=execute,plan_readback,pre_claim,route_reply when=job_held:true")
        body = flat(atom(self.job_session, "draft.execute.loose-threads-job"))
        self.assertIn("\"Working the threads without a pick\"", body)
        self.assertIn("it asks no pick question", body)
        self.assertIn("a bare \"continue\" included, is applied and never captured as a loose thread", body)

    def test_an_instruction_about_the_held_jobs_own_work_is_applied(self):
        ideas = flat(atom(self.skill, "draft.ideas"))
        self.assertIn("An instruction that directs how the held job does its own work is applied, not captured: "
                      "capture is for work outside the job.", ideas)
        self.assertIn("consumed only by a later outlining session, "
                      "or by the job whose intent is working the loose threads.", ideas)


class RoutingTest(unittest.TestCase):
    """(f): the opening route, Dispatch, and the references table."""

    def test_opening_routes_send_the_instruction_to_the_route(self):
        self.assertIn("- \"Work on the loose threads\" asked for, or any reply in a session whose held job's intent "
                      "is to work them: `references/loose-thread-triage.md`, \"Working the threads without a pick\".",
                      read(REFS / "opening-routes.md"))

    def test_dispatch_assigns_the_job_the_instruction_creates(self):
        dispatch = flat(atom(read(REFS / "dispatch.md"), "draft.dispatch"))
        self.assertIn("The instruction to work on the loose threads names the job it creates, so the session that "
                      "wrote that job is assigned it in the same turn", dispatch)

    def test_the_references_table_names_the_route(self):
        procedure = read(REFS / "procedure.md")
        self.assertEqual(tag(procedure, "draft.ref.loose-threads-work"), "ops=route_reply,execute")
        self.assertIn("| The practitioner says to work on the loose threads, or the held job's intent is to work them "
                      "(\"Working the threads without a pick\") | `references/loose-thread-triage.md` |",
                      atom(procedure, "draft.ref.loose-threads-work"))


class VocabularyTest(unittest.TestCase):
    """(h): every name on the two new atoms is declared. The full lint is rules-dag.draft-map.unit.test.mjs."""

    def test_the_new_atoms_use_only_declared_names(self):
        ops, facts = vocabulary(read(DRAFT / "SKILL.md"))
        for path, atom_id in ((REFS / "job-session.md", "draft.execute.loose-threads-job"),
                              (REFS / "procedure.md", "draft.ref.loose-threads-work")):
            parts = dict(p.split("=", 1) for p in tag(read(path), atom_id).split())
            for op in parts["ops"].split(","):
                with self.subTest(atom=atom_id, op=op):
                    self.assertIn(op, ops)
            for clause in filter(None, parts.get("when", "").split(",")):
                fact, value = clause.split(":")
                with self.subTest(atom=atom_id, fact=fact):
                    self.assertIn(value, facts[fact])


if __name__ == "__main__":
    unittest.main()
