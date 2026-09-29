import { randomUUID } from 'node:crypto';
import { text, transaction, type SqlDb } from '../sql.ts';
import { enqueueApproval, cancelPendingApprovals } from './approval.ts';
import { isOpportunityDoNotContact } from './guards.ts';
import {
  CONSULT_TRIGGERS,
  DEPENDENCY_VALUES,
  FINANCING_STATES,
  INTAKE_FIELDS,
  LENDER_APPLICATION_LAG_MS,
  QUESTIONS,
  READINESS_FLAGS,
  TIMELINE_LEAD_DAYS,
  detectHandoff,
  screenNextAction,
  screenOutreach,
  type ClassificationAxis,
  type Confirmation,
  type ConsultTrigger,
  type FinancingState,
  type IntakeField,
  type NextBestAction,
  type NextQuestion,
  type PrimaryStage,
  type PriorityBucket,
  type ReadinessFlag,
} from './policy.ts';

const OWNER = 'Kyle Kleinman';

export interface BuyerView {
  opportunityId: string;
  clientId: string;
  primaryStage: string;
  financingState: string;
  nextAction: string;
  owner: string;
  dueAt: string;
  followUpTrigger: string;
  noActionReason: string;
  live: false;
}

export function openBuyerFile(db: SqlDb, input: { opportunityId: string; now?: Date }): BuyerView {
  const now = input.now ?? new Date();
  const opp = requireOpportunity(db, input.opportunityId);
  const nowIso = now.toISOString();
  for (const flag of READINESS_FLAGS) {
    db.run(
      `INSERT INTO readiness_flags (opportunity_id, flag, state, evidence, updated_at)
       VALUES (?, ?, 'unknown', NULL, ?)
       ON CONFLICT(opportunity_id, flag) DO NOTHING`,
      opp.id,
      flag,
      nowIso,
    );
  }
  const question = selectQuestion(db, opp.id);
  const action = question?.question ?? 'Review the file. The intake questions on record are answered.';
  writePlan(db, opp.id, {
    primaryStage: 'NEW_INQUIRY',
    financingState: text(opp, 'financing_state') || 'UNKNOWN',
    nextAction: action,
    dueAt: hoursFrom(now, 4),
    followUpTrigger: 'intake_answer',
    now,
  });
  return view(db, opp.id);
}

export function nextQuestion(db: SqlDb, opportunityId: string): NextQuestion | null {
  return selectQuestion(db, opportunityId);
}

export function recordAnswer(db: SqlDb, input: {
  opportunityId: string;
  field: IntakeField;
  value: string;
  confirmation: string;
  now?: Date;
}): { applied: boolean; reason: string; question: NextQuestion | null; live: false } {
  return transaction(db, () => {
    const now = input.now ?? new Date();
    const opp = requireOpportunity(db, input.opportunityId);
    if (isOpportunityDoNotContact(db, opp.id)) {
      return { applied: false, reason: 'DO_NOT_CONTACT blocks further intake outreach.', question: null, live: false as const };
    }
    if (!isConfirmation(input.confirmation)) {
      return {
        applied: false,
        reason: 'Only a customer-confirmed or Kyle-confirmed fact can answer intake. Nothing was inferred.',
        question: selectQuestion(db, opp.id),
        live: false,
      };
    }
    db.run(
      `INSERT INTO intake_answers (opportunity_id, field_key, value, status, confirmation, updated_at)
       VALUES (?, ?, ?, 'known', ?, ?)
       ON CONFLICT(opportunity_id, field_key) DO UPDATE SET
         value = excluded.value, status = 'known', confirmation = excluded.confirmation, updated_at = excluded.updated_at`,
      opp.id,
      input.field,
      input.value.trim(),
      input.confirmation,
      now.toISOString(),
    );
    applyAnswerEffects(db, opp, input.field, input.value.trim(), input.confirmation, now);
    const question = selectQuestion(db, opp.id);
    const stage = question ? 'QUALIFYING' : text(db.get(`SELECT primary_stage FROM opportunities WHERE id = ?`, opp.id), 'primary_stage') || 'QUALIFYING';
    writePlan(db, opp.id, {
      primaryStage: stage === 'NEW_INQUIRY' ? 'QUALIFYING' : stage,
      financingState: text(db.get(`SELECT financing_state FROM opportunities WHERE id = ?`, opp.id), 'financing_state') || 'UNKNOWN',
      nextAction: question?.question ?? 'Choose the consult or search step from the confirmed facts.',
      dueAt: hoursFrom(now, 4),
      followUpTrigger: question ? 'intake_answer' : 'consult_or_search',
      now,
    });
    return { applied: true, reason: 'Answer stored from a confirmed fact.', question, live: false };
  });
}

export function setClassification(db: SqlDb, input: {
  opportunityId: string;
  axis: ClassificationAxis;
  value: string;
  confirmation: string;
  source: string;
  now?: Date;
}): { applied: boolean; reason: string; live: false } {
  const now = input.now ?? new Date();
  requireOpportunity(db, input.opportunityId);
  if (!isConfirmation(input.confirmation)) {
    return { applied: false, reason: 'Classification was not set. Demographics and inferences are not used.', live: false };
  }
  if (input.axis === 'dependency' && !DEPENDENCY_VALUES.includes(input.value as (typeof DEPENDENCY_VALUES)[number])) {
    return { applied: false, reason: 'Dependency must be renter, homeowner_no_sale, sale_required, or proceeds_required.', live: false };
  }
  db.run(
    `INSERT INTO buyer_classifications (id, opportunity_id, axis, value, confirmation, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(opportunity_id, axis, value) DO NOTHING`,
    randomUUID(),
    input.opportunityId,
    input.axis,
    input.value,
    input.confirmation,
    input.source,
    now.toISOString(),
  );
  if (input.axis === 'dependency' && (input.value === 'sale_required' || input.value === 'proceeds_required')) {
    linkSellerOpportunity(db, input.opportunityId, input.value, now);
  }
  if (input.axis === 'dependency' && input.value === 'renter') {
    markReadiness(db, input.opportunityId, 'home_sale', 'not_applicable', 'Renter. No sale is required.', now);
  }
  return { applied: true, reason: 'Classification stored from a confirmed fact.', live: false };
}

export function introduceLender(db: SqlDb, input: {
  opportunityId: string;
  consent: 'granted' | 'denied' | 'unknown';
  now?: Date;
}): { financingState: FinancingState; live: false } {
  const now = input.now ?? new Date();
  const opp = requireOpportunity(db, input.opportunityId);
  if (isOpportunityDoNotContact(db, opp.id)) {
    return { financingState: (text(opp, 'financing_state') || 'UNKNOWN') as FinancingState, live: false };
  }
  if (input.consent !== 'granted') {
    writePlan(db, opp.id, {
      primaryStage: 'QUALIFYING',
      financingState: 'UNKNOWN',
      nextAction: 'Financing is still unknown. Ask whether they want a lender introduction.',
      dueAt: hoursFrom(now, 4),
      followUpTrigger: 'financing_consent',
      now,
    });
    return { financingState: 'UNKNOWN', live: false };
  }
  upsertHandoff(db, opp, {
    consent: 'granted',
    applicationStatus: 'none',
    prequal: 'no',
    preapproval: 'no',
    introducedAt: now.toISOString(),
    nextAction: 'Wait for the lender application. Do not ask for tax returns or account numbers by text.',
    dueAt: new Date(now.getTime() + LENDER_APPLICATION_LAG_MS).toISOString(),
    now,
  });
  markReadiness(db, opp.id, 'financing', 'unknown', 'Lender introduced. Application is not on file.', now);
  enqueueApproval(db, {
    opportunityId: opp.id,
    clientId: opp.clientId,
    actionType: 'lender_introduction',
    channel: 'sms',
    draftContent: 'Ask whether they want the lender introduction to stay on file. Do not request borrower documents by text.',
    reason: 'Lender introduction stays in the approval queue.',
    riskLevel: 'standard',
    source: 'lender_handoff',
    createdBy: 'system',
    now,
  });
  writePlan(db, opp.id, {
    primaryStage: 'QUALIFYING',
    financingState: 'INTRODUCED',
    nextAction: 'Lender is introduced. Ask only whether the application was started.',
    dueAt: new Date(now.getTime() + LENDER_APPLICATION_LAG_MS).toISOString(),
    followUpTrigger: 'lender_application',
    now,
  });
  return { financingState: 'INTRODUCED', live: false };
}

export function reviewLenderLeakage(db: SqlDb, opportunityId: string, now = new Date()): { due: boolean; action: string; live: false } {
  const opp = requireOpportunity(db, opportunityId);
  const handoff = db.get(`SELECT * FROM lender_handoffs WHERE opportunity_id = ? ORDER BY updated_at DESC`, opportunityId);
  const introducedAt = text(handoff, 'introduced_at');
  const application = text(handoff, 'application_status') || 'none';
  const state = text(opp, 'financing_state');
  const lagReached = Boolean(introducedAt) && now.getTime() - new Date(introducedAt).getTime() >= LENDER_APPLICATION_LAG_MS;
  if (state === 'INTRODUCED' && application === 'none' && lagReached) {
    const action = 'The lender was introduced and no application is on file. Ask whether they started it and what they still need.';
    const screened = screenOutreach(action, 'sms');
    if (!screened.allowed) throw new Error(screened.reason);
    writePlan(db, opportunityId, {
      primaryStage: 'QUALIFYING',
      financingState: 'INTRODUCED',
      nextAction: action,
      dueAt: hoursFrom(now, 4),
      followUpTrigger: 'lender_application',
      now,
    });
    if (handoff) {
      db.run(
        `UPDATE lender_handoffs SET next_action = ?, next_action_due_at = ?, updated_at = ? WHERE id = ?`,
        action,
        hoursFrom(now, 4),
        now.toISOString(),
        text(handoff, 'id'),
      );
    }
    return { due: true, action, live: false };
  }
  return { due: false, action: '', live: false };
}

export function advanceFinancing(db: SqlDb, input: {
  opportunityId: string;
  state: FinancingState;
  confirmation: string;
  approvedAmount?: string | null;
  expiration?: string | null;
  now?: Date;
}): { applied: boolean; financingState: string; stage: string; live: false } {
  return transaction(db, () => {
    const now = input.now ?? new Date();
    const opp = requireOpportunity(db, input.opportunityId);
    if (!FINANCING_STATES.includes(input.state)) {
      return { applied: false, financingState: text(opp, 'financing_state') || 'UNKNOWN', stage: text(opp, 'primary_stage'), live: false };
    }
    if (!isConfirmation(input.confirmation)) {
      return { applied: false, financingState: text(opp, 'financing_state') || 'UNKNOWN', stage: text(opp, 'primary_stage'), live: false };
    }
    const applicationStatus = applicationFor(input.state);
    const prequal = input.state === 'PREQUALIFIED' || input.state === 'PREAPPROVED' || input.state === 'FINANCING_READY' ? 'yes' : text(db.get(`SELECT prequal FROM lender_handoffs WHERE opportunity_id = ?`, opp.id), 'prequal') || 'no';
    const preapproval = input.state === 'PREAPPROVED' || input.state === 'FINANCING_READY' ? 'yes' : 'no';
    upsertHandoff(db, opp, {
      consent: 'granted',
      applicationStatus,
      prequal,
      preapproval,
      introducedAt: text(db.get(`SELECT introduced_at FROM lender_handoffs WHERE opportunity_id = ?`, opp.id), 'introduced_at') || now.toISOString(),
      approvedAmount: input.approvedAmount ?? null,
      expiration: input.expiration ?? null,
      nextAction: input.state === 'PREAPPROVED' || input.state === 'FINANCING_READY'
        ? 'Preapproval is on file. Draft a consult and open the search.'
        : 'Update the lender file. Do not request sensitive documents by text.',
      dueAt: hoursFrom(now, 24),
      now,
    });
    let stage: PrimaryStage = (text(opp, 'primary_stage') as PrimaryStage) || 'QUALIFYING';
    if (input.state === 'PREAPPROVED' || input.state === 'FINANCING_READY') {
      stage = 'CONSULT_READY';
      markReadiness(db, opp.id, 'financing', 'ready', `${input.state} confirmed by ${input.confirmation}.`, now);
      draftConsult(db, opp, input.state === 'FINANCING_READY' ? 'financing_ready' : 'financing_ready', now);
    }
    const nextAction = stage === 'CONSULT_READY'
      ? 'Preapproval is on file. Draft a consult and start the search.'
      : 'Financing moved forward. Keep sensitive documents off SMS.';
    writePlan(db, opp.id, {
      primaryStage: stage,
      financingState: input.state,
      nextAction,
      dueAt: hoursFrom(now, 24),
      followUpTrigger: stage === 'CONSULT_READY' ? 'consult' : 'financing_update',
      now,
    });
    const saved = view(db, opp.id);
    return { applied: true, financingState: saved.financingState, stage: saved.primaryStage, live: false };
  });
}

export function setRenterTimeline(db: SqlDb, input: {
  opportunityId: string;
  leaseExpiration?: string | null;
  desiredMoveDate?: string | null;
  now?: Date;
}): { anchorDate: string; preapprovalTarget: string; consultTarget: string; searchTarget: string; touringTarget: string; offerWindowStart: string; offerWindowEnd: string; live: false } {
  const now = input.now ?? new Date();
  const opp = requireOpportunity(db, input.opportunityId);
  const anchor = earlierDate(input.leaseExpiration ?? null, input.desiredMoveDate ?? null);
  if (!anchor) throw new Error('A lease expiration or desired move date is required.');
  const row = {
    anchorDate: anchor,
    preapprovalTarget: shiftDate(anchor, -TIMELINE_LEAD_DAYS.preapproval),
    consultTarget: shiftDate(anchor, -TIMELINE_LEAD_DAYS.consult),
    searchTarget: shiftDate(anchor, -TIMELINE_LEAD_DAYS.search),
    touringTarget: shiftDate(anchor, -TIMELINE_LEAD_DAYS.touring),
    offerWindowStart: shiftDate(anchor, -TIMELINE_LEAD_DAYS.offerWindowStart),
    offerWindowEnd: shiftDate(anchor, -TIMELINE_LEAD_DAYS.offerWindowEnd),
  };
  db.run(
    `INSERT INTO reverse_timelines (
      opportunity_id, anchor_date, preapproval_target, consult_target, search_target, touring_target,
      offer_window_start, offer_window_end, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(opportunity_id) DO UPDATE SET
      anchor_date = excluded.anchor_date,
      preapproval_target = excluded.preapproval_target,
      consult_target = excluded.consult_target,
      search_target = excluded.search_target,
      touring_target = excluded.touring_target,
      offer_window_start = excluded.offer_window_start,
      offer_window_end = excluded.offer_window_end,
      updated_at = excluded.updated_at`,
    opp.id,
    row.anchorDate,
    row.preapprovalTarget,
    row.consultTarget,
    row.searchTarget,
    row.touringTarget,
    row.offerWindowStart,
    row.offerWindowEnd,
    now.toISOString(),
  );
  markReadiness(db, opp.id, 'timeline', 'ready', `Move anchor ${anchor}.`, now);
  writePlan(db, opp.id, {
    primaryStage: 'QUALIFYING',
    financingState: text(opp, 'financing_state') || 'UNKNOWN',
    nextAction: `Reverse timeline is set from ${anchor}. First target is preapproval on ${row.preapprovalTarget}.`,
    dueAt: `${row.preapprovalTarget}T14:00:00.000Z`,
    followUpTrigger: 'preapproval_target',
    now,
  });
  return { ...row, live: false };
}

export function draftConsult(db: SqlDb, opp: { id: string; clientId: string }, trigger: ConsultTrigger, now: Date): { id: string; live: false } {
  if (!CONSULT_TRIGGERS.includes(trigger)) throw new Error('Unknown consult trigger.');
  if (isOpportunityDoNotContact(db, opp.id)) return { id: '', live: false };
  const existing = db.get(
    `SELECT id FROM consult_requests WHERE opportunity_id = ? AND trigger_name = ?`,
    opp.id,
    trigger,
  );
  if (existing) return { id: text(existing, 'id'), live: false };
  const reason = consultReason(trigger);
  const body = `A consult is the useful next step because ${reason}. What day this week works for a 20 minute call?`;
  const screened = screenOutreach(body, 'sms');
  if (!screened.allowed) throw new Error(screened.reason);
  const id = randomUUID();
  db.run(
    `INSERT INTO consult_requests (id, opportunity_id, client_id, trigger_name, status, draft_body, live, created_at)
     VALUES (?, ?, ?, ?, 'draft', ?, 0, ?)`,
    id,
    opp.id,
    opp.clientId,
    trigger,
    body,
    now.toISOString(),
  );
  db.run(`UPDATE consult_requests SET created_by = 'system', updated_at = ? WHERE id = ?`, now.toISOString(), id);
  return { id, live: false };
}

export function requestConsult(db: SqlDb, input: { opportunityId: string; trigger: ConsultTrigger; now?: Date }): { id: string; status: string; live: false } {
  const now = input.now ?? new Date();
  const opp = requireOpportunity(db, input.opportunityId);
  const drafted = draftConsult(db, opp, input.trigger, now);
  if (input.trigger === 'home_to_sell') linkSellerOpportunity(db, opp.id, 'home_to_sell', now);
  const stage = text(opp, 'primary_stage');
  writePlan(db, opp.id, {
    primaryStage: stage === 'NEW_INQUIRY' || stage === '' ? 'CONSULT_READY' : (stage as PrimaryStage),
    financingState: text(opp, 'financing_state') || 'UNKNOWN',
    nextAction: 'Consult request is a draft. Kyle sends it only if he approves.',
    dueAt: hoursFrom(now, 24),
    followUpTrigger: 'consult',
    now,
  });
  return { id: drafted.id, status: 'draft', live: false };
}

export function noteBudgetHint(db: SqlDb, input: {
  opportunityId: string;
  hintedValue: string;
  evidence: string;
  now?: Date;
}): { budgetChanged: false; question: string; live: false } {
  const now = input.now ?? new Date();
  const opp = requireOpportunity(db, input.opportunityId);
  const verified = db.get(
    `SELECT value FROM client_facts WHERE client_id = ? AND field_key = 'budget' AND kind = 'fact' AND verification = 'verified'`,
    opp.clientId,
  );
  const kept = text(verified, 'value');
  const question = kept
    ? `Your confirmed range is ${kept}. Should I keep that, or has it changed?`
    : 'What price range should I use? I will not change it from browsing alone.';
  const screened = screenOutreach(question, 'sms');
  if (!screened.allowed) throw new Error(screened.reason);
  db.run(
    `INSERT INTO intake_answers (opportunity_id, field_key, value, status, confirmation, updated_at)
     VALUES (?, 'budget_hint', ?, 'missing', NULL, ?)
     ON CONFLICT(opportunity_id, field_key) DO UPDATE SET value = excluded.value, status = 'missing', updated_at = excluded.updated_at`,
    opp.id,
    `${input.hintedValue} | ${input.evidence}`,
    now.toISOString(),
  );
  writePlan(db, opp.id, {
    primaryStage: (text(opp, 'primary_stage') as PrimaryStage) || 'QUALIFYING',
    financingState: text(opp, 'financing_state') || 'UNKNOWN',
    nextAction: question,
    dueAt: hoursFrom(now, 4),
    followUpTrigger: 'budget_confirmation',
    now,
  });
  return { budgetChanged: false, question, live: false };
}

export function recordCustomerMessage(db: SqlDb, input: {
  opportunityId: string;
  text: string;
  now?: Date;
}): { handoffId: string | null; level: number; approvalRequired: boolean; question: string | null; live: false } {
  const now = input.now ?? new Date();
  const opp = requireOpportunity(db, input.opportunityId);
  const handoff = detectHandoff(input.text);
  if (handoff.needed) {
    const card = writeHandoff(db, opp, handoff.reason, handoff.level, input.text, now);
    return { handoffId: card.id, level: handoff.level, approvalRequired: true, question: null, live: false };
  }
  if (/\b(viewed|clicked|opened|looking at)\b/i.test(input.text) && /\d/.test(input.text)) {
    const hint = noteBudgetHint(db, {
      opportunityId: opp.id,
      hintedValue: input.text,
      evidence: 'Behavior hint. Not a confirmed budget.',
      now,
    });
    return { handoffId: null, level: 0, approvalRequired: true, question: hint.question, live: false };
  }
  return { handoffId: null, level: 0, approvalRequired: false, question: selectQuestion(db, opp.id)?.question ?? null, live: false };
}

export function nextBestAction(db: SqlDb, opportunityId: string, now = new Date()): NextBestAction {
  const opp = requireOpportunity(db, opportunityId);
  const handoff = db.get(
    `SELECT * FROM handoff_cards WHERE opportunity_id = ? ORDER BY created_at DESC`,
    opportunityId,
  );
  const stage = text(opp, 'primary_stage') || 'NEW_INQUIRY';
  const sellerStage = text(opp, 'seller_stage');
  const financing = text(opp, 'financing_state') || 'UNKNOWN';
  const evidence = [
    `stage ${stage}`,
    sellerStage ? `seller_stage ${sellerStage}` : 'no seller stage',
    `financing ${financing}`,
    text(opp, 'follow_up_trigger') ? `trigger ${text(opp, 'follow_up_trigger')}` : 'no trigger',
    text(opp, 'next_action') ? `plan ${text(opp, 'next_action')}` : 'no plan text',
  ];
  let bucket: PriorityBucket = 'THIS_WEEK';
  let score = 40;
  let actionType = 'ask_next_question';
  let reason = text(opp, 'next_action') || 'Set the next buyer step.';
  let execution: NextBestAction['execution_method'] = 'draft';
  let approval = true;
  let confidence: NextBestAction['confidence'] = 'medium';
  const reasons: string[] = [];
  let tourChoice: TourChoice | null = null;
  if (stage === 'DO_NOT_CONTACT' || text(opp, 'no_action_reason') === 'DO_NOT_CONTACT') {
    bucket = 'DO_NOT_CONTACT';
    score = 0;
    actionType = 'do_not_contact';
    reason = 'Do not contact this client.';
    execution = 'none';
    approval = false;
    confidence = 'high';
    reasons.push('Stage or reason is do not contact.');
  } else if (handoff && Number(handoff.level) >= 4) {
    bucket = 'ACT_NOW';
    score = 100;
    actionType = 'kyle_handoff';
    reason = text(handoff, 'reason');
    execution = 'kyle_handoff';
    approval = true;
    confidence = 'high';
    reasons.push('Level 4 handoff is open.');
    reasons.push(text(handoff, 'summary'));
  } else if (handoff) {
    bucket = 'ACT_NOW';
    score = 90;
    actionType = 'kyle_handoff';
    reason = text(handoff, 'reason');
    execution = 'kyle_handoff';
    approval = true;
    confidence = 'high';
    reasons.push('Kyle was asked to take the conversation.');
  } else if (stage === 'UNDER_CONTRACT' || sellerStage === 'SELLER_UNDER_CONTRACT' || sellerStage === 'SELLER_CLOSING') {
    bucket = 'ACT_NOW';
    score = 98;
    actionType = 'review_closing_risk';
    reason = 'Review the closing or contract risk before any other outreach.';
    reasons.push('Closing or contract risk outranks new outreach.');
  } else if (stage === 'OFFER_READY' || sellerStage === 'SELLER_OFFER_REVIEW') {
    bucket = 'ACT_NOW';
    score = 94;
    actionType = 'review_offer_with_kyle';
    reason = 'Review the offer with Kyle. Discussion does not mean the offer was submitted.';
    reasons.push('An active offer stays with Kyle.');
  } else if (financing === 'DOCUMENTS_PENDING') {
    bucket = 'TODAY';
    score = 88;
    actionType = 'financing_gap';
    reason = 'Review the financing gap before scheduling the consultation.';
    reasons.push('Financing is blocked on documents. Do not request those documents by SMS.');
  } else if (stage === 'TOURING' || sellerStage === 'SELLER_CONSULT_SCHEDULED') {
    bucket = 'TODAY';
    score = 84;
    actionType = 'confirm_appointment';
    reason = text(opp, 'next_action') || 'Confirm the appointment. A request is not a confirmed showing.';
    reasons.push('An appointment or tour is imminent.');
  } else if (text(opp, 'follow_up_trigger') === 'lender_application' && text(opp, 'next_action_due_at') && text(opp, 'next_action_due_at') <= now.toISOString()) {
    bucket = 'TODAY';
    score = 78;
    actionType = 'lender_follow_up';
    reason = text(opp, 'next_action');
    reasons.push('Lender was introduced and the application lag has passed.');
  } else if (stage === 'CONSULT_READY' || sellerStage === 'SELLER_CONSULT_READY') {
    bucket = 'TODAY';
    score = 80;
    actionType = 'draft_consult';
    reason = text(opp, 'next_action') || 'Draft the consult.';
    reasons.push('Financing or another consult trigger is ready.');
    reasons.push('The consult stays a draft.');
  } else if (stage === 'NURTURE') {
    bucket = 'NURTURE';
    score = 25;
    actionType = 'nurture_hold';
    reason = 'Keep the file in nurture until a confirmed fact changes.';
    reasons.push('Stage is nurture.');
  } else {
    tourChoice = detectTourSignal(db, opp, now);
    if (tourChoice) {
      bucket = tourChoice.bucket;
      score = tourChoice.score;
      actionType = tourChoice.actionType;
      reason = tourChoice.reason;
      confidence = tourChoice.confidence;
      reasons.push(...tourChoice.reasons);
      evidence.push(...tourChoice.evidence);
    } else if (stage === 'NEW_INQUIRY' || stage === 'QUALIFYING') {
      bucket = 'TODAY';
      score = stage === 'NEW_INQUIRY' ? 70 : 60;
      actionType = 'ask_next_question';
      reason = text(opp, 'next_action') || 'Ask the single next intake question.';
      reasons.push('Intake still has an open question or a fresh inquiry.');
    } else {
      reasons.push(`Stage ${stage} has no hotter trigger.`);
    }
  }
  if (reasons.length === 0) reasons.push('No hotter trigger was found.');
  const action: NextBestAction = {
    action_type: actionType,
    client_id: opp.clientId,
    opportunity_id: opp.id,
    reason,
    evidence,
    urgency: bucket,
    confidence,
    execution_method: execution,
    approval_required: approval,
    deadline: text(opp, 'next_action_due_at') || null,
    expected_outcome: execution === 'kyle_handoff' ? 'Kyle decides the next human step.' : 'One draft or question is ready. Nothing is sent.',
    failure_action: 'Leave the prior confirmed facts in place and ask Kyle.',
    follow_up_trigger: tourChoice?.followUpTrigger ?? (text(opp, 'follow_up_trigger') || null),
    priority_score: score,
    priority_bucket: bucket,
    priority_reasons: reasons.slice(0, 3),
    live: false,
  };
  const existingAction = db.get(`SELECT id FROM next_best_actions WHERE opportunity_id = ? AND is_primary = 1`, opp.id);
  const params = [
    action.action_type,
    action.reason,
    JSON.stringify(action.evidence),
    action.urgency,
    action.confidence,
    action.execution_method,
    action.approval_required ? 1 : 0,
    action.deadline,
    action.expected_outcome,
    action.failure_action,
    action.follow_up_trigger,
    action.priority_score,
    action.priority_bucket,
    JSON.stringify(action.priority_reasons),
    now.toISOString(),
  ];
  if (existingAction) {
    db.run(
      `UPDATE next_best_actions SET
        action_type = ?, reason = ?, evidence_json = ?, urgency = ?, confidence = ?, execution_method = ?,
        approval_required = ?, deadline = ?, expected_outcome = ?, failure_action = ?, follow_up_trigger = ?,
        priority_score = ?, priority_bucket = ?, priority_reasons_json = ?, updated_at = ?, source = 'conversion_engine',
        created_by = 'system'
       WHERE id = ?`,
      ...params,
      text(existingAction, 'id'),
    );
  } else {
    db.run(
      `INSERT INTO next_best_actions (
        id, client_id, opportunity_id, action_type, reason, evidence_json, urgency, confidence,
        execution_method, approval_required, deadline, expected_outcome, failure_action, follow_up_trigger,
        priority_score, priority_bucket, priority_reasons_json, is_primary, live, created_at, updated_at, source, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, 'conversion_engine', 'system')`,
      randomUUID(),
      action.client_id,
      action.opportunity_id,
      ...params,
      now.toISOString(),
    );
  }
  if (tourChoice) {
    markReadiness(db, opp.id, 'tour', tourChoice.tourState, tourChoice.readinessEvidence, now);
  }
  syncIntakeSecondary(db, opp, stage, tourChoice, now);
  return action;
}

export function setDoNotContact(db: SqlDb, input: { opportunityId: string; now?: Date; source?: string }): { applied: true; live: false } {
  const now = input.now ?? new Date();
  requireOpportunity(db, input.opportunityId);
  db.run(
    `UPDATE opportunities SET
      primary_stage = 'DO_NOT_CONTACT', no_action_reason = 'DO_NOT_CONTACT',
      next_action = NULL, next_action_owner = NULL, next_action_due_at = NULL, follow_up_trigger = NULL,
      updated_at = ?
     WHERE id = ?`,
    now.toISOString(),
    input.opportunityId,
  );
  cancelPendingApprovals(db, input.opportunityId, now);
  return { applied: true, live: false };
}

export function confirmOfferSubmitted(db: SqlDb, input: {
  opportunityId: string;
  confirmation: string;
  now?: Date;
}): { applied: boolean; stage: string; live: false } {
  const now = input.now ?? new Date();
  const opp = requireOpportunity(db, input.opportunityId);
  const current = text(opp, 'primary_stage') || 'ENGAGED';
  if (input.confirmation !== 'kyle_confirmed') {
    return { applied: false, stage: current, live: false };
  }
  writePlan(db, opp.id, {
    primaryStage: 'OFFER_SUBMITTED',
    financingState: text(opp, 'financing_state') || 'UNKNOWN',
    nextAction: 'Kyle confirmed the offer was submitted. Review the file with Kyle before any further offer, negotiation, or contract step.',
    dueAt: hoursFrom(now, 4),
    followUpTrigger: 'kyle_handoff',
    now,
  });
  return { applied: true, stage: 'OFFER_SUBMITTED', live: false };
}

export function coverageGaps(db: SqlDb): string[] {
  const rows = db.all(
    `SELECT id, next_action, next_action_owner, next_action_due_at, follow_up_trigger, no_action_reason
     FROM opportunities WHERE status = 'open'`,
  );
  const gaps: string[] = [];
  for (const row of rows) {
    const hasAction = Boolean(text(row, 'next_action') && text(row, 'next_action_owner') && text(row, 'next_action_due_at') && text(row, 'follow_up_trigger'));
    const hasReason = text(row, 'no_action_reason') === 'NO_ACTION_REQUIRED' || text(row, 'no_action_reason') === 'DO_NOT_CONTACT';
    if (!hasAction && !hasReason) gaps.push(text(row, 'id'));
  }
  return gaps;
}

export function loadTimeline(db: SqlDb, opportunityId: string): Record<string, string> | null {
  const row = db.get(`SELECT * FROM reverse_timelines WHERE opportunity_id = ?`, opportunityId);
  if (!row) return null;
  return {
    anchorDate: text(row, 'anchor_date'),
    preapprovalTarget: text(row, 'preapproval_target'),
    consultTarget: text(row, 'consult_target'),
    searchTarget: text(row, 'search_target'),
    touringTarget: text(row, 'touring_target'),
    offerWindowStart: text(row, 'offer_window_start'),
    offerWindowEnd: text(row, 'offer_window_end'),
  };
}

export function linkForBuyer(db: SqlDb, buyerOpportunityId: string): { buyerOpportunityId: string; sellerOpportunityId: string } | null {
  const row = db.get(`SELECT * FROM opportunity_links WHERE buyer_opportunity_id = ?`, buyerOpportunityId);
  if (!row) return null;
  return { buyerOpportunityId: text(row, 'buyer_opportunity_id'), sellerOpportunityId: text(row, 'seller_opportunity_id') };
}

function applyAnswerEffects(db: SqlDb, opp: Opp, field: IntakeField, value: string, confirmation: Confirmation, now: Date): void {
  const lower = value.toLowerCase();
  if (field === 'motivation') markReadiness(db, opp.id, 'motivation', 'ready', value, now);
  if (field === 'timeframe') markReadiness(db, opp.id, 'timeline', 'ready', value, now);
  if (field === 'occupancy') {
    setClassification(db, { opportunityId: opp.id, axis: 'occupancy', value, confirmation, source: 'intake', now });
  }
  if (field === 'cash_vs_finance') {
    const financingType = /cash/.test(lower) ? 'cash' : 'finance';
    setClassification(db, { opportunityId: opp.id, axis: 'financing_type', value: financingType, confirmation, source: 'intake', now });
    if (financingType === 'cash') {
      db.run(
        `INSERT INTO intake_answers (opportunity_id, field_key, value, status, confirmation, updated_at)
         VALUES (?, 'preapproval', 'not_applicable', 'not_applicable', ?, ?)
         ON CONFLICT(opportunity_id, field_key) DO UPDATE SET status = 'not_applicable', value = 'not_applicable', updated_at = excluded.updated_at`,
        opp.id,
        confirmation,
        now.toISOString(),
      );
      db.run(`UPDATE opportunities SET financing_state = 'CASH' WHERE id = ?`, opp.id);
      markReadiness(db, opp.id, 'financing', 'ready', 'Cash stated by a confirmed answer.', now);
    }
  }
  if (field === 'current_home' && /rent/.test(lower)) {
    setClassification(db, { opportunityId: opp.id, axis: 'dependency', value: 'renter', confirmation, source: 'intake', now });
    db.run(
      `INSERT INTO intake_answers (opportunity_id, field_key, value, status, confirmation, updated_at)
       VALUES (?, 'sale_dependency', 'not_applicable', 'not_applicable', ?, ?)
       ON CONFLICT(opportunity_id, field_key) DO UPDATE SET status = 'not_applicable', updated_at = excluded.updated_at`,
      opp.id,
      confirmation,
      now.toISOString(),
    );
  }
  if (field === 'current_home' && /own/.test(lower) && !/rent/.test(lower)) {
    setClassification(db, { opportunityId: opp.id, axis: 'dependency', value: 'homeowner_no_sale', confirmation, source: 'intake', now });
  }
  for (const dependency of saleDependencyValues(lower)) {
    if (field === 'sale_dependency') {
      setClassification(db, { opportunityId: opp.id, axis: 'dependency', value: dependency, confirmation, source: 'intake', now });
    }
  }
  if (/relocat/.test(lower)) requestConsult(db, { opportunityId: opp.id, trigger: 'relocation', now });
  if (/investor|investment/.test(lower)) requestConsult(db, { opportunityId: opp.id, trigger: 'investor', now });
  if (field === 'motivation' && /tour/.test(lower)) requestConsult(db, { opportunityId: opp.id, trigger: 'tour_request', now });
}

function linkSellerOpportunity(db: SqlDb, buyerOpportunityId: string, reason: string, now: Date): string {
  const existing = linkForBuyer(db, buyerOpportunityId);
  if (existing) return existing.sellerOpportunityId;
  const buyer = requireOpportunity(db, buyerOpportunityId);
  const sellerId = randomUUID();
  const nowIso = now.toISOString();
  const due = hoursFrom(now, 24);
  db.run(
    `INSERT INTO opportunities (
      id, client_id, contact_id, business_line, stage, status, source_label, is_demo, created_at, updated_at,
      next_action, next_action_owner, next_action_due_at, follow_up_trigger, no_action_reason, primary_stage, financing_state, seller_stage
    ) VALUES (?, ?, ?, 'redfin_seller', 'new', 'open', 'linked_from_buyer', ?, ?, ?, ?, ?, ?, 'seller_intake', NULL, 'NEW_INQUIRY', NULL, 'SELLER_NEW')`,
    sellerId,
    buyer.clientId,
    buyer.contactId,
    Number(db.get(`SELECT is_demo FROM opportunities WHERE id = ?`, buyer.id)?.is_demo ?? 0),
    nowIso,
    nowIso,
    'What is the property address? Do not guess it.',
    OWNER,
    due,
  );
  db.run(
    `INSERT INTO opportunity_links (id, buyer_opportunity_id, seller_opportunity_id, reason, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, 'system')`,
    randomUUID(),
    buyer.id,
    sellerId,
    reason,
    nowIso,
  );
  markReadiness(db, buyer.id, 'home_sale', 'blocked', 'A sale is required before this purchase.', now);
  const stage = text(buyer, 'primary_stage');
  if (stage !== 'CONSULT_READY') {
    writePlan(db, buyer.id, {
      primaryStage: 'QUALIFYING',
      financingState: text(buyer, 'financing_state') || 'UNKNOWN',
      nextAction: 'A seller opportunity is linked. Confirm the home that has to sell. Search stays off until that is clear.',
      dueAt: due,
      followUpTrigger: 'seller_intake',
      now,
    });
  }
  draftConsult(db, buyer, 'home_to_sell', now);
  return sellerId;
}

function writeHandoff(db: SqlDb, opp: Opp, reason: string, level: number, summary: string, now: Date): { id: string } {
  const existing = db.get(
    `SELECT id FROM handoff_cards WHERE opportunity_id = ? AND reason = ? AND level = ?`,
    opp.id,
    reason,
    level,
  );
  if (existing) {
    db.run(`UPDATE handoff_cards SET updated_at = ? WHERE id = ?`, now.toISOString(), text(existing, 'id'));
    return { id: text(existing, 'id') };
  }
  const id = randomUUID();
  db.run(
    `INSERT INTO handoff_cards (
      id, client_id, opportunity_id, reason, level, approval_required, summary, live, created_at, updated_at, source, created_by
    ) VALUES (?, ?, ?, ?, ?, 1, ?, 0, ?, ?, 'customer_message', 'system')`,
    id,
    opp.clientId,
    opp.id,
    reason,
    level,
    summary.slice(0, 500),
    now.toISOString(),
    now.toISOString(),
  );
  writePlan(db, opp.id, {
    primaryStage: (text(db.get(`SELECT primary_stage FROM opportunities WHERE id = ?`, opp.id), 'primary_stage') as PrimaryStage) || 'ENGAGED',
    financingState: text(db.get(`SELECT financing_state FROM opportunities WHERE id = ?`, opp.id), 'financing_state') || 'UNKNOWN',
    nextAction: 'Kyle takes this. Do not submit an offer or answer a legal, commission, or contract question from the desk.',
    dueAt: hoursFrom(now, 1),
    followUpTrigger: 'kyle_handoff',
    now,
  });
  return { id };
}

const TOUR_RECENT_MS = 14 * 24 * 60 * 60 * 1000;

interface TourChoice {
  actionType: 'confirm_tour_details' | 'respond_to_tour_request' | 'tour_follow_up';
  tourState: 'scheduled' | 'requested' | 'unverified' | 'outcome_unknown';
  score: number;
  bucket: PriorityBucket;
  reason: string;
  reasons: string[];
  evidence: string[];
  readinessEvidence: string;
  followUpTrigger: string;
  confidence: NextBestAction['confidence'];
}

function detectTourSignal(db: SqlDb, opp: Opp, now: Date): TourChoice | null {
  const facts = db.all(
    `SELECT field_key, value, kind, verification, observed_at FROM client_facts WHERE client_id = ?`,
    opp.clientId,
  );
  const activities = db.all(
    `SELECT kind, actor, state, verified, note FROM activity_log WHERE opportunity_id = ?`,
    opp.id,
  );
  const events = db.all(
    `SELECT kind, payload_json FROM events WHERE opportunity_id = ?`,
    opp.id,
  );
  const kyleVerified = activities.some((row) => {
    const kind = text(row, 'kind');
    return (kind === 'showing_confirmed' || kind === 'event_completed')
      && Number(row.verified) === 1
      && /^kyle(\s+kleinman)?$/i.test(text(row, 'actor'));
  });
  if (kyleVerified) return null;

  let scheduled = '';
  let requested = '';
  let zeroCompleted = false;
  let coordinator = false;
  let recentInference = '';
  let inferenceHappened = false;

  for (const row of facts) {
    const field = text(row, 'field_key');
    const value = text(row, 'value');
    const kind = text(row, 'kind');
    const verification = text(row, 'verification');
    const verifiedFact = kind === 'fact' && verification === 'verified';
    if (field === 'tours_completed' && /^0+(\.0+)?$/.test(value.trim())) zeroCompleted = true;
    if (/coordinator|showing agent/i.test(value)) coordinator = true;
    if (verifiedFact && scheduledTourLanguage(field, value)) {
      scheduled = `${field}: ${value}`;
      continue;
    }
    if (tourRequestLanguage(field, value)) {
      requested = requested || `${field}: ${value}`;
      continue;
    }
    if ((kind === 'inference' || verification !== 'verified') && mentionsTour(field, value)) {
      const moment = tourMoment(value, text(row, 'observed_at'), now);
      if (moment !== null && Math.abs(now.getTime() - moment) <= TOUR_RECENT_MS) {
        recentInference = `${field}: ${value}`;
        if (claimsTourHappened(value)) inferenceHappened = true;
      }
    }
  }

  for (const row of activities) {
    const kind = text(row, 'kind');
    const state = text(row, 'state');
    const note = text(row, 'note');
    const actor = text(row, 'actor');
    if (/coordinator|showing agent/i.test(`${actor} ${note}`)) coordinator = true;
    if (kind === 'event_scheduled' && state === 'scheduled') {
      scheduled = scheduled || `Activity event_scheduled is scheduled only. ${note}`.trim();
    }
    if (kind === 'showing_requested' || state === 'requested') {
      requested = requested || `Activity ${kind} is requested only. ${note}`.trim();
    }
  }

  for (const row of events) {
    const kind = text(row, 'kind');
    const payload = text(row, 'payload_json');
    if (/coordinator|showing agent/i.test(`${kind} ${payload}`)) coordinator = true;
    if (/tour_request|showing_request/i.test(kind) || tourRequestLanguage(kind, payload)) {
      requested = requested || `Event ${kind} is a tour request.`;
    }
  }

  const guard = 'The signal does not confirm the tour, complete it, or make the file offer ready.';
  if (scheduled && scheduledTourIsStale(scheduled, now)) {
    const reasons = [
      'A past scheduled tour has no verified outcome. Post tour verification is needed.',
      'This is not a current upcoming tour, a confirmed showing, or a completed showing.',
    ];
    if (coordinator) reasons.push('A coordinator or showing-agent tour is not a tour with Kyle.');
    else reasons.push(guard);
    return {
      actionType: 'tour_follow_up',
      tourState: 'outcome_unknown',
      score: 86,
      bucket: 'TODAY',
      reason: 'Post tour verification needed. The outcome is unknown.',
      reasons,
      evidence: [`outcome unknown: ${clip(scheduled)}`],
      readinessEvidence: 'POST TOUR VERIFICATION NEEDED. OUTCOME UNKNOWN. Not confirmed and not completed.',
      followUpTrigger: 'tour_outcome',
      confidence: 'medium',
    };
  }
  if (scheduled) {
    const reasons = [
      'A tour is scheduled and still unconfirmed. Verify the date, time, address, and who is showing.',
    ];
    if (coordinator) reasons.push('A coordinator or showing-agent tour is not a tour with Kyle.');
    else reasons.push('A schedule note is not a confirmed showing.');
    if (zeroCompleted) reasons.push('Completed tours on file are 0. The file is not offer ready.');
    else reasons.push(guard);
    return {
      actionType: 'confirm_tour_details',
      tourState: 'scheduled',
      score: 82,
      bucket: 'TODAY',
      reason: 'Verify the unconfirmed tour: date, time, address, and who is showing.',
      reasons,
      evidence: [`scheduled unconfirmed: ${clip(scheduled)}`],
      readinessEvidence: 'Scheduled and unconfirmed. Not confirmed, not completed, and not offer ready.',
      followUpTrigger: 'tour_details',
      confidence: 'medium',
    };
  }
  if (requested) {
    return {
      actionType: 'respond_to_tour_request',
      tourState: 'requested',
      score: 76,
      bucket: 'TODAY',
      reason: 'A tour was requested and is not scheduled. Confirm the listing and a time before other intake.',
      reasons: [
        'A tour request is not a scheduled tour and is not confirmed.',
        'The request outranks the open intake question.',
        guard,
      ],
      evidence: [`requested only: ${clip(requested)}`],
      readinessEvidence: 'Requested only. Not scheduled, not confirmed, and not completed.',
      followUpTrigger: 'tour_request',
      confidence: 'medium',
    };
  }
  if (recentInference) {
    const reasons = [
      inferenceHappened
        ? 'A recent tour note says a tour may have happened. Kyle has not verified it.'
        : 'A recent tour note is unverified. It stays ahead of intake.',
    ];
    reasons.push(coordinator
      ? 'A coordinator or showing-agent tour is not a tour with Kyle.'
      : 'The note is not a confirmed tour with Kyle.');
    reasons.push(guard);
    return {
      actionType: 'tour_follow_up',
      tourState: 'unverified',
      score: 74,
      bucket: 'TODAY',
      reason: 'Ask how the recent tour went. One question, and Kyle has not verified it.',
      reasons,
      evidence: [`unverified recent tour: ${clip(recentInference)}`],
      readinessEvidence: coordinator
        ? 'Unverified tour note. Not confirmed, not completed, and not a tour with Kyle.'
        : 'Unverified tour note. Not confirmed and not completed.',
      followUpTrigger: 'tour_follow_up',
      confidence: 'low',
    };
  }
  return null;
}

function syncIntakeSecondary(db: SqlDb, opp: Opp, stage: string, tour: TourChoice | null, now: Date): void {
  const clear = () => {
    db.run(
      `DELETE FROM next_best_actions WHERE opportunity_id = ? AND is_primary = 0 AND source = 'intake_secondary'`,
      opp.id,
    );
  };
  if (!tour) {
    clear();
    return;
  }
  const question = selectQuestion(db, opp.id);
  if (!question) {
    clear();
    return;
  }
  const intakeScore = stage === 'QUALIFYING' ? 60 : 70;
  const reason = question.question;
  const reasons = ['Intake question stays secondary while a tour signal is the primary action.'];
  const evidence = [`secondary intake field ${question.field}`];
  const params = [
    'ask_next_question',
    reason,
    JSON.stringify(evidence),
    'TODAY',
    'medium',
    'draft',
    1,
    text(db.get(`SELECT next_action_due_at FROM opportunities WHERE id = ?`, opp.id), 'next_action_due_at') || null,
    'One intake question stays drafted behind the tour step. Nothing is sent.',
    'Leave the prior confirmed facts in place and ask Kyle.',
    'intake_answer',
    intakeScore,
    'TODAY',
    JSON.stringify(reasons),
    now.toISOString(),
  ];
  const existing = db.get(
    `SELECT id FROM next_best_actions WHERE opportunity_id = ? AND is_primary = 0 AND source = 'intake_secondary'`,
    opp.id,
  );
  if (existing) {
    db.run(
      `UPDATE next_best_actions SET
        action_type = ?, reason = ?, evidence_json = ?, urgency = ?, confidence = ?, execution_method = ?,
        approval_required = ?, deadline = ?, expected_outcome = ?, failure_action = ?, follow_up_trigger = ?,
        priority_score = ?, priority_bucket = ?, priority_reasons_json = ?, updated_at = ?, is_primary = 0, live = 0
       WHERE id = ?`,
      ...params,
      text(existing, 'id'),
    );
    return;
  }
  db.run(
    `INSERT INTO next_best_actions (
      id, client_id, opportunity_id, action_type, reason, evidence_json, urgency, confidence,
      execution_method, approval_required, deadline, expected_outcome, failure_action, follow_up_trigger,
      priority_score, priority_bucket, priority_reasons_json, is_primary, live, created_at, updated_at, source, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 'intake_secondary', 'system')`,
    randomUUID(),
    opp.clientId,
    opp.id,
    ...params,
    now.toISOString(),
  );
}

function scheduledTourIsStale(value: string, now: Date): boolean {
  const timed = value.match(/\b(20\d{2}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})\s*(am|pm)?\b/i);
  if (timed?.[1] && timed[2] && timed[3]) {
    let hour = Number(timed[2]);
    const minute = Number(timed[3]);
    const mer = (timed[4] ?? '').toLowerCase();
    if (mer === 'pm' && hour < 12) hour += 12;
    if (mer === 'am' && hour === 12) hour = 0;
    const instant = Date.parse(`${timed[1]}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`);
    return !Number.isNaN(instant) && instant < now.getTime();
  }
  const day = explicitTourMoment(value, now);
  if (day === null) return false;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return day < today;
}

function explicitTourMoment(value: string, now: Date): number | null {
  const iso = value.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso?.[1]) {
    const parsed = Date.parse(`${iso[1]}T00:00:00.000Z`);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const month = value.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\b/i);
  if (month?.[1] && month[2]) {
    const names = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const index = names.indexOf(month[1].toLowerCase().slice(0, 3));
    const day = Number(month[2]);
    if (index >= 0 && day >= 1 && day <= 31) return Date.UTC(now.getUTCFullYear(), index, day);
  }
  return null;
}

function scheduledTourLanguage(field: string, value: string): boolean {
  if (/scheduled_tour|upcoming_tour|tour_scheduled/i.test(field)) return true;
  return /upcoming tour|tour agent scheduled|scheduled tour/i.test(value);
}

function tourRequestLanguage(field: string, value: string): boolean {
  if (scheduledTourLanguage(field, value)) return false;
  if (/tour_request|showing_request/i.test(field)) return true;
  return /\btour request\b|\brequested (a |an )?tour\b|\bshowing requested\b/i.test(value);
}

function mentionsTour(field: string, value: string): boolean {
  return /\btour\b/i.test(`${field} ${value}`);
}

function claimsTourHappened(value: string): boolean {
  const lowered = value
    .toLowerCase()
    .replace(/not a completed tour/g, '')
    .replace(/not completed/g, '')
    .replace(/not a tour with kyle/g, '');
  return /\b(completed|happened|already showed|toured)\b/.test(lowered);
}

function tourMoment(value: string, observedAt: string, now: Date): number | null {
  const iso = value.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso?.[1]) {
    const parsed = Date.parse(`${iso[1]}T00:00:00.000Z`);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const month = value.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})\b/i);
  if (month?.[1] && month[2]) {
    const names = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const index = names.indexOf(month[1].toLowerCase().slice(0, 3));
    const day = Number(month[2]);
    if (index >= 0 && day >= 1 && day <= 31) return Date.UTC(now.getUTCFullYear(), index, day);
  }
  const observed = Date.parse(observedAt);
  return Number.isNaN(observed) ? null : observed;
}

function clip(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > 240 ? `${compact.slice(0, 237)}...` : compact;
}

function selectQuestion(db: SqlDb, opportunityId: string): NextQuestion | null {
  if (isOpportunityDoNotContact(db, opportunityId)) return null;
  const known = new Set(
    db.all(
      `SELECT field_key FROM intake_answers WHERE opportunity_id = ? AND status IN ('known', 'not_applicable')`,
      opportunityId,
    ).map((row) => text(row, 'field_key')),
  );
  for (const field of INTAKE_FIELDS) {
    if (known.has(field)) continue;
    return { field, question: QUESTIONS[field] };
  }
  return null;
}

function upsertHandoff(db: SqlDb, opp: Opp, input: {
  consent: string;
  applicationStatus: string;
  prequal: string;
  preapproval: string;
  introducedAt: string;
  approvedAmount?: string | null;
  expiration?: string | null;
  nextAction: string;
  dueAt: string;
  now: Date;
}): void {
  const existing = db.get(`SELECT id FROM lender_handoffs WHERE opportunity_id = ?`, opp.id);
  if (!existing) {
    db.run(
      `INSERT INTO lender_handoffs (
        id, opportunity_id, client_id, consent, application_status, prequal, preapproval, approved_amount,
        expiration, next_action, next_action_due_at, introduced_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(),
      opp.id,
      opp.clientId,
      input.consent,
      input.applicationStatus,
      input.prequal,
      input.preapproval,
      input.approvedAmount ?? null,
      input.expiration ?? null,
      input.nextAction,
      input.dueAt,
      input.introducedAt,
      input.now.toISOString(),
      input.now.toISOString(),
    );
    return;
  }
  db.run(
    `UPDATE lender_handoffs SET consent = ?, application_status = ?, prequal = ?, preapproval = ?, approved_amount = ?,
      expiration = ?, next_action = ?, next_action_due_at = ?, introduced_at = ?, updated_at = ? WHERE id = ?`,
    input.consent,
    input.applicationStatus,
    input.prequal,
    input.preapproval,
    input.approvedAmount ?? null,
    input.expiration ?? null,
    input.nextAction,
    input.dueAt,
    input.introducedAt,
    input.now.toISOString(),
    text(existing, 'id'),
  );
}

function writePlan(db: SqlDb, opportunityId: string, input: {
  primaryStage: PrimaryStage | string;
  financingState: string;
  nextAction: string;
  dueAt: string;
  followUpTrigger: string;
  now: Date;
}): void {
  if (isOpportunityDoNotContact(db, opportunityId)) return;
  const screened = screenNextAction(input.nextAction);
  if (!screened.allowed) throw new Error(screened.reason);
  db.run(
    `UPDATE opportunities SET
      primary_stage = ?, financing_state = ?, next_action = ?, next_action_owner = ?, next_action_due_at = ?,
      follow_up_trigger = ?, no_action_reason = NULL, updated_at = ?
     WHERE id = ?`,
    input.primaryStage,
    input.financingState,
    input.nextAction,
    OWNER,
    input.dueAt,
    input.followUpTrigger,
    input.now.toISOString(),
    opportunityId,
  );
}

function markReadiness(db: SqlDb, opportunityId: string, flag: ReadinessFlag, state: string, evidence: string, now: Date): void {
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

function view(db: SqlDb, opportunityId: string): BuyerView {
  const opp = requireOpportunity(db, opportunityId);
  return {
    opportunityId: opp.id,
    clientId: opp.clientId,
    primaryStage: text(opp, 'primary_stage'),
    financingState: text(opp, 'financing_state'),
    nextAction: text(opp, 'next_action'),
    owner: text(opp, 'next_action_owner'),
    dueAt: text(opp, 'next_action_due_at'),
    followUpTrigger: text(opp, 'follow_up_trigger'),
    noActionReason: text(opp, 'no_action_reason'),
    live: false,
  };
}

interface Opp {
  id: string;
  clientId: string;
  contactId: string | null;
}

function requireOpportunity(db: SqlDb, opportunityId: string): Opp & Record<string, unknown> {
  const row = db.get(`SELECT * FROM opportunities WHERE id = ?`, opportunityId);
  if (!row) throw new Error('Opportunity not found.');
  const opp = {
    ...row,
    id: text(row, 'id'),
    clientId: text(row, 'client_id'),
    contactId: text(row, 'contact_id') || null,
  };
  return opp;
}

function applicationFor(state: FinancingState): string {
  if (state === 'APPLICATION_SENT') return 'sent';
  if (state === 'APPLICATION_STARTED') return 'started';
  if (state === 'DOCUMENTS_PENDING') return 'documents_pending';
  if (state === 'PREQUALIFIED' || state === 'PREAPPROVED' || state === 'FINANCING_READY') return 'started';
  if (state === 'INTRODUCED') return 'none';
  return 'none';
}

function consultReason(trigger: ConsultTrigger): string {
  if (trigger === 'financing_ready') return 'financing is far enough along to plan the search';
  if (trigger === 'tour_request') return 'a tour is on the table and the showing is not confirmed';
  if (trigger === 'home_to_sell') return 'a current home has to be sold before the purchase';
  if (trigger === 'relocation') return 'the move depends on a relocation date';
  if (trigger === 'investor') return 'the purchase is an investment and the criteria need a working session';
  if (trigger === 'seller_consult') return 'the seller file has the address, motivation, timing, and decision makers';
  return 'the conversation is active enough to use a consult instead of more one-off texts';
}

function saleDependencyValues(lower: string): Array<'sale_required' | 'proceeds_required' | 'homeowner_no_sale'> {
  const declinesProceeds = /do not need the proceeds|don't need the proceeds|proceeds (are )?not required|no sale proceeds|without the proceeds/.test(lower);
  const needsProceeds = /(?<!do not )(?<!don't )(sale proceeds are required|proceeds are required|need the proceeds|needs the proceeds)/.test(lower);
  const mustSell = /\b(must sell|need to sell|have to sell|sell first|yes)\b/.test(lower)
    || (/\bsell\b/.test(lower) && !/\b(no|not)\b/.test(lower));
  if (declinesProceeds && mustSell) return ['sale_required'];
  if (needsProceeds && !declinesProceeds) return ['sale_required', 'proceeds_required'];
  if (mustSell) return ['sale_required'];
  if (/\b(no|not)\b/.test(lower)) return ['homeowner_no_sale'];
  return [];
}

function isConfirmation(value: string): value is Confirmation {
  return value === 'customer_confirmed' || value === 'kyle_confirmed';
}

function hoursFrom(now: Date, hours: number): string {
  return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function shiftDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function earlierDate(left: string | null, right: string | null): string | null {
  const values = [left, right].filter((value): value is string => Boolean(value && value.trim()));
  if (values.length === 0) return null;
  return values.sort()[0] ?? null;
}
