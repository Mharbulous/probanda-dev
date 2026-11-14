// What the approval page says about each tool that checks its own approval (gate.ts). The
// sentences are copies of ACTS and REVERSIBLE in source/skills/shared/scripts/approval_gate.py,
// which stays their source: test/approval.unit.test.mjs fails when a copy differs.

type Fields = Record<string, unknown>;

interface Act {
  act: (f: Fields) => string;
  understand: string;
  warning: string;
}

const PREFIX = "By cutting and pasting this message I approve";
const ONE_WAY_UNDERSTAND = "I understand it is one-way and irreversible.";
const ONE_WAY_WARNING = "**This step is a one-way door: easy to pass through and costly to reverse.**";

/** A value as the paste block shows it: a string with its runs of white space made single spaces. */
const v = (value: unknown): string => (typeof value === "string" ? value.split(/\s+/).filter(Boolean).join(" ") : String(value));

const ACTS: Record<string, Act> = {
  "mail__dedupe_apply": {
    act: (f) => `move ${v(f.expected_count)} duplicate email copies, listed in plan ${v(f.plan_id)}, to Trash`,
    understand: "They can be recovered from Trash, but the mail server may empty Trash on its own schedule.",
    warning: "**This step moves email to Trash: it can be recovered from there until the mail server empties " +
      "Trash on its own schedule.**",
  },
  "contacts__write_probe": {
    act: () => "test whether Probanda can change the address book: create one test contact that holds " +
      "nothing real, add a phone number to it, and remove it again",
    understand: "No other contact is changed, and the test contact is removed at the end.",
    warning: "**This step writes to your address book: it creates one test contact and removes it again.**",
  },
  "contacts__import_apply": {
    act: (f) => `add ${v(f.create_count)} new contact(s) to the address book and add details to ${v(f.update_count)} ` +
      `existing contact(s), as listed in plan ${v(f.plan_id)}, so the address book holds them. ` +
      "Probanda cannot take them out again",
    understand: ONE_WAY_UNDERSTAND,
    warning: ONE_WAY_WARNING,
  },
  "contacts__merge_apply": {
    act: (f) => `merge ${v(f.group_count)} group(s) of duplicate contacts in the address book, as listed in plan ` +
      `${v(f.plan_id)}, removing ${v(f.remove_count)} contact(s) after saving a copy of each on this computer`,
    understand: "A removed contact can be put back from its saved copy, but the address book has no Trash of its own.",
    warning: "**This step removes contacts from your address book after merging them: each can be put back from " +
      "the copy saved on this computer.**",
  },
  "contacts__restore_card": {
    act: (f) => `put the contact ${v(f.name)} back in the address book from the copy saved before it was merged`,
    understand: "It adds one contact and changes no other.",
    warning: "**This step adds a contact back to your address book.**",
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
