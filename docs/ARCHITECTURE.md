# Architecture

## Choice

One local Node process, a SQLite file, and a phone-friendly web page. Release 1 does not call a paid API.

This is the smallest setup that still has one record per contact, a review queue, drafts that cannot send themselves, a job log, and a backup you can restore. Supabase and OpenAI exist in older code and are not configured. Using them now would add accounts and cost without a Redfin connection.

Redfin remains the system of record for brokerage work. The desk stores working copies with source text, timestamps, and hashes. Notes are written so Kyle can paste them into Redfin. The desk does not update Redfin.

## What runs where

- Browser page: `backend/public`. Open `http://127.0.0.1:8080`.
- API: `/api/os/...` in the same process.
- Database: `backend/data/os.sqlite` (created on first run, not committed).
- Screenshots: `backend/data/uploads`.
- Backups: `backend/data/backups`.
- Older consultation app: `mobile/` and the `/markets`, `/strategy`, `/clients`, `/mls` routes. Left in place. The Redfin page collector does not start unless `RUN_REDFIN_COLLECTOR=true`.

The server listens on `127.0.0.1` unless `HOST` is set. Do not expose it on the public internet. There is no login in this release.

## Record model

One `contacts` row is the person. Linked rows:

- `contact_identifiers` for phone and email. An exact phone or email matches the existing person. The same name with a different phone is a possible duplicate and is not merged.
- `sources` keeps the pasted text or screenshot path and a content hash. The same text or image a second time does not create another contact, note, draft, or follow up.
- `facts` stores each field as stated, data needed, unclear, or conflict. Each fact also records whether the client said it, it is missing, or the reading was unclear.
- `households` links people who share a household. Opting out one person does not change the other person's permission to be contacted.
- `source_attributions` keeps every lead source. The first source stays the original. A later source is added and does not replace it.
- `properties` and `showings` keep address, MLS, requested time, available time, and confirmed time apart.
- `messages` are drafts. `sent_at` stays empty. There is no send route.
- `notes` are the CRM notes.
- `tasks` are follow ups and replies.
- `review_items` are the queue.
- `activity` is the history.
- `jobs` are automations, with a retry cap of 3. Failures show on the daily screen.
- `appointments` and `milestones` are on the daily screen. A milestone without an executed document is labeled as not a real deadline.
- `settings` holds the outbound pause (default on) and the spending limit (default $0).
- `authorizations` is empty. No automatic send is approved.

## Lead path

`POST /api/os/intake` or `POST /api/os/intake/screenshot` runs `extractLead`, then `commit` in one database transaction.

Screenshot text comes from the optional pasted text, then from the local `tesseract` program if it is installed. If the reader is missing, or average word confidence is under 0.75, the contact is named "Unclear screenshot", facts stay unclear, and no client draft is created. A failed job is visible.

Rules in the extractor:

- Financing is only pre-approved, pre-qualified, cash, or needs a lender.
- "If I can get it confirmed" does not confirm a showing.
- Lines that tell the software what to do are stored as source text. They do not send mail or confirm a showing.

Drafts are assembled in `voice.ts` from extracted facts only.

## Safety

- Outbound pause defaults to on.
- Approving a draft sets status to `approved` and leaves `sent_at` empty.
- Asking the desk to queue a send creates a failed job. Nothing is transmitted.
- Spending above the limit is refused. Release 1 does not call a paid API, so spend stays $0 unless a test records it.
- Source text is data. It cannot change these rules.

## Older code

`backend/src/lib/redfinCollector.ts` scrapes public Redfin market pages. It is not an MLS connection and it is off. `backend/src/lib/db.ts` still talks to Supabase for that older app. The desk uses `backend/src/os/db.ts` instead.
