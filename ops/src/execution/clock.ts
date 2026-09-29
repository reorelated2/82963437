/** One clock. Production reads the wall clock in America/New_York. Tests pass an injected instant. */

export const PRODUCTION_ZONE = 'America/New_York' as const;

/** Frozen instant used only by the Hot 7 regression fixture. Production must not import this as "now". */
export const HOT7_FIXTURE_INSTANT = '2026-09-29T13:00:00.000Z';

export type ClockSource = 'production' | 'injected';

export interface DeskClock {
  now: Date;
  source: ClockSource;
  zone: typeof PRODUCTION_ZONE;
}

export function productionClock(now = new Date()): DeskClock {
  return { now, source: 'production', zone: PRODUCTION_ZONE };
}

export function injectedClock(now: Date): DeskClock {
  return { now, source: 'injected', zone: PRODUCTION_ZONE };
}

export function clockFrom(now?: Date): DeskClock {
  return now ? injectedClock(now) : productionClock();
}
