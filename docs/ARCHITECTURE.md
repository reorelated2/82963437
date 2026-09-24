# Architecture

## Choice

The first release is a local web desk plus a SQLite file. Node serves the page and the API. No hosted database, no paid AI API, and no Redfin login are required to use the workflow.

This is the smallest setup that still has a real record, a review queue, a restart-safe file, and a backup. The older Expo app and Playwright collector remain in the repo, but they are not the operating system and they are not used for client messages.

## System of record

Redfin Partner Tools is the system of record for Redfin customers. This desk is a working copy. Every note says that. Export and backup exist so the copy can leave this computer. There is no silent two-way sync.

## Records

One contact is the canonical person. Linked rows hold facts, source events, conflicts, activities, notes, drafts, tasks, appointments, milestones, and jobs.

Stable ids are UUIDs. Source events store the raw text, a content hash, an optional idempotency key, and a timestamp. Phone and email identifiers are unique. The same name alone is not merged.

Showing times use three roles: requested, available, and confirmed. A clock time is stored as an appointment only when the source gives a day word and am/pm. The role stays `requested` unless the source explicitly confirms it.

## Jobs and outbound

Outbound automations start paused. Draft mode is the default. `sent_messages` exists so tests can prove a send did not happen. Jobs retry at most 3 times and failed jobs stay visible until acknowledged. There is no authorized send workflow, so turning pause off still does not send.

## Safety

Intake text is stored as data. It is not executed and it cannot change these rules. The server binds to `127.0.0.1` unless `OPS_HOST` is set. Do not expose it on the public internet without an access control that this version does not have.

Screenshot reading uses local Tesseract. If Tesseract is missing, or confidence is under 45, no contact is created.

## Where the code lives

| Path | Role |
| --- | --- |
| `ops/src/extract.ts` | Fact extraction |
| `ops/src/voice.ts` | Summary, CRM note, and client draft |
| `ops/src/workflow.ts` | Matching, queue, workspace, backup |
| `ops/src/server.ts` | Local HTTP API and pages |
| `ops/public/` | Mobile-friendly desk |
| `ops/test/lead-workflow.test.ts` | Acceptance checks |
