# Notion sync contract

Updated: 2026-09-29. This is a contract only. No Notion client is called from `ops/`. No Notion credential is stored. Kleinman Pipeline stays the master CRM and Todo List stays the master task system when a later sync is approved.

SQLite on the desk (`ops/data/desk.sqlite`) is the working copy for this build. Redfin Partner Tools remains the system of record for the client file. Notion is a projection. A sync may not treat a Notion edit as a verified human contact.

## Databases

| Notion database | Role | This build |
| --- | --- | --- |
| Kleinman Pipeline | Master CRM | Contract only. Not connected. |
| Todo List | Master task system | Contract only. One open task maps to one opportunity next action. |
| Properties / Opportunities | Later | Not created here. |
| Transactions | Later | Not created here. |
| Capture Data | Later | Not created here. |
| Projects | Later | Not created here. |

## Identity

Relations use durable ids, not display names.

| Desk id | Notion property | Rule |
| --- | --- | --- |
| `clients.id` | `Kyle Client Id` (text) | Required on every synced person. Never match on name alone. |
| `opportunities.id` | `Kyle Opportunity Id` (text) | Required on every synced pipeline row. |
| `opportunity_links.id` | relation between buyer and seller pages | Both opportunity ids are stored. A name match does not create the relation. |
| `client_identifiers` phone and email | Phone, Email | Normalized values. A conflict flags review and does not merge. |

Net-new Notion rows need a dedupe check on phone, then email, then `Kyle Client Id`. No match means create a review item. Do not insert a second person.

## Field map

Direction is from the desk's point of view. `desk_to_notion` means the desk publishes. `notion_to_desk` means a later import may propose a value. `bidirectional` still stops on conflict.

| SQLite | Notion property | Direction | Source of truth | Conflict rule |
| --- | --- | --- | --- | --- |
| `clients.display_name` | Customer name | bidirectional | Desk, unless Kyle edits the Notion name and the desk name is empty | Review. Do not overwrite a non-empty desk name. |
| `client_identifiers` phone | Phone | bidirectional | Desk | Review. Do not merge two clients. |
| `client_identifiers` email | Email | bidirectional | Desk | Review. Do not merge two clients. |
| `opportunities.business_line` | Lead type | desk_to_notion | Desk | `redfin_buyer` and `redfin_seller` stay distinct pages. |
| `opportunities.primary_stage` and `seller_stage` | Pipeline stage | desk_to_notion | Desk | Buyer stage and seller stage are separate. A readiness flag does not set the stage. |
| `next_best_actions.priority_bucket` | Priority | desk_to_notion | Desk | Score reasons travel with the value. No demographic input. |
| `next_best_actions.priority_score` | Temperature | desk_to_notion | Desk | Temperature is the score bucket, not a guess about the person. |
| `opportunities.contact_verification` | Verified contact status | desk_to_notion | Desk | Notion `last_edited_time` is not verified contact. Coordinator, import, and automation stay unverified. |
| `opportunities.last_meaningful_contact_at` | Last meaningful contact | desk_to_notion | Desk | Only a Kyle-verified touch. A requested showing is not contact completion. |
| `opportunities.next_action` | Next action | bidirectional | Desk until Kyle edits the Todo | Review if both changed. Reject generic "follow up", "check in", and "touch base". |
| `opportunities.next_action_owner` | Next action owner | desk_to_notion | Desk | Default owner is Kyle Kleinman. |
| `opportunities.next_action_due_at` | Next action due | bidirectional | Desk | Review if the Todo due date disagrees. |
| `opportunities.follow_up_trigger` | Follow-up trigger | desk_to_notion | Desk | Empty is allowed only with `NO_ACTION_REQUIRED` or `DO_NOT_CONTACT`. |
| `client_facts` budget, verified | Budget | desk_to_notion | Verified desk fact | Inference and import cannot replace it. Conflict opens `fact_reviews`. |
| `opportunities.financing_state` | Financing state | desk_to_notion | Desk | Unknown stays unknown. |
| `lender_handoffs.preapproval` | Preapproval | desk_to_notion | Desk | Preapproval text is not a live lender handoff. |
| `lender_handoffs` consent and status | Lender | desk_to_notion | Desk | Introduction stays an approval item until a later live channel exists. |
| `opportunity_links` present | Home to sell | desk_to_notion | Desk | A link does not mean Kyle has the listing. |
| `buyer_classifications` `proceeds_required` | Sale proceeds required | desk_to_notion | Customer-confirmed or Kyle-confirmed fact | Absence means not confirmed. Do not infer it. |
| seller intake `decision_makers` | Decision makers | desk_to_notion | Confirmed seller answer | Unknown stays a question. |
| confirmed search facts | Must-haves | desk_to_notion | Confirmed buyer answer | Do not copy from browsing behavior. |
| handoff or intake objection text | Objection | desk_to_notion | Desk | Offer, legal, and commission objections stay Level 4. |
| `next_best_actions.priority_reasons_json` | Risk | desk_to_notion | Desk | Closing and contract risk outrank nurture. |
| later property id | Related property | desk_to_notion | Desk | No address is invented. Empty stays empty. |
| `opportunities.business_line` | Business line | desk_to_notion | Desk | Buyer and seller pages stay linked, not merged. |

## Rules

- A Notion import timestamp, page edit time, or automation run does not become verified human contact.
- Raw Agent Tools history stays in the capture log. Sync does not rewrite it.
- Verified facts beat inferred facts. `customer_confirmed` and `kyle_confirmed` beat import, webhook, system, automation, and coordinator sources.
- Conflict writes a review row and keeps the current verified value.
- Net-new records dedupe on durable ids, then phone, then email. Display name is not a key.
- Relations use `Kyle Client Id` and `Kyle Opportunity Id`.
- `DO_NOT_CONTACT` suppresses outbound drafts in Notion as well as on the desk.
- This document does not authorize a live Notion write.
