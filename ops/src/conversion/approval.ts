import { randomUUID } from 'node:crypto';
import { text, type SqlDb } from '../sql.ts';
import { createDryRunEmailProvider, createDryRunSmsProvider, createDryRunVoiceProvider, type OutboundResult } from '../outbound/providers.ts';
import { isOpportunityDoNotContact } from './guards.ts';
import { screenNextAction } from './policy.ts';

export const APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'EXECUTED', 'CANCELLED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ApprovalDraft {
  id: string;
  status: ApprovalStatus;
  created: boolean;
  live: false;
}

export function enqueueApproval(db: SqlDb, input: {
  opportunityId: string;
  clientId?: string | null;
  actionType: string;
  channel: string;
  draftContent: string;
  reason: string;
  riskLevel: string;
  source: string;
  createdBy: string;
  now?: Date;
}): ApprovalDraft {
  const now = input.now ?? new Date();
  if (isOpportunityDoNotContact(db, input.opportunityId)) {
    return storeApproval(db, input, 'CANCELLED', now, false);
  }
  const screened = screenNextAction(input.draftContent);
  if (!screened.allowed) {
    return { id: '', status: 'REJECTED', created: false, live: false };
  }
  const dedupe = `${input.opportunityId}|${input.actionType}|${input.channel}|${input.draftContent.trim()}`;
  const existing = db.get(`SELECT id, status FROM approval_queue WHERE dedupe_key = ? AND status = 'PENDING'`, dedupe);
  if (existing) {
    return { id: text(existing, 'id'), status: 'PENDING', created: false, live: false };
  }
  return storeApproval(db, input, 'PENDING', now, true, dedupe);
}

export function draftCommunication(db: SqlDb, input: {
  opportunityId: string;
  clientId?: string | null;
  actionType: string;
  channel: 'sms' | 'email' | 'voice';
  draftContent: string;
  reason: string;
  riskLevel?: string;
  now?: Date;
}): ApprovalDraft {
  return enqueueApproval(db, {
    ...input,
    riskLevel: input.riskLevel ?? riskFor(input.actionType),
    source: 'draft',
    createdBy: 'system',
  });
}

export function decideApproval(db: SqlDb, input: {
  approvalId: string;
  decision: 'APPROVED' | 'REJECTED';
  actor: string;
  now?: Date;
}): { status: ApprovalStatus; live: false } {
  const now = input.now ?? new Date();
  const row = db.get(`SELECT status FROM approval_queue WHERE id = ?`, input.approvalId);
  if (!row) return { status: 'CANCELLED', live: false };
  if (text(row, 'status') !== 'PENDING') return { status: text(row, 'status') as ApprovalStatus, live: false };
  if (input.decision === 'APPROVED') {
    db.run(
      `UPDATE approval_queue SET status = 'APPROVED', approved_at = ?, approved_by = ?, updated_at = ? WHERE id = ?`,
      now.toISOString(),
      input.actor,
      now.toISOString(),
      input.approvalId,
    );
    return { status: 'APPROVED', live: false };
  }
  db.run(
    `UPDATE approval_queue SET status = 'REJECTED', rejected_at = ?, approved_by = ?, updated_at = ? WHERE id = ?`,
    now.toISOString(),
    input.actor,
    now.toISOString(),
    input.approvalId,
  );
  return { status: 'REJECTED', live: false };
}

export function executeApproval(db: SqlDb, input: {
  approvalId: string;
  recipient: string;
  recipientVerified: boolean;
  now?: Date;
}): OutboundResult & { approvalStatus: string } {
  const now = input.now ?? new Date();
  const row = db.get(`SELECT * FROM approval_queue WHERE id = ?`, input.approvalId);
  if (!row) {
    return { ...dryBlocked('sms', 'Approval item was not found. Nothing was sent.', now), approvalStatus: 'CANCELLED' };
  }
  const channel = normalizeChannel(text(row, 'channel'));
  const opportunityId = text(row, 'opportunity_id');
  const expires = text(row, 'expires_at');
  if (expires && expires < now.toISOString() && text(row, 'status') === 'PENDING') {
    db.run(`UPDATE approval_queue SET status = 'EXPIRED', updated_at = ? WHERE id = ?`, now.toISOString(), input.approvalId);
    return { ...dryBlocked(channel, 'Approval expired. Nothing was sent.', now), approvalStatus: 'EXPIRED' };
  }
  const provider = providerFor(channel);
  const result = provider.send({
    recipient: input.recipient,
    body: text(row, 'draft_content'),
    approvalRequired: Number(row.approval_required) !== 0,
    approvalStatus: text(row, 'status'),
    recipientVerified: input.recipientVerified,
    doNotContact: isOpportunityDoNotContact(db, opportunityId),
    riskLevel: text(row, 'risk_level'),
    now,
  });
  if (result.status === 'sent') {
    throw new Error('Dry-run provider reported sent. That status is refused.');
  }
  db.run(
    `UPDATE approval_queue SET provider_attempt_id = NULL, updated_at = ? WHERE id = ?`,
    now.toISOString(),
    input.approvalId,
  );
  return { ...result, approvalStatus: text(db.get(`SELECT status FROM approval_queue WHERE id = ?`, input.approvalId), 'status') };
}

export function cancelPendingApprovals(db: SqlDb, opportunityId: string, now: Date): void {
  db.run(
    `UPDATE approval_queue SET status = 'CANCELLED', updated_at = ? WHERE opportunity_id = ? AND status = 'PENDING'`,
    now.toISOString(),
    opportunityId,
  );
}

function storeApproval(db: SqlDb, input: {
  opportunityId: string;
  clientId?: string | null;
  actionType: string;
  channel: string;
  draftContent: string;
  reason: string;
  riskLevel: string;
  source: string;
  createdBy: string;
}, status: ApprovalStatus, now: Date, created: boolean, dedupe = ''): ApprovalDraft {
  const id = randomUUID();
  const nowIso = now.toISOString();
  const key = dedupe || `${input.opportunityId}|${input.actionType}|${status}|${id}`;
  db.run(
    `INSERT INTO approval_queue (
      id, opportunity_id, client_id, action_type, channel, draft_content, reason, risk_level,
      approval_required, status, created_at, updated_at, expires_at, approved_at, rejected_at,
      approved_by, provider_attempt_id, source, created_by, dedupe_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?)`,
    id,
    input.opportunityId,
    input.clientId ?? null,
    input.actionType,
    input.channel,
    input.draftContent,
    input.reason,
    input.riskLevel,
    status,
    nowIso,
    nowIso,
    new Date(now.getTime() + 7 * DAY_MS).toISOString(),
    input.source,
    input.createdBy,
    key,
  );
  return { id, status, created, live: false };
}

function riskFor(actionType: string): string {
  if (/offer|commission|legal|contract|frustration|kyle/i.test(actionType)) return 'high';
  return 'standard';
}

function normalizeChannel(value: string): 'sms' | 'email' | 'voice' {
  if (value === 'email' || value === 'voice') return value;
  return 'sms';
}

function providerFor(channel: 'sms' | 'email' | 'voice') {
  if (channel === 'email') return createDryRunEmailProvider();
  if (channel === 'voice') return createDryRunVoiceProvider();
  return createDryRunSmsProvider();
}

function dryBlocked(channel: 'sms' | 'email' | 'voice', reason: string, now: Date): OutboundResult {
  return {
    status: 'blocked',
    provider: 'dry-run',
    channel,
    recipient: '',
    message_id: null,
    timestamp: now.toISOString(),
    reason,
    live: false,
  };
}
