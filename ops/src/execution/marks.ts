import { randomUUID } from 'node:crypto';
import { recordCanonicalEvent } from '../canonical.ts';
import { recordActivity } from '../conversion/activity.ts';
import { confirmOfferSubmitted } from '../conversion/engine.ts';
import { text, type SqlDb } from '../sql.ts';
import { recordShowingTransition } from './showing.ts';

const MARKS = [
  'sent_manually',
  'called',
  'agent_tools_updated',
  'waiting',
  'showing_completed',
  'showing_cancelled',
  'offer_submitted',
] as const;

export type ManualMark = (typeof MARKS)[number];

export function applyManualMark(db: SqlDb, input: {
  opportunityId: string;
  mark: string;
  now?: Date;
}): { applied: boolean; mark: string; live: false; sent: false; writtenToAgentTools: false; reason: string } {
  const now = input.now ?? new Date();
  const opp = db.get(`SELECT id, client_id FROM opportunities WHERE id = ?`, input.opportunityId);
  if (!opp) return { applied: false, mark: input.mark, live: false, sent: false, writtenToAgentTools: false, reason: 'Opportunity not found.' };
  if (!MARKS.includes(input.mark as ManualMark)) {
    return { applied: false, mark: input.mark, live: false, sent: false, writtenToAgentTools: false, reason: 'Unknown mark.' };
  }
  const clientId = text(opp, 'client_id');
  if (input.mark === 'showing_completed' || input.mark === 'showing_cancelled') {
    recordActivity(db, {
      opportunityId: input.opportunityId,
      kind: 'event_scheduled',
      actor: 'Kyle Kleinman',
      note: 'Kyle marked a showing from the execution desk.',
      now,
    });
    if (input.mark === 'showing_completed') {
      recordActivity(db, {
        opportunityId: input.opportunityId,
        kind: 'event_completed',
        actor: 'Kyle Kleinman',
        note: 'Kyle marked the showing completed. This is not a provider confirmation.',
        now,
      });
      recordShowingTransition(db, {
        opportunityId: input.opportunityId,
        state: 'SHOWING_COMPLETED',
        source: 'kyle_mark',
        evidence: 'Kyle marked the showing completed inside KyleOS. Not a provider confirmation.',
        now,
      });
    }
    if (input.mark === 'showing_cancelled') {
      recordShowingTransition(db, {
        opportunityId: input.opportunityId,
        state: 'SHOWING_CANCELLED',
        source: 'kyle_mark',
        evidence: 'Kyle marked the showing cancelled inside KyleOS.',
        now,
      });
    }
  }
  if (input.mark === 'offer_submitted') {
    confirmOfferSubmitted(db, { opportunityId: input.opportunityId, confirmation: 'kyle_confirmed', now });
  }
  if (input.mark === 'sent_manually') {
    const value = `sent_manually; waiting=WAITING_ON_CLIENT; next_trigger=client reply; at=${now.toISOString()}`;
    db.run(
      `INSERT INTO client_facts (id, client_id, opportunity_id, field_key, value, kind, verification, source, observed_at, updated_at)
       VALUES (?, ?, ?, 'execution_suppression', ?, 'fact', 'unverified', 'kyle_mark', ?, ?)
       ON CONFLICT(client_id, field_key, kind) DO UPDATE SET
         value = excluded.value,
         opportunity_id = excluded.opportunity_id,
         source = excluded.source,
         updated_at = excluded.updated_at`,
      randomUUID(),
      clientId,
      input.opportunityId,
      value,
      now.toISOString(),
      now.toISOString(),
    );
  }
  recordCanonicalEvent(db, {
    idempotencyKey: `manual-mark:${input.opportunityId}:${input.mark}:${now.toISOString()}`,
    clientId,
    opportunityId: input.opportunityId,
    kind: 'manual_mark',
    now,
    payload: {
      mark: input.mark,
      live: false,
      sent: false,
      writtenToAgentTools: false,
      note: 'Kyle confirmed this inside KyleOS. No message was sent and Agent Tools was not written.',
    },
  });
  return {
    applied: true,
    mark: input.mark,
    live: false,
    sent: false,
    writtenToAgentTools: false,
    reason: 'KyleOS state updated. Nothing was sent and Agent Tools was not written.',
  };
}
