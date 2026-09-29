import { randomUUID } from 'node:crypto';
import { claimWorkflowLock, recordCanonicalEvent, releaseWorkflowLock } from '../canonical.ts';
import { isOpportunityDoNotContact } from '../conversion/guards.ts';
import { canExecuteOutbound, gateChannel } from '../outbound/gate.ts';
import { text, transaction, type SqlDb } from '../sql.ts';
import { consentStatusLabel, isChannelOptOut, loadConsent, outboundBlockReason, suppressChannel } from './consent.ts';
import { assertDurableStatus } from './schema.ts';
import { LIVE_STATUSES, type CommChannel, type CommProviders, type ProviderReceipt } from './types.ts';

const FREQUENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_SIMULATED_PER_PURPOSE = 1;
const HUMAN_GATE = /^(offer|counteroffer|contract|commission|negotiation)\b/i;

export interface OutboundInput {
  clientId: string;
  opportunityId?: string | null;
  channel: 'sms' | 'email' | 'voice' | 'calendar';
  purpose: string;
  content: string;
  to?: string;
  subject?: string;
  startsAt?: string;
  workerId: string;
  now?: Date;
  providers: CommProviders;
}

export interface InboundInput {
  idempotencyKey: string;
  clientId: string;
  opportunityId?: string | null;
  channel: 'sms' | 'email' | 'voice';
  provider: string;
  fromAddress: string;
  content: string;
  now?: Date;
}

export interface CommResult {
  status: string;
  communicationId: string | null;
  eventId: string | null;
  live: false;
  providerCalled: boolean;
  retryable: boolean;
  retryAfterSeconds: number | null;
  reason: string;
  duplicate: boolean;
}

export function outreachPurpose(purpose: string): string {
  return `outreach:${purpose.trim()}`;
}

export function sendOutbound(db: SqlDb, input: OutboundInput): CommResult {
  return transaction(db, () => sendOutboundUnlocked(db, input));
}

export function receiveInbound(db: SqlDb, input: InboundInput): CommResult {
  return transaction(db, () => receiveInboundUnlocked(db, input));
}

function sendOutboundUnlocked(db: SqlDb, input: OutboundInput): CommResult {
  const now = input.now ?? new Date();
  const client = db.get(`SELECT id FROM clients WHERE id = ?`, input.clientId);
  if (!client) {
    return {
      status: 'rejected',
      communicationId: null,
      eventId: null,
      live: false,
      providerCalled: false,
      retryable: false,
      retryAfterSeconds: null,
      reason: 'No client exists for that send. Nothing was sent.',
      duplicate: false,
    };
  }
  const consent = loadConsent(db, input.clientId);
  const consentStatus = consentStatusLabel(consent, input.channel);
  if (HUMAN_GATE.test(input.purpose.trim())) {
    return writeBlocked(db, input, now, 'suppressed', 'human_gate', consentStatus, false, 'Offers, contracts, and commission stay with Kyle. Nothing was sent.');
  }
  const doNotContact = isOpportunityDoNotContact(db, input.opportunityId);
  if (input.channel !== 'calendar') {
    const gate = canExecuteOutbound({
      channel: gateChannel(input.channel),
      approvalRequired: true,
      approvalStatus: 'PENDING',
      recipientVerified: Boolean(input.to),
      doNotContact,
      riskLevel: 'standard',
    });
    if (gate.allowed) {
      return writeBlocked(db, input, now, 'not_attempted', 'blocked', consentStatus, false, 'Live execute is not available. Nothing was sent.');
    }
    if (doNotContact) {
      return writeBlocked(db, input, now, 'suppressed', 'blocked', consentStatus, false, gate.reason);
    }
  }
  const blocked = outboundBlockReason(consent, input.channel, input.purpose);
  if (blocked) {
    return writeBlocked(db, input, now, 'suppressed', 'blocked', consentStatus, false, blocked);
  }
  if (frequencyHit(db, input.clientId, input.purpose, now)) {
    return writeBlocked(
      db,
      input,
      now,
      'frequency_limited',
      'blocked',
      consentStatus,
      false,
      'Contact frequency limit reached for this purpose. Nothing was sent.',
    );
  }
  const lockPurpose = outreachPurpose(input.purpose);
  const claim = claimWorkflowLock(db, {
    clientId: input.clientId,
    holder: input.workerId,
    purpose: lockPurpose,
    opportunityId: input.opportunityId ?? null,
    now,
    actor: input.workerId,
  });
  if (!claim.acquired) {
    return writeBlocked(db, input, now, 'locked', 'blocked', consentStatus, false, claim.reason);
  }
  let receipt: ProviderReceipt;
  try {
    receipt = dispatch(input);
  } catch (error) {
    releaseWorkflowLock(db, { clientId: input.clientId, holder: input.workerId, purpose: lockPurpose, now });
    const reason = error instanceof Error ? error.message : 'Provider threw. Nothing was sent.';
    return writeBlocked(db, input, now, 'failed', 'failed', consentStatus, true, reason, 300);
  }
  const communicationId = randomUUID();
  const event = recordCanonicalEvent(db, {
    idempotencyKey: `comm:${communicationId}`,
    clientId: input.clientId,
    opportunityId: input.opportunityId ?? null,
    kind: `outbound_${input.channel}`,
    payload: {
      provider: receipt.provider,
      outcome: receipt.outcome,
      live: false,
      purpose: input.purpose,
    },
    now,
  });
  const status = logStatusForReceipt(receipt);
  insertLog(db, {
    communicationId,
    clientId: input.clientId,
    opportunityId: input.opportunityId ?? null,
    channel: input.channel,
    provider: receipt.provider,
    direction: 'outbound',
    purpose: input.purpose,
    content: input.content,
    status,
    consentStatus,
    approvalStatus: receipt.outcome === 'failed' ? 'failed' : 'dry_run',
    eventId: event.eventId,
    detail: receipt.reason,
    retryable: receipt.retryable,
    retryAfterSeconds: receipt.retryAfterSeconds,
    now,
  });
  releaseWorkflowLock(db, { clientId: input.clientId, holder: input.workerId, purpose: lockPurpose, now });
  return {
    status,
    communicationId,
    eventId: event.eventId,
    live: false,
    providerCalled: true,
    retryable: receipt.retryable,
    retryAfterSeconds: receipt.retryAfterSeconds,
    reason: receipt.reason,
    duplicate: false,
  };
}

function receiveInboundUnlocked(db: SqlDb, input: InboundInput): CommResult {
  const now = input.now ?? new Date();
  const client = db.get(`SELECT id FROM clients WHERE id = ?`, input.clientId);
  if (!client) {
    return {
      status: 'rejected',
      communicationId: null,
      eventId: null,
      live: false,
      providerCalled: false,
      retryable: false,
      retryAfterSeconds: null,
      reason: 'No client exists for that inbound event. Nothing was stored.',
      duplicate: false,
    };
  }
  const event = recordCanonicalEvent(db, {
    idempotencyKey: input.idempotencyKey.trim(),
    clientId: input.clientId,
    opportunityId: input.opportunityId ?? null,
    kind: input.channel === 'voice' ? 'inbound_call' : `inbound_${input.channel}`,
    payload: {
      provider: input.provider,
      from: input.fromAddress,
      channel: input.channel,
      live: false,
    },
    now,
  });
  if (event.duplicate) {
    const existing = db.get(`SELECT communication_id, status FROM communication_log WHERE event_id = ?`, event.eventId);
    return {
      status: 'duplicate',
      communicationId: existing ? text(existing, 'communication_id') : null,
      eventId: event.eventId,
      live: false,
      providerCalled: false,
      retryable: false,
      retryAfterSeconds: null,
      reason: 'That inbound event was already stored.',
      duplicate: true,
    };
  }
  const optOut = isChannelOptOut(input.content);
  if (optOut) suppressChannel(db, input.clientId, input.channel, `inbound_${input.channel}`, now);
  const consent = loadConsent(db, input.clientId);
  const communicationId = randomUUID();
  insertLog(db, {
    communicationId,
    clientId: input.clientId,
    opportunityId: input.opportunityId ?? null,
    channel: input.channel,
    provider: input.provider,
    direction: 'inbound',
    purpose: optOut ? 'opt_out' : 'inbound',
    content: input.content,
    status: 'received',
    consentStatus: consentStatusLabel(consent, input.channel),
    approvalStatus: 'not_applicable',
    eventId: event.eventId,
    detail: optOut ? 'Opt-out keyword stored. The channel is suppressed. Nothing was sent.' : 'Inbound event stored. Nothing was sent.',
    retryable: false,
    retryAfterSeconds: null,
    now,
  });
  return {
    status: 'received',
    communicationId,
    eventId: event.eventId,
    live: false,
    providerCalled: false,
    retryable: false,
    retryAfterSeconds: null,
    reason: optOut ? 'Opt-out applied. Nothing was sent.' : 'Inbound event stored. Nothing was sent.',
    duplicate: false,
  };
}

function dispatch(input: OutboundInput): ProviderReceipt {
  if (input.channel === 'sms') {
    return forceDry(input.providers.messaging.sendSms({
      to: input.to ?? '',
      body: input.content,
      clientId: input.clientId,
      purpose: input.purpose,
    }));
  }
  if (input.channel === 'email') {
    return forceDry(input.providers.email.sendEmail({
      to: input.to ?? '',
      body: input.content,
      subject: input.subject ?? input.purpose,
      clientId: input.clientId,
      purpose: input.purpose,
    }));
  }
  if (input.channel === 'voice') {
    return forceDry(input.providers.voice.placeCall({
      to: input.to ?? '',
      body: input.content,
      clientId: input.clientId,
      purpose: input.purpose,
    }));
  }
  return forceDry(input.providers.calendar.proposeEvent({
    clientId: input.clientId,
    title: input.subject ?? input.purpose,
    startsAt: input.startsAt ?? (input.now ?? new Date()).toISOString(),
    purpose: input.purpose,
  }));
}

function forceDry(receipt: ProviderReceipt): ProviderReceipt {
  if (LIVE_STATUSES.has(receipt.outcome)) {
    return {
      live: false,
      outcome: 'failed',
      provider: receipt.provider,
      receiptId: null,
      reason: 'A provider reported a live success. It was not stored.',
      retryable: false,
      retryAfterSeconds: null,
    };
  }
  return { ...receipt, live: false };
}

function frequencyHit(db: SqlDb, clientId: string, purpose: string, now: Date): boolean {
  const since = new Date(now.getTime() - FREQUENCY_WINDOW_MS).toISOString();
  const row = db.get(
    `SELECT COUNT(*) AS n FROM communication_log
     WHERE client_id = ? AND purpose = ? AND direction = 'outbound' AND status = 'simulated' AND created_at > ?`,
    clientId,
    purpose,
    since,
  );
  return Number(text(row, 'n') || 0) >= MAX_SIMULATED_PER_PURPOSE;
}

function writeBlocked(
  db: SqlDb,
  input: OutboundInput,
  now: Date,
  status: string,
  approvalStatus: string,
  consentStatus: string,
  retryable: boolean,
  reason: string,
  retryAfterSeconds: number | null = null,
): CommResult {
  const communicationId = randomUUID();
  insertLog(db, {
    communicationId,
    clientId: input.clientId,
    opportunityId: input.opportunityId ?? null,
    channel: input.channel,
    provider: providerId(input),
    direction: 'outbound',
    purpose: input.purpose,
    content: input.content,
    status,
    consentStatus,
    approvalStatus,
    eventId: null,
    detail: reason,
    retryable,
    retryAfterSeconds,
    now,
  });
  return {
    status,
    communicationId,
    eventId: null,
    live: false,
    providerCalled: false,
    retryable,
    retryAfterSeconds,
    reason,
    duplicate: false,
  };
}

function providerId(input: OutboundInput): string {
  if (input.channel === 'sms') return input.providers.messaging.id;
  if (input.channel === 'email') return input.providers.email.id;
  if (input.channel === 'voice') return input.providers.voice.id;
  return input.providers.calendar.id;
}

function logStatusForReceipt(receipt: ProviderReceipt): string {
  if (receipt.outcome === 'simulated') return 'simulated';
  if (receipt.outcome === 'failed') return 'failed';
  return 'not_attempted';
}

function insertLog(db: SqlDb, input: {
  communicationId: string;
  clientId: string;
  opportunityId: string | null;
  channel: CommChannel;
  provider: string;
  direction: 'inbound' | 'outbound';
  purpose: string;
  content: string;
  status: string;
  consentStatus: string;
  approvalStatus: string;
  eventId: string | null;
  detail: string;
  retryable: boolean;
  retryAfterSeconds: number | null;
  now: Date;
}): void {
  assertDurableStatus(input.status);
  const nowIso = input.now.toISOString();
  db.run(
    `INSERT INTO communication_log (
      communication_id, client_id, opportunity_id, channel, provider, direction, purpose, content,
      status, consent_status, approval_status, event_id, detail, retryable, retry_after_seconds, live,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    input.communicationId,
    input.clientId,
    input.opportunityId,
    input.channel,
    input.provider,
    input.direction,
    input.purpose,
    input.content,
    input.status,
    input.consentStatus,
    input.approvalStatus,
    input.eventId,
    input.detail,
    input.retryable ? 1 : 0,
    input.retryAfterSeconds,
    nowIso,
    nowIso,
  );
}
