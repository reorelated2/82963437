# Test results

Date: 2026-09-24. Command:

```bash
cd ops
npx tsc --noEmit
node --experimental-strip-types --experimental-sqlite --test --test-timeout=30000 test/lead-workflow.test.ts
```

Result: typecheck passed. 19 tests passed, 0 failed.

| Check | Result |
| --- | --- |
| Missing budget and financing stay unknown | Passed. A mention of financing does not become an approval. |
| Unclear screenshot text | Passed. Low confidence creates a review and no contact. |
| Clean screenshot | Passed with local Tesseract. Name read as Nate Alvarez. Confirmed showing stayed data needed. |
| Duplicate paste | Passed. Same text and same idempotency key do not add a contact, draft, or second task. |
| Conflicting budget | Passed. `$650K` stays. `$700K` is stored as a conflict. |
| Uncertain same name | Passed. No second contact and no merge. |
| Requested showing | Passed. `5:30` and `5:30 pm` stay requested. Availability stays separate. Only an explicit confirmation is stored as confirmed. |
| Draft mode | Passed. Pause on, and pause off without an authorization, both send nothing. `sent_messages` stays empty. |
| Failed connection | Passed. The Redfin check creates a visible failed job. |
| Restart | Passed. Approved note and follow up are still there after the file is reopened. HTTP server restart too. |
| Right client | Passed. Nate's note contains Nate Alvarez and does not contain Ada Lopez. |
| Voice | Passed. The North Miami example draft matches the approved sentence, has one question, and has no dash. A continuation does not start with Hey. |
| `$650K` | Passed. |
| Follow up calendar | Passed. Thursday 11:00 AM ET follows up Friday 9:00 AM ET. Friday evening follows up Monday 9:00 AM ET. |
| Backup restore | Passed. |
| Sample workspace | Passed. Each attention group has a DEMO row. Today's sample appointment is labeled not confirmed. |

## Not tested with real clients

No real Redfin export, Gmail import, or MLS feed was used. Sample people are labeled DEMO. Do not treat the automated screenshot as proof that every phone photo will read cleanly. A blurry image should land in the unclear review instead of becoming a contact.

## Browser

Checked in Chrome on 2026-09-24 against `http://127.0.0.1:8787`.

Passed: the Redfin system-of-record banner, a sample day with DEMO labels, a pasted Riley Chen lead, the exact draft sentence for that record, Data needed on the CRM note, a requested 5:30 that stayed unconfirmed, Try to send blocked with "Nothing was sent.", the note visible on the client, search by phone, and a 390px-wide layout with the nav at the bottom.

Screenshots from that pass: today, review, client, and the phone-width today screen.
