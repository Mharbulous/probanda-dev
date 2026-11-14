// Test helper: a tool that checks its own approval (src/approval/gate.ts) runs here as it runs
// after the practitioner's pasted approval, with the proof the approval hook adds. Run the tests
// with APPDATA set to a scratch folder, so the device secret is a scratch one.

const { proofFor } = await import("../build/approval/gate.js");
const { APPROVAL_TOOLS } = await import("../build/approval/acts.js");

/** `args` with the hook's proof added, for a tool that checks its own approval. */
export const withProof = (name, args = {}) =>
  APPROVAL_TOOLS.includes(name) ? { ...args, approval_proof: proofFor(name, args, process.env) } : args;

/** A server's call or dispatch function that adds the proof to every gated call. */
export const approved = (fn) => (context, name, args) => fn(context, name, withProof(name, args));
