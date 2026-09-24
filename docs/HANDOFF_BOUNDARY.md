# Handoff boundary

Updated: 2026-09-24. Kyle kept both Cursor agents. They must not build the same product.

## This repo (`reorelated2/82963437`)

Product: **South Florida Buyer Command Center**.

Owns:

- Consult intake in `mobile/` (readiness, financing prompt, strategy screen).
- Cached market metrics: `GET /markets/:city`. Needs Supabase. Not connected in this environment.
- Strategy draft: `POST /strategy`. Needs `OPENAI_API_KEY`. Not connected. It does not text a client.
- Client save: `POST /clients`. Needs Supabase. Not connected.
- MLS helpers: `GET /mls/hiram-zone` and `POST /mls/analyze`. The Hiram payload is a labeled DEMO seed. Analyze only ranks listings the caller supplies. There is no live MLS feed and no Redfin private API.

The Redfin page collector stays off unless `RUN_REDFIN_COLLECTOR=true`. Do not turn that on for this product.

## The other agent

Owns **KyleOS Command**, Stage 1: inquiry or screenshot to SEND, NOTE, NEXT, and the daily command board.

That board is not this server. Do not add it back as the homepage.

Code for an earlier local experiment still sits in `backend/src/os/` and `backend/public/`. It is **not mounted** unless `ENABLE_LEAD_DESK=true`. Leave that flag unset. Do not treat those screens as the CRM of record, and do not keep extending them in this repo.

## Shared rules

- No live client messaging from this server.
- No invented Redfin, Ava, MLS, or ShowingTime API.
- Demo rows stay labeled. The Hiram seed is demo. It is not current inventory.
- Do not report this app as deployed or as a live CRM.
