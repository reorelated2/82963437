# Decision log

Updated: 2026-09-24. These are the choices already made for the first working desk. Change one only by adding a new line here, not by silently replacing it.

| Decision | Why |
| --- | --- |
| This repo stays the Buyer Command Center. Stage 1 SEND/NOTE/NEXT is the other agent's product. | Kyle kept both agents. `ENABLE_LEAD_DESK` stays unset so this server does not compete as the CRM. See `docs/HANDOFF_BOUNDARY.md`. |
| One local Node process, SQLite, and a page at `http://127.0.0.1:8080` | Smallest setup that stores records, survives a restart, and does not need a paid account. The page is no longer mounted. |
| Redfin stays the system of record | This desk holds working copies and notes to paste. It does not write to Redfin. |
| There is no separate Grok bot | This session is Grok inside Cursor. It can edit this repo. It cannot operate Kyle's computer, log into Redfin, or message another Cursor window. |
| Drafts do not send | There is no send route. Approving a draft sets it to approved and leaves `sent_at` empty. Outbound pause defaults to on. Spending limit defaults to $0. |
| Demo rows are excluded from live counts | Practice records stay labeled DEMO and are not mixed into live contact counts or the weekly live summary. |
| Original lead source is not overwritten | The first source is stored as original. A later source is appended. |
| A household is a shared label, not shared permission | Two people can share a household. An opt-out suppresses only the person who asked. |
| Spanish only when stated | A neighborhood such as Hialeah does not change the language. |
| Priority comes from stated behavior | A requested, unconfirmed showing, or a stated near timeline (ASAP, this month, or 30), is why someone is "most likely to move." Protected characteristics are not used. |
| Income is not calculated yet | $250K net is a planning target. Gross commission, brokerage compensation, expenses, taxes, and net income stay "Data needed" until Kyle supplies those assumptions. |
| Held appointments and response time stay blank | Missing data is null, not zero. |
| A reply or opt-out closes the previous follow up | The earlier draft is cancelled so two texts are not waiting. Nothing is sent. |
| Follow-up times use America/New_York | 9:00 Eastern is 9:00 on both the March and November daylight-saving dates in 2026. |
