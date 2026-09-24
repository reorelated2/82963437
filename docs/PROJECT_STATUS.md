# Project status

Updated: 2026-09-24. Branch: `cursor/lead-follow-up-os-5170`.

## What this session is

Grok 4.7 is running inside Cursor as the coding agent for `github.com/reorelated2/82963437`. There is no separate Grok bot process, inbox, or control channel in this environment. Supermemory failed during discovery, so nothing was recalled from it. No other agent was messaged, and none should be assumed to have acted.

Cursor owns the code in `ops/`. The handoff for the next session is this file plus `docs/TASK_QUEUE.md`.

## Built

Stage 1 of KyleOS Command, package name `kleinman-lead-desk`, at `ops/`.

- Paste an inquiry or upload a screenshot. Only visible facts are extracted.
- Facts are labeled said, confirmed, inferred, missing, or stale. Financing is not invented. A requested showing is not stored as confirmed.
- Match on phone or email. A name alone, including a similar name, does not merge.
- SEND, NOTE, and NEXT on the review. The next action is stored on the contact.
- Daily Command board: new inquiries, replies, appointments, overdue follow ups, milestones, drafts, failed automations, contacts with no next action, a blocked reply connector, and system health.
- Kyle-only local sign-in. Default password `local-kyle` (`OPS_PASSWORD`). Live mode stays off.
- Draft only. Opt-out blocks the draft. `sent_messages` stays empty. Matches and drafts are written to `audit_log`.
- SQLite file, export, and a tested backup/restore.
- DEMO seed is labeled. It is not a live CRM.
- 25 automated tests passing, plus a Chrome walkthrough. Board picture: `docs/screenshots/command-board.png`.

## Verified

```bash
cd ops
npx tsc --noEmit
node --experimental-strip-types --experimental-sqlite --test --test-timeout=30000 test/lead-workflow.test.ts
```

Typecheck passed. Tests: 25 passed, 0 failed.

Chrome walkthrough passed for sign-in, the synthetic board, SEND / NOTE / NEXT, blocked send, saved note, no-next-action, search, a new paste, and a 390px layout. Details are in `docs/TEST_RESULTS.md`.

## Blocked

- Redfin Partner Tools has no connected write API. The desk cannot update it. Kyle pastes the CRM note back himself.
- No MLS or IDX feed. Listing status is not invented.
- No ShowingTime API. Requested times stay unconfirmed.
- Quo may be connected in another session. This desk does not send SMS. Live texting stays unauthorized.
- Gmail tools were not used to import client or employer mail.
- `mail.php` belongs to a different seller-lead site and is not connected.
- Spanish drafts are not built. English drafts only.
- OpenAI and Supabase are not configured and are not required.
- No paid service was selected. Estimated cost of this release is $0.
- Real client records were not loaded. DEMO rows are synthetic.
- Seller CMA, investor math, and mass outreach were left out of this run.
- The other Cursor OS agent was left running.

## Next

1. Kyle runs `docs/SETUP.md` on his own computer and pastes one lead he is allowed to use.
2. Next build module is contact organization and reactivation, only after an import source is authorized. See `docs/BACKLOG.md`.

## How to run

```bash
cd ops
npm install
npm run typecheck
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
