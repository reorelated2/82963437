# KyleOS architecture audit

Updated: 2026-09-29. Branch lineage: `cursor/lead-follow-up-os-5170`. Operator: Kyle Kleinman, Redfin Lead Agent, Miami-Dade and Broward.

This file is the Phase 0 map of the existing repository and the record of the Phase 1 data layer added on top of it. It does not authorize live sends.

Redfin Partner Tools stays the system of record for Redfin customers. The files in this repo are a local working copy.

## 1. Current architecture

One GitHub repository, `reorelated2/82963437`, holds three surfaces. Only `ops/` is the operating system.

| Surface | Path | Role |
| --- | --- | --- |
| KyleOS Command | `ops/` | Local Node desk plus the buyer-conversion ledger. This is the product. |
| Buyer Command Center scaffold | `mobile/`, `backend/`, `supabase/migrations/` | Older Expo app, Express API, and a market-consult schema. Not the lead desk. |
| Static site | `index` pages, `mail.php`, GitHub Pages | Older landing and seller-form mailer. Not connected to `ops/`. |

`ops/` is TypeScript on Node 22, run with `node --experimental-strip-types --experimental-sqlite`. There is no separate bundler. Package name: `kleinman-lead-desk`. Screen title: KyleOS Command.

Two SQLite files, both opened with `node:sqlite`. There is no third database.

| File | Default path | Opened by | What it stores |
| --- | --- | --- | --- |
| Desk | `ops/data/desk.sqlite` (`OPS_DB_PATH`) | `ops/src/db.ts` | Contacts, intake, drafts, tasks, audit log, and the Phase 1 canonical clients, opportunities, and events |
| Buyer ledger | `ops/data/ledger.sqlite` (`KYLEOS_LEDGER`) | `ops/src/runtime/store.ts` | Synthetic buyer-conversion opportunities, runtime events, and action claims |

Supabase appears only as `supabase/migrations/001_initial_schema.sql` and an unused client in `backend/src/lib/db.ts`. It is not configured and it is not the lead store.

Entrypoints:

- `cd ops && npm start` serves the desk on `127.0.0.1:8787` (`ops/src/server.ts`).
- `cd ops && npm test` and `npm run typecheck`.
- `cd ops && npm run tick` runs the buyer ledger reconcile. It does not send live messages.
- `ops/src/agent.ts` runs extract, match, propose, read, and refuse-to-send.

Default mode is `SYSTEM_MODE=DRY_RUN`. `liveSend`, `SMS_SEND`, `EMAIL_SEND`, and `AI_CALLING` stay false in code. See `.env.example`.

## 2. What already works

Evidence from this run, before the Phase 1 edits: `cd ops && npx tsc --noEmit` passed. `npm test` reported 51 passed and 1 failed. The failure was `a clean screenshot can be read without inventing a confirmation` because Pillow was not installed (`Pillow is required to draw the screenshot fixture.`). After Pillow was installed in this environment, the same test passed. That dependency is not declared in `ops/package.json`.

The desk already did the Stage 1 inquiry loop:

- Paste or screenshot intake, visible facts only, SEND / NOTE / NEXT, no send tool.
- Match on phone or email. A name alone is a review, not a merge.
- Duplicate idempotency keys and content hashes do not create a second contact, draft, or task.
- Conflicting known values are kept beside the original. Financing is not invented. A requested showing is not stored as confirmed.
- `audit_log` records matches, drafts, suppression, and send blocks. `sent_messages` stays empty.
- Demo rows are labeled. Backup and restore are tested.
- The buyer ledger resumes a due follow-up from a reopened file. Acceptance sends in that suite are synthetic and `live: false`. Policy version `2026-09-27.unreleased`.

After Phase 1, the same commands reported typecheck passed and **63 passed, 0 failed**.

## 3. What should be reused

- `ops/src/workflow.ts` intake, match, drafts, and the desk audit log.
- `ops/src/extract.ts` and `ops/src/voice.ts` for visible facts and client copy.
- `ops/src/db.ts` as the only lead database. Phase 1 tables were added there.
- `ops/src/runtime/` for the buyer loop, quiet hours, and synthetic adapters. Do not point it at a new database.
- `ops/src/runtime/adapters.ts` as the provider boundary. Missing credentials stay unverified.
- Local password auth in `ops/src/auth.ts`.
- The fair-housing and human-gate rules already in the desk: no protected-class ranking, no offer or contract language sent as binding.

## 4. What was missing versus phases 1 and 2

Phase 1 in the 2026-09-29 brief is the canonical record. Before this change the desk had contacts and source events, and the buyer ledger had its own opportunities, but there was no shared client, no idempotent lead event on the desk, no split between a verified fact and an inference, no identity flag that survives a webhook, and no contact-claim lock.

Phase 2, the communication foundation, is built and still dry-run. Quo, Gmail send, and any calling provider are unverified shells. Drafts stay drafts. This run does not add live provider calls. Phase 3, the conversion engine, is built on the same desk file and also stays dry-run.

The older stage list (buyer queues, showings, offers, seller CMA, investor math) stays in `docs/BACKLOG.md`. Offers, negotiation, contracts, and commission stay behind a human gate.

## 5. What is redundant

- `supabase` `clients` and `events` tables are consultation records (`answers_json`, market snapshots). They are not the KyleOS client.
- `backend/` Playwright collector and OpenAI strategy route are a different product. The desk does not start them.
- `mail.php` posts seller leads to a mailbox and is not connected.
- The buyer ledger `opportunities` table and the desk `opportunities` table share a name and live in different files. The desk table is the canonical lead opportunity. The ledger table is the synthetic buyer workflow. Do not copy rows between them in this slice, and do not merge the files.
- Draft PR #12's documentation conflicts with `main` were resolved by merging `origin/main` into `cursor/lead-follow-up-os-5170` with a merge commit. `ops/` stayed. PR #17 then merged that updated branch. Neither pull request is merged into `main`.

## 6. What is unsafe

- The default desk password is `local-kyle`. Change `OPS_PASSWORD` before any machine that other people can open.
- The server binds to `127.0.0.1` unless `OPS_HOST` is set. Do not publish it.
- `SYSTEM_MODE=LIVE` in the environment does not send. The send flags in `ops/src/mode.ts` are hard false for this build. A later change must not treat the variable alone as permission.
- An inferred value must not replace a verified fact. That rule is now enforced on `client_facts`, on desk facts whose basis is `confirmed`, and on buyer-ledger facts whose basis is `confirmed`.
- Identity collisions are flagged. Rows are not deleted and `duplicate_of_client_id` is not filled in automatically.
- Demo and live rows share one SQLite file. Demo rows are marked `is_demo`. Clear them before relying on the file for a real client.
- No MLS, Redfin, or ShowingTime client was added. Do not invent listing status or a successful write-back.

## 7. What Phase 1 implemented

Migration `2026-09-29-canonical-clients` runs from `openDatabase`.

- `clients` linked to a desk contact when the desk created one.
- `opportunities`, one open row per client and business line (`redfin_buyer` by default). Stage stays `new`.
- `events` with a unique idempotency key. A repeated webhook returns the original row.
- `client_facts` split into `fact` and `inference`. A verified fact blocks an inference and blocks a different verified value.
- `identity_flags` when a phone and an email point at two clients, or a name arrives without a matching phone or email.
- `workflow_locks` so a second holder cannot take `contact_claim`.
- `audit_log` rows for creates, duplicate replays, rejected inferences, flags, and lock decisions.
- Desk intake (`intakeLead`) writes the same client, opportunity, and event inside the existing transaction.
- `POST /api/canonical/leads` accepts an authenticated webhook-shaped body and does not send.

Tests covering this live in `ops/test/canonical.test.ts`.

## 7b. What Phase 2 implemented

Migration `2026-09-29-communication` adds `consent` and `communication_log` on the same desk file.

Business code in `ops/src/comms/gateway.ts` calls `MessagingProvider`, `VoiceProvider`, `EmailProvider`, and `CalendarProvider` only. Synthetic adapters record `simulated` receipts with `live: false`. Twilio SMS, Twilio Voice, Quo, Gmail, and Vapi are shells. They return `not_attempted` and do not open a network connection. `liveChannelPermitted` is false even if `SYSTEM_MODE=LIVE` and the channel flag is `true`.

Consent stores sms, call, email, marketing, and recording state, `do_not_*` flags, `opt_out_at`, `wrong_number`, preferred channel and time, and `source_of_consent`. An inbound `STOP` or `UNSUBSCRIBE` suppresses that channel before any later outbound call.

Inbound SMS and calls append to the Phase 1 `events` table with the caller's idempotency key. A repeat does not add a second event. Outbound attempts reuse `workflow_locks` (`outreach:<purpose>`) and stop a second simulated contact for the same purpose inside 24 hours.

A failed or unavailable provider is stored as `failed` with `retryable` and `retry_after_seconds`. The log rejects statuses `sent` and `call completed`.

Tests: `ops/test/comms.test.ts`.

## 7c. What Phase 3 implemented

Migration `2026-09-29-conversion` adds intake answers, readiness flags, buyer classifications, lender handoffs, opportunity links, reverse timelines, consult requests, handoff cards, and next-best actions on the desk file. Open opportunities gain `next_action`, `next_action_owner`, `next_action_due_at`, `follow_up_trigger`, `no_action_reason`, `primary_stage`, and `financing_state`.

A new open opportunity with no plan stores `NO_ACTION_REQUIRED`. Opening a buyer file replaces that with one owner, one due time, and one follow-up trigger. The next-question selector returns one field. Cash skips preapproval. A renter skips the sale question. Classifications are stored only from `customer_confirmed` or `kyle_confirmed` answers.

Financing runs from `UNKNOWN` through `FINANCING_READY`. A granted lender introduction writes a handoff with no application. Three days later, with the application still `none`, the desk writes a contextual follow-up and does not mark anything sent. `PREAPPROVED` moves the buyer to `CONSULT_READY` and writes a draft consult with `live = 0`. Sensitive borrower documents are rejected in SMS drafts.

A confirmed need to sell creates a `redfin_seller` opportunity and stores both ids on `opportunity_links`. A renter lease date writes target dates for preapproval, consult, search, touring, and the offer window. Consult triggers stay drafts. Offer, legal, commission, financing-problem, frustration, and “ask for Kyle” messages write a handoff card with `approval_required` and do not set `OFFER_SUBMITTED`.

A scheduled or requested tour signal outranks the intake question. The primary action is `confirm_tour_details` when a tour is scheduled and not confirmed, `respond_to_tour_request` when it is only requested, or `tour_follow_up` when a recent unverified note says a tour may have happened. The intake question stays a non-primary row. Requested, scheduled, confirmed, and completed stay distinct. A coordinator or showing-agent note is not a tour with Kyle. The signal does not set the tour confirmed or completed, and it does not set `OFFER_READY`. The draft stays `approval_required` with `execution_method` `draft` and `live` 0. Tests: `ops/test/tour-first.test.ts`.

Banned draft phrases are `just checking in`, `touching base`, `circling back`, and `I'm paid on your satisfaction`.

Tests: `ops/test/conversion.test.ts` (BUYER 1, BUYER 2, BUYER 3, BUYER 7, BUYER 9, DATA 1).

## 7d. What Phase 4 implemented

Seller opportunities keep `business_line = redfin_seller` and gain `seller_stage` (`SELLER_NEW` through `SELLER_LOST`). Buyer `primary_stage` stays independent. The link remains `opportunity_links`. Seller intake asks one question. An unknown address is not invented. A CMA-ready flag does not move the seller stage. A seller consult draft is created only after address, motivation, timing, and decision makers are confirmed, and it stays `live = 0`.

`approval_queue` holds outbound SMS, email, call, lender introduction, offer, commission, legal, seller consult, frustration, and Kyle-request drafts. Status moves through `PENDING`, `APPROVED`, `REJECTED`, `EXPIRED`, `EXECUTED`, and `CANCELLED`. `EXECUTED` is not set in this build. `canExecuteOutbound` is the only live gate and it never allows a send. Dry-run SMS, email, and voice providers return `dry_run` or `not_attempted`.

`DO_NOT_CONTACT` blocks later outreach and overrides an approval. Offer discussion does not set `OFFER_SUBMITTED` unless Kyle confirms it. Requested showings, scheduled events, coordinator notes, and automated touches stay unverified. A second verified fact opens `fact_reviews` and keeps the original value. Reruns do not add a second seller link, lender handoff, pending approval, or primary next-best action.

Notion is documented in `docs/NOTION_SYNC_CONTRACT.md` and is not called.

Tests: `ops/test/phase4.test.ts`.

## 8. Integrations that need credentials

None of these were called in this run. None should be treated as connected.

| System | Blocker |
| --- | --- |
| Redfin Partner Tools write-back | No public write API is connected. Kyle pastes the CRM note. |
| MLS / IDX | No credentials. Listing status is not invented. |
| ShowingTime | No API. Requested is not confirmed. |
| Quo SMS | Shell only. No API key. `SMS_SEND` does not send. |
| Gmail send and mailbox import | Shell only. No OAuth client. `EMAIL_SEND` does not send. |
| Twilio SMS and Voice | Shells only. No account SID. |
| Vapi calling | Shell only. No API key. `AI_CALLING` does not place a call. |
| Supabase | URL and service role are unset. Not required for the desk. |
| OpenAI | `OPENAI_API_KEY` is unset. The desk does not call it. |
| Notion | Contract only in `docs/NOTION_SYNC_CONTRACT.md`. No token and no write. |

## Tests

```bash
cd ops
npx tsc --noEmit
npm test
```

2026-09-29 result on this branch after the execution desk header, showing transitions, offer and transaction surfaces, capability table, and Friday report: typecheck passed. `npm test` reported 168 passed, 0 failed. Backend typecheck passed and `npm test` reported 22 passed, 0 failed. Sends in the buyer suite remain synthetic. Communication-log rows in the Phase 2 suite have `live = 0`. Consult requests, handoff cards, and approval attempts in later suites have `live = 0`. `sent_messages` stays empty. Dry-run providers do not report `sent`.

`showing_transitions` stores each section 13 state as its own row. The desk records only states the evidence supports, plus an explicit manual mark for completed or cancelled. Offer readiness is READY or MISSING from verified offer facts. An offer request is MISSING. Transaction milestones carry STATUS, OWNER, DEADLINE, SOURCE, and NEXT ACTION. A deadline is the verified date string or HUMAN REVIEW REQUIRED. The Friday report counts open opportunities, pending approvals, and verified offer facts, and it names the incomplete denominators. The capability table does not claim READ, SEND, CALL, or SCHEDULE for any integration.

## 9. Audit after `main` was merged

Checked on 2026-09-29 against this branch, which now contains both `ops/` and the consult app from `main`.

| Area | What exists | Reuse | Gap |
| --- | --- | --- | --- |
| Schemas | Desk SQLite in `ops/src/db.ts`. Canonical, communication, and conversion migrations on that same file. Buyer ledger in `ops/src/runtime/store.ts`. Unused Supabase SQL. Unmounted `backend/src/os` with its own sqlite path. | Desk file only for leads. | Do not merge the two SQLite files. |
| Auth | Desk cookie session in `ops/src/auth.ts`. Default password `local-kyle`. API routes, including `POST /api/canonical/leads`, require that session. | Keep it. | No hosted login. Do not publish the port. |
| Routes | Desk on `127.0.0.1:8787`. Consult app on `8080` only when someone starts `backend/`. `ENABLE_LEAD_DESK` must stay unset, so `backend/src/os` is not mounted. | Desk routes for KyleOS. | GitHub Pages (`.github/workflows/static.yml`) deploys static `main` only. It does not run the desk. |
| Webhooks | `POST /api/canonical/leads` is the authenticated ingest. Idempotency key required. | `ingestCanonicalLead`. | It is not a public Redfin webhook. No Agent Tools API is connected. |
| Tests | `cd ops && npx tsc --noEmit && npm test`. `cd backend && npx tsc --noEmit && npm test`. | Both. | `mobile/` has typecheck and no test script. Dependencies there are not installed in this run, so mobile typecheck was not run. No root lint script. |
| Integrations | Provider shells and the Notion contract. Runtime adapters refuse a live Agent Tools write. | Adapters and mocks. | No Redfin, MLS, Quo, Gmail, Twilio, or Vapi credentials. |
| Deployment | Local process only. | `npm start` in `ops/`. | No production host. |
| Conflicts | PR #12 and PR #17 were conflict-free after the merge commits `58d6dd5` and `05de303`. | Keep both. | Do not force-push. Do not merge either PR into `main` without an explicit release. |

## 10. Agent Tools lead ingestion

The contract is `docs/AGENT_TOOLS_INGESTION.md`. The loader is `ops/src/ingest/agentTools.ts`. It reuses `ingestCanonicalLead`, identity flags, workflow locks, and the conversion engine. A record with no verified phone or email becomes a client with status `pending_enrichment` and is not dropped. Matches use verified email, verified phone, and Agent Tools source id. A household id or a display name flags a review and does not merge. Files with more than 8 records are refused unless `onlyRecordId` names one lead.

The real 28-record export (26 leads and 2 `needs_review`) is not in this repo. `ops/fixtures/agent-tools-leads.sample.json` is a 4-record synthetic file with the same shape. Nothing in this loader calls Agent Tools or sends a message. After a record is applied, `recordLeadSource` stores `source_system` as `redfin_agent_tools` and appends `lead_source_history`. That does not overwrite `original_lead_source` or `source_label`.

## 11. Execution desk

`ops/src/execution/` is a planner on top of the existing conversion engine, approval queue, and canonical facts. It is not a second CRM, a second customer model, or a second approval queue. Reason codes stay on `next_best_actions`. Kyle sees `humanAction` on the Morning brief in the existing `ops/public` desk (`#/morning`).

`planDesk` reads verified facts and refuses to promote an inference. A past dated tour, including Agent Tools month-name dates such as `Sep 20` and `Sep 15`, becomes POST TOUR VERIFICATION NEEDED / OUTCOME UNKNOWN. An undated scheduled-tour line stays a confirmation task. An associate or coordinator note stays SHOWING OUTCOME NOT CONFIRMED. A verified overdue CMA reminder opens one linked `redfin_seller` opportunity through `ensureOverdueCmaSeller`. That path does not call `linkSellerOpportunity`, because that helper also marks the buyer sale blocked. The seller row is the task. Desk `tasks` require a contact, and a held record has none. Drafts pass `screenKyleVoice` (no em dashes, no banned phrases). The Agent Tools loader calls `publishExecution` on both the applied path and the held path, so a draft is enqueued with `enqueueApproval` as `manual_action` / `execution_desk` and stays PENDING. A held record with no phone and no email still gets a card: GET CELL, and where to look. COPY copies text. OPEN opens a link only when the card status is `verified` and the URL is `https`. MARK calls `applyManualMark`, which writes a canonical `manual_mark` event and never a sent message or an Agent Tools write.

The Hot 7 regression fixture is pseudonymized and committed at `ops/fixtures/hot7-execution.json`. `seedHot7` loads it with `loadAgentToolsDataset`, the same loader as a real Agent Tools file. Names and property addresses from the 2026-09-28 inputs are kept. Phones are `3055552101` through `3055552103`. Emails are `*.fixture@example.com`. Real phones and emails are not in git. Claudia is labeled `hot7-claudia-not-in-export` because she is not in the 62-buyer export. No Redfin, Agent Tools, or MLS URL is invented. Missing links render as LINK NOT FOUND. Missing property or contact says DATA NEEDED and names Agent Tools as the place to look.

## 12. Information flow (2026-09-29 v5 pass)

This section is the map of the existing app. It is not a second product.

```
signal (paste, screenshot, Agent Tools JSON, or a local lead-master file)
  -> extract / ingestCanonicalLead or openCanonicalShell
  -> clients + client_identifiers (phone, email, agent_tools_id, redfin_customer_id)
  -> one open opportunity per client and business line
  -> client_facts (fact vs inference, verified vs unverified)
  -> consent, communication_log, approval_queue, intended next_best_actions
  -> showing_transitions, waiting_states, promises, execution_marks
  -> planDesk (one card) -> buildMorningBrief (a view, not the engine)
  -> Kyle: COPY / OPEN / tel CALL / MARK
  -> mark writes KyleOS only -> waiting or outcome fact -> brief reranks
```

| Piece | Where it lives | What it does |
| --- | --- | --- |
| Prompts | `ops/src/prompts/registry.ts` version `2026-09-29.1`. Older core text in `policy/KYLEOS_CORE_PROMPT.md`. | Sixteen modules. No model is called. `screenKyleVoice` still rejects banned phrases and em dashes on drafts. |
| Ingestion | `ops/src/workflow.ts`, `ops/src/canonical.ts`, `ops/src/ingest/agentTools.ts`, `ops/src/ingest/liveMaster.ts` | Paste and screenshot stay on the desk. Agent Tools JSON stays on its loader and still refuses a bulk apply over 8 records. The lead-master shape is a separate local reader. A real file must sit in `ops/data/live/` (gitignored) or outside the repo. `KYLEOS_LIVE_LEADS` is the only path the HTTP import route will read. |
| Schemas | Desk SQLite via `openDatabase` | clients, opportunities, events, client_facts, consent, approval_queue, next_best_actions, showing_transitions, waiting_states, promises, execution_marks. The buyer ledger in `ops/src/runtime/store.ts` is still a second file and is not the desk. |
| Ranking | `planDesk` then a numeric sort in `buildMorningBrief` | Tier is the primary sort. The existing score, including a +12 when a verified `action_due_at` is inside two hours, breaks ties inside a tier. When tier, score, and hot score all match, the name orders the cards so a second import does not reshuffle them. Hot 7 order is unchanged because its tier 0 cards already sat above its tier 2 cards. |
| Hot buyer | `ops/fixtures/hot7-execution.json` and `seedHot7` | Regression fixture only. `POST /api/execution/hot7` refuses when any `is_demo = 0` client exists. The fixture clock is `2026-09-29T13:00:00.000Z`. |
| Clock | `ops/src/execution/clock.ts` | `buildMorningBrief(db)` with no instant is production: wall clock, `America/New_York`, `source: production`. Passing an instant marks the clock `injected`. |
| Showing | `ops/src/execution/showing.ts`, `deriveShowing` | States include `SHOWING_SCHEDULED`. A past scheduled tour with no outcome is `OUTCOME_UNKNOWN` and the label is POST TOUR VERIFICATION NEEDED. A touring-agent outcome stays third party and pivots the next question. A status that still says needs verification, with no touring-agent outcome, stays post tour verification. Dates are normalized before a conflict is raised. Showings today are tours on the clock's Eastern date. Later scheduled tours are upcoming. The active property is the one tied to the latest appointment, not the first discussed address. |
| Waiting and drift | `ops/src/execution/continuity.ts` | Waiting rows store party, reason, start, end condition, next check, stale after, and `marked_by_kyle`. An open buyer with no next action, no trigger, no wait, and no promise is WORKFLOW DRIFT on the card. |
| Promises | `promises` | An open Kyle promise is priority 98 and outranks a passive tour. |
| Approval and execution | `approval_queue`, `applyManualMark`, `ops/src/mode.ts` | Drafts stay PENDING. `liveChannelPermitted` is still false. MARK SENT MANUALLY opens a client wait and does not write `sent_messages`. Outcome marks store `execution_authority = marked_by_kyle`. Nothing writes `verified_by_integration`. |
| Action vs adapter | Fields on `ExecutionCard` | `actionVerb` is TEXT CLIENT, CALL CLIENT, EMAIL CLIENT, or MANUAL STEP. `executionAdapter` is the human sequence (copy, open, paste, send). Ranking does not read the adapter. |
| UI | `ops/public` `#/morning` | Loads `GET /api/execution/brief` from whatever is already in the desk file. COPY uses the clipboard and a hidden textarea. CALL is a `tel:` link. The capability list is stacked so a 390px screen does not scroll sideways. |
| Tests | `ops/test/*.ts` | Existing suites stay. New coverage is `v5-desk.test.ts` and `evaluation-harness.test.ts`. The harness includes the "no test may treat X as Y" pairs. |

`GET /api/execution/brief` is the production desk. It does not seed Hot 7 and it does not read the fixture instant.

## 13. What this pass did not merge

The buyer ledger and the desk SQLite file are still two databases. `backend/` and `mobile/` are still the consult app. No live SMS, email, voice, calendar, Agent Tools, MLS, or Redfin write was added.
