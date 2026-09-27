import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openSql, text, type SqlDb } from '../sql.ts';
import { SHOWING_CHECKPOINTS, type ShowingCheckpoint } from './types.ts';

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = DELETE;

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  person_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  relationship_owner TEXT NOT NULL,
  workflow_owner TEXT NOT NULL,
  stage TEXT NOT NULL,
  source_version TEXT NOT NULL,
  timezone TEXT NOT NULL,
  suppression TEXT NOT NULL,
  takeover TEXT NOT NULL,
  takeover_reason TEXT,
  policy_version TEXT NOT NULL,
  follow_up_due_at TEXT,
  last_question TEXT,
  follow_up_count INTEGER NOT NULL DEFAULT 0,
  is_synthetic INTEGER NOT NULL DEFAULT 1,
  blocker TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS opportunity_facts (
  opportunity_id TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  value TEXT NOT NULL,
  basis TEXT NOT NULL,
  evidence TEXT NOT NULL,
  source_version TEXT NOT NULL,
  PRIMARY KEY (opportunity_id, fact_key)
);

CREATE TABLE IF NOT EXISTS showing_checkpoints (
  opportunity_id TEXT NOT NULL,
  checkpoint TEXT NOT NULL,
  status TEXT NOT NULL,
  evidence TEXT,
  PRIMARY KEY (opportunity_id, checkpoint)
);

CREATE TABLE IF NOT EXISTS runtime_events (
  event_key TEXT PRIMARY KEY,
  opportunity_id TEXT,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  result_json TEXT,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS action_claims (
  action_key TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  intent TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  receipt_json TEXT,
  pending_write INTEGER NOT NULL DEFAULT 0,
  body TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS opportunity_identifiers (
  identifier TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS routine_state (
  id TEXT PRIMARY KEY,
  schedule TEXT NOT NULL,
  timezone TEXT NOT NULL,
  platform_routine_id TEXT,
  last_success_at TEXT,
  next_run_at TEXT,
  coverage TEXT NOT NULL
);
`;

export function openRuntime(path: string): SqlDb {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = openSql(path);
  db.exec(SCHEMA);
  const routine = db.get(`SELECT id FROM routine_state WHERE id = 'kyleos-buyer-reconcile'`);
  if (!routine) {
    db.run(
      `INSERT INTO routine_state (id, schedule, timezone, platform_routine_id, last_success_at, next_run_at, coverage)
       VALUES ('kyleos-buyer-reconcile', '*/15 * * * *', 'America/New_York', NULL, NULL, NULL, 'synthetic ledger only; live inbox is not listened')`,
    );
  }
  return db;
}

export interface OpportunityRow {
  id: string;
  personKey: string;
  displayName: string;
  relationshipOwner: string;
  workflowOwner: string;
  stage: string;
  sourceVersion: string;
  timezone: string;
  suppression: string;
  takeover: string;
  takeoverReason: string;
  policyVersion: string;
  followUpDueAt: string | null;
  lastQuestion: string | null;
  followUpCount: number;
  isSynthetic: boolean;
  blocker: string | null;
  facts: Record<string, { value: string; basis: string }>;
  checkpoints: Record<ShowingCheckpoint, { status: string; evidence: string }>;
}

export function ensureOpportunity(db: SqlDb, input: {
  personKey: string;
  displayName: string;
  relationshipOwner: string;
  sourceVersion: string;
  policyVersion: string;
  synthetic: boolean;
  now: Date;
}): OpportunityRow {
  const existing = db.get(`SELECT id FROM opportunities WHERE person_key = ?`, input.personKey);
  const now = input.now.toISOString();
  if (!existing) {
    const id = randomUUID();
    db.run(
      `INSERT INTO opportunities (
        id, person_key, display_name, relationship_owner, workflow_owner, stage, source_version, timezone,
        suppression, takeover, policy_version, follow_up_count, is_synthetic, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'grok-bot', 'new', ?, 'America/New_York', 'none', 'agent', ?, 0, ?, ?, ?)`,
      id,
      input.personKey,
      input.displayName,
      input.relationshipOwner,
      input.sourceVersion,
      input.policyVersion,
      input.synthetic ? 1 : 0,
      now,
      now,
    );
    for (const checkpoint of SHOWING_CHECKPOINTS) {
      db.run(
        `INSERT INTO showing_checkpoints (opportunity_id, checkpoint, status, evidence) VALUES (?, ?, 'missing', NULL)`,
        id,
        checkpoint,
      );
    }
  }
  const loaded = loadOpportunity(db, input.personKey)!;
  db.run(`INSERT OR IGNORE INTO opportunity_identifiers (identifier, opportunity_id) VALUES (?, ?)`, input.personKey, loaded.id);
  return loaded;
}

export function identityConflict(db: SqlDb, opportunityId: string, keys: string[]): string | null {
  for (const key of keys) {
    const row = db.get(`SELECT opportunity_id FROM opportunity_identifiers WHERE identifier = ?`, key);
    if (row && text(row, 'opportunity_id') !== opportunityId) return key;
  }
  return null;
}

export function rememberIdentifiers(db: SqlDb, opportunityId: string, keys: string[]): void {
  for (const key of keys) {
    db.run(`INSERT OR IGNORE INTO opportunity_identifiers (identifier, opportunity_id) VALUES (?, ?)`, key, opportunityId);
  }
}

export function loadOpportunity(db: SqlDb, personKey: string): OpportunityRow | null {
  const row = db.get(`SELECT * FROM opportunities WHERE person_key = ?`, personKey);
  if (!row) return null;
  return hydrate(db, row);
}

export function loadOpportunityById(db: SqlDb, id: string): OpportunityRow | null {
  const row = db.get(`SELECT * FROM opportunities WHERE id = ?`, id);
  if (!row) return null;
  return hydrate(db, row);
}

function hydrate(db: SqlDb, row: Record<string, unknown>): OpportunityRow {
  const id = text(row, 'id');
  const facts: OpportunityRow['facts'] = {};
  for (const fact of db.all(`SELECT * FROM opportunity_facts WHERE opportunity_id = ?`, id)) {
    facts[text(fact, 'fact_key')] = { value: text(fact, 'value'), basis: text(fact, 'basis') };
  }
  const checkpoints = {} as OpportunityRow['checkpoints'];
  for (const checkpoint of SHOWING_CHECKPOINTS) {
    checkpoints[checkpoint] = { status: 'missing', evidence: '' };
  }
  for (const item of db.all(`SELECT * FROM showing_checkpoints WHERE opportunity_id = ?`, id)) {
    const key = text(item, 'checkpoint') as ShowingCheckpoint;
    checkpoints[key] = { status: text(item, 'status'), evidence: text(item, 'evidence') };
  }
  return {
    id,
    personKey: text(row, 'person_key'),
    displayName: text(row, 'display_name'),
    relationshipOwner: text(row, 'relationship_owner'),
    workflowOwner: text(row, 'workflow_owner'),
    stage: text(row, 'stage'),
    sourceVersion: text(row, 'source_version'),
    timezone: text(row, 'timezone'),
    suppression: text(row, 'suppression'),
    takeover: text(row, 'takeover'),
    takeoverReason: text(row, 'takeover_reason'),
    policyVersion: text(row, 'policy_version'),
    followUpDueAt: text(row, 'follow_up_due_at') || null,
    lastQuestion: text(row, 'last_question') || null,
    followUpCount: Number(row.follow_up_count ?? 0),
    isSynthetic: Number(row.is_synthetic ?? 1) === 1,
    blocker: text(row, 'blocker') || null,
    facts,
    checkpoints,
  };
}

export function saveFact(db: SqlDb, opportunityId: string, key: string, value: string, basis: string, evidence: string, sourceVersion: string): void {
  db.run(
    `INSERT INTO opportunity_facts (opportunity_id, fact_key, value, basis, evidence, source_version)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(opportunity_id, fact_key) DO UPDATE SET value = excluded.value, basis = excluded.basis, evidence = excluded.evidence, source_version = excluded.source_version`,
    opportunityId,
    key,
    value,
    basis,
    evidence,
    sourceVersion,
  );
}

export function saveCheckpoint(db: SqlDb, opportunityId: string, checkpoint: ShowingCheckpoint, status: 'satisfied' | 'missing', evidence: string): void {
  db.run(
    `INSERT INTO showing_checkpoints (opportunity_id, checkpoint, status, evidence) VALUES (?, ?, ?, ?)
     ON CONFLICT(opportunity_id, checkpoint) DO UPDATE SET status = excluded.status, evidence = excluded.evidence`,
    opportunityId,
    checkpoint,
    status,
    evidence,
  );
}

export function updateOpportunity(db: SqlDb, id: string, patch: Record<string, string | number | null>, now: Date): void {
  const sets = ['updated_at = ?'];
  const params: Array<string | number | null> = [now.toISOString()];
  for (const [key, value] of Object.entries(patch)) {
    sets.push(`${key} = ?`);
    params.push(value);
  }
  params.push(id);
  db.run(`UPDATE opportunities SET ${sets.join(', ')} WHERE id = ?`, ...params);
}

export function findEvent(db: SqlDb, eventKey: string): Record<string, unknown> | undefined {
  return db.get(`SELECT * FROM runtime_events WHERE event_key = ?`, eventKey);
}

export function insertEvent(db: SqlDb, eventKey: string, opportunityId: string | null, kind: string, payload: unknown, now: Date): boolean {
  try {
    db.run(
      `INSERT INTO runtime_events (event_key, opportunity_id, kind, payload_json, received_at) VALUES (?, ?, ?, ?, ?)`,
      eventKey,
      opportunityId,
      kind,
      JSON.stringify(payload),
      now.toISOString(),
    );
    return true;
  } catch {
    return false;
  }
}

export function saveEventResult(db: SqlDb, eventKey: string, result: unknown, finalize?: (value: unknown) => void): void {
  if (finalize) finalize(result);
  db.run(`UPDATE runtime_events SET result_json = ? WHERE event_key = ?`, JSON.stringify(result), eventKey);
}

export function tryClaim(db: SqlDb, input: {
  actionKey: string;
  opportunityId: string;
  workerId: string;
  intent: string;
  body: string | null;
  now: Date;
}): 'owner' | 'not_owner' {
  const existing = db.get(`SELECT worker_id, status FROM action_claims WHERE action_key = ?`, input.actionKey);
  if (existing) {
    if (text(existing, 'worker_id') === input.workerId && text(existing, 'status') === 'claimed') return 'owner';
    return 'not_owner';
  }
  try {
    db.run(
      `INSERT INTO action_claims (action_key, opportunity_id, worker_id, intent, status, attempt, pending_write, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'claimed', 1, 0, ?, ?, ?)`,
      input.actionKey,
      input.opportunityId,
      input.workerId,
      input.intent,
      input.body,
      input.now.toISOString(),
      input.now.toISOString(),
    );
    return 'owner';
  } catch {
    return 'not_owner';
  }
}

export function finishClaim(db: SqlDb, actionKey: string, status: string, receipt: unknown, pendingWrite: boolean, now: Date): void {
  db.run(
    `UPDATE action_claims SET status = ?, receipt_json = ?, pending_write = ?, updated_at = ? WHERE action_key = ?`,
    status,
    JSON.stringify(receipt),
    pendingWrite ? 1 : 0,
    now.toISOString(),
    actionKey,
  );
}

export function supersedeQueued(db: SqlDb, opportunityId: string, now: Date): void {
  db.run(
    `UPDATE action_claims SET status = 'superseded', updated_at = ? WHERE opportunity_id = ? AND status = 'queued'`,
    now.toISOString(),
    opportunityId,
  );
}

export function queueFollowUp(db: SqlDb, opportunityId: string, dueAt: string, questionId: string, now: Date): void {
  const actionKey = `follow_up:${opportunityId}:${dueAt}:${questionId}`;
  const existing = db.get(`SELECT action_key FROM action_claims WHERE action_key = ?`, actionKey);
  if (existing) return;
  db.run(
    `INSERT INTO action_claims (action_key, opportunity_id, worker_id, intent, status, attempt, pending_write, body, created_at, updated_at)
     VALUES (?, ?, 'grok-bot', 'follow_up', 'queued', 0, 0, ?, ?, ?)`,
    actionKey,
    opportunityId,
    questionId,
    now.toISOString(),
    now.toISOString(),
  );
}

export function ambiguousClaim(db: SqlDb, opportunityId: string): Record<string, unknown> | undefined {
  return db.get(`SELECT * FROM action_claims WHERE opportunity_id = ? AND status = 'ambiguous' ORDER BY updated_at DESC`, opportunityId);
}

export function pendingWriteClaim(db: SqlDb, opportunityId: string): Record<string, unknown> | undefined {
  return db.get(`SELECT * FROM action_claims WHERE opportunity_id = ? AND pending_write = 1 AND status = 'succeeded' ORDER BY updated_at DESC`, opportunityId);
}

export function countSendReceipts(db: SqlDb, opportunityId: string): number {
  return db.all(`SELECT action_key FROM action_claims WHERE opportunity_id = ? AND intent = 'send' AND status = 'succeeded'`, opportunityId).length;
}

export function dueOpportunities(db: SqlDb, now: Date): OpportunityRow[] {
  return db.all(
    `SELECT * FROM opportunities WHERE follow_up_due_at IS NOT NULL AND follow_up_due_at <= ? AND suppression = 'none' AND takeover = 'agent'`,
    now.toISOString(),
  ).map((row) => hydrate(db, row));
}

export function markRoutine(db: SqlDb, now: Date): void {
  const next = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  db.run(
    `UPDATE routine_state SET last_success_at = ?, next_run_at = ? WHERE id = 'kyleos-buyer-reconcile'`,
    now.toISOString(),
    next,
  );
}

export function routineStatus(db: SqlDb): Record<string, unknown> {
  const row = db.get(`SELECT * FROM routine_state WHERE id = 'kyleos-buyer-reconcile'`);
  return {
    id: 'kyleos-buyer-reconcile',
    schedule: text(row, 'schedule'),
    timezone: text(row, 'timezone'),
    platformRoutineId: text(row, 'platform_routine_id') || null,
    registered: false,
    lastSuccessAt: text(row, 'last_success_at') || null,
    nextRunAt: text(row, 'next_run_at') || null,
    coverage: text(row, 'coverage'),
    live: false,
  };
}
