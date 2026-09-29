import { recordCanonicalEvent } from '../canonical.ts';
import { enqueueApproval } from '../conversion/approval.ts';
import { nextBestAction } from '../conversion/engine.ts';
import { text, type SqlDb } from '../sql.ts';
import { ensureOverdueCmaSeller } from './cma.ts';
import { planDesk, type DeskFact } from './plan.ts';

/** Turns the current facts into a structured action and a draft in the existing approval queue. Sends nothing. */
export function publishExecution(db: SqlDb, input: {
  clientId: string;
  opportunityId: string;
  now: Date;
}): { live: false; approvalStatus: string } {
  const client = db.get(`SELECT display_name, status FROM clients WHERE id = ?`, input.clientId);
  const opp = db.get(`SELECT primary_stage, original_lead_source FROM opportunities WHERE id = ?`, input.opportunityId);
  const facts = db.all(
    `SELECT field_key, value, kind, verification FROM client_facts WHERE client_id = ?`,
    input.clientId,
  ).map((fact): DeskFact => ({
    field: text(fact, 'field_key'),
    value: text(fact, 'value'),
    kind: text(fact, 'kind') === 'inference' ? 'inference' : 'fact',
    verification: text(fact, 'verification') === 'verified' ? 'verified' : 'unverified',
  }));
  if (text(opp, 'original_lead_source')) {
    facts.push({ field: 'lead_source', value: text(opp, 'original_lead_source'), kind: 'fact', verification: 'verified' });
  }
  const phone = identifier(db, input.clientId, 'phone');
  const email = identifier(db, input.clientId, 'email');
  const card = planDesk({
    name: text(client, 'display_name') || 'Unknown',
    stage: text(opp, 'primary_stage') || 'NEW_INQUIRY',
    phone,
    email,
    dnc: text(opp, 'primary_stage') === 'DO_NOT_CONTACT' || text(client, 'status') === 'do_not_contact',
    facts,
    now: input.now,
  });
  card.opportunityId = input.opportunityId;
  nextBestAction(db, input.opportunityId, input.now);
  ensureOverdueCmaSeller(db, input.opportunityId, input.now);
  const draft = card.clientDraft ?? card.emailDraft ?? card.callOpening;
  let approvalStatus = 'none';
  if (draft) {
    const queued = enqueueApproval(db, {
      opportunityId: input.opportunityId,
      clientId: input.clientId,
      actionType: 'manual_action',
      channel: card.emailDraft ? 'email' : card.callOpening ? 'voice' : 'sms',
      draftContent: draft,
      reason: card.humanAction,
      riskLevel: 'low',
      source: 'execution_desk',
      createdBy: 'system',
      now: input.now,
    });
    approvalStatus = queued.status;
  }
  recordCanonicalEvent(db, {
    idempotencyKey: `execution-action:${input.opportunityId}:${input.now.toISOString()}`,
    clientId: input.clientId,
    opportunityId: input.opportunityId,
    kind: 'execution_action',
    now: input.now,
    payload: {
      humanAction: card.humanAction,
      clientDraft: card.clientDraft,
      emailDraft: card.emailDraft,
      callOpening: card.callOpening,
      showingState: card.showingState,
      internalCode: card.internalCode,
      manualActionRequired: true,
      approvalRequired: true,
      live: false,
      writtenToAgentTools: false,
      sent: false,
    },
  });
  return { live: false, approvalStatus };
}

function identifier(db: SqlDb, clientId: string, kind: string): string | null {
  const row = db.get(
    `SELECT raw_value FROM client_identifiers WHERE client_id = ? AND kind = ? ORDER BY created_at DESC`,
    clientId,
    kind,
  );
  const value = text(row, 'raw_value');
  return value || null;
}
