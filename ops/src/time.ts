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

const MONTH_INDEX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const WEEKDAY_LONG: Record<string, string> = {
  Sun: 'Sunday', Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday',
};

export function weekdayLong(date: Date): string {
  return WEEKDAY_LONG[zonedParts(date).weekday] ?? zonedParts(date).weekday;
}

/**
 * The appointment instant in Eastern Time, or null when the text has no date.
 * A date without a clock time uses 23:59 so the calendar day has to finish
 * before the appointment counts as past.
 */
export function appointmentInstant(value: string, now: Date): Date | null {
  const iso = value.match(/\b(20\d{2})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (iso?.[1] && iso[2] && iso[3]) {
    return zonedFromParts(Number(iso[1]), Number(iso[2]), Number(iso[3]), iso[4], iso[5], undefined);
  }
  const numeric = value.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?)?/i);
  if (numeric?.[1] && numeric[2]) {
    const year = numeric[3] ? normalizeYear(numeric[3]) : zonedParts(now).year;
    return zonedFromParts(year, Number(numeric[1]), Number(numeric[2]), numeric[4], numeric[5], numeric[6]);
  }
  const named = value.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?(?:\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?)?/i);
  if (named?.[1] && named[2]) {
    const month = MONTH_INDEX[named[1].toLowerCase().slice(0, 3)];
    if (!month) return null;
    const year = named[3] ? Number(named[3]) : zonedParts(now).year;
    return zonedFromParts(year, month, Number(named[2]), named[4], named[5], named[6]);
  }
  return null;
}

export function appointmentHasPassed(value: string, now: Date): boolean {
  const instant = appointmentInstant(value, now);
  if (!instant) return false;
  return instant.getTime() < now.getTime();
}

function zonedFromParts(year: number, month: number, day: number, hourRaw: string | undefined, minuteRaw: string | undefined, meridiem: string | undefined): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (!hourRaw) return zonedLocalToUtc(year, month, day, 23, 59);
  let hour = Number(hourRaw);
  const minute = minuteRaw ? Number(minuteRaw) : 0;
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) return null;
  const marker = (meridiem ?? '').toLowerCase();
  if (marker.startsWith('p') && hour < 12) hour += 12;
  if (marker.startsWith('a') && hour === 12) hour = 0;
  if (hour < 0 || hour > 23) return null;
  return zonedLocalToUtc(year, month, day, hour, minute);
}

function normalizeYear(raw: string): number {
  const year = Number(raw);
  if (raw.length <= 2) return 2000 + year;
  return year;
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
