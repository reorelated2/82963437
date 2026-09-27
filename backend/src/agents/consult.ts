import type { AgentResult } from "./types.js";

const WEIGHTS: Record<string, Record<string, number>> = {
  motivation: {
    "Job/Relocation": 20,
    "Lease Expiring": 18,
    "Need Space": 14,
    Investing: 16,
    Browsing: 4,
  },
  timeline: { ASAP: 20, "30-60 Days": 16, "60-90 Days": 10, "90+ Days": 5 },
  sellToBuy: { "Yes-Listed": 12, "Yes-Unlisted": 8, No: 14, Renting: 10 },
  financing: {
    "Fully Pre-Approved": 20,
    "Pre-Qualified": 14,
    "Need Lender": 8,
    Cash: 20,
  },
  targetCity: { Hialeah: 8, "Miami Lakes": 8, Custom: 5 },
  propertyType: { SFH: 6, Condo: 5, Townhome: 5, Multi: 8 },
  targetPrice: { "Under $300K": 6, "$300K-$450K": 8, "$450K-$650K": 8, "$650K+": 6 },
};

const ORDER = ["financing", "timeline", "motivation", "targetCity", "propertyType", "targetPrice", "sellToBuy"] as const;

const LABELS: Record<(typeof ORDER)[number], string> = {
  financing: "Financing",
  timeline: "Timeline",
  motivation: "Motivation",
  targetCity: "Target city",
  propertyType: "Property type",
  targetPrice: "Target price",
  sellToBuy: "Sell to buy",
};

const QUESTIONS: Record<(typeof ORDER)[number], string> = {
  financing: "Ask how they plan to pay. Need Lender is not approval, and blank is not a no.",
  timeline: "Ask when they want to be in a place.",
  motivation: "Ask what is making them move.",
  targetCity: "Ask which city they want.",
  propertyType: "Ask whether they want a house, condo, townhome, or multi.",
  targetPrice: "Ask the price range to stay inside.",
  sellToBuy: "Ask whether they have to sell a home first.",
};

export function runConsult(answers: Record<string, unknown> | null | undefined): AgentResult {
  const source = answers && typeof answers === "object" ? answers : {};
  const stated: { label: string; value: string }[] = [];
  const missing: string[] = [];
  const unclear: string[] = [];
  let earned = 0;

  for (const field of ORDER) {
    const raw = source[field];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) {
      missing.push(LABELS[field]);
      continue;
    }
    const points = WEIGHTS[field]?.[value];
    if (points === undefined) {
      unclear.push(`${LABELS[field]} was "${value}", which is not a known choice. It was not scored.`);
      continue;
    }
    stated.push({ label: LABELS[field], value });
    earned += points;
  }

  const readinessPercent = Math.min(100, earned);
  const financing = stated.find((item) => item.label === "Financing")?.value ?? null;
  const firstGap = ORDER.find((field) => missing.includes(LABELS[field]));
  let next = firstGap ? QUESTIONS[firstGap] : "The consult answers are filled in. Review them with Kyle before the next appointment.";
  if (financing === "Need Lender") {
    next = "They said they need a lender. That is not an approval. Do not send a lender script from this agent.";
  }
  if (financing === "Pre-Qualified") {
    next = "They said pre-qualified. That is not underwriting approval. Confirm the letter before you treat the loan as done.";
  }
  if (financing === "Fully Pre-Approved") {
    next = "They said fully pre-approved. This agent did not see a letter. Treat it as what they said, not as a verified approval.";
  }

  const summary = [
    `Readiness ${readinessPercent} from stated answers only.`,
    financing ? `Financing stated: ${financing}.` : "Financing was not stated.",
    unclear.length ? unclear.join(" ") : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    agent: "consult",
    status: "ok",
    demo: false,
    summary,
    stated,
    missing,
    next,
    data: { readinessPercent, unclear, sendsMessage: false },
  };
}
