# KyleOS status

Updated: 2026-09-29. Lineage: `cursor/lead-follow-up-os-5170`. Draft PR #12 remains open against `main` and is still conflicting. Phases 1 through 3 continue on that lineage in draft PR #17. They do not merge to `main`.

## Built

- Stage 1 desk in `ops/` (KyleOS Command / `kleinman-lead-desk`): paste and screenshot intake, SEND / NOTE / NEXT, draft-only, demo labels, audit log.
- Buyer-conversion ledger in `ops/src/runtime/`. Policy `2026-09-27.unreleased`. `liveSend` false. Tick command exists. No platform routine is registered.
- Phase 1 canonical records on the desk SQLite file: clients, opportunities, idempotent events, verified facts versus inferences, identity flags, workflow locks, migration `2026-09-29-canonical-clients`.
- Phase 2 communication foundation, still dry-run: provider interfaces, synthetic adapters, Twilio/Quo/Gmail/Vapi shells that do not send, consent, communication log, inbound events, frequency limit, and workflow-lock reuse. Migration `2026-09-29-communication`.
- Phase 3 conversion engine, still dry-run: buyer stage and readiness flags, confirmed-only classification, one next intake question, financing states and lender handoff, sale-linked seller opportunity, renter reverse timeline, draft consult requests, one next-best action, and Level 4 handoff cards. Migration `2026-09-29-conversion`.
- Architecture map: `docs/KYLE_OS_ARCHITECTURE.md`.

## Verified this run

```bash
cd ops
npx tsc --noEmit
npm test
```

Typecheck passed. `npm test`: **82 passed, 0 failed**.

The first test run, before Pillow was installed, was 51 passed and 1 failed. The failure was the screenshot fixture (`Pillow is required to draw the screenshot fixture.`). After Pillow was installed, that test passed with the rest. Pillow is an environment tool, not an `ops` dependency.

No live SMS, email, or call was sent. No Redfin or MLS API was added. `sent_messages` was not written by the new lead path.

## Safety defaults

- `SYSTEM_MODE` defaults to `DRY_RUN` (`.env.example`).
- `LIVE_SEND`, `SMS_SEND`, `EMAIL_SEND`, `AI_CALLING`, and `CALENDAR_WRITE` are names only. `liveChannelPermitted` stays false in this build, including when those variables are set.
- Twilio, Quo, Gmail, and Vapi shells do not construct an HTTP client.
- Desk password default remains `local-kyle` via `OPS_PASSWORD`.
- Server default bind remains `127.0.0.1`.

## Blocked

- PR #12 `mergeable_state` is dirty. Conflicts with `main` are `.gitignore`, `README.md`, and the shared docs both sides added (`ARCHITECTURE`, `BACKLOG`, `BACKUP`, `DAILY_GUIDE`, `INTEGRATIONS`, `REQUIREMENTS`, `SETUP`, `TASK_QUEUE`, `TEST_RESULTS`). `ops/` is not on `main`. Do not delete it to resolve the merge.
- Hosted deploy is not set up.
- Redfin Partner Tools write-back, MLS, and ShowingTime are not connected.
- Quo, Gmail, Twilio, and Vapi have shells only. No credentials are stored and no request is sent.
- Supabase and OpenAI keys are unset and are not required for this desk.
- Real client data is not loaded. Demo rows are synthetic.
- Spanish drafts are not built.

## Next

Keep `DRY_RUN`. Do not attach a live provider until Kyle supplies credentials, and even then a sandbox call must stay `not_attempted` until he turns one channel on. The seller file created by a sale dependency is a linked opportunity only. A full seller workflow is still out of scope. Resolve the PR #12 doc conflicts without removing `ops/` before anything merges to `main`.
