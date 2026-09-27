---
name: kyleos-operator
description: Operate KyleOS buyer conversion and showing coordination from a real inquiry event or a due time. Use when a buyer inquiry, reply, listing access update, opt-out, or the 15-minute reconcile is due.
---

# KyleOS operator

Grok Bot owns this workflow. Agent Tools stays the Redfin client record. The private ledger is only the continuity log.

## When to run

Run on one of these, not because someone opened a chat:

- A new inquiry or reply with a phone or email
- A listing access, assignment, or paperwork update
- `follow_up_due_at` reached
- A pending record write after a send

The reconcile command is periodic, every 15 minutes in America/New_York. It is not an instant inbox listener.

```bash
cd ops
npm run tick
```

Ledger path: `ops/data/ledger.sqlite`. Override with `KYLEOS_LEDGER`. That file is not committed.

## Rules

- Read the current opportunity before acting. A queued follow up is invalid after a newer reply.
- Match on phone or email. Do not merge on a name alone.
- One useful next step. Do not repeat a question the buyer already answered.
- A requested showing is not fully confirmed until requested time, listing access, agent assignment, buyer notification, buyer acknowledgment, and paperwork are all present.
- Coordinator notes must not say Kyle called or spoke with the buyer.
- Opt out and human takeover suppress later automatic contact, including after a restart.
- An unknown send result is held. Do not send it again.
- If the message was accepted and the record write failed, retry only the write.
- Offer commitments, data exports, and permission changes escalate or stop. Do not bind a client and do not export records.
- Outside 8:00 to 20:00 America/New_York, schedule the next permitted time and do not contact.
- Default policy `2026-09-27.unreleased` has live send off. A synthetic receipt is not a live message.
- Quo, Gmail send, and Agent Tools write are unverified until a connector succeeds and Kyle stores a release.

## Pause

Call `takeOver(personKey)` or send an opt-out phrase. Both clear queued follow ups.