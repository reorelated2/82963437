import { randomUUID } from 'node:crypto';
import type { ChannelAdapter, SendReceipt, WriteReceipt } from './types.ts';

export interface SyntheticControls {
  failWritesRemaining: number;
  ambiguousSendsRemaining: number;
  authFail: boolean;
}

export interface SyntheticAdapter extends ChannelAdapter {
  mode: 'synthetic';
  sends: Array<{ to: string; body: string; actionKey: string }>;
  writes: Array<{ personKey: string; note: string; actionKey: string }>;
  controls: SyntheticControls;
}

export function createSyntheticAdapter(controls: Partial<SyntheticControls> = {}): SyntheticAdapter {
  const state: SyntheticControls = {
    failWritesRemaining: controls.failWritesRemaining ?? 0,
    ambiguousSendsRemaining: controls.ambiguousSendsRemaining ?? 0,
    authFail: controls.authFail ?? false,
  };
  const adapter: SyntheticAdapter = {
    id: 'synthetic_sms',
    mode: 'synthetic',
    sends: [],
    writes: [],
    controls: state,
    send(input): SendReceipt {
      if (state.authFail) {
        return { live: false, mode: 'synthetic', receiptId: null, outcome: 'auth_required', reason: 'Synthetic login expired. No bypass was attempted.' };
      }
      if (state.ambiguousSendsRemaining > 0) {
        state.ambiguousSendsRemaining -= 1;
        return { live: false, mode: 'synthetic', receiptId: null, outcome: 'ambiguous', reason: 'Synthetic provider timed out after a possible accept.' };
      }
      adapter.sends.push(input);
      return {
        live: false,
        mode: 'synthetic',
        receiptId: `synthetic-${randomUUID()}`,
        outcome: 'sent',
        reason: 'Synthetic delivery recorded. This is not a live message.',
      };
    },
    writeRecord(input): WriteReceipt {
      if (state.authFail) return { outcome: 'auth_required', reason: 'Synthetic record login expired.' };
      if (state.failWritesRemaining > 0) {
        state.failWritesRemaining -= 1;
        return { outcome: 'failed', reason: 'Synthetic Agent Tools write failed. The send receipt stays.' };
      }
      adapter.writes.push(input);
      return { outcome: 'written', reason: 'Synthetic working note stored. Agent Tools was not written.' };
    },
  };
  return adapter;
}

export function createUnverifiedLiveAdapter(): ChannelAdapter {
  return {
    id: 'live_unverified',
    mode: 'unverified',
    send(): SendReceipt {
      return {
        live: false,
        mode: 'unverified',
        receiptId: null,
        outcome: 'failed',
        reason: 'No verified live channel. Quo is not authenticated and Gmail send is not released.',
      };
    },
    writeRecord(): WriteReceipt {
      return { outcome: 'failed', reason: 'Agent Tools has no connected write from this runtime.' };
    },
  };
}
