import assert from "node:assert/strict";
import test from "node:test";
import { analyzeMlsFeeds, getHiramSeedAnalysis, type MlsListing } from "./mlsAnalyzer.js";

const base: MlsListing = {
  mlsId: "A1",
  address: "1 Main St",
  zip: "33127",
  listPrice: 400_000,
  status: "active",
  propertyType: "duplex",
  dom: 10,
};

test("duplicate listings collapse and under-contract rows stay out of the ranked set", () => {
  const result = analyzeMlsFeeds([
    [base],
    [
      { ...base, dom: 40, priceCutPercent: 5 },
      { ...base, mlsId: "A2", address: "2 Main St", status: "under_contract", listPrice: 300_000, dom: 12 },
    ],
  ]);
  assert.equal(result.demo, false);
  assert.match(result.notice, /not a live MLS/i);
  assert.equal(result.totals.allListings, 2);
  assert.equal(result.totals.underContractFilteredOut, 1);
  assert.equal(result.ranked.length, 1);
  assert.equal(result.ranked[0]?.dom, 40);
  assert.equal(result.ranked[0]?.status, "active");
});

test("the Hiram zone payload is labeled demo and keeps 18 active rows", () => {
  const seed = getHiramSeedAnalysis();
  assert.equal(seed.demo, true);
  assert.match(seed.notice, /DEMO seed/);
  assert.equal(seed.totals.allListings, 20);
  assert.equal(seed.totals.active, 18);
  assert.equal(seed.totals.underContractFilteredOut, 2);
  assert.ok(seed.ranked.every((row) => row.status === "active"));
  assert.equal(seed.topSignals.length <= 6, true);
});
