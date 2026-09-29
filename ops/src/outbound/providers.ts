import { canExecuteOutbound } from './gate.ts';

export type OutboundStatus = 'not_attempted' | 'dry_run' | 'blocked' | 'sent' | 'failed';

export interface OutboundAttempt {
  recipient: string;
  body: string;
  approvalRequired?: boolean;
  approvalStatus?: string;
  recipientVerified?: boolean;
  doNotContact?: boolean;
  riskLevel?: string;
  now?: Date;
}

export interface OutboundResult {
  status: OutboundStatus;
  provider: string;
  channel: 'sms' | 'email' | 'voice';
  recipient: string;
  message_id: null;
  timestamp: string;
  reason: string;
  live: false;
}

export interface SmsProvider {
  id: string;
  send(input: OutboundAttempt): OutboundResult;
}

export interface EmailProvider {
  id: string;
  send(input: OutboundAttempt): OutboundResult;
}

export interface VoiceProvider {
  id: string;
  send(input: OutboundAttempt): OutboundResult;
}

function result(channel: 'sms' | 'email' | 'voice', provider: string, input: OutboundAttempt, voice: boolean): OutboundResult {
  const decision = canExecuteOutbound({
    channel,
    approvalRequired: input.approvalRequired ?? true,
    approvalStatus: input.approvalStatus ?? 'PENDING',
    recipientVerified: input.recipientVerified ?? false,
    doNotContact: input.doNotContact ?? false,
    riskLevel: input.riskLevel ?? 'standard',
  });
  const status = decision.status;
  const reason = voice && status !== 'blocked'
    ? `${decision.reason} The call was not placed and is not completed.`
    : decision.reason;
  return {
    status,
    provider,
    channel,
    recipient: input.recipient,
    message_id: null,
    timestamp: (input.now ?? new Date()).toISOString(),
    reason,
    live: false,
  };
}

export function createDryRunSmsProvider(): SmsProvider {
  return { id: 'dry-run-sms', send: (input) => result('sms', 'dry-run-sms', input, false) };
}

export function createDryRunEmailProvider(): EmailProvider {
  return { id: 'dry-run-email', send: (input) => result('email', 'dry-run-email', input, false) };
}

export function createDryRunVoiceProvider(): VoiceProvider {
  return { id: 'dry-run-voice', send: (input) => result('voice', 'dry-run-voice', input, true) };
}
