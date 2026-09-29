import { createSyntheticAdapter, createUnverifiedLiveAdapter } from './runtime/adapters.ts';
import { reconcileDue } from './runtime/loop.ts';
import { openRuntime, routineStatus } from './runtime/store.ts';
import { UNRELEASED_POLICY } from './runtime/types.ts';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dbPath = process.env.KYLEOS_LEDGER || join(root, 'data', 'ledger.sqlite');
const command = process.argv[2] ?? 'status';
const db = openRuntime(dbPath);

if (command === 'tick') {
  const results = reconcileDue(db, new Date(), {
    policy: UNRELEASED_POLICY,
    synthetic: createSyntheticAdapter(),
    live: createUnverifiedLiveAdapter(),
  });
  console.log(JSON.stringify({
    live: false,
    routine: routineStatus(db),
    processed: results.length,
    results: results.map((result) => ({ status: result.status, mode: result.mode, live: result.live, blocker: result.blocker })),
  }, null, 2));
} else {
  console.log(JSON.stringify({ live: false, routine: routineStatus(db), policy: UNRELEASED_POLICY.version }, null, 2));
}
db.close();
