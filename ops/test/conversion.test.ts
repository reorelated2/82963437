import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ingestCanonicalLead, listClientFacts, writeClientFact } from '../src/canonical.ts';
import {
  advanceFinancing,
  coverageGaps,
  introduceLender,
  linkForBuyer,
  loadTimeline,
  nextBestAction,
  nextQuestion,
  noteBudgetHint,
  openBuyerFile,
  recordAnswer,
  recordCustomerMessage,
  requestConsult,
  reviewLenderLeakage,
  setClassification,
  setRenterTimeline,
} from '../src/conversion/engine.ts';
import {
  BANNED_PHRASES,
  FINANCING_STATES,
  LENDER_APPLICATION_LAG_MS,
  PRIMARY_STAGES,
  QUESTIONS,
  READINESS_FLAGS,
  TIMELINE_LEAD_DAYS,
  screenOutreach,
} from '../src/conversion/policy.ts';
import { openDatabase } from '../src/db.ts';
import { text } from '../src/sql.ts';

const NOW = new Date('2026-09-29T16:00:00.000Z');

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'kyleos-conversion-'));
  return openDatabase(join(dir, 'desk.sqlite'));
}

function count(db: ReturnType<typeof openDatabase>, sql: string): number {
  return Number(db.get(sql)?.n ?? 0);
}

function openInquiry(db: ReturnType<typeof openDatabase>, name: string, phone: string) {
  const created = ingestCanonicalLead(db, {
    idempotencyKey: `conv-${phone}`,
    source: 'webhook',
    rawText: `Name: ${name}\nPhone: ${phone}`,
    displayName: name,
    phone,
    now: NOW,
  });
  assert.equal(created.status, 'created');
  assert.equal(created.liveSend, false);
  assert.ok(created.clientId);
  assert.ok(created.opportunityId);
  const file = openBuyerFile(db, { opportunityId: created.opportunityId, now: NOW });
  return { clientId: created.clientId, opportunityId: created.opportunityId, file };
}

function shiftDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test('buyer stages, readiness flags, and financing states match the desk model', () => {
  assert.deepEqual([...PRIMARY_STAGES], [
    'NEW_INQUIRY',
    'CONTACT_ATTEMPTED',
    'ENGAGED',
    'QUALIFYING',
    'CONSULT_READY',
    'SEARCH_ACTIVE',
    'TOURING',
    'OFFER_READY',
    'OFFER_SUBMITTED',
    'UNDER_CONTRACT',
    'CLOSED',
    'PAST_CLIENT',
    'NURTURE',
    'LOST',
    'DO_NOT_CONTACT',
  ]);
  assert.deepEqual([...READINESS_FLAGS], [
    'contact',
    'motivation',
    'timeline',
    'financing',
    'representation',
    'search',
    'tour',
    'offer',
    'home_sale',
    'decision_maker',
  ]);
  assert.deepEqual([...FINANCING_STATES], [
    'UNKNOWN',
    'CASH',
    'INTRODUCED',
    'APPLICATION_SENT',
    'APPLICATION_STARTED',
    'DOCUMENTS_PENDING',
    'PREQUALIFIED',
    'PREAPPROVED',
    'FINANCING_READY',
  ]);
});

test('BUYER 1 moves from a new inquiry through lender handoff to consult-ready without contact', () => {
  const db = tempDb();
  const { opportunityId, file } = openInquiry(db, 'Buyer One', '3055550101');
  assert.equal(file.primaryStage, 'NEW_INQUIRY');
  assert.equal(file.financingState, 'UNKNOWN');
  assert.equal(file.live, false);
  assert.equal(file.owner, 'Kyle Kleinman');
  assert.ok(file.nextAction);
  assert.ok(file.dueAt);
  assert.equal(file.followUpTrigger, 'intake_answer');

  const first = nextQuestion(db, opportunityId);
  assert.ok(first);
  assert.equal(Array.isArray(first), false);
  assert.equal(first.field, 'motivation');
  assert.equal(first.question, QUESTIONS.motivation);

  const introduced = introduceLender(db, { opportunityId, consent: 'granted', now: NOW });
  assert.equal(introduced.financingState, 'INTRODUCED');
  assert.equal(introduced.live, false);
  const handoff = db.get(`SELECT * FROM lender_handoffs WHERE opportunity_id = ?`, opportunityId);
  assert.equal(text(handoff, 'consent'), 'granted');
  assert.equal(text(handoff, 'application_status'), 'none');
  assert.equal(text(handoff, 'preapproval'), 'no');
  assert.match(text(handoff, 'next_action'), /Do not ask for tax returns/i);

  const early = reviewLenderLeakage(db, opportunityId, new Date(NOW.getTime() + LENDER_APPLICATION_LAG_MS - 1));
  assert.equal(early.due, false);
  const late = reviewLenderLeakage(db, opportunityId, new Date(NOW.getTime() + LENDER_APPLICATION_LAG_MS));
  assert.equal(late.due, true);
  assert.equal(late.live, false);
  assert.match(late.action, /no application is on file/i);
  assert.equal(screenOutreach(late.action, 'sms').allowed, true);

  const pending = advanceFinancing(db, {
    opportunityId,
    state: 'DOCUMENTS_PENDING',
    confirmation: 'customer_confirmed',
    now: NOW,
  });
  assert.equal(pending.applied, true);
  assert.equal(pending.financingState, 'DOCUMENTS_PENDING');
  assert.equal(text(db.get(`SELECT application_status FROM lender_handoffs WHERE opportunity_id = ?`, opportunityId), 'application_status'), 'documents_pending');
  assert.doesNotMatch(text(db.get(`SELECT next_action FROM opportunities WHERE id = ?`, opportunityId), 'next_action'), /tax return|w-2|bank statement|ssn/i);

  const ready = advanceFinancing(db, {
    opportunityId,
    state: 'PREAPPROVED',
    confirmation: 'customer_confirmed',
    approvedAmount: '$640000',
    expiration: '2026-12-15',
    now: NOW,
  });
  assert.equal(ready.applied, true);
  assert.equal(ready.financingState, 'PREAPPROVED');
  assert.equal(ready.stage, 'CONSULT_READY');
  assert.equal(ready.live, false);
  const consult = db.get(`SELECT status, live, trigger_name FROM consult_requests WHERE opportunity_id = ?`, opportunityId);
  assert.equal(text(consult, 'status'), 'draft');
  assert.equal(Number(consult?.live), 0);
  assert.equal(text(consult, 'trigger_name'), 'financing_ready');
  const letter = db.get(`SELECT preapproval, approved_amount, expiration FROM lender_handoffs WHERE opportunity_id = ?`, opportunityId);
  assert.equal(text(letter, 'preapproval'), 'yes');
  assert.equal(text(letter, 'approved_amount'), '$640000');
  assert.equal(text(letter, 'expiration'), '2026-12-15');

  const action = nextBestAction(db, opportunityId, NOW);
  assert.equal(action.live, false);
  assert.equal(action.action_type, 'draft_consult');
  assert.equal(action.opportunity_id, opportunityId);
  assert.equal(action.urgency, 'TODAY');
  assert.equal(action.priority_bucket, 'TODAY');
  assert.ok(action.priority_score > 0);
  assert.ok(action.priority_reasons.length >= 1);
  assert.equal(action.approval_required, true);
  assert.equal(action.execution_method, 'draft');
  assert.ok(action.expected_outcome);
  assert.ok(action.failure_action);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM next_best_actions WHERE opportunity_id = '${opportunityId}' AND is_primary = 1`), 1);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM sent_messages`), 0);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM communication_log WHERE live = 1`), 0);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM consult_requests WHERE live = 1`), 0);
  assert.deepEqual(coverageGaps(db), []);
  db.close();
});

test('BUYER 2 builds a reverse timeline from a lease that ends in four months', () => {
  const db = tempDb();
  const { opportunityId } = openInquiry(db, 'Buyer Two', '3055550102');
  const classified = setClassification(db, {
    opportunityId,
    axis: 'dependency',
    value: 'renter',
    confirmation: 'customer_confirmed',
    source: 'customer',
    now: NOW,
  });
  assert.equal(classified.applied, true);
  assert.equal(classified.live, false);
  const lease = '2027-01-29';
  const timeline = setRenterTimeline(db, { opportunityId, leaseExpiration: lease, desiredMoveDate: '2027-02-15', now: NOW });
  assert.equal(timeline.live, false);
  assert.equal(timeline.anchorDate, lease);
  assert.equal(timeline.preapprovalTarget, shiftDate(lease, -TIMELINE_LEAD_DAYS.preapproval));
  assert.equal(timeline.consultTarget, shiftDate(lease, -TIMELINE_LEAD_DAYS.consult));
  assert.equal(timeline.searchTarget, shiftDate(lease, -TIMELINE_LEAD_DAYS.search));
  assert.equal(timeline.touringTarget, shiftDate(lease, -TIMELINE_LEAD_DAYS.touring));
  assert.equal(timeline.offerWindowStart, shiftDate(lease, -TIMELINE_LEAD_DAYS.offerWindowStart));
  assert.equal(timeline.offerWindowEnd, shiftDate(lease, -TIMELINE_LEAD_DAYS.offerWindowEnd));
  const ordered = [
    timeline.preapprovalTarget,
    timeline.consultTarget,
    timeline.searchTarget,
    timeline.touringTarget,
    timeline.offerWindowStart,
    timeline.offerWindowEnd,
    timeline.anchorDate,
  ];
  assert.deepEqual([...ordered].sort(), ordered);
  const stored = loadTimeline(db, opportunityId);
  assert.equal(stored?.anchorDate, lease);
  assert.equal(linkForBuyer(db, opportunityId), null);
  assert.equal(text(db.get(`SELECT state FROM readiness_flags WHERE opportunity_id = ? AND flag = 'home_sale'`, opportunityId), 'state'), 'not_applicable');
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM sent_messages`), 0);
  db.close();
});

test('BUYER 3 links a seller opportunity when the purchase needs a sale', () => {
  const db = tempDb();
  const { opportunityId } = openInquiry(db, 'Buyer Three', '3055550103');
  const answer = recordAnswer(db, {
    opportunityId,
    field: 'sale_dependency',
    value: 'We must sell first',
    confirmation: 'customer_confirmed',
    now: NOW,
  });
  assert.equal(answer.applied, true);
  assert.equal(answer.live, false);
  assert.ok(answer.question);
  assert.equal(Array.isArray(answer.question), false);
  const link = linkForBuyer(db, opportunityId);
  assert.ok(link);
  assert.equal(link.buyerOpportunityId, opportunityId);
  assert.notEqual(link.sellerOpportunityId, opportunityId);
  const seller = db.get(`SELECT business_line, status, primary_stage, next_action, next_action_owner, next_action_due_at, follow_up_trigger FROM opportunities WHERE id = ?`, link.sellerOpportunityId);
  assert.equal(text(seller, 'business_line'), 'redfin_seller');
  assert.equal(text(seller, 'status'), 'open');
  assert.equal(text(seller, 'primary_stage'), 'NEW_INQUIRY');
  assert.ok(text(seller, 'next_action'));
  assert.equal(text(seller, 'next_action_owner'), 'Kyle Kleinman');
  assert.ok(text(seller, 'next_action_due_at'));
  assert.equal(text(seller, 'follow_up_trigger'), 'seller_intake');
  const buyer = db.get(`SELECT primary_stage FROM opportunities WHERE id = ?`, opportunityId);
  assert.notEqual(text(buyer, 'primary_stage'), 'OFFER_SUBMITTED');
  assert.notEqual(text(buyer, 'primary_stage'), 'SEARCH_ACTIVE');
  const consult = db.get(`SELECT status, live FROM consult_requests WHERE opportunity_id = ? AND trigger_name = 'home_to_sell'`, opportunityId);
  assert.equal(text(consult, 'status'), 'draft');
  assert.equal(Number(consult?.live), 0);
  const values = db.all(`SELECT value FROM buyer_classifications WHERE opportunity_id = ? AND axis = 'dependency'`, opportunityId).map((row) => text(row, 'value'));
  assert.ok(values.includes('sale_required'));
  assert.deepEqual(coverageGaps(db), []);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM sent_messages`), 0);
  db.close();
});

test('BUYER 7 asks about a higher budget instead of changing the verified range', () => {
  const db = tempDb();
  const created = ingestCanonicalLead(db, {
    idempotencyKey: 'conv-buyer-7',
    source: 'webhook',
    rawText: 'Name: Buyer Seven\nPhone: (305) 555-0107\nBudget: $650K',
    displayName: 'Buyer Seven',
    phone: '3055550107',
    now: NOW,
    facts: [{ fieldKey: 'budget', value: '$650K', kind: 'fact', verification: 'verified', source: 'webhook' }],
  });
  assert.ok(created.clientId);
  assert.ok(created.opportunityId);
  openBuyerFile(db, { opportunityId: created.opportunityId, now: NOW });
  const blocked = writeClientFact(db, {
    clientId: created.clientId,
    opportunityId: created.opportunityId,
    fact: { fieldKey: 'budget', value: '$900K', kind: 'inference', verification: 'unverified', source: 'behavior' },
    now: NOW,
  });
  assert.equal(blocked.applied, false);
  assert.equal(blocked.reason, 'inference_blocked');
  assert.equal(blocked.keptValue, '$650K');
  const hint = noteBudgetHint(db, {
    opportunityId: created.opportunityId,
    hintedValue: '$900K',
    evidence: 'Opened several listings above the confirmed range.',
    now: NOW,
  });
  assert.equal(hint.budgetChanged, false);
  assert.equal(hint.live, false);
  assert.match(hint.question, /\$650K/);
  assert.match(hint.question, /keep that, or has it changed/i);
  const message = recordCustomerMessage(db, {
    opportunityId: created.opportunityId,
    text: 'They keep looking at $900000 homes',
    now: NOW,
  });
  assert.equal(message.handoffId, null);
  assert.match(message.question ?? '', /\$650K/);
  const facts = listClientFacts(db, created.clientId);
  assert.equal(facts.filter((fact) => fact.fieldKey === 'budget').length, 1);
  assert.equal(facts[0]?.value, '$650K');
  assert.equal(facts[0]?.verification, 'verified');
  db.close();
});

test('BUYER 9 escalates offer intent to Kyle and does not submit an offer', () => {
  const db = tempDb();
  const { clientId, opportunityId } = openInquiry(db, 'Buyer Nine', '3055550109');
  const message = recordCustomerMessage(db, {
    opportunityId,
    text: 'We want to make an offer on the North Miami house today.',
    now: NOW,
  });
  assert.equal(message.live, false);
  assert.equal(message.approvalRequired, true);
  assert.equal(message.level, 4);
  assert.ok(message.handoffId);
  assert.equal(message.question, null);
  const card = db.get(`SELECT level, approval_required, live, reason FROM handoff_cards WHERE id = ?`, message.handoffId);
  assert.equal(Number(card?.level), 4);
  assert.equal(Number(card?.approval_required), 1);
  assert.equal(Number(card?.live), 0);
  assert.match(text(card, 'reason'), /Level 4/);
  const stage = text(db.get(`SELECT primary_stage FROM opportunities WHERE id = ?`, opportunityId), 'primary_stage');
  assert.notEqual(stage, 'OFFER_SUBMITTED');
  assert.notEqual(stage, 'OFFER_READY');
  const action = nextBestAction(db, opportunityId, NOW);
  assert.equal(action.action_type, 'kyle_handoff');
  assert.equal(action.client_id, clientId);
  assert.equal(action.opportunity_id, opportunityId);
  assert.equal(action.urgency, 'ACT_NOW');
  assert.equal(action.priority_bucket, 'ACT_NOW');
  assert.equal(action.priority_score, 100);
  assert.equal(action.approval_required, true);
  assert.equal(action.execution_method, 'kyle_handoff');
  assert.equal(action.live, false);
  assert.ok(action.evidence.length >= 1);
  assert.ok(action.priority_reasons.length >= 1);
  assert.equal(action.follow_up_trigger, 'kyle_handoff');
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM sent_messages`), 0);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM communication_log`), 0);
  db.close();
});

test('DATA 1 still blocks an inference from replacing a verified fact', () => {
  const db = tempDb();
  const created = ingestCanonicalLead(db, {
    idempotencyKey: 'conv-data-1',
    source: 'webhook',
    rawText: 'Name: Data One\nPhone: (305) 555-0111',
    displayName: 'Data One',
    phone: '3055550111',
    now: NOW,
    facts: [{ fieldKey: 'budget', value: '$500K', kind: 'fact', verification: 'verified', source: 'webhook' }],
  });
  assert.ok(created.clientId);
  const result = writeClientFact(db, {
    clientId: created.clientId,
    opportunityId: created.opportunityId,
    fact: { fieldKey: 'budget', value: '$800K', kind: 'inference', verification: 'unverified', source: 'model' },
    now: NOW,
  });
  assert.equal(result.reason, 'inference_blocked');
  assert.equal(listClientFacts(db, created.clientId)[0]?.value, '$500K');
  assert.equal(coverageGaps(db).length, 0);
  db.close();
});

test('the next question is one question, and cash or rent skips the fields that no longer apply', () => {
  const db = tempDb();
  const { opportunityId } = openInquiry(db, 'Buyer Intake', '3055550112');
  const order = ['motivation', 'area', 'timeframe', 'occupancy'] as const;
  for (const field of order) {
    const current = nextQuestion(db, opportunityId);
    assert.equal(current?.field, field);
    recordAnswer(db, { opportunityId, field, value: field === 'occupancy' ? 'primary' : 'stated', confirmation: 'kyle_confirmed', now: NOW });
  }
  const cashQuestion = nextQuestion(db, opportunityId);
  assert.equal(cashQuestion?.field, 'cash_vs_finance');
  const cash = recordAnswer(db, { opportunityId, field: 'cash_vs_finance', value: 'We will pay cash', confirmation: 'customer_confirmed', now: NOW });
  assert.equal(cash.question?.field, 'current_home');
  assert.equal(text(db.get(`SELECT financing_state FROM opportunities WHERE id = ?`, opportunityId), 'financing_state'), 'CASH');
  assert.equal(text(db.get(`SELECT status FROM intake_answers WHERE opportunity_id = ? AND field_key = 'preapproval'`, opportunityId), 'status'), 'not_applicable');
  const rent = recordAnswer(db, { opportunityId, field: 'current_home', value: 'We rent an apartment', confirmation: 'customer_confirmed', now: NOW });
  assert.equal(rent.question, null);
  assert.equal(text(db.get(`SELECT status FROM intake_answers WHERE opportunity_id = ? AND field_key = 'sale_dependency'`, opportunityId), 'status'), 'not_applicable');
  const rejected = setClassification(db, {
    opportunityId,
    axis: 'occupancy',
    value: 'primary',
    confirmation: 'inferred',
    source: 'demographic',
    now: NOW,
  });
  assert.equal(rejected.applied, false);
  db.close();
});

test('legal, commission, financing, frustration, and a request for Kyle each create a handoff card', () => {
  const db = tempDb();
  const cases = [
    ['This is a legal question about the clause.', 4],
    ['Who pays you and what is the commission?', 4],
    ['The lender said we cannot get approved.', 3],
    ['This is ridiculous and I am frustrated.', 3],
    ['I want Kyle on the phone.', 3],
  ] as const;
  cases.forEach(([body, level], index) => {
    const { opportunityId } = openInquiry(db, `Handoff ${index}`, `30555502${index}0`);
    const message = recordCustomerMessage(db, { opportunityId, text: body, now: NOW });
    assert.equal(message.level, level);
    assert.equal(message.approvalRequired, true);
    assert.equal(Number(db.get(`SELECT live FROM handoff_cards WHERE opportunity_id = ?`, opportunityId)?.live), 0);
    const action = nextBestAction(db, opportunityId, NOW);
    assert.equal(action.action_type, 'kyle_handoff');
    assert.equal(action.approval_required, true);
    assert.equal(action.live, false);
  });
  const consult = requestConsult(db, { opportunityId: openInquiry(db, 'Investor', '3055550299').opportunityId, trigger: 'investor', now: NOW });
  assert.equal(consult.status, 'draft');
  assert.equal(consult.live, false);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM sent_messages`), 0);
  db.close();
});

test('banned outreach phrases and sensitive borrower documents are blocked in drafts', () => {
  for (const phrase of BANNED_PHRASES) {
    const screened = screenOutreach(`Hi, ${phrase} on the house.`, 'email');
    assert.equal(screened.allowed, false);
  }
  assert.equal(screenOutreach('Please text me your tax return and bank statement.', 'sms').allowed, false);
  assert.equal(screenOutreach('Please text me your tax return and bank statement.', 'internal').allowed, true);
  for (const question of Object.values(QUESTIONS)) {
    assert.equal(screenOutreach(question, 'sms').allowed, true);
  }
  const db = tempDb();
  assert.equal(text(db.get(`SELECT id FROM schema_migrations WHERE id = '2026-09-29-conversion'`), 'id'), '2026-09-29-conversion');
  const created = ingestCanonicalLead(db, {
    idempotencyKey: 'conv-coverage',
    source: 'webhook',
    rawText: 'Name: Coverage\nPhone: (305) 555-0199',
    displayName: 'Coverage',
    phone: '3055550199',
    now: NOW,
  });
  assert.equal(text(db.get(`SELECT no_action_reason FROM opportunities WHERE id = ?`, created.opportunityId), 'no_action_reason'), 'NO_ACTION_REQUIRED');
  assert.deepEqual(coverageGaps(db), []);
  db.close();
});
