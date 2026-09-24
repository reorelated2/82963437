# Project status

Updated: 2026-09-24. Branch: `cursor/lead-follow-up-os-bef2`.

## Built

Kleinman Desk, release 1. A local page that turns a pasted lead or screenshot into a buyer summary, a text draft in Kyle's voice, a Redfin note, and a follow up. The Today screen lists who needs attention. Drafts do not send. Redfin is not written to.

Main code: `backend/src/os/`. Page: `backend/public/`. Docs: `docs/`.

## Verified

`cd backend && npm test` — 13 passed. `npx tsc --noEmit` passed. Synthetic data only.

Browser check of the running page is recorded in the latest test note below. If that section says the browser was not available, API checks still passed.

## Blocked

- No Grok bot process exists here. This session cannot operate Kyle's computer or log into Redfin.
- Redfin CRM has no connected API. Mail was not imported. A Gmail account is connected in Cursor and was not read for lead content.
- MLS is not connected. Miami Realtors and BeachesMLS merged on 2026-05-11. No credentials are stored.
- Notion has no usable lead database for this session. Outlook and Attio need sign-in. They were not used.
- Supabase and OpenAI keys are absent. Drafts do not call them.
- Screenshot OCR needs Tesseract installed on the computer that runs the desk. Without it, paste still works and the failure is visible.
- Real client records are not loaded. Do not import employer data until Kyle names an allowed export.

## Next

1. Kyle follows `docs/SETUP.md` and tries one pasted lead he is allowed to store locally.
2. He sends the draft from his own phone. Then he taps "I will send this myself" and pastes the note into Redfin.
3. Next build, after he allows a source: contact import with a preview and no automatic merge. See `docs/BACKLOG.md`.

## Resume notes

- Database path: `backend/data/os.sqlite`, created at runtime, gitignored.
- Outbound pause default: on. Spending limit default: $0.
- Do not turn on `RUN_REDFIN_COLLECTOR` as part of this desk.
- Do not add a send route. Approval must keep `sent_at` null until a future workflow is explicitly authorized and a channel exists.
- Phone or email match attaches to the existing contact. Name-only match creates a separate record and a "possible duplicate" warning.
- Server binds to `127.0.0.1` port 8080.
- Queue and owners: `docs/TASK_QUEUE.md`. Lock: none.

## Browser note

2026-09-24: Chrome at `http://127.0.0.1:8080`. Empty state, demo Today screen, a new Aventura lead, the draft, approve-without-sending, and search all behaved as specified. The server now starts without Supabase or OpenAI keys. Those older routes throw a clear error only if something calls them.
