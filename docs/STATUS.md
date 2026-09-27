# Project status

Updated: 2026-09-27. Branch: `cursor/command-center-agents-bef2`. Mode: DRAFT. Autopilot is off. Handoff: `docs/REVENUE_HANDOFF.md`.

This lane is the Buyer Command Center in `reorelated2/82963437`. It is not the inquiry CRM. Boundary: `docs/HANDOFF_BOUNDARY.md`.

## BUILT

- Three agents: consult, market, and mls, at `GET /agents` and `POST /agents/:name`.
- Consult, market, strategy, and client routes remain in `backend/src/server.ts` and `mobile/`.
- `GET /mls/hiram-zone` returns the existing seed and now marks it `demo: true`.
- `POST /mls/analyze` ranks only listings the caller supplies. It says it is not a live MLS connection.
- The inquiry board under `backend/src/os` is not mounted. `ENABLE_LEAD_DESK` is unset on purpose.

## VERIFIED

`cd backend && ./node_modules/.bin/tsc --noEmit && npm test` — typecheck passed, 28 passed, 0 failed.

On the running process at `http://127.0.0.1:8080` on 2026-09-27: `GET /agents` lists consult, market, and mls. A Need Lender consult returned readiness 26 and said that is not an approval. A request to send a text returned HTTP 400. `POST /agents/mls` with `demoSeed: true` stayed labeled DEMO. `GET /api/os/workspace` is HTTP 404. Evidence is in `docs/TEST_RESULTS.md`.

## BLOCKED

- Supabase is not configured, so `/markets/:city` and `/clients` cannot save.
- `OPENAI_API_KEY` is absent, so `/strategy` cannot run.
- No Redfin private API and no live MLS feed.
- This server does not send client messages.
- This environment is not a deployment.

## NEXT

Leave Stage 1 (inquiry, SEND, NOTE, NEXT, daily board) to the other agent. Further work in this repo stays on consult intake, market metrics, and MLS analyze helpers.
