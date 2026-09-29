# Task queue

One owner per task. Do not edit the same file from two sessions. Kyle's follow ups live in the desk database, not in this file.

## KyleOS (`ops/`)

Status also lives in `docs/PROJECT_STATUS.md`.

| Id | Task | Owner | Status |
| --- | --- | --- | --- |
| LD-1 | Stage 1 inquiry desk: extract, match, SEND / NOTE / NEXT, Daily Command board | Cursor | Done in this branch. 25 tests passed on 2026-09-27, then 30 with the inquiry agent. Pending Kyle's use on his computer. |
| LD-2 | Review acceptance against a real pasted lead Kyle chooses | Kyle | Waiting. Use synthetic or a lead he is allowed to paste. |
| LD-3 | Decide whether any inbox may be imported | Kyle | Blocked until he names the permitted source. |
| LD-4 | Contact import and reactivation | Cursor | Not started. Next module after LD-2. |
| LD-5 | Buyer qualification and showing briefs | Cursor | Not started. |
| LD-6 | Property matching from an authorized feed | Cursor | Blocked. No MLS authorization. |
| LD-7 | CMA, investor, offers, marketing, performance | Cursor | Not started. Order is in `docs/BACKLOG.md`. |
| GR-1 | Requirements and acceptance review | Grok | Done for the first release in this session. There is no separate Grok bot to message. |
| GB-1 | Operational sends or account actions | Grok bot | Blocked. No separate bot with permissions was found. |

## Consult app (`backend/` and `mobile/`)

Current code lock: none. Grok bot: not present. See `docs/INTEGRATIONS.md`. Tasks that would have gone to a bot are marked manual.

The inquiry board is `ops/` in this repository. The Buyer Command Center must not mount `backend/src/os`. Leave `ENABLE_LEAD_DESK` unset. Do not send Kyle to port 8080 for SEND / NOTE / NEXT.

| ID | Task | Owner | State |
| --- | --- | --- | --- |
| Q1 | Requirements, voice, and acceptance rules for release 1 | Grok in Cursor | Done in `docs/REQUIREMENTS.md` |
| Q2 | Local desk experiment under `backend/src/os` | This repo | Kept, unmounted. KyleOS Stage 1 is `ops/`. |
| Q3 | Kyle uses the inquiry board | `ops/` | Port 8787. Not the consult server. |
| Q11 | Keep consult, markets, and MLS helpers; label the Hiram seed as demo | This repo | In progress. Boundary in `docs/HANDOFF_BOUNDARY.md`. |
| Q4 | Decide whether any Redfin export may be copied into the desk | Kyle (manual) | Blocked. Do not import mail until he says which export is allowed |
| Q5 | Install Tesseract if screenshot reading is wanted | Kyle (manual) | Optional. Paste still works without it |
| Q6 | Contact import and reactivation | Cursor, after Q4 | Not started |
| Q7 | Buyer qualification and showing briefs | Cursor | Not started. After Q6 |
| Q8 | Property matching from an authorized MLS export | Cursor | Blocked on MLS authorization |
| Q9 | CMA, investor math, offers, marketing, performance | Cursor | Not started. Order in `docs/BACKLOG.md` |
| Q10 | Any paid account (OpenAI, Supabase, host, MLS vendor) | Kyle (manual) | Not authorized. Default spend limit is $0 |

## Handoff rule

The next coding session on KyleOS should read `docs/PROJECT_STATUS.md`, then this file, then run `npm test` in `ops/`. A session on the consult app should read `docs/STATUS.md` and `docs/HANDOFF_BOUNDARY.md`, then run `npm test` in `backend/`.
