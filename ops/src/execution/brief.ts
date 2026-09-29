import { enqueueApproval } from '../conversion/approval.ts';
import { nextBestAction } from '../conversion/engine.ts';
import { text, type SqlDb } from '../sql.ts';
import { integrationCapabilities, type IntegrationCapability } from './capabilities.ts';
import { clockFrom, type ClockSource } from './clock.ts';
import { continuityFacts, isWorkflowDrift } from './continuity.ts';
import { fridayReport, type FridayReport } from './friday.ts';
import { planDesk, renderMorningBrief, morningSections, easternClock, type BriefBucket, type DeskFact, type ExecutionCard } from './plan.ts';
import { recordShowingTransition } from './showing.ts';

export interface MorningBrief {
  generated: true;
  live: false;
  text: string;
  cards: ExecutionCard[];
  summary: {
    texts: number;
    calls: number;
    emails: number;
    postTour: number;
    contactGaps: number;
  };
  sections: { header: BriefBucket[]; summary: BriefBucket[] };
  capabilities: IntegrationCapability[];
  friday: FridayReport;
  clock: { date: string; easternTime: string; source: ClockSource; zone: 'America/New_York'; instant: string };
}

export function buildMorningBrief(db: SqlDb, now?: Date): MorningBrief {
  const clock = clockFrom(now);
  const at = clock.now;
  const rows = db.all(
    `SELECT o.id AS opportunity_id, o.client_id, o.primary_stage, o.original_lead_source, o.source_system,
            c.display_name, c.status AS client_status
     FROM opportunities o
     JOIN clients c ON c.id = o.client_id
     WHERE o.status = 'open' AND o.business_line = 'redfin_buyer'`,
  );
  const cards: ExecutionCard[] = [];
  for (const row of rows) {
    const opportunityId = text(row, 'opportunity_id');
    const clientId = text(row, 'client_id');
    const facts = db.all(
      `SELECT field_key, value, kind, verification FROM client_facts WHERE client_id = ?`,
      clientId,
    ).map((fact): DeskFact => ({
      field: text(fact, 'field_key'),
      value: text(fact, 'value'),
      kind: text(fact, 'kind') === 'inference' ? 'inference' : 'fact',
      verification: text(fact, 'verification') === 'verified' ? 'verified' : 'unverified',
    }));
    const phone = identifier(db, clientId, 'phone');
    const email = identifier(db, clientId, 'email');
    const dnc = text(row, 'primary_stage') === 'DO_NOT_CONTACT' || text(row, 'client_status') === 'do_not_contact';
    if (text(row, 'original_lead_source')) {
      facts.push({ field: 'lead_source', value: text(row, 'original_lead_source'), kind: 'fact', verification: 'verified' });
    }
    const history = db.all(`SELECT source_system, lead_source, conflict FROM lead_source_history WHERE opportunity_id = ?`, opportunityId);
    for (const item of history) {
      facts.push({
        field: Number(item.conflict) === 1 ? 'lead_source_conflict' : 'lead_source_history',
        value: `${text(item, 'source_system')}: ${text(item, 'lead_source') || 'unset'}`,
        kind: 'fact',
        verification: 'verified',
      });
    }
    facts.push(...continuityFacts(db, opportunityId));
    const drift = isWorkflowDrift(db, opportunityId);
    const card = planDesk({
      name: text(row, 'display_name') || 'Unknown',
      stage: text(row, 'primary_stage') || 'NEW_INQUIRY',
      phone,
      email,
      dnc,
      facts,
      now: at,
    });
    card.opportunityId = opportunityId;
    if (drift && card.internalCode !== 'do_not_contact') {
      card.workflowDrift = true;
      card.whyNow = `WORKFLOW DRIFT. No next action, waiting condition, or future trigger was stored. ${card.whyNow}`;
      card.secondaryActions = [card.humanAction, ...card.secondaryActions];
      card.humanAction = 'WORKFLOW DRIFT. Give this file a next action, a waiting condition, or a future trigger.';
      card.primaryAction = card.humanAction;
    }
    for (const state of card.showingTransitions) {
      recordShowingTransition(db, {
        opportunityId,
        state,
        source: 'execution_desk',
        evidence: card.whyNow,
        now: at,
      });
    }
    cards.push(card);
    nextBestAction(db, opportunityId, at);
    const draft = card.clientDraft ?? card.emailDraft ?? card.callOpening;
    if (draft) {
      enqueueApproval(db, {
        opportunityId,
        clientId,
        actionType: 'manual_action',
        channel: card.emailDraft ? 'email' : card.callOpening ? 'voice' : 'sms',
        draftContent: draft,
        reason: card.humanAction,
        riskLevel: 'low',
        source: 'execution_desk',
        createdBy: 'system',
        now: at,
      });
    }
  }
  const ordered = [...cards].sort((left, right) => left.tier - right.tier || right.priority - left.priority || right.hotScore - left.hotScore || left.clientName.localeCompare(right.clientName));
  ordered.forEach((card, index) => {
    card.priority = index + 1;
  });
  return {
    generated: true,
    live: false,
    text: renderMorningBrief(ordered, at, clock.source),
    cards: ordered,
    summary: {
      texts: ordered.filter((card) => card.clientDraft).length,
      calls: ordered.filter((card) => card.callOpening).length,
      emails: ordered.filter((card) => card.emailDraft).length,
      postTour: ordered.filter((card) => card.showingState === 'OUTCOME_UNKNOWN').length,
      contactGaps: ordered.filter((card) => card.internalCode === 'needs_contact').length,
    },
    sections: morningSections(ordered, at),
    capabilities: integrationCapabilities(),
    friday: fridayReport(db, at),
    clock: { ...easternClock(at), source: clock.source, zone: clock.zone, instant: at.toISOString() },
  };
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
