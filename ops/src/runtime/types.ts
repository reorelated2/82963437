export const SHOWING_CHECKPOINTS = [
  'requested',
  'access_approved',
  'agent_assigned',
  'buyer_notified',
  'buyer_acknowledged',
  'paperwork',
] as const;

export type ShowingCheckpoint = (typeof SHOWING_CHECKPOINTS)[number];

export interface ReleasePolicy {
  version: string;
  liveSend: boolean;
  syntheticSend: boolean;
  quietStartHour: number;
  quietEndHour: number;
  maxSteps: number;
  escalation: string;
}

export const UNRELEASED_POLICY: ReleasePolicy = {
  version: '2026-09-27.unreleased',
  liveSend: false,
  syntheticSend: false,
  quietStartHour: 8,
  quietEndHour: 20,
  maxSteps: 12,
  escalation: 'Kyle Kleinman',
};

export interface Inbound {
  eventKey: string;
  kind: 'inquiry' | 'reply' | 'due' | 'source_change' | 'access_update' | 'resume_write';
  personKey: string;
  displayName?: string;
  text: string;
  actor: 'buyer' | 'coordinator' | 'listing' | 'system';
  sourceVersion: string;
  relationshipOwner?: string;
  now: Date;
  workerId: string;
  synthetic?: boolean;
  signals?: {
    accessApproved?: boolean;
    agentAssigned?: string | null;
    paperworkDone?: boolean;
    buyerAcknowledgedTime?: boolean;
    recipientKey?: string;
  };
}

export interface SendReceipt {
  live: false | true;
  mode: 'synthetic' | 'unverified' | 'live';
  receiptId: string | null;
  outcome: 'sent' | 'ambiguous' | 'failed' | 'auth_required' | 'not_attempted';
  reason: string;
}

export interface WriteReceipt {
  outcome: 'written' | 'failed' | 'auth_required' | 'not_attempted';
  reason: string;
}

export interface ChannelAdapter {
  id: string;
  mode: 'synthetic' | 'unverified' | 'live';
  send(input: { to: string; body: string; actionKey: string }): SendReceipt;
  writeRecord(input: { personKey: string; note: string; actionKey: string }): WriteReceipt;
}

export interface WakeResult {
  opportunityId: string | null;
  status:
    | 'acted'
    | 'duplicate'
    | 'not_owner'
    | 'held'
    | 'suppressed'
    | 'no_contact'
    | 'escalated'
    | 'auth_required'
    | 'budget'
    | 'ambiguous';
  actionKey: string | null;
  live: boolean;
  mode: 'synthetic' | 'unverified' | 'live' | 'none';
  message: string | null;
  note: string | null;
  nextDueAt: string | null;
  showingFullyConfirmed: boolean;
  missingCheckpoints: ShowingCheckpoint[];
  blocker: string | null;
  questionId: string | null;
  steps: string[];
}
