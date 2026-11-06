// Fenced-block tracking for the readers of a rendered document (CommonMark's rule): a fence closes only
// on a bare run of its own character at least as long as the one that opened it, so an excerpt line
// that starts with ``` stays inside the longer fence statementBlock (statement-lines.ts) prints round it.

/** The fence open after `line` ("" for none) and whether `line` is itself a fence line. */
export function fenceStep(open: string, line: string): { open: string; fence: boolean } {
  const run = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
  if (run === undefined) return { open, fence: false };
  if (open === "") return { open: run, fence: true };
  const closes = run[0] === open[0] && run.length >= open.length && line.trim() === run;
  return closes ? { open: "", fence: true } : { open, fence: false };
}
