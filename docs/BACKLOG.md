# Backlog

Owner for the next KyleOS build is Cursor. Grok reviews acceptance. Do not start the next module until the lead desk checks in `docs/TEST_RESULTS.md` still pass.

## Now

1. Lead desk in `ops/`: paste, screenshot, review, draft, note, follow up. In progress on this branch.

## Next, in business order

1. Contact organization and reactivation. Import only after Kyle authorizes a source. Preview before commit. No automatic merge of uncertain duplicates. Track consent and opt out. Stop a sequence on reply, opt out, booking, or stage change.
2. Buyer qualification and showing preparation. Budget, motivation, timing, financing, criteria, decision makers. One next question. Showing briefs and feedback. No ranking by protected characteristics.
3. Property matching. Authorized MLS, a permitted export, or a supplied list. Source and last checked time. Confirmed matches stay separate from unknowns. No invented availability.
4. CMA and seller preparation. Intake, comps, adjustments, scenarios. Why each comp is in or out. Active, pending, and closed stay distinct. Say when evidence is too thin. A CMA is not an appraisal.
5. Investor analysis. Long term rentals, small multifamily, renovation. Facts separate from assumptions. Show formulas and a downside case. Do not mark short term rental eligibility as confirmed without evidence.
6. Offers and transaction tracking. Term summaries and negotiation drafts. Milestones only from supplied documents. Kyle reviews a deadline before it becomes active. No invented contract language.
7. Marketing. Listing, buyer, seller, and social drafts from verified facts. Public copy stays separate from private notes. Publication stays queued unless a specific workflow is authorized.
8. Performance. Response time, conversations, appointments booked, appointments held, offers, contracts, closings, follow up completion. Booked is not held. Forecast income is not received income. Weekly review of the highest value next actions.

## Explicitly not scheduled

- Buying a CRM, an AI API plan, or a hosting plan.
- Scraping Redfin or connecting `mail.php` from the old seller site.
- Importing Gmail, employer mail, or any other inbox without a permitted data flow.
- Importing Redfin mail, MLS data, or other employer records until Kyle confirms that specific export is allowed.

## Consult app queue

The Buyer Command Center on `main` tracks the same business order with a different owner note. Stage 1 for KyleOS is `ops/` in this repository. The consult server does not mount `backend/src/os`. See `docs/TASK_QUEUE.md`.

| Order | Module | Purpose | State |
| --- | --- | --- | --- |
| 0 | New lead to follow up | SEND, NOTE, NEXT, match, opt-out, source history, daily screen | Built in `ops/` on this branch. See `docs/TEST_RESULTS.md`. |
| 1 | Contacts and reactivation | Import only allowed files, preview, duplicates, consent, stop rules | Not started |
| 2 | Buyer qualification and showings | Budget, timing, financing, next question, showing brief, feedback | Not started |
| 3 | Property matching | Authorized MLS export or a listing Kyle supplies. No invented availability | Blocked on MLS access |
| 4 | CMA and seller prep | Comps, adjustments, scenarios, why each comp is in or out | Not started |
| 5 | Investor analysis | Rent, small multifamily, renovation. Facts separate from assumptions | Not started |
| 6 | Offers and transactions | Term summaries and deadlines tied to a source clause. Review before dates go live | Not started |
| 7 | Marketing | Drafts from verified facts. Public words stay apart from private notes | Not started |
| 8 | Performance | Response time, conversations, booked vs held, offers, contracts, closings, forecast vs received | Not started |
