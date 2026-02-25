import cron from 'node-cron';
import { collectRedfinMarkets } from '../lib/redfinCollector';
import { upsertMarkets } from '../lib/db';

export function startCollectorSchedule(): void {
  cron.schedule('0 */6 * * *', async () => {
    const rows = await collectRedfinMarkets();
    await upsertMarkets(rows);
  });
}
