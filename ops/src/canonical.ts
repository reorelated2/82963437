import { randomUUID } from 'node:crypto';
import { phoneKey } from './money.ts';
import { text, transaction, type SqlDb } from './sql.ts';

export const CANONICAL_MIGRATION_ID = '2026-09-29-canonical-clients';

const MIGRATION = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  contact_id TEXT UNIQUE,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  duplicate_of_client_id TEXT,
  assigned_agent TEXT NOT NULL DEFAULT 'Kyle Kleinman',
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS client_identifiers (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  value_normalized TEXT NOT NULL,
  raw_value TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS client_identifiers_phone_email
  ON client_identifiers(kind, value_normalized)
  WHERE kind IN ('phone', 'email');

CREATE TABLE IF NOT EXISTS opportunities (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_id TEXT,
  business_line TEXT NOT NULL DEFAULT 'redfin_buyer',
  stage TEXT NOT NULL DEFAULT 'new',
  status TEXT NOT NULL DEFAULT 'open',
  source_label TEXT,
  is_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS opportunities_one_open
  ON opportunities(client_id, business_line)
  WHERE status = 'open';

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
  opportunity_id TEXT REFERENCES opportunities(id) ON DELETE CASCADE,
  contact_id TEXT,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS client_facts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  opportunity_id TEXT,
  field_key TEXT NOT NULL,
  value TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fact', 'inference')),
  verification TEXT NOT NULL CHECK (verification IN ('verified', 'unverified')),
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (client_id, field_key, kind)
);

CREATE TABLE IF NOT EXISTS identity_flags (
  id TEXT PRIMARY KEY,
  client_id TEXT,
  other_client_id TEXT,
  contact_id TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  dedupe_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_locks (
  lock_key TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  opportunity_id TEXT,
  holder TEXT NOT NULL,
  purpose TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  released_at TEXT
);
`;

export type FactKind = 'fact' | 'inference';
export type FactVerification = 'verified' | 'unverified';

export interface FactInput {
  fieldKey: string;
  value: string;
  kind: FactKind;
  verification: FactVerification;
  source: string;
}

export interface FactWriteResult {
  fieldKey: string;
  applied: boolean;
  reason: 'stored' | 'unchanged' | 'inference_blocked' | 'conflict_kept';
  keptValue: string | null;
}

export interface CanonicalLeadInput {
  idempotencyKey: string;
  source: string;
  rawText: string;
  now?: Date;
  actor?: string;
  displayName?: string | null;
  phone?: string | null;
  email?: string | null;
  businessLine?: string;
  contactId?: string | null;
  /** Desk already chose this contact. Keep a client for it even without a phone or email. */
  anchorContact?: boolean;
  isDemo?: boolean;
  facts?: FactInput[];
}

export type CanonicalStatus = 'created' | 'attached' | 'duplicate' | 'flagged' | 'needs_identity' | 'rejected';

export interface CanonicalIngestResult {
  status: CanonicalStatus;
  clientId: string | null;
  opportunityId: string | null;
  eventId: string | null;
  flaggedClientIds: string[];
  factResults: FactWriteResult[];
  liveSend: false;
  message: string;
}

export interface DeskFactInput {
  fieldKey: string;
  value: string;
  basis: string;
  evidence: string | null;
}

export interface DeskLeadSyncInput {
  contactId: string;
  displayName: string | null;
  phone: string | null;
  email: string | null;
  sourceEventId: string;
  idempotencyKey: string | null;
  contentHash: string;
  isDemo: boolean;
  now: Date;
  facts: DeskFactInput[];
}

export function applyCanonicalSchema(db: SqlDb, now = new Date()): void {
  db.exec(MIGRATION);
  const existing = db.get(`SELECT id FROM schema_migrations WHERE id = ?`, CANONICAL_MIGRATION_ID);
  if (!existing) {
    db.run(
      `INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)`,
      CANONICAL_MIGRATION_ID,
      now.toISOString(),
    );
  }
}

export function ingestCanonicalLead(db: SqlDb, input: CanonicalLeadInput): CanonicalIngestResult {
  return transaction(db, () => ingestCanonicalLeadUnlocked(db, input));
}

export function ingestCanonicalLeadUnlocked(db: SqlDb, input: CanonicalLeadInput): CanonicalIngestResult {
  const now = input.now ?? new Date();
  const actor = input.actor ?? 'system';
  const key = input.idempotencyKey.trim();
  if (!key) {
    return {
      status: 'rejected',
      clientId: null,
      opportunityId: null,
      eventId: null,
      flaggedClientIds: [],
      factResults: [],
      liveSend: false,
      message: 'An idempotency key is required. Nothing was saved.',
    };
  }

  const prior = db.get(`SELECT * FROM events WHERE idempotency_key = ?`, key);
  if (prior) {
    audit(db, actor, 'event_duplicate', text(prior, 'contact_id') || null, 'event', text(prior, 'id'), {
      idempotencyKey: key,
      kept: true,
    });
    return {
      status: 'duplicate',
      clientId: text(prior, 'client_id') || null,
      opportunityId: text(prior, 'opportunity_id') || null,
      eventId: text(prior, 'id'),
      flaggedClientIds: [],
      factResults: [],
      liveSend: false,
      message: 'That event was already stored. No second client, opportunity, or event was created.',
    };
  }

  const phone = normalizePhone(input.phone ?? null);
  const email = normalizeEmail(input.email ?? null);
  const businessLine = input.businessLine?.trim() || 'redfin_buyer';
  const phoneClient = phone ? clientByIdentifier(db, 'phone', phone) : null;
  const emailClient = email ? clientByIdentifier(db, 'email', email) : null;

  if (phoneClient && emailClient && phoneClient !== emailClient) {
    flagIdentity(db, {
      clientIds: [phoneClient, emailClient],
      contactId: input.contactId ?? null,
      reason: 'Phone and email belong to different clients. Nothing was merged or deleted.',
      dedupeKey: pairKey(phoneClient, emailClient),
      now,
      actor,
    });
    const eventId = insertEvent(db, {
      idempotencyKey: key,
      clientId: null,
      opportunityId: null,
      contactId: input.contactId ?? null,
      kind: 'identity_flagged',
      isDemo: Boolean(input.isDemo),
      now,
      payload: {
        source: input.source,
        rawText: input.rawText,
        phone,
        email,
        flaggedClientIds: [phoneClient, emailClient],
      },
    });
    return {
      status: 'flagged',
      clientId: null,
      opportunityId: null,
      eventId,
      flaggedClientIds: [phoneClient, emailClient],
      factResults: [],
      liveSend: false,
      message: 'Phone and email belong to different clients. Nothing was merged or deleted.',
    };
  }

  if (!phone && !email && input.anchorContact && input.contactId) {
    const anchored = anchorDeskClient(db, {
      contactId: input.contactId,
      displayName: input.displayName ?? null,
      isDemo: Boolean(input.isDemo),
      businessLine,
      source: input.source,
      facts: input.facts ?? [],
      idempotencyKey: key,
      rawText: input.rawText,
      now,
      actor,
    });
    return anchored;
  }

  if (!phone && !email) {
    const named = findClientsByName(db, input.displayName ?? null);
    if (named.length > 0) {
      flagIdentity(db, {
        clientIds: named,
        contactId: input.contactId ?? null,
        reason: 'The name matches an existing client without a phone or email. Nothing was merged or deleted.',
        dedupeKey: `name:${named.slice().sort().join(':')}:${normalizeName(input.displayName ?? '')}`,
        now,
        actor,
      });
      const eventId = insertEvent(db, {
        idempotencyKey: key,
        clientId: null,
        opportunityId: null,
        contactId: input.contactId ?? null,
        kind: 'identity_flagged',
        isDemo: Boolean(input.isDemo),
        now,
        payload: { source: input.source, rawText: input.rawText, flaggedClientIds: named },
      });
      return {
        status: 'flagged',
        clientId: null,
        opportunityId: null,
        eventId,
        flaggedClientIds: named,
        factResults: [],
        liveSend: false,
        message: 'Name match only. Flagged for review. Nothing was merged or deleted.',
      };
    }
    const eventId = insertEvent(db, {
      idempotencyKey: key,
      clientId: null,
      opportunityId: null,
      contactId: input.contactId ?? null,
      kind: 'lead_needs_identity',
      isDemo: Boolean(input.isDemo),
      now,
      payload: { source: input.source, rawText: input.rawText },
    });
    return {
      status: 'needs_identity',
      clientId: null,
      opportunityId: null,
      eventId,
      flaggedClientIds: [],
      factResults: [],
      liveSend: false,
      message: 'No phone or email. No client was created.',
    };
  }

  const matched = phoneClient ?? emailClient;
  let clientId = matched;
  let created = false;
  if (!clientId && input.contactId) {
    const byContact = db.get(`SELECT id FROM clients WHERE contact_id = ?`, input.contactId);
    if (byContact) clientId = text(byContact, 'id');
  }
  if (!clientId) {
    clientId = insertClient(db, {
      contactId: input.contactId ?? null,
      displayName: input.displayName ?? null,
      isDemo: Boolean(input.isDemo),
      now,
      actor,
    });
    created = true;
  } else if (input.contactId) {
    linkContactIfEmpty(db, clientId, input.contactId, now);
  }

  rememberIdentifier(db, clientId, 'phone', phone, input.phone ?? phone);
  rememberIdentifier(db, clientId, 'email', email, input.email ?? email);
  const opportunityId = ensureOpenOpportunity(db, {
    clientId,
    contactId: input.contactId ?? null,
    businessLine,
    sourceLabel: input.source,
    isDemo: Boolean(input.isDemo),
    now,
    actor,
  });
  const factResults = (input.facts ?? []).map((fact) => writeClientFact(db, {
    clientId,
    opportunityId,
    fact,
    now,
    actor,
  }));
  const eventId = insertEvent(db, {
    idempotencyKey: key,
    clientId,
    opportunityId,
    contactId: input.contactId ?? null,
    kind: created ? 'lead_created' : 'lead_attached',
    isDemo: Boolean(input.isDemo),
    now,
    payload: {
      source: input.source,
      rawText: input.rawText,
      displayName: input.displayName ?? null,
    },
  });
  return {
    status: created ? 'created' : 'attached',
    clientId,
    opportunityId,
    eventId,
    flaggedClientIds: [],
    factResults,
    liveSend: false,
    message: created
      ? 'Client, opportunity, and event stored. Nothing was sent.'
      : 'Attached to the existing client and opportunity. Nothing was sent.',
  };
}

export function syncDeskLead(db: SqlDb, input: DeskLeadSyncInput): CanonicalIngestResult {
  const facts = input.facts.flatMap((fact) => {
    const mapped = mapDeskBasis(fact);
    return mapped ? [mapped] : [];
  });
  return ingestCanonicalLeadUnlocked(db, {
    idempotencyKey: `desk:${input.idempotencyKey?.trim() || input.contentHash}`,
    source: 'desk',
    rawText: `desk source_event ${input.sourceEventId}`,
    now: input.now,
    actor: 'desk',
    displayName: input.displayName,
    phone: input.phone,
    email: input.email,
    contactId: input.contactId,
    anchorContact: true,
    isDemo: input.isDemo,
    facts,
  });
}

export function flagDeskCandidates(db: SqlDb, input: {
  candidateContactIds: string[];
  idempotencyKey: string;
  now: Date;
  isDemo: boolean;
  reason: string;
}): void {
  const key = `desk-flag:${input.idempotencyKey}`;
  if (db.get(`SELECT id FROM events WHERE idempotency_key = ?`, key)) return;
  const clientIds = input.candidateContactIds.flatMap((contactId) => {
    const row = db.get(`SELECT id FROM clients WHERE contact_id = ?`, contactId);
    return row ? [text(row, 'id')] : [];
  });
  const contactId = input.candidateContactIds[0] ?? null;
  if (clientIds.length > 0) {
    flagIdentity(db, {
      clientIds,
      contactId,
      reason: input.reason,
      dedupeKey: `desk:${[...clientIds].sort().join(':')}:${input.idempotencyKey}`,
      now: input.now,
      actor: 'desk',
    });
  } else if (contactId) {
    const dedupeKey = `desk-contact:${input.candidateContactIds.slice().sort().join(':')}`;
    if (!db.get(`SELECT id FROM identity_flags WHERE dedupe_key = ?`, dedupeKey)) {
      db.run(
        `INSERT INTO identity_flags (id, client_id, other_client_id, contact_id, reason, status, dedupe_key, created_at)
         VALUES (?, NULL, NULL, ?, ?, 'open', ?, ?)`,
        randomUUID(),
        contactId,
        input.reason,
        dedupeKey,
        input.now.toISOString(),
      );
    }
  }
  insertEvent(db, {
    idempotencyKey: key,
    clientId: null,
    opportunityId: null,
    contactId,
    kind: 'identity_flagged',
    isDemo: input.isDemo,
    now: input.now,
    payload: {
      source: 'desk',
      reason: input.reason,
      candidateContactIds: input.candidateContactIds,
      flaggedClientIds: clientIds,
      destroyed: false,
    },
  });
}

export function writeClientFact(db: SqlDb, input: {
  clientId: string;
  opportunityId: string | null;
  fact: FactInput;
  now: Date;
  actor?: string;
}): FactWriteResult {
  const actor = input.actor ?? 'system';
  const nowIso = input.now.toISOString();
  const fieldKey = input.fact.fieldKey.trim();
  const value = input.fact.value.trim();
  const kind: FactKind = input.fact.kind === 'inference' ? 'inference' : 'fact';
  const verification: FactVerification = kind === 'inference'
    ? 'unverified'
    : input.fact.verification === 'verified' ? 'verified' : 'unverified';
  if (!fieldKey || !value) {
    return { fieldKey, applied: false, reason: 'unchanged', keptValue: null };
  }

  const verified = db.get(
    `SELECT value FROM client_facts WHERE client_id = ? AND field_key = ? AND kind = 'fact' AND verification = 'verified'`,
    input.clientId,
    fieldKey,
  );
  if (kind === 'inference' && verified) {
    audit(db, actor, 'fact_inference_rejected', null, 'client_fact', input.clientId, {
      fieldKey,
      keptValue: text(verified, 'value'),
      rejectedValue: value,
    }, { value: text(verified, 'value') });
    return {
      fieldKey,
      applied: false,
      reason: 'inference_blocked',
      keptValue: text(verified, 'value'),
    };
  }

  const existing = db.get(
    `SELECT * FROM client_facts WHERE client_id = ? AND field_key = ? AND kind = ?`,
    input.clientId,
    fieldKey,
    kind,
  );
  if (!existing) {
    db.run(
      `INSERT INTO client_facts (id, client_id, opportunity_id, field_key, value, kind, verification, source, observed_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(),
      input.clientId,
      input.opportunityId,
      fieldKey,
      value,
      kind,
      verification,
      input.fact.source,
      nowIso,
      nowIso,
    );
    audit(db, actor, kind === 'inference' ? 'inference_stored' : 'fact_stored', null, 'client_fact', input.clientId, {
      fieldKey,
      value,
      kind,
      verification,
    });
    return { fieldKey, applied: true, reason: 'stored', keptValue: value };
  }

  const existingValue = text(existing, 'value');
  const existingVerification = text(existing, 'verification');
  if (existingVerification === 'verified' && existingValue !== value) {
    audit(db, actor, 'fact_conflict_kept', null, 'client_fact', text(existing, 'id'), {
      fieldKey,
      keptValue: existingValue,
      rejectedValue: value,
    }, { value: existingValue });
    return { fieldKey, applied: false, reason: 'conflict_kept', keptValue: existingValue };
  }
  if (existingValue === value && existingVerification === verification) {
    return { fieldKey, applied: false, reason: 'unchanged', keptValue: existingValue };
  }
  if (existingVerification === 'verified' && verification !== 'verified') {
    return { fieldKey, applied: false, reason: 'conflict_kept', keptValue: existingValue };
  }
  db.run(
    `UPDATE client_facts SET value = ?, verification = ?, source = ?, opportunity_id = ?, observed_at = ?, updated_at = ? WHERE id = ?`,
    value,
    verification,
    input.fact.source,
    input.opportunityId,
    nowIso,
    nowIso,
    text(existing, 'id'),
  );
  audit(db, actor, 'fact_stored', null, 'client_fact', text(existing, 'id'), {
    fieldKey,
    value,
    verification,
  }, { value: existingValue, verification: existingVerification });
  return { fieldKey, applied: true, reason: 'stored', keptValue: value };
}

export function listClientFacts(db: SqlDb, clientId: string): Array<{
  fieldKey: string;
  value: string;
  kind: string;
  verification: string;
}> {
  return db.all(`SELECT * FROM client_facts WHERE client_id = ? ORDER BY field_key, kind`, clientId).map((row) => ({
    fieldKey: text(row, 'field_key'),
    value: text(row, 'value'),
    kind: text(row, 'kind'),
    verification: text(row, 'verification'),
  }));
}

export function claimWorkflowLock(db: SqlDb, input: {
  clientId: string;
  holder: string;
  purpose?: string;
  opportunityId?: string | null;
  now?: Date;
  actor?: string;
}): { acquired: boolean; holder: string; lockKey: string; reason: string } {
  const now = input.now ?? new Date();
  const actor = input.actor ?? input.holder;
  const purpose = input.purpose?.trim() || 'contact_claim';
  const lockKey = `${purpose}:${input.clientId}`;
  const client = db.get(`SELECT id FROM clients WHERE id = ?`, input.clientId);
  if (!client) {
    return { acquired: false, holder: '', lockKey, reason: 'No client exists for that lock. Nothing was claimed.' };
  }
  const existing = db.get(`SELECT * FROM workflow_locks WHERE lock_key = ?`, lockKey);
  if (existing && !text(existing, 'released_at')) {
    const holder = text(existing, 'holder');
    if (holder === input.holder) {
      return { acquired: true, holder, lockKey, reason: 'This holder already has the contact claim.' };
    }
    audit(db, actor, 'workflow_lock_denied', null, 'workflow_lock', lockKey, {
      requestedBy: input.holder,
      holder,
      purpose,
    });
    return {
      acquired: false,
      holder,
      lockKey,
      reason: `Contact claim is held by ${holder}. A second claim was not granted.`,
    };
  }
  if (existing) {
    db.run(
      `UPDATE workflow_locks SET holder = ?, purpose = ?, opportunity_id = ?, acquired_at = ?, released_at = NULL WHERE lock_key = ?`,
      input.holder,
      purpose,
      input.opportunityId ?? null,
      now.toISOString(),
      lockKey,
    );
  } else {
    db.run(
      `INSERT INTO workflow_locks (lock_key, client_id, opportunity_id, holder, purpose, acquired_at, released_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
      lockKey,
      input.clientId,
      input.opportunityId ?? null,
      input.holder,
      purpose,
      now.toISOString(),
    );
  }
  audit(db, actor, 'workflow_lock_acquired', null, 'workflow_lock', lockKey, {
    holder: input.holder,
    purpose,
  });
  return { acquired: true, holder: input.holder, lockKey, reason: 'Contact claim acquired. Nothing was sent.' };
}

export function releaseWorkflowLock(db: SqlDb, input: {
  clientId: string;
  holder: string;
  purpose?: string;
  now?: Date;
}): { released: boolean; reason: string } {
  const purpose = input.purpose?.trim() || 'contact_claim';
  const lockKey = `${purpose}:${input.clientId}`;
  const existing = db.get(`SELECT * FROM workflow_locks WHERE lock_key = ?`, lockKey);
  if (!existing || text(existing, 'released_at')) {
    return { released: false, reason: 'No open contact claim was found.' };
  }
  if (text(existing, 'holder') !== input.holder) {
    return { released: false, reason: 'Only the holder can release this contact claim.' };
  }
  db.run(
    `UPDATE workflow_locks SET released_at = ? WHERE lock_key = ?`,
    (input.now ?? new Date()).toISOString(),
    lockKey,
  );
  audit(db, input.holder, 'workflow_lock_released', null, 'workflow_lock', lockKey, { holder: input.holder });
  return { released: true, reason: 'Contact claim released.' };
}

export function deleteDemoCanonical(db: SqlDb): void {
  db.run(`DELETE FROM events WHERE is_demo = 1 AND client_id IS NULL`);
  db.run(
    `DELETE FROM identity_flags WHERE client_id IN (SELECT id FROM clients WHERE is_demo = 1)
      OR other_client_id IN (SELECT id FROM clients WHERE is_demo = 1)`,
  );
  db.run(`DELETE FROM clients WHERE is_demo = 1`);
}

function anchorDeskClient(db: SqlDb, input: {
  contactId: string;
  displayName: string | null;
  isDemo: boolean;
  businessLine: string;
  source: string;
  facts: FactInput[];
  idempotencyKey: string;
  rawText: string;
  now: Date;
  actor: string;
}): CanonicalIngestResult {
  const existing = db.get(`SELECT id FROM clients WHERE contact_id = ?`, input.contactId);
  let clientId = existing ? text(existing, 'id') : null;
  let created = false;
  if (!clientId) {
    clientId = insertClient(db, {
      contactId: input.contactId,
      displayName: input.displayName,
      isDemo: input.isDemo,
      now: input.now,
      actor: input.actor,
    });
    created = true;
  }
  const others = findClientsByName(db, input.displayName).filter((id) => id !== clientId);
  if (others.length > 0) {
    flagIdentity(db, {
      clientIds: [clientId, ...others],
      contactId: input.contactId,
      reason: 'Same name on another client. The desk contact was kept separate. Nothing was merged or deleted.',
      dedupeKey: `anchor:${[clientId, ...others].sort().join(':')}`,
      now: input.now,
      actor: input.actor,
    });
  }
  const opportunityId = ensureOpenOpportunity(db, {
    clientId,
    contactId: input.contactId,
    businessLine: input.businessLine,
    sourceLabel: input.source,
    isDemo: input.isDemo,
    now: input.now,
    actor: input.actor,
  });
  const factResults = input.facts.map((fact) => writeClientFact(db, {
    clientId: clientId!,
    opportunityId,
    fact,
    now: input.now,
    actor: input.actor,
  }));
  const eventId = insertEvent(db, {
    idempotencyKey: input.idempotencyKey,
    clientId,
    opportunityId,
    contactId: input.contactId,
    kind: created ? 'lead_created' : 'lead_attached',
    isDemo: input.isDemo,
    now: input.now,
    payload: { source: input.source, rawText: input.rawText, displayName: input.displayName },
  });
  return {
    status: created ? 'created' : 'attached',
    clientId,
    opportunityId,
    eventId,
    flaggedClientIds: others,
    factResults,
    liveSend: false,
    message: 'Client, opportunity, and event stored for the desk contact. Nothing was sent.',
  };
}

function mapDeskBasis(fact: DeskFactInput): FactInput | null {
  if (!fact.value.trim()) return null;
  if (fact.basis === 'inferred') {
    return {
      fieldKey: fact.fieldKey,
      value: fact.value,
      kind: 'inference',
      verification: 'unverified',
      source: fact.evidence ?? 'desk',
    };
  }
  if (fact.basis === 'confirmed') {
    return {
      fieldKey: fact.fieldKey,
      value: fact.value,
      kind: 'fact',
      verification: 'verified',
      source: fact.evidence ?? 'desk',
    };
  }
  if (fact.basis === 'said') {
    return {
      fieldKey: fact.fieldKey,
      value: fact.value,
      kind: 'fact',
      verification: 'unverified',
      source: fact.evidence ?? 'desk',
    };
  }
  return null;
}

function insertClient(db: SqlDb, input: {
  contactId: string | null;
  displayName: string | null;
  isDemo: boolean;
  now: Date;
  actor: string;
}): string {
  const id = randomUUID();
  const nowIso = input.now.toISOString();
  db.run(
    `INSERT INTO clients (id, contact_id, display_name, status, duplicate_of_client_id, assigned_agent, is_demo, created_at, updated_at)
     VALUES (?, ?, ?, 'active', NULL, 'Kyle Kleinman', ?, ?, ?)`,
    id,
    input.contactId,
    input.displayName,
    input.isDemo ? 1 : 0,
    nowIso,
    nowIso,
  );
  audit(db, input.actor, 'client_created', input.contactId, 'client', id, {
    displayName: input.displayName,
    contactId: input.contactId,
  });
  return id;
}

function linkContactIfEmpty(db: SqlDb, clientId: string, contactId: string, now: Date): void {
  const row = db.get(`SELECT contact_id FROM clients WHERE id = ?`, clientId);
  if (text(row, 'contact_id')) return;
  const taken = db.get(`SELECT id FROM clients WHERE contact_id = ? AND id != ?`, contactId, clientId);
  if (taken) return;
  db.run(`UPDATE clients SET contact_id = ?, updated_at = ? WHERE id = ?`, contactId, now.toISOString(), clientId);
}

function ensureOpenOpportunity(db: SqlDb, input: {
  clientId: string;
  contactId: string | null;
  businessLine: string;
  sourceLabel: string;
  isDemo: boolean;
  now: Date;
  actor: string;
}): string {
  const existing = db.get(
    `SELECT id FROM opportunities WHERE client_id = ? AND business_line = ? AND status = 'open'`,
    input.clientId,
    input.businessLine,
  );
  if (existing) return text(existing, 'id');
  const id = randomUUID();
  const nowIso = input.now.toISOString();
  db.run(
    `INSERT INTO opportunities (id, client_id, contact_id, business_line, stage, status, source_label, is_demo, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'new', 'open', ?, ?, ?, ?)`,
    id,
    input.clientId,
    input.contactId,
    input.businessLine,
    input.sourceLabel,
    input.isDemo ? 1 : 0,
    nowIso,
    nowIso,
  );
  audit(db, input.actor, 'opportunity_created', input.contactId, 'opportunity', id, {
    clientId: input.clientId,
    businessLine: input.businessLine,
    stage: 'new',
  });
  return id;
}

function insertEvent(db: SqlDb, input: {
  idempotencyKey: string;
  clientId: string | null;
  opportunityId: string | null;
  contactId: string | null;
  kind: string;
  payload: unknown;
  isDemo: boolean;
  now: Date;
}): string {
  const id = randomUUID();
  db.run(
    `INSERT INTO events (id, idempotency_key, client_id, opportunity_id, contact_id, kind, payload_json, is_demo, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.idempotencyKey,
    input.clientId,
    input.opportunityId,
    input.contactId,
    input.kind,
    JSON.stringify(input.payload),
    input.isDemo ? 1 : 0,
    input.now.toISOString(),
  );
  audit(db, 'system', 'event_recorded', input.contactId, 'event', id, {
    kind: input.kind,
    idempotencyKey: input.idempotencyKey,
    clientId: input.clientId,
    opportunityId: input.opportunityId,
  });
  return id;
}

function flagIdentity(db: SqlDb, input: {
  clientIds: string[];
  contactId: string | null;
  reason: string;
  dedupeKey: string;
  now: Date;
  actor: string;
}): void {
  const existing = db.get(`SELECT id FROM identity_flags WHERE dedupe_key = ?`, input.dedupeKey);
  if (existing) return;
  const ids = [...new Set(input.clientIds)].filter(Boolean);
  const before = ids.map((id) => {
    const row = db.get(`SELECT id, display_name, status FROM clients WHERE id = ?`, id);
    return { id, displayName: text(row, 'display_name'), status: text(row, 'status') };
  });
  db.run(
    `INSERT INTO identity_flags (id, client_id, other_client_id, contact_id, reason, status, dedupe_key, created_at)
     VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`,
    randomUUID(),
    ids[0] ?? null,
    ids[1] ?? null,
    input.contactId,
    input.reason,
    input.dedupeKey,
    input.now.toISOString(),
  );
  audit(db, input.actor, 'identity_flagged', input.contactId, 'identity_flag', input.dedupeKey, {
    clientIds: ids,
    reason: input.reason,
    destroyed: false,
  }, { clients: before });
}

function rememberIdentifier(db: SqlDb, clientId: string, kind: 'phone' | 'email', normalized: string | null, raw: string | null): void {
  if (!normalized) return;
  const existing = db.get(
    `SELECT client_id FROM client_identifiers WHERE kind = ? AND value_normalized = ?`,
    kind,
    normalized,
  );
  if (existing) return;
  db.run(
    `INSERT INTO client_identifiers (id, client_id, kind, value_normalized, raw_value, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    randomUUID(),
    clientId,
    kind,
    normalized,
    raw ?? normalized,
    new Date().toISOString(),
  );
}

function clientByIdentifier(db: SqlDb, kind: 'phone' | 'email', normalized: string): string | null {
  const row = db.get(
    `SELECT client_id FROM client_identifiers WHERE kind = ? AND value_normalized = ?`,
    kind,
    normalized,
  );
  return row ? text(row, 'client_id') : null;
}

function findClientsByName(db: SqlDb, displayName: string | null): string[] {
  const name = normalizeName(displayName ?? '');
  if (!name) return [];
  return db.all(`SELECT id, display_name FROM clients`).flatMap((row) => {
    return normalizeName(text(row, 'display_name')) === name ? [text(row, 'id')] : [];
  });
}

function normalizePhone(value: string | null): string | null {
  if (!value) return null;
  return phoneKey(value);
}

function normalizeEmail(value: string | null): string | null {
  if (!value) return null;
  const email = value.trim().toLowerCase();
  if (!email.includes('@')) return null;
  return email;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function pairKey(left: string, right: string): string {
  return left < right ? `pair:${left}:${right}` : `pair:${right}:${left}`;
}

function audit(
  db: SqlDb,
  actor: string,
  action: string,
  contactId: string | null,
  entityType: string,
  entityId: string | null,
  after: unknown,
  before?: unknown,
): void {
  db.run(
    `INSERT INTO audit_log (id, at, actor, action, contact_id, entity_type, entity_id, before_json, after_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    randomUUID(),
    new Date().toISOString(),
    actor,
    action,
    contactId,
    entityType,
    entityId,
    before === undefined ? null : JSON.stringify(before),
    JSON.stringify(after),
  );
}
