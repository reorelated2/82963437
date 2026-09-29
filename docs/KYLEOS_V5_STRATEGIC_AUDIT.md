# KyleOS v5 strategic audit

Date: 2026-09-29. Operator: Kyle Kleinman, Redfin Lead Agent, Miami-Dade and Broward. This document challenges the product, then says what was changed in the existing desk. It does not authorize a new app.

Labels used below:

- **Verified.** A primary page or a filing-style source says it.
- **Marketing claim.** The company or a vendor said it. Not independently measured here.
- **Inference.** A conclusion from those sources plus the shape of this desk.
- **Recommendation.** What KyleOS should do with that conclusion.

## Research

### NAR compensation, after the 2024 settlement

**Verified.** NAR's own pages say the practice changes took effect August 17, 2024. An MLS participant working with a buyer must have a written agreement before touring a home, including a live virtual tour. The agreement must disclose compensation in a specific, objectively ascertainable way (not "whatever the seller is offering"), must bar the participant from receiving more than that amount from any source, and must say commissions are negotiable and not set by law. Offers of compensation are no longer communicated on the MLS. Sellers may still choose to offer compensation off-MLS, and a buyer may ask for it in an offer. NAR also tells members that, under the FHA rules they cite, agent compensation cannot be financed in the mortgage. Sources: [What the settlement means](https://www.nar.realtor/the-facts/what-the-nar-settlement-means-for-home-buyers-and-sellers), [Written buyer agreements](https://www.nar.realtor/the-facts/written-buyer-agreements-101), [Dos and don'ts](https://www.nar.realtor/the-facts/nar-member-resource-dos-and-donts-when-working-with-buyers).

**Marketing / secondary.** A 2026 Houston association note and the Texas TREC January 2026 buyer-rep changes describe state overlays. Those are not Florida rules. This audit did not read a Florida statute.

**Inference.** Kyle cannot say "the seller pays my commission." The desk must keep buyer-agreement compensation, listing-side compensation, seller credit, and buyer responsibility as separate unknowns until a document says otherwise.

**Recommendation.** Keep the existing compensation facts. Do not add a commission calculator. Do not draft agreement language.

### Zillow Premier Agent and Zillow Preferred

**Verified (secondary reporting, not a Zillow contract).** The Close describes Zillow Preferred, formerly Flex, as an invite-only success-fee model with no per-lead price, performance routing, and required Follow Up Boss use. Premier Agent is described as upfront advertising. Source: [The Close, 2026](https://theclose.com/zillow-preferred/).

**Marketing claim.** Agent blogs say Premier Agent conversion is often 1–3 percent, that leads are shared, and that higher-intent connections go to the success-fee program first. Those figures are not Zillow's published conversion table. Sources: [Jeff Lenney](https://jefflenney.com/real-estate/is-zillow-premier-agent-worth-it/), [RealAnalytica](https://www.realanalytica.com/alternatives/zillow-premier-agent).

**Inference.** Portal economics reward speed-to-contact, appointments set, and appointments held. They do not reward a better conversation. Kyle's Redfin desk is assigned-lead work, not a shared Zillow zip. Copying a portal score would train the wrong behavior.

**Recommendation.** Measure time to a real human contact and whether a showing outcome was verified. Do not show a close probability.

### Follow Up Boss

**Marketing claim.** Review sites say Follow Up Boss routes a new lead in under five minutes and repeat a "100x more likely" line. The 100x figure is a distorted retelling of the old Lead Response Management study, which reported a large gap between a 5-minute response and a 30-minute response for qualification, not a 2026 measured conversion rate. Sources: [aimadefor review](https://www.aimadefor.com/blog/follow-up-boss-review-realtors/), [Follow Up Ace on action plans](https://followupace.com/blog/how-automated-follow-up-sequences-work-in-follow-up-boss).

**Verified product shape, from those same descriptions.** The useful object is an action plan that mixes a task a human must do with a message, and that pauses when the person replies. One inbox. Source is stored. Speed matters because the lead is still in the listing.

**Inference.** KyleOS already has one next action, a due time, and a draft that cannot send. The hole was a sent text that did not change the queue, and a file with no next action at all.

**Recommendation.** Waiting states, workflow drift, and mark-sent rerank are the FUB lesson without the FUB product. Do not buy or embed Follow Up Boss in this repo.

### Compass

**Marketing claim.** Compass press and HousingWire in July 2026 describe Home Platform rolling across company-owned brands after the Anywhere merger, with franchise access planned for 2027, and an AI assistant connected to many internal tools. The stated advantage is proprietary listing and client data, not a public model. Sources: [Compass press release](https://www.compass.com/newsroom/press-releases/5EGg4IQFY5eadk50jpVZaT/), [HousingWire](https://www.housingwire.com/articles/compass-home-platform-rollout/), [Fortune, 2026-09-23](https://fortune.com/2026/09/23/compass-ai-assistant-real-estate-agents/).

**Inference.** A one-agent desk does not get that data moat. The part worth copying is one record the agent actually opens on the phone. The part to refuse is a swarm of tools the agent must prompt.

**Recommendation.** Keep one Morning Desk. Do not add an assistant router.

### Redfin and Rocket

**Verified shape, secondary.** HousingWire reported that after Rocket closed the Redfin acquisition it pointed Rocket Homes search at Redfin and talked about joining the Rocket Homes partner network with Redfin's agents. Rocket's own comments in that piece treat Redfin as the top-of-funnel search and Rocket as the mortgage path. Source: [HousingWire](https://www.housingwire.com/articles/rocket-revamps-real-estate-arm-moves-home-search-to-redfin/).

**Inference.** Kyle already sits on the Redfin lead path. Financing is a handoff, not a product to build. Associate showing notes are not Kyle's conversation. That rule was already in the desk and it is the right Redfin-specific rule.

**Recommendation.** Leave Agent Tools as the system of record. Keep lender intros as drafts. Do not build a mortgage application.

### SERHANT

**Marketing claim.** HousingWire's company profile and a 2026 upgrade note say S.MPLE is an internal agent operating system, that S.MPLE 2.0 coordinates specialist agents, and that the company claims 54,000 requests, 2,000 agents, and about 28,000 hours returned. The upgrade article says it was generated with AI and reviewed by an editor. Ryan Serhant's public line is that a human in the loop is the point of a high-stakes transaction, not a failure. Sources: [HousingWire profile](https://www.housingwire.com/company-profile/serhant/), [S.MPLE 2.0](https://www.housingwire.com/articles/serhant-dot-smple-2/).

**Inference.** The hours-saved number is not a method. The useful sentence is that the agent still owns the conversation.

**Recommendation.** Do not build a specialist-agent network. The execution adapter stays "Kyle copies and sends."

### Side

**Marketing claim.** Side describes itself as the back office and transaction platform behind agent-owned brands, not a CRM. The public pages cite same-day payments, compliance review, and hours saved per transaction. Sources: [Side platform](https://www.side.com/platform/), [Side OS](https://www.side.com/os/).

**Inference.** Transaction coordination is a later horizon. It is not today's leak. Today's leak is an unverified showing and a missing cell.

**Recommendation.** Do not build a transaction OS in this pass. Keep the milestone list read-only and labeled HUMAN REVIEW REQUIRED when the date is not on a document.

### RealTrends, Altman, Askowitz, Carruth

**Verified ranking, not a method.** HousingWire's write-up of the 2026 RealTrends Verified rankings (2025 production) puts The Altman Brothers Team, Douglas Elliman, California, first among mega teams by volume. Their RealTrends profile shows 220 sides and $1.26B. A Miami enterprise team, The Carroll Group at Compass, is cited at $1.102B. Sources: [HousingWire](https://www.housingwire.com/articles/realtrends-verified-2026-rankings/), [Altman Brothers profile](https://www.realtrends.com/team-profile/the-altman-brothers-team-california-douglas-elliman/).

**Not found.** A search of those 2026 mega-team lists did not place Anthony Askowitz or Ricky Carruth in the national top five. This audit will not invent a rank for either of them.

**Marketing / coaching.** A REDX interview and blog present Ricky Carruth's method as a weekly relationship email and a database of owners, after an earlier stretch of chasing transactions. That is a vendor interview, not an audited production study. Sources: [REDX blog](https://www.redx.com/blog/how-to-build-a-million-dollar-business-through-email-featuring-ricky-carruth/), [REDX podcast](https://www.redx.com/podcast/ricky-carruth/).

**Inference.** Volume rankings describe teams with staff, not a solo Redfin lead agent's Tuesday. The transferable idea is that the database and the kept promise compound, and the transaction is one chapter.

**Recommendation.** Promise memory and a waiting state are the small version of that idea. A brand studio, a video engine, and a referral CRM are later.

## First principles

The ideal system for one phone-first agent in Miami-Dade and Broward:

Kyle still does the human part. He calls when the situation is messy. He walks the door or owns the outcome of a tour he did not attend. He decides offer terms, pricing, and whether a buyer agreement is in place. He tells the truth when he does not know a fee, a flood rule, or a rental restriction.

Software should remove the blank page. It should remember the promise, the last reply, the showing that passed with no outcome, the missing cell, and the fact that an associate's note is not Kyle's note. It should prepare one sentence he can send and the place to paste it. It should refuse to send.

Judgment stays human wherever the cost of being wrong is a relationship, a contract, or a fair-housing problem.

Compared with that, KyleOS already had the right bones: one desk, canonical clients, facts split from inferences, a dry-run gate, and a morning view. It was weak where a past tour still looked like upcoming work, where marking a text sent did not change the queue, and where the screen Kyle opens was the Hot 7 fixture rather than the file in front of him.

## What KyleOS thinks it is

A local dry-run command desk. It turns a lead signal into one next human action and a draft. Redfin Agent Tools stays the official client record. The morning brief is a view.

## What it should become

The same desk, trusted in the hour before a showing and the hour after. Production data in, Eastern clock, one card that says the action in English, a mark that changes the queue, and a bright line between "Kyle says he sent it" and "a provider confirmed it."

## Strong

- Identity matches on phone or email, not on a similar name.
- Verified facts block inferences.
- Requested, scheduled, and completed were already different ideas. This pass makes a past scheduled tour impossible to label upcoming.
- DRY_RUN, consent, and the approval queue already refuse a live send. That refusal was not weakened.
- Hot 7 remains a regression result of the same ranker, not a second morning product.

## Weak

- No mailbox read, so "read the reply" is a mark Kyle makes, not a message the desk has seen.
- No calendar read, so a conflict exists only when a fact says so.
- Listing-agent phone, cell, and property status are often missing. The card can only say where to look.
- Two SQLite files still exist (desk and buyer ledger). They were not merged. Merging them is a migration, not a morning fix.
- Spanish exists only when a verified `language = es` fact is already stored. The live file does not carry that fact reliably.

## Overengineered

- The consult app in `backend/` and `mobile/`, the unused Supabase migration, and `mail.php` are not the lead desk.
- The buyer-ledger runtime can simulate a send. It is not the morning path. Leaving it in place is safer than rewriting it this round.
- Numeric hot scores and a second priority index on the card. Tier is now visible. The old score still sorts, because changing the sort would reshuffle the Hot 7 fixture for no client benefit.

## Underdeveloped

- Outcome capture after the first text. Added in this pass as marks, not as an integration.
- Promise tracking. Added as a table the ranker reads.
- A production import for the lead-master file Kyle already has. Added as a local reader. The file itself stays out of git.

## Remove, later, not in this diff

- Do not delete `backend/` or the ledger in this branch. They are unused by the morning path. Deleting them is a migration with a rollback, and nothing in today's brief depends on it.

## Duplicated

- Desk `opportunities` and ledger `opportunities`. Same word, different files. The morning desk uses the desk file only.
- `showingState` codes and the new human `showingLabel`. The code stays for tests and storage. The screen shows the label.

## Wrong problem

Building another CRM, another approval queue, or an agent swarm. The problem is the next true step on the people already in the file.

## Impressive and low value

A close-probability badge, a vector store of past emails, a Friday dashboard with no denominators. The Friday report already exists and already says where the denominator is missing. It was left as a count of stored rows.

## Conversion leaks

1. Lead with no verified cell, so the first human contact cannot happen.
2. Showing time passed, outcome never asked.
3. Text marked sent in Kyle's head and still sitting at the top of the list.
4. Financing still unknown while a tour is being discussed.
5. Home to sell treated as a tag instead of a seller task with an address.
6. Offer request talked about as if it were submitted.

## Agent-time leaks

Rewriting the same text, opening Agent Tools to paste a note that was never drafted, and scanning a fixture list that is not today's file.

## Client-experience opportunities

Ask whether they got inside before asking why they are moving. Do not send a second text while the first one is unanswered. Do the thing Kyle already promised before chasing a colder lead.

## Long-term moat

A true record of Miami-Dade and Broward clients: what they said, what was verified, what Kyle promised, and what happened after the tour. Not a model. The record. Condo, flood, insurance, and rental-rule advice matters only when it is sourced and only when it changes the next sentence. That is later.

## DO NOW (this branch)

- One production clock versus an injected test clock.
- Production brief from canonical rows. Hot 7 is a fixture and will not load on top of non-demo clients.
- Showing label: past scheduled is POST TOUR VERIFICATION NEEDED, never upcoming.
- Waiting states, promises, and workflow drift.
- Tier 0–3 on the card, plus a two-hour urgency bump when a verified due instant exists.
- Human action, adapter line, and the existing bottom summary.
- MARK SENT / MARK CALLED / outcome marks that write `marked_by_kyle`, change state, and rerank. No `verified_by_integration` row exists.
- Voice lint kept. Prompt modules versioned. No model call.
- Evaluation harness and the forbidden-pair tests.
- Phone layout: 44px targets, COPY, OPEN, `tel:` CALL, no sideways scroll.
- Local lead-master import from a gitignored path.

## NEXT

- One read-only Gmail path that distinguishes received, sent, drafted, and automated, still with no send.
- Calendar read for conflicts. No event creation.
- Verified Agent Tools URLs when Kyle pastes one. Still no write.
- Spanish drafts when the language fact is verified.

## LATER

- Document checklist for contracts, inspections, and association packets, with Drive or the existing file as the source.
- Post-close dates that are real (keys, anniversary), not a drip.
- Listing prep and a sourced local note on insurance, flood, or rental rules.
- A Friday management view once the denominators are real.

## DON'T BUILD

- A second CRM, client model, opportunity model, approval queue, execution engine, or Morning Desk.
- Vector databases, agent swarms, a new framework, or a close-probability score.
- Live SMS, email, voice, calendar writes, Agent Tools writes, MLS writes, or Redfin writes.
- Fake "sent" receipts.
- Commission math or legal deadline math from an assumption.
- Demographic inference around schools, safety, or "good area."

## Architectural change classes

**A. Extension.** Waiting, promises, execution marks, tier and adapter fields, prompt registry, lead-master reader, `redfin_customer_id` as an identifier that flags a collision instead of merging.

**B. Refactor.** Clock source is explicit. Showing codes gained a human label. Future scheduled tours use `SHOWING_SCHEDULED` instead of being called access-pending. The rank sort is the same score.

**C. Migration.** None in this branch. The ledger file and the consult app stay where they are. A later migration would need the problem (two opportunity tables), the evidence, the target file, a copy plan, a compatibility window, a risk note, tests, and a rollback. That bar is not met by a morning-brief change.

**D. Future idea.** Gmail read, calendar read, sourced local intel, post-close, bounded autonomy. Not built.

## Tests the strategy has to pass

- Economic: a card that does not name a real next step is a failed card, even if the screen looks full.
- Client: the sentence does not pretend, rush, or re-ask a known answer.
- Agent: Kyle can copy, call, mark, and see the list change without leaving the phone width.
