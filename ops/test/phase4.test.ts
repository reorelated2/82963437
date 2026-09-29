import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ingestCanonicalLead, listClientFacts, writeClientFact } from '../src/canonical.ts';
import { recordActivity } from '../src/conversion/activity.ts';
import { decideApproval, draftCommunication, executeApproval } from '../src/conversion/approval.ts';
import {
  confirmOfferSubmitted,
  introduceLender,
  linkForBuyer,
  nextBestAction,
  recordAnswer,
  recordCustomerMessage,
  setClassification,
  setDoNotContact,
} from '../src/conversion/engine.ts';
import { openSellerFile, recordSellerAnswer, requestSellerConsult, sellerNextQuestion } from '../src/conversion/seller.ts';
import { SELLER_STAGES } from '../src/conversion/policy.ts';
import { openDatabase } from '../src/db.ts';
import { outboundPolicy } from '../src/mode.ts';
import { createDryRunEmailProvider, createDryRunSmsProvider, createDryRunVoiceProvider } from '../src/outbound/providers.ts';
import { text } from '../src/sql.ts';

const NOW = new Date('2026-09-29T16:00:00.000Z');

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'kyleos-phase4-'));
  return openDatabase(join(dir, 'desk.sqlite'));
}

function count(db: ReturnType<typeof openDatabase>, sql: string): number {
  return Number(db.get(sql)?.n ?? 0);
}

function buyer(db: ReturnType<typeof openDatabase>, name: string, phone: string) {
  const created = ingestCanonicalLead(db, {
    idempotencyKey: `p4-${phone}`,
    source: 'webhook',
    rawText: `Name: ${name}\nPhone: ${phone}`,
    displayName: name,
    phone,
    now: NOW,
  });
  assert.ok(created.clientId);
  assert.ok(created.opportunityId);
  return { clientId: created.clientId, opportunityId: created.opportunityId };
}

test('SELLER 1 links a sale without assuming proceeds, price, or a listing', () => {
  const db = tempDb();
  const { opportunityId } = buyer(db, 'Seller One', '3055550301');
  const answer = recordAnswer(db, {
    opportunityId,
    field: 'sale_dependency',
    value: 'We must sell first but we do not need the proceeds',
    confirmation: 'customer_confirmed',
    now: NOW,
  });
  assert.equal(answer.applied, true);
  const values = classifications(db, opportunityId);
  assert.ok(values.includes('sale_required'));
  assert.equal(values.includes('proceeds_required'), false);
  const link = linkForBuyer(db, opportunityId);
  assert.ok(link);
  const seller = db.get(`SELECT business_line, primary_stage, seller_stage, next_action FROM opportunities WHERE id = ?`, link.sellerOpportunityId);
  assert.equal(text(seller, 'business_line'), 'redfin_seller');
  assert.equal(text(seller, 'primary_stage'), 'NEW_INQUIRY');
  assert.equal(text(seller, 'seller_stage'), 'SELLER_NEW');
  assert.match(text(seller, 'next_action'), /property address/i);
  assert.doesNotMatch(text(seller, 'next_action'), /\d{2,}/);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM client_facts WHERE value LIKE '%list price%' OR value LIKE '%commission%'`), 0);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM sent_messages`), 0);
  db.close();
});

test('SELLER 2 records confirmed sale proceeds without inventing a price', () => {
  const db = tempDb();
  const { opportunityId } = buyer(db, 'Seller Two', '3055550302');
  recordAnswer(db, {
    opportunityId,
    field: 'sale_dependency',
    value: 'We must sell and sale proceeds are required',
    confirmation: 'customer_confirmed',
    now: NOW,
  });
  const values = classifications(db, opportunityId);
  assert.ok(values.includes('sale_required'));
  assert.ok(values.includes('proceeds_required'));
  const link = linkForBuyer(db, opportunityId);
  assert.ok(link);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM opportunities WHERE business_line = 'redfin_seller'`), 1);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM client_facts`), 0);
  db.close();
});

test('SELLER 3 creates the seller opportunity once', () => {
  const db = tempDb();
  const { opportunityId } = buyer(db, 'Seller Three', '3055550303');
  setClassification(db, {
    opportunityId,
    axis: 'dependency',
    value: 'sale_required',
    confirmation: 'kyle_confirmed',
    source: 'kyle',
    now: NOW,
  });
  setClassification(db, {
    opportunityId,
    axis: 'dependency',
    value: 'sale_required',
    confirmation: 'kyle_confirmed',
    source: 'kyle',
    now: NOW,
  });
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM opportunity_links`), 1);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM opportunities WHERE business_line = 'redfin_seller'`), 1);
  db.close();
});

test('SELLER 4 does not invent an unknown property address', () => {
  const db = tempDb();
  const { opportunityId } = buyer(db, 'Seller Four', '3055550304');
  setClassification(db, {
    opportunityId,
    axis: 'dependency',
    value: 'sale_required',
    confirmation: 'customer_confirmed',
    source: 'customer',
    now: NOW,
  });
  const sellerId = linkForBuyer(db, opportunityId)?.sellerOpportunityId ?? '';
  const opened = openSellerFile(db, { opportunityId: sellerId, now: NOW });
  assert.equal(opened.live, false);
  assert.equal(opened.sellerStage, 'SELLER_NEW');
  const question = sellerNextQuestion(db, sellerId);
  assert.equal(question?.field, 'property_address');
  assert.equal(Array.isArray(question), false);
  const unknown = recordSellerAnswer(db, {
    opportunityId: sellerId,
    field: 'property_address',
    value: 'unknown',
    confirmation: 'customer_confirmed',
    now: NOW,
  });
  assert.equal(unknown.applied, false);
  assert.equal(unknown.inventedAddress, false);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM intake_answers WHERE opportunity_id = '${sellerId}' AND field_key = 'property_address'`), 0);
  db.close();
});

test('SELLER 5 waits for adequate facts before a seller consult', () => {
  const db = tempDb();
  const { opportunityId } = buyer(db, 'Seller Five', '3055550305');
  setClassification(db, {
    opportunityId,
    axis: 'dependency',
    value: 'sale_required',
    confirmation: 'customer_confirmed',
    source: 'customer',
    now: NOW,
  });
  const sellerId = linkForBuyer(db, opportunityId)?.sellerOpportunityId ?? '';
  openSellerFile(db, { opportunityId: sellerId, now: NOW });
  const early = requestSellerConsult(db, { opportunityId: sellerId, now: NOW });
  assert.equal(early.ready, false);
  assert.equal(early.live, false);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM consult_requests WHERE opportunity_id = '${sellerId}' AND trigger_name = 'seller_consult'`), 0);
  const answers: Array<[string, string]> = [
    ['property_address', '18 NE 1st St, Miami'],
    ['ownership', 'The buyer is on title'],
    ['motivation', 'They may move closer to family'],
    ['timing', 'Sometime next spring, not confirmed'],
    ['decision_makers', 'Both spouses have to agree'],
  ];
  for (const [field, value] of answers) {
    const saved = recordSellerAnswer(db, {
      opportunityId: sellerId,
      field: field as 'property_address',
      value,
      confirmation: 'customer_confirmed',
      now: NOW,
    });
    assert.equal(saved.applied, true);
  }
  const cma = recordSellerAnswer(db, {
    opportunityId: sellerId,
    field: 'cma_need',
    value: 'Yes, a CMA would help',
    confirmation: 'customer_confirmed',
    now: NOW,
  });
  assert.equal(cma.applied, true);
  assert.equal(text(db.get(`SELECT seller_stage FROM opportunities WHERE id = ?`, sellerId), 'seller_stage'), 'SELLER_DISCOVERY');
  assert.equal(text(db.get(`SELECT state FROM readiness_flags WHERE opportunity_id = ? AND flag = 'SELLER_CMA_READY'`, sellerId), 'state'), 'ready');
  const consult = requestSellerConsult(db, { opportunityId: sellerId, now: NOW });
  assert.equal(consult.ready, true);
  assert.equal(consult.status, 'draft');
  assert.equal(consult.live, false);
  assert.equal(text(db.get(`SELECT seller_stage FROM opportunities WHERE id = ?`, sellerId), 'seller_stage'), 'SELLER_CONSULT_READY');
  const row = db.get(`SELECT status, live FROM consult_requests WHERE opportunity_id = ? AND trigger_name = 'seller_consult'`, sellerId);
  assert.equal(text(row, 'status'), 'draft');
  assert.equal(Number(row?.live), 0);
  assert.ok(SELLER_STAGES.includes('SELLER_CONSULT_READY'));
  db.close();
});

test('APPROVAL 1 through 4 keep drafts local and honor do-not-contact', () => {
  const db = tempDb();
  const { opportunityId } = buyer(db, 'Approval', '3055550306');
  const draft = draftCommunication(db, {
    opportunityId,
    actionType: 'outbound_sms',
    channel: 'sms',
    draftContent: 'Ask Charlie whether Saturday at 11 still works for the tour.',
    reason: 'Tour time needs a human approval before any text.',
    now: NOW,
  });
  assert.equal(draft.status, 'PENDING');
  assert.equal(draft.created, true);
  assert.equal(draft.live, false);
  const unapproved = executeApproval(db, { approvalId: draft.id, recipient: '3055550306', recipientVerified: true, now: NOW });
  assert.notEqual(unapproved.status, 'sent');
  assert.equal(unapproved.status, 'blocked');
  assert.equal(unapproved.live, false);
  const approved = decideApproval(db, { approvalId: draft.id, decision: 'APPROVED', actor: 'Kyle Kleinman', now: NOW });
  assert.equal(approved.status, 'APPROVED');
  const dry = executeApproval(db, { approvalId: draft.id, recipient: '3055550306', recipientVerified: true, now: NOW });
  assert.equal(dry.status, 'dry_run');
  assert.notEqual(dry.status, 'sent');
  assert.equal(text(db.get(`SELECT status FROM approval_queue WHERE id = ?`, draft.id), 'status'), 'APPROVED');
  setDoNotContact(db, { opportunityId, now: NOW });
  const blocked = executeApproval(db, { approvalId: draft.id, recipient: '3055550306', recipientVerified: true, now: NOW });
  assert.equal(blocked.status, 'blocked');
  assert.match(blocked.reason, /DO_NOT_CONTACT/);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM sent_messages`), 0);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM communication_log WHERE live = 1`), 0);
  db.close();
});

test('PROVIDER 1 through 3 dry-run adapters cannot report a send or a completed call', () => {
  const now = NOW;
  const input = {
    recipient: '3055550307',
    body: 'Ask whether Thursday still works.',
    approvalRequired: true,
    approvalStatus: 'APPROVED',
    recipientVerified: true,
    doNotContact: false,
    riskLevel: 'standard',
    now,
  };
  const sms = createDryRunSmsProvider().send(input);
  const email = createDryRunEmailProvider().send(input);
  const voice = createDryRunVoiceProvider().send(input);
  for (const result of [sms, email, voice]) {
    assert.equal(result.live, false);
    assert.equal(result.message_id, null);
    assert.notEqual(result.status, 'sent');
    assert.notEqual(result.status, 'failed');
    assert.ok(result.status === 'dry_run' || result.status === 'not_attempted');
  }
  assert.equal(sms.channel, 'sms');
  assert.equal(email.channel, 'email');
  assert.equal(voice.channel, 'voice');
  assert.match(voice.reason, /not completed/i);
  const policy = outboundPolicy();
  assert.equal(policy.dryRun, true);
  assert.equal(policy.liveOutbound, false);
  assert.equal(policy.smsEnabled, false);
});

test('IDEMPOTENCY 1 through 3 do not duplicate the seller link, lender handoff, or pending approval', () => {
  const db = tempDb();
  const { opportunityId } = buyer(db, 'Idempotent', '3055550308');
  setClassification(db, {
    opportunityId,
    axis: 'dependency',
    value: 'sale_required',
    confirmation: 'customer_confirmed',
    source: 'customer',
    now: NOW,
  });
  setClassification(db, {
    opportunityId,
    axis: 'dependency',
    value: 'sale_required',
    confirmation: 'customer_confirmed',
    source: 'customer',
    now: NOW,
  });
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM opportunity_links`), 1);
  introduceLender(db, { opportunityId, consent: 'granted', now: NOW });
  introduceLender(db, { opportunityId, consent: 'granted', now: NOW });
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM lender_handoffs`), 1);
  const draft = {
    opportunityId,
    actionType: 'outbound_email',
    channel: 'email' as const,
    draftContent: 'Ask whether the preapproval letter is still the one dated in March.',
    reason: 'Email draft waits for Kyle.',
    now: NOW,
  };
  draftCommunication(db, draft);
  draftCommunication(db, draft);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM approval_queue WHERE action_type = 'lender_introduction'`), 1);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM approval_queue WHERE action_type = 'outbound_email' AND status = 'PENDING'`), 1);
  nextBestAction(db, opportunityId, NOW);
  nextBestAction(db, opportunityId, NOW);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM next_best_actions`), 1);
  db.close();
});

test('DATA 2 and DATA 3 keep a verified fact and open review only for a second verified claim', () => {
  const db = tempDb();
  const { clientId, opportunityId } = buyer(db, 'Data Two', '3055550309');
  const kyle = writeClientFact(db, {
    clientId,
    opportunityId,
    now: NOW,
    fact: { fieldKey: 'budget', value: '$650K', kind: 'fact', verification: 'verified', source: 'kyle' },
  });
  assert.equal(kyle.applied, true);
  const imported = writeClientFact(db, {
    clientId,
    opportunityId,
    now: NOW,
    fact: { fieldKey: 'budget', value: '$900K', kind: 'fact', verification: 'verified', source: 'import' },
  });
  assert.equal(imported.applied, false);
  assert.equal(imported.reason, 'conflict_kept');
  assert.equal(imported.keptValue, '$650K');
  assert.equal(listClientFacts(db, clientId)[0]?.value, '$650K');
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM fact_reviews`), 0);
  const conflict = writeClientFact(db, {
    clientId,
    opportunityId,
    now: NOW,
    fact: { fieldKey: 'budget', value: '$700K', kind: 'fact', verification: 'verified', source: 'customer' },
  });
  assert.equal(conflict.reason, 'conflict_kept');
  assert.equal(listClientFacts(db, clientId)[0]?.value, '$650K');
  const review = db.get(`SELECT status, kept_value, incoming_value FROM fact_reviews`);
  assert.equal(text(review, 'status'), 'open');
  assert.equal(text(review, 'kept_value'), '$650K');
  assert.equal(text(review, 'incoming_value'), '$700K');
  db.close();
});

test('offer discussion and activity states do not become confirmed human events', () => {
  const db = tempDb();
  const { opportunityId } = buyer(db, 'Offer Gate', '3055550310');
  recordCustomerMessage(db, { opportunityId, text: 'We want to make an offer today.', now: NOW });
  assert.notEqual(text(db.get(`SELECT primary_stage FROM opportunities WHERE id = ?`, opportunityId), 'primary_stage'), 'OFFER_SUBMITTED');
  const refused = confirmOfferSubmitted(db, { opportunityId, confirmation: 'customer_confirmed', now: NOW });
  assert.equal(refused.applied, false);
  assert.notEqual(refused.stage, 'OFFER_SUBMITTED');
  const accepted = confirmOfferSubmitted(db, { opportunityId, confirmation: 'kyle_confirmed', now: NOW });
  assert.equal(accepted.applied, true);
  assert.equal(accepted.stage, 'OFFER_SUBMITTED');
  const requested = recordActivity(db, { opportunityId, kind: 'showing_requested', actor: 'buyer', note: 'Saturday 11', now: NOW });
  assert.equal(requested.state, 'requested');
  assert.equal(requested.verified, false);
  const coordinator = recordActivity(db, { opportunityId, kind: 'showing_confirmed', actor: 'coordinator', now: NOW });
  assert.equal(coordinator.applied, false);
  assert.equal(coordinator.state, 'requested');
  const scheduled = recordActivity(db, { opportunityId, kind: 'event_scheduled', actor: 'system', now: NOW });
  assert.equal(scheduled.state, 'scheduled');
  const completed = recordActivity(db, { opportunityId, kind: 'event_completed', actor: 'automation', now: NOW });
  assert.equal(completed.applied, false);
  const touch = recordActivity(db, { opportunityId, kind: 'contact_touch', actor: 'coordinator', now: NOW });
  assert.equal(touch.verified, false);
  assert.match(touch.reason, /not Kyle contact/);
  assert.notEqual(text(db.get(`SELECT contact_verification FROM opportunities WHERE id = ?`, opportunityId), 'contact_verification'), 'verified');
  db.close();
});

function classifications(db: ReturnType<typeof openDatabase>, opportunityId: string): string[] {
  return db.all(`SELECT value FROM buyer_classifications WHERE opportunity_id = ? AND axis = 'dependency'`, opportunityId).map((row) => text(row, 'value'));
}
