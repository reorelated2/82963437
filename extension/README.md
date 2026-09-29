# Kyle's Real Estate Operating Agent — v2.1

One persistent Chrome side panel. Seven modes. Reads the visible page, classifies it, drafts the next move, flags risk, tells Kyle exactly what to click. Draft/guide/prefill/recommend only — it never submits, sends, signs, completes, dismisses, or saves.

## Install
chrome://extensions → Developer mode → Load unpacked → this folder. Click the extension icon to open the panel. It stays docked while you work.

## Modes
- **Auto** — classifies the page. Customer detail or expanded follow-up row → Lead Mode. Appointments or Team Dashboard → Capture Mode. One Gmail thread or one Follow Up Boss person → inbox lead parser. Broad/mixed lists → asks you to pick a target. Never blends contacts.
- **Lead** — full lead output: summary, priority, why it matters, next best action, Agent Tools note, task, SMS, email, call reason, disposition, reminder timing, risk flags, missing info, exact recommended click. On Gmail or Follow Up Boss, Lead runs the inbox parser instead.
- **Capture** — Team Dashboard / Appointments database capture. One FUB package per row. Reads the opportunity counters and tells you where to click. Every package sits behind the Permission Required gate: Approve outreach / Save to database only / Needs review / Do not contact. Assigned agent is always Kyle Kleinman; any other owner = Needs Review.
- **MLS / CMA / OneHome / Contract** — full analysis frameworks, paste-powered today (API key required, ⚙). DOM readers for these surfaces get wired the moment Kyle shows the agent a live page, same as Agent Tools was.

## Gmail and Follow Up Boss
Auto (or Lead) reads one open Gmail thread or one Follow Up Boss person. It drafts the note, task, text, and email. List views are refused so contacts are never blended. If the page does not parse, paste a single thread or person.

Team, shared, or unclear ownership stays behind the same permission gate as Capture. Automated mail (noreply, unsubscribe) gets no reply.

## Prefill
Approve prefill writes into an empty note, an empty task, or an open Gmail compose box. Existing text is left alone. Gmail reply text is inserted at the top of the compose box. The To line is never filled. Nothing is submitted, sent, saved, or signed.

## Hard rules (in code, not vibes)
- No email to any @redfin.com address, ever, in any mode. Detected → blocked with: "Needs Review: Redfin internal email detected. Do not send through this agent."
- Team/shared-source contacts: no outreach recommendation until Kyle approves that specific contact.
- Ownership unclear or assigned elsewhere → "Needs Review: Lead ownership unclear. Do not contact until Kyle confirms permission."
- Contract Mode outputs a worksheet, never legal advice.
- Prefill is value-only. The page script does not click Send, Save, Submit, Complete, or Dismiss.

## Build order status
1. Persistent side panel — SHIPPED
2. Agent Tools reader + lead parser — SHIPPED (validated selectors)
3. Database Capture / FUB Builder — SHIPPED (permission gated)
4. MLS listing reader — framework shipped, paste-powered; DOM pending live page
5. MLS search/comp reader — same
6. CMA module — same
7. OneHome assistant — same
8. Offer strategy — inside MLS/CMA outputs
9. Contract worksheet — SHIPPED, paste-powered
10. Gmail/FUB lead parser — SHIPPED (Gmail thread DOM, Follow Up Boss person DOM, single-contact paste fallback)
11. Field prefill (approval gated) — SHIPPED (note, task, Gmail compose body/subject; never the recipient, never send)
