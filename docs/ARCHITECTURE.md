# Architecture

## KyleOS desk (`ops/`)

The first release is a local web desk plus a SQLite file. Node serves the page and the API. No hosted database, no paid AI API, and no Redfin login are required to use the workflow.

This is the smallest setup that still has a real record, a review queue, a restart-safe file, and a backup. The older Expo app and Playwright collector remain in the repo, but they are not the operating system and they are not used for client messages.

## System of record

Redfin Partner Tools is the system of record for Redfin customers. This desk is a working copy. Every note says that. Export and backup exist so the copy can leave this computer. There is no silent two-way sync.

## Records

One contact is the canonical person. Linked rows hold facts, source events, conflicts, activities, notes, drafts, tasks, appointments, milestones, and jobs.

Stable ids are UUIDs. Source events store the raw text, a content hash, an optional idempotency key, and a timestamp. Phone and email identifiers are unique. The same name alone is not merged.

Showing times use three roles: requested, available, and confirmed. A clock time is stored as an appointment only when the source gives a day word and am/pm. The role stays `requested` unless the source explicitly confirms it.

## Inquiry agent

A paste or screenshot runs the inquiry agent in `ops/src/agent.ts`. The run is stored in `agent_runs` and `agent_steps`. The tools, in order, are extract visible facts, match a contact, propose the package, read SEND / NOTE / NEXT, and refuse to send.

Match uses a phone or an email. A name alone is a hold, not a merge. The agent does not have a send, Redfin write, MLS, or ShowingTime tool. `sent_messages` stays empty.

## Jobs and outbound

Outbound automations start paused. Draft mode is the default. `sent_messages` exists so tests can prove a send did not happen. Jobs retry at most 3 times and failed jobs stay visible until acknowledged. There is no authorized send workflow, so turning pause off still does not send.

## Safety

Intake text is stored as data. It is not executed and it cannot change these rules. The server binds to `127.0.0.1` unless `OPS_HOST` is set. Do not expose it on the public internet without an access control that this version does not have.

Screenshot reading uses local Tesseract. If Tesseract is missing, or confidence is under 45, no contact is created.

## Where the KyleOS code lives

| Path | Role |
| --- | --- |
| `ops/src/extract.ts` | Fact extraction |
| `ops/src/voice.ts` | Summary, CRM note, and client draft |
| `ops/src/workflow.ts` | Matching, queue, workspace, backup |
| `ops/src/server.ts` | Local HTTP API and pages |
| `ops/public/` | Mobile-friendly desk |
| `ops/test/lead-workflow.test.ts` | Acceptance checks |

## Consult app and the unmounted backend experiment

`main` describes a different local desk that is not the KyleOS operating path. That experiment lives under `backend/src/os` and is not mounted by the Buyer Command Center server. Leave `ENABLE_LEAD_DESK` unset. Its database, if someone runs that code later, is `backend/data/os.sqlite`, not `ops/data/desk.sqlite`.

What that experiment was designed to do:

- Browser page: `backend/public`. Open `http://127.0.0.1:8080` only for the consult app. The consult app's `/` response is the Buyer Command Center, not this desk.
- API shape, when mounted: `/api/os/...` in the same process.
- Screenshots: `backend/data/uploads`. Backups: `backend/data/backups`.
- Older consultation app: `mobile/` and the `/markets`, `/strategy`, `/clients`, `/mls` routes. Left in place. The Redfin page collector does not start unless `RUN_REDFIN_COLLECTOR=true`.

Record notes from that experiment, kept so the design is not lost:

- `contact_identifiers` match an exact phone or email. The same name with a different phone is not merged.
- `sources` keep pasted text or a screenshot path and a content hash.
- `facts` store stated, data needed, unclear, or conflict.
- `households` link people. Opting out one person does not change the other person's permission.
- `source_attributions` keep every lead source. A later source does not replace the first.
- `properties` and `showings` keep address, MLS, requested time, available time, and confirmed time apart.
- `messages` are drafts. `sent_at` stays empty.
- `jobs` retry at most 3 times. `settings` hold the outbound pause (default on) and the spending limit (default $0). `authorizations` stay empty.

`backend/src/lib/redfinCollector.ts` scrapes public Redfin market pages. It is not an MLS connection and it is off unless explicitly enabled. `backend/src/lib/db.ts` still talks to Supabase for the older consult app. The KyleOS desk does not use that client.
