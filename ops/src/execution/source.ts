import { randomUUID } from 'node:crypto';
import { text, type SqlDb } from '../sql.ts';

export function recordLeadSource(db: SqlDb, input: {
  clientId: string;
  opportunityId: string;
  sourceSystem: string;
  leadSource: string | null;
  sourceIdentifier: string | null;
  now: Date;
}): { originalLeadSource: string | null; conflict: boolean; live: false } {
  const current = db.get(`SELECT original_lead_source, source_system FROM opportunities WHERE id = ?`, input.opportunityId);
  const original = text(current, 'original_lead_source');
  const incoming = input.leadSource?.trim() || '';
  const conflict = Boolean(original && incoming && original.toLowerCase() !== incoming.toLowerCase());
  if (!original && incoming) {
    db.run(
      `UPDATE opportunities SET original_lead_source = ?, source_system = ?, updated_at = ? WHERE id = ?`,
      incoming,
      input.sourceSystem,
      input.now.toISOString(),
      input.opportunityId,
    );
  } else {
    db.run(
      `UPDATE opportunities SET source_system = ?, updated_at = ? WHERE id = ?`,
      input.sourceSystem,
      input.now.toISOString(),
      input.opportunityId,
    );
  }
  db.run(
    `INSERT INTO lead_source_history (id, client_id, opportunity_id, source_system, lead_source, source_identifier, conflict, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    randomUUID(),
    input.clientId,
    input.opportunityId,
    input.sourceSystem,
    incoming || null,
    input.sourceIdentifier,
    conflict ? 1 : 0,
    input.now.toISOString(),
  );
  const stored = text(db.get(`SELECT original_lead_source FROM opportunities WHERE id = ?`, input.opportunityId), 'original_lead_source');
  return { originalLeadSource: stored || null, conflict, live: false };
}
