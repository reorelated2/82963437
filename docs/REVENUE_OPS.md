# Revenue desk

Updated: 2026-09-27. This is a working procedure on the Buyer Command Center. It is not the inquiry board. It does not text anyone, write to Redfin, or store a lead.

Open `http://127.0.0.1:8080/revenue/desk` after `cd backend && npm run dev`. `GET /revenue` is the same playbook in JSON.

## What you paste

Facts only. If a field was not said, leave it blank. The desk prints **Data needed**. It does not guess a budget, a comp, a deposit, or a completed call.

The page returns four things:

1. The next action.
2. A text, email, or call script with one objective. You copy it and send it yourself.
3. An Agent Tools note in chronological order. Paste it into Redfin yourself.
4. A follow up time or a trigger.

## Rules the desk enforces

- The first question asks why they reached out, unless they already requested a tour. Then the question is whether that time works if you can get it confirmed.
- Qualification order is motivation, location, property criteria, budget, cash or financing, preapproval, timeline, decision makers. One question at a time.
- A search step appears only after those are filled. No listings are attached. There is no live MLS feed.
- Coordinator contact is labeled as not your contact.
- A requested tour stays unconfirmed until a confirmed time is in the packet.
- Portal activity is not called motivation.
- An opt out produces no draft.
- Spanish is used only when the packet says they asked for Spanish.

## Other lanes

`POST /revenue/capture/quote` uses the working rate card: $90 standard interior/exterior V2 with no floor plan, plus $10 for Homestead, $45 nearby exterior, $65 exterior beyond 15 miles. Scans, rush work, and long trips stay custom. A benchmark is not an agreed fee.

`POST /revenue/pricing` prices only listings and closed sales you supply with a source. Short term rent is ignored until rental restrictions are marked allowed. Monthly cost is calculated only when price, down payment, rate, term, taxes, and insurance are all supplied.

`POST /revenue/offer` recommends only terms present in the packet. A date without a source clause is not an executed deadline.

`POST /revenue/evidence` checks a PDC / Digital Appraiser packet. The collector's attestation is kept as written. Missing or conflicting evidence is not a sellable pilot.

`POST /revenue/pulse` publishes a Miami Pulse / J Stats note only when the change has a topic, source, and as-of date. An implication is labeled interpretation. Clients and deals stay "Not measured" until you enter a count.

`POST /revenue/prioritize` sorts by expected revenue times probability, divided by hours. That score is a sort key, not a forecast. Overdue items stay on the due list.

`POST /revenue/scoreboard` leaves closings, volume, and net income as Data needed until you supply them. $250K by April 30, 2027 is the planning target.

## Next step when nothing is loaded

Paste the hottest open Redfin thread, Capture order, or property. Contact that person yourself.
