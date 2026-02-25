import type { IntakeAnswers } from '../types/domain';

export const ROCKET_MORTGAGE_ONE_PLUS_SCRIPT =
  "No stress. As a Redfin agent, I get my buyers exclusive access to Rocket Mortgage's ONE+ program—you put 1% down, and they cover the other 2% as a grant, plus a 1% rate drop for the first year. I’m texting you my direct contact there now. Call them today to lock your buying power, and I’ll start pulling off-market comps.";

export const shouldShowRocketCta = (answers: Partial<IntakeAnswers>): boolean =>
  answers.financing === 'Need Lender';
