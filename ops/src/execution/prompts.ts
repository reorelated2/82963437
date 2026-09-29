/**
 * Versioned prompt modules. The planner uses deterministic code for state,
 * ranking, and safety. These modules are the language rules the drafts must pass.
 * Bump the version when a client-facing rule changes, and keep the regression
 * test in ops/test/execution-desk.test.ts pointed at that version.
 */
export const PROMPT_MODULES = [
  { id: 'kyleos-system-policy', version: '2026-09-29.1', rule: 'DRY_RUN stays on. A draft is not a send. Inference is not a fact.' },
  { id: 'kyle-communication-voice', version: '2026-09-29.1', rule: '1 to 3 short sentences, one question, no em dashes, no banned phrases.' },
  { id: 'showing-logic', version: '2026-09-29.1', rule: 'Past scheduled is POST TOUR VERIFICATION NEEDED. Two dates are two tours.' },
  { id: 'source-provenance', version: '2026-09-29.1', rule: 'DATA CONFLICT only when the same fact contradicts itself. Possible duplicates stay side by side.' },
  { id: 'next-best-action', version: '2026-09-29.1', rule: 'Tiers 0 to 3. A promise and an unknown past showing outrank passive activity.' },
  { id: 'execution-safety', version: '2026-09-29.1', rule: 'MARK SENT MANUALLY is not verified delivery. It waits, suppresses, and reranks.' },
] as const;

export const PROMPT_MODULE_VERSION = '2026-09-29.1';
