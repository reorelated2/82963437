import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { openSql, type SqlDb } from './sql.ts';

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = DELETE;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  lifecycle TEXT NOT NULL DEFAULT 'new',
  suppression_status TEXT NOT NULL DEFAULT 'unknown',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS identifiers (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  value_normalized TEXT NOT NULL,
  raw_value TEXT NOT NULL,
  source_event_id TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS identifiers_phone_email
  ON identifiers(kind, value_normalized)
  WHERE kind IN ('phone', 'email');

CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  value TEXT,
  status TEXT NOT NULL,
  evidence TEXT,
  source_event_id TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(contact_id, field_key)
);

CREATE TABLE IF NOT EXISTS conflicts (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  existing_value TEXT,
  incoming_value TEXT,
  source_event_id TEXT,
  created_at TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS source_events (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT UNIQUE,
  content_hash TEXT UNIQUE,
  contact_id TEXT,
  review_id TEXT,
  source_kind TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  image_path TEXT,
  ocr_confidence REAL,
  created_at TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_items (
  id TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  source_event_id TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  review_item_id TEXT,
  channel TEXT NOT NULL,
  recipient TEXT,
  body TEXT NOT NULL,
  context TEXT NOT NULL,
  purpose TEXT NOT NULL,
  scheduled_for TEXT,
  status TEXT NOT NULL,
  dedupe_key TEXT UNIQUE,
  send_attempts INTEGER NOT NULL DEFAULT 0,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sent_messages (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL,
  sent_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT,
  due_at TEXT,
  status TEXT NOT NULL,
  dedupe_key TEXT UNIQUE,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  time_role TEXT NOT NULL,
  status TEXT NOT NULL,
  location TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  dedupe_key TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL,
  source_note TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  dedupe_key TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  detail TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  dedupe_key TEXT UNIQUE,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS authorizations (
  id TEXT PRIMARY KEY,
  workflow_key TEXT UNIQUE,
  audience TEXT NOT NULL,
  limits_text TEXT NOT NULL,
  stop_conditions TEXT NOT NULL,
  authorized_at TEXT NOT NULL
);
`;

export function openDatabase(path: string): SqlDb {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = openSql(path);
  db.exec(SCHEMA);
  const paused = db.get(`SELECT value FROM settings WHERE key = 'outbound_paused'`);
  if (!paused) db.run(`INSERT INTO settings (key, value) VALUES ('outbound_paused', 'true')`);
  const limit = db.get(`SELECT value FROM settings WHERE key = 'spend_limit_usd'`);
  if (!limit) db.run(`INSERT INTO settings (key, value) VALUES ('spend_limit_usd', '0')`);
  return db;
}
