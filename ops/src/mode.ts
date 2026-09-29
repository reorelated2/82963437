/**
 * Operating mode for this build.
 * DRY_RUN is the default. External sends stay off in this slice even if a
 * process environment variable is set to true. Nothing here places a call,
 * text, or email.
 */
export interface SendFlags {
  systemMode: 'DRY_RUN' | 'LIVE';
  liveSend: false;
  smsSend: false;
  emailSend: false;
  aiCalling: false;
}

export function systemMode(): 'DRY_RUN' | 'LIVE' {
  return process.env.SYSTEM_MODE === 'LIVE' ? 'LIVE' : 'DRY_RUN';
}

export function sendFlags(): SendFlags {
  return {
    systemMode: systemMode(),
    liveSend: false,
    smsSend: false,
    emailSend: false,
    aiCalling: false,
  };
}

export interface OutboundPolicy {
  dryRun: boolean;
  liveOutbound: boolean;
  smsEnabled: boolean;
  emailEnabled: boolean;
  voiceEnabled: boolean;
}

/** Missing values stay off. Only the exact string "true" enables a live switch. */
export function explicitTrue(value: string | undefined): boolean {
  return value === 'true';
}

export function outboundPolicy(): OutboundPolicy {
  return {
    dryRun: process.env.DRY_RUN !== 'false',
    liveOutbound: explicitTrue(process.env.LIVE_OUTBOUND),
    smsEnabled: explicitTrue(process.env.SMS_ENABLED),
    emailEnabled: explicitTrue(process.env.EMAIL_ENABLED),
    voiceEnabled: explicitTrue(process.env.VOICE_ENABLED),
  };
}

export function channelEnabled(channel: 'sms' | 'email' | 'voice'): boolean {
  const policy = outboundPolicy();
  if (channel === 'sms') return policy.smsEnabled;
  if (channel === 'email') return policy.emailEnabled;
  return policy.voiceEnabled;
}

export type ReleaseChannel = 'sms' | 'email' | 'voice' | 'calendar';

/**
 * True only when the process is in LIVE mode and the matching channel flag is
 * the string "true". This build still returns false after that check, because
 * no live transport is implemented.
 */
export function liveChannelPermitted(channel: ReleaseChannel): false {
  const modeAllows = systemMode() === 'LIVE';
  const flag = channelFlag(channel);
  const flagAllows = flag === 'true';
  if (!modeAllows || !flagAllows) return false;
  return false;
}

function channelFlag(channel: ReleaseChannel): string | undefined {
  if (channel === 'sms') return process.env.SMS_SEND;
  if (channel === 'email') return process.env.EMAIL_SEND;
  if (channel === 'voice') return process.env.AI_CALLING;
  return process.env.CALENDAR_WRITE;
}
