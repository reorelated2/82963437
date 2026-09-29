import { text, type SqlDb } from '../sql.ts';

export function isOpportunityDoNotContact(db: SqlDb, opportunityId: string | null | undefined): boolean {
  if (!opportunityId) return false;
  const row = db.get(`SELECT primary_stage, no_action_reason FROM opportunities WHERE id = ?`, opportunityId);
  if (!row) return false;
  return text(row, 'primary_stage') === 'DO_NOT_CONTACT' || text(row, 'no_action_reason') === 'DO_NOT_CONTACT';
}
