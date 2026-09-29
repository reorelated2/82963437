import { randomUUID } from 'node:crypto';
import { text, type SqlDb } from '../sql.ts';

/** Section 13. These are stored transitions. They are not collapsed into one label. */
export const SHOWING_STATES = [
  'CUSTOMER_REQUESTED',
  'SHOWING_REQUEST_CREATED',
  'LISTING_SIDE_CONTACTED',
  'ACCESS_PENDING',
  'ACCESS_CONFIRMED',
  'BUYER_NOTIFIED',
  'BUYER_ACKNOWLEDGED',
  'SHOWING_SCHEDULED',
  'SHOWING_COMPLETED',
  'SHOWING_CANCELLED',
  'RESCHEDULE_NEEDED',
  'OUTCOME_UNKNOWN',
] as const;

export type ShowingState = (typeof SHOWING_STATES)[number];

export function isShowingState(value: string): value is ShowingState {
  return (SHOWING_STATES as readonly string[]).includes(value);
}

export function recordShowingTransition(db: SqlDb, input: {
  opportunityId: string;
  state: string;
  source: string;
  evidence: string;
  now: Date;
}): { stored: boolean; state: string } {
  if (!isShowingState(input.state)) throw new Error(`Unknown showing state: ${input.state}`);
  const last = db.get(
    `SELECT state FROM showing_transitions WHERE opportunity_id = ? ORDER BY created_at DESC, id DESC`,
    input.opportunityId,
  );
  if (text(last, 'state') === input.state) return { stored: false, state: input.state };
  db.run(
    `INSERT INTO showing_transitions (id, opportunity_id, state, source, evidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    randomUUID(),
    input.opportunityId,
    input.state,
    input.source,
    input.evidence,
    input.now.toISOString(),
  );
  return { stored: true, state: input.state };
}

export function showingHistory(db: SqlDb, opportunityId: string): string[] {
  return db.all(
    `SELECT state FROM showing_transitions WHERE opportunity_id = ? ORDER BY created_at, id`,
    opportunityId,
  ).map((row) => text(row, 'state'));
}
