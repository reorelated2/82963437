import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAgent } from "../src/agent.mjs";
import { decide } from "../src/decisions.mjs";
import { evaluate } from "../src/economics.mjs";
import { banReason, scoreOpportunity } from "../src/scoring.mjs";
import { start } from "../src/server.mjs";
import { openStore } from "../src/store.mjs";

test("javascript economics match the python examples", () => {
  const python = spawnSync("python3", ["playbook/tools/unit_economics.py", "--json"], { encoding: "utf8", cwd: join(import.meta.dirname, "..", "..", "..") });
  assert.equal(python.status, 0, python.stderr);
  const rows = JSON.parse(python.stdout);
  const examples = [
    ["BAD commodity organizer", { price: 12.99, grams: 90, print_minutes: 210, filament_per_kg: 20, fail_rate: 0.15, ship_weight_oz: 6, channel: "fba", tacoss: 0.25, return_rate: 0.1, labor_minutes: 12, packaging: 0.55 }],
    ["CASE STUDY cycle knob Amazon FBM", { price: 27.99, grams: 22, print_minutes: 30, filament_per_kg: 18, fail_rate: 0.08, ship_weight_oz: 3, channel: "fbm", tacoss: 0, return_rate: 0.1, labor_minutes: 10, packaging: 0.65, postage: 4.25 }],
    ["KILLED dishwasher clip single FBA", { price: 8.99, grams: 8, print_minutes: 25, filament_per_kg: 24, fail_rate: 0.12, ship_weight_oz: 2, channel: "fba", tacoss: 0.15, return_rate: 0.12, labor_minutes: 8, packaging: 0.4 }],
  ];
  for (const [name, input] of examples) {
    const expected = rows.find((row) => row.name === name);
    const actual = evaluate({ name, ...input });
    for (const key of ["cash_contribution", "cash_profit_per_printer_hour", "contribution_after_owner_labor", "marketplace_fees"]) {
      assert.equal(actual[key], expected[key], `${name} ${key}`);
    }
  }
});

test("safety and brand clones are killed on intake", () => {
  const agent = createAgent(openStore(":memory:"));
  const result = agent.intake({ product: "Baby gate hinge", problem: "The gate mount broke", phrase: "baby gate hardware" });
  assert.equal(result.opportunity.verdict, "KILL");
  assert.match(result.opportunity.hardKill, /child|gate/i);
  assert.equal(banReason("packout mount"), "Branded system clone.");
});

test("a knob cannot skip the sold sheet, the patent note, or the calipers", () => {
  const agent = createAgent(openStore(":memory:"));
  const first = agent.run("cycle-knob");
  assert.equal(first.stopped, "need-evidence");
  assert.equal(first.opportunity.volume_note, "not verified");

  const sold = Array.from({ length: 10 }, (_, index) => ({ price: 26 + index, title: "dryer knob", shaftVisible: true }));
  const second = agent.evidence("cycle-knob", {
    ebaySold: sold,
    amazon: [{ price: 29, reviews: 12, stars: 4.2, seller: "aftermarket" }],
  });
  assert.equal(second.stopped, "need-patent");
  assert.ok(second.opportunity.economics.cash_profit_per_printer_hour >= 25);

  const third = agent.evidence("cycle-knob", {
    patentNote: "Searched dryer knob on Google Patents. No active patent found that reads on a plain D-shaft knob.",
  });
  assert.equal(third.stopped, "need-measurement");
  assert.match(third.opportunity.artifacts.cadBrief, /Donor not measured/);

  const fourth = agent.measure("cycle-knob", { shaft: "D-shaft 6.2 mm", reading_2: "6.1 mm", reading_3: "6.2 mm", models: "MODEL YOU SELECT" });
  assert.equal(fourth.stopped, "need-fit");

  const fifth = agent.fit("cycle-knob", { passed: true, grams: 22, minutes: 30, notes: "fits the donor" });
  assert.equal(fifth.opportunity.stage, "listing");
  assert.equal(fifth.opportunity.artifacts.listing.inventory_to_print, 0);
  assert.match(fifth.opportunity.artifacts.listing.title, /MODEL YOU SELECT/);
  assert.doesNotMatch(JSON.stringify(fifth.opportunity), /units per month/i);
});

test("cheap median sold prices kill the row", () => {
  const agent = createAgent(openStore(":memory:"));
  const sold = Array.from({ length: 10 }, () => ({ price: 7.5, title: "clip", shaftVisible: true }));
  const result = agent.evidence("dishwasher-clip", { ebaySold: sold, amazon: [{ price: 6.52, reviews: 23, stars: 4.5 }] });
  assert.equal(result.stopped, "killed");
  assert.match(result.message, /under \$18/);
});

test("decision rules", () => {
  assert.equal(decide({ units: 20, returnRate: 0.2 }).verdict, "KILL");
  assert.equal(decide({ units: 25, returnRate: 0.09 }).verdict, "IMPROVE");
  assert.equal(decide({ units: 20, returnRate: 0.04, hour: 36 }).verdict, "SCALE");
  assert.equal(decide({ safetyRisk: true }).verdict, "KILL");
  const scored = scoreOpportunity({
    product: "hook",
    price: 12,
    economics: evaluate({ price: 12.99, grams: 90, print_minutes: 210, filament_per_kg: 20, fail_rate: 0.15, ship_weight_oz: 6, channel: "fba", tacoss: 0.25, return_rate: 0.1, labor_minutes: 12, packaging: 0.55 }),
    grams: 90,
    minutes: 210,
    material: "PLA",
    donorInHand: true,
    patentCleared: true,
    failureMode: "inconvenience",
  });
  assert.equal(scored.verdict, "KILL");
});

test("http workflow serves the console and runs an opportunity", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "parts-")), "agent.sqlite");
  const { server } = start({ file });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const health = await fetch(`http://127.0.0.1:${port}/api/health`).then((response) => response.json());
  assert.equal(health.product, "parts-agent");
  const page = await fetch(`http://127.0.0.1:${port}/`).then((response) => response.text());
  assert.match(page, /Parts agent/);
  const state = await fetch(`http://127.0.0.1:${port}/api/state`).then((response) => response.json());
  assert.equal(state.opportunities.length, 30);
  assert.equal(state.kpis.volume_note, "not verified");
  const banned = await fetch(`http://127.0.0.1:${port}/api/intake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ product: "Garage door sensor bracket", problem: "Sensor fell", phrase: "garage door sensor bracket" }),
  }).then((response) => response.json());
  assert.equal(banned.opportunity.verdict, "KILL");
  server.close();
});
