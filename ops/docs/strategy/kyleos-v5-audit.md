# KyleOS v5 strategic audit

Date: 2026-09-29. This audit was written before the short-sight code in the same branch. It is a decision record, not a second product.

Change gate used below: A extension, B refactor, C migration, D future idea.

## What KyleOS is today

KyleOS in this repo is a local command desk (`ops/`, package `kleinman-lead-desk`). Canonical clients, opportunities, and facts are the record. A conversion engine picks one next best action. An approval queue holds drafts. The Morning Execution Brief is a view of that loop: a human headline, a draft Kyle sends himself, and marks that do not pretend to be provider receipts.

Agent Tools ingestion can preview, then apply, one small batch. `SYSTEM_MODE` defaults to `DRY_RUN`. Live SMS, email, and voice are hard-off. There is no committed production client database. `ops/data/` holds an empty placeholder. Hot 7 is a synthetic fixture built from the 2026-09-29 dry-run report.

A separate `backend/` tree and `policy/KYLEOS_CORE_PROMPT.md` exist. The desk Kyle actually runs does not call that backend prompt. Execution copy is deterministic code in `ops/src/conversion/execution.ts`, not a second model.

## What it should become

A phone-first chief of staff for one field agent. The product is the next true step, then the outcome, then the next step. The morning brief is one view of that loop, not the loop itself.

Kyle still does the relationship: the call, the showing, the advice, the negotiation, the promise. Software remembers the promise, the wait, the missing fact, and the rank. It does not send, book, or write Redfin.

## Strong

- One client and one opportunity, matched on phone or email, not on a name.
- One next action, with drafts that stay in an approval queue.
- Requested and scheduled showings stay unconfirmed until evidence says otherwise.
- Past dated tours are outcome-unknown, not "upcoming."
- Held records get a human task without a fake engine score.
- Opt-out suppresses contact. Unknown sends are not replayed as success.
- Copy, open, and mark do only what they say.

## Weak

- Rank was score-then-hot-score. A promise, a same-day showing, and a stale nurture lead could look like the same kind of work.
- Marking a text sent did not change the next card, so the same draft stayed on top.
- Kyle-reported outcomes and integration-verified outcomes were not labeled as different facts.
- The action (text the client) and the execution (copy, open messages, paste, send yourself) were easy to blur.
- A call card told Kyle to call and did not give the phone a `tel:` link.
- Files with no concrete next step were not called out as drift.
- The sample brief from the Hot 7 test used a frozen 3:50 AM clock. Production already called `new Date()`, but the desk did not say which clock it was using.
- The brief UI printed an ISO timestamp and called it Eastern.

## Overengineered

- Two prompt homes (`policy/KYLEOS_CORE_PROMPT.md` and `backend/src/lib/aiEngine.ts`) for a desk that does not need a live model to rank today's calls.
- Summary counts that can grow into a dashboard. The useful surface is still the first few cards.

## Underdeveloped

- Promise memory, waiting states, and drift.
- Time-aware tiers (a showing in two hours is not a showing in four days).
- Outcome taps that rerank.
- A production path that is obviously empty when no canonical clients are loaded, instead of falling back to a fixture.

## Remove or do not grow

- Do not add a second CRM, queue, or morning desk.
- Do not rank on raw activity (views, clicks, hot score) above a real obligation.
- Do not treat Hot 7 as the live book.

## Wrong problem if we chase it

Building autonomous send, a client portal, or a Miami data moat before Kyle can trust the next card. The leak is not "more AI." The leak is a card that does not change after he acts.

## Impressive and low value right now

Vector search, agent swarms, a new analytics dashboard, and a prompt registry. They do not move today's showing.

## Conversion leaks to watch

Contact with no stored reply. Showing with no outcome. Outcome with no next question. Seller signal with no address, so no CMA. Promise with no due check. These are the leaks the short-sight work can see. A Friday report of rates needs denominators this database does not have yet. Do not print a conversion rate from zero clients.

## Agent-time leaks

Reconstructing whether he already texted. Hunting a phone number that is not verified. Opening a CRM to translate `tour_follow_up` into a sentence. Those are the leaks the brief is for.

## Client-experience opportunities

One honest question after a tour. A kept promise. No second copy of the same text. No invented attendance.

## Long-term moat

The moat is the history of what each person actually said, which home they reacted to, and which promises were kept. That history is not in this environment yet. Do not fake it.

## Industry research

Labels: **Evidence** is a primary or company document. **Marketing** is a vendor or commentator claim. **Inference** is what we conclude. **Recommendation** is what KyleOS should do with it.

### NAR 2025 Profile of Home Buyers and Sellers

**Evidence.** NAR's highlights and the full profile (survey of buyers who purchased between July 2024 and June 2025) report: 88% of buyers purchased through an agent or broker; 50% wanted help finding the right home; 13% wanted help negotiating terms; 43% found their agent through a friend, neighbor, or relative; 49% of first-time buyers used a referral; 18% of repeat buyers used an agent they had worked with before; 67% of first-time buyers and 76% of repeat buyers interviewed only one agent. Sources: [NAR highlights PDF](https://www.nar.realtor/sites/default/files/2025-11/2025-profile-of-home-buyers-and-sellers-highlights-11-04-2025.pdf), [Long Island Board copy of the profile](https://www.lirealtor.com/docs/default-source/default-document-library/2025-profile-of-home-buyers-and-sellers.pdf). BAM's write-up of the same report adds that 26% of buyers made first contact by phone and 91% would use or recommend their agent again ([BAM, 2025](https://nowbam.com/88-of-home-buyers-still-rely-on-agents-nar-2025-report-finds/)).

**Inference.** The relationship after the first conversation is the business. A portal lead is not the same asset as a referral.

**Recommendation.** DO NOW: rank kept promises and real conversations above passive web activity. LATER: a past-client and referral loop, only after real clients exist in the canonical file. DON'T BUILD: a lead marketplace or a buyer portal that competes with Redfin.

### Redfin Partner Program

**Evidence.** Redfin's own partner help center (updated June 2, 2025) lists four standards: accept at least 55% of referral requests, keep customer-list compliance at 80% or better, average connection time of 5 minutes or less, and close at or above the local market average. Missing them can pause or remove the profile. Customer list status is supposed to be updated at least every 7 days, and a note alone does not update the status. The suggested new-customer cadence is call, text, and email on day 1, then two methods on days 2 and 3, then a closing note if there is still no response. Sources: [Performance standards](https://partneragents.redfin.com/hc/en-us/articles/10644751126541-Overview-Partner-Program-Performance-Standards), [Partner Tools and customer list](https://partneragents.redfin.com/hc/en-us/articles/12757857664141-Module-3-Partner-Tools-Dashboard-and-Customer-List), [Key indicators](https://partneragents.redfin.com/hc/en-us/articles/26792896838925-Module-4-Key-Indicators-for-Partner-Agent-Success).

**Marketing.** Third-party blogs repeat the 5-minute rule and add traffic numbers. Those traffic numbers are not used here.

**Inference.** Kyle's official record is Agent Tools, and the penalty for a stale customer list is real. KyleOS must not write that list until a write connector exists.

**Recommendation.** DO NOW: every card still ends in an Agent Tools note Kyle pastes himself, and only after he has actually sent. DON'T BUILD: a fake Agent Tools write, a status updater, or a Rocket referral button.

### Follow Up Boss

**Evidence.** Follow Up Boss documents Action Plans (tasks, emails, stage changes, pause-on-reply) and Smart Lists (saved filters such as stage and last communication). Their help center says the most successful agents block time for hot lists daily and nurture lists monthly, and that 5–7 core lists are enough. A logged call over 2.5 minutes can pause a plan; a short call or a manual desktop log may not. Sources: [Action Plans](https://help.followupboss.com/hc/en-us/articles/1500008539982-Action-Plans-Overview), [Smart Lists](https://help.followupboss.com/hc/en-us/articles/1500008374882-Smart-Lists-Overview), [Working your lists](https://help.followupboss.com/hc/en-us/articles/360034301034-Working-Your-Smart-Lists).

**Marketing.** Review blogs claim Action Plans "so no lead falls through" and quote plan counts. That is advice, not a measured result for Kyle.

**Inference.** The useful idea is a short daily list plus a pause when a human actually connects. The bad idea is a drip that keeps firing after the client has answered, or a list so long it becomes the CRM.

**Recommendation.** DO NOW: one brief, waiting state after a marked send, drift when there is no next step. DON'T BUILD: drip campaigns, smart-list collections, or a second task inbox.

### Speed-to-lead claims

**Marketing, not evidence.** Several 2026 vendor posts (Swiftleads, Intellivizz, Pinova, AgentZap) quote 5-minute and 60-second conversion multiples, "21x," and "78% hire the first agent who responds." The pages do not link a public dataset we can check. MIT/InsideSales figures are repeated without the original table. Zillow's own partner rules, not these blogs, are the standard that binds a Redfin partner.

**Inference.** Speed matters on a brand-new shared lead. It does not outrank a client Kyle already promised, or a tour whose outcome is unknown.

**Recommendation.** DO NOW: time-aware tiers, not a speed score. DON'T BUILD: an auto-dialer or an SMS blast to win a 5-minute clock. Live send stays off.

### Compass

**Evidence / marketing mix.** Compass's February 3, 2025 press release describes Compass One as a client dashboard for search, tours, documents, and the relationship, and says the goal is repeat and referral business ([Compass newsroom](https://www.compass.com/newsroom/press-releases/6rnUy5QFL9thn6uW7bQSiG/)). Collections, announced in 2017, was a shared list of homes ([Compass, 2017](https://www.compass.com/newsroom/press-releases/4Oe2KpODpt9lUQtXlrJpe4/)). "Largest brokerage by sales volume" and "only platform" are company claims.

**Inference.** Clients will keep using Redfin to search. Kyle does not need a second portal to collaborate. He needs to remember which home and which promise.

**Recommendation.** LATER: a client-visible timeline, only if it reads the same canonical opportunity. DON'T BUILD: a Compass-style portal or a new listing collection inside KyleOS.

### SERHANT. / Ryan Serhant

**Marketing.** Interviews and secondary write-ups attribute "follow up, follow through, follow back" and "give, give, give, give, ask" to Serhant, including a story about a buyer who went quiet for years ([BAM](https://nowbam.com/ryan-serhants-follow-up-formula-that-turned-5-years-of-silence-into-a-16m-closing/), [Playmakers episode description](https://podcasts.apple.com/pe/podcast/how-serhant-is-growing-104-despite-market-headwinds/id1811011157?i=1000776780856&l=en-GB)). "Until they buy or they die" and a $16 million anecdote are stories, not a study. SERHANT.'s "Simple" platform is described by him as admin reduction. That is a product pitch.

**Inference.** Follow-through (do the thing you said) is the part that matches Kyle's voice rules. Endless "checking in" is the part those rules already ban.

**Recommendation.** DO NOW: promise memory. DON'T BUILD: a nurture drip or a media engine.

### What we refuse to copy

- Drip that continues after a reply.
- Activity scores that beat an offer, a tour, or a promise.
- Client portals that become a second system of record.
- Auto-text to hit a vendor's response-time badge.
- Any write to Agent Tools, MLS, Redfin, calendar, SMS, or email from this desk.

## First principles

If KyleOS did not exist, one elite phone-first agent in Miami-Dade and Broward would still: answer the phone, walk the house, tell the truth about a listing, negotiate, and keep his word.

Software would: show the next person, the property, what is verified, what is missing, the exact words, where to tap, and when to come back. It would notice a promise, a wait that expired, and a file with no next step. It would never mark a tour complete because a coordinator wrote a sentence, or a text sent because a button was pressed.

Compared with that ideal, KyleOS already has the record, the one-action rule, and the draft boundary. It was missing the clock label, the tier, the promise, the wait, the drift flag, the `tel:` link, and a mark that changes the next card. Those are extensions of the current brief, not a new app.

## Recommendations

### DO NOW (this change)

- A. Production clock is `new Date()` in America/New_York, labeled on the brief. Tests pass a frozen clock and must say so.
- A. Live desk reads canonical opportunities only. Hot 7 stays a fixture. An empty canonical file stays empty.
- A. Tiers T0–T3 with same-day and 48-hour tour awareness. Within a tier, a promise outranks a passive card. Past-tour cards stay first. Katherine's CMA is T2 and sorts ahead of Mark and Perry, who are T3 contact recovery.
- A. `kyle_promise` becomes an operational promise.
- A. Waiting states after a marked send, with a next check, and no duplicate draft while the wait is fresh.
- A. Workflow drift when a card has no concrete next step.
- A. Mark sent and outcome taps rerun the card immediately. The label is MARKED BY KYLE unless a verified `provider_delivery` fact exists. This build does not create that fact.
- A. Action versus execution: the headline is the action; `execution_steps` is copy, open, paste, send, or tap Call.
- A. `tel:` only for a call action with a verified phone.

### NEXT

- B. Point every future draft at `policy/KYLEOS_CORE_PROMPT.md` as the only voice policy. Do not merge the unused `backend/` prompt into the desk in this pass. The desk is still deterministic, which is the right gate while send is off.
- A. When a real canonical export exists, run this same brief on it and file the first seven cards. Do not invent that export.
- A. Store the reply text when Kyle marks "client replied," so the next question can use their words.

### LATER

- D. Past-client and referral cadence, after the canonical file has closings.
- D. Conversion-leak report with real denominators.
- D. Document checklist that points at Drive or Notion. No new document database.
- D. Local condo, insurance, and flood notes as sourced facts, never as invented advice.

### DON'T BUILD

- D. A second CRM, queue, portal, drip engine, vector store, agent swarm, or analytics dashboard.
- D. Live SMS, email, voice, calendar, Agent Tools, MLS, or Redfin writes.
- D. A prompt platform or context-packet service. One policy file is enough until a model is actually on the send path.
- D. Fake confirmation, fake phones, or a production brief filled with Hot 7.
