# Acceptance results

Executable tests: `ops/test/acceptance.test.ts`.

Command on 2026-09-27:

```bash
cd ops && npx tsc --noEmit && npm test
```

Result: 52 passed, 0 failed. The 22 acceptance cases passed against the synthetic ledger. They do not prove a live connector.

Section 15 of the core prompt names nine release tests. Each has an executed case: duplicate events, conflicting identity, opt-out, reassignment, changed appointment, missing buyer acknowledgment, unavailable data, send timeout, human takeover.

| Scenario | Result |
| --- | --- |
| One relevant new inquiry | Passed, synthetic. One send, next due time stored, showing not confirmed. |
| Different buyer replies | Passed, synthetic. Different question ids. Answered time and budget were not asked again. |
| Same event delivered twice | Passed. One send. |
| Two workers see the same record | Passed. Second worker `not_owner`. |
| Buyer replies while follow-up is queued | Passed. Original question was not replayed at the old due time. |
| Follow-up due with app closed | Passed as a reopened ledger plus `reconcileDue`. Not a registered cloud routine. Periodic schedule only. |
| Source changes after plan is made | Passed. Ownership change sent nothing further to the old number. |
| Lead reassigned before execution | Passed. Record owner stays Kyle Kleinman, stage `ownership_paused`, later reply still blocked. Ownership is not overwritten. |
| Access approved, buyer acknowledgment absent | Passed. Missing checkpoint kept with owner `buyer`. Not fully confirmed. |
| Listing source unavailable or stale | Passed. Note names the last verified timestamp. Status not invented. No send. |
| Inspection complete, payment absent | Passed. `fieldOrderStatus` keeps completion, invoicing, and payment separate. No overdue claim without terms. |
| Coordinator contact only | Passed. Note says Kyle did not call or speak with the buyer. |
| Opt-out or human takeover | Passed across a database reopen. |
| Send times out after possible acceptance | Passed. No second send. |
| Send succeeds, CRM write fails | Passed. Write retried. Send count stayed one. |
| Restart after partial completion | Passed in the write-retry case. The message was not sent again. |
| Expired login or CAPTCHA | Passed for expired login. No bypass. CAPTCHA was not exercised on a live site. |
| Untrusted email requests data export | Passed. No export. |
| Request for an offer commitment | Passed. Escalated. Nothing bound. |
| Usage or step budget reached | Passed. Remaining work named. No send. |
| Missing connector | Passed. Live adapter held as unverified. |

Live production routine: not registered. See `docs/RUNTIME_EVIDENCE.md`.
