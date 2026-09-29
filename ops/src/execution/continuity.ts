import { randomUUID } from 'node:crypto';
import { text, type SqlDb } from '../sql.ts';
import type { DeskFact } from './plan.ts';

export const CONTINUITY_MIGRATION_ID = '2026-09-29-continuity';

const TABLES = `
CREATE TABLE IF NOT EXISTS waiting_states (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  party TEXT NOT NULL,
  reason TEXT NOT NULL,
  started_at TEXT NOT NULL,
  end_condition TEXT NOT NULL,
  next_check_at TEXT,
  stale_after TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  execution_authority TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS promises (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  promise_text TEXT NOT NULL,
  due_at TEXT,
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS execution_marks (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  mark TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  execution_authority TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS client_identifiers_redfin
  ON client_identifiers(kind, value_normalized)
  WHERE kind = 'redfin_customer_id';
`;

export function applyContinuitySchema(db: SqlDb, now = new Date()): void {
  db.exec(TABLES);
  const existing = db.get(`SELECT id FROM schema_migrations WHERE id = ?`, CONTINUITY_MIGRATION_ID);
  if (!existing) {
    db.run(
      `INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)`,
      CONTINUITY_MIGRATION_ID,
      now.toISOString(),
    );
  }
}

export function openWaiting(db: SqlDb, input: {
  opportunityId: string;
  party: string;
  reason: string;
  endCondition: string;
  now: Date;
  nextCheckAt?: string | null;
  staleAfter?: string | null;
}): void {
  db.run(`UPDATE waiting_states SET status = 'closed' WHERE opportunity_id = ? AND status = 'open'`, input.opportunityId);
  db.run(
    `INSERT INTO waiting_states (
      id, opportunity_id, party, reason, started_at, end_condition, next_check_at, stale_after, status, execution_authority, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', 'marked_by_kyle', ?)`,
    randomUUID(),
    input.opportunityId,
    input.party,
    input.reason,
    input.now.toISOString(),
    input.endCondition,
    input.nextCheckAt ?? null,
    input.staleAfter ?? null,
    input.now.toISOString(),
  );
}

export function closeWaiting(db: SqlDb, opportunityId: string): void {
  db.run(`UPDATE waiting_states SET status = 'closed' WHERE opportunity_id = ? AND status = 'open'`, opportunityId);
}

export function openPromise(db: SqlDb, input: {
  opportunityId: string;
  clientId: string;
  promiseText: string;
  now: Date;
  dueAt?: string | null;
}): void {
  db.run(
    `INSERT INTO promises (id, opportunity_id, client_id, promise_text, due_at, status, source, created_at)
     VALUES (?, ?, ?, ?, ?, 'open', 'kyle', ?)`,
    randomUUID(),
    input.opportunityId,
    input.clientId,
    input.promiseText.replace(/[—–]/g, '.'),
    input.dueAt ?? null,
    input.now.toISOString(),
  );
}

export function recordExecutionMarkRow(db: SqlDb, input: {
  opportunityId: string;
  clientId: string;
  mark: string;
  payload: Record<string, unknown>;
  now: Date;
}): void {
  db.run(
    `INSERT INTO execution_marks (id, opportunity_id, client_id, mark, payload_json, execution_authority, created_at)
     VALUES (?, ?, ?, ?, ?, 'marked_by_kyle', ?)`,
    randomUUID(),
    input.opportunityId,
    input.clientId,
    input.mark,
    JSON.stringify(input.payload),
    input.now.toISOString(),
  );
}

export function continuityFacts(db: SqlDb, opportunityId: string): DeskFact[] {
  const facts: DeskFact[] = [];
  const waiting = db.get(
    `SELECT party, end_condition, stale_after FROM waiting_states
     WHERE opportunity_id = ? AND status = 'open' ORDER BY created_at DESC`,
    opportunityId,
  );
  if (waiting) {
    facts.push(fact('waiting_active', 'yes'));
    facts.push(fact('waiting_party', text(waiting, 'party')));
    facts.push(fact('waiting_end', text(waiting, 'end_condition')));
    const stale = text(waiting, 'stale_after');
    if (stale) facts.push(fact('waiting_stale_after', stale));
  }
  const promise = db.get(
    `SELECT promise_text FROM promises WHERE opportunity_id = ? AND status = 'open' ORDER BY created_at DESC`,
    opportunityId,
  );
  if (promise) {
    facts.push(fact('promise_open', 'yes'));
    facts.push(fact('kyle_promise', text(promise, 'promise_text')));
  }
  return facts;
}

export function isWorkflowDrift(db: SqlDb, opportunityId: string): boolean {
  const opp = db.get(
    `SELECT status, next_action, follow_up_trigger, no_action_reason FROM opportunities WHERE id = ?`,
    opportunityId,
  );
  if (!opp || text(opp, 'status') !== 'open') return false;
  const waiting = db.get(
    `SELECT id FROM waiting_states WHERE opportunity_id = ? AND status = 'open'`,
    opportunityId,
  );
  if (waiting) return false;
  const promise = db.get(
    `SELECT id FROM promises WHERE opportunity_id = ? AND status = 'open'`,
    opportunityId,
  );
  if (promise) return false;
  const next = text(opp, 'next_action');
  const trigger = text(opp, 'follow_up_trigger');
  if (next && next !== 'NO_ACTION_REQUIRED') return false;
  if (trigger) return false;
  const reason = text(opp, 'no_action_reason');
  if (reason && reason !== 'NO_ACTION_REQUIRED') return false;
  return true;
}

function fact(field: string, value: string): DeskFact {
  return { field, value, kind: 'fact', verification: 'verified' };
}
