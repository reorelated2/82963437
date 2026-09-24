const ZONE = 'America/New_York';

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: string;
}

export function zonedParts(date: Date, timeZone = ZONE): ZonedParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const map: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    weekday: map.weekday ?? '',
  };
}

export function zonedLocalToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone = ZONE): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const corrected = new Date(guess.getTime() - zoneOffset(guess, timeZone));
  const second = zoneOffset(corrected, timeZone);
  return new Date(guess.getTime() - second);
}

function zoneOffset(date: Date, timeZone: string): number {
  const parts = zonedParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, date.getUTCSeconds());
  return asUtc - date.getTime();
}

export function formatEt(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date);
}

export function sameEtDay(a: Date, b: Date): boolean {
  const left = zonedParts(a);
  const right = zonedParts(b);
  return left.year === right.year && left.month === right.month && left.day === right.day;
}

export function nextBusinessMorning(now: Date): Date {
  const start = zonedParts(now);
  for (let add = 1; add <= 8; add += 1) {
    const probe = new Date(Date.UTC(start.year, start.month - 1, start.day + add, 16, 0, 0));
    const parts = zonedParts(probe);
    if (parts.weekday !== 'Sat' && parts.weekday !== 'Sun') {
      return zonedLocalToUtc(parts.year, parts.month, parts.day, 9, 0);
    }
  }
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}

export function suggestDueAt(now: Date, requestedRaw: string | null, urgentToday: boolean): Date {
  const hour = zonedParts(now).hour;
  if (urgentToday && /today/i.test(requestedRaw ?? '') && hour < 17) {
    return new Date(now.getTime() + 2 * 60 * 60 * 1000);
  }
  return nextBusinessMorning(now);
}
