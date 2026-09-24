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

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public');

export function leadDeskEnabled(): boolean {
  return process.env.ENABLE_LEAD_DESK === 'true';
}

export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '12mb' }));
  app.use(rateLimit({ windowMs: 60_000, limit: 120 }));

  if (leadDeskEnabled()) {
    mountOs(app, openDesk());
    app.use(express.static(publicDir));
  } else {
    app.get('/', (_req, res) => {
      res.json({
        product: 'South Florida Buyer Command Center',
        lane: 'Consult intake, cached market metrics, and MLS analyze helpers.',
        leadDesk: 'Not mounted. Inquiry SEND/NOTE/NEXT belongs to the other agent. See docs/HANDOFF_BOUNDARY.md.',
        messaging: 'No client messaging on this server.',
        routes: ['/health', '/markets/:city', '/strategy', '/mls/hiram-zone', '/mls/analyze', '/clients'],
      });
    });
  }

  app.get('/health', (_req, res) => res.json({ ok: true, product: 'buyer-command-center', leadDeskMounted: leadDeskEnabled() }));

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

  return app;
}

export async function bootstrap(): Promise<void> {
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
  const app = createApp();
  app.listen(port, host, () => {
    const label = leadDeskEnabled() ? 'Lead desk experiment (not the CRM of record)' : 'Buyer Command Center';
    console.log(`${label} at http://${host}:${port}`);
  });
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry && entry === fileURLToPath(import.meta.url)) {
  bootstrap().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
