# Test results

Date: 2026-09-24. Command:

```bash
cd ops
npx tsc --noEmit
node --experimental-strip-types --experimental-sqlite --test --test-timeout=30000 test/lead-workflow.test.ts
```

Result: typecheck passed. 25 tests passed, 0 failed.

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
| Sample workspace | Passed. Each attention group has a DEMO row. Today's sample appointment is labeled not confirmed. Pat Nguyen has no next action. Recent replies say the connector is blocked. MLS and ShowingTime are listed under system health. |
| Ambiguous extract | Passed. An unclear name plus two phones creates no contact and no draft. |
| Wrong-match risk | Passed. Nate Alvarez and Nathan Alvarez with different phones stay two contacts. A same name without a matching phone or email is not merged. |
| Duplicate inquiry | Passed. The same paste does not add a second contact, draft, or task. |
| Missing financing | Passed. A mention of financing stays data needed. A stated pre-approval is Said, not Confirmed. |
| Showing requested is not confirmed | Passed. The draft does not say the showing is confirmed. The next action says the time is not confirmed. |
| Reply mid-sequence | Passed. A later message on the same phone does not restart with Hey. The next action is to answer the latest message. |
| Opt out | Passed. The draft is blocked, send stays empty, and the audit log records the block. |
| Eastern time after the fall clock change | Passed. Friday 2026-11-06 6:00 PM EST follows up Monday 2026-11-09 9:00 AM EST. |

## Not tested with real clients

No real Redfin export, Gmail import, or MLS feed was used. Sample people are labeled DEMO. Do not treat the automated screenshot as proof that every phone photo will read cleanly. A blurry image should land in the unclear review instead of becoming a contact.

## Browser

Checked in Chrome on 2026-09-24 against `http://127.0.0.1:8787` after signing in with the local password.

Passed: rejected wrong password, KyleOS Command board, Load sample day with DEMO labels, Pat Nguyen under No next action, connector-blocked replies, ShowingTime Act explaining the block without sending, Nate Alvarez Act opening SEND / NOTE / NEXT, financing labeled Said, requested 5:30 left unconfirmed, Try to send blocked with "Nothing was sent.", Save note and follow up landing on Nate with the unsent note, Pat Nguyen Act opening that client, search by phone, a pasted Riley Chen Hollywood inquiry, and a 390px-wide layout with the nav at the bottom.

Board screenshot with synthetic data: `docs/screenshots/command-board.png`. Phone-width board: `docs/screenshots/command-board-mobile.png`.
