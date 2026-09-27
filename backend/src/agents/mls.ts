import { analyzeMlsFeeds, getHiramSeedAnalysis, type MlsListing } from "../lib/mlsAnalyzer.js";
import type { AgentResult } from "./types.js";

export function runMls(input: { feeds?: MlsListing[][]; config?: { targetZip?: string; maxBudget?: number }; demoSeed?: boolean }): AgentResult {
  if (input.demoSeed) {
    const seed = getHiramSeedAnalysis();
    return {
      agent: "mls",
      status: "ok",
      demo: true,
      summary: seed.notice,
      stated: [{ label: "Source", value: "Hiram demo seed" }],
      missing: ["Live MLS feed"],
      next: "Use this only as a demo. Do not tell a client these homes are available.",
      data: seed,
    };
  }
  if (!Array.isArray(input.feeds) || input.feeds.length === 0) {
    return {
      agent: "mls",
      status: "refused",
      demo: false,
      summary: "No listings were supplied, and the demo seed was not requested.",
      stated: [],
      missing: ["Listings"],
      next: "Paste an authorized MLS export, or set demoSeed true for the labeled sample.",
    };
  }
  const analysis = analyzeMlsFeeds(input.feeds, input.config ?? {});
  return {
    agent: "mls",
    status: "ok",
    demo: false,
    summary: `${analysis.notice} ${analysis.totals.active} active of ${analysis.totals.allListings}. ${analysis.totals.underContractFilteredOut} under contract were left out of the ranking.`,
    stated: [{ label: "Listings supplied", value: String(analysis.totals.allListings) }],
    missing: analysis.totals.allListings === 0 ? ["Listings"] : [],
    next: "Review the top rows. A high score is a signal, not a confirmed deal.",
    data: analysis,
  };
}
