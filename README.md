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
