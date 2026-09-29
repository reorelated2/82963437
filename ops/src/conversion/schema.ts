import { text, type SqlDb } from '../sql.ts';

export const CONVERSION_MIGRATION_ID = '2026-09-29-conversion';

const TABLES = `
CREATE TABLE IF NOT EXISTS intake_answers (
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  value TEXT,
  status TEXT NOT NULL,
  confirmation TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (opportunity_id, field_key)
);

CREATE TABLE IF NOT EXISTS readiness_flags (
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  flag TEXT NOT NULL,
  state TEXT NOT NULL,
  evidence TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (opportunity_id, flag)
);

CREATE TABLE IF NOT EXISTS buyer_classifications (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  axis TEXT NOT NULL,
  value TEXT NOT NULL,
  confirmation TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (opportunity_id, axis, value)
);

CREATE TABLE IF NOT EXISTS lender_handoffs (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  consent TEXT NOT NULL,
  application_status TEXT NOT NULL,
  prequal TEXT NOT NULL,
  preapproval TEXT NOT NULL,
  approved_amount TEXT,
  expiration TEXT,
  next_action TEXT,
  next_action_due_at TEXT,
  introduced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS opportunity_links (
  id TEXT PRIMARY KEY,
  buyer_opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  seller_opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (buyer_opportunity_id, seller_opportunity_id)
);

CREATE TABLE IF NOT EXISTS reverse_timelines (
  opportunity_id TEXT PRIMARY KEY REFERENCES opportunities(id) ON DELETE CASCADE,
  anchor_date TEXT NOT NULL,
  preapproval_target TEXT NOT NULL,
  consult_target TEXT NOT NULL,
  search_target TEXT NOT NULL,
  touring_target TEXT NOT NULL,
  offer_window_start TEXT NOT NULL,
  offer_window_end TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS consult_requests (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  trigger_name TEXT NOT NULL,
  status TEXT NOT NULL,
  draft_body TEXT NOT NULL,
  live INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (opportunity_id, trigger_name)
);

CREATE TABLE IF NOT EXISTS handoff_cards (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  level INTEGER NOT NULL,
  approval_required INTEGER NOT NULL,
  summary TEXT NOT NULL,
  live INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS next_best_actions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  urgency TEXT NOT NULL,
  confidence TEXT NOT NULL,
  execution_method TEXT NOT NULL,
  approval_required INTEGER NOT NULL,
  deadline TEXT,
  expected_outcome TEXT NOT NULL,
  failure_action TEXT NOT NULL,
  follow_up_trigger TEXT,
  priority_score INTEGER NOT NULL,
  priority_bucket TEXT NOT NULL,
  priority_reasons_json TEXT NOT NULL,
  is_primary INTEGER NOT NULL,
  live INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fact_reviews (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  kept_value TEXT NOT NULL,
  incoming_value TEXT NOT NULL,
  kept_source TEXT NOT NULL,
  incoming_source TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS approval_queue (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  client_id TEXT,
  action_type TEXT NOT NULL,
  channel TEXT,
  draft_content TEXT NOT NULL,
  reason TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  approval_required INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  approved_at TEXT,
  rejected_at TEXT,
  approved_by TEXT,
  provider_attempt_id TEXT,
  source TEXT NOT NULL,
  created_by TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  actor TEXT NOT NULL,
  state TEXT NOT NULL,
  verified INTEGER NOT NULL,
  note TEXT,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS handoff_cards_once
  ON handoff_cards(opportunity_id, reason, level);

CREATE UNIQUE INDEX IF NOT EXISTS next_best_actions_one_primary
  ON next_best_actions(opportunity_id) WHERE is_primary = 1;
`;

const OPPORTUNITY_COLUMNS: Array<[string, string]> = [
  ['next_action', 'ALTER TABLE opportunities ADD COLUMN next_action TEXT'],
  ['next_action_owner', 'ALTER TABLE opportunities ADD COLUMN next_action_owner TEXT'],
  ['next_action_due_at', 'ALTER TABLE opportunities ADD COLUMN next_action_due_at TEXT'],
  ['follow_up_trigger', 'ALTER TABLE opportunities ADD COLUMN follow_up_trigger TEXT'],
  ['no_action_reason', 'ALTER TABLE opportunities ADD COLUMN no_action_reason TEXT'],
  ['primary_stage', 'ALTER TABLE opportunities ADD COLUMN primary_stage TEXT'],
  ['financing_state', 'ALTER TABLE opportunities ADD COLUMN financing_state TEXT'],
  ['seller_stage', 'ALTER TABLE opportunities ADD COLUMN seller_stage TEXT'],
  ['last_meaningful_contact_at', 'ALTER TABLE opportunities ADD COLUMN last_meaningful_contact_at TEXT'],
  ['last_meaningful_contact_by', 'ALTER TABLE opportunities ADD COLUMN last_meaningful_contact_by TEXT'],
  ['contact_verification', 'ALTER TABLE opportunities ADD COLUMN contact_verification TEXT'],
];

const EXTRA_COLUMNS: Array<[string, string, string]> = [
  ['handoff_cards', 'source', 'ALTER TABLE handoff_cards ADD COLUMN source TEXT'],
  ['handoff_cards', 'created_by', 'ALTER TABLE handoff_cards ADD COLUMN created_by TEXT'],
  ['handoff_cards', 'updated_at', 'ALTER TABLE handoff_cards ADD COLUMN updated_at TEXT'],
  ['next_best_actions', 'updated_at', 'ALTER TABLE next_best_actions ADD COLUMN updated_at TEXT'],
  ['next_best_actions', 'source', 'ALTER TABLE next_best_actions ADD COLUMN source TEXT'],
  ['next_best_actions', 'created_by', 'ALTER TABLE next_best_actions ADD COLUMN created_by TEXT'],
  ['lender_handoffs', 'source', 'ALTER TABLE lender_handoffs ADD COLUMN source TEXT'],
  ['lender_handoffs', 'created_by', 'ALTER TABLE lender_handoffs ADD COLUMN created_by TEXT'],
  ['opportunity_links', 'created_by', 'ALTER TABLE opportunity_links ADD COLUMN created_by TEXT'],
  ['consult_requests', 'updated_at', 'ALTER TABLE consult_requests ADD COLUMN updated_at TEXT'],
  ['consult_requests', 'created_by', 'ALTER TABLE consult_requests ADD COLUMN created_by TEXT'],
];

export function applyConversionSchema(db: SqlDb, now = new Date()): void {
  for (const [column, alter] of OPPORTUNITY_COLUMNS) ensureColumn(db, column, alter);
  db.exec(TABLES);
  for (const [table, column, alter] of EXTRA_COLUMNS) ensureTableColumn(db, table, column, alter);
  db.run(
    `UPDATE opportunities
     SET no_action_reason = 'NO_ACTION_REQUIRED'
     WHERE status = 'open'
       AND (next_action IS NULL OR next_action = '')
       AND (no_action_reason IS NULL OR no_action_reason = '')`,
  );
  const existing = db.get(`SELECT id FROM schema_migrations WHERE id = ?`, CONVERSION_MIGRATION_ID);
  if (!existing) {
    db.run(
      `INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)`,
      CONVERSION_MIGRATION_ID,
      now.toISOString(),
    );
  }
}

function ensureColumn(db: SqlDb, column: string, alter: string): void {
  ensureTableColumn(db, 'opportunities', column, alter);
}

function ensureTableColumn(db: SqlDb, table: string, column: string, alter: string): void {
  const rows = db.all(`PRAGMA table_info(${table})`);
  if (rows.some((row) => text(row, 'name') === column)) return;
  db.exec(alter);
}
