import 'dotenv/config';
import express from 'express';
import rateLimit from 'express-rate-limit';
import pRetry from 'p-retry';
import { getMarket, saveClient } from './lib/db';
import { generateStrategy } from './lib/aiEngine';
import { collectRedfinMarkets } from './lib/redfinCollector';
import { startCollectorSchedule } from './collector/scheduler';

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 60 }));

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
  if (process.env.RUN_COLLECTOR_ON_BOOT === 'true') {
    const rows = await collectRedfinMarkets();
    // Persist last known good cache before API starts serving traffic.
    await import('./lib/db').then((mod) => mod.upsertMarkets(rows));
  }
  startCollectorSchedule();
  app.listen(process.env.PORT ?? 8080, () => {
    console.log('API running');
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
