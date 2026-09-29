import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ingestCanonicalLead } from '../src/canonical.ts';
import { claimWorkflowLock } from '../src/canonical.ts';
import { outreachPurpose, receiveInbound, sendOutbound } from '../src/comms/gateway.ts';
import { loadConsent, saveConsent } from '../src/comms/consent.ts';
import {
  createGmailProvider,
  createQuoSmsProvider,
  createSyntheticProviders,
  createTwilioSmsProvider,
  createTwilioVoiceProvider,
  createUnavailableMessagingProvider,
  createUnavailableVoiceProvider,
  createVapiProvider,
} from '../src/comms/providers.ts';
import { openDatabase } from '../src/db.ts';
import { liveChannelPermitted } from '../src/mode.ts';
import { text, type SqlDb } from '../src/sql.ts';

const NOW = new Date('2026-09-29T16:00:00.000Z');

function tempDb(): SqlDb {
  const dir = mkdtempSync(join(tmpdir(), 'kyleos-comms-'));
  return openDatabase(join(dir, 'desk.sqlite'));
}

function count(db: SqlDb, table: string): number {
  return Number(db.get(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0);
}

function seed(db: SqlDb, key = 'comm-client') {
  return ingestCanonicalLead(db, {
    idempotencyKey: key,
    source: 'test',
    rawText: 'Ada Lopez',
    displayName: 'Ada Lopez',
    phone: '(305) 555-0177',
    email: 'ada@example.com',
    now: NOW,
  });
}

function liveRows(db: SqlDb): number {
  return Number(db.get(`SELECT COUNT(*) AS n FROM communication_log WHERE live != 0`)?.n ?? 0);
}

function forbiddenRows(db: SqlDb): number {
  return Number(db.get(
    `SELECT COUNT(*) AS n FROM communication_log WHERE status IN ('sent', 'call completed', 'call_completed', 'delivered')`,
  )?.n ?? 0);
}

test('simulated outbound sms, email, and call stay non-live', () => {
  const db = tempDb();
  const client = seed(db);
  const providers = createSyntheticProviders();
  let smsCalls = 0;
  const messaging = providers.messaging;
  providers.messaging = {
    ...messaging,
    sendSms(input) {
      smsCalls += 1;
      return messaging.sendSms(input);
    },
  };
  const sms = sendOutbound(db, {
    clientId: client.clientId ?? '',
    opportunityId: client.opportunityId,
    channel: 'sms',
    purpose: 'intro',
    content: 'Hi Ada, Kyle Kleinman with Redfin. Does 5:30 work if I can get it confirmed?',
    to: '3055550177',
    workerId: 'worker-a',
    now: NOW,
    providers,
  });
  const email = sendOutbound(db, {
    clientId: client.clientId ?? '',
    opportunityId: client.opportunityId,
    channel: 'email',
    purpose: 'intro-email',
    content: 'Hi Ada, following up on the North Miami request.',
    to: 'ada@example.com',
    workerId: 'worker-a',
    now: NOW,
    providers,
  });
  const call = sendOutbound(db, {
    clientId: client.clientId ?? '',
    opportunityId: client.opportunityId,
    channel: 'voice',
    purpose: 'intro-call',
    content: 'Call script. Ask one question. Do not confirm a showing.',
    to: '3055550177',
    workerId: 'worker-a',
    now: NOW,
    providers,
  });
  assert.equal(sms.status, 'simulated');
  assert.equal(email.status, 'simulated');
  assert.equal(call.status, 'simulated');
  assert.equal(sms.live, false);
  assert.equal(email.live, false);
  assert.equal(call.live, false);
  assert.equal(smsCalls, 1);
  assert.equal(liveRows(db), 0);
  assert.equal(forbiddenRows(db), 0);
  assert.equal(count(db, 'sent_messages'), 0);
  const statuses = db.all(`SELECT channel, status, live, approval_status FROM communication_log ORDER BY channel`);
  assert.equal(statuses.length, 3);
  for (const row of statuses) {
    assert.equal(text(row, 'status'), 'simulated');
    assert.equal(Number(row.live), 0);
    assert.equal(text(row, 'approval_status'), 'dry_run');
  }
  db.close();
});

test('inbound sms and inbound call are stored once on the phase 1 event log', () => {
  const db = tempDb();
  const client = seed(db);
  const before = count(db, 'events');
  const sms = receiveInbound(db, {
    idempotencyKey: 'in-sms-1',
    clientId: client.clientId ?? '',
    opportunityId: client.opportunityId,
    channel: 'sms',
    provider: 'synthetic_sms',
    fromAddress: '3055550177',
    content: 'Yes, 5:30 works if you can get it.',
    now: NOW,
  });
  const again = receiveInbound(db, {
    idempotencyKey: 'in-sms-1',
    clientId: client.clientId ?? '',
    opportunityId: client.opportunityId,
    channel: 'sms',
    provider: 'synthetic_sms',
    fromAddress: '3055550177',
    content: 'Yes, 5:30 works if you can get it.',
    now: NOW,
  });
  const call = receiveInbound(db, {
    idempotencyKey: 'in-call-1',
    clientId: client.clientId ?? '',
    opportunityId: client.opportunityId,
    channel: 'voice',
    provider: 'synthetic_voice',
    fromAddress: '3055550177',
    content: 'Inbound call. Buyer asked about the showing. It is not confirmed.',
    now: NOW,
  });
  assert.equal(sms.status, 'received');
  assert.equal(sms.live, false);
  assert.equal(again.status, 'duplicate');
  assert.equal(again.eventId, sms.eventId);
  assert.equal(call.status, 'received');
  assert.equal(call.live, false);
  assert.equal(count(db, 'events'), before + 2);
  assert.equal(count(db, 'communication_log'), 2);
  const kinds = db.all(`SELECT kind FROM events WHERE idempotency_key IN ('in-sms-1', 'in-call-1') ORDER BY kind`);
  assert.deepEqual(kinds.map((row) => text(row, 'kind')), ['inbound_call', 'inbound_sms']);
  assert.equal(forbiddenRows(db), 0);
  assert.equal(liveRows(db), 0);
  assert.equal(count(db, 'sent_messages'), 0);
  db.close();
});

test('STOP suppresses SMS immediately and the provider is not called', () => {
  const db = tempDb();
  const client = seed(db);
  const inbound = receiveInbound(db, {
    idempotencyKey: 'stop-1',
    clientId: client.clientId ?? '',
    channel: 'sms',
    provider: 'synthetic_sms',
    fromAddress: '3055550177',
    content: 'STOP',
    now: NOW,
  });
  assert.equal(inbound.status, 'received');
  const consent = loadConsent(db, client.clientId ?? '');
  assert.equal(consent.doNotSms, true);
  assert.equal(consent.smsConsent, 'denied');
  assert.ok(consent.optOutAt);
  assert.equal(consent.sourceOfConsent, 'inbound_sms');
  let calls = 0;
  const providers = createSyntheticProviders();
  const messaging = providers.messaging;
  providers.messaging = {
    ...messaging,
    sendSms(input) {
      calls += 1;
      return messaging.sendSms(input);
    },
  };
  const outbound = sendOutbound(db, {
    clientId: client.clientId ?? '',
    channel: 'sms',
    purpose: 'follow_up',
    content: 'Just checking in.',
    to: '3055550177',
    workerId: 'worker-a',
    now: NOW,
    providers,
  });
  assert.equal(outbound.status, 'suppressed');
  assert.equal(outbound.providerCalled, false);
  assert.equal(outbound.live, false);
  assert.equal(calls, 0);
  assert.equal(forbiddenRows(db), 0);
  db.close();
});

test('UNSUBSCRIBE suppresses email', () => {
  const db = tempDb();
  const client = seed(db);
  receiveInbound(db, {
    idempotencyKey: 'unsub-1',
    clientId: client.clientId ?? '',
    channel: 'email',
    provider: 'synthetic_email',
    fromAddress: 'ada@example.com',
    content: 'UNSUBSCRIBE',
    now: NOW,
  });
  const consent = loadConsent(db, client.clientId ?? '');
  assert.equal(consent.doNotEmail, true);
  assert.equal(consent.emailConsent, 'denied');
  const providers = createSyntheticProviders();
  let calls = 0;
  const email = providers.email;
  providers.email = {
    ...email,
    sendEmail(input) {
      calls += 1;
      return email.sendEmail(input);
    },
  };
  const outbound = sendOutbound(db, {
    clientId: client.clientId ?? '',
    channel: 'email',
    purpose: 'nurture',
    content: 'A note.',
    to: 'ada@example.com',
    workerId: 'worker-a',
    now: NOW,
    providers,
  });
  assert.equal(outbound.status, 'suppressed');
  assert.equal(calls, 0);
  db.close();
});

test('an unavailable provider records a retryable failure and not a sent or completed call', () => {
  const db = tempDb();
  const client = seed(db);
  const providers = createSyntheticProviders();
  providers.messaging = createUnavailableMessagingProvider();
  providers.voice = createUnavailableVoiceProvider();
  const sms = sendOutbound(db, {
    clientId: client.clientId ?? '',
    channel: 'sms',
    purpose: 'intro',
    content: 'Hi Ada.',
    to: '3055550177',
    workerId: 'worker-a',
    now: NOW,
    providers,
  });
  const call = sendOutbound(db, {
    clientId: client.clientId ?? '',
    channel: 'voice',
    purpose: 'intro-call',
    content: 'Call script.',
    to: '3055550177',
    workerId: 'worker-a',
    now: NOW,
    providers,
  });
  assert.equal(sms.status, 'failed');
  assert.equal(sms.live, false);
  assert.equal(sms.retryable, true);
  assert.equal(sms.retryAfterSeconds, 300);
  assert.match(sms.reason, /unavailable/i);
  assert.equal(call.status, 'failed');
  assert.equal(call.retryable, true);
  assert.equal(call.retryAfterSeconds, 300);
  assert.doesNotMatch(call.reason, /call completed/i);
  assert.equal(forbiddenRows(db), 0);
  assert.equal(liveRows(db), 0);
  const rows = db.all(`SELECT status, retryable, retry_after_seconds, live FROM communication_log`);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(text(row, 'status'), 'failed');
    assert.equal(Number(row.retryable), 1);
    assert.equal(Number(row.retry_after_seconds), 300);
    assert.equal(Number(row.live), 0);
  }
  db.close();
});

test('a second worker cannot contact the same client for the same purpose', () => {
  const db = tempDb();
  const client = seed(db);
  const providers = createSyntheticProviders();
  let calls = 0;
  const messaging = providers.messaging;
  providers.messaging = {
    ...messaging,
    sendSms(input) {
      calls += 1;
      return messaging.sendSms(input);
    },
  };
  const held = claimWorkflowLock(db, {
    clientId: client.clientId ?? '',
    holder: 'worker-a',
    purpose: outreachPurpose('intro'),
    now: NOW,
  });
  assert.equal(held.acquired, true);
  const blocked = sendOutbound(db, {
    clientId: client.clientId ?? '',
    channel: 'sms',
    purpose: 'intro',
    content: 'Second worker draft.',
    to: '3055550177',
    workerId: 'worker-b',
    now: NOW,
    providers,
  });
  assert.equal(blocked.status, 'locked');
  assert.equal(blocked.providerCalled, false);
  assert.equal(blocked.live, false);
  assert.equal(calls, 0);
  db.close();
});

test('a second simulated contact for the same purpose hits the frequency limit', () => {
  const db = tempDb();
  const client = seed(db);
  const providers = createSyntheticProviders();
  let calls = 0;
  const messaging = providers.messaging;
  providers.messaging = {
    ...messaging,
    sendSms(input) {
      calls += 1;
      return messaging.sendSms(input);
    },
  };
  const first = sendOutbound(db, {
    clientId: client.clientId ?? '',
    channel: 'sms',
    purpose: 'intro',
    content: 'First simulated note.',
    to: '3055550177',
    workerId: 'worker-a',
    now: NOW,
    providers,
  });
  const second = sendOutbound(db, {
    clientId: client.clientId ?? '',
    channel: 'sms',
    purpose: 'intro',
    content: 'Second simulated note.',
    to: '3055550177',
    workerId: 'worker-a',
    now: new Date(NOW.getTime() + 60_000),
    providers,
  });
  assert.equal(first.status, 'simulated');
  assert.equal(second.status, 'frequency_limited');
  assert.equal(second.providerCalled, false);
  assert.equal(calls, 1);
  assert.equal(liveRows(db), 0);
  db.close();
});

test('provider stubs never send, including when live flags are set in the environment', () => {
  const previousMode = process.env.SYSTEM_MODE;
  const previousSms = process.env.SMS_SEND;
  const previousEmail = process.env.EMAIL_SEND;
  const previousVoice = process.env.AI_CALLING;
  process.env.SYSTEM_MODE = 'LIVE';
  process.env.SMS_SEND = 'true';
  process.env.EMAIL_SEND = 'true';
  process.env.AI_CALLING = 'true';
  try {
    assert.equal(liveChannelPermitted('sms'), false);
    assert.equal(liveChannelPermitted('email'), false);
    assert.equal(liveChannelPermitted('voice'), false);
    const sms = createTwilioSmsProvider().sendSms({ to: '3055550177', body: 'Hi', clientId: 'c', purpose: 'intro' });
    const quo = createQuoSmsProvider().sendSms({ to: '3055550177', body: 'Hi', clientId: 'c', purpose: 'intro' });
    const voice = createTwilioVoiceProvider().placeCall({ to: '3055550177', body: 'Hi', clientId: 'c', purpose: 'intro' });
    const vapi = createVapiProvider().placeCall({ to: '3055550177', body: 'Hi', clientId: 'c', purpose: 'intro' });
    const email = createGmailProvider().sendEmail({ to: 'ada@example.com', body: 'Hi', subject: 'Hi', clientId: 'c', purpose: 'intro' });
    for (const receipt of [sms, quo, voice, vapi, email]) {
      assert.equal(receipt.live, false);
      assert.equal(receipt.outcome, 'not_attempted');
      assert.equal(receipt.receiptId, null);
    }
    const db = tempDb();
    const client = seed(db);
    const providers = createSyntheticProviders();
    providers.messaging = createTwilioSmsProvider();
    providers.email = createGmailProvider();
    providers.voice = createVapiProvider();
    const throughGate = sendOutbound(db, {
      clientId: client.clientId ?? '',
      channel: 'sms',
      purpose: 'intro',
      content: 'This must not leave the machine.',
      to: '3055550177',
      workerId: 'worker-a',
      now: NOW,
      providers,
    });
    assert.equal(throughGate.status, 'not_attempted');
    assert.equal(throughGate.live, false);
    assert.equal(count(db, 'sent_messages'), 0);
    assert.equal(forbiddenRows(db), 0);
    db.close();
  } finally {
    if (previousMode === undefined) delete process.env.SYSTEM_MODE;
    else process.env.SYSTEM_MODE = previousMode;
    if (previousSms === undefined) delete process.env.SMS_SEND;
    else process.env.SMS_SEND = previousSms;
    if (previousEmail === undefined) delete process.env.EMAIL_SEND;
    else process.env.EMAIL_SEND = previousEmail;
    if (previousVoice === undefined) delete process.env.AI_CALLING;
    else process.env.AI_CALLING = previousVoice;
  }
});

test('wrong number and preferred channel are stored and block the mismatched attempt', () => {
  const db = tempDb();
  const client = seed(db);
  saveConsent(db, {
    clientId: client.clientId ?? '',
    wrongNumber: true,
    preferredChannel: 'email',
    preferredTime: 'morning',
    sourceOfConsent: 'kyle_noted',
    smsConsent: 'denied',
    now: NOW,
  });
  const consent = loadConsent(db, client.clientId ?? '');
  assert.equal(consent.wrongNumber, true);
  assert.equal(consent.preferredChannel, 'email');
  assert.equal(consent.preferredTime, 'morning');
  assert.equal(consent.sourceOfConsent, 'kyle_noted');
  const providers = createSyntheticProviders();
  let calls = 0;
  const messaging = providers.messaging;
  providers.messaging = {
    ...messaging,
    sendSms(input) {
      calls += 1;
      return messaging.sendSms(input);
    },
  };
  const outbound = sendOutbound(db, {
    clientId: client.clientId ?? '',
    channel: 'sms',
    purpose: 'intro',
    content: 'Hi',
    to: '3055550177',
    workerId: 'worker-a',
    now: NOW,
    providers,
  });
  assert.equal(outbound.status, 'suppressed');
  assert.equal(calls, 0);
  db.close();
});
