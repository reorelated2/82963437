import { randomUUID } from 'node:crypto';
import { liveChannelPermitted } from '../mode.ts';
import {
  refusedReceipt,
  simulatedReceipt,
  unavailableReceipt,
  type CalendarProvider,
  type CommProviders,
  type EmailProvider,
  type MessagingProvider,
  type ProviderReceipt,
  type VoiceProvider,
} from './types.ts';

function withId(receipt: ProviderReceipt, provider: string): ProviderReceipt {
  if (receipt.outcome !== 'simulated') return { ...receipt, provider, receiptId: null, live: false };
  return { ...receipt, provider, receiptId: `sim-${randomUUID()}`, live: false };
}

export function createSyntheticProviders(): CommProviders {
  return {
    messaging: createSyntheticMessagingProvider(),
    voice: createSyntheticVoiceProvider(),
    email: createSyntheticEmailProvider(),
    calendar: createSyntheticCalendarProvider(),
  };
}

export function createSyntheticMessagingProvider(): MessagingProvider {
  return {
    id: 'synthetic_sms',
    kind: 'synthetic',
    sendSms(input): ProviderReceipt {
      return withId(
        simulatedReceipt('synthetic_sms', `Simulated SMS to ${input.to}. No message was sent.`),
        'synthetic_sms',
      );
    },
  };
}

export function createSyntheticVoiceProvider(): VoiceProvider {
  return {
    id: 'synthetic_voice',
    kind: 'synthetic',
    placeCall(input): ProviderReceipt {
      return withId(
        simulatedReceipt('synthetic_voice', `Simulated call to ${input.to}. No call was placed.`),
        'synthetic_voice',
      );
    },
  };
}

export function createSyntheticEmailProvider(): EmailProvider {
  return {
    id: 'synthetic_email',
    kind: 'synthetic',
    sendEmail(input): ProviderReceipt {
      return withId(
        simulatedReceipt('synthetic_email', `Simulated email to ${input.to}. No email was sent.`),
        'synthetic_email',
      );
    },
  };
}

export function createSyntheticCalendarProvider(): CalendarProvider {
  return {
    id: 'synthetic_calendar',
    kind: 'synthetic',
    proposeEvent(input): ProviderReceipt {
      return withId(
        simulatedReceipt('synthetic_calendar', `Simulated calendar hold "${input.title}". No invite was sent.`),
        'synthetic_calendar',
      );
    },
  };
}

export function createUnavailableMessagingProvider(): MessagingProvider {
  return {
    id: 'synthetic_sms_unavailable',
    kind: 'synthetic',
    sendSms(): ProviderReceipt {
      return unavailableReceipt('synthetic_sms_unavailable', 'SMS');
    },
  };
}

export function createUnavailableVoiceProvider(): VoiceProvider {
  return {
    id: 'synthetic_voice_unavailable',
    kind: 'synthetic',
    placeCall(): ProviderReceipt {
      return unavailableReceipt('synthetic_voice_unavailable', 'Voice');
    },
  };
}

function stubRefusal(provider: string, channel: 'sms' | 'email' | 'voice' | 'calendar', label: string): ProviderReceipt {
  liveChannelPermitted(channel);
  return refusedReceipt(
    provider,
    `${label} was not called. This build has no live transport, so the channel flag cannot send.`,
  );
}

/** Twilio Programmable Messaging shell. No HTTP client and no account credentials. */
export function createTwilioSmsProvider(): MessagingProvider {
  return {
    id: 'twilio_sms',
    kind: 'stub',
    sendSms(): ProviderReceipt {
      return stubRefusal('twilio_sms', 'sms', 'Twilio SMS');
    },
  };
}

/** Twilio Programmable Voice shell. No HTTP client and no account credentials. */
export function createTwilioVoiceProvider(): VoiceProvider {
  return {
    id: 'twilio_voice',
    kind: 'stub',
    placeCall(): ProviderReceipt {
      return stubRefusal('twilio_voice', 'voice', 'Twilio Voice');
    },
  };
}

/** Quo SMS shell. No HTTP client. Quo is not authenticated from this desk. */
export function createQuoSmsProvider(): MessagingProvider {
  return {
    id: 'quo_sms',
    kind: 'stub',
    sendSms(): ProviderReceipt {
      return stubRefusal('quo_sms', 'sms', 'Quo SMS');
    },
  };
}

/** Gmail send shell. The Gmail API is not called. */
export function createGmailProvider(): EmailProvider {
  return {
    id: 'gmail',
    kind: 'stub',
    sendEmail(): ProviderReceipt {
      return stubRefusal('gmail', 'email', 'Gmail');
    },
  };
}

/** Vapi voice shell. No HTTP client and no assistant id. */
export function createVapiProvider(): VoiceProvider {
  return {
    id: 'vapi_voice',
    kind: 'stub',
    placeCall(): ProviderReceipt {
      return stubRefusal('vapi_voice', 'voice', 'Vapi');
    },
  };
}

/** Calendar shell. No Google Calendar client is constructed. */
export function createCalendarStubProvider(): CalendarProvider {
  return {
    id: 'google_calendar',
    kind: 'stub',
    proposeEvent(): ProviderReceipt {
      return stubRefusal('google_calendar', 'calendar', 'Google Calendar');
    },
  };
}

export function createStubProviders(): CommProviders {
  return {
    messaging: createTwilioSmsProvider(),
    voice: createTwilioVoiceProvider(),
    email: createGmailProvider(),
    calendar: createCalendarStubProvider(),
  };
}
