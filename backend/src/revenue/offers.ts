import { formatMoney } from "../os/money.js";
import { clean, nonNegativeNumber, positiveNumber, validDate } from "./facts.js";

export interface OfferDeadline {
  name?: string | null;
  date?: string | null;
  source?: string | null;
}

export interface OfferInput {
  price?: number | null;
  listPrice?: number | null;
  deposit?: number | null;
  inspectionDays?: number | null;
  financing?: "cash" | "financing" | null;
  preapproval?: "preapproved" | "prequalified" | "none" | "unknown" | null;
  appraisal?: string | null;
  sellerCredits?: number | null;
  closingDate?: string | null;
  deadlines?: OfferDeadline[];
}

export interface OfferMilestone {
  name: string;
  date: string | null;
  status: string;
}

export interface OfferResult {
  sent: false;
  recommendation: string;
  strongestPackage: string;
  terms: { label: string; value: string; basis: "stated" | "data needed" }[];
  milestones: OfferMilestone[];
  facts: string[];
  estimates: string[];
  dataNeeded: string[];
}

export function reviewOffer(input: OfferInput): OfferResult {
  const price = positiveNumber(input.price);
  const listPrice = positiveNumber(input.listPrice);
  const deposit = nonNegativeNumber(input.deposit);
  const inspectionDays = positiveNumber(input.inspectionDays);
  const financing = input.financing === "cash" || input.financing === "financing" ? input.financing : null;
  const preapproval = input.preapproval ?? null;
  const appraisal = clean(input.appraisal);
  const credits = nonNegativeNumber(input.sellerCredits);
  const closing = validDate(input.closingDate);
  const facts: string[] = [];
  const estimates: string[] = [];
  const dataNeeded: string[] = [];

  const term = (label: string, value: string | null, stated: string): { label: string; value: string; basis: "stated" | "data needed" } => {
    if (!value) {
      dataNeeded.push(label);
      return { label, value: "Data needed", basis: "data needed" };
    }
    facts.push(stated);
    return { label, value, basis: "stated" };
  };

  const terms = [
    term("Price", price === null ? null : formatMoney(price), `Price stated: ${formatMoney(price ?? 0)}.`),
    term("List price", listPrice === null ? null : formatMoney(listPrice), `List price stated: ${formatMoney(listPrice ?? 0)}.`),
    term("Deposit", deposit === null ? null : formatMoney(deposit), `Deposit stated: ${formatMoney(deposit ?? 0)}.`),
    term(
      "Inspection period",
      inspectionDays === null ? null : `${inspectionDays} days`,
      `Inspection period stated: ${inspectionDays} days.`,
    ),
    term("Financing", financing, `Financing stated: ${financing}.`),
    term("Appraisal", appraisal, `Appraisal term stated: ${appraisal}.`),
    term("Seller credits", credits === null ? null : formatMoney(credits), `Seller credits stated: ${formatMoney(credits ?? 0)}.`),
    term("Closing date", closing ? closing.toISOString() : null, `Closing date stated: ${closing?.toISOString()}.`),
  ];

  if (financing === "financing") {
    if (preapproval === "preapproved" || preapproval === "prequalified") {
      facts.push(`Preapproval stated: ${preapproval}.`);
      terms.push({ label: "Preapproval", value: preapproval, basis: "stated" });
    } else if (preapproval === "none") {
      facts.push("Preapproval stated: none.");
      terms.push({ label: "Preapproval", value: "none", basis: "stated" });
    } else {
      dataNeeded.push("Preapproval");
      terms.push({ label: "Preapproval", value: "Data needed", basis: "data needed" });
    }
  }

  const milestones: OfferMilestone[] = [];
  if (inspectionDays !== null) {
    milestones.push({
      name: "Inspection",
      date: null,
      status: `${inspectionDays} days were stated. No start date was supplied, so this is not a calendar deadline.`,
    });
  }
  if (closing) {
    milestones.push({
      name: "Closing",
      date: closing.toISOString(),
      status: "Date entered on the offer packet. It is not an executed deadline until the contract source is attached.",
    });
  }
  for (const item of input.deadlines ?? []) {
    const name = clean(item.name) ?? "Unnamed deadline";
    const date = validDate(item.date);
    const source = clean(item.source);
    if (date && source) {
      facts.push(`${name} on ${date.toISOString()}. Source: ${source}.`);
      milestones.push({ name, date: date.toISOString(), status: `Track it. Source: ${source}.` });
    } else if (date) {
      estimates.push(`${name} has a date and no source clause. Not treated as an executed deadline.`);
      milestones.push({
        name,
        date: date.toISOString(),
        status: "Date entered without a source clause. Not an executed deadline.",
      });
    } else {
      dataNeeded.push(name);
      milestones.push({ name, date: null, status: "No date. Not a deadline." });
    }
  }

  const stated = terms.filter((item) => item.basis === "stated").map((item) => `${item.label}: ${item.value}`);
  const strongestPackage = stated.length
    ? `Strongest defensible package is only what was stated. ${stated.join(". ")}.`
    : "No offer terms were stated.";

  let recommendation: string;
  if (price === null) {
    recommendation = "Do not write the offer. The price is not set.";
  } else if (financing === null) {
    recommendation = "Do not tell the seller this is cash or financed. The packet does not say which.";
  } else if (financing === "financing" && preapproval !== "preapproved") {
    recommendation = "Do not call the financing a strength. Preapproval was not stated. Write only the terms that are filled in.";
  } else if (financing === "cash") {
    recommendation = "Cash is the strength, because the packet says cash. Do not add a shorter inspection, a larger deposit, or an appraisal waiver that was not supplied.";
  } else {
    recommendation = "Preapproval is stated. Write that, and do not add terms that are still Data needed.";
  }

  if (deposit === null) estimates.push("No deposit was invented.");
  if (credits === null) estimates.push("No seller credit was invented.");

  return {
    sent: false,
    recommendation,
    strongestPackage,
    terms,
    milestones,
    facts,
    estimates,
    dataNeeded,
  };
}
