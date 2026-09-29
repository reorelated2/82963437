# KyleOS v5 audit

Date: 2026-09-29. Branch: `cursor/execution-desk-2fe5`. This is an audit of the existing app, then the short-sight changes that audit justified. It is not a second product.

## What KyleOS is today

One Node desk in `ops/`. Canonical clients, opportunities, and facts live in `desk.sqlite`. A separate runtime ledger holds browser tasks and is not the client record. The morning brief is a view: open buyer opportunities are loaded, `planDesk` turns facts into one card, the card is ranked, and the phone page renders it. Drafts stay drafts. `DRY_RUN` and `SYSTEM_MODE` stay on. Nothing in this path sends SMS, writes Gmail, writes Calendar, or writes Agent Tools.

The loop that already exists is the one the spec describes: signal, facts, verified state, one next action, Kyle acts outside the app, a manual mark, then the brief is built again. The gap was not a missing CRM. The gap was a few places where the card lied about the evidence, and a few short-sight rules that the card did not yet enforce.

## What it should become

A chief of staff for one field agent. Kyle opens it and sees who is first, why, what is verified, what is missing, and the exact next move. The property starts the conversation. The relationship is the asset. The transaction is one chapter.

Stage 1, which is this app, tells Kyle what to do. Later stages do more of the research and, only after a real capability exists, let an approved integration execute. Those later stages are not this change.

## Information flow

1. Ingestion writes a canonical client and an opportunity. Redfin, Gmail, Calendar, and Agent Tools are prepared as manual packets. They are not live readers in this environment.
2. Facts are stored with kind (`fact` or `inference`) and verification. An inference cannot overwrite a verified fact.
3. `planDesk` reads that evidence and returns one card: action, draft, showing lines, offer surface, transaction milestones, search plan, Agent Tools paste.
4. `buildMorningBrief` ranks the cards, records showing transitions, and enqueues approval rows that stay pending.
5. The phone page copies text and opens links. `MARK SENT MANUALLY` writes KyleOS state only.
6. The next brief reads the new fact and changes the card.

Hot 7 is a fixture loaded on purpose. It is not the production source. This environment has no `ops/data/desk.sqlite`, so there is no live canonical brief here.

## First principles

If this system did not exist, one Miami agent working from a phone would still need to do the human parts: the call, the showing, the advice, the negotiation, the judgment. Software should remove reconstruction. Before he texts, he should already see the property, the tour date, the time, the showing agent, what is unknown, and the one question that moves the person forward.

What must never fall through: a past tour with no outcome, a promise he made, an offer that is not actually ready, a client who is waiting on him, and a workflow with no next action.

KyleOS already aims at that. It does not need a new database, a new morning desk, or an agent swarm to get closer.

## Strategic research

Labels: **evidence** is a cited primary or reported finding. **claim** is company marketing. **inference** is a conclusion from those. **recommendation** is what KyleOS should do with it.

### Relationship is the distribution

**Evidence.** NAR's 2025 Profile of Home Buyers and Sellers: 88% of buyers purchased through an agent or broker. 91% of sellers used an agent. 43% of buyers found their agent through a friend, neighbor, or relative. Among repeat buyers, 41% used a referral and 18% used the agent they had worked with before. 91% of buyers said they would use or recommend their agent again. Sources: [NAR highlights PDF](https://www.nar.realtor/sites/default/files/2025-11/2025-profile-of-home-buyers-and-sellers-highlights-11-04-2025.pdf), [NAR news summary](https://www.nar.realtor/news/real-estate-news/nar-2025-profile-of-home-buyers-sellers-reveals-market-extremes), [BAM write-up of the same profile](https://nowbam.com/88-of-home-buyers-still-rely-on-agents-nar-2025-report-finds/).

**Inference.** A tool that burns trust to look fast works against the channel that actually produces the next client.

**Recommendation.** DO NOW for anything that protects a promise, a past showing, or a truthful draft. LATER for review-request automation. DON'T BUILD a referral drip.

### Speed to the right person, not speed to a blast

**Claim.** Follow Up Boss markets itself as the system 36 of the 50 highest-volume teams use, with 250+ lead sources and automated texts, emails, and calls. Source: [followupboss.com](https://www.followupboss.com/).

**Claim, secondary.** A 2026 vendor comparison says Follow Up Boss platform data shows a 90-second median response with native portal integrations versus 4–6 minutes through middleware. That figure is the vendor's, repeated by a third-party blog. It is not independently audited here. Source: [GoHighLevel vs Follow Up Boss, 2026](https://ustechautomations.com/resources/blog/gohighlevel-vs-follow-up-boss-real-estate-2026).

**Inference.** What those teams actually buy is one queue, source history that does not get overwritten, and a next action an agent will really do from a phone. The automated drip is the part KyleOS should refuse. A six-word client message should not get a campaign.

**Recommendation.** Keep one queue and one next action. DON'T BUILD action-plan drips, ponds, or round-robin. Kyle is one agent, not a 20-person desk.

### Redfin is the system of record for the job, and the associate is not Kyle

**Evidence and claim, separated.** Redfin's own 2025 pay note says the top 10% of Redfin agents make Redfin.com a core source, and that Redfin staff handle qualifying, tour scheduling, and transaction coordination. Source: [Redfin agent pay report](https://www.redfin.com/news/agent-pay-report-2025/). Associate agents are a different job: independent contractors paid per tour or open house, not the lead agent who owns the client. Source: [Redfin associate listing, Built In](https://builtin.com/job/real-estate-associate-agent-1099-winston-salem/11227859). Secondary commentary on splits (ListWithClever, 2026) is not Redfin's own page and is not used here as a pay rule.

**Inference.** Agent Tools is the record another Redfin agent will read. A coordinator email or an associate on a tour is not "Kyle already talked to them." A scheduled tour is not a completed tour.

**Recommendation.** DO NOW: past scheduled means outcome unknown, and the card says so. The Agent Tools paste stays a note Kyle pastes himself. DON'T BUILD a write-back until a verified Agent Tools capability exists. None does in this environment.

### What not to copy

Zillow Premier Agent and Compass marketing both sell distribution and team leverage. That solves a brokerage's lead-volume problem. Kyle's problem is reconstruction and dropped threads for people he already has. Copying a portal CRM, a transaction factory, or a content calendar does not move today's showing.

## Classification of this change

| Change | Class | Why |
| --- | --- | --- |
| Two dates are two tours. Same-day unmatched lines stay side by side. | A extension | The fact rows already exist. The card was labeling them wrong. |
| DATA CONFLICT only when times or named agents on one date disagree. | A extension | Same evidence model. |
| Promise fact can outrank the card. | A extension | `client_facts` already stores it. No new table. |
| MARK SENT writes a suppression fact, then the next brief waits and reranks. | A extension | Reuses facts, marks, and `planDesk`. |
| Tier 0–3 label and "showing today" uses the Eastern clock. | A extension | Ranking already existed. The label and the today rule did not. |
| `SHOWING_SCHEDULED` added to the state list. | A extension | Stored transitions gain one legal value. Old rows are untouched. Past tours still become `OUTCOME_UNKNOWN`, not scheduled. |
| One clock module in `ops/src/time.ts`. | B refactor | `easternClock` had been copied into the planner. The behavior is the same clock. |
| Versioned prompt module list. | A extension | The voice screen already enforced the rules. The version is now explicit. |
| Workflow drift line when an action is empty or is only "follow up with". | A extension | Surfaces a hole. Does not add a workflow engine. |
| Live Gmail, Calendar, Agent Tools, MLS, or SMS execution. | D future | No verified capability. Human action mode stays. |
| A second CRM, vector store, or autonomous loop. | Don't build | The current client, opportunity, and fact model holds this. |

No class C migration. Nothing here replaces the canonical model.

## DO NOW (done in this change)

- Echo's 9/20 Agent Tools line and the 9/20 4 PM Gmail line stay side by side as a possible duplicate. They are not merged, and they are not a conflict. 9/27 is a second tour. Each outcome stays not confirmed.
- A real contradiction, two different times or two named agents on the same date, is `DATA CONFLICT`, shown once, with both lines kept.
- A past showing is not labeled upcoming.
- A verified or reported `kyle_promise` fact raises the card to tier 0 and puts the promise in the action.
- `MARK SENT MANUALLY` records the mark, stores `execution_suppression`, and the next brief drops the draft, sets `WAITING_ON_CLIENT`, names the next trigger, and reranks. It does not claim delivery.
- Tiers 0 through 3 are on the card. A showing whose date is today in `America/New_York` is tier 0. A past unknown outcome is tier 0. Financing, CMA, sale dependency, and a missing listing-agent contact are tier 1.
- Showings today in the header use that same clock, not "every future hold."
- Prompt modules are versioned at `2026-09-29.1`. The voice screen rejects "the seller pays my commission."
- The eval scenario list is in `ops/src/execution/eval.ts`. The assertions stay in the test file.

## NEXT

- Read a real Gmail or Agent Tools export into the same facts, still manually confirmed, so the live brief is not empty outside this environment.
- When a listing-agent phone is actually on file, show it. Do not invent one.
- Capture the small outcome list (replied, no reply, attended, did not attend) as another mark that the planner already knows how to read.
- Showing state `SHOWING_SCHEDULED` is legal to store. Use it only when access is actually confirmed, not as a rename of `ACCESS_PENDING`.

## LATER

- Document intelligence over Drive or the existing files. KyleOS should point at the source, not become a second file cabinet.
- Friday report numerators are already honest about missing denominators. A management view can grow once live data exists.
- Post-close dates, home anniversary, and a review ask at a moment Kyle chooses.
- Local condo, insurance, and flood notes only when they change advice on a specific property.

## DON'T BUILD

- A second morning desk, a second client table, or a parallel Hot 7 app.
- Automated SMS, email, or Agent Tools writes.
- Lead-score theater ("87% likely to close").
- Action-plan drips, "just checking in," or a referral campaign.
- Vector databases, agent swarms, or a new framework.
- Inferring budget from a list price, motivation from a click, attendance from a calendar hold, or a send from a draft.

## Economic test

The Echo fix protects a real conversation: two tours, neither confirmed, and a false conflict was telling Kyle the file was broken. Promise memory and mark-sent suppression stop him from texting the same person twice and from dropping something he already said he would do. That is today's trust and today's showing. A new CRM would not do that faster.
