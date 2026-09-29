# KyleOS status

Updated: 2026-09-29. Lineage: `cursor/lead-follow-up-os-5170`. Draft PR #12 remains open against `main` and is still conflicting. This Phase 1 work continues on that lineage. It does not merge to `main`.

## Built

- Stage 1 desk in `ops/` (KyleOS Command / `kleinman-lead-desk`): paste and screenshot intake, SEND / NOTE / NEXT, draft-only, demo labels, audit log.
- Buyer-conversion ledger in `ops/src/runtime/`. Policy `2026-09-27.unreleased`. `liveSend` false. Tick command exists. No platform routine is registered.
- Phase 1 canonical records on the desk SQLite file: clients, opportunities, idempotent events, verified facts versus inferences, identity flags, workflow locks, migration `2026-09-29-canonical-clients`.
- Architecture map: `docs/KYLE_OS_ARCHITECTURE.md`.

## Verified this run

```bash
cd ops
npx tsc --noEmit
npm test
```

Typecheck passed. `npm test`: **63 passed, 0 failed**.

The first test run, before Pillow was installed, was 51 passed and 1 failed. The failure was the screenshot fixture (`Pillow is required to draw the screenshot fixture.`). After Pillow was installed, that test passed with the rest. Pillow is an environment tool, not an `ops` dependency.

No live SMS, email, or call was sent. No Redfin or MLS API was added. `sent_messages` was not written by the new lead path.

## Safety defaults

- `SYSTEM_MODE` defaults to `DRY_RUN` (`.env.example`).
- `LIVE_SEND`, `SMS_SEND`, `EMAIL_SEND`, and `AI_CALLING` are documented and forced off in `ops/src/mode.ts`.
- Desk password default remains `local-kyle` via `OPS_PASSWORD`.
- Server default bind remains `127.0.0.1`.

## Blocked

- PR #12 `mergeable_state` is dirty. Conflicts with `main` are `.gitignore`, `README.md`, and the shared docs both sides added (`ARCHITECTURE`, `BACKLOG`, `BACKUP`, `DAILY_GUIDE`, `INTEGRATIONS`, `REQUIREMENTS`, `SETUP`, `TASK_QUEUE`, `TEST_RESULTS`). `ops/` is not on `main`. Do not delete it to resolve the merge.
- Hosted deploy is not set up.
- Redfin Partner Tools write-back, MLS, ShowingTime, Quo, Gmail send, and calling providers are not connected.
- Supabase and OpenAI keys are unset and are not required for this desk.
- Real client data is not loaded. Demo rows are synthetic.
- Spanish drafts are not built.

## Next

Phase 2 can add communication provider interfaces only as drafts: a Quo/SMS adapter, a Gmail draft adapter, and a call adapter that return `not_attempted` until Kyle turns a specific flag on. Do not enable `LIVE` mode in that step. Resolve the PR #12 doc conflicts without removing `ops/` before anything merges to `main`.
