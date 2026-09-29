# Agent Tools lead ingestion

Dry-run only. This loader does not call Redfin, Agent Tools, MLS, SMS, email, or voice. `liveSend` stays false.

The real export is a JSON file on another machine. The expected production shape is 28 records: 26 `lead` and 2 `needs_review`. That file is not in this repository. Do not bulk-import it. The next milestone is one real lead, passed with `onlyRecordId`.

The checked-in fixture `ops/fixtures/agent-tools-leads.sample.json` uses the same envelope with four synthetic records.

## Envelope

```json
{
  "dataset": "redfin_agent_tools_leads",
  "mode": "DRY_RUN",
  "exported_at": "2026-09-29T15:00:00.000Z",
  "source_system": "redfin_agent_tools",
  "synthetic": true,
  "records": []
}
```

`mode` must be `DRY_RUN`. Any other mode throws before a write. `synthetic: true` marks the rows as demo. Omit it for a real one-lead run.

## Record

| Field | Rule |
| --- | --- |
| `record_id` | Idempotency key `agent-tools:<record_id>`. A repeat does not create a second client. |
| `disposition` | `lead` or `needs_review`. |
| `source.system` | `redfin_agent_tools`. |
| `source.source_id` | Stable Agent Tools id. Used for dedup. Stored as identifier kind `agent_tools_id`. |
| `source.exported_at` | Provenance timestamp. Copied onto an `agent_tools_provenance` event. |
| `person.phones` / `person.emails` | Each entry is `{ value, verification }` where verification is `verified` or `inferred`. Only `verified` values match a client. Inferred values are stored as inferences and are not merge keys. |
| `person.household_id` | Evidence. A shared household flags both clients. It does not merge them. |
| `person.display_name` | Never a merge key. The same name on two clients is an identity flag. |
| `facts[]` | `{ field, value, kind, verification, evidence }`. `kind` is `fact` or `inference`. An inference cannot overwrite a verified fact. |
| `dedup_candidates[]` | `{ source_id, display_name, reason }`. Stored as review flags. Not applied as merges. |

Verified `financing_state` and `search_state` facts must use the desk enums (`UNKNOWN` through `FINANCING_READY`, and `UNKNOWN`, `NOT_STARTED`, `CRITERIA_PARTIAL`, `ACTIVE`, `PAUSED`). A verified `primary_stage` may set the opportunity stage except `OFFER_SUBMITTED`, which still requires Kyle's confirmation.

## What a kept record becomes

A verified phone or email runs through `ingestCanonicalLead`:

1. Canonical client.
2. One open `redfin_buyer` opportunity.
3. Facts and inferences on `client_facts`.
4. `openBuyerFile` sets stage `NEW_INQUIRY`, financing, the follow-up trigger, and one next question.
5. `nextBestAction` writes one primary row with `live = 0`.
6. A CRM note event says the note was drafted and not saved to Agent Tools.
7. Provenance event keeps `source_id` and `record_id`.

No verified phone and no verified email:

- The client is still created.
- Status is `pending_enrichment` (or `needs_review` when that is the disposition).
- `no_action_reason` is `PENDING_ENRICHMENT` or `NEEDS_REVIEW`.
- The record is not dropped.

Ambiguous verified phone and email, or a source id that points at a different client, flags those clients and holds the incoming record for review. `duplicate_of_client_id` stays empty.

Files with more than 8 records are not applied unless `onlyRecordId` selects one record.

## How to run one record

```ts
loadAgentToolsDataset(db, dataset, { apply: true, onlyRecordId: '<record_id>' });
```

Omit `apply` for a preview that writes nothing. There is no HTTP import route and no startup import.
