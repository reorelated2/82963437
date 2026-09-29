import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  claimWorkflowLock,
  ingestCanonicalLead,
  listClientFacts,
  releaseWorkflowLock,
  writeClientFact,
} from '../src/canonical.ts';
import { openDatabase } from '../src/db.ts';
import { sendFlags } from '../src/mode.ts';
import { text } from '../src/sql.ts';
import { intakeLead } from '../src/workflow.ts';

const NOW = new Date('2026-09-29T15:00:00.000Z');

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'kyleos-canonical-'));
  return openDatabase(join(dir, 'desk.sqlite'));
}

function count(db: ReturnType<typeof openDatabase>, table: string): number {
  return Number(db.get(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0);
}

test('system mode defaults to dry run and does not enable sends', () => {
  const flags = sendFlags();
  assert.equal(flags.liveSend, false);
  assert.equal(flags.smsSend, false);
  assert.equal(flags.emailSend, false);
  assert.equal(flags.aiCalling, false);
  const db = tempDb();
  assert.equal(text(db.get(`SELECT value FROM settings WHERE key = 'system_mode'`), 'value'), 'DRY_RUN');
  assert.equal(text(db.get(`SELECT value FROM settings WHERE key = 'live_send'`), 'value'), 'false');
  assert.equal(text(db.get(`SELECT id FROM schema_migrations WHERE id = '2026-09-29-canonical-clients'`), 'id'), '2026-09-29-canonical-clients');
  db.close();
});

test('a lead ingest creates one client, one opportunity, and one event', () => {
  const db = tempDb();
  const result = ingestCanonicalLead(db, {
    idempotencyKey: 'wh-ada-1',
    source: 'webhook',
    rawText: 'Name: Ada Lopez\nPhone: (305) 555-0177\nBudget: $650K',
    displayName: 'Ada Lopez',
    phone: '(305) 555-0177',
    now: NOW,
    facts: [{ fieldKey: 'budget', value: '$650K', kind: 'fact', verification: 'verified', source: 'webhook' }],
  });
  assert.equal(result.status, 'created');
  assert.equal(result.liveSend, false);
  assert.equal(count(db, 'clients'), 1);
  assert.equal(count(db, 'opportunities'), 1);
  assert.equal(count(db, 'events'), 1);
  assert.equal(count(db, 'sent_messages'), 0);
  const opportunity = db.get(`SELECT stage, status, business_line FROM opportunities WHERE id = ?`, result.opportunityId);
  assert.equal(text(opportunity, 'stage'), 'new');
  assert.equal(text(opportunity, 'status'), 'open');
  assert.equal(text(opportunity, 'business_line'), 'redfin_buyer');
  const facts = listClientFacts(db, result.clientId ?? '');
  assert.equal(facts[0]?.value, '$650K');
  assert.equal(facts[0]?.verification, 'verified');
  db.close();
});

test('the same webhook is stored once', () => {
  const db = tempDb();
  const input = {
    idempotencyKey: 'wh-once',
    source: 'webhook',
    rawText: 'Name: Ada Lopez\nPhone: (305) 555-0177',
    displayName: 'Ada Lopez',
    phone: '3055550177',
    now: NOW,
  };
  const first = ingestCanonicalLead(db, input);
  const second = ingestCanonicalLead(db, { ...input, rawText: 'Name: Ada Lopez\nPhone: (305) 555-0177' });
  assert.equal(first.status, 'created');
  assert.equal(second.status, 'duplicate');
  assert.equal(second.clientId, first.clientId);
  assert.equal(second.opportunityId, first.opportunityId);
  assert.equal(second.eventId, first.eventId);
  assert.equal(count(db, 'clients'), 1);
  assert.equal(count(db, 'opportunities'), 1);
  assert.equal(count(db, 'events'), 1);
  const audits = db.all(`SELECT action FROM audit_log WHERE action = 'event_duplicate'`);
  assert.equal(audits.length, 1);
  db.close();
});

test('a later webhook attaches to the same client and does not open a second opportunity', () => {
  const db = tempDb();
  const first = ingestCanonicalLead(db, {
    idempotencyKey: 'wh-ada-a',
    source: 'webhook',
    rawText: 'first',
    displayName: 'Ada Lopez',
    phone: '(305) 555-0177',
    now: NOW,
  });
  const second = ingestCanonicalLead(db, {
    idempotencyKey: 'wh-ada-b',
    source: 'webhook',
    rawText: 'second note',
    displayName: 'Ada Lopez',
    phone: '305-555-0177',
    now: NOW,
  });
  assert.equal(second.status, 'attached');
  assert.equal(second.clientId, first.clientId);
  assert.equal(second.opportunityId, first.opportunityId);
  assert.equal(count(db, 'clients'), 1);
  assert.equal(count(db, 'opportunities'), 1);
  assert.equal(count(db, 'events'), 2);
  db.close();
});

test('an inference cannot overwrite a verified fact', () => {
  const db = tempDb();
  const created = ingestCanonicalLead(db, {
    idempotencyKey: 'wh-fact',
    source: 'webhook',
    rawText: 'Budget: $650K',
    displayName: 'Ada Lopez',
    phone: '(305) 555-0199',
    now: NOW,
    facts: [{ fieldKey: 'budget', value: '$650K', kind: 'fact', verification: 'verified', source: 'client said and Kyle confirmed' }],
  });
  const blocked = writeClientFact(db, {
    clientId: created.clientId ?? '',
    opportunityId: created.opportunityId,
    now: NOW,
    fact: { fieldKey: 'budget', value: '$700K', kind: 'inference', verification: 'unverified', source: 'model guess' },
  });
  assert.equal(blocked.applied, false);
  assert.equal(blocked.reason, 'inference_blocked');
  assert.equal(blocked.keptValue, '$650K');
  const facts = listClientFacts(db, created.clientId ?? '');
  assert.equal(facts.length, 1);
  assert.equal(facts[0]?.value, '$650K');
  assert.equal(facts[0]?.verification, 'verified');
  const audit = db.get(`SELECT action, before_json, after_json FROM audit_log WHERE action = 'fact_inference_rejected'`);
  assert.equal(text(audit, 'action'), 'fact_inference_rejected');
  assert.match(text(audit, 'after_json'), /\$650K/);
  assert.match(text(audit, 'after_json'), /\$700K/);
  db.close();
});

test('a conflicting verified fact is kept and not silently replaced', () => {
  const db = tempDb();
  const created = ingestCanonicalLead(db, {
    idempotencyKey: 'wh-keep',
    source: 'webhook',
    rawText: 'budget',
    displayName: 'Ada Lopez',
    phone: '(305) 555-0188',
    now: NOW,
    facts: [{ fieldKey: 'budget', value: '$650K', kind: 'fact', verification: 'verified', source: 'webhook' }],
  });
  const kept = writeClientFact(db, {
    clientId: created.clientId ?? '',
    opportunityId: created.opportunityId,
    now: NOW,
    fact: { fieldKey: 'budget', value: '$700K', kind: 'fact', verification: 'verified', source: 'later webhook' },
  });
  assert.equal(kept.applied, false);
  assert.equal(kept.reason, 'conflict_kept');
  assert.equal(listClientFacts(db, created.clientId ?? '')[0]?.value, '$650K');
  db.close();
});

test('phone and email on different clients are flagged and neither client is deleted', () => {
  const db = tempDb();
  const phone = ingestCanonicalLead(db, {
    idempotencyKey: 'wh-phone',
    source: 'webhook',
    rawText: 'phone person',
    displayName: 'Ada Lopez',
    phone: '(305) 555-0101',
    now: NOW,
  });
  const email = ingestCanonicalLead(db, {
    idempotencyKey: 'wh-email',
    source: 'webhook',
    rawText: 'email person',
    displayName: 'Blake Ortiz',
    email: 'blake@example.com',
    now: NOW,
  });
  const conflict = ingestCanonicalLead(db, {
    idempotencyKey: 'wh-conflict',
    source: 'webhook',
    rawText: 'both',
    displayName: 'Someone Else',
    phone: '(305) 555-0101',
    email: 'blake@example.com',
    now: NOW,
  });
  assert.equal(conflict.status, 'flagged');
  assert.equal(conflict.clientId, null);
  assert.deepEqual(conflict.flaggedClientIds.sort(), [phone.clientId, email.clientId].sort());
  assert.equal(count(db, 'clients'), 2);
  assert.equal(text(db.get(`SELECT display_name FROM clients WHERE id = ?`, phone.clientId), 'display_name'), 'Ada Lopez');
  assert.equal(text(db.get(`SELECT display_name FROM clients WHERE id = ?`, email.clientId), 'display_name'), 'Blake Ortiz');
  assert.equal(text(db.get(`SELECT duplicate_of_client_id FROM clients WHERE id = ?`, phone.clientId), 'duplicate_of_client_id'), '');
  assert.equal(count(db, 'identity_flags'), 1);
  assert.equal(count(db, 'events'), 3);
  db.close();
});

test('a name-only webhook does not create or destroy a client', () => {
  const db = tempDb();
  const created = ingestCanonicalLead(db, {
    idempotencyKey: 'wh-named',
    source: 'webhook',
    rawText: 'named',
    displayName: 'Elena Cruz',
    phone: '(305) 555-0133',
    now: NOW,
  });
  const flagged = ingestCanonicalLead(db, {
    idempotencyKey: 'wh-name-only',
    source: 'webhook',
    rawText: 'same name, no phone',
    displayName: 'Elena Cruz',
    now: NOW,
  });
  assert.equal(flagged.status, 'flagged');
  assert.equal(flagged.clientId, null);
  assert.equal(count(db, 'clients'), 1);
  assert.equal(text(db.get(`SELECT id FROM clients WHERE id = ?`, created.clientId), 'id'), created.clientId);
  db.close();
});

test('a workflow lock prevents a second contact claim', () => {
  const db = tempDb();
  const created = ingestCanonicalLead(db, {
    idempotencyKey: 'wh-lock',
    source: 'webhook',
    rawText: 'lock',
    displayName: 'Ada Lopez',
    phone: '(305) 555-0166',
    now: NOW,
  });
  const first = claimWorkflowLock(db, {
    clientId: created.clientId ?? '',
    holder: 'worker-a',
    opportunityId: created.opportunityId,
    now: NOW,
  });
  const second = claimWorkflowLock(db, {
    clientId: created.clientId ?? '',
    holder: 'worker-b',
    opportunityId: created.opportunityId,
    now: NOW,
  });
  assert.equal(first.acquired, true);
  assert.equal(second.acquired, false);
  assert.equal(second.holder, 'worker-a');
  assert.match(second.reason, /not granted/);
  assert.equal(count(db, 'workflow_locks'), 1);
  assert.equal(count(db, 'sent_messages'), 0);
  const denied = db.get(`SELECT action FROM audit_log WHERE action = 'workflow_lock_denied'`);
  assert.equal(text(denied, 'action'), 'workflow_lock_denied');
  const released = releaseWorkflowLock(db, { clientId: created.clientId ?? '', holder: 'worker-b', now: NOW });
  assert.equal(released.released, false);
  const ownerRelease = releaseWorkflowLock(db, { clientId: created.clientId ?? '', holder: 'worker-a', now: NOW });
  assert.equal(ownerRelease.released, true);
  const third = claimWorkflowLock(db, { clientId: created.clientId ?? '', holder: 'worker-b', now: NOW });
  assert.equal(third.acquired, true);
  db.close();
});

test('desk intake creates the canonical client, opportunity, and event', () => {
  const db = tempDb();
  const first = intakeLead(db, {
    text: 'Name: Nate Alvarez\nPhone: (305) 555-0148\nBudget: $650K',
    sourceKind: 'paste',
    now: NOW,
    idempotencyKey: 'lead-1',
  });
  const second = intakeLead(db, {
    text: 'Name: Nate Alvarez\nPhone: (305) 555-0148\nBudget: $650K',
    sourceKind: 'paste',
    now: NOW,
    idempotencyKey: 'lead-1',
  });
  assert.equal(first.status, 'created');
  assert.equal(second.status, 'duplicate');
  assert.equal(count(db, 'contacts'), 1);
  assert.equal(count(db, 'clients'), 1);
  assert.equal(count(db, 'opportunities'), 1);
  assert.equal(count(db, 'events'), 1);
  assert.equal(count(db, 'sent_messages'), 0);
  const client = db.get(`SELECT contact_id, display_name FROM clients`);
  assert.equal(text(client, 'contact_id'), first.contactId);
  assert.equal(text(client, 'display_name'), 'Nate Alvarez');
  const attached = intakeLead(db, {
    text: 'Name: Nate Alvarez\nPhone: (305) 555-0148\nTimeline: 30 days',
    sourceKind: 'paste',
    now: NOW,
    idempotencyKey: 'lead-2',
  });
  assert.equal(attached.status, 'attached');
  assert.equal(count(db, 'clients'), 1);
  assert.equal(count(db, 'opportunities'), 1);
  assert.equal(count(db, 'events'), 2);
  db.close();
});

test('a desk name collision flags the existing client and does not delete it', () => {
  const db = tempDb();
  const first = intakeLead(db, {
    text: 'Name: Elena Cruz\nPhone: (305) 555-0133',
    sourceKind: 'paste',
    now: NOW,
  });
  const second = intakeLead(db, {
    text: 'Name: Elena Cruz\nProperty: a different house in Aventura',
    sourceKind: 'paste',
    now: NOW,
  });
  assert.equal(first.status, 'created');
  assert.equal(second.status, 'possible_duplicate');
  assert.equal(count(db, 'contacts'), 1);
  assert.equal(count(db, 'clients'), 1);
  assert.equal(count(db, 'identity_flags'), 1);
  assert.equal(text(db.get(`SELECT id FROM clients`), 'id') !== '', true);
  const flag = db.get(`SELECT reason, status FROM identity_flags`);
  assert.equal(text(flag, 'status'), 'open');
  assert.match(text(flag, 'reason'), /Nothing was merged/);
  db.close();
});
