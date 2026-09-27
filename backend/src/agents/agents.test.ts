import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../server.js";
import { runConsult } from "./consult.js";
import { runAgent } from "./router.js";

test("consult scores only known answers and does not treat a blank as approved", () => {
  const result = runConsult({ motivation: "Lease Expiring", timeline: "30-60 Days" });
  assert.equal(result.agent, "consult");
  assert.ok(result.missing.includes("Financing"));
  assert.match(result.summary, /Financing was not stated/);
  assert.match(result.next, /not approval/i);
  assert.equal((result.data as { sendsMessage: boolean }).sendsMessage, false);
  const scored = result.data as { readinessPercent: number };
  assert.equal(scored.readinessPercent, 18 + 16);
});

test("need lender does not become an approval or a message", () => {
  const result = runConsult({ financing: "Need Lender", motivation: "Browsing" });
  assert.match(result.next, /not an approval/i);
  assert.match(result.next, /Do not send a lender script/);
  assert.equal(JSON.stringify(result).includes("ONE+"), false);
});

test("a stated pre-approval is kept as what they said", () => {
  const result = runConsult({ financing: "Fully Pre-Approved" });
  assert.match(result.next, /did not see a letter/);
});

test("the desk refuses an inquiry draft and routes a consult", async () => {
  const refused = await runAgent("desk", { intent: "draft a text for this new inquiry" });
  assert.equal(refused.status, "refused");
  assert.match(refused.summary, /does not draft or send/);

  const consult = await runAgent("desk", { intent: "score this buyer consult", answers: { financing: "Cash" } });
  assert.equal((consult.data as { routedTo: string }).routedTo, "consult");
  assert.equal(consult.stated[0]?.value, "Cash");
});

test("market without a cache invents no prices, and the demo MLS seed stays labeled", async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const market = await runAgent("market", { city: "Hialeah" });
  assert.equal(market.status, "blocked");
  assert.equal(JSON.stringify(market).includes("$"), false);

  const seed = await runAgent("mls", { demoSeed: true });
  assert.equal(seed.demo, true);
  assert.match(seed.summary, /DEMO seed/);

  const empty = await runAgent("mls", {});
  assert.equal(empty.status, "refused");
});

test("the agents are on the command center and still do not mount the inquiry board", async () => {
  delete process.env.ENABLE_LEAD_DESK;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const app = createApp();
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No port");
    const base = `http://127.0.0.1:${address.port}`;
    const list = await fetch(`${base}/agents`);
    const body = (await list.json()) as { agents: { name: string }[]; messaging: string };
    assert.deepEqual(
      body.agents.map((agent) => agent.name),
      ["consult", "market", "mls"],
    );
    assert.match(body.messaging, /do not send/i);
    const desk = await fetch(`${base}/api/os/workspace`);
    assert.equal(desk.status, 404);
    const send = await fetch(`${base}/agents/desk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "send the follow up text" }),
    });
    assert.equal(send.status, 400);
  } finally {
    server.close();
  }
});
