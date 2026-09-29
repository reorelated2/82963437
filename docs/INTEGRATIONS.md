# Integration status

Checked 2026-09-24. A row is verified only when a desk completed a real call. Local tests are not treated as live integrations.

## KyleOS (`ops/`)

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

### Manual fallback

Until Redfin or MLS access is authorized:

1. Paste the lead text, or upload a screenshot.
2. Review the draft and the note.
3. Copy the message into the texting app yourself.
4. Paste the CRM note into Redfin Partner Tools yourself.

### Cost

Selected paid dependencies: none. Estimated monthly cost of this release: $0. The desk stores a spending limit, default `$0`, and does not call a metered API. Actual usage of paid APIs: none.

## Consult app and session checks from `main`

These rows describe the Buyer Command Center and the unmounted `backend/src/os` experiment. They do not replace the KyleOS table above.

| System | Status | What was checked | Source |
| --- | --- | --- | --- |
| Pasted text and screenshots | Verified working | 13 automated checks on synthetic records, plus later backend tests. The page was exercised in a browser. | `backend/src/os`, not mounted by the consult server |
| Screenshot reader (`tesseract`) | Available but not connected on every computer | The experiment calls the `tesseract` program when it is installed. If it is missing, the failure is shown and you can paste the text. | Local program, not a cloud OCR bill |
| Redfin CRM | Unsupported or unknown | No public agent CRM API was found. Partner tools are a website, not an API this desk can call. | https://www.redfin.com/partners and the Partner Tools help page above |
| Redfin page collector in this repo | Unsupported or unknown | Older scraper. Off unless `RUN_REDFIN_COLLECTOR=true`. Not an authorized feed. | `backend/src/lib/redfinCollector.ts` |
| MIAMI MLS / BeachesMLS | Requires authorization | Miami Realtors and RWorld, including MIAMI MLS and BeachesMLS, merged on May 11, 2026. No login is connected. | https://www.miamirealtors.com/2026/05/12/miami-realtors-and-rworld-complete-historic-merger-creating-the-worlds-largest-local-realtor-association/ |
| Gmail | Available but not connected to this desk | Cursor can see a Gmail account, including a Redfin label. The desk does not read it. Connected mail is not permission to copy employer messages. | Checked in that session by listing labels only |
| Notion | Available but not connected to this desk | Search found People pages, not a lead database. A Kyle Kleinman page returned "managed by Notion" and could not be read. Nothing was imported. | Notion connection in Cursor |
| Outlook | Requires authorization | The connection is installed and needs sign-in. | Cursor MCP status |
| Attio | Requires authorization | The connection is installed and needs sign-in. Not used. | Cursor MCP status |
| Supabase | Available but not connected | Older code expects `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Neither is set. Cost while unused: $0. | https://supabase.com/docs |
| OpenAI API | Available but not connected | No API key. Drafts are local rules. A ChatGPT subscription does not include API use. | https://help.openai.com/en/articles/6950777 |
| Quo SMS | Available but not connected | May be installed in Cursor. This desk has no send path. | Not called |
| Supermemory | Unsupported or unknown | The connection failed during tool discovery. | Cursor MCP status |

## Grok bot

There is no separate Grok bot in this project, on this machine, or in the connected tools. A cloud coding session can edit this repository. It cannot, by itself, control Kyle's computer, log into Redfin, or talk to another Cursor window. When a step needs Kyle, `docs/SETUP.md` and `docs/DAILY_GUIDE.md` give the clicks.

## Money

Release 1 estimated recurring cost: **$0**. No service was purchased. The spending limit defaults to $0. Recorded spend stays $0 in normal use.

Do not add an OpenAI key, Supabase project, MLS vendor, or host unless Kyle decides to pay for it. Ask before any of those are turned on.
