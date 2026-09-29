import { randomUUID } from 'node:crypto';
import { text, type SqlDb } from '../sql.ts';

export function openFactReview(db: SqlDb, input: {
  clientId: string;
  fieldKey: string;
  keptValue: string;
  incomingValue: string;
  keptSource: string;
  incomingSource: string;
  now: Date;
  createdBy: string;
}): { id: string; status: 'open' } {
  const dedupe = `${input.clientId}|${input.fieldKey}|${input.keptValue}|${input.incomingValue}`;
  const existing = db.get(`SELECT id FROM fact_reviews WHERE dedupe_key = ?`, dedupe);
  if (existing) return { id: text(existing, 'id'), status: 'open' };
  const id = randomUUID();
  const nowIso = input.now.toISOString();
  db.run(
    `INSERT INTO fact_reviews (
      id, client_id, field_key, kept_value, incoming_value, kept_source, incoming_source,
      status, created_at, updated_at, created_by, dedupe_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
    id,
    input.clientId,
    input.fieldKey,
    input.keptValue,
    input.incomingValue,
    input.keptSource,
    input.incomingSource,
    nowIso,
    nowIso,
    input.createdBy,
    dedupe,
  );
  return { id, status: 'open' };
}
