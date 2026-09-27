# Runtime evidence

Date: 2026-09-27. Command:

```bash
cd ops
npx tsc --noEmit
npm test
```

Typecheck passed. `npm test` reported 50 passed, 0 failed. Twenty of those are the buyer-conversion acceptance cases in `ops/test/acceptance.test.ts`. The supplied core prompt is stored at `policy/KYLEOS_CORE_PROMPT.md`.

## What the acceptance run actually did

Synthetic channel only. Every send receipt in that run has `live: false` and `mode: synthetic`. None of those messages went to a phone, email account, or Agent Tools.

Passed on the synthetic ledger:

- New inquiry chooses one showing question, records a next due time, and does not mark the showing confirmed.
- A later reply chooses a different question and does not repeat the answered time or budget.
- The same event key sends once.
- A second worker does not send the same action.
- A reply supersedes the queued follow up. The original due time does not replay that first question.
- Closing the database and reopening it, then calling `reconcileDue` at the stored due time, sends the nudge with no new prompt. The routine row stays `platform_routine_id` null, schedule `*/15 * * * *`, timezone America/New_York.
- An ownership change does not send another message to the old number.
- Listing access without buyer acknowledgment stays not fully confirmed.
- A coordinator event writes a note that Kyle did not call or speak with the buyer, and sends nothing.
- Opt out and human takeover still block contact after the file is reopened.
- An ambiguous send is not repeated.
- A failed record write is retried without a second send.
- Expired login stops with no invented success.
- An export instruction in the message does not export.
- An offer request escalates and does not bind.
- A two-step budget stops before send and names the remaining work.
- A live opportunity on the unverified adapter is held and is not called production.
- A 10:00 PM Eastern inquiry waits for the next permitted time.

## Live status

Not live.

- Release policy in force for the tick command: `2026-09-27.unreleased`. `liveSend` is false.
- Platform routine id: none. `npm run tick` exists. No Grok Bot routine and no Cursor automation is registered.
- Quo: not authenticated.
- Gmail send: not released.
- Agent Tools write: not connected.
- Last tick evidence: no production run. The due-follow-up test above is the resume demonstration, and it is synthetic.

## Pause

`takeOver` and opt-out language set a durable stop on that person and clear queued follow ups. The stop is still there after the ledger file is reopened.
