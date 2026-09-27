import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Express, NextFunction, Request, Response } from "express";
import { CAPTURE_BENCHMARKS, orderDrive, quoteCapture, reviewCaptureOrder, type CaptureQuoteInput, type CaptureOrderInput, type DriveStop } from "./capture.js";
import { reviewOffer, type OfferInput } from "./offers.js";
import { NET_TARGET, reviewEvidence, reviewInsight, scoreboard, type EvidenceInput, type PulseInput, type ScoreboardInput } from "./lanes.js";
import { reviewPricing, type PricingInput } from "./pricing.js";
import { prioritize, type WorkItem } from "./priority.js";
import { runProcedure, type LeadPacket } from "./procedure.js";
import { validDate } from "./facts.js";

const deskPage = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../public/revenue.html");

export function revenuePlaybook() {
  return {
    product: "Revenue operations",
    sent: false,
    stored: false,
    messaging: "No client messaging on this server.",
    writesToRedfin: false,
    target: NET_TARGET,
    scoreboard: scoreboard(),
    pipeline: "No live lead, Capture order, or deal is loaded. This desk does not keep a database.",
    nextStep:
      "Paste the hottest open Redfin thread, Capture assignment, or property you are pricing. Contact that person yourself. This server will not text them.",
    benchmarks: CAPTURE_BENCHMARKS,
    customPricing: "Scans, rush work, and long trips are custom. Confirm the scope and the agreed fee on every order.",
    rules: [
      "Contact the person before you assume what they want.",
      "Ask motivation, location, criteria, budget, cash or financing, preapproval, timeline, and decision makers one question at a time.",
      "Create a search only after those criteria are confirmed. This server has no live MLS feed.",
      "Coordinator contact is not your contact. A tour request is not a confirmed appointment. Portal activity is not proven motivation.",
      "Do not use short term rental income until rental restrictions are checked.",
      "Do not invent a price, a comp, a deposit, or a completed action.",
    ],
  };
}

function nowFrom(body: { now?: unknown }): Date {
  return validDate(body.now) ?? new Date();
}

function asyncRoute(handler: (req: Request, res: Response) => void) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      handler(req, res);
    } catch (error) {
      next(error);
    }
  };
}

export function mountRevenue(app: Express): void {
  app.get("/revenue", (_req, res) => {
    res.json(revenuePlaybook());
  });

  app.get("/revenue/desk", (_req, res) => {
    res.sendFile(deskPage);
  });

  app.post("/revenue/procedure", asyncRoute((req, res) => {
    const body = (req.body ?? {}) as LeadPacket & { now?: string };
    res.json(runProcedure(body, nowFrom(body)));
  }));

  app.post("/revenue/prioritize", asyncRoute((req, res) => {
    const body = (req.body ?? {}) as { items?: WorkItem[]; now?: string };
    res.json(prioritize(Array.isArray(body.items) ? body.items : [], nowFrom(body)));
  }));

  app.post("/revenue/capture/quote", asyncRoute((req, res) => {
    res.json(quoteCapture((req.body ?? {}) as CaptureQuoteInput));
  }));

  app.post("/revenue/capture/order", asyncRoute((req, res) => {
    const body = (req.body ?? {}) as CaptureOrderInput & { now?: string };
    res.json(reviewCaptureOrder(body, nowFrom(body)));
  }));

  app.post("/revenue/capture/drive", asyncRoute((req, res) => {
    const body = (req.body ?? {}) as { stops?: DriveStop[] };
    res.json(orderDrive(Array.isArray(body.stops) ? body.stops : []));
  }));

  app.post("/revenue/pricing", asyncRoute((req, res) => {
    res.json(reviewPricing((req.body ?? {}) as PricingInput));
  }));

  app.post("/revenue/offer", asyncRoute((req, res) => {
    res.json(reviewOffer((req.body ?? {}) as OfferInput));
  }));

  app.post("/revenue/evidence", asyncRoute((req, res) => {
    res.json(reviewEvidence((req.body ?? {}) as EvidenceInput));
  }));

  app.post("/revenue/pulse", asyncRoute((req, res) => {
    res.json(reviewInsight((req.body ?? {}) as PulseInput));
  }));

  app.post("/revenue/scoreboard", asyncRoute((req, res) => {
    res.json(scoreboard((req.body ?? {}) as ScoreboardInput));
  }));
}
