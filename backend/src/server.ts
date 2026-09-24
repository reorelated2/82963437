import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import rateLimit from 'express-rate-limit';
import pRetry from 'p-retry';
import { getMarket, saveClient } from './lib/db.js';
import { generateStrategy } from './lib/aiEngine.js';
import { collectRedfinMarkets } from './lib/redfinCollector.js';
import { startCollectorSchedule } from './collector/scheduler.js';
import { analyzeMlsFeeds, getHiramSeedAnalysis, type MlsListing } from './lib/mlsAnalyzer.js';
import { mountOs } from './os/routes.js';
import { openDesk } from './os/workflow.js';

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 120 }));

const desk = openDesk();
mountOs(app, desk);
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public');
app.use(express.static(publicDir));

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/markets/:city', async (req, res) => {
  const city = req.params.city;
  const market = await getMarket(city);
  if (!market) return res.status(404).json({ message: 'Not found' });
  return res.json(market);
});

app.post('/strategy', async (req, res) => {
  const result = await pRetry(() => generateStrategy(req.body), { retries: 2 });
  return res.json(result);
});


app.get('/mls/hiram-zone', (_req, res) => {
  return res.json(getHiramSeedAnalysis());
});

app.post('/mls/analyze', (req, res) => {
  const { feeds, config } = req.body as { feeds?: MlsListing[][]; config?: { targetZip?: string; maxBudget?: number } };

  if (!Array.isArray(feeds) || feeds.length === 0) {
    return res.status(400).json({ message: 'feeds must be a non-empty array of MLS feeds' });
  }

  const analysis = analyzeMlsFeeds(feeds, config ?? {});
  return res.json(analysis);
});

app.post('/clients', async (req, res) => {
  const { answers, strategy } = req.body;
  const id = await saveClient({
    answers,
    leadLabel: strategy.leadScore,
    readinessPercent: strategy.readinessPercent,
    transactionPlan: { nextAction: strategy.nextAction },
  });
  return res.status(201).json({ id });
});

async function bootstrap() {
  if (process.env.RUN_REDFIN_COLLECTOR === 'true') {
    try {
      if (process.env.RUN_COLLECTOR_ON_BOOT === 'true') {
        const rows = await collectRedfinMarkets();
        await import('./lib/db.js').then((mod) => mod.upsertMarkets(rows));
      }
      startCollectorSchedule();
    } catch (error) {
      console.error('Redfin collector did not start', error);
    }
  }
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 8080);
  app.listen(port, host, () => {
    console.log(`Kleinman Desk at http://${host}:${port}`);
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
