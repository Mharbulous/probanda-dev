// What the approval page says about each tool that checks its own approval (gate.ts). For a tool
// the approval hook also gates (approval_gate.py's CHECKS_OWN_APPROVAL), the sentences are copies of
// its ACTS and REVERSIBLE, which stay their source: test/approval.unit.test.mjs fails when a copy
// differs. drafting_data__merge_milestones is approved on the page alone.

type Fields = Record<string, unknown>;

interface Act {
  act: (f: Fields) => string;
  understand: string;
  warning: string;
}

const PREFIX = "By cutting and pasting this message I approve";

/** A value as the paste block shows it: a string with its runs of white space made single spaces. */
const v = (value: unknown): string => (typeof value === "string" ? value.split(/\s+/).filter(Boolean).join(" ") : String(value));

const ACTS: Record<string, Act> = {
  "mail__dedupe_apply": {
    act: (f) => `move ${v(f.expected_count)} duplicate email copies, listed in plan ${v(f.plan_id)}, to Trash`,
    understand: "They can be recovered from Trash, but the mail server may empty Trash on its own schedule.",
    warning: "**This step moves email to Trash: it can be recovered from there until the mail server empties " +
      "Trash on its own schedule.**",
  },
  "drafting_data__merge_milestones": {
    act: (f) => {
      const boards = (Array.isArray(f.boards) ? f.boards : []).map((b: Fields) =>
        b?.filing_id !== undefined ? `Work Board ${v(b.filing_id)}` : `the board of proceeding ${v(b?.proceeding_id)}`);
      const goal = typeof f.goal_statement === "string" && f.goal_statement.trim()
        ? `with this one goal: "${v(f.goal_statement)}"` : "with no goal yet, to be agreed later";
      return `merge ${boards.join(" and ")} into one Work Board, ${goal}`;
    },
    understand: "Each Writing stays a separate filing with its own documents and numbering. Only the Work Board page, " +
      "its view pages and its goal combine.",
    warning: "**This step joins two Work Boards into one. Probanda has no step that separates them again.**",
  },
};

/** The tools that check their own approval. */
export const APPROVAL_TOOLS = Object.keys(ACTS);

function entry(name: string): Act {
  const act = ACTS[name];
  if (!act) throw new Error(`no approval sentence for ${name}`);
  return act;
}

/** The paste block's first line for this call, as approval_gate.first_line gives it. */
export function firstLine(name: string, args: Fields): string {
  const act = entry(name);
  return `${PREFIX} this step: ${act.act(args)}. ${act.understand}`;
}

/** The bold warning the paste block is shown under, as approval_gate.refusal gives it. */
export function warning(name: string): string {
  return entry(name).warning;
}

/** The page's text for this call: the warning without its bold marks, and the step. */
export function pageText(name: string, args: Fields): { warning: string; step: string } {
  const act = entry(name);
  return { warning: act.warning.replace(/\*\*/g, ""), step: `This step: ${act.act(args)}. ${act.understand}` };
}
