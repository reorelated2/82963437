import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAgentToolsDataset, parseAgentToolsDataset } from '../ingest/agentTools.ts';
import type { SqlDb } from '../sql.ts';
import { HOT7_FIXTURE_INSTANT } from './clock.ts';
import { buildMorningBrief, type MorningBrief } from './brief.ts';

const NOW_DEFAULT = new Date(HOT7_FIXTURE_INSTANT);

/** Loads the pseudonymized Hot 7 contract file through the Agent Tools loader, then builds the brief. */
export function seedHot7(db: SqlDb, now = NOW_DEFAULT): MorningBrief {
  const path = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures/hot7-execution.json');
  const dataset = parseAgentToolsDataset(JSON.parse(readFileSync(path, 'utf8')));
  const loaded = loadAgentToolsDataset(db, dataset, { apply: true, now });
  if (!loaded.applied || loaded.results.length !== 7) {
    throw new Error(loaded.message);
  }
  return buildMorningBrief(db, now);
}
