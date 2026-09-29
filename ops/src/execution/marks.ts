import { writeClientFact, recordCanonicalEvent } from '../canonical.ts';
import { recordActivity } from '../conversion/activity.ts';
import { confirmOfferSubmitted } from '../conversion/engine.ts';
import { text, type SqlDb } from '../sql.ts';
import { closeWaiting, openWaiting, recordExecutionMarkRow } from './continuity.ts';
import { recordShowingTransition } from './showing.ts';

const MARKS = [
  'sent_manually',
  'called',
  'agent_tools_updated',
  'waiting',
  'showing_completed',
  'showing_cancelled',
  'offer_submitted',
  'client_replied',
  'no_reply',
  'call_completed',
  'showing_occurred',
  'showing_did_not',
  'interested',
  'not_interested',
  'wants_offer',
  'needs_financing',
  'needs_to_sell',
  'contact_found',
  'property_unavailable',
  'listing_appt_set',
] as const;

export type ManualMark = (typeof MARKS)[number];

export interface ManualMarkResult {
  applied: boolean;
  mark: string;
  live: false;
  sent: false;
  writtenToAgentTools: false;
  executionAuthority: 'marked_by_kyle' | null;
  verifiedByIntegration: false;
  rerank: boolean;
  reason: string;
}

export function applyManualMark(db: SqlDb, input: {
  opportunityId: string;
  mark: string;
  now?: Date;
  payload?: string | null;
}): ManualMarkResult {
  const now = input.now ?? new Date();
  const refused = (reason: string): ManualMarkResult => ({
    applied: false,
    mark: input.mark,
    live: false,
    sent: false,
    writtenToAgentTools: false,
    executionAuthority: null,
    verifiedByIntegration: false,
    rerank: false,
    reason,
  });
  const opp = db.get(`SELECT id, client_id FROM opportunities WHERE id = ?`, input.opportunityId);
  if (!opp) return refused('Opportunity not found.');
  if (!MARKS.includes(input.mark as ManualMark)) return refused('Unknown mark.');
  const clientId = text(opp, 'client_id');
  const payload = (input.payload ?? '').trim();
  const authority = 'marked_by_kyle' as const;

  if (input.mark === 'sent_manually') {
    openWaiting(db, {
      opportunityId: input.opportunityId,
      party: 'CLIENT',
      reason: 'Kyle marked the message sent from the phone. The desk did not send it.',
      endCondition: 'The client replies.',
      now,
      nextCheckAt: hoursFrom(now, 24),
      staleAfter: hoursFrom(now, 72),
    });
  }
  if (input.mark === 'called' || input.mark === 'call_completed') {
    openWaiting(db, {
      opportunityId: input.opportunityId,
      party: 'CLIENT',
      reason: 'Kyle marked a call. The desk did not place it.',
      endCondition: 'What the client said is recorded.',
      now,
      nextCheckAt: hoursFrom(now, 4),
      staleAfter: hoursFrom(now, 48),
    });
  }
  if (input.mark === 'waiting') {
    openWaiting(db, {
      opportunityId: input.opportunityId,
      party: 'CLIENT',
      reason: payload || 'Kyle marked this file waiting.',
      endCondition: payload || 'The wait condition Kyle named.',
      now,
      nextCheckAt: hoursFrom(now, 24),
      staleAfter: hoursFrom(now, 96),
    });
  }
  if (input.mark === 'client_replied' || input.mark === 'interested' || input.mark === 'not_interested' || input.mark === 'contact_found') {
    closeWaiting(db, input.opportunityId);
    writeKyleFact(db, clientId, input.opportunityId, 'last_outcome', input.mark, now);
  }
  if (input.mark === 'no_reply') {
    openWaiting(db, {
      opportunityId: input.opportunityId,
      party: 'CLIENT',
      reason: 'No reply after Kyle marked the outreach.',
      endCondition: 'A reply, or Kyle chooses the next touch.',
      now,
      nextCheckAt: hoursFrom(now, 48),
      staleAfter: hoursFrom(now, 96),
    });
  }
  if (input.mark === 'showing_completed' || input.mark === 'showing_occurred' || input.mark === 'showing_cancelled' || input.mark === 'showing_did_not') {
    recordActivity(db, {
      opportunityId: input.opportunityId,
      kind: 'event_scheduled',
      actor: 'Kyle Kleinman',
      note: 'Kyle marked a showing from the execution desk. MARKED BY KYLE. Not verified by an integration.',
      now,
    });
  }
  if (input.mark === 'showing_completed' || input.mark === 'showing_occurred') {
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
      evidence: 'MARKED BY KYLE. Not verified by an integration.',
      now,
    });
    writeKyleFact(db, clientId, input.opportunityId, 'showing_outcome', 'completed', now);
    writeKyleFact(db, clientId, input.opportunityId, 'showing_outcome_by', 'Kyle Kleinman', now);
    closeWaiting(db, input.opportunityId);
  }
  if (input.mark === 'showing_cancelled' || input.mark === 'showing_did_not') {
    recordShowingTransition(db, {
      opportunityId: input.opportunityId,
      state: input.mark === 'showing_cancelled' ? 'SHOWING_CANCELLED' : 'RESCHEDULE_NEEDED',
      source: 'kyle_mark',
      evidence: 'MARKED BY KYLE. Not verified by an integration.',
      now,
    });
    closeWaiting(db, input.opportunityId);
  }
  if (input.mark === 'wants_offer') {
    writeKyleFact(db, clientId, input.opportunityId, 'wants_offer', 'yes', now);
  }
  if (input.mark === 'needs_financing') {
    writeKyleFact(db, clientId, input.opportunityId, 'financing_state', 'NEEDS_PREAPPROVAL', now);
  }
  if (input.mark === 'needs_to_sell') {
    writeKyleFact(db, clientId, input.opportunityId, 'sale_dependency', 'sale_required', now);
  }
  if (input.mark === 'property_unavailable') {
    writeKyleFact(db, clientId, input.opportunityId, 'property_status', 'Pending', now);
  }
  if (input.mark === 'listing_appt_set') {
    writeKyleFact(db, clientId, input.opportunityId, 'listing_consult', 'scheduled', now);
  }
  if (input.mark === 'offer_submitted') {
    confirmOfferSubmitted(db, { opportunityId: input.opportunityId, confirmation: 'kyle_confirmed', now });
  }
  recordExecutionMarkRow(db, {
    opportunityId: input.opportunityId,
    clientId,
    mark: input.mark,
    now,
    payload: {
      mark: input.mark,
      payload,
      live: false,
      sent: false,
      writtenToAgentTools: false,
      executionAuthority: authority,
      verifiedByIntegration: false,
    },
  });
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
      executionAuthority: authority,
      verifiedByIntegration: false,
      note: 'MARKED BY KYLE inside KyleOS. Not verified by an integration. No message was sent and Agent Tools was not written.',
    },
  });
  return {
    applied: true,
    mark: input.mark,
    live: false,
    sent: false,
    writtenToAgentTools: false,
    executionAuthority: authority,
    verifiedByIntegration: false,
    rerank: true,
    reason: 'MARKED BY KYLE. KyleOS will rerank. Nothing was sent and Agent Tools was not written. This is not verified by an integration.',
  };
}

function writeKyleFact(db: SqlDb, clientId: string, opportunityId: string, fieldKey: string, value: string, now: Date): void {
  writeClientFact(db, {
    clientId,
    opportunityId,
    now,
    actor: 'Kyle Kleinman',
    fact: { fieldKey, value, kind: 'fact', verification: 'verified', source: 'kyle' },
  });
}

function hoursFrom(now: Date, hours: number): string {
  return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
}
