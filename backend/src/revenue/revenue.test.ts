import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../server.js";
import { orderDrive, quoteCapture, reviewCaptureOrder } from "./capture.js";
import { reviewEvidence, reviewInsight, scoreboard } from "./lanes.js";
import { reviewOffer } from "./offers.js";
import { monthlyPrincipalAndInterest, reviewPricing } from "./pricing.js";
import { prioritize } from "./priority.js";
import { runProcedure } from "./procedure.js";

const WEDNESDAY_AFTERNOON = new Date("2026-09-23T18:00:00.000Z");

test("a new lead gets one question and no assumed search", () => {
  const result = runProcedure(
    {
      person: "Maria Lopez",
      phone: "305-555-0100",
      leadSource: "Redfin",
      property: "123 Ocean Dr",
      lastContact: {
        actor: "coordinator",
        at: "2026-09-26T15:00:00.000Z",
        channel: "text",
        summary: "Coordinator sent an intro text.",
      },
      activity: "Saved 4 homes",
    },
    WEDNESDAY_AFTERNOON,
  );

  assert.equal(result.sent, false);
  assert.equal(result.stored, false);
  assert.equal(result.kyleHasContacted, false);
  assert.match(result.nextAction, /Contact Maria Lopez yourself/);
  assert.match(result.nextAction, /coordinator/i);
  assert.equal(result.draft?.channel, "text");
  assert.equal(result.draft?.sent, false);
  assert.equal(result.draft?.objective, "Learn why they reached out.");
  assert.equal(
    result.draft?.body,
    "Hey Maria, Kyle Kleinman with Redfin. I saw your request for 123 Ocean Dr. What has you looking right now?",
  );
  assert.doesNotMatch(result.draft?.body ?? "", /search|tour|preapproved/i);
  assert.ok(result.distinctions.some((line) => /Coordinator contact is not your contact/.test(line)));
  assert.ok(result.distinctions.some((line) => /activity is not proven motivation/.test(line)));
  assert.match(result.agentToolsNote, /Nothing was sent/);
  assert.match(result.agentToolsNote, /Confirmed: no|Tour time/);
  assert.match(result.agentToolsNote, /Coordinator, not Kyle/);
  assert.equal(result.likelyValueBasis, "data needed");
  assert.ok(result.followUp.dueAt);
});

test("a tour request is not treated as a confirmed appointment", () => {
  const result = runProcedure(
    { person: "Luis Gomez", phone: "305-555-0111", tourRequested: "Tuesday 5:30" },
    WEDNESDAY_AFTERNOON,
  );
  assert.match(result.draft?.body ?? "", /Does Tuesday 5:30 work for you if I can get it confirmed\?/);
  assert.doesNotMatch(result.agentToolsNote, /Showing confirmed|Tour confirmed: Tuesday/);
  assert.match(result.agentToolsNote, /Confirmed: no/);
  assert.equal(result.stage, "tour_requested");
  assert.equal(result.followUp.dueAt, new Date(WEDNESDAY_AFTERNOON.getTime() + 2 * 60 * 60 * 1000).toISOString());
});

test("confirmed criteria create a search step and attach no listings", () => {
  const result = runProcedure(
    {
      person: "Sam Patel",
      phone: "305-555-0199",
      leadSource: "Redfin",
      motivation: "Lease ends in May",
      location: "Miami Beach",
      criteria: "2 bed condo",
      budget: "$650K",
      payment: "cash",
      timeline: "30-60 days",
      decisionMakers: "Just me",
      conversation: "continuing",
      likelyValueUsd: 8000,
      valueBasis: "estimate",
    },
    WEDNESDAY_AFTERNOON,
  );
  assert.match(result.nextAction, /Create the property search and alerts/);
  assert.match(result.nextAction, /none are attached/);
  assert.equal(result.draft?.body, "I am setting your search to Miami Beach, 2 bed condo, $650K. Tell me if any of that is off.");
  assert.equal(result.draft?.objective, "Confirm the criteria, then create the search and alerts.");
  assert.equal(result.likelyValueBasis, "estimate");
  assert.ok(!result.dataNeeded.includes("Preapproval"));
});

test("opt out, missing person, and Spanish stay strict", () => {
  const opted = runProcedure({ person: "Ada Lopez", phone: "305-555-0101", optOut: true });
  assert.equal(opted.draft, null);
  assert.match(opted.nextAction, /Do not contact/);

  const unnamed = runProcedure({ phone: "305-555-0102", property: "9 Bay Rd" });
  assert.equal(unnamed.draft, null);
  assert.match(unnamed.nextAction, /Identify the person/);

  const spanish = runProcedure({ person: "Maria Lopez", phone: "305-555-0100", language: "es" });
  assert.match(spanish.draft?.body ?? "", /^Hola Maria/);
  assert.match(spanish.draft?.body ?? "", /¿Qué te tiene buscando ahora\?/);

  const english = runProcedure({ person: "Maria Lopez", phone: "305-555-0100", location: "Hialeah" });
  assert.match(english.draft?.body ?? "", /^Hey Maria/);
  assert.doesNotMatch(english.draft?.body ?? "", /Hola|¿/);
});

test("a conflict is asked before a search is created", () => {
  const result = runProcedure({
    person: "Maria Lopez",
    phone: "305-555-0100",
    motivation: "Relocating",
    location: "Coral Gables",
    criteria: "house",
    budget: "$700K",
    payment: "cash",
    timeline: "this month",
    decisionMakers: "Just me",
    conflicts: [{ field: "budget", values: ["$700K", "$900K"] }],
  });
  assert.match(result.nextAction, /Resolve the conflict on budget/);
  assert.match(result.draft?.body ?? "", /Which one is right\?/);
  assert.doesNotMatch(result.nextAction, /Create the property search/);
});

test("capture quotes use the rate card and do not invent an agreed fee", () => {
  const standard = quoteCapture({ scope: "standard_v2", homestead: true, miles: 8 });
  assert.equal(standard.benchmarkUsd, 100);
  assert.equal(standard.agreedFeeUsd, null);
  assert.equal(standard.feeToCollectUsd, null);
  assert.equal(standard.feeBasis, "benchmark_not_agreed");

  const far = quoteCapture({ scope: "nearby_exterior", miles: 20 });
  assert.ok(far.conflicts.length > 0);
  assert.equal(far.benchmarkUsd, null);

  const beyond = quoteCapture({ scope: "exterior_beyond_15", miles: 18 });
  assert.equal(beyond.benchmarkUsd, 65);

  const scan = quoteCapture({ scope: "scan", agreedFeeUsd: 0 });
  assert.equal(scan.benchmarkUsd, null);
  assert.equal(scan.agreedFeeUsd, null);
  assert.match(scan.recommendation, /custom/i);

  const agreed = quoteCapture({ scope: "standard_v2", agreedFeeUsd: 120, miles: 4 });
  assert.equal(agreed.feeBasis, "agreed");
  assert.equal(agreed.feeToCollectUsd, 120);

  const order = reviewCaptureOrder({
    client: "Capture Data",
    address: "10 Palm Ave",
    scope: "standard_v2",
    miles: 6,
  });
  assert.equal(order.scheduled, false);
  assert.match(order.nextAction, /not the fee until you confirm/i);
  assert.equal(order.fee, "Not agreed");

  const drive = orderDrive([
    { id: "late", dueAt: "2026-09-30T15:00:00.000Z", miles: 4, accessReady: true },
    { id: "blocked", dueAt: "2026-09-24T15:00:00.000Z", miles: 1, accessReady: false },
    { id: "soon", dueAt: "2026-09-24T15:00:00.000Z", miles: 3, accessReady: true },
  ]);
  assert.deepEqual(drive.order, ["soon", "late", "blocked"]);
  assert.equal(drive.scheduled, false);
});

test("pricing stays inside verified sales and blocks unchecked short term rent", () => {
  const empty = reviewPricing({ subject: "10 Palm Ave" });
  assert.match(empty.recommendation, /Do not price 10 Palm Ave/);
  assert.equal(empty.saleRange, null);
  assert.equal(empty.monthlyCost, null);

  const str = reviewPricing({
    subject: "10 Palm Ave",
    strIncomeMonthly: 4000,
    longTermRentMonthly: 2500,
    rentalRestriction: "unchecked",
    sales: [{ address: "12 Palm Ave", closePrice: 400000, closeDate: "2026-08-01", source: "closed MLS export" }],
  });
  assert.equal(str.strIncomeUsed, false);
  assert.match(str.recommendation, /rental restrictions/i);
  assert.match(str.rejected.join(" "), /not used/i);

  const priced = reviewPricing({
    subject: "10 Palm Ave",
    condition: "Updated kitchen, original roof",
    hoaMonthly: 0,
    assessments: 0,
    taxesAnnual: 6000,
    insuranceAnnual: 4800,
    repairs: 15000,
    financingRateAnnual: 0.07,
    downPayment: 80000,
    termYears: 30,
    price: 400000,
    rentalRestriction: "str_prohibited",
    longTermRentMonthly: 2800,
    sales: [
      { address: "12 Palm", closePrice: 390000, closeDate: "2026-07-01", source: "closed sale", condition: "similar" },
      { address: "14 Palm", closePrice: 410000, closeDate: "2026-08-01", source: "closed sale", condition: "similar" },
      { address: "16 Palm", closePrice: 405000, closeDate: "2026-08-15", source: "closed sale", condition: "similar" },
    ],
    listings: [{ address: "18 Palm", listPrice: 425000, status: "active", source: "listing sheet", asOf: "2026-09-20" }],
  });
  assert.equal(priced.saleRange?.low, 390000);
  assert.equal(priced.saleRange?.high, 410000);
  assert.ok(priced.monthlyCost && priced.monthlyCost > 3000);
  assert.equal(priced.strIncomeUsed, false);
  assert.match(priced.recommendation, /\$390K to \$410K/);
  assert.match(priced.downside, /\$15,000|\$15K/);
  assert.ok(priced.estimates.some((line) => /Not a CMA/.test(line)));

  const payment = monthlyPrincipalAndInterest(320000, 0.07, 30);
  assert.ok(Math.abs(payment - 2129.07) < 1);

  const thin = reviewPricing({
    subject: "10 Palm Ave",
    sales: [{ address: "no source", closePrice: 1, closeDate: "2026-01-01" }],
  });
  assert.equal(thin.saleRange, null);
  assert.ok(thin.rejected.length > 0);
});

test("offer terms stay inside the packet", () => {
  const offer = reviewOffer({
    price: 640000,
    listPrice: 650000,
    financing: "cash",
    inspectionDays: 10,
    closingDate: "2026-11-15",
  });
  assert.match(offer.recommendation, /Cash is the strength/);
  assert.match(offer.strongestPackage, /Price: \$640K/);
  assert.ok(offer.terms.some((term) => term.label === "Deposit" && term.basis === "data needed"));
  assert.ok(offer.estimates.some((line) => /No deposit was invented/.test(line)));
  assert.ok(offer.milestones.some((item) => item.name === "Inspection" && item.date === null));
  assert.equal(offer.sent, false);

  const financed = reviewOffer({ price: 500000, financing: "financing" });
  assert.match(financed.recommendation, /Do not call the financing a strength/);
});

test("priority uses expected value per hour and keeps deadlines visible", () => {
  const board = prioritize(
    [
      {
        id: "invoice",
        label: "Palm invoice",
        lane: "capture",
        expectedRevenueUsd: 90,
        probability: 1,
        timeHours: 1,
        deadline: "2026-09-20T15:00:00.000Z",
        nextAction: "Follow up on the overdue invoice.",
      },
      {
        id: "buyer",
        label: "Sam Patel",
        lane: "redfin",
        expectedRevenueUsd: 8000,
        probability: 0.4,
        timeHours: 3,
        deadline: "2026-10-20T15:00:00.000Z",
        nextAction: "Text Sam the one open question.",
      },
      { id: "vague", label: "Unpriced lead", lane: "redfin", nextAction: "Get a value before you rank this." },
    ],
    WEDNESDAY_AFTERNOON,
  );
  assert.equal(board.next?.id, "buyer");
  assert.match(board.nextStep, /Text Sam/);
  assert.match(board.nextStep, /Also due: Palm invoice/);
  assert.equal(board.dueNow[0]?.id, "invoice");
  assert.equal(board.ordered.at(-1)?.id, "vague");
  assert.match(board.method, /not a forecast/);

  const bad = prioritize([{ id: "x", label: "Bad odds", probability: 70, expectedRevenueUsd: 1000, timeHours: 1 }]);
  assert.equal(bad.next?.expectedValueUsd, null);
  assert.ok(bad.skipped.some((line) => /probability/.test(line)));
});

test("evidence, pulse, and the scoreboard do not invent results", () => {
  const blocked = reviewEvidence({
    address: "10 Palm Ave",
    observations: [
      { field: "roof", value: "tile" },
      { field: "roof", value: "shingle" },
    ],
  });
  assert.equal(blocked.sellablePilot, false);
  assert.equal(blocked.attestationStatus, "missing");
  assert.equal(blocked.conflicts.length, 1);
  assert.match(blocked.nextAction, /attestation/);

  const ready = reviewEvidence({
    address: "10 Palm Ave",
    collectedAt: "2026-09-20T18:00:00.000Z",
    collector: "Kyle Kleinman",
    attestation: "I collected these photos and observations.",
    photos: [{ id: "front" }],
    observations: [{ field: "roof", value: "tile", photoId: "front" }],
  });
  assert.equal(ready.sellablePilot, true);
  assert.equal(ready.attestation, "I collected these photos and observations.");
  assert.match(ready.nextAction, /not a sale/);

  const unpublished = reviewInsight({ change: "Rents rose", implication: "Buyers may wait." });
  assert.equal(unpublished.publishable, false);
  assert.equal(unpublished.clientsProduced, "Not measured");

  const published = reviewInsight({
    topic: "rents",
    change: "Median rent on the supplied sheet rose 4%.",
    source: "County rent sheet, September",
    asOf: "2026-09-01",
    implication: "A cash-flow deal needs a lower price to survive that rent.",
    clientsProduced: 0,
  });
  assert.equal(published.publishable, true);
  assert.match(published.implication, /^Interpretation/);
  assert.equal(published.dealsProduced, "Not measured");

  const board = scoreboard();
  assert.equal(board.closings, "Data needed");
  assert.equal(board.volumeUsd, "Data needed");
  assert.equal(board.netIncomeUsd, "Data needed");
  assert.equal(board.target.netUsd, 250_000);
  assert.match(board.nextAction, /target/);
  assert.doesNotMatch(board.closings, /^0$/);
});

test("the revenue routes do not send or store a lead", async () => {
  delete process.env.ENABLE_LEAD_DESK;
  const app = createApp();
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No port");
    const base = `http://127.0.0.1:${address.port}`;
    const res = await fetch(`${base}/revenue/procedure`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ person: "Maria Lopez", phone: "305-555-0100", now: WEDNESDAY_AFTERNOON.toISOString() }),
    });
    const body = (await res.json()) as { sent: boolean; stored: boolean; draft: { body: string; sent: boolean } };
    assert.equal(res.status, 200);
    assert.equal(body.sent, false);
    assert.equal(body.stored, false);
    assert.equal(body.draft.sent, false);
    assert.doesNotMatch(body.draft.body, /—|–|\s-\s/);

    const page = await fetch(`${base}/revenue/desk`);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /Prepare the next step/);
    assert.match(html, /Nothing was sent|nothing was sent|will not text/i);
  } finally {
    server.close();
  }
});
