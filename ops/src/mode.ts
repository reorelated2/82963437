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
