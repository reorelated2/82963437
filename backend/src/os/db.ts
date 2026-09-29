import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface ContactRow {
  id: string;
  display_name: string;
  first_name: string | null;
  phone: string | null;
  email: string | null;
  lead_source: string | null;
  assigned_agent: string | null;
  stage: string;
  property_use: string | null;
  financing_status: string | null;
  budget_cents: number | null;
  budget_label: string | null;
  timeline: string | null;
  motivation: string | null;
  must_haves: string | null;
  deal_breakers: string | null;
  preferred_areas: string | null;
  is_demo: number;
  suppressed: number;
  suppression_reason: string | null;
  preferred_language: string | null;
  relationship_type: string;
  household_id: string | null;
  original_lead_source: string | null;
  created_at: string;
  updated_at: string;
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  first_name TEXT,
  phone TEXT,
  email TEXT,
  lead_source TEXT,
  assigned_agent TEXT,
  stage TEXT NOT NULL DEFAULT 'new',
  property_use TEXT,
  financing_status TEXT,
  budget_cents INTEGER,
  budget_label TEXT,
  timeline TEXT,
  motivation TEXT,
  must_haves TEXT,
  deal_breakers TEXT,
  preferred_areas TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  suppressed INTEGER NOT NULL DEFAULT 0,
  suppression_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contact_identifiers (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  value_normalized TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ident_exact
  ON contact_identifiers(kind, value_normalized)
  WHERE kind IN ('phone', 'email');

CREATE TABLE IF NOT EXISTS facts (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  value TEXT,
  status TEXT NOT NULL,
  source_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  raw_text TEXT,
  file_path TEXT,
  content_hash TEXT NOT NULL UNIQUE,
  ocr_confidence REAL,
  unclear INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  address TEXT,
  mls_number TEXT,
  area TEXT,
  role TEXT NOT NULL DEFAULT 'inquiry',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS showings (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  property_id TEXT,
  requested_time TEXT,
  available_time TEXT,
  confirmed_time TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'text',
  recipient TEXT,
  body TEXT NOT NULL,
  context TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_for TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  sent_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  detail TEXT,
  due_at TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  kind TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_at TEXT,
  status TEXT NOT NULL DEFAULT 'upcoming',
  source_clause TEXT,
  demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_items (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  source_id TEXT,
  summary TEXT NOT NULL,
  message_id TEXT,
  note_id TEXT,
  task_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  match_reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  payload TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS authorizations (
  id TEXT PRIMARY KEY,
  workflow TEXT NOT NULL UNIQUE,
  audience TEXT NOT NULL,
  limits TEXT NOT NULL,
  stop_conditions TEXT NOT NULL,
  authorized_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_attributions (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  is_original INTEGER NOT NULL DEFAULT 0
);
`;

export class Store {
  constructor(private readonly box: { db: DatabaseSync; file: string }) {}

  get file(): string {
    return this.box.file;
  }

  private get db(): DatabaseSync {
    return this.box.db;
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }

  reopen(next: DatabaseSync): void {
    this.box.db = next;
  }

  setting(key: string, fallback: string): string {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value ?? fallback;
  }

  setSetting(key: string, value: string): void {
    this.db.prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
  }

  sourceByHash(hash: string): { id: string; contact_id: string | null } | undefined {
    return this.db.prepare("SELECT id, contact_id FROM sources WHERE content_hash = ?").get(hash) as
      | { id: string; contact_id: string | null }
      | undefined;
  }

  contactByIdentifier(kind: "phone" | "email", value: string): ContactRow | undefined {
    return this.db
      .prepare(
        `SELECT c.* FROM contacts c
         JOIN contact_identifiers i ON i.contact_id = c.id
         WHERE i.kind = ? AND i.value_normalized = ?`,
      )
      .get(kind, value) as ContactRow | undefined;
  }

  contactsByName(name: string): ContactRow[] {
    return this.db.prepare("SELECT * FROM contacts WHERE lower(display_name) = lower(?)").all(name) as unknown as ContactRow[];
  }

  contact(id: string): ContactRow | undefined {
    return this.db.prepare("SELECT * FROM contacts WHERE id = ?").get(id) as ContactRow | undefined;
  }

  insertContact(row: ContactRow): void {
    this.db
      .prepare(
        `INSERT INTO contacts (
          id, display_name, first_name, phone, email, lead_source, assigned_agent, stage,
          property_use, financing_status, budget_cents, budget_label, timeline, motivation,
          must_haves, deal_breakers, preferred_areas, is_demo, suppressed, suppression_reason,
          preferred_language, relationship_type, household_id, original_lead_source,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.display_name,
        row.first_name,
        row.phone,
        row.email,
        row.lead_source,
        row.assigned_agent,
        row.stage,
        row.property_use,
        row.financing_status,
        row.budget_cents,
        row.budget_label,
        row.timeline,
        row.motivation,
        row.must_haves,
        row.deal_breakers,
        row.preferred_areas,
        row.is_demo,
        row.suppressed,
        row.suppression_reason,
        row.preferred_language,
        row.relationship_type,
        row.household_id,
        row.original_lead_source,
        row.created_at,
        row.updated_at,
      );
  }

  updateContact(id: string, patch: Partial<ContactRow>, updatedAt: string): void {
    const current = this.contact(id);
    if (!current) return;
    const next = { ...current, ...patch, id, updated_at: updatedAt };
    this.db
      .prepare(
        `UPDATE contacts SET
          display_name = ?, first_name = ?, phone = ?, email = ?, lead_source = ?, assigned_agent = ?,
          stage = ?, property_use = ?, financing_status = ?, budget_cents = ?, budget_label = ?,
          timeline = ?, motivation = ?, must_haves = ?, deal_breakers = ?, preferred_areas = ?,
          is_demo = ?, suppressed = ?, suppression_reason = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        next.display_name,
        next.first_name,
        next.phone,
        next.email,
        next.lead_source,
        next.assigned_agent,
        next.stage,
        next.property_use,
        next.financing_status,
        next.budget_cents,
        next.budget_label,
        next.timeline,
        next.motivation,
        next.must_haves,
        next.deal_breakers,
        next.preferred_areas,
        next.is_demo,
        next.suppressed,
        next.suppression_reason,
        next.updated_at,
        id,
      );
  }

  insertIdentifier(id: string, contactId: string, kind: string, value: string): void {
    this.db
      .prepare("INSERT INTO contact_identifiers(id, contact_id, kind, value_normalized) VALUES(?, ?, ?, ?)")
      .run(id, contactId, kind, value);
  }

  insertFact(id: string, contactId: string, field: string, value: string | null, status: string, sourceId: string, createdAt: string, origin = "said"): void {
    this.db
      .prepare("INSERT INTO facts(id, contact_id, field, value, status, source_id, created_at, origin) VALUES(?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, contactId, field, value, status, sourceId, createdAt, origin);
  }

  insertSource(row: {
    id: string;
    contactId: string | null;
    kind: string;
    rawText: string | null;
    filePath: string | null;
    contentHash: string;
    ocrConfidence: number | null;
    unclear: number;
    createdAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO sources(id, contact_id, kind, raw_text, file_path, content_hash, ocr_confidence, unclear, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.contactId, row.kind, row.rawText, row.filePath, row.contentHash, row.ocrConfidence, row.unclear, row.createdAt);
  }

  linkSource(sourceId: string, contactId: string): void {
    this.db.prepare("UPDATE sources SET contact_id = ? WHERE id = ?").run(contactId, sourceId);
  }

  insertProperty(id: string, contactId: string, address: string | null, mls: string | null, area: string | null, createdAt: string): void {
    this.db
      .prepare("INSERT INTO properties(id, contact_id, address, mls_number, area, role, created_at) VALUES(?, ?, ?, ?, ?, 'inquiry', ?)")
      .run(id, contactId, address, mls, area, createdAt);
  }

  insertShowing(row: {
    id: string;
    contactId: string;
    requested: string | null;
    available: string | null;
    confirmed: string | null;
    status: string;
    createdAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO showings(id, contact_id, requested_time, available_time, confirmed_time, status, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.contactId, row.requested, row.available, row.confirmed, row.status, row.createdAt);
  }

  insertMessage(row: {
    id: string;
    contactId: string;
    recipient: string;
    body: string;
    context: string;
    purpose: string;
    scheduledFor: string | null;
    idempotencyKey: string;
    createdAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO messages(
          id, contact_id, channel, recipient, body, context, purpose, status, scheduled_for, idempotency_key, sent_at, created_at
        ) VALUES(?, ?, 'text', ?, ?, ?, ?, 'draft', ?, ?, NULL, ?)`,
      )
      .run(row.id, row.contactId, row.recipient, row.body, row.context, row.purpose, row.scheduledFor, row.idempotencyKey, row.createdAt);
  }

  messageByKey(key: string): { id: string; contact_id: string; body: string; status: string; sent_at: string | null; recipient: string | null; purpose: string; context: string; scheduled_for: string | null; channel: string } | undefined {
    return this.db.prepare("SELECT * FROM messages WHERE idempotency_key = ?").get(key) as never;
  }

  message(id: string): { id: string; contact_id: string; body: string; status: string; sent_at: string | null; recipient: string | null; purpose: string; context: string; scheduled_for: string | null; channel: string } | undefined {
    return this.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as never;
  }

  setMessageStatus(id: string, status: string): void {
    this.db.prepare("UPDATE messages SET status = ?, sent_at = NULL WHERE id = ?").run(status, id);
  }

  insertNote(id: string, contactId: string, body: string, key: string, createdAt: string): void {
    this.db.prepare("INSERT INTO notes(id, contact_id, body, idempotency_key, created_at) VALUES(?, ?, ?, ?, ?)").run(id, contactId, body, key, createdAt);
  }

  noteByKey(key: string): { id: string } | undefined {
    return this.db.prepare("SELECT id FROM notes WHERE idempotency_key = ?").get(key) as { id: string } | undefined;
  }

  insertTask(row: { id: string; contactId: string | null; title: string; detail: string; dueAt: string | null; kind: string; key: string; createdAt: string }): void {
    this.db
      .prepare(
        `INSERT INTO tasks(id, contact_id, title, detail, due_at, status, kind, idempotency_key, created_at)
         VALUES(?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
      )
      .run(row.id, row.contactId, row.title, row.detail, row.dueAt, row.kind, row.key, row.createdAt);
  }

  taskByKey(key: string): { id: string } | undefined {
    return this.db.prepare("SELECT id FROM tasks WHERE idempotency_key = ?").get(key) as { id: string } | undefined;
  }

  completeTask(id: string): void {
    this.db.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").run(id);
  }

  completeOpenFollowUps(contactId: string): void {
    this.db
      .prepare("UPDATE tasks SET status = 'done' WHERE contact_id = ? AND status = 'open' AND kind IN ('follow_up', 'reply')")
      .run(contactId);
  }

  cancelOpenDrafts(contactId: string): void {
    this.db.prepare("UPDATE messages SET status = 'cancelled', sent_at = NULL WHERE contact_id = ? AND status = 'draft'").run(contactId);
  }

  insertAppointment(id: string, contactId: string, title: string, startsAt: string, status: string, detail: string, createdAt: string): void {
    this.db
      .prepare("INSERT INTO appointments(id, contact_id, title, starts_at, status, detail, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)")
      .run(id, contactId, title, startsAt, status, detail, createdAt);
  }

  insertMilestone(id: string, contactId: string | null, title: string, dueAt: string, source: string, demo: number, createdAt: string): void {
    this.db
      .prepare("INSERT INTO milestones(id, contact_id, title, due_at, status, source_clause, demo, created_at) VALUES(?, ?, ?, ?, 'upcoming', ?, ?, ?)")
      .run(id, contactId, title, dueAt, source, demo, createdAt);
  }

  insertReview(row: { id: string; contactId: string; sourceId: string | null; summary: string; messageId: string | null; noteId: string | null; taskId: string | null; matchReason: string | null; createdAt: string }): void {
    this.db
      .prepare(
        `INSERT INTO review_items(id, contact_id, source_id, summary, message_id, note_id, task_id, status, match_reason, created_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
      )
      .run(row.id, row.contactId, row.sourceId, row.summary, row.messageId, row.noteId, row.taskId, row.matchReason, row.createdAt);
  }

  reviewForSource(sourceId: string): { id: string; contact_id: string } | undefined {
    return this.db.prepare("SELECT id, contact_id FROM review_items WHERE source_id = ?").get(sourceId) as
      | { id: string; contact_id: string }
      | undefined;
  }

  setReviewStatus(id: string, status: string): void {
    this.db.prepare("UPDATE review_items SET status = ? WHERE id = ?").run(status, id);
  }

  insertActivity(id: string, contactId: string | null, eventType: string, payload: unknown, createdAt: string): void {
    this.db
      .prepare("INSERT INTO activity(id, contact_id, event_type, payload, created_at) VALUES(?, ?, ?, ?, ?)")
      .run(id, contactId, eventType, JSON.stringify(payload), createdAt);
  }

  insertJob(row: { id: string; type: string; status: string; lastError: string | null; payload: unknown; key: string; demo: number; createdAt: string }): void {
    this.db
      .prepare(
        `INSERT INTO jobs(id, type, status, attempts, max_attempts, last_error, payload, idempotency_key, demo, created_at, updated_at)
         VALUES(?, ?, ?, ?, 3, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.type, row.status, row.status === "failed" ? 1 : 0, row.lastError, JSON.stringify(row.payload), row.key, row.demo, row.createdAt, row.createdAt);
  }

  jobByKey(key: string): { id: string; status: string; attempts: number; max_attempts: number; last_error: string | null; type: string; payload: string; demo: number } | undefined {
    return this.db.prepare("SELECT * FROM jobs WHERE idempotency_key = ?").get(key) as never;
  }

  job(id: string): { id: string; status: string; attempts: number; max_attempts: number; last_error: string | null; type: string; payload: string; idempotency_key: string; demo: number } | undefined {
    return this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as never;
  }

  updateJob(id: string, status: string, attempts: number, lastError: string | null, updatedAt: string): void {
    this.db.prepare("UPDATE jobs SET status = ?, attempts = ?, last_error = ?, updated_at = ? WHERE id = ?").run(status, attempts, lastError, updatedAt, id);
  }

  failedJobs(): { id: string; type: string; last_error: string | null; demo: number; status: string }[] {
    return this.db
      .prepare("SELECT id, type, last_error, demo, status FROM jobs WHERE status IN ('failed', 'dead') ORDER BY updated_at DESC")
      .all() as never;
  }

  allJobs(): { id: string; type: string; status: string; last_error: string | null; attempts: number; max_attempts: number; demo: number }[] {
    return this.db.prepare("SELECT id, type, status, last_error, attempts, max_attempts, demo FROM jobs ORDER BY created_at DESC").all() as never;
  }

  authorization(workflow: string): { workflow: string } | undefined {
    return this.db.prepare("SELECT workflow FROM authorizations WHERE workflow = ?").get(workflow) as { workflow: string } | undefined;
  }

  openReviews(): Record<string, unknown>[] {
    return this.db
      .prepare(
        `SELECT r.*, c.display_name, c.is_demo, c.stage, c.phone
         FROM review_items r JOIN contacts c ON c.id = r.contact_id
         WHERE r.status = 'open' ORDER BY r.created_at DESC`,
      )
      .all() as never;
  }

  openTasks(): Record<string, unknown>[] {
    return this.db
      .prepare(
        `SELECT t.*, c.display_name, c.is_demo
         FROM tasks t LEFT JOIN contacts c ON c.id = t.contact_id
         WHERE t.status = 'open' ORDER BY t.due_at ASC`,
      )
      .all() as never;
  }

  drafts(): Record<string, unknown>[] {
    return this.db
      .prepare(
        `SELECT m.*, c.display_name, c.is_demo
         FROM messages m JOIN contacts c ON c.id = m.contact_id
         WHERE m.status = 'draft' ORDER BY m.created_at DESC`,
      )
      .all() as never;
  }

  appointments(): Record<string, unknown>[] {
    return this.db
      .prepare(
        `SELECT a.*, c.display_name, c.is_demo
         FROM appointments a JOIN contacts c ON c.id = a.contact_id
         WHERE a.status != 'cancelled' ORDER BY a.starts_at ASC`,
      )
      .all() as never;
  }

  milestones(): Record<string, unknown>[] {
    return this.db
      .prepare(
        `SELECT m.*, c.display_name, c.is_demo AS contact_demo
         FROM milestones m LEFT JOIN contacts c ON c.id = m.contact_id
         WHERE m.status = 'upcoming' ORDER BY m.due_at ASC`,
      )
      .all() as never;
  }

  rememberSource(id: string, contactId: string, source: string, observedAt: string): void {
    const current = this.contact(contactId);
    if (!current || !source) return;
    if (!current.original_lead_source) {
      this.db.prepare("UPDATE contacts SET original_lead_source = ?, lead_source = COALESCE(lead_source, ?) WHERE id = ?").run(source, source, contactId);
    }
    const existing = this.db.prepare("SELECT id FROM source_attributions WHERE contact_id = ? AND lower(source) = lower(?)").get(contactId, source) as
      | { id: string }
      | undefined;
    if (existing) return;
    const original = !current.original_lead_source || current.original_lead_source.toLowerCase() === source.toLowerCase();
    this.db
      .prepare("INSERT INTO source_attributions(id, contact_id, source, observed_at, is_original) VALUES(?, ?, ?, ?, ?)")
      .run(id, contactId, source, observedAt, original ? 1 : 0);
  }

  attributions(contactId: string): { source: string; observed_at: string; is_original: number }[] {
    return this.db
      .prepare("SELECT source, observed_at, is_original FROM source_attributions WHERE contact_id = ? ORDER BY observed_at ASC")
      .all(contactId) as never;
  }

  householdByName(name: string): { id: string } | undefined {
    return this.db.prepare("SELECT id FROM households WHERE lower(name) = lower(?)").get(name) as { id: string } | undefined;
  }

  insertHousehold(id: string, name: string, createdAt: string): void {
    this.db.prepare("INSERT INTO households(id, name, created_at) VALUES(?, ?, ?)").run(id, name, createdAt);
  }

  linkHousehold(contactId: string, householdId: string): void {
    this.db.prepare("UPDATE contacts SET household_id = ? WHERE id = ?").run(householdId, contactId);
  }

  setLanguageIfEmpty(contactId: string, language: string): void {
    this.db.prepare("UPDATE contacts SET preferred_language = ? WHERE id = ? AND preferred_language IS NULL").run(language, contactId);
  }

  suppress(contactId: string, reason: string): void {
    this.db.prepare("UPDATE contacts SET suppressed = 1, suppression_reason = ? WHERE id = ?").run(reason, contactId);
  }

  setStage(contactId: string, stage: string, updatedAt: string): void {
    this.db.prepare("UPDATE contacts SET stage = ?, updated_at = ? WHERE id = ?").run(stage, updatedAt, contactId);
  }

  contactsOverview(): {
    id: string;
    display_name: string;
    stage: string;
    is_demo: number;
    suppressed: number;
    timeline: string | null;
    financing_status: string | null;
    phone: string | null;
  }[] {
    return this.db
      .prepare("SELECT id, display_name, stage, is_demo, suppressed, timeline, financing_status, phone FROM contacts")
      .all() as never;
  }

  showingFlags(): { contact_id: string; requested_time: string | null; confirmed_time: string | null }[] {
    return this.db.prepare("SELECT contact_id, requested_time, confirmed_time FROM showings").all() as never;
  }

  openTaskContactIds(): string[] {
    return (this.db.prepare("SELECT DISTINCT contact_id FROM tasks WHERE status = 'open' AND contact_id IS NOT NULL").all() as { contact_id: string }[]).map(
      (row) => row.contact_id,
    );
  }

  demoCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM contacts WHERE is_demo = 1").get() as { n: number };
    return Number(row.n);
  }

  search(q: string): ContactRow[] {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    return this.db
      .prepare(
        `SELECT DISTINCT c.* FROM contacts c
         LEFT JOIN properties p ON p.contact_id = c.id
         LEFT JOIN notes n ON n.contact_id = c.id
         WHERE c.display_name LIKE ? OR ifnull(c.phone,'') LIKE ? OR ifnull(c.email,'') LIKE ?
            OR ifnull(p.address,'') LIKE ? OR ifnull(n.body,'') LIKE ?
         ORDER BY c.updated_at DESC LIMIT 20`,
      )
      .all(like, like, like, like, like) as unknown as ContactRow[];
  }

  contactFile(id: string): {
    contact: ContactRow;
    facts: Record<string, unknown>[];
    properties: Record<string, unknown>[];
    showings: Record<string, unknown>[];
    messages: Record<string, unknown>[];
    notes: Record<string, unknown>[];
    tasks: Record<string, unknown>[];
    reviews: Record<string, unknown>[];
    activity: Record<string, unknown>[];
    appointments: Record<string, unknown>[];
  } | null {
    const contact = this.contact(id);
    if (!contact) return null;
    const all = (sql: string) => this.db.prepare(sql).all(id) as unknown as Record<string, unknown>[];
    return {
      contact,
      facts: all("SELECT * FROM facts WHERE contact_id = ? ORDER BY created_at DESC"),
      properties: all("SELECT * FROM properties WHERE contact_id = ? ORDER BY created_at DESC"),
      showings: all("SELECT * FROM showings WHERE contact_id = ? ORDER BY created_at DESC"),
      messages: all("SELECT * FROM messages WHERE contact_id = ? ORDER BY created_at DESC"),
      notes: all("SELECT * FROM notes WHERE contact_id = ? ORDER BY created_at DESC"),
      tasks: all("SELECT * FROM tasks WHERE contact_id = ? ORDER BY created_at DESC"),
      reviews: all("SELECT * FROM review_items WHERE contact_id = ? ORDER BY created_at DESC"),
      activity: all("SELECT * FROM activity WHERE contact_id = ? ORDER BY created_at DESC"),
      appointments: all("SELECT * FROM appointments WHERE contact_id = ? ORDER BY created_at DESC"),
    };
  }

  removeDemo(): void {
    this.db.prepare("DELETE FROM contacts WHERE is_demo = 1").run();
    this.db.prepare("DELETE FROM jobs WHERE demo = 1").run();
    this.db.prepare("DELETE FROM milestones WHERE demo = 1").run();
  }

  counts(): { contacts: number; messages: number; tasks: number } {
    const one = (sql: string) => Number((this.db.prepare(sql).get() as { n: number }).n);
    return {
      contacts: one("SELECT COUNT(*) AS n FROM contacts"),
      messages: one("SELECT COUNT(*) AS n FROM messages"),
      tasks: one("SELECT COUNT(*) AS n FROM tasks"),
    };
  }

  exportBundle(): unknown {
    const table = (sql: string) => this.db.prepare(sql).all();
    return {
      exportedAt: new Date().toISOString(),
      notice: "Working copies. Redfin remains the brokerage system of record. Demo rows are marked is_demo = 1.",
      contacts: table("SELECT * FROM contacts"),
      facts: table("SELECT * FROM facts"),
      showings: table("SELECT * FROM showings"),
      messages: table("SELECT * FROM messages"),
      notes: table("SELECT * FROM notes"),
      tasks: table("SELECT * FROM tasks"),
      jobs: table("SELECT * FROM jobs"),
    };
  }
}

export function openDatabase(file: string): DatabaseSync {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  ensureColumn(db, "contacts", "preferred_language", "preferred_language TEXT");
  ensureColumn(db, "contacts", "relationship_type", "relationship_type TEXT NOT NULL DEFAULT 'buyer'");
  ensureColumn(db, "contacts", "household_id", "household_id TEXT");
  ensureColumn(db, "contacts", "original_lead_source", "original_lead_source TEXT");
  ensureColumn(db, "facts", "origin", "origin TEXT NOT NULL DEFAULT 'said'");
  const settings = db.prepare("SELECT COUNT(*) AS n FROM settings").get() as { n: number };
  if (Number(settings.n) === 0) {
    const insert = db.prepare("INSERT INTO settings(key, value) VALUES(?, ?)");
    insert.run("outbound_paused", "true");
    insert.run("spending_limit_usd", "0");
    insert.run("spend_month_usd", "0");
  }
  return db;
}

function ensureColumn(db: DatabaseSync, table: string, name: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((column) => column.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

export function dataFile(): string {
  const override = process.env.OS_DB_PATH;
  if (override) return override;
  return path.join(path.dirname(new URL(import.meta.url).pathname), "../../data/os.sqlite");
}
