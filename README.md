# KyleOS Command

The Stage 1 app is the local package `kleinman-lead-desk` in `ops/`. The screen title is KyleOS Command. The inquiry agent turns a pasted inquiry or a screenshot into visible facts only, matches an existing contact by email or phone, and puts SEND, NOTE, and NEXT on the Daily Command board. Each run is saved. The agent has no send tool. It does not send texts or email. Redfin Partner Tools stays the system of record.

Sample people are labeled DEMO. They are not a live CRM.

Start here:

1. [Setup](docs/SETUP.md)
2. [Daily guide](docs/DAILY_GUIDE.md)
3. [Project status](docs/STATUS.md)
4. [Architecture audit](docs/KYLE_OS_ARCHITECTURE.md)

```bash
cd ops
npm install
npm run typecheck
npm test
npm start
```

`npm test` runs:

```bash
node --experimental-strip-types --experimental-sqlite --test test/*.ts
```

Latest result on this branch, 2026-09-29: typecheck passed. `npm test` reported 102 passed, 0 failed. Live send stayed off. The pre-Phase-1 suite on `cursor/lead-follow-up-os-5170`, after merging `main`, was 52 passed.

Then open `http://127.0.0.1:8787`. Sign in with the local password from [Setup](docs/SETUP.md). The default is `local-kyle`. Click **Load sample day** to see the board. Screenshot of that synthetic board: [docs/screenshots/command-board.png](docs/screenshots/command-board.png).

Still blocked: Redfin write-back, MLS, ShowingTime, live Quo SMS, Gmail import, and Spanish drafts. Details are in [Project status](docs/PROJECT_STATUS.md).

# South Florida Buyer Command Center

This repository also contains the consult, market, and MLS-helper app. That app is not the inquiry command board.

The inquiry board is `ops/` on port 8787. The Buyer Command Center server on port 8080 does not mount `backend/src/os`. Leave `ENABLE_LEAD_DESK` unset. The boundary note is [docs/HANDOFF_BOUNDARY.md](docs/HANDOFF_BOUNDARY.md).

```bash
cd backend && npm install && npm run dev
```

Open `http://127.0.0.1:8080`. Expect a JSON description of this product, not a CRM board. `GET /mls/hiram-zone` is a labeled DEMO seed. Nothing on this server sends a client message.

# South Florida Buyer Command Center (Expo + Node + Playwright)

This repository now includes a production-oriented scaffold for a **Redfin-agent consultation app** with:

- **Mobile app**: React Native + Expo + TypeScript (`mobile/`)
- **Backend API**: Node.js + Express + TypeScript (`backend/`)
- **Collector worker**: Playwright scraping public Redfin market pages on a schedule
- **Database**: Supabase Postgres schema migrations (`supabase/migrations/`)

## Key Features Implemented

### Mobile (Expo)
- Voice/rapid-intake-ready consultation screen + readiness meter calculation.
- Rocket Mortgage ONE+ CTA script card trigger when financing is **Need Lender**.
- Score + strategy screen with **Client Mode** toggle and **Text-to-Speech** button.
- Market report screen rendering cached market metrics and negotiation posture.
- ARV + Offer tools screen including deal rating and offer strength score.
- Offline caching helpers for latest 10 market reports and 20 clients.

### Backend (Express + Playwright)
- `GET /markets/:city` for cached market snapshots.
- `POST /strategy` for strict JSON AI strategy generation.
- `POST /clients` for persisting consultation outcomes.
- `GET /mls/hiram-zone` returns pre-scored 20 target-zone MLS listings (18 active after filtering).
- `POST /mls/analyze` merges MLS feeds, deduplicates, filters by zone/budget, and returns ranked motivation signals.
- Rate limiting and retries for resilient operation.
- Scheduled collector (every 6 hours) with fallback seed values if scraping fails.

## Setup

### 1) Mobile app
```bash
cd mobile
npm install
npm run start
```

### 2) Backend API
```bash
cd backend
npm install
npm run dev
```

Environment variables for backend:

```bash
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
PORT=8080
RUN_COLLECTOR_ON_BOOT=true
```

### 3) Supabase migration
Run the SQL in `supabase/migrations/001_initial_schema.sql` using the Supabase SQL editor or CLI migration flow.

## Notes
- The mobile app never scrapes directly; it reads from backend cached results.
- If collector extraction fails, fallback metrics are used and persisted.
- Metrics that are not reliably present are returned/displayed as `Not available`.
