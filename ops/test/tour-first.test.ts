import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { recordActivity } from '../src/conversion/activity.ts';
import { ingestCanonicalLead, recordCanonicalEvent, writeClientFact } from '../src/canonical.ts';
import { nextBestAction, openBuyerFile } from '../src/conversion/engine.ts';
import { openDatabase } from '../src/db.ts';
import { text } from '../src/sql.ts';

const NOW = new Date('2026-09-29T12:00:00.000Z');

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'kyleos-tour-'));
  return openDatabase(join(dir, 'desk.sqlite'));
}

function count(db: ReturnType<typeof openDatabase>, sql: string): number {
  return Number(db.get(sql)?.n ?? 0);
}

function openInquiry(db: ReturnType<typeof openDatabase>, name: string, phone: string) {
  const created = ingestCanonicalLead(db, {
    idempotencyKey: `tour-${phone}`,
    source: 'webhook',
    rawText: `Name: ${name}\nPhone: ${phone}`,
    displayName: name,
    phone,
    now: NOW,
  });
  assert.equal(created.status, 'created');
  assert.ok(created.clientId);
  assert.ok(created.opportunityId);
  const file = openBuyerFile(db, { opportunityId: created.opportunityId, now: NOW });
  assert.equal(file.primaryStage, 'NEW_INQUIRY');
  assert.equal(file.live, false);
  return { clientId: created.clientId, opportunityId: created.opportunityId };
}

test('a scheduled unconfirmed tour outranks the intake question', () => {
  const db = tempDb();
  const { clientId, opportunityId } = openInquiry(db, 'Fixture Scheduled', '3055550191');
  writeClientFact(db, {
    clientId,
    opportunityId,
    now: NOW,
    fact: {
      fieldKey: 'scheduled_tour_note',
      value: 'Upcoming tour agent scheduled. No clock time is on the row. Completed tours are 0.',
      kind: 'fact',
      verification: 'verified',
      source: 'redfin_agent_tools:fixture-scheduled',
    },
  });
  writeClientFact(db, {
    clientId,
    opportunityId,
    now: NOW,
    fact: {
      fieldKey: 'tours_completed',
      value: '0',
      kind: 'fact',
      verification: 'verified',
      source: 'redfin_agent_tools:fixture-scheduled',
    },
  });
  const action = nextBestAction(db, opportunityId, NOW);
  assert.equal(action.action_type, 'confirm_tour_details');
  assert.equal(action.priority_bucket, 'TODAY');
  assert.ok(action.priority_score > 70);
  assert.equal(action.approval_required, true);
  assert.equal(action.execution_method, 'draft');
  assert.equal(action.live, false);
  assert.match(action.reason, /date, time, address, and who is showing/);
  assert.ok(action.priority_reasons.some((reason) => /not confirmed|unconfirmed/i.test(reason)));
  const again = nextBestAction(db, opportunityId, NOW);
  assert.equal(again.action_type, 'confirm_tour_details');
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM next_best_actions WHERE is_primary = 1`), 1);
  const secondary = db.get(`SELECT action_type, reason, is_primary, live, approval_required, execution_method FROM next_best_actions WHERE opportunity_id = ? AND is_primary = 0`, opportunityId);
  assert.equal(text(secondary, 'action_type'), 'ask_next_question');
  assert.equal(text(secondary, 'reason'), 'What is prompting the move?');
  assert.equal(Number(secondary?.is_primary), 0);
  assert.equal(Number(secondary?.live), 0);
  assert.equal(Number(secondary?.approval_required), 1);
  assert.equal(text(secondary, 'execution_method'), 'draft');
  const tour = db.get(`SELECT state, evidence FROM readiness_flags WHERE opportunity_id = ? AND flag = 'tour'`, opportunityId);
  assert.equal(text(tour, 'state'), 'scheduled');
  assert.doesNotMatch(text(tour, 'state'), /confirmed|completed/);
  assert.match(text(tour, 'evidence'), /Not confirmed/);
  const stage = text(db.get(`SELECT primary_stage FROM opportunities WHERE id = ?`, opportunityId), 'primary_stage');
  assert.equal(stage, 'NEW_INQUIRY');
  assert.notEqual(stage, 'OFFER_READY');
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM sent_messages`), 0);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM communication_log`), 0);
  db.close();
});

test('a requested tour outranks the intake question', () => {
  const db = tempDb();
  const { clientId, opportunityId } = openInquiry(db, 'Fixture Requested', '3055550192');
  recordCanonicalEvent(db, {
    idempotencyKey: 'tour-request-fixture-0192',
    clientId,
    opportunityId,
    kind: 'tour_request',
    now: NOW,
    payload: { note: 'Tour request for a Saturday morning. Not scheduled.' },
  });
  const action = nextBestAction(db, opportunityId, NOW);
  assert.equal(action.action_type, 'respond_to_tour_request');
  assert.notEqual(action.action_type, 'ask_next_question');
  assert.equal(action.priority_bucket, 'TODAY');
  assert.ok(action.priority_score > 70);
  assert.equal(action.approval_required, true);
  assert.equal(action.execution_method, 'draft');
  assert.equal(action.live, false);
  assert.ok(action.priority_reasons.some((reason) => /not a scheduled tour/i.test(reason)));
  const tour = db.get(`SELECT state FROM readiness_flags WHERE opportunity_id = ? AND flag = 'tour'`, opportunityId);
  assert.equal(text(tour, 'state'), 'requested');
  assert.notEqual(text(tour, 'state'), 'scheduled');
  assert.notEqual(text(tour, 'state'), 'confirmed');
  assert.notEqual(text(tour, 'state'), 'completed');
  const secondary = db.get(`SELECT action_type, reason, is_primary FROM next_best_actions WHERE opportunity_id = ? AND is_primary = 0`, opportunityId);
  assert.equal(text(secondary, 'action_type'), 'ask_next_question');
  assert.equal(text(secondary, 'reason'), 'What is prompting the move?');
  assert.equal(text(db.get(`SELECT primary_stage FROM opportunities WHERE id = ?`, opportunityId), 'primary_stage'), 'NEW_INQUIRY');
  db.close();
});

test('a coordinator completion stays not with Kyle and not offer ready', () => {
  const db = tempDb();
  const { clientId, opportunityId } = openInquiry(db, 'Fixture Coordinator', '3055550193');
  const refused = recordActivity(db, {
    opportunityId,
    kind: 'event_completed',
    actor: 'Pat Example coordinator',
    note: 'Coordinator says the showing already happened.',
    now: NOW,
  });
  assert.equal(refused.applied, false);
  assert.equal(refused.verified, false);
  writeClientFact(db, {
    clientId,
    opportunityId,
    now: NOW,
    fact: {
      fieldKey: 'coordinator_tour',
      value: '2026-09-27 tour completed with coordinator Pat Example. Not verified with Kyle.',
      kind: 'inference',
      verification: 'unverified',
      source: 'desk',
    },
  });
  const action = nextBestAction(db, opportunityId, NOW);
  assert.equal(action.action_type, 'tour_follow_up');
  assert.equal(action.priority_bucket, 'TODAY');
  assert.ok(action.priority_score > 70);
  assert.equal(action.approval_required, true);
  assert.equal(action.execution_method, 'draft');
  assert.equal(action.live, false);
  assert.ok(action.priority_reasons.some((reason) => /not a tour with Kyle/i.test(reason)));
  const tour = db.get(`SELECT state, evidence FROM readiness_flags WHERE opportunity_id = ? AND flag = 'tour'`, opportunityId);
  assert.equal(text(tour, 'state'), 'unverified');
  assert.notEqual(text(tour, 'state'), 'confirmed');
  assert.notEqual(text(tour, 'state'), 'completed');
  assert.match(text(tour, 'evidence'), /not a tour with Kyle/i);
  const stage = text(db.get(`SELECT primary_stage FROM opportunities WHERE id = ?`, opportunityId), 'primary_stage');
  assert.equal(stage, 'NEW_INQUIRY');
  assert.notEqual(stage, 'OFFER_READY');
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM activity_log WHERE state IN ('confirmed', 'completed')`), 0);
  const secondary = db.get(`SELECT action_type FROM next_best_actions WHERE opportunity_id = ? AND is_primary = 0`, opportunityId);
  assert.equal(text(secondary, 'action_type'), 'ask_next_question');
  db.close();
});

test('no tour signal still returns the intake question as the primary action', () => {
  const db = tempDb();
  const { opportunityId } = openInquiry(db, 'Fixture Intake', '3055550194');
  const action = nextBestAction(db, opportunityId, NOW);
  assert.equal(action.action_type, 'ask_next_question');
  assert.equal(action.reason, 'What is prompting the move?');
  assert.equal(action.priority_score, 70);
  assert.equal(action.priority_bucket, 'TODAY');
  assert.equal(action.live, false);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM next_best_actions`), 1);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM next_best_actions WHERE is_primary = 0`), 0);
  const tour = db.get(`SELECT state FROM readiness_flags WHERE opportunity_id = ? AND flag = 'tour'`, opportunityId);
  assert.equal(text(tour, 'state'), 'unknown');
  db.close();
});
