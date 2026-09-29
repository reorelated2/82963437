# KyleOS status

Updated: 2026-09-29. This branch starts from `main` at `0e0d6f3` (PR #17 merged). It does not merge itself.

## Built

- Stage 1 desk in `ops/` (KyleOS Command / `kleinman-lead-desk`): paste and screenshot intake, SEND / NOTE / NEXT, draft-only, demo labels, audit log.
- Buyer-conversion ledger in `ops/src/runtime/`. Policy `2026-09-27.unreleased`. `liveSend` false. Tick command exists. No platform routine is registered.
- Phase 1 canonical records on the desk SQLite file: clients, opportunities, idempotent events, verified facts versus inferences, identity flags, workflow locks, migration `2026-09-29-canonical-clients`.
- Phase 2 communication foundation, still dry-run: provider interfaces, synthetic adapters, Twilio/Quo/Gmail/Vapi shells that do not send, consent, communication log, inbound events, frequency limit, and workflow-lock reuse. Migration `2026-09-29-communication`.
- Phase 3 conversion engine, still dry-run: buyer stage and readiness flags, confirmed-only classification, one next intake question, financing states and lender handoff, sale-linked seller opportunity, renter reverse timeline, draft consult requests, one next-best action, and Level 4 handoff cards. A scheduled, requested, or recent unverified tour signal outranks intake. A past scheduled tour with no outcome is `outcome_unknown` (post tour verification), not a current upcoming tour. Month-name dates in Agent Tools activity, such as `Sep 20` and `Sep 15`, are compared to the engine clock. An undated "upcoming tour" line stays a confirmation task. The tour is not marked confirmed, completed, or offer ready from that signal. Migration `2026-09-29-conversion`.
- Daily execution desk on the same file: `ops/src/execution/` turns Hot Buyer evidence into human action cards and a Morning Execution Brief. Drafts go through the existing approval queue. COPY, OPEN, and MARK live in the existing `ops/public` desk. OPEN opens only verified `https` URLs. MARK writes KyleOS state only. Financing adds `FINANCING_UNKNOWN_STATUS`, `NEEDS_PREAPPROVAL`, `LENDER_INTRO_OFFERED`, `LENDER_INTRO_ACCEPTED`, `PREAPPROVAL_IN_PROCESS`, and `FINANCING_ISSUE` without dropping the older states. `original_lead_source` stays put. `source_system` and `lead_source_history` record later ingests, including Agent Tools, without treating that ingest as the original source. Showing states are rows in `showing_transitions` (section 13), not a single collapsed label. Offer readiness and transaction milestones are read from verified facts. Deadlines are not computed. The brief header and bottom summary list every section 9 and section 45 bucket and link each non-empty bucket to a card. Integration capabilities are a table, all HUMAN ACTION MODE. The Friday report counts stored rows and says where denominators are incomplete.
- Phase 4 on the same file: seller intake and seller stages, approval queue, dry-run SMS/email/voice gate, fact review, and the Notion sync contract. Live send stays off.
- Architecture map: `docs/KYLE_OS_ARCHITECTURE.md`. Notion contract: `docs/NOTION_SYNC_CONTRACT.md`.
- Agent Tools ingestion contract: `docs/AGENT_TOOLS_INGESTION.md`. Loader: `ops/src/ingest/agentTools.ts`. Synthetic fixture only. The 28-record export is not in the repo. Bulk apply is refused.

## Verified this run

```bash
cd ops
npx tsc --noEmit
npm test
```

Typecheck passed. `npm test`: **186 passed, 0 failed** on 2026-09-29 after the live-brief corrections (active property, date conflicts, third-party tour pivot, needs-verification is not a reported outcome, stage from evidence, showings today, tier sort). `cd backend && npx tsc --noEmit && npm test`: typecheck passed and **22 passed, 0 failed** on this same run. The new checks are in `ops/test/v5-desk.test.ts` and `ops/test/evaluation-harness.test.ts`. Tour-first checks remain in `ops/test/tour-first.test.ts`. Agent Tools checks remain in `ops/test/agent-tools-ingest.test.ts`.

The first test run, before Pillow was installed, was 51 passed and 1 failed. The failure was the screenshot fixture (`Pillow is required to draw the screenshot fixture.`). After Pillow was installed, that test passed with the rest. Pillow is an environment tool, not an `ops` dependency.

No live SMS, email, or call was sent. No Redfin or MLS API was added. `sent_messages` was not written by the new lead path.

## Safety defaults

- `SYSTEM_MODE` defaults to `DRY_RUN` (`.env.example`).
- `LIVE_SEND`, `SMS_SEND`, `EMAIL_SEND`, `AI_CALLING`, and `CALENDAR_WRITE` are names only. `liveChannelPermitted` stays false in this build, including when those variables are set.
- `DRY_RUN` defaults on when missing. `LIVE_OUTBOUND`, `SMS_ENABLED`, `EMAIL_ENABLED`, and `VOICE_ENABLED` enable only on the exact string `true`. Missing means off. Even then this build returns `dry_run` or `not_attempted`, never `sent`.
- Twilio, Quo, Gmail, and Vapi shells do not construct an HTTP client.
- Desk password default remains `local-kyle` via `OPS_PASSWORD`.
- Server default bind remains `127.0.0.1`.

## Blocked

- PR #12's doc conflicts with `main` were resolved by a normal merge of `origin/main` into `cursor/lead-follow-up-os-5170`. `ops/` stayed. Do not merge PR #12 into `main` from this work.
- PR #17 includes that updated lead branch. It is not a merge to `main`.
- Hosted deploy is not set up.
- Redfin Partner Tools write-back, MLS, and ShowingTime are not connected.
- Quo, Gmail, Twilio, and Vapi have shells only. No credentials are stored and no request is sent.
- Supabase and OpenAI keys are unset and are not required for this desk.
- Real client data is not loaded. Demo rows are synthetic.
- Spanish drafts are not built.

## Next

Keep `DRY_RUN`. The next milestone is one real Agent Tools lead, chosen by `onlyRecordId`, still with no send and no Agent Tools write. Live SMS, email, calling, and lender handoff stay off until Kyle supplies credentials and a sandbox call returns `not_attempted`.

## Buyer Command Center (`backend/` and `mobile/`)

Updated: 2026-09-24 on `main`, kept when `origin/main` was merged into `cursor/lead-follow-up-os-5170`. This section is the consult app. It is not the inquiry CRM. Boundary: `docs/HANDOFF_BOUNDARY.md`.

## BUILT

- Consult, market, strategy, and client routes remain in `backend/src/server.ts` and `mobile/`.
- `GET /mls/hiram-zone` returns the existing seed and now marks it `demo: true`.
- `POST /mls/analyze` ranks only listings the caller supplies. It says it is not a live MLS connection.
- The inquiry board under `backend/src/os` is not mounted. `ENABLE_LEAD_DESK` is unset on purpose.

## VERIFIED

`cd backend && npx tsc --noEmit && npm test` — typecheck passed, 22 passed, 0 failed.

On the running process at `http://127.0.0.1:8080`: `GET /` names the Buyer Command Center and says the lead desk is not mounted. `GET /health` has `leadDeskMounted: false`. `GET /api/os/workspace` is HTTP 404. `GET /mls/hiram-zone` is `demo: true` with 18 active rows out of 20. Evidence is in `docs/TEST_RESULTS.md`.

## BLOCKED

- Supabase is not configured, so `/markets/:city` and `/clients` cannot save.
- `OPENAI_API_KEY` is absent, so `/strategy` cannot run.
- No Redfin private API and no live MLS feed.
- This server does not send client messages.
- This environment is not a deployment.

## NEXT

Leave Stage 1 (inquiry, SEND, NOTE, NEXT, daily board) on `ops/`. Further work on the consult app stays on consult intake, market metrics, and MLS analyze helpers. The inquiry board is not port 8080.
