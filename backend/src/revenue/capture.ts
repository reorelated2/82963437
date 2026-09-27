import { formatMoney } from "../os/money.js";
import { blank, clean, cleanNumber, positiveNumber, validDate } from "./facts.js";

/** Working rate card. These are benchmarks, not an agreed fee. */
export const CAPTURE_BENCHMARKS = {
  standardInteriorExteriorV2WithoutFloorPlanUsd: 90,
  homesteadAdderUsd: 10,
  nearbyExteriorUsd: 45,
  beyond15MilesExteriorUsd: 65,
} as const;

export type CaptureScope =
  | "standard_v2"
  | "nearby_exterior"
  | "exterior_beyond_15"
  | "scan"
  | "rush"
  | "long_trip"
  | "custom";

const CUSTOM_SCOPES = new Set<CaptureScope>(["scan", "rush", "long_trip", "custom"]);

export interface CaptureQuoteInput {
  scope?: CaptureScope | null;
  homestead?: boolean | null;
  miles?: number | null;
  agreedFeeUsd?: number | null;
}

export interface CaptureQuote {
  sent: false;
  scope: string;
  benchmarkUsd: number | null;
  benchmarkLabel: string;
  agreedFeeUsd: number | null;
  feeToCollectUsd: number | null;
  feeBasis: "agreed" | "benchmark_not_agreed" | "custom";
  facts: string[];
  estimates: string[];
  dataNeeded: string[];
  conflicts: string[];
  recommendation: string;
}

export function quoteCapture(input: CaptureQuoteInput): CaptureQuote {
  const scope = input.scope ?? null;
  const miles = cleanNumber(input.miles);
  const agreed = positiveNumber(input.agreedFeeUsd);
  const homestead = input.homestead === true;
  const facts: string[] = [];
  const estimates: string[] = [];
  const dataNeeded: string[] = [];
  const conflicts: string[] = [];

  if (!scope) dataNeeded.push("Scope");
  if (miles === null) dataNeeded.push("Distance");
  else facts.push(`Distance supplied: ${miles} miles.`);
  if (homestead) facts.push("Homestead was marked yes.");
  if (homestead && scope && scope !== "standard_v2") {
    estimates.push("The $10 Homestead adder is benchmarked on the standard interior/exterior V2. It was not added to this scope.");
  }

  let benchmarkUsd: number | null = null;
  let benchmarkLabel = "Data needed";

  if (scope === "standard_v2") {
    benchmarkUsd = CAPTURE_BENCHMARKS.standardInteriorExteriorV2WithoutFloorPlanUsd;
    benchmarkLabel = `${formatMoney(benchmarkUsd)} standard interior/exterior V2, no floor plan`;
    if (homestead) {
      benchmarkUsd += CAPTURE_BENCHMARKS.homesteadAdderUsd;
      benchmarkLabel += `, plus ${formatMoney(CAPTURE_BENCHMARKS.homesteadAdderUsd)} Homestead`;
    }
    if (miles !== null && miles > 15) {
      conflicts.push("Distance is beyond 15 miles. Long trips are custom. The standard benchmark is not the trip fee.");
    }
  } else if (scope === "nearby_exterior") {
    benchmarkUsd = CAPTURE_BENCHMARKS.nearbyExteriorUsd;
    benchmarkLabel = `${formatMoney(benchmarkUsd)} nearby exterior`;
    if (miles !== null && miles > 15) {
      conflicts.push(
        `Nearby exterior does not match a trip beyond 15 miles. The beyond-15 exterior benchmark is ${formatMoney(CAPTURE_BENCHMARKS.beyond15MilesExteriorUsd)}.`,
      );
      benchmarkUsd = null;
      benchmarkLabel = "Conflict. Confirm the scope before using a benchmark.";
    }
  } else if (scope === "exterior_beyond_15") {
    benchmarkUsd = CAPTURE_BENCHMARKS.beyond15MilesExteriorUsd;
    benchmarkLabel = `${formatMoney(benchmarkUsd)} exterior beyond 15 miles`;
    if (miles !== null && miles <= 15) {
      conflicts.push(
        `Distance is ${miles} miles, which is not beyond 15. The nearby exterior benchmark is ${formatMoney(CAPTURE_BENCHMARKS.nearbyExteriorUsd)}.`,
      );
    }
  } else if (scope && CUSTOM_SCOPES.has(scope)) {
    benchmarkUsd = null;
    benchmarkLabel = "Custom. Scans, rush work, and long trips do not have a standard rate.";
    dataNeeded.push("Agreed fee for custom scope");
  }

  if (benchmarkUsd !== null) {
    estimates.push(`Benchmark, not an agreed fee: ${benchmarkLabel}.`);
  }

  const feeBasis: CaptureQuote["feeBasis"] = agreed !== null ? "agreed" : benchmarkUsd !== null ? "benchmark_not_agreed" : "custom";
  const feeToCollectUsd = agreed;

  let recommendation: string;
  if (conflicts.length) {
    recommendation = "Do not quote yet. The scope and the distance disagree. Confirm both, then confirm the fee.";
  } else if (agreed !== null) {
    recommendation = `Use the agreed fee of ${formatMoney(agreed)}. ${benchmarkUsd !== null ? `The benchmark for reference is ${benchmarkLabel}.` : "There is no standard benchmark for this scope."}`;
  } else if (benchmarkUsd !== null) {
    recommendation = `The working benchmark is ${benchmarkLabel}. It is not the fee until you confirm the scope and they agree to the number.`;
    dataNeeded.push("Agreed fee");
  } else if (!scope) {
    recommendation = "Confirm the actual scope before you quote. The rate card cannot pick interior, exterior, or custom for you.";
  } else {
    recommendation = "This scope is custom. Agree the fee before you schedule the drive.";
  }

  if (agreed !== null) facts.push(`Agreed fee supplied: ${formatMoney(agreed)}.`);

  return {
    sent: false,
    scope: scope ?? "Data needed",
    benchmarkUsd,
    benchmarkLabel,
    agreedFeeUsd: agreed,
    feeToCollectUsd,
    feeBasis,
    facts,
    estimates,
    dataNeeded,
    conflicts,
    recommendation,
  };
}

export interface CaptureOrderInput {
  client?: string | null;
  address?: string | null;
  scope?: CaptureScope | null;
  agreedFeeUsd?: number | null;
  miles?: number | null;
  dueAt?: string | null;
  homeowner?: string | null;
  access?: string | null;
  evidenceComplete?: boolean | null;
  submitted?: boolean | null;
  payment?: "unpaid" | "paid" | null;
  paymentDue?: string | null;
  homestead?: boolean | null;
}

export interface CaptureOrderReview {
  sent: false;
  scheduled: false;
  client: string;
  address: string;
  scope: string;
  fee: string;
  distance: string;
  due: string;
  homeowner: string;
  access: string;
  quote: CaptureQuote;
  facts: string[];
  dataNeeded: string[];
  nextAction: string;
  followUp: { dueAt: string | null; trigger: string };
}

export function reviewCaptureOrder(input: CaptureOrderInput, now = new Date()): CaptureOrderReview {
  const quote = quoteCapture({
    scope: input.scope,
    homestead: input.homestead,
    miles: input.miles,
    agreedFeeUsd: input.agreedFeeUsd,
  });
  const client = clean(input.client);
  const address = clean(input.address);
  const homeowner = clean(input.homeowner);
  const access = clean(input.access);
  const due = validDate(input.dueAt);
  const paymentDue = validDate(input.paymentDue);
  const dataNeeded = [...quote.dataNeeded];
  if (!client) dataNeeded.push("Client");
  if (!address) dataNeeded.push("Address");
  if (!homeowner) dataNeeded.push("Homeowner contact");
  if (!access) dataNeeded.push("Access");
  if (!due) dataNeeded.push("Due date");
  if (input.evidenceComplete == null) dataNeeded.push("Whether the property evidence is complete");
  if (input.submitted == null) dataNeeded.push("Whether the order was submitted");
  if (input.submitted === true && input.payment == null) dataNeeded.push("Payment status");

  const facts = [
    `Client: ${blank(client)}.`,
    `Address: ${blank(address)}.`,
    `Homeowner: ${blank(homeowner)}.`,
    `Access: ${blank(access)}.`,
    due ? `Due: ${due.toISOString()}.` : "Due date: Data needed.",
    input.evidenceComplete === true
      ? "Property evidence was marked complete in this packet."
      : input.evidenceComplete === false
        ? "Property evidence was marked incomplete."
        : "Property evidence status was not stated.",
    input.submitted === true
      ? "Submission was marked done in this packet."
      : input.submitted === false
        ? "Submission was marked not done."
        : "Submission was not stated.",
  ];

  let nextAction: string;
  let followUp: CaptureOrderReview["followUp"];

  if (!client || !address) {
    nextAction = "Record the client and the address before you schedule anything.";
    followUp = { dueAt: null, trigger: "Schedule only after the client and address are on the order." };
  } else if (quote.feeBasis !== "agreed" || quote.conflicts.length) {
    nextAction = quote.recommendation;
    followUp = { dueAt: null, trigger: "Do not drive until the scope and the agreed fee are confirmed." };
  } else if (!homeowner || !access) {
    nextAction = "Get the homeowner contact and access before you drive.";
    followUp = { dueAt: due ? due.toISOString() : null, trigger: "Follow up on access before the due time." };
  } else if (input.evidenceComplete !== true) {
    nextAction = "Shoot the order, check the required property evidence, then submit it.";
    followUp = { dueAt: due ? due.toISOString() : null, trigger: "Submit by the due time on the order." };
  } else if (input.submitted !== true) {
    nextAction = "Evidence is marked complete. Submit the order.";
    followUp = { dueAt: due ? due.toISOString() : null, trigger: "Submit by the due time on the order." };
  } else if (input.payment === "paid") {
    nextAction = "Payment is marked paid. No invoice follow up from this packet.";
    followUp = { dueAt: null, trigger: "No collection follow up while payment is marked paid." };
  } else if (paymentDue && paymentDue.getTime() < now.getTime()) {
    nextAction = "The invoice is past the payment date in this packet. Follow up on the overdue invoice.";
    followUp = { dueAt: now.toISOString(), trigger: "Overdue invoice. Follow up now." };
  } else if (input.payment === "unpaid" || input.submitted === true) {
    nextAction = "Order is marked submitted. Record the payment due date if you have not, and follow up if it is still open.";
    followUp = {
      dueAt: paymentDue ? paymentDue.toISOString() : null,
      trigger: paymentDue ? "Follow up on the payment date if it is still unpaid." : "Set a payment due date, then follow up if unpaid.",
    };
  } else {
    nextAction = "Confirm submission and payment status before you treat this order as closed.";
    followUp = { dueAt: null, trigger: "Payment follow up waits on a real due date." };
  }

  return {
    sent: false,
    scheduled: false,
    client: blank(client),
    address: blank(address),
    scope: quote.scope,
    fee: quote.agreedFeeUsd !== null ? formatMoney(quote.agreedFeeUsd) : "Not agreed",
    distance: input.miles == null ? "Data needed" : `${input.miles} miles`,
    due: due ? due.toISOString() : "Data needed",
    homeowner: blank(homeowner),
    access: blank(access),
    quote,
    facts,
    dataNeeded,
    nextAction,
    followUp,
  };
}

export interface DriveStop {
  id: string;
  dueAt?: string | null;
  miles?: number | null;
  area?: string | null;
  accessReady?: boolean | null;
}

export function orderDrive(stops: DriveStop[]): { sent: false; scheduled: false; order: string[]; note: string } {
  const ranked = [...stops].sort((a, b) => {
    const access = Number(b.accessReady === true) - Number(a.accessReady === true);
    if (access) return access;
    const aDue = validDate(a.dueAt)?.getTime() ?? Number.POSITIVE_INFINITY;
    const bDue = validDate(b.dueAt)?.getTime() ?? Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;
    const aMiles = cleanNumber(a.miles) ?? Number.POSITIVE_INFINITY;
    const bMiles = cleanNumber(b.miles) ?? Number.POSITIVE_INFINITY;
    return aMiles - bMiles;
  });
  return {
    sent: false,
    scheduled: false,
    order: ranked.map((stop) => stop.id),
    note: "Drive order only. Access-ready stops come first, then earlier due times, then shorter distance. Nothing was booked.",
  };
}
