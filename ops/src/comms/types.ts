export type CommChannel = 'sms' | 'email' | 'voice' | 'calendar';
export type ProviderKind = 'synthetic' | 'stub';
export type ReceiptOutcome = 'simulated' | 'not_attempted' | 'failed';

/** Every receipt in this build is non-live. */
export interface ProviderReceipt {
  live: false;
  outcome: ReceiptOutcome;
  provider: string;
  receiptId: string | null;
  reason: string;
  retryable: boolean;
  retryAfterSeconds: number | null;
}

export interface OutboundMessage {
  to: string;
  body: string;
  clientId: string;
  purpose: string;
  subject?: string;
}

export interface MessagingProvider {
  id: string;
  kind: ProviderKind;
  sendSms(input: OutboundMessage): ProviderReceipt;
}

export interface VoiceProvider {
  id: string;
  kind: ProviderKind;
  placeCall(input: OutboundMessage): ProviderReceipt;
}

export interface EmailProvider {
  id: string;
  kind: ProviderKind;
  sendEmail(input: OutboundMessage): ProviderReceipt;
}

export interface CalendarProvider {
  id: string;
  kind: ProviderKind;
  proposeEvent(input: { clientId: string; title: string; startsAt: string; purpose: string }): ProviderReceipt;
}

export interface CommProviders {
  messaging: MessagingProvider;
  voice: VoiceProvider;
  email: EmailProvider;
  calendar: CalendarProvider;
}

export const RETRY_AFTER_SECONDS = 300;

export const LIVE_STATUSES = new Set(['sent', 'call completed', 'call_completed', 'delivered', 'completed']);

export function simulatedReceipt(provider: string, reason: string): ProviderReceipt {
  return {
    live: false,
    outcome: 'simulated',
    provider,
    receiptId: null,
    reason,
    retryable: false,
    retryAfterSeconds: null,
  };
}

export function refusedReceipt(provider: string, reason: string): ProviderReceipt {
  return {
    live: false,
    outcome: 'not_attempted',
    provider,
    receiptId: null,
    reason,
    retryable: false,
    retryAfterSeconds: null,
  };
}

export function unavailableReceipt(provider: string, channelLabel: string): ProviderReceipt {
  return {
    live: false,
    outcome: 'failed',
    provider,
    receiptId: null,
    reason: `${channelLabel} provider is unavailable. Retry after ${RETRY_AFTER_SECONDS} seconds. Nothing was sent.`,
    retryable: true,
    retryAfterSeconds: RETRY_AFTER_SECONDS,
  };
}
