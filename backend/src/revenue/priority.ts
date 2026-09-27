import { formatMoney } from "../os/money.js";
import { clean, cleanNumber, positiveNumber, validDate } from "./facts.js";

export type Lane = "redfin" | "capture" | "investor" | "pdc" | "pulse";

export interface WorkItem {
  id?: string | null;
  label?: string | null;
  lane?: Lane | null;
  expectedRevenueUsd?: number | null;
  probability?: number | null;
  deadline?: string | null;
  timeHours?: number | null;
  nextAction?: string | null;
}

export interface RankedItem {
  id: string;
  label: string;
  lane: string;
  expectedValueUsd: number | null;
  perHourUsd: number | null;
  deadline: string | null;
  deadlineStatus: "overdue" | "due_soon" | "later" | "none";
  timeHours: number | null;
  why: string;
  nextAction: string;
}

export interface PriorityResult {
  sent: false;
  method: string;
  next: RankedItem | null;
  ordered: RankedItem[];
  dueNow: RankedItem[];
  skipped: string[];
  nextStep: string;
}

const HOUR_MS = 60 * 60 * 1000;
const SOON_MS = 48 * HOUR_MS;

function deadlineStatus(date: Date | null, now: Date): RankedItem["deadlineStatus"] {
  if (!date) return "none";
  const delta = date.getTime() - now.getTime();
  if (delta < 0) return "overdue";
  if (delta <= SOON_MS) return "due_soon";
  return "later";
}

export function prioritize(items: WorkItem[], now = new Date()): PriorityResult {
  const skipped: string[] = [];
  const ranked: RankedItem[] = [];

  for (const item of items) {
    const id = clean(item.id);
    const label = clean(item.label);
    if (!id || !label) {
      skipped.push("An item was skipped because id or label was missing.");
      continue;
    }
    const revenue = positiveNumber(item.expectedRevenueUsd);
    const probability = cleanNumber(item.probability);
    const hours = positiveNumber(item.timeHours);
    const deadline = validDate(item.deadline);
    const knownProbability = probability !== null && probability >= 0 && probability <= 1;
    if (probability !== null && !knownProbability) {
      skipped.push(`${label}: probability was outside 0 to 1, so it was not used.`);
    }
    const expectedValue = revenue !== null && knownProbability ? revenue * probability : null;
    const perHour = expectedValue !== null && hours !== null ? expectedValue / hours : null;
    const status = deadlineStatus(deadline, now);
    const why = explain(label, expectedValue, perHour, hours, status);
    ranked.push({
      id,
      label,
      lane: item.lane ?? "Data needed",
      expectedValueUsd: expectedValue,
      perHourUsd: perHour,
      deadline: deadline ? deadline.toISOString() : null,
      deadlineStatus: status,
      timeHours: hours,
      why,
      nextAction: clean(item.nextAction) ?? "Do the next concrete step on this item.",
    });
  }

  const deadlineRank = { overdue: 0, due_soon: 1, later: 2, none: 3 };
  ranked.sort((a, b) => {
    const aKnown = a.perHourUsd !== null;
    const bKnown = b.perHourUsd !== null;
    if (aKnown !== bKnown) return aKnown ? -1 : 1;
    if (a.perHourUsd !== null && b.perHourUsd !== null && a.perHourUsd !== b.perHourUsd) return b.perHourUsd - a.perHourUsd;
    const deadline = deadlineRank[a.deadlineStatus] - deadlineRank[b.deadlineStatus];
    if (deadline) return deadline;
    const aHours = a.timeHours ?? Number.POSITIVE_INFINITY;
    const bHours = b.timeHours ?? Number.POSITIVE_INFINITY;
    if (aHours !== bHours) return aHours - bHours;
    return a.label.localeCompare(b.label);
  });

  const dueNow = ranked.filter((item) => item.deadlineStatus === "overdue" || item.deadlineStatus === "due_soon");
  const next = ranked[0] ?? null;
  let nextStep = "No work items were supplied. Paste the open lead, Capture order, or deal.";
  if (next) {
    const dropped = dueNow.filter((item) => item.id !== next.id);
    nextStep = next.nextAction;
    if (dropped.length) {
      nextStep += ` Also due: ${dropped.map((item) => item.label).join(", ")}.`;
    }
  }

  return {
    sent: false,
    method:
      "Sort key, not a forecast: expected revenue times probability, divided by hours. Items missing that math go last. A deadline breaks ties and fills the due list. Overdue work stays visible even when a larger item ranks first.",
    next,
    ordered: ranked,
    dueNow,
    skipped,
    nextStep,
  };
}

function explain(
  label: string,
  expectedValue: number | null,
  perHour: number | null,
  hours: number | null,
  status: RankedItem["deadlineStatus"],
): string {
  if (expectedValue === null || perHour === null || hours === null) {
    return `${label} has no expected-value math. Deadline status: ${status}.`;
  }
  return `${label}: ${formatMoney(expectedValue)} expected over ${hours} hours, about ${formatMoney(perHour)} an hour. Deadline status: ${status}. This is a sort key, not a forecast.`;
}
