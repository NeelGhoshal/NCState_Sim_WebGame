// Placeholder content filter: a short word list applied to player input and model output.
// Phase 1 replaces this once the age rating is decided.
const BLOCKED = [
  /\bn[i1]gg/i, /\bf[a@]gg?[o0]t/i, /\bretard/i, /\bkill (yo)?ur ?self\b/i, /\bkys\b/i,
  /\brape\b/i, /\bporn/i, /\bnude/i, /\bsex(ual|ually)?\b/i, /\bcocaine\b/i, /\bmeth\b/i,
];

export function blocked(text: string): boolean {
  return BLOCKED.some((re) => re.test(text));
}
