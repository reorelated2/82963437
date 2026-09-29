import type { IntegrationRow } from "./types.js";

const CHECKED = "2026-09-24";

export function integrationMatrix(): IntegrationRow[] {
  return [
    {
      name: "Pasted text and screenshots",
      status: "verified_working",
      purpose: "Take a new lead without a live CRM connection.",
      detail: "Runs on this computer. Screenshots use a local reader when it is installed. Nothing is sent.",
      checkedOn: CHECKED,
    },
    {
      name: "Redfin CRM",
      status: "unsupported_or_unknown",
      purpose: "Brokerage system of record for Kyle's Redfin work.",
      detail:
        "No official public agent CRM API was found. This desk keeps working copies and notes for you to paste into Redfin. It does not write back.",
      checkedOn: CHECKED,
      source: "https://www.redfin.com/partners",
    },
    {
      name: "Redfin page collector in this repo",
      status: "unsupported_or_unknown",
      purpose: "Older market-page scraper.",
      detail: "Turned off unless RUN_REDFIN_COLLECTOR=true. It is not an authorized MLS connection and is not part of this desk.",
      checkedOn: CHECKED,
    },
    {
      name: "MIAMI MLS / BeachesMLS",
      status: "requires_authorization",
      purpose: "Property facts for Miami-Dade and Broward.",
      detail:
        "The associations merged on May 11, 2026. No MLS login is connected. Supply an export you are allowed to use. The desk will not invent listing status.",
      checkedOn: CHECKED,
      source: "https://www.miamirealtors.com/2026/05/12/miami-realtors-and-rworld-complete-historic-merger-creating-the-worlds-largest-local-realtor-association/",
    },
    {
      name: "Gmail",
      status: "available_not_connected",
      purpose: "Possible later source of lead mail.",
      detail:
        "A Gmail account is connected in Cursor, including a Redfin label. This desk does not read or import that mail. A connected inbox is not permission to copy employer mail.",
      checkedOn: CHECKED,
    },
    {
      name: "Notion",
      status: "available_not_connected",
      purpose: "Notes outside the desk.",
      detail:
        "Notion is connected in Cursor. Search did not find a lead database. A People page for Kyle Kleinman is not readable by this connection. Client records were not imported.",
      checkedOn: CHECKED,
    },
    {
      name: "Outlook",
      status: "requires_authorization",
      purpose: "Mail.",
      detail: "The Outlook connection is installed and needs sign-in. Not used.",
      checkedOn: CHECKED,
    },
    {
      name: "Attio",
      status: "requires_authorization",
      purpose: "External CRM.",
      detail: "The Attio connection is installed and needs sign-in. Not used. Redfin stays the system of record.",
      checkedOn: CHECKED,
    },
    {
      name: "Supabase",
      status: "available_not_connected",
      purpose: "Older hosted database for the consultation app.",
      detail: "Code exists. No SUPABASE_URL or key is configured. Release 1 uses a local database and does not need Supabase. Cost while unused: $0.",
      checkedOn: CHECKED,
      source: "https://supabase.com/docs",
    },
    {
      name: "OpenAI API",
      status: "available_not_connected",
      purpose: "Optional later wording help.",
      detail:
        "No API key is configured. Drafts are written by local rules. A ChatGPT subscription does not include API access. Do not add a key unless you want that bill.",
      checkedOn: CHECKED,
      source: "https://help.openai.com/en/articles/6950777",
    },
    {
      name: "Quo SMS",
      status: "available_not_connected",
      purpose: "Text messages.",
      detail: "A Quo connection may be installed in Cursor. This desk has no authorized send workflow and does not text anyone.",
      checkedOn: CHECKED,
    },
  ];
}
