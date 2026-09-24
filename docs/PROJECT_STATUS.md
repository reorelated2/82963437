# Project status

Updated: 2026-09-24. Branch: `cursor/lead-follow-up-os-5170`.

## What this session is

Grok 4.7 is running inside Cursor as the coding agent for `github.com/reorelated2/82963437`. There is no separate Grok bot process, inbox, or control channel in this environment. Supermemory failed during discovery, so nothing was recalled from it. No other agent was messaged, and none should be assumed to have acted.

Cursor owns the code in `ops/`. The handoff for the next session is this file plus `docs/TASK_QUEUE.md`.

## Built

A local lead desk at `ops/`.

- Paste a lead or upload a screenshot.
- Extract supported facts. Missing facts stay Data needed. Conflicts are kept.
- Match on phone or email. Same name without a matching phone or email waits for a human decision.
- Draft the next text in Kyle's voice, a buyer summary, a CRM note, and a follow up time.
- Review queue. Approve saves the note and one follow up. It does not send.
- Today screen: new leads, replies, appointments, overdue follow ups, milestones, drafts, failed automations.
- Outbound pause defaults to on. No send workflow is authorized.
- SQLite file, export, and a tested backup/restore.
- 19 automated tests passing, plus a Chrome walkthrough of the real page.

## Verified

`cd ops && npx tsc --noEmit` passed.

`node --experimental-strip-types --experimental-sqlite --test --test-timeout=30000 test/lead-workflow.test.ts` passed, 19 of 19.

Chrome walkthrough passed for banner, sample day, paste, draft, blocked send, saved note, search, and a 390px layout. Details are in `docs/TEST_RESULTS.md`.

## Blocked

- Redfin Partner Tools has no connected write API. The desk cannot update it. Kyle pastes the CRM note back himself.
- No MLS or IDX credentials.
- Gmail tools are connected in Cursor, but client and employer mail were not imported. Do not import them until Kyle names a permitted source.
- `mail.php` belongs to a different seller-lead site and is not connected.
- OpenAI and Supabase are not configured and are not required.
- No paid service was selected. Estimated cost of this release is $0.
- Real client records were not loaded. DEMO rows are synthetic.

## Next

1. Kyle runs `docs/SETUP.md` on his own computer and pastes one lead he is allowed to use.
2. Next build module is contact organization and reactivation, only after an import source is authorized. See `docs/BACKLOG.md`.

## How to run

```bash
cd ops
npm install
npm test
npm start
```

Open `http://127.0.0.1:8787`. The database file is `ops/data/desk.sqlite`.

## Decisions already made

- Redfin stays the system of record. This desk is a working copy.
- Local SQLite instead of Supabase for the first release, so it runs with no account.
- Deterministic extraction and drafts, so a missing AI key cannot block the workflow.
- Screenshot OCR is local Tesseract. Confidence under 45 does not create a contact.
- Client copy is produced only by `ops/src/voice.ts`. The older Expo strategy scripts are not approved client copy.
