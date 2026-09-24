import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./server.js";

test("the command center does not mount the inquiry board or a send route", async () => {
  delete process.env.ENABLE_LEAD_DESK;
  const app = createApp();
  const server = app.listen(0);
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No port");
    const base = `http://127.0.0.1:${address.port}`;

    const home = await fetch(base);
    const body = (await home.json()) as { product: string; leadDesk: string; messaging: string };
    assert.equal(home.status, 200);
    assert.equal(body.product, "South Florida Buyer Command Center");
    assert.match(body.leadDesk, /Not mounted/);
    assert.match(body.messaging, /No client messaging/);

    const health = await fetch(`${base}/health`);
    const healthBody = (await health.json()) as { leadDeskMounted: boolean };
    assert.equal(healthBody.leadDeskMounted, false);

    const desk = await fetch(`${base}/api/os/workspace`);
    assert.equal(desk.status, 404);
    const send = await fetch(`${base}/api/os/drafts/any/send`, { method: "POST" });
    assert.equal(send.status, 404);

    const hiram = await fetch(`${base}/mls/hiram-zone`);
    const zone = (await hiram.json()) as { demo: boolean; notice: string; totals: { active: number } };
    assert.equal(zone.demo, true);
    assert.match(zone.notice, /DEMO seed/);
    assert.equal(zone.totals.active, 18);

    const empty = await fetch(`${base}/mls/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feeds: [] }),
    });
    assert.equal(empty.status, 400);
  } finally {
    server.close();
  }
});
