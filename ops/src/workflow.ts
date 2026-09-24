import { createHash, randomUUID } from 'node:crypto';
import { FIELD_KEYS, extractLead, lacksIdentity, phoneLookupKey, type Extraction, type FactBasis, type FactField } from './extract.ts';
import { openDatabase } from './db.ts';
import { formatEt, sameEtDay, zonedLocalToUtc, zonedParts } from './time.ts';
import { text, transaction, type SqlDb } from './sql.ts';
import { buyerSummary, crmNote, draftClientMessage, internalNote, planFollowUp, type FollowUpPlan } from './voice.ts';

export interface IntakeInput {
  text: string;
  sourceKind: 'paste' | 'screenshot';
  idempotencyKey?: string | null;
  ocrConfidence?: number | null;
  unclearSpans?: string[];
  imagePath?: string | null;
  isDemo?: boolean;
  now?: Date;
}

export type IntakeStatus =
  | 'created'
  | 'attached'
  | 'duplicate'
  | 'possible_duplicate'
  | 'unreadable'
  | 'needs_identity'
  | 'rejected';

export interface IntakeResult {
  status: IntakeStatus;
  contactId: string | null;
  reviewId: string | null;
  draftId: string | null;
  message: string;
}

export interface AttentionItem {
  id: string;
  contactId: string | null;
  title: string;
  reason: string;
  nextStep: string;
  isDemo: boolean;
  kind: string;
}

export interface Workspace {
  generatedAt: string;
  outboundPaused: boolean;
  spendLimitUsd: number;
  headline: string;
  detail: string;
  newLeads: AttentionItem[];
  needsReply: AttentionItem[];
  appointmentsToday: AttentionItem[];
  overdueFollowUps: AttentionItem[];
  milestones: AttentionItem[];
  drafts: AttentionItem[];
  failedAutomations: AttentionItem[];
  noNextAction: AttentionItem[];
  replyConnector: AttentionItem;
  systemHealth: AttentionItem[];
  demoCount: number;
}

export interface ContactDetail {
  id: string;
  displayName: string;
  isDemo: boolean;
  lifecycle: string;
  suppressionStatus: string;
  facts: FactField[];
  conflicts: Array<{ id: string; fieldKey: string; existingValue: string; incomingValue: string; resolved: boolean }>;
  activities: Array<{ id: string; kind: string; summary: string; createdAt: string }>;
  notes: Array<{ id: string; body: string; createdAt: string }>;
  drafts: Array<{ id: string; channel: string; recipient: string; body: string; status: string; scheduledFor: string | null; purpose: string }>;
  tasks: Array<{ id: string; kind: string; title: string; detail: string; dueAt: string | null; status: string }>;
  appointments: Array<{ id: string; title: string; startsAt: string; timeRole: string; status: string; location: string }>;
  nextAction: string;
}

interface PackageResult {
  reviewId: string;
  draftId: string;
  conflicts: Array<{ field: string; existing: string; incoming: string }>;
}

export function intakeLead(db: SqlDb, input: IntakeInput): IntakeResult {
  const now = input.now ?? new Date();
  const raw = input.text ?? '';
  const hash = contentHash(raw);
  if (input.idempotencyKey) {
    const existing = db.get(`SELECT * FROM source_events WHERE idempotency_key = ?`, input.idempotencyKey);
    if (existing) {
      if (text(existing, 'content_hash') !== hash) {
        return {
          status: 'rejected',
          contactId: null,
          reviewId: null,
          draftId: null,
          message: 'That idempotency key was already used for different text. Nothing new was saved.',
        };
      }
      return duplicateResult(db, existing);
    }
  }
  if (raw.trim()) {
    const byHash = db.get(`SELECT * FROM source_events WHERE content_hash = ?`, hash);
    if (byHash) return duplicateResult(db, byHash);
  }

  const extraction = extractLead(raw, {
    unclearSpans: input.unclearSpans ?? [],
    ocrConfidence: input.ocrConfidence ?? null,
  });

  if (!raw.trim()) {
    return {
      status: 'needs_identity',
      contactId: null,
      reviewId: null,
      draftId: null,
      message: input.sourceKind === 'screenshot'
        ? 'No text could be read from that image. Nothing was saved as a contact.'
        : 'Paste the lead text first.',
    };
  }
  const confidence = input.ocrConfidence ?? null;
  if (input.sourceKind === 'screenshot' && (confidence === null || confidence < 45)) {
    return saveUnreadable(db, input, raw, hash, extraction, now);
  }
  if (lacksIdentity(extraction)) {
    return saveNeedsIdentity(db, input, raw, hash, extraction, now);
  }

  const phone = phoneLookupKey(extraction.fields.phone.value);
  const email = extraction.fields.email.status === 'known' ? extraction.fields.email.value?.toLowerCase() ?? null : null;
  const phoneContact = findIdentifier(db, 'phone', phone);
  const emailContact = findIdentifier(db, 'email', email);
  if (phoneContact && emailContact && phoneContact !== emailContact) {
    return savePossibleDuplicate(db, input, raw, hash, extraction, now, [phoneContact, emailContact]);
  }
  const strong = phoneContact ?? emailContact;
  if (strong) {
    return transaction(db, () => attachPackage(db, input, raw, hash, extraction, now, strong));
  }

  const name = extraction.fields.name.status === 'known' ? extraction.fields.name.value : null;
  const address = extraction.fields.property_address.status === 'known' ? extraction.fields.property_address.value : null;
  if (name && address && looksLikeStreet(address)) {
    const exact = findNameAndStreet(db, name, address);
    if (exact) return transaction(db, () => attachPackage(db, input, raw, hash, extraction, now, exact));
  }
  if (name) {
    const nameMatches = findNameMatches(db, name);
    if (nameMatches.length > 0) return savePossibleDuplicate(db, input, raw, hash, extraction, now, nameMatches);
  }

  return transaction(db, () => {
    const contactId = createContact(db, extraction, Boolean(input.isDemo), now);
    const sourceId = insertSource(db, input, raw, hash, contactId, null, now);
    rememberIdentifiers(db, contactId, extraction, sourceId);
    applyFacts(db, contactId, extraction, sourceId, now.toISOString());
    const packaged = createPackage(db, contactId, extraction, sourceId, Boolean(input.isDemo), now, []);
    linkSourceReview(db, sourceId, packaged.reviewId, contactId);
    db.run(
      `INSERT INTO activities (id, contact_id, kind, summary, payload_json, created_at) VALUES (?, ?, 'intake', ?, '{}', ?)`,
      randomUUID(),
      contactId,
      'New lead captured. The draft is in review and was not sent.',
      now.toISOString(),
    );
    audit(db, 'contact_created', contactId, 'contact', contactId, { name: extraction.fields.name.value });
    return {
      status: 'created' as const,
      contactId,
      reviewId: packaged.reviewId,
      draftId: packaged.draftId,
      message: 'In your review queue. Nothing was sent.',
    };
  });
}

export function resolveDuplicate(
  db: SqlDb,
  reviewId: string,
  decision: 'separate' | 'attach' | 'dismiss',
  targetContactId?: string | null,
  now = new Date(),
): IntakeResult {
  const review = db.get(`SELECT * FROM review_items WHERE id = ?`, reviewId);
  if (!review || text(review, 'kind') !== 'possible_duplicate' || text(review, 'status') !== 'pending') {
    return { status: 'rejected', contactId: null, reviewId, draftId: null, message: 'That duplicate review is no longer open.' };
  }
  if (decision === 'dismiss') {
    db.run(`UPDATE review_items SET status = 'dismissed', updated_at = ? WHERE id = ?`, now.toISOString(), reviewId);
    return { status: 'rejected', contactId: null, reviewId, draftId: null, message: 'Dismissed. No contact was created.' };
  }
  const payload = JSON.parse(text(review, 'payload_json')) as { candidateIds?: string[]; rawText?: string; sourceKind?: 'paste' | 'screenshot' };
  const raw = payload.rawText ?? '';
  const extraction = extractLead(raw);
  const isDemo = numBool(review.is_demo);
  if (decision === 'separate') {
    return transaction(db, () => {
      const contactId = createContact(db, extraction, isDemo, now);
      rememberIdentifiers(db, contactId, extraction, text(review, 'source_event_id'));
      applyFacts(db, contactId, extraction, text(review, 'source_event_id'), now.toISOString());
      const packaged = createPackage(db, contactId, extraction, text(review, 'source_event_id'), isDemo, now, []);
      db.run(
        `UPDATE source_events SET contact_id = ?, review_id = ? WHERE id = ?`,
        contactId,
        packaged.reviewId,
        text(review, 'source_event_id'),
      );
      db.run(`UPDATE review_items SET status = 'resolved_separate', updated_at = ? WHERE id = ?`, now.toISOString(), reviewId);
      return {
        status: 'created' as const,
        contactId,
        reviewId: packaged.reviewId,
        draftId: packaged.draftId,
        message: 'Saved as a separate contact. The message is still a draft.',
      };
    });
  }
  const candidate = targetContactId ?? payload.candidateIds?.[0] ?? null;
  if (!candidate || !payload.candidateIds?.includes(candidate)) {
    return { status: 'rejected', contactId: null, reviewId, draftId: null, message: 'Choose which existing contact to attach.' };
  }
  return transaction(db, () => {
    const conflicts = applyFacts(db, candidate, extraction, text(review, 'source_event_id'), now.toISOString());
    rememberIdentifiers(db, candidate, extraction, text(review, 'source_event_id'));
    const packaged = createPackage(db, candidate, extraction, text(review, 'source_event_id'), isDemo, now, conflicts);
    db.run(`UPDATE source_events SET contact_id = ? WHERE id = ?`, candidate, text(review, 'source_event_id'));
    db.run(`UPDATE review_items SET status = 'resolved_attach', updated_at = ? WHERE id = ?`, now.toISOString(), reviewId);
    return {
      status: 'attached' as const,
      contactId: candidate,
      reviewId: packaged.reviewId,
      draftId: packaged.draftId,
      message: conflicts.length
        ? 'Attached to the existing contact. Conflicting facts were kept for review and nothing was sent.'
        : 'Attached to the existing contact. Nothing was sent.',
    };
  });
}

export function approveReview(db: SqlDb, reviewId: string, now = new Date()): { ok: boolean; message: string; taskId: string | null; noteId: string | null } {
  const review = db.get(`SELECT * FROM review_items WHERE id = ?`, reviewId);
  if (!review) return { ok: false, message: 'Review item not found.', taskId: null, noteId: null };
  if (text(review, 'kind') !== 'intake') {
    return { ok: false, message: 'Resolve the identity question before approving a note.', taskId: null, noteId: null };
  }
  if (text(review, 'status') !== 'pending') {
    const existingTask = db.get(`SELECT id FROM tasks WHERE contact_id = ? AND kind = 'follow_up' ORDER BY created_at DESC`, text(review, 'contact_id'));
    return {
      ok: true,
      message: 'Already reviewed. No second note or follow up was created.',
      taskId: existingTask ? text(existingTask, 'id') : null,
      noteId: null,
    };
  }
  const contactId = text(review, 'contact_id');
  const payload = JSON.parse(text(review, 'payload_json')) as { crmNote?: string; followUp?: FollowUpPlan; summary?: string };
  const noteId = randomUUID();
  const taskId = randomUUID();
  const dueAt = payload.followUp?.dueAt ?? now.toISOString();
  const action = payload.followUp?.action ?? 'Follow up on the new lead.';
  const dedupe = `followup:${contactId}:${dueAt}:${createHash('sha256').update(action).digest('hex').slice(0, 12)}`;
  transaction(db, () => {
    db.run(`UPDATE review_items SET status = 'approved', updated_at = ? WHERE id = ?`, now.toISOString(), reviewId);
    db.run(`INSERT INTO notes (id, contact_id, body, created_at) VALUES (?, ?, ?, ?)`, noteId, contactId, payload.crmNote ?? '', now.toISOString());
    const prior = db.get(`SELECT id FROM tasks WHERE dedupe_key = ?`, dedupe);
    if (!prior) {
      db.run(
        `INSERT INTO tasks (id, contact_id, kind, title, detail, due_at, status, dedupe_key, is_demo, created_at)
         VALUES (?, ?, 'follow_up', ?, ?, ?, 'open', ?, ?, ?)`,
        taskId,
        contactId,
        'Follow up',
        action,
        dueAt,
        dedupe,
        numBool(review.is_demo) ? 1 : 0,
        now.toISOString(),
      );
    }
    db.run(`UPDATE contacts SET lifecycle = 'active', updated_at = ? WHERE id = ?`, now.toISOString(), contactId);
    audit(db, 'note_saved', contactId, 'review', reviewId, { noteId, taskId });
    db.run(
      `INSERT INTO activities (id, contact_id, kind, summary, payload_json, created_at) VALUES (?, ?, 'review', ?, '{}', ?)`,
      randomUUID(),
      contactId,
      'Review approved. The CRM note was saved locally. The message was not sent.',
      now.toISOString(),
    );
  });
  const stored = db.get(`SELECT id FROM tasks WHERE dedupe_key = ?`, dedupe);
  return {
    ok: true,
    message: 'Note and follow up saved on this client. The message is still a draft and was not sent.',
    taskId: stored ? text(stored, 'id') : taskId,
    noteId,
  };
}

export function dismissReview(db: SqlDb, reviewId: string, now = new Date()): { ok: boolean; message: string } {
  const review = db.get(`SELECT id, status FROM review_items WHERE id = ?`, reviewId);
  if (!review) return { ok: false, message: 'Review item not found.' };
  if (text(review, 'status') !== 'pending') return { ok: true, message: 'Already closed.' };
  db.run(`UPDATE review_items SET status = 'dismissed', updated_at = ? WHERE id = ?`, now.toISOString(), reviewId);
  return { ok: true, message: 'Dismissed. Nothing was sent.' };
}

export function attemptSend(db: SqlDb, draftId: string): { sent: false; reason: string } {
  const draft = db.get(`SELECT * FROM drafts WHERE id = ?`, draftId);
  if (!draft) return { sent: false, reason: 'Draft not found. Nothing was sent.' };
  db.run(`UPDATE drafts SET send_attempts = send_attempts + 1 WHERE id = ?`, draftId);
  const contactId = text(draft, 'contact_id');
  const contact = contactId ? db.get(`SELECT suppression_status FROM contacts WHERE id = ?`, contactId) : undefined;
  let reason = 'No delivery channel is connected. Nothing was sent.';
  if (contact && text(contact, 'suppression_status') === 'opted_out') {
    reason = 'This person is marked opted out. Nothing was sent.';
  } else if (getSettings(db).outboundPaused) {
    reason = 'Outbound automations are paused. Nothing was sent.';
  } else if (!db.get(`SELECT id FROM authorizations WHERE workflow_key = 'client_message'`)) {
    reason = 'No send workflow is authorized. Nothing was sent.';
  }
  recordDeliveryBlock(db, draftId, reason);
  audit(db, 'send_blocked', contactId || null, 'draft', draftId, { reason });
  return { sent: false, reason };
}

export function checkRedfinConnection(db: SqlDb, now = new Date()): { ok: false; jobId: string; message: string } {
  const message = 'Redfin Partner Tools has no connected write API from this desk. Records you paste stay here until you copy them back. Nothing was synced.';
  const existing = db.get(`SELECT * FROM jobs WHERE dedupe_key = 'redfin-partner-tools'`);
  if (existing) return { ok: false, jobId: text(existing, 'id'), message: text(existing, 'detail') || message };
  const jobId = randomUUID();
  db.run(
    `INSERT INTO jobs (id, kind, status, title, detail, attempts, max_attempts, dedupe_key, is_demo, created_at, updated_at)
     VALUES (?, 'integration', 'failed', 'Redfin connection', ?, 1, 3, 'redfin-partner-tools', 0, ?, ?)`,
    jobId,
    message,
    now.toISOString(),
    now.toISOString(),
  );
  return { ok: false, jobId, message };
}

export function acknowledgeJob(db: SqlDb, jobId: string, now = new Date()): { ok: boolean; message: string } {
  const job = db.get(`SELECT id FROM jobs WHERE id = ?`, jobId);
  if (!job) return { ok: false, message: 'Automation alert not found.' };
  db.run(`UPDATE jobs SET status = 'acknowledged', updated_at = ? WHERE id = ?`, now.toISOString(), jobId);
  return { ok: true, message: 'Alert acknowledged. It stays in history.' };
}

export function getSettings(db: SqlDb): { outboundPaused: boolean; spendLimitUsd: number } {
  const paused = db.get(`SELECT value FROM settings WHERE key = 'outbound_paused'`);
  const limit = db.get(`SELECT value FROM settings WHERE key = 'spend_limit_usd'`);
  return {
    outboundPaused: text(paused, 'value') !== 'false',
    spendLimitUsd: Number(text(limit, 'value') || '0'),
  };
}

export function updateSettings(db: SqlDb, patch: { outboundPaused?: boolean; spendLimitUsd?: number }): { outboundPaused: boolean; spendLimitUsd: number } {
  if (typeof patch.outboundPaused === 'boolean') {
    db.run(`UPDATE settings SET value = ? WHERE key = 'outbound_paused'`, patch.outboundPaused ? 'true' : 'false');
  }
  if (typeof patch.spendLimitUsd === 'number' && Number.isFinite(patch.spendLimitUsd) && patch.spendLimitUsd >= 0) {
    db.run(`UPDATE settings SET value = ? WHERE key = 'spend_limit_usd'`, String(patch.spendLimitUsd));
  }
  return getSettings(db);
}

export function getWorkspace(db: SqlDb, now = new Date()): Workspace {
  const settings = getSettings(db);
  const newLeads = db.all(
    `SELECT r.*, c.display_name AS contact_name, c.is_demo AS contact_demo
     FROM review_items r
     LEFT JOIN contacts c ON c.id = r.contact_id
     WHERE r.status = 'pending' AND r.kind IN ('intake', 'needs_identity', 'unreadable_screenshot', 'possible_duplicate')
     ORDER BY r.created_at DESC`,
  ).map((row) => ({
    id: text(row, 'id'),
    contactId: text(row, 'contact_id') || null,
    title: text(row, 'contact_name') || text(row, 'title'),
    reason: reasonForReview(text(row, 'kind'), text(row, 'payload_json')),
    nextStep: nextStepForReview(text(row, 'kind'), text(row, 'payload_json')),
    isDemo: numBool(row.is_demo) || numBool(row.contact_demo),
    kind: text(row, 'kind'),
  }));
  const needsReply = openTasks(db, `kind = 'reply'`).map(taskItem);
  const appointmentsToday = db.all(`SELECT a.*, c.display_name, c.is_demo AS contact_demo FROM appointments a JOIN contacts c ON c.id = a.contact_id WHERE a.status != 'cancelled' ORDER BY a.starts_at ASC`)
    .filter((row) => sameEtDay(new Date(text(row, 'starts_at')), now))
    .map((row) => ({
      id: text(row, 'id'),
      contactId: text(row, 'contact_id'),
      title: text(row, 'display_name') || text(row, 'title'),
      reason: `${roleLabel(text(row, 'time_role'))} at ${formatEt(new Date(text(row, 'starts_at')))}.`,
      nextStep: text(row, 'time_role') === 'confirmed'
        ? 'Prepare for the confirmed showing.'
        : 'This time is not a confirmed showing.',
      isDemo: numBool(row.is_demo) || numBool(row.contact_demo),
      kind: 'appointment',
    }));
  const overdueFollowUps = db.all(
    `SELECT t.*, c.display_name, c.is_demo AS contact_demo FROM tasks t JOIN contacts c ON c.id = t.contact_id
     WHERE t.status = 'open' AND t.kind = 'follow_up' AND t.due_at < ? ORDER BY t.due_at ASC`,
    now.toISOString(),
  ).map((row) => ({
    id: text(row, 'id'),
    contactId: text(row, 'contact_id'),
    title: text(row, 'display_name') || text(row, 'title'),
    reason: `Follow up was due ${formatEt(new Date(text(row, 'due_at')))}.`,
    nextStep: text(row, 'detail') || 'Complete the follow up.',
    isDemo: numBool(row.is_demo) || numBool(row.contact_demo),
    kind: 'follow_up',
  }));
  const horizon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const milestones = db.all(
    `SELECT m.*, c.display_name, c.is_demo AS contact_demo FROM milestones m JOIN contacts c ON c.id = m.contact_id
     WHERE m.status = 'open' AND m.due_at <= ? AND m.due_at >= ? ORDER BY m.due_at ASC`,
    horizon,
    now.toISOString(),
  ).map((row) => ({
    id: text(row, 'id'),
    contactId: text(row, 'contact_id'),
    title: text(row, 'display_name') || text(row, 'title'),
    reason: `${text(row, 'title')} due ${formatEt(new Date(text(row, 'due_at')))}.`,
    nextStep: text(row, 'source_note'),
    isDemo: numBool(row.is_demo) || numBool(row.contact_demo),
    kind: 'milestone',
  }));
  const drafts = db.all(
    `SELECT d.*, c.display_name, c.is_demo AS contact_demo FROM drafts d LEFT JOIN contacts c ON c.id = d.contact_id
     WHERE d.status = 'draft' ORDER BY d.created_at DESC`,
  ).map((row) => ({
    id: text(row, 'id'),
    contactId: text(row, 'contact_id') || null,
    title: text(row, 'display_name') || text(row, 'recipient') || 'Draft',
    reason: `${text(row, 'channel')} draft is waiting. Suggested time ${row.scheduled_for ? formatEt(new Date(text(row, 'scheduled_for'))) : 'is not a scheduled send'}.`,
    nextStep: 'Read the exact message and send it yourself only if you still want it sent.',
    isDemo: numBool(row.is_demo) || numBool(row.contact_demo),
    kind: 'draft',
  }));
  const failedAutomations = db.all(`SELECT * FROM jobs WHERE status = 'failed' ORDER BY updated_at DESC`).map((row) => ({
    id: text(row, 'id'),
    contactId: null,
    title: text(row, 'title'),
    reason: text(row, 'detail'),
    nextStep: 'Use paste or export until this connection exists. Acknowledge the alert after you have seen it.',
    isDemo: numBool(row.is_demo),
    kind: 'failed_job',
  }));
  const demoCount = Number(db.get(`SELECT COUNT(*) AS n FROM contacts WHERE is_demo = 1`)?.n ?? 0);
  const attention = describeAttention({
    appointmentsToday,
    overdueFollowUps,
    newLeads,
    needsReply,
    drafts,
    failedAutomations,
    milestones,
  });
  return {
    generatedAt: now.toISOString(),
    outboundPaused: settings.outboundPaused,
    spendLimitUsd: settings.spendLimitUsd,
    headline: attention.headline,
    detail: attention.detail,
    newLeads,
    needsReply,
    appointmentsToday,
    overdueFollowUps,
    milestones,
    drafts,
    failedAutomations,
    noNextAction: db.all(
      `SELECT * FROM contacts WHERE next_action IS NULL OR trim(next_action) = '' ORDER BY updated_at DESC`,
    ).map((row) => ({
      id: text(row, 'id'),
      contactId: text(row, 'id'),
      title: text(row, 'display_name') || 'Unnamed lead',
      reason: 'This contact has no next action.',
      nextStep: 'Open the inquiry and set one next step.',
      isDemo: numBool(row.is_demo),
      kind: 'no_next_action',
    })),
    replyConnector: {
      id: 'connector-replies',
      contactId: null,
      title: 'Recent replies',
      reason: 'No inbound text or email feed is connected to this desk.',
      nextStep: 'Connector blocked. Paste a reply when one arrives.',
      isDemo: false,
      kind: 'connector_blocked',
    },
    systemHealth: [
      healthItem('redfin', 'Redfin Partner Tools', 'No write API is connected. Paste notes back by hand.'),
      healthItem('mls', 'MLS', 'No MLS or IDX feed is connected. Do not invent listing status.'),
      healthItem('showingtime', 'ShowingTime', 'No ShowingTime API is connected. Requested times stay unconfirmed.'),
      healthItem('quo', 'Quo SMS', 'Live texting is not authorized from this desk.'),
      healthItem('gmail', 'Gmail import', 'Client mail import is not authorized.'),
    ],
    demoCount,
  };
}

export function getContact(db: SqlDb, contactId: string): ContactDetail | null {
  const contact = db.get(`SELECT * FROM contacts WHERE id = ?`, contactId);
  if (!contact) return null;
  const facts = db.all(`SELECT * FROM facts WHERE contact_id = ?`, contactId);
  const byKey = new Map(facts.map((row) => [text(row, 'field_key'), row]));
  const ordered = FIELD_KEYS.map((key) => {
    const row = byKey.get(key);
    const label = extractLead('').fields[key].label;
    if (!row) return { key, label, value: null, status: 'data_needed' as const, basis: 'missing' as const, evidence: null };
    return {
      key,
      label,
      value: text(row, 'value') || null,
      status: text(row, 'status') as FactField['status'],
      basis: displayBasis(row),
      evidence: text(row, 'evidence') || null,
    };
  });
  const conflicts = db.all(`SELECT * FROM conflicts WHERE contact_id = ? ORDER BY created_at DESC`, contactId).map((row) => ({
    id: text(row, 'id'),
    fieldKey: text(row, 'field_key'),
    existingValue: text(row, 'existing_value'),
    incomingValue: text(row, 'incoming_value'),
    resolved: numBool(row.resolved),
  }));
  const activities = db.all(`SELECT * FROM activities WHERE contact_id = ? ORDER BY created_at DESC`, contactId).map((row) => ({
    id: text(row, 'id'),
    kind: text(row, 'kind'),
    summary: text(row, 'summary'),
    createdAt: text(row, 'created_at'),
  }));
  const notes = db.all(`SELECT * FROM notes WHERE contact_id = ? ORDER BY created_at DESC`, contactId).map((row) => ({
    id: text(row, 'id'),
    body: text(row, 'body'),
    createdAt: text(row, 'created_at'),
  }));
  const drafts = db.all(`SELECT * FROM drafts WHERE contact_id = ? ORDER BY created_at DESC`, contactId).map((row) => ({
    id: text(row, 'id'),
    channel: text(row, 'channel'),
    recipient: text(row, 'recipient'),
    body: text(row, 'body'),
    status: text(row, 'status'),
    scheduledFor: text(row, 'scheduled_for') || null,
    purpose: text(row, 'purpose'),
  }));
  const tasks = db.all(`SELECT * FROM tasks WHERE contact_id = ? ORDER BY due_at ASC`, contactId).map((row) => ({
    id: text(row, 'id'),
    kind: text(row, 'kind'),
    title: text(row, 'title'),
    detail: text(row, 'detail'),
    dueAt: text(row, 'due_at') || null,
    status: text(row, 'status'),
  }));
  const appointments = db.all(`SELECT * FROM appointments WHERE contact_id = ? ORDER BY starts_at ASC`, contactId).map((row) => ({
    id: text(row, 'id'),
    title: text(row, 'title'),
    startsAt: text(row, 'starts_at'),
    timeRole: text(row, 'time_role'),
    status: text(row, 'status'),
    location: text(row, 'location'),
  }));
  const openTask = tasks.find((task) => task.status === 'open');
  const pending = db.get(`SELECT payload_json FROM review_items WHERE contact_id = ? AND status = 'pending' AND kind = 'intake' ORDER BY created_at DESC`, contactId);
  let nextAction = 'No open action.';
  if (pending) {
    const payload = JSON.parse(text(pending, 'payload_json')) as { followUp?: FollowUpPlan };
    if (payload.followUp) nextAction = `${payload.followUp.action} Suggested follow up ${payload.followUp.display}.`;
  } else if (openTask) {
    nextAction = openTask.detail || openTask.title;
  }
  return {
    id: text(contact, 'id'),
    displayName: text(contact, 'display_name') || 'Unnamed lead',
    isDemo: numBool(contact.is_demo),
    lifecycle: text(contact, 'lifecycle'),
    suppressionStatus: text(contact, 'suppression_status'),
    facts: ordered,
    conflicts,
    activities,
    notes,
    drafts,
    tasks,
    appointments,
    nextAction,
  };
}

export function getReview(db: SqlDb, reviewId: string): Record<string, unknown> | null {
  const review = db.get(
    `SELECT r.*, c.display_name FROM review_items r LEFT JOIN contacts c ON c.id = r.contact_id WHERE r.id = ?`,
    reviewId,
  );
  if (!review) return null;
  const draft = db.get(`SELECT * FROM drafts WHERE review_item_id = ?`, reviewId);
  return {
    id: text(review, 'id'),
    contactId: text(review, 'contact_id') || null,
    contactName: text(review, 'display_name') || null,
    kind: text(review, 'kind'),
    status: text(review, 'status'),
    title: text(review, 'title'),
    isDemo: numBool(review.is_demo),
    payload: JSON.parse(text(review, 'payload_json') || '{}'),
    draft: draft
      ? {
          id: text(draft, 'id'),
          channel: text(draft, 'channel'),
          recipient: text(draft, 'recipient'),
          body: text(draft, 'body'),
          context: text(draft, 'context'),
          purpose: text(draft, 'purpose'),
          scheduledFor: text(draft, 'scheduled_for') || null,
          status: text(draft, 'status'),
        }
      : null,
  };
}

export function searchContacts(db: SqlDb, query: string): Array<{ id: string; displayName: string; isDemo: boolean; detail: string }> {
  const needle = `%${query.trim().toLowerCase().replace(/[%_]/g, '')}%`;
  if (needle === '%%') return [];
  return db.all(
    `SELECT DISTINCT c.* FROM contacts c
     LEFT JOIN identifiers i ON i.contact_id = c.id
     LEFT JOIN facts f ON f.contact_id = c.id
     WHERE lower(coalesce(c.display_name, '')) LIKE ?
        OR lower(coalesce(i.raw_value, '')) LIKE ?
        OR lower(coalesce(i.value_normalized, '')) LIKE ?
        OR lower(coalesce(f.value, '')) LIKE ?
     ORDER BY c.updated_at DESC
     LIMIT 30`,
    needle,
    needle,
    needle,
    needle,
  ).map((row) => ({
    id: text(row, 'id'),
    displayName: text(row, 'display_name') || 'Unnamed lead',
    isDemo: numBool(row.is_demo),
    detail: text(row, 'lifecycle'),
  }));
}

export function seedDemo(db: SqlDb, now = new Date()): { created: boolean } {
  const flag = db.get(`SELECT value FROM settings WHERE key = 'demo_seeded'`);
  if (flag) return { created: false };
  const nate = `Record type: DEMO
Name: Nate Alvarez
Phone: (305) 555-0148
Email: nate.alvarez.demo@example.com
Source: Redfin
Assigned agent: Kyle Kleinman
Property: North Miami property
Requested showing: 5:30
Budget: $650K
Home use: Primary residence
Financing: pre-approved
Timeline: 30 days
Motivation: lease ends in June
Must haves: garage
Deal breakers: no ground floor`;
  intakeLead(db, { text: nate, sourceKind: 'paste', isDemo: true, now, idempotencyKey: 'demo-nate' });
  const mariaId = insertDemoContact(db, 'Maria Chen', now);
  db.run(
    `INSERT INTO tasks (id, contact_id, kind, title, detail, due_at, status, dedupe_key, is_demo, created_at)
     VALUES (?, ?, 'reply', 'Reply to Maria Chen', 'She asked if Saturday morning is open. Answer before sending more homes.', ?, 'open', 'demo-maria-reply', 1, ?)`,
    randomUUID(),
    mariaId,
    now.toISOString(),
    now.toISOString(),
  );
  const jordanId = insertDemoContact(db, 'Jordan Hale', now);
  const parts = zonedParts(now);
  const showingAt = zonedLocalToUtc(parts.year, parts.month, parts.day, 15, 0);
  db.run(
    `INSERT INTO appointments (id, contact_id, title, starts_at, time_role, status, location, is_demo, created_at, dedupe_key)
     VALUES (?, ?, 'Requested showing', ?, 'requested', 'requested', 'DEMO 18 NE 1st St, Miami', 1, ?, 'demo-jordan-appt')`,
    randomUUID(),
    jordanId,
    showingAt.toISOString(),
    now.toISOString(),
  );
  const samId = insertDemoContact(db, 'Sam Ortiz', now);
  db.run(
    `INSERT INTO tasks (id, contact_id, kind, title, detail, due_at, status, dedupe_key, is_demo, created_at)
     VALUES (?, ?, 'follow_up', 'Follow up with Sam Ortiz', 'Check whether Sam still wants to see condos in Hollywood. Demo record.', ?, 'open', 'demo-sam-followup', 1, ?)`,
    randomUUID(),
    samId,
    new Date(now.getTime() - 26 * 60 * 60 * 1000).toISOString(),
    now.toISOString(),
  );
  db.run(
    `INSERT INTO milestones (id, contact_id, title, due_at, status, source_note, is_demo, created_at, dedupe_key)
     VALUES (?, ?, 'Inspection window reminder', ?, 'open', 'DEMO milestone only. It was not read from a contract.', 1, ?, 'demo-jordan-milestone')`,
    randomUUID(),
    jordanId,
    new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString(),
    now.toISOString(),
  );
  const jobId = randomUUID();
  db.run(
    `INSERT INTO jobs (id, kind, status, title, detail, attempts, max_attempts, dedupe_key, is_demo, created_at, updated_at)
     VALUES (?, 'integration', 'failed', 'Sample failed sync', 'DEMO alert. This stands in for a connection that did not run. No client was contacted.', 3, 3, 'demo-failed-sync', 1, ?, ?)`,
    jobId,
    now.toISOString(),
    now.toISOString(),
  );
  db.run(
    `UPDATE contacts SET next_action = 'Reply before sending more homes.', next_action_due_at = ?, next_action_reason = 'She asked a direct question.', next_action_owner = 'Kyle Kleinman' WHERE id = ?`,
    now.toISOString(),
    mariaId,
  );
  db.run(
    `UPDATE contacts SET next_action = 'Confirm the requested showing. It is not booked.', next_action_due_at = ?, next_action_reason = 'DEMO showing request only.', next_action_owner = 'Kyle Kleinman' WHERE id = ?`,
    showingAt.toISOString(),
    jordanId,
  );
  db.run(
    `UPDATE contacts SET next_action = 'Complete the overdue follow up.', next_action_due_at = ?, next_action_reason = 'DEMO overdue follow up.', next_action_owner = 'Kyle Kleinman' WHERE id = ?`,
    new Date(now.getTime() - 26 * 60 * 60 * 1000).toISOString(),
    samId,
  );
  insertDemoContact(db, 'Pat Nguyen', now);
  db.run(`INSERT INTO settings (key, value) VALUES ('demo_seeded', 'true')`);
  return { created: true };
}

export function clearDemo(db: SqlDb): { removed: number } {
  const count = Number(db.get(`SELECT COUNT(*) AS n FROM contacts WHERE is_demo = 1`)?.n ?? 0);
  transaction(db, () => {
    db.run(`DELETE FROM contacts WHERE is_demo = 1`);
    db.run(`DELETE FROM jobs WHERE is_demo = 1`);
    db.run(`DELETE FROM source_events WHERE is_demo = 1`);
    db.run(`DELETE FROM review_items WHERE is_demo = 1`);
    db.run(`DELETE FROM drafts WHERE is_demo = 1`);
    db.run(`DELETE FROM settings WHERE key = 'demo_seeded'`);
  });
  return { removed: count };
}

export function exportRecords(db: SqlDb): Record<string, unknown> {
  return {
    exportedAt: new Date().toISOString(),
    systemOfRecord: 'Redfin Partner Tools remains the system of record. This file is a local working copy.',
    contacts: db.all(`SELECT * FROM contacts ORDER BY created_at ASC`),
    facts: db.all(`SELECT * FROM facts`),
    conflicts: db.all(`SELECT * FROM conflicts`),
    notes: db.all(`SELECT * FROM notes`),
    tasks: db.all(`SELECT * FROM tasks`),
    drafts: db.all(`SELECT * FROM drafts`),
    appointments: db.all(`SELECT * FROM appointments`),
    activities: db.all(`SELECT * FROM activities`),
    jobs: db.all(`SELECT * FROM jobs`),
  };
}

export function backupDatabase(sourcePath: string, destPath: string): void {
  const db = openDatabase(sourcePath);
  const safe = destPath.replaceAll("'", "''");
  db.exec(`VACUUM INTO '${safe}'`);
  db.close();
}

function attachPackage(db: SqlDb, input: IntakeInput, raw: string, hash: string, extraction: Extraction, now: Date, contactId: string): IntakeResult {
  const sourceId = insertSource(db, input, raw, hash, contactId, null, now);
  const conflicts = applyFacts(db, contactId, extraction, sourceId, now.toISOString());
  rememberIdentifiers(db, contactId, extraction, sourceId);
  maybeRename(db, contactId, extraction, now);
  const packaged = createPackage(db, contactId, extraction, sourceId, Boolean(input.isDemo), now, conflicts);
  linkSourceReview(db, sourceId, packaged.reviewId, contactId);
  db.run(
    `INSERT INTO activities (id, contact_id, kind, summary, payload_json, created_at) VALUES (?, ?, 'intake', ?, '{}', ?)`,
    randomUUID(),
    contactId,
    conflicts.length ? 'Existing contact updated. Conflicting facts were kept beside the original values. Nothing was sent.' : 'Existing contact updated from a repeated lead. Nothing was sent.',
    now.toISOString(),
  );
  audit(db, 'contact_matched', contactId, 'contact', contactId, { conflicts });
  return {
    status: 'attached',
    contactId,
    reviewId: packaged.reviewId,
    draftId: packaged.draftId,
    message: conflicts.length
      ? 'Matched an existing contact. Conflicting details are in the review queue. Nothing was sent.'
      : 'Matched an existing contact. No duplicate contact was created. Nothing was sent.',
  };
}

function createPackage(
  db: SqlDb,
  contactId: string,
  extraction: Extraction,
  sourceEventId: string,
  isDemo: boolean,
  now: Date,
  conflicts: Array<{ field: string; existing: string; incoming: string }>,
): PackageResult {
  const draft = draftClientMessage(extraction);
  const suppressed = text(db.get(`SELECT suppression_status FROM contacts WHERE id = ?`, contactId), 'suppression_status') === 'opted_out';
  const followUp = suppressed
    ? {
        action: 'Do not contact. This person is opted out.',
        dueAt: planFollowUp(extraction, now).dueAt,
        display: planFollowUp(extraction, now).display,
        reason: 'Suppression is opted out.',
      }
    : planFollowUp(extraction, now);
  const summary = buyerSummary(extraction);
  const conflictLines = conflicts.map((item) => `${item.field}: kept "${item.existing}". Incoming "${item.incoming}" was not overwritten.`);
  const note = `${crmNote(extraction, followUp, draft, contactId)}${conflictLines.length ? `\n\nConflicts kept\n${conflictLines.join('\n')}` : ''}`;
  const internal = internalNote(extraction, draft);
  const reviewId = randomUUID();
  const contact = db.get(`SELECT display_name FROM contacts WHERE id = ?`, contactId);
  const recipient = extraction.fields.phone.status === 'known'
    ? extraction.fields.phone.value
    : extraction.fields.email.status === 'known'
      ? extraction.fields.email.value
      : text(contact, 'display_name');
  const payload = {
    summary,
    internalNote: internal,
    crmNote: note,
    draftBody: draft.body,
    purpose: draft.purpose,
    channel: draft.channel,
    recipient,
    followUp,
    warnings: extraction.warnings,
    unclearSpans: extraction.unclearSpans,
    stage: extraction.stage,
    fields: FIELD_KEYS.map((key) => extraction.fields[key]),
    conflicts,
    scheduledSend: false,
    suppressed,
  };
  db.run(
    `UPDATE contacts SET next_action = ?, next_action_due_at = ?, next_action_reason = ?, next_action_owner = 'Kyle Kleinman', updated_at = ? WHERE id = ?`,
    followUp.action,
    followUp.dueAt,
    followUp.reason,
    now.toISOString(),
    contactId,
  );
  db.run(
    `INSERT INTO review_items (id, contact_id, source_event_id, kind, status, title, payload_json, is_demo, created_at, updated_at)
     VALUES (?, ?, ?, 'intake', 'pending', ?, ?, ?, ?, ?)`,
    reviewId,
    contactId,
    sourceEventId,
    `Review ${text(contact, 'display_name') || 'lead'}`,
    JSON.stringify(payload),
    isDemo ? 1 : 0,
    now.toISOString(),
    now.toISOString(),
  );
  const draftId = randomUUID();
  const dedupe = `draft:${contactId}:${createHash('sha256').update(draft.body).digest('hex')}`;
  const existingDraft = db.get(`SELECT id FROM drafts WHERE dedupe_key = ?`, dedupe);
  const draftStatus = suppressed ? 'blocked' : 'draft';
  if (suppressed) {
    db.run(`UPDATE drafts SET status = 'blocked' WHERE contact_id = ? AND status = 'draft'`, contactId);
  }
  if (!existingDraft) {
    db.run(
      `INSERT INTO drafts (id, contact_id, review_item_id, channel, recipient, body, context, purpose, scheduled_for, status, dedupe_key, is_demo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      draftId,
      contactId,
      reviewId,
      draft.channel,
      recipient,
      draft.body,
      summary,
      draft.purpose,
      followUp.dueAt,
      draftStatus,
      dedupe,
      isDemo ? 1 : 0,
      now.toISOString(),
    );
  } else if (suppressed) {
    db.run(`UPDATE drafts SET status = 'blocked', review_item_id = ? WHERE id = ?`, reviewId, text(existingDraft, 'id'));
  }
  maybeRequestedAppointment(db, contactId, extraction, isDemo, now);
  const storedDraftId = existingDraft ? text(existingDraft, 'id') : draftId;
  audit(db, 'draft_proposed', contactId, 'draft', storedDraftId, { status: suppressed ? 'blocked' : 'draft', body: draft.body });
  return { reviewId, draftId: storedDraftId, conflicts };
}

function savePossibleDuplicate(db: SqlDb, input: IntakeInput, raw: string, hash: string, extraction: Extraction, now: Date, candidateIds: string[]): IntakeResult {
  const reviewId = randomUUID();
  const sourceId = insertSource(db, input, raw, hash, null, reviewId, now);
  const candidates = candidateIds.map((id) => {
    const row = db.get(`SELECT display_name FROM contacts WHERE id = ?`, id);
    return { id, name: text(row, 'display_name') || 'Unnamed lead' };
  });
  const payload = {
    summary: buyerSummary(extraction),
    internalNote: 'Possible duplicate. Nothing was merged and no second contact was created.',
    warnings: extraction.warnings,
    fields: FIELD_KEYS.map((key) => extraction.fields[key]),
    candidateIds,
    candidates,
    rawText: raw,
    sourceKind: input.sourceKind,
    reason: 'The name matches an existing contact, without a matching phone or email. Review it before anything is merged.',
  };
  db.run(
    `INSERT INTO review_items (id, contact_id, source_event_id, kind, status, title, payload_json, is_demo, created_at, updated_at)
     VALUES (?, NULL, ?, 'possible_duplicate', 'pending', 'Possible duplicate', ?, ?, ?, ?)`,
    reviewId,
    sourceId,
    JSON.stringify(payload),
    input.isDemo ? 1 : 0,
    now.toISOString(),
    now.toISOString(),
  );
  return {
    status: 'possible_duplicate',
    contactId: null,
    reviewId,
    draftId: null,
    message: `Possible duplicate of ${candidates.map((candidate) => candidate.name).join(', ')}. Nothing was merged.`,
  };
}

function saveUnreadable(db: SqlDb, input: IntakeInput, raw: string, hash: string, extraction: Extraction, now: Date): IntakeResult {
  const reviewId = randomUUID();
  const sourceId = insertSource(db, input, raw, hash || contentHash(`empty-${randomUUID()}`), null, reviewId, now);
  const payload = {
    summary: 'The screenshot could not be read well enough to create a contact.',
    internalNote: 'Unclear screenshot. No contact was created and nothing was sent.',
    rawText: raw,
    warnings: extraction.warnings,
    unclearSpans: extraction.unclearSpans,
    ocrConfidence: input.ocrConfidence ?? null,
  };
  db.run(
    `INSERT INTO review_items (id, contact_id, source_event_id, kind, status, title, payload_json, is_demo, created_at, updated_at)
     VALUES (?, NULL, ?, 'unreadable_screenshot', 'pending', 'Screenshot needs a clearer copy', ?, ?, ?, ?)`,
    reviewId,
    sourceId,
    JSON.stringify(payload),
    input.isDemo ? 1 : 0,
    now.toISOString(),
    now.toISOString(),
  );
  return {
    status: 'unreadable',
    contactId: null,
    reviewId,
    draftId: null,
    message: 'Screenshot text is unclear. No contact was created. Paste the text or upload a clearer image.',
  };
}

function saveNeedsIdentity(db: SqlDb, input: IntakeInput, raw: string, hash: string, extraction: Extraction, now: Date): IntakeResult {
  const reviewId = randomUUID();
  const sourceId = insertSource(db, input, raw, hash, null, reviewId, now);
  db.run(
    `INSERT INTO review_items (id, contact_id, source_event_id, kind, status, title, payload_json, is_demo, created_at, updated_at)
     VALUES (?, NULL, ?, 'needs_identity', 'pending', 'Lead needs a name or contact method', ?, ?, ?, ?)`,
    reviewId,
    sourceId,
    JSON.stringify({
      summary: buyerSummary(extraction),
      warnings: extraction.warnings,
      fields: FIELD_KEYS.map((key) => extraction.fields[key]),
      rawText: raw,
    }),
    input.isDemo ? 1 : 0,
    now.toISOString(),
    now.toISOString(),
  );
  return {
    status: 'needs_identity',
    contactId: null,
    reviewId,
    draftId: null,
    message: 'No name, phone, or email was found. Nothing was saved as a contact.',
  };
}

function createContact(db: SqlDb, extraction: Extraction, isDemo: boolean, now: Date): string {
  const id = randomUUID();
  const name = extraction.fields.name.status === 'known' ? extraction.fields.name.value : 'Unnamed lead';
  db.run(
    `INSERT INTO contacts (id, display_name, is_demo, lifecycle, suppression_status, created_at, updated_at)
     VALUES (?, ?, ?, 'new', 'unknown', ?, ?)`,
    id,
    name,
    isDemo ? 1 : 0,
    now.toISOString(),
    now.toISOString(),
  );
  return id;
}

function rememberIdentifiers(db: SqlDb, contactId: string, extraction: Extraction, sourceEventId: string | null): void {
  const name = extraction.fields.name.status === 'known' ? extraction.fields.name.value : null;
  if (name) insertIdentifier(db, contactId, 'name', normalizeName(name), name, sourceEventId);
  const phone = phoneLookupKey(extraction.fields.phone.value);
  if (phone && extraction.fields.phone.status === 'known' && extraction.fields.phone.value) {
    insertIdentifier(db, contactId, 'phone', phone, extraction.fields.phone.value, sourceEventId);
  }
  const email = extraction.fields.email.status === 'known' ? extraction.fields.email.value?.toLowerCase() : null;
  if (email) insertIdentifier(db, contactId, 'email', email, email, sourceEventId);
}

function insertIdentifier(db: SqlDb, contactId: string, kind: string, normalized: string, raw: string, sourceEventId: string | null): void {
  if (kind === 'name') {
    const own = db.get(
      `SELECT id FROM identifiers WHERE contact_id = ? AND kind = 'name' AND value_normalized = ?`,
      contactId,
      normalized,
    );
    if (own) return;
  } else {
    const existing = db.get(`SELECT contact_id FROM identifiers WHERE kind = ? AND value_normalized = ?`, kind, normalized);
    if (existing) return;
  }
  db.run(
    `INSERT INTO identifiers (id, contact_id, kind, value_normalized, raw_value, source_event_id) VALUES (?, ?, ?, ?, ?, ?)`,
    randomUUID(),
    contactId,
    kind,
    normalized,
    raw,
    sourceEventId,
  );
}

function applyFacts(db: SqlDb, contactId: string, extraction: Extraction, sourceEventId: string, nowIso: string): Array<{ field: string; existing: string; incoming: string }> {
  const conflicts: Array<{ field: string; existing: string; incoming: string }> = [];
  for (const key of FIELD_KEYS) {
    const field = extraction.fields[key];
    const existing = db.get(`SELECT * FROM facts WHERE contact_id = ? AND field_key = ?`, contactId, key);
    if (!existing) {
      db.run(
        `INSERT INTO facts (id, contact_id, field_key, value, status, evidence, source_event_id, updated_at, basis, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        randomUUID(),
        contactId,
        key,
        field.value,
        field.status,
        field.evidence,
        sourceEventId,
        nowIso,
        field.basis,
        field.status === 'known' ? nowIso : null,
      );
      continue;
    }
    if (field.status !== 'known' || !field.value) continue;
    const existingValue = text(existing, 'value');
    if (text(existing, 'status') === 'known' && existingValue && existingValue !== field.value) {
      db.run(
        `INSERT INTO conflicts (id, contact_id, field_key, existing_value, incoming_value, source_event_id, created_at, resolved) VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
        randomUUID(),
        contactId,
        key,
        existingValue,
        field.value,
        sourceEventId,
        nowIso,
      );
      conflicts.push({ field: field.label, existing: existingValue, incoming: field.value });
      continue;
    }
    db.run(
      `UPDATE facts SET value = ?, status = 'known', evidence = ?, source_event_id = ?, updated_at = ?, basis = ?, observed_at = ? WHERE contact_id = ? AND field_key = ?`,
      field.value,
      field.evidence,
      sourceEventId,
      nowIso,
      field.basis,
      nowIso,
      contactId,
      key,
    );
  }
  return conflicts;
}

function maybeRename(db: SqlDb, contactId: string, extraction: Extraction, now: Date): void {
  const current = db.get(`SELECT display_name FROM contacts WHERE id = ?`, contactId);
  if (text(current, 'display_name') === 'Unnamed lead' && extraction.fields.name.status === 'known' && extraction.fields.name.value) {
    db.run(`UPDATE contacts SET display_name = ?, updated_at = ? WHERE id = ?`, extraction.fields.name.value, now.toISOString(), contactId);
  }
}

function maybeRequestedAppointment(db: SqlDb, contactId: string, extraction: Extraction, isDemo: boolean, now: Date): void {
  const raw = extraction.fields.showing_requested.status === 'known' ? extraction.fields.showing_requested.value : null;
  if (!raw || !/today|tomorrow/i.test(raw)) return;
  const match = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!match) return;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const mer = match[3].toLowerCase();
  if (mer === 'pm' && hour < 12) hour += 12;
  if (mer === 'am' && hour === 12) hour = 0;
  const base = /tomorrow/i.test(raw) ? new Date(now.getTime() + 24 * 60 * 60 * 1000) : now;
  const parts = zonedParts(base);
  const starts = zonedLocalToUtc(parts.year, parts.month, parts.day, hour, minute);
  const dedupe = `appt:${contactId}:requested:${raw.toLowerCase()}`;
  if (db.get(`SELECT id FROM appointments WHERE dedupe_key = ?`, dedupe)) return;
  db.run(
    `INSERT INTO appointments (id, contact_id, title, starts_at, time_role, status, location, is_demo, created_at, dedupe_key)
     VALUES (?, ?, 'Requested showing', ?, 'requested', 'requested', ?, ?, ?, ?)`,
    randomUUID(),
    contactId,
    starts.toISOString(),
    extraction.fields.property_address.value,
    isDemo ? 1 : 0,
    now.toISOString(),
    dedupe,
  );
}

function insertSource(db: SqlDb, input: IntakeInput, raw: string, hash: string, contactId: string | null, reviewId: string | null, now: Date): string {
  const id = randomUUID();
  db.run(
    `INSERT INTO source_events (id, idempotency_key, content_hash, contact_id, review_id, source_kind, raw_text, image_path, ocr_confidence, created_at, is_demo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.idempotencyKey ?? null,
    hash,
    contactId,
    reviewId,
    input.sourceKind,
    raw,
    input.imagePath ?? null,
    input.ocrConfidence ?? null,
    now.toISOString(),
    input.isDemo ? 1 : 0,
  );
  return id;
}

function linkSourceReview(db: SqlDb, sourceId: string, reviewId: string, contactId: string): void {
  db.run(`UPDATE source_events SET review_id = ?, contact_id = ? WHERE id = ?`, reviewId, contactId, sourceId);
}

function duplicateResult(db: SqlDb, event: Record<string, unknown>): IntakeResult {
  const reviewId = text(event, 'review_id') || null;
  const draft = reviewId ? db.get(`SELECT id FROM drafts WHERE review_item_id = ?`, reviewId) : undefined;
  return {
    status: 'duplicate',
    contactId: text(event, 'contact_id') || null,
    reviewId,
    draftId: draft ? text(draft, 'id') : null,
    message: 'Already in the desk. No second contact, draft, or task was created.',
  };
}

function findIdentifier(db: SqlDb, kind: string, normalized: string | null): string | null {
  if (!normalized) return null;
  const row = db.get(`SELECT contact_id FROM identifiers WHERE kind = ? AND value_normalized = ?`, kind, normalized);
  return row ? text(row, 'contact_id') : null;
}

function findNameMatches(db: SqlDb, name: string): string[] {
  return db.all(`SELECT contact_id FROM identifiers WHERE kind = 'name' AND value_normalized = ?`, normalizeName(name)).map((row) => text(row, 'contact_id'));
}

function findNameAndStreet(db: SqlDb, name: string, address: string): string | null {
  const target = normalizeAddress(address);
  for (const contactId of findNameMatches(db, name)) {
    const fact = db.get(`SELECT value, status FROM facts WHERE contact_id = ? AND field_key = 'property_address'`, contactId);
    if (fact && text(fact, 'status') === 'known' && normalizeAddress(text(fact, 'value')) === target) return contactId;
  }
  return null;
}

function insertDemoContact(db: SqlDb, name: string, now: Date): string {
  const id = randomUUID();
  db.run(
    `INSERT INTO contacts (id, display_name, is_demo, lifecycle, suppression_status, created_at, updated_at) VALUES (?, ?, 1, 'active', 'unknown', ?, ?)`,
    id,
    name,
    now.toISOString(),
    now.toISOString(),
  );
  db.run(
    `INSERT INTO identifiers (id, contact_id, kind, value_normalized, raw_value, source_event_id) VALUES (?, ?, 'name', ?, ?, NULL)`,
    randomUUID(),
    id,
    normalizeName(name),
    name,
  );
  return id;
}

function openTasks(db: SqlDb, where: string): Array<Record<string, unknown>> {
  return db.all(
    `SELECT t.*, c.display_name, c.is_demo AS contact_demo FROM tasks t JOIN contacts c ON c.id = t.contact_id WHERE t.status = 'open' AND ${where} ORDER BY t.due_at ASC`,
  );
}

function taskItem(row: Record<string, unknown>): AttentionItem {
  return {
    id: text(row, 'id'),
    contactId: text(row, 'contact_id'),
    title: text(row, 'display_name') || text(row, 'title'),
    reason: text(row, 'detail') || text(row, 'title'),
    nextStep: 'Open the client and answer the open question.',
    isDemo: numBool(row.is_demo) || numBool(row.contact_demo),
    kind: text(row, 'kind'),
  };
}

function reasonForReview(kind: string, payloadJson: string): string {
  const payload = JSON.parse(payloadJson || '{}') as { summary?: string; reason?: string; internalNote?: string };
  if (kind === 'possible_duplicate') return payload.reason ?? 'Possible duplicate needs a decision.';
  if (kind === 'unreadable_screenshot') return 'Screenshot text is unclear.';
  if (kind === 'needs_identity') return 'A name, phone, or email is still missing.';
  return payload.internalNote || payload.summary || 'New lead is waiting for review.';
}

function nextStepForReview(kind: string, payloadJson: string): string {
  const payload = JSON.parse(payloadJson || '{}') as { followUp?: FollowUpPlan };
  if (kind === 'possible_duplicate') return 'Attach it to the existing person or keep it separate. Do not merge it blindly.';
  if (kind === 'unreadable_screenshot') return 'Paste the text from the screenshot.';
  if (kind === 'needs_identity') return 'Add a name, phone, or email and submit it again.';
  return payload.followUp?.action ?? 'Review the draft.';
}

function describeAttention(input: {
  appointmentsToday: AttentionItem[];
  overdueFollowUps: AttentionItem[];
  newLeads: AttentionItem[];
  needsReply: AttentionItem[];
  drafts: AttentionItem[];
  failedAutomations: AttentionItem[];
  milestones: AttentionItem[];
}): { headline: string; detail: string } {
  const first = input.appointmentsToday[0]
    ?? input.overdueFollowUps[0]
    ?? input.newLeads[0]
    ?? input.needsReply[0]
    ?? input.drafts[0]
    ?? input.milestones[0]
    ?? input.failedAutomations[0];
  if (!first) {
    return {
      headline: 'Nothing needs you right now.',
      detail: 'Paste a new lead or a screenshot and it will land in the review queue.',
    };
  }
  const failure = input.failedAutomations[0] ? ` ${input.failedAutomations.length} automation alert${input.failedAutomations.length === 1 ? '' : 's'} also need a look.` : '';
  return {
    headline: `${first.title} needs attention.`,
    detail: `${first.reason} Next: ${first.nextStep}${failure}`,
  };
}

function contentHash(value: string): string {
  const normalized = value.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return createHash('sha256').update(normalized).digest('hex');
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeAddress(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function looksLikeStreet(value: string): boolean {
  return /\d/.test(value) && /\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ct|court|ln|lane|way|pl|place|ter|terrace)\b/i.test(value);
}

function roleLabel(role: string): string {
  if (role === 'confirmed') return 'Confirmed showing';
  if (role === 'available') return 'Client available';
  return 'Requested showing, not confirmed';
}

function numBool(value: unknown): boolean {
  return value === 1 || value === true || value === '1';
}

export function setSuppression(db: SqlDb, contactId: string, status: 'unknown' | 'ok_to_contact' | 'opted_out', now = new Date()): void {
  const before = db.get(`SELECT suppression_status FROM contacts WHERE id = ?`, contactId);
  db.run(`UPDATE contacts SET suppression_status = ?, updated_at = ? WHERE id = ?`, status, now.toISOString(), contactId);
  audit(db, 'suppression_changed', contactId, 'contact', contactId, { status }, { status: before ? text(before, 'suppression_status') : null });
}

function recordDeliveryBlock(db: SqlDb, draftId: string, reason: string): void {
  const existing = db.get(`SELECT id FROM jobs WHERE dedupe_key = 'delivery-blocked'`);
  const now = new Date().toISOString();
  if (existing) {
    db.run(`UPDATE jobs SET status = 'failed', detail = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?`, reason, now, text(existing, 'id'));
    return;
  }
  db.run(
    `INSERT INTO jobs (id, kind, status, title, detail, attempts, max_attempts, dedupe_key, is_demo, created_at, updated_at)
     VALUES (?, 'delivery', 'failed', 'Delivery blocked', ?, 1, 3, 'delivery-blocked', 0, ?, ?)`,
    randomUUID(),
    `${reason} Draft ${draftId} was not sent.`,
    now,
    now,
  );
}

function audit(db: SqlDb, action: string, contactId: string | null, entityType: string, entityId: string | null, after: unknown, before?: unknown): void {
  db.run(
    `INSERT INTO audit_log (id, at, actor, action, contact_id, entity_type, entity_id, before_json, after_json)
     VALUES (?, ?, 'Kyle Kleinman', ?, ?, ?, ?, ?, ?)`,
    randomUUID(),
    new Date().toISOString(),
    action,
    contactId,
    entityType,
    entityId,
    before === undefined ? null : JSON.stringify(before),
    JSON.stringify(after),
  );
}

function displayBasis(row: Record<string, unknown>, now = new Date()): FactBasis {
  const status = text(row, 'status');
  if (status !== 'known') return 'missing';
  const basis = text(row, 'basis') || 'said';
  const observed = text(row, 'observed_at') || text(row, 'updated_at');
  if ((basis === 'said' || basis === 'inferred') && observed) {
    const age = now.getTime() - new Date(observed).getTime();
    if (age > 14 * 24 * 60 * 60 * 1000) return 'stale';
  }
  if (basis === 'said' || basis === 'confirmed' || basis === 'inferred' || basis === 'missing' || basis === 'stale') return basis;
  return 'said';
}

function healthItem(id: string, title: string, reason: string): AttentionItem {
  return {
    id,
    contactId: null,
    title,
    reason,
    nextStep: 'Use paste and copy until this connection is authorized.',
    isDemo: false,
    kind: 'system_health',
  };
}
