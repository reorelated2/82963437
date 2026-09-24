# Integrations

Checked 2026-09-24 from this coding session. Labels mean what they say. A local test is not a live integration.

| System | Status | What was checked | Source |
| --- | --- | --- | --- |
| Pasted text and screenshots | Verified working | 13 automated checks on synthetic records. The page was exercised in a browser. | This repo, `backend/src/os` |
| Screenshot reader (`tesseract`) | Available but not connected on every computer | The desk calls the `tesseract` program when it is installed. If it is missing, the failure is shown and you can paste the text. | Local program, not a cloud OCR bill |
| Redfin CRM | Unsupported or unknown | No public agent CRM API was found. Partner tools are a website, not an API this desk can call. | https://www.redfin.com/partners and https://partneragents.redfin.com/hc/en-us/articles/12757857664141-Module-3-Partner-Tools-Dashboard-and-Customer-List |
| Redfin page collector in this repo | Unsupported or unknown | Older scraper. Off unless `RUN_REDFIN_COLLECTOR=true`. Not an authorized feed. | `backend/src/lib/redfinCollector.ts` |
| MIAMI MLS / BeachesMLS | Requires authorization | Miami Realtors and RWorld, including MIAMI MLS and BeachesMLS, merged on May 11, 2026. No login is connected. | https://www.miamirealtors.com/2026/05/12/miami-realtors-and-rworld-complete-historic-merger-creating-the-worlds-largest-local-realtor-association/ |
| Gmail | Available but not connected to this desk | Cursor can see a Gmail account, including a Redfin label. The desk does not read it. Connected mail is not permission to copy employer messages. | Checked in this session by listing labels only |
| Notion | Available but not connected to this desk | Search found People pages, not a lead database. A Kyle Kleinman page returned "managed by Notion" and could not be read. Nothing was imported. | Notion connection in Cursor |
| Outlook | Requires authorization | The connection is installed and needs sign-in. | Cursor MCP status |
| Attio | Requires authorization | The connection is installed and needs sign-in. Not used. | Cursor MCP status |
| Supabase | Available but not connected | Older code expects `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Neither is set. Cost while unused: $0. | https://supabase.com/docs |
| OpenAI API | Available but not connected | No API key. Drafts are local rules. A ChatGPT subscription does not include API use. | https://help.openai.com/en/articles/6950777 |
| Quo SMS | Available but not connected | May be installed in Cursor. This desk has no send path. | Not called |
| Supermemory | Unsupported or unknown | The connection failed during tool discovery. | Cursor MCP status |

## Grok bot

There is no separate Grok bot in this project, on this machine, or in the connected tools. This session is Grok running inside Cursor as a cloud coding agent. It can edit this repository. It cannot, by itself, control Kyle's computer, log into Redfin, or talk to another Cursor window. When a step needs Kyle, `docs/SETUP.md` and `docs/DAILY_GUIDE.md` give the clicks.

## Money

Release 1 estimated recurring cost: **$0**. No service was purchased. The spending limit defaults to $0. Recorded spend stays $0 in normal use.

Do not add an OpenAI key, Supabase project, MLS vendor, or host unless you decide to pay for it. Ask before any of those are turned on.
