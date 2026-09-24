# Task queue

This is the shared engineering queue. Kyle's follow ups live in the desk database, not in this file.

One owner per task. Do not edit the same files at the same time as another coding session. Current code lock: none.

Grok bot: not present. See `docs/INTEGRATIONS.md`. Tasks that would have gone to a bot are marked manual.

| ID | Task | Owner | State |
| --- | --- | --- | --- |
| Q1 | Requirements, voice, and acceptance rules for release 1 | Grok in Cursor | Done in `docs/REQUIREMENTS.md` |
| Q2 | Local desk: intake, review, drafts, daily screen, backup | Cursor | Done in this branch, tests passing |
| Q3 | Kyle runs setup on his computer and opens the desk | Kyle (manual) | Waiting. Steps in `docs/SETUP.md` |
| Q4 | Decide whether any Redfin export may be copied into the desk | Kyle (manual) | Blocked. Do not import mail until he says which export is allowed |
| Q5 | Install Tesseract if screenshot reading is wanted | Kyle (manual) | Optional. Paste still works without it |
| Q6 | Contact import and reactivation | Cursor, after Q4 | Not started |
| Q7 | Buyer qualification and showing briefs | Cursor | Not started. After Q6 |
| Q8 | Property matching from an authorized MLS export | Cursor | Blocked on MLS authorization |
| Q9 | CMA, investor math, offers, marketing, performance | Cursor | Not started. Order in `docs/BACKLOG.md` |
| Q10 | Any paid account (OpenAI, Supabase, host, MLS vendor) | Kyle (manual) | Not authorized. Default spend limit is $0 |

## Handoff rule

The next coding session should read `docs/STATUS.md` first, then this file, then run `npm test` in `backend` before changing the lead path.
