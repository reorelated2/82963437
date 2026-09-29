import { text, transaction, type SqlDb } from '../sql.ts';
import { draftConsult } from './engine.ts';
import { enqueueApproval } from './approval.ts';
import {
  SELLER_INTAKE_FIELDS,
  SELLER_QUESTIONS,
  SELLER_READINESS,
  SELLER_STAGES,
  screenNextAction,
  type SellerIntakeField,
  type SellerReadiness,
  type SellerStage,
} from './policy.ts';

const OWNER = 'Kyle Kleinman';
const CONSULT_FACTS: SellerIntakeField[] = ['property_address', 'motivation', 'timing', 'decision_makers'];

export interface SellerView {
  opportunityId: string;
  sellerStage: string;
  nextAction: string;
  owner: string;
  dueAt: string;
  followUpTrigger: string;
  live: false;
}

export function openSellerFile(db: SqlDb, input: { opportunityId: string; now?: Date }): SellerView {
  const now = input.now ?? new Date();
  const row = requireSeller(db, input.opportunityId);
  const nowIso = now.toISOString();
  for (const flag of SELLER_READINESS) {
    db.run(
      `INSERT INTO readiness_flags (opportunity_id, flag, state, evidence, updated_at)
       VALUES (?, ?, 'unknown', NULL, ?)
       ON CONFLICT(opportunity_id, flag) DO NOTHING`,
      row.id,
      flag,
      nowIso,
    );
  }
  if (!text(row, 'seller_stage')) {
    db.run(`UPDATE opportunities SET seller_stage = 'SELLER_NEW', updated_at = ? WHERE id = ?`, nowIso, row.id);
  }
  const question = selectSellerQuestion(db, row.id);
  writeSellerPlan(db, row.id, {
    sellerStage: (text(row, 'seller_stage') || 'SELLER_NEW') as SellerStage,
    nextAction: question?.question ?? 'Review the seller file. Confirmed intake answers are on record.',
    dueAt: hoursFrom(now, 24),
    followUpTrigger: 'seller_intake',
    now,
  });
  return sellerView(db, row.id);
}

export function sellerNextQuestion(db: SqlDb, opportunityId: string): { field: SellerIntakeField; question: string } | null {
  return selectSellerQuestion(db, opportunityId);
}

export function recordSellerAnswer(db: SqlDb, input: {
  opportunityId: string;
  field: SellerIntakeField;
  value: string;
  confirmation: string;
  now?: Date;
}): { applied: boolean; reason: string; question: { field: SellerIntakeField; question: string } | null; inventedAddress: false; live: false } {
  return transaction(db, () => {
    const now = input.now ?? new Date();
    requireSeller(db, input.opportunityId);
    if (input.confirmation !== 'customer_confirmed' && input.confirmation !== 'kyle_confirmed') {
      return {
        applied: false,
        reason: 'Only a customer-confirmed or Kyle-confirmed fact can answer seller intake.',
        question: selectSellerQuestion(db, input.opportunityId),
        inventedAddress: false,
        live: false,
      };
    }
    const value = input.value.trim();
    if (input.field === 'property_address' && !usableAddress(value)) {
      return {
        applied: false,
        reason: 'The property address is unknown. It was not invented.',
        question: { field: 'property_address', question: SELLER_QUESTIONS.property_address },
        inventedAddress: false,
        live: false,
      };
    }
    db.run(
      `INSERT INTO intake_answers (opportunity_id, field_key, value, status, confirmation, updated_at)
       VALUES (?, ?, ?, 'known', ?, ?)
       ON CONFLICT(opportunity_id, field_key) DO UPDATE SET
         value = excluded.value, status = 'known', confirmation = excluded.confirmation, updated_at = excluded.updated_at`,
      input.opportunityId,
      input.field,
      value,
      input.confirmation,
      now.toISOString(),
    );
    applySellerEffects(db, input.opportunityId, input.field, value, now);
    const stage = text(db.get(`SELECT seller_stage FROM opportunities WHERE id = ?`, input.opportunityId), 'seller_stage');
    const nextStage: SellerStage = stage === 'SELLER_NEW' || stage === '' ? 'SELLER_DISCOVERY' : (stage as SellerStage);
    const question = selectSellerQuestion(db, input.opportunityId);
    writeSellerPlan(db, input.opportunityId, {
      sellerStage: nextStage,
      nextAction: question?.question ?? 'Seller intake answers on record are confirmed. A consult still needs an explicit request.',
      dueAt: hoursFrom(now, 24),
      followUpTrigger: question ? 'seller_intake' : 'seller_review',
      now,
    });
    return { applied: true, reason: 'Seller answer stored from a confirmed fact.', question, inventedAddress: false, live: false };
  });
}

export function requestSellerConsult(db: SqlDb, input: { opportunityId: string; now?: Date }): {
  ready: boolean;
  reason: string;
  question: { field: SellerIntakeField; question: string } | null;
  status: string;
  live: false;
} {
  const now = input.now ?? new Date();
  const row = requireSeller(db, input.opportunityId);
  const missing = CONSULT_FACTS.find((field) => !knownValue(db, input.opportunityId, field));
  if (missing) {
    return {
      ready: false,
      reason: 'Seller consult needs a confirmed address, motivation, timing, and decision makers.',
      question: { field: missing, question: SELLER_QUESTIONS[missing] },
      status: 'not_ready',
      live: false,
    };
  }
  const drafted = draftConsult(db, { id: row.id, clientId: row.clientId }, 'seller_consult', now);
  writeSellerPlan(db, row.id, {
    sellerStage: 'SELLER_CONSULT_READY',
    nextAction: 'Draft the listing consult. Kyle has the listing only if a representation answer says so.',
    dueAt: hoursFrom(now, 24),
    followUpTrigger: 'seller_consult',
    now,
  });
  markSellerFlag(db, row.id, 'SELLER_CONSULT_READY', 'ready', 'Consult requested after the required facts were confirmed.', now);
  enqueueApproval(db, {
    opportunityId: row.id,
    clientId: row.clientId,
    actionType: 'seller_consult_outreach',
    channel: 'sms',
    draftContent: 'A listing consult is the useful next step. What day this week works for a 20 minute call?',
    reason: 'Seller consult outreach stays in the approval queue.',
    riskLevel: 'standard',
    source: 'seller_consult',
    createdBy: 'system',
    now,
  });
  return { ready: true, reason: 'Consult draft created. Nothing was sent.', question: null, status: drafted.live === false ? 'draft' : 'draft', live: false };
}

export function setSellerStage(db: SqlDb, input: {
  opportunityId: string;
  stage: SellerStage;
  confirmation: string;
  now?: Date;
}): { applied: boolean; sellerStage: string; live: false } {
  const now = input.now ?? new Date();
  requireSeller(db, input.opportunityId);
  if (input.confirmation !== 'kyle_confirmed') {
    return { applied: false, sellerStage: text(db.get(`SELECT seller_stage FROM opportunities WHERE id = ?`, input.opportunityId), 'seller_stage'), live: false };
  }
  if (!SELLER_STAGES.includes(input.stage)) {
    return { applied: false, sellerStage: text(db.get(`SELECT seller_stage FROM opportunities WHERE id = ?`, input.opportunityId), 'seller_stage'), live: false };
  }
  db.run(`UPDATE opportunities SET seller_stage = ?, updated_at = ? WHERE id = ?`, input.stage, now.toISOString(), input.opportunityId);
  return { applied: true, sellerStage: input.stage, live: false };
}

function applySellerEffects(db: SqlDb, opportunityId: string, field: SellerIntakeField, value: string, now: Date): void {
  if (field === 'property_address') markSellerFlag(db, opportunityId, 'SELLER_PROPERTY_IDENTIFIED', 'ready', value, now);
  if (field === 'motivation') markSellerFlag(db, opportunityId, 'SELLER_MOTIVATION_KNOWN', 'ready', value, now);
  if (field === 'timing') markSellerFlag(db, opportunityId, 'SELLER_TIMELINE_KNOWN', 'ready', value, now);
  if (field === 'decision_makers') markSellerFlag(db, opportunityId, 'SELLER_DECISION_MAKERS_KNOWN', 'ready', value, now);
  if (field === 'cma_need' && /^yes\b/i.test(value) && knownValue(db, opportunityId, 'property_address')) {
    markSellerFlag(db, opportunityId, 'SELLER_CMA_READY', 'ready', 'CMA requested. Stage was not advanced from this flag.', now);
  }
  if (field === 'representation' && /listing agreement|kyle has the listing/i.test(value)) {
    markSellerFlag(db, opportunityId, 'SELLER_LISTING_READY', 'ready', value, now);
  }
}

function selectSellerQuestion(db: SqlDb, opportunityId: string): { field: SellerIntakeField; question: string } | null {
  const known = new Set(
    db.all(
      `SELECT field_key FROM intake_answers WHERE opportunity_id = ? AND status IN ('known', 'not_applicable')`,
      opportunityId,
    ).map((row) => text(row, 'field_key')),
  );
  for (const field of SELLER_INTAKE_FIELDS) {
    if (field === 'mortgage_equity' && !needsMortgage(db, opportunityId)) continue;
    if (known.has(field)) continue;
    return { field, question: SELLER_QUESTIONS[field] };
  }
  return null;
}

function needsMortgage(db: SqlDb, opportunityId: string): boolean {
  const sale = knownValue(db, opportunityId, 'sale_required');
  return Boolean(sale && /\b(yes|required)\b/i.test(sale));
}

function knownValue(db: SqlDb, opportunityId: string, field: string): string {
  const row = db.get(
    `SELECT value FROM intake_answers WHERE opportunity_id = ? AND field_key = ? AND status = 'known'`,
    opportunityId,
    field,
  );
  return text(row, 'value').trim();
}

function usableAddress(value: string): boolean {
  if (!value) return false;
  if (/^(unknown|n\/a|na|tbd|not provided|none|not sure)$/i.test(value)) return false;
  return true;
}

function markSellerFlag(db: SqlDb, opportunityId: string, flag: SellerReadiness, state: string, evidence: string, now: Date): void {
  db.run(
    `INSERT INTO readiness_flags (opportunity_id, flag, state, evidence, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(opportunity_id, flag) DO UPDATE SET state = excluded.state, evidence = excluded.evidence, updated_at = excluded.updated_at`,
    opportunityId,
    flag,
    state,
    evidence,
    now.toISOString(),
  );
}

function writeSellerPlan(db: SqlDb, opportunityId: string, input: {
  sellerStage: SellerStage;
  nextAction: string;
  dueAt: string;
  followUpTrigger: string;
  now: Date;
}): void {
  const screened = screenNextAction(input.nextAction);
  if (!screened.allowed) throw new Error(screened.reason);
  db.run(
    `UPDATE opportunities SET
      seller_stage = ?, next_action = ?, next_action_owner = ?, next_action_due_at = ?,
      follow_up_trigger = ?, no_action_reason = NULL, updated_at = ?
     WHERE id = ?`,
    input.sellerStage,
    input.nextAction,
    OWNER,
    input.dueAt,
    input.followUpTrigger,
    input.now.toISOString(),
    opportunityId,
  );
}

function sellerView(db: SqlDb, opportunityId: string): SellerView {
  const row = requireSeller(db, opportunityId);
  return {
    opportunityId,
    sellerStage: text(row, 'seller_stage'),
    nextAction: text(row, 'next_action'),
    owner: text(row, 'next_action_owner'),
    dueAt: text(row, 'next_action_due_at'),
    followUpTrigger: text(row, 'follow_up_trigger'),
    live: false,
  };
}

function requireSeller(db: SqlDb, opportunityId: string): { id: string; clientId: string } & Record<string, unknown> {
  const row = db.get(`SELECT * FROM opportunities WHERE id = ?`, opportunityId);
  if (!row) throw new Error('Opportunity not found.');
  if (text(row, 'business_line') !== 'redfin_seller') throw new Error('Seller intake runs on the seller opportunity.');
  return { ...row, id: text(row, 'id'), clientId: text(row, 'client_id') };
}

function hoursFrom(now: Date, hours: number): string {
  return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
}
