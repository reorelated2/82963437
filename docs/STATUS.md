# Project status

Updated: 2026-09-24. Branch: `cursor/lead-follow-up-os-bef2`.

## BUILT

Kleinman Desk, first workflow. Paste or screenshot a lead. The desk extracts the visible facts, matches by phone or email, and opens a client page with SEND, NOTE, and NEXT. Today answers who needs attention, who is most likely to move, what is next, and which three actions to take. Drafts do not send. Redfin is not written to.

Also in this workflow: Spanish when the client stated it, opt-out for that person only, household link without shared permission, original lead source kept when a later source arrives, buyer stage buttons, financing gaps, people with no next action, and income left as "Data needed."

Main code: `backend/src/os/`. Page: `backend/public/`. Decisions: `docs/DECISIONS.md`.

## VERIFIED

`cd backend && npm test` — 19 passed. `npx tsc --noEmit` passed. Synthetic data only. No message was sent.

Chrome at `http://127.0.0.1:8080` opened Today, pasted a Spanish Brickell lead, showed SEND / NOTE / NEXT, saved the search stage, and confirmed approval does not send. Details are in `docs/TEST_RESULTS.md`.

## BLOCKED

- No separate Grok bot exists. This session cannot operate Kyle's computer or log into Redfin.
- Redfin CRM has no connected API. Mail was not imported. A Gmail account is connected in Cursor and was not read for lead content.
- MLS is not connected. No credentials are stored.
- Notion has no usable lead database for this session. Outlook and Attio need sign-in. They were not used.
- Supabase and OpenAI keys are absent. Drafts do not call them.
- Screenshot OCR needs Tesseract on the computer that runs the desk. Paste still works without it, and a failed read is visible.
- Compensation assumptions are missing, so no income projection is shown.
- Real client records are not loaded. Do not import employer data until Kyle names an allowed export.

## NEXT

1. Kyle follows `docs/SETUP.md` and pastes one lead he is allowed to store on this computer.
2. He copies SEND into his own texting app. Then he taps "I will send this myself" and pastes NOTE into Redfin.
3. He does not need to connect Redfin, Gmail, or MLS for that first real lead.
4. The next build stays on this same workflow until he has used it. Contact import waits until he names an allowed export. See `docs/BACKLOG.md`.

## Resume notes

- Database path: `backend/data/os.sqlite`, created at runtime, gitignored.
- Outbound pause default: on. Spending limit default: $0.
- Do not turn on `RUN_REDFIN_COLLECTOR`.
- Do not add a send route.
- Phone or email match attaches to the existing contact. Name-only match creates a separate record and a possible-duplicate warning.
- Server binds to `127.0.0.1` port 8080.
- Queue and owners: `docs/TASK_QUEUE.md`. Lock: none.
