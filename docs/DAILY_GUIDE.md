# Daily guide

## KyleOS Command

Open `http://127.0.0.1:8787` after the setup window is running. Sign in with the local password. The default is `local-kyle`.

### Read the top of Today

The large line is the first person or alert that needs you. The sentence under it says why, and the next step. Work that item before browsing the rest.

The sections under it are new leads, replies, today's appointments, overdue follow ups, milestones, drafts, failed automations, contacts with no next action, recent replies, and system health. An empty section says nothing is waiting. That is a real empty state, not a hidden list.

**Recent replies** stays on "Connector blocked" until an inbound feed exists. Paste a reply on **New lead** when one arrives. **System health** names each disconnected integration. Act on those rows explains the block and does not send anything.

Each person row has a reason, a recommended next step, and **Act**. Act on a new inquiry opens the draft. Act on a follow up opens that client.

DEMO means the row is a sample. Do not text a DEMO contact.

### Add a lead

1. Tap **New lead**.
2. Paste the lead or the text thread.
3. Tap **Run the inquiry agent**.

Or choose a screenshot and tap **Read screenshot**.

Expected result: you land on a review. The banner says nothing was sent. Missing items say Data needed. A requested time is not described as booked.

### Review it

The review has three blocks:

1. **SEND** is the exact draft. Read it. It is not sent from this page.
2. **NOTE** is the CRM note to paste into Redfin yourself. Missing facts say Data needed. A requested showing stays unconfirmed unless the source explicitly says it is confirmed.
3. **NEXT** is the one next action and the follow-up time. That time is saved on the contact.

Facts are labeled Said, Confirmed, Inferred, Missing, or Stale. "Pre-approved" from a paste is Said, not Confirmed.

1. If a conflict is listed, the old value was kept.
2. Tap **Copy message**, then paste it into your own texting app if you still want to send it.
3. Tap **Save note and follow up** when the note is right.

Expected result: the client page shows the note and one follow up. The message remains a draft.

**Try to send** is there to prove the block. It should answer that nothing was sent. Turning outbound pause off still does not send.

### Put the note in Redfin

1. Open Redfin Partner Tools in your browser.
2. Open that customer.
3. Paste the CRM note into the note field Redfin gives you.
4. Save it there.

This desk does not do that step for you.

### Search

Tap **Search** and type a name, phone, email, or property. Open the client to see history, what is known, and the next action.

### Pause

**Outbound pause is on** is the normal setting. Leave it on. Turning it off still does not send, because no send workflow has been authorized.

### Failed Redfin connection

**Check Redfin connection** adds an alert that sync is not available. Acknowledge it after you have read it. Use paste and copy until a real connection exists.

## Consult app (port 8080)

This section is the Buyer Command Center and the unmounted `backend/src/os` experiment. It is not the KyleOS board. See `docs/HANDOFF_BOUNDARY.md`. Leave `ENABLE_LEAD_DESK` unset. Do not use port 8080 for SEND / NOTE / NEXT.

Open `http://127.0.0.1:8080` after `npm run dev` in `backend/`. See `docs/SETUP.md` if the page does not load. The consult app's home response is a JSON product description, not the inquiry board.

If the experiment is mounted on purpose, its daily screen works like this:

The top card is the next person or problem: who, why, and what to do. Under it are the lists. A gold DEMO tag means the person is fake. Outbound automations start paused. Approving a draft does not send it.

1. Tap **New lead**.
2. Paste the lead or the text thread into the box.
3. If you have a screenshot, choose the image. If the image might be blurry, paste the text as well.
4. Tap **Prepare follow up**.
5. Expected result: the client page opens with three blocks. **SEND** is the text to copy. **NOTE** is the note to paste into Redfin. **NEXT** is the one follow up. Known facts and "Data needed" are listed under those.

If the screenshot cannot be read, you get a warning and no client text. Paste the words and try again.

### Send it yourself

1. Read the draft.
2. Tap **Copy text**.
3. Paste it into your normal texting app and send it there.
4. Come back and tap **I will send this myself**.
5. Expected result: a message that nothing was sent by the desk. The draft is marked approved so you know you handled it.

### Copy the note into Redfin

1. On the client page, tap **Copy note**.
2. Paste it into the client's note in Redfin.
3. Expected result: Redfin has the note. This desk does not change Redfin for you.

### Follow up

The reminder time is for you. It is not an automatic text. When you have done it, tap **Mark done** on that follow up. If that was the only open step, Today lists the person under **No next action**.

The stage buttons on the client page (new, qualifying, consultation, search, showing, offer, under contract, closing, past, paused) only change the working record on this desk.

If the paste says not to contact them, **SEND** tells you not to text. That applies to that person only. Someone else in the same household can still have a draft.

A Spanish preference has to be stated (Language: Spanish, or they ask for Spanish). A neighborhood name does not switch the language.

### Search and practice

Type a name, phone, or property in the search box. Tap the person.

1. Settings, then **Add demo examples**.
2. When you want them gone, Settings, then **Remove demo records**.
3. Expected result: the fake people disappear. Real leads you typed stay.

A red box on Today means an automation failed. Read it. The usual one on the demo desk says Redfin is not connected. That is expected. No mail was imported.
