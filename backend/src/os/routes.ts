import express, { type Express, type NextFunction, type Request, type Response } from "express";
import type { Desk } from "./workflow.js";

export function mountOs(app: Express, desk: Desk): void {
  const router = express.Router();

  router.get("/workspace", (_req, res) => {
    res.json(desk.workspace());
  });

  router.get("/search", (req, res) => {
    res.json({ results: desk.search(String(req.query.q ?? "")) });
  });

  router.get("/contacts/:id", (req, res) => {
    const file = desk.contact(req.params.id);
    if (!file) return res.status(404).json({ error: "That client is not on this desk." });
    return res.json(file);
  });

  router.post("/intake", (req, res, next) => {
    try {
      res.status(201).json(desk.intakeText({ text: String(req.body.text ?? ""), isDemo: Boolean(req.body.isDemo) }));
    } catch (error) {
      next(error);
    }
  });

  router.post("/intake/screenshot", async (req, res, next) => {
    try {
      const bytes = Buffer.from(String(req.body.dataBase64 ?? ""), "base64");
      if (!bytes.length) return res.status(400).json({ error: "Upload a screenshot." });
      const result = await desk.intakeScreenshot({
        filename: String(req.body.filename ?? "screenshot.png"),
        bytes,
        ocrText: typeof req.body.ocrText === "string" ? req.body.ocrText : undefined,
        ocrConfidence: typeof req.body.ocrConfidence === "number" ? req.body.ocrConfidence : undefined,
        isDemo: Boolean(req.body.isDemo),
      });
      return res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  });

  router.post("/reviews/:id/accept", (req, res) => {
    desk.acceptReview(req.params.id);
    res.json({ ok: true });
  });

  router.post("/reviews/:id/dismiss", (req, res) => {
    desk.dismissReview(req.params.id);
    res.json({ ok: true });
  });

  router.post("/drafts/:id/approve", (req, res, next) => {
    try {
      res.json(desk.approveDraft(req.params.id));
    } catch (error) {
      next(error);
    }
  });

  router.post("/tasks/:id/done", (req, res) => {
    desk.completeTask(req.params.id);
    res.json({ ok: true, sent: false });
  });

  router.get("/settings", (_req, res) => {
    res.json({ settings: desk.getSettings(), integrations: desk.integrations() });
  });

  router.post("/settings", (req, res) => {
    res.json({
      settings: desk.updateSettings({
        outboundPaused: req.body.outboundPaused,
        spendingLimitUsd: req.body.spendingLimitUsd === undefined ? undefined : Number(req.body.spendingLimitUsd),
      }),
    });
  });

  router.post("/backup", (_req, res, next) => {
    try {
      res.json(desk.backup());
    } catch (error) {
      next(error);
    }
  });

  router.post("/restore", (req, res, next) => {
    try {
      if (req.body.confirm !== "RESTORE") return res.status(400).json({ error: "Type RESTORE to confirm. This replaces the current desk with that backup." });
      desk.restore(String(req.body.file ?? ""));
      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  router.get("/export", (_req, res) => {
    res.json(desk.exportAll());
  });

  router.post("/demo", (_req, res) => {
    res.json(desk.seedDemo());
  });

  router.delete("/demo", (_req, res) => {
    desk.removeDemo();
    res.json({ ok: true });
  });

  router.post("/jobs/:id/retry", (req, res, next) => {
    try {
      res.json(desk.retryJob(req.params.id));
    } catch (error) {
      next(error);
    }
  });

  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = error instanceof Error ? error.message : "The desk could not finish that.";
    res.status(400).json({ error: message });
  });

  app.use("/api/os", router);
}

export function createHttpApp(desk: Desk): Express {
  const app = express();
  app.use(express.json({ limit: "12mb" }));
  mountOs(app, desk);
  return app;
}
