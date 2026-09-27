# Backlog

Release 1, the new-lead desk, is in progress in this branch. The rest is not started. One owner at a time. See `docs/TASK_QUEUE.md`.

| Order | Module | Purpose | State |
| --- | --- | --- | --- |
| 0 | New lead to follow up | SEND, NOTE, NEXT, match, opt-out, source history, daily screen | Built in this branch. 19 synthetic checks passed. |
| 1 | Contacts and reactivation | Import only allowed files, preview, duplicates, consent, stop rules | Not started |
| 2 | Buyer qualification and showings | Budget, timing, financing, next question, showing brief, feedback | Procedure is in `backend/src/revenue`. It does not book tours or store clients. |
| 3 | Property matching | Authorized MLS export or a listing Kyle supplies. No invented availability | Blocked on MLS access |
| 4 | CMA and seller prep | Comps, adjustments, scenarios, why each comp is in or out | Unadjusted range only, from comps the caller supplies. Not a full CMA. |
| 5 | Investor analysis | Rent, small multifamily, renovation. Facts separate from assumptions | Monthly cost and cash flow when the inputs are supplied. Short term rent blocked until restrictions are checked. |
| 6 | Offers and transactions | Term summaries and deadlines tied to a source clause. Review before dates go live | Term sheet only. Dates without a source are not executed deadlines. |
| 7 | Marketing | Drafts from verified facts. Public words stay apart from private notes | Not started |
| 8 | Performance | Response time, conversations, booked vs held, offers, contracts, closings, forecast vs received | Scoreboard accepts counts Kyle supplies. Empty counts stay Data needed, not zero. |

Do not import Redfin mail, MLS data, or other employer records until Kyle confirms that specific export is allowed.
