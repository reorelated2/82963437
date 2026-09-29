import { randomUUID } from 'node:crypto';
import { scheduledTourIsStale } from '../conversion/engine.ts';
import { text, type SqlDb } from '../sql.ts';

/** Opens one seller opportunity for a verified overdue CMA reminder. Does not invent an address or send anything. */
export function ensureOverdueCmaSeller(db: SqlDb, buyerOpportunityId: string, now: Date): { sellerOpportunityId: string | null; created: boolean } {
  const reminder = overdueReminder(db, buyerOpportunityId, now);
  if (!reminder) return { sellerOpportunityId: null, created: false };
  const existing = db.get(`SELECT seller_opportunity_id FROM opportunity_links WHERE buyer_opportunity_id = ?`, buyerOpportunityId);
  if (existing) return { sellerOpportunityId: text(existing, 'seller_opportunity_id'), created: false };
  const buyer = db.get(`SELECT client_id, contact_id, is_demo FROM opportunities WHERE id = ?`, buyerOpportunityId);
  if (!buyer) return { sellerOpportunityId: null, created: false };
  const sellerId = randomUUID();
  const nowIso = now.toISOString();
  const due = new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString();
  const nextAction = `CMA NEEDED. Reminder is overdue: ${reminder}. Get the property address from Agent Tools before any CMA. Do not assume an address.`;
  db.run(
    `INSERT INTO opportunities (
      id, client_id, contact_id, business_line, stage, status, source_label, is_demo, created_at, updated_at,
      next_action, next_action_owner, next_action_due_at, follow_up_trigger, no_action_reason, primary_stage, financing_state, seller_stage
    ) VALUES (?, ?, ?, 'redfin_seller', 'new', 'open', 'cma_reminder', ?, ?, ?, ?, 'Kyle Kleinman', ?, 'cma_due', NULL, 'NEW_INQUIRY', NULL, 'SELLER_NEW')`,
    sellerId,
    text(buyer, 'client_id'),
    text(buyer, 'contact_id') || null,
    Number(buyer.is_demo ?? 0),
    nowIso,
    nowIso,
    nextAction,
    due,
  );
  db.run(
    `INSERT INTO opportunity_links (id, buyer_opportunity_id, seller_opportunity_id, reason, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, 'system')`,
    randomUUID(),
    buyerOpportunityId,
    sellerId,
    `Overdue CMA reminder: ${reminder}. Nothing was sent.`,
    nowIso,
  );
  return { sellerOpportunityId: sellerId, created: true };
}

function overdueReminder(db: SqlDb, opportunityId: string, now: Date): string | null {
  const opp = db.get(`SELECT client_id FROM opportunities WHERE id = ?`, opportunityId);
  if (!opp) return null;
  const rows = db.all(
    `SELECT field_key, value, kind, verification FROM client_facts WHERE client_id = ?`,
    text(opp, 'client_id'),
  );
  for (const row of rows) {
    if (text(row, 'kind') !== 'fact' || text(row, 'verification') !== 'verified') continue;
    const field = text(row, 'field_key');
    const value = text(row, 'value');
    if (!/cma/i.test(`${field} ${value}`)) continue;
    if (scheduledTourIsStale(value, now)) return value;
  }
  return null;
}
