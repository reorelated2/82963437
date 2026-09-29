import { channelEnabled, outboundPolicy, type ReleaseChannel } from '../mode.ts';

export interface GateInput {
  channel: 'sms' | 'email' | 'voice';
  approvalRequired: boolean;
  approvalStatus: string;
  recipientVerified: boolean;
  doNotContact: boolean;
  riskLevel: string;
}

export interface GateDecision {
  allowed: false;
  status: 'not_attempted' | 'dry_run' | 'blocked';
  reason: string;
}

/**
 * Single outbound gate. This build never returns allowed: true.
 * A missing flag is off. Dry run, a missing approval, or DO_NOT_CONTACT
 * all stop the attempt before any provider can report a send.
 */
export function canExecuteOutbound(input: GateInput): GateDecision {
  if (input.doNotContact) {
    return { allowed: false, status: 'blocked', reason: 'DO_NOT_CONTACT overrides approval. Nothing was sent.' };
  }
  if (input.approvalRequired && input.approvalStatus !== 'APPROVED') {
    return { allowed: false, status: 'blocked', reason: 'Approval is required and the item is not APPROVED. Nothing was sent.' };
  }
  if (!input.recipientVerified) {
    return { allowed: false, status: 'not_attempted', reason: 'Recipient is not verified. Nothing was sent.' };
  }
  const policy = outboundPolicy();
  const enabled = channelEnabled(input.channel);
  if (policy.dryRun || !policy.liveOutbound || !enabled) {
    return { allowed: false, status: 'dry_run', reason: 'Dry run is on or the live channel is off. Nothing was sent.' };
  }
  return {
    allowed: false,
    status: 'not_attempted',
    reason: 'Live transport is not enabled in this build. Nothing was sent.',
  };
}

export function gateChannel(channel: ReleaseChannel): 'sms' | 'email' | 'voice' {
  if (channel === 'sms' || channel === 'voice') return channel;
  return 'email';
}
