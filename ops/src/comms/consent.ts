import { text, type SqlDb } from '../sql.ts';
import type { CommChannel } from './types.ts';

export type ConsentState = 'unknown' | 'granted' | 'denied';

export interface ConsentRecord {
  clientId: string;
  smsConsent: ConsentState;
  callConsent: ConsentState;
  emailConsent: ConsentState;
  marketingConsent: ConsentState;
  recordingConsent: ConsentState;
  doNotSms: boolean;
  doNotCall: boolean;
  doNotEmail: boolean;
  doNotMarketing: boolean;
  optOutAt: string | null;
  wrongNumber: boolean;
  preferredChannel: string | null;
  preferredTime: string | null;
  sourceOfConsent: string | null;
}

export interface ConsentPatch {
  clientId: string;
  smsConsent?: ConsentState;
  callConsent?: ConsentState;
  emailConsent?: ConsentState;
  marketingConsent?: ConsentState;
  recordingConsent?: ConsentState;
  doNotSms?: boolean;
  doNotCall?: boolean;
  doNotEmail?: boolean;
  doNotMarketing?: boolean;
  wrongNumber?: boolean;
  preferredChannel?: string | null;
  preferredTime?: string | null;
  sourceOfConsent?: string | null;
  optOutAt?: string | null;
  now?: Date;
}

const OPT_OUT = /^(stop|stopall|unsubscribe|cancel|end|quit)\b/i;

export function isChannelOptOut(content: string): boolean {
  return OPT_OUT.test(content.trim());
}

export function loadConsent(db: SqlDb, clientId: string): ConsentRecord {
  const row = db.get(`SELECT * FROM consent WHERE client_id = ?`, clientId);
  if (!row) return emptyConsent(clientId);
  return hydrate(row);
}

export function saveConsent(db: SqlDb, patch: ConsentPatch): ConsentRecord {
  const nowIso = (patch.now ?? new Date()).toISOString();
  const current = loadConsent(db, patch.clientId);
  const next: ConsentRecord = {
    clientId: patch.clientId,
    smsConsent: patch.smsConsent ?? current.smsConsent,
    callConsent: patch.callConsent ?? current.callConsent,
    emailConsent: patch.emailConsent ?? current.emailConsent,
    marketingConsent: patch.marketingConsent ?? current.marketingConsent,
    recordingConsent: patch.recordingConsent ?? current.recordingConsent,
    doNotSms: patch.doNotSms ?? current.doNotSms,
    doNotCall: patch.doNotCall ?? current.doNotCall,
    doNotEmail: patch.doNotEmail ?? current.doNotEmail,
    doNotMarketing: patch.doNotMarketing ?? current.doNotMarketing,
    optOutAt: patch.optOutAt === undefined ? current.optOutAt : patch.optOutAt,
    wrongNumber: patch.wrongNumber ?? current.wrongNumber,
    preferredChannel: patch.preferredChannel === undefined ? current.preferredChannel : patch.preferredChannel,
    preferredTime: patch.preferredTime === undefined ? current.preferredTime : patch.preferredTime,
    sourceOfConsent: patch.sourceOfConsent === undefined ? current.sourceOfConsent : patch.sourceOfConsent,
  };
  db.run(
    `INSERT INTO consent (
      client_id, sms_consent, call_consent, email_consent, marketing_consent, recording_consent,
      do_not_sms, do_not_call, do_not_email, do_not_marketing, opt_out_at, wrong_number,
      preferred_channel, preferred_time, source_of_consent, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(client_id) DO UPDATE SET
      sms_consent = excluded.sms_consent,
      call_consent = excluded.call_consent,
      email_consent = excluded.email_consent,
      marketing_consent = excluded.marketing_consent,
      recording_consent = excluded.recording_consent,
      do_not_sms = excluded.do_not_sms,
      do_not_call = excluded.do_not_call,
      do_not_email = excluded.do_not_email,
      do_not_marketing = excluded.do_not_marketing,
      opt_out_at = excluded.opt_out_at,
      wrong_number = excluded.wrong_number,
      preferred_channel = excluded.preferred_channel,
      preferred_time = excluded.preferred_time,
      source_of_consent = excluded.source_of_consent,
      updated_at = excluded.updated_at`,
    next.clientId,
    next.smsConsent,
    next.callConsent,
    next.emailConsent,
    next.marketingConsent,
    next.recordingConsent,
    next.doNotSms ? 1 : 0,
    next.doNotCall ? 1 : 0,
    next.doNotEmail ? 1 : 0,
    next.doNotMarketing ? 1 : 0,
    next.optOutAt,
    next.wrongNumber ? 1 : 0,
    next.preferredChannel,
    next.preferredTime,
    next.sourceOfConsent,
    nowIso,
  );
  return loadConsent(db, patch.clientId);
}

export function suppressChannel(db: SqlDb, clientId: string, channel: CommChannel, source: string, now: Date): ConsentRecord {
  const current = loadConsent(db, clientId);
  const patch: ConsentPatch = {
    clientId,
    sourceOfConsent: source,
    optOutAt: current.optOutAt ?? now.toISOString(),
    now,
  };
  if (channel === 'sms') {
    patch.doNotSms = true;
    patch.smsConsent = 'denied';
  } else if (channel === 'voice') {
    patch.doNotCall = true;
    patch.callConsent = 'denied';
  } else if (channel === 'email') {
    patch.doNotEmail = true;
    patch.emailConsent = 'denied';
  } else {
    patch.doNotMarketing = true;
    patch.marketingConsent = 'denied';
  }
  return saveConsent(db, patch);
}

export function outboundBlockReason(consent: ConsentRecord, channel: CommChannel, purpose: string): string | null {
  if (purpose.trim().toLowerCase() === 'marketing' && (consent.doNotMarketing || consent.marketingConsent === 'denied')) {
    return 'Marketing consent is off. Nothing was sent.';
  }
  if (channel === 'sms' && (consent.doNotSms || consent.smsConsent === 'denied')) {
    return 'SMS is suppressed for this client. Nothing was sent.';
  }
  if (channel === 'voice' && (consent.doNotCall || consent.callConsent === 'denied')) {
    return 'Calls are suppressed for this client. Nothing was sent.';
  }
  if (channel === 'email' && (consent.doNotEmail || consent.emailConsent === 'denied')) {
    return 'Email is suppressed for this client. Nothing was sent.';
  }
  if ((channel === 'sms' || channel === 'voice') && consent.wrongNumber) {
    return 'Number is marked wrong. Nothing was sent.';
  }
  if (consent.preferredChannel && consent.preferredChannel !== channel && consent.preferredChannel !== 'any') {
    return `Preferred channel is ${consent.preferredChannel}. This ${channel} attempt was not sent.`;
  }
  return null;
}

export function consentStatusLabel(consent: ConsentRecord, channel: CommChannel): string {
  if (channel === 'sms') return consent.doNotSms || consent.smsConsent === 'denied' ? 'sms_denied' : consent.smsConsent === 'granted' ? 'sms_granted' : 'sms_unknown';
  if (channel === 'voice') return consent.doNotCall || consent.callConsent === 'denied' ? 'call_denied' : consent.callConsent === 'granted' ? 'call_granted' : 'call_unknown';
  if (channel === 'email') return consent.doNotEmail || consent.emailConsent === 'denied' ? 'email_denied' : consent.emailConsent === 'granted' ? 'email_granted' : 'email_unknown';
  return consent.marketingConsent;
}

function emptyConsent(clientId: string): ConsentRecord {
  return {
    clientId,
    smsConsent: 'unknown',
    callConsent: 'unknown',
    emailConsent: 'unknown',
    marketingConsent: 'unknown',
    recordingConsent: 'unknown',
    doNotSms: false,
    doNotCall: false,
    doNotEmail: false,
    doNotMarketing: false,
    optOutAt: null,
    wrongNumber: false,
    preferredChannel: null,
    preferredTime: null,
    sourceOfConsent: null,
  };
}

function hydrate(row: Record<string, unknown>): ConsentRecord {
  return {
    clientId: text(row, 'client_id'),
    smsConsent: asState(text(row, 'sms_consent')),
    callConsent: asState(text(row, 'call_consent')),
    emailConsent: asState(text(row, 'email_consent')),
    marketingConsent: asState(text(row, 'marketing_consent')),
    recordingConsent: asState(text(row, 'recording_consent')),
    doNotSms: flag(row, 'do_not_sms'),
    doNotCall: flag(row, 'do_not_call'),
    doNotEmail: flag(row, 'do_not_email'),
    doNotMarketing: flag(row, 'do_not_marketing'),
    optOutAt: text(row, 'opt_out_at') || null,
    wrongNumber: flag(row, 'wrong_number'),
    preferredChannel: text(row, 'preferred_channel') || null,
    preferredTime: text(row, 'preferred_time') || null,
    sourceOfConsent: text(row, 'source_of_consent') || null,
  };
}

function asState(value: string): ConsentState {
  if (value === 'granted' || value === 'denied') return value;
  return 'unknown';
}

function flag(row: Record<string, unknown>, key: string): boolean {
  return row[key] === 1 || row[key] === true || row[key] === '1';
}
