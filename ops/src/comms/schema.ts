import { text, type SqlDb } from '../sql.ts';

export const COMMUNICATION_MIGRATION_ID = '2026-09-29-communication';

const MIGRATION = `
CREATE TABLE IF NOT EXISTS consent (
  client_id TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
  sms_consent TEXT NOT NULL DEFAULT 'unknown',
  call_consent TEXT NOT NULL DEFAULT 'unknown',
  email_consent TEXT NOT NULL DEFAULT 'unknown',
  marketing_consent TEXT NOT NULL DEFAULT 'unknown',
  recording_consent TEXT NOT NULL DEFAULT 'unknown',
  do_not_sms INTEGER NOT NULL DEFAULT 0,
  do_not_call INTEGER NOT NULL DEFAULT 0,
  do_not_email INTEGER NOT NULL DEFAULT 0,
  do_not_marketing INTEGER NOT NULL DEFAULT 0,
  opt_out_at TEXT,
  wrong_number INTEGER NOT NULL DEFAULT 0,
  preferred_channel TEXT,
  preferred_time TEXT,
  source_of_consent TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS communication_log (
  communication_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  opportunity_id TEXT,
  channel TEXT NOT NULL,
  provider TEXT NOT NULL,
  direction TEXT NOT NULL,
  purpose TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL,
  consent_status TEXT NOT NULL,
  approval_status TEXT NOT NULL,
  event_id TEXT,
  detail TEXT,
  retryable INTEGER NOT NULL DEFAULT 0,
  retry_after_seconds INTEGER,
  live INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS communication_log_client_purpose
  ON communication_log(client_id, purpose, direction, created_at);
`;

export function applyCommunicationSchema(db: SqlDb, now = new Date()): void {
  db.exec(MIGRATION);
  const existing = db.get(`SELECT id FROM schema_migrations WHERE id = ?`, COMMUNICATION_MIGRATION_ID);
  if (!existing) {
    db.run(
      `INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)`,
      COMMUNICATION_MIGRATION_ID,
      now.toISOString(),
    );
  }
}

export function assertDurableStatus(status: string): void {
  if (status === 'sent' || status === 'call completed' || status === 'call_completed' || status === 'delivered') {
    throw new Error(`Refusing to store status "${status}". This build does not record a live send.`);
  }
}

export function logCount(db: SqlDb, where = '1 = 1', ...params: Array<string | number | null>): number {
  const row = db.get(`SELECT COUNT(*) AS n FROM communication_log WHERE ${where}`, ...params);
  return Number(text(row, 'n') || 0);
}
