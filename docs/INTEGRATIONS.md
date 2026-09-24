# Integration status

Checked 2026-09-24. A row is verified only when this desk completed a real call. Local tests are not treated as live integrations.

| Connection | Status | Read | Write | Notes |
| --- | --- | --- | --- | --- |
| Paste and screenshot | Verified working | Yes, from what Kyle provides | Local desk only | Works with no account. Screenshot reading needs Tesseract on the computer. |
| SQLite file on this computer | Verified working | Yes | Yes | `ops/data/desk.sqlite`. This is the working copy, not Redfin. |
| Redfin Partner Tools | Requires authorization, and no public write API was found | Manual, in Redfin's own site | Not available from this desk | Customer list and notes stay in Partner Tools. Help page reviewed: [Partner Tools dashboard](https://partneragents.redfin.com/hc/en-us/articles/12757857664141-Module-3-Partner-Tools-Dashboard-and-Customer-List). Use Check Redfin connection in the desk. It records a visible failure. It does not pretend to sync. |
| Redfin public listing API | Unsupported or unknown | No | No | No official self-serve listing or CRM API was found. Aggregate downloads live at the [Redfin Data Center](https://www.redfin.com/news/data-center/). That is not a client record feed. |
| Gmail in this Cursor session | Available but not authorized for client data | The signed-in mailbox tools are connected | Draft tools exist | Client and employer mail were not read or imported. A forwarded work email would not by itself permit that. |
| Supabase | Available but not connected | Schema file only | No | `supabase/migrations/001_initial_schema.sql` exists. No URL or key is configured. The lead desk does not need it. |
| OpenAI API | Requires authorization and a separate paid key | No | No | The old `backend/` code expects `OPENAI_API_KEY`. None is set. A consumer chat subscription is not API access. The lead desk does not call it. |
| Playwright Redfin collector | Unsupported for this workflow | Unverified scrape of public market pages | No | Left in `backend/`. Not started by the lead desk. Not a client source. |
| `mail.php` seller form | Unsupported for this workflow | Would email a different site's seller leads | No | It posts to `rocketbuyeronline@gmail.com`. That flow is not authorized for this Redfin desk and is not connected. |
| Notion, Outlook, Drive, Quo, Hostinger | Requires authorization | Not used | Not used | Not authenticated for this build. |
| Supermemory | Unsupported or unknown | No | No | The memory connection failed during discovery. |
| MLS / IDX | Requires authorization | No | No | No MLS credentials are connected. Do not invent listing status. |

## Manual fallback

Until Redfin or MLS access is authorized:

1. Paste the lead text, or upload a screenshot.
2. Review the draft and the note.
3. Copy the message into the texting app yourself.
4. Paste the CRM note into Redfin Partner Tools yourself.

## Cost

Selected paid dependencies: none. Estimated monthly cost of this release: $0. The desk stores a spending limit, default `$0`, and does not call a metered API. Actual usage of paid APIs: none.
