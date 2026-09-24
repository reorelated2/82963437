const ZONE = "America/New_York";

export function etParts(date: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour") % 24,
    minute: read("minute"),
  };
}

export function etHour(date: Date): number {
  return etParts(date).hour;
}

export function sameEtDay(a: Date, b: Date): boolean {
  const left = etParts(a);
  const right = etParts(b);
  return left.year === right.year && left.month === right.month && left.day === right.day;
}

/** Clock time in Eastern, returned as a UTC Date. */
export function etClock(year: number, month: number, day: number, hour: number, minute: number): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(guess);
  const read = (type: string) => Number(formatted.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(read("year"), read("month") - 1, read("day"), read("hour") % 24, read("minute"), read("second"));
  const offset = asUtc - guess.getTime();
  return new Date(guess.getTime() - offset);
}

export function nextMorningEt(now: Date): Date {
  const parts = etParts(now);
  const todayAtNine = etClock(parts.year, parts.month, parts.day, 9, 0);
  if (now.getTime() < todayAtNine.getTime()) return todayAtNine;
  const tomorrow = new Date(todayAtNine.getTime() + 24 * 60 * 60 * 1000);
  const next = etParts(tomorrow);
  return etClock(next.year, next.month, next.day, 9, 0);
}

export function suggestFollowUp(now: Date, requestedNotConfirmed: boolean): { dueAt: string; label: string } {
  const hour = etHour(now);
  if (requestedNotConfirmed && hour >= 9 && hour < 16) {
    const due = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    return {
      dueAt: due.toISOString(),
      label: "Follow up in about 2 hours if the showing is still not confirmed.",
    };
  }
  const due = nextMorningEt(now);
  const when = hour < 9 ? "this morning" : "tomorrow morning";
  return {
    dueAt: due.toISOString(),
    label: requestedNotConfirmed
      ? `Follow up ${when} if the showing is still not confirmed.`
      : `Follow up ${when} if there is no reply.`,
  };
}

export function formatEt(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}
