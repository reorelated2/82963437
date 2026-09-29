import { readFileSync } from 'node:fs';
import {
  claimWorkflowLock,
  findClientsByIdentifier,
  flagCanonicalIdentity,
  ingestCanonicalLead,
  linkCanonicalIdentifier,
  openCanonicalShell,
  recordCanonicalEvent,
  releaseWorkflowLock,
  type FactInput,
} from '../canonical.ts';
import { nextBestAction, openBuyerFile } from '../conversion/engine.ts';
import { publishExecution } from '../execution/publish.ts';
import { recordLeadSource } from '../execution/source.ts';
import { FINANCING_STATES, PRIMARY_STAGES, SEARCH_STATES, type FinancingState, type SearchState } from '../conversion/policy.ts';
import { sendFlags } from '../mode.ts';
import { text, type SqlDb } from '../sql.ts';

/** Files larger than this are refused unless the caller names one record. */
export const AGENT_TOOLS_BATCH_LIMIT = 8;

const SOURCE = 'redfin_agent_tools';
const ACTOR = 'agent-tools-loader';

export interface AgentToolsDataset {
  dataset: 'redfin_agent_tools_leads';
  mode: 'DRY_RUN';
  exported_at: string;
  source_system: 'redfin_agent_tools';
  /** Synthetic fixtures are demo rows. A real one-lead run omits this flag. */
  synthetic?: boolean;
  records: AgentToolsRecord[];
}

export interface AgentToolsRecord {
  record_id: string;
  disposition: 'lead' | 'needs_review';
  source: {
    system: 'redfin_agent_tools';
    source_id: string;
    exported_at: string;
  };
  person: {
    display_name?: string | null;
    phones?: Array<{ value: string; verification: 'verified' | 'inferred' }>;
    emails?: Array<{ value: string; verification: 'verified' | 'inferred' }>;
    household_id?: string | null;
  };
  facts?: Array<{
    field: string;
    value: string;
    kind: 'fact' | 'inference';
    verification: 'verified' | 'unverified';
    evidence?: string;
  }>;
  dedup_candidates?: Array<{ source_id?: string; display_name?: string; reason: string }>;
}

export interface AgentToolsRecordResult {
  recordId: string;
  sourceId: string;
  outcome: 'created' | 'attached' | 'pending_enrichment' | 'needs_review' | 'duplicate' | 'rejected';
  clientId: string | null;
  opportunityId: string | null;
  eventId: string | null;
  flaggedClientIds: string[];
  crmNote: string | null;
  followUpTrigger: string | null;
  liveSend: false;
  message: string;
}

export interface AgentToolsLoadResult {
  applied: boolean;
  liveSend: false;
  systemMode: 'DRY_RUN' | 'LIVE';
  recordCount: number;
  results: AgentToolsRecordResult[];
  message: string;
}

export function readAgentToolsDataset(filePath: string): AgentToolsDataset {
  const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
  return parseAgentToolsDataset(parsed);
}

export function parseAgentToolsDataset(value: unknown): AgentToolsDataset {
  if (!value || typeof value !== 'object') throw new Error('Agent Tools dataset must be an object.');
  const body = value as Record<string, unknown>;
  if (body.dataset !== 'redfin_agent_tools_leads') {
    throw new Error('dataset must be redfin_agent_tools_leads.');
  }
  if (body.mode !== 'DRY_RUN') throw new Error('mode must be DRY_RUN. Nothing was loaded.');
  if (body.source_system !== SOURCE) throw new Error('source_system must be redfin_agent_tools.');
  if (typeof body.exported_at !== 'string' || !body.exported_at.trim()) {
    throw new Error('exported_at is required.');
  }
  if (!Array.isArray(body.records)) throw new Error('records must be an array.');
  return {
    dataset: 'redfin_agent_tools_leads',
    mode: 'DRY_RUN',
    exported_at: body.exported_at,
    source_system: SOURCE,
    synthetic: body.synthetic === true,
    records: body.records.map(parseRecord),
  };
}

export function loadAgentToolsDataset(db: SqlDb, dataset: AgentToolsDataset, options?: {
  apply?: boolean;
  onlyRecordId?: string;
  now?: Date;
}): AgentToolsLoadResult {
  const flags = sendFlags();
  const selected = options?.onlyRecordId
    ? dataset.records.filter((record) => record.record_id === options.onlyRecordId)
    : dataset.records;
  if (options?.onlyRecordId && selected.length === 0) {
    return {
      applied: false,
      liveSend: false,
      systemMode: flags.systemMode,
      recordCount: dataset.records.length,
      results: [],
      message: `Record ${options.onlyRecordId} is not in this file. Nothing was written.`,
    };
  }
  if (!options?.onlyRecordId && dataset.records.length > AGENT_TOOLS_BATCH_LIMIT) {
    return {
      applied: false,
      liveSend: false,
      systemMode: flags.systemMode,
      recordCount: dataset.records.length,
      results: [],
      message: `Refusing a bulk import of ${dataset.records.length} records. Pass onlyRecordId for one lead. Nothing was written.`,
    };
  }
  if (!options?.apply) {
    return {
      applied: false,
      liveSend: false,
      systemMode: flags.systemMode,
      recordCount: selected.length,
      results: [],
      message: 'Dry-run preview only. Pass apply: true to write the selected records. Nothing was sent.',
    };
  }
  const now = options.now ?? new Date();
  const results = selected.map((record) => applyRecord(db, dataset, record, now));
  return {
    applied: true,
    liveSend: false,
    systemMode: flags.systemMode,
    recordCount: selected.length,
    results,
    message: 'Selected Agent Tools records were stored locally. Nothing was sent and Agent Tools was not written.',
  };
}

function applyRecord(db: SqlDb, dataset: AgentToolsDataset, record: AgentToolsRecord, now: Date): AgentToolsRecordResult {
  const key = `agent-tools:${record.record_id}`;
  const prior = db.get(`SELECT * FROM events WHERE idempotency_key = ?`, key);
  if (prior) {
    return {
      recordId: record.record_id,
      sourceId: record.source.source_id,
      outcome: 'duplicate',
      clientId: text(prior, 'client_id') || null,
      opportunityId: text(prior, 'opportunity_id') || null,
      eventId: text(prior, 'id'),
      flaggedClientIds: [],
      crmNote: null,
      followUpTrigger: null,
      liveSend: false,
      message: 'That Agent Tools record was already stored.',
    };
  }

  const verifiedPhone = firstVerified(record.person.phones);
  const verifiedEmail = firstVerified(record.person.emails);
  const facts = recordFacts(record);
  const provenance = JSON.stringify({
    system: SOURCE,
    source_id: record.source.source_id,
    record_id: record.record_id,
    exported_at: record.source.exported_at,
    dataset_exported_at: dataset.exported_at,
    disposition: record.disposition,
  });
  const phoneClient = verifiedPhone ? findClientsByIdentifier(db, 'phone', verifiedPhone)[0] ?? null : null;
  const emailClient = verifiedEmail ? findClientsByIdentifier(db, 'email', verifiedEmail)[0] ?? null : null;
  const sourceClients = findClientsByIdentifier(db, 'agent_tools_id', record.source.source_id);
  const householdClients = record.person.household_id
    ? findClientsByIdentifier(db, 'household', record.person.household_id)
    : [];
  const strong = uniqueIds([phoneClient, emailClient, sourceClients[0] ?? null]);
  const ambiguous = (phoneClient && emailClient && phoneClient !== emailClient)
    || sourceClients.length > 1
    || (sourceClients[0] && phoneClient && sourceClients[0] !== phoneClient)
    || (sourceClients[0] && emailClient && sourceClients[0] !== emailClient);

  if (ambiguous) {
    const held = holdRecord(db, dataset, record, 'needs_review', facts, provenance, now);
    flagGroups(db, held.clientId, [phoneClient, emailClient, ...sourceClients, ...householdClients], record, now, 'Verified identifiers point at different clients.');
    return finishHeld(db, dataset, record, held, 'needs_review', now);
  }

  if (!verifiedPhone && !verifiedEmail && sourceClients.length === 0) {
    const status = record.disposition === 'needs_review' ? 'needs_review' : 'pending_enrichment';
    const held = holdRecord(db, dataset, record, status, facts, provenance, now);
    flagGroups(db, held.clientId, householdClients, record, now, 'Household evidence is not a merge.');
    flagNamedCandidates(db, held.clientId, record, now);
    return finishHeld(db, dataset, record, held, status === 'pending_enrichment' ? 'pending_enrichment' : 'needs_review', now);
  }

  const ingested = ingestCanonicalLead(db, {
    idempotencyKey: key,
    source: SOURCE,
    rawText: provenance,
    now,
    actor: ACTOR,
    displayName: record.person.display_name ?? null,
    phone: verifiedPhone,
    email: verifiedEmail,
    businessLine: 'redfin_buyer',
    isDemo: dataset.synthetic === true,
    facts,
  });
  if (!ingested.clientId || !ingested.opportunityId) {
    return {
      recordId: record.record_id,
      sourceId: record.source.source_id,
      outcome: 'rejected',
      clientId: ingested.clientId,
      opportunityId: ingested.opportunityId,
      eventId: ingested.eventId,
      flaggedClientIds: ingested.flaggedClientIds,
      crmNote: null,
      followUpTrigger: null,
      liveSend: false,
      message: ingested.message,
    };
  }

  const sourceLink = linkCanonicalIdentifier(db, ingested.clientId, 'agent_tools_id', record.source.source_id);
  if (!sourceLink.linked && sourceLink.ownerClientId && sourceLink.ownerClientId !== ingested.clientId) {
    flagCanonicalIdentity(db, {
      clientIds: [ingested.clientId, sourceLink.ownerClientId],
      reason: 'Agent Tools source id already belongs to another client. Nothing was merged.',
      dedupeKey: `agent-tools-source:${record.source.source_id}:${[ingested.clientId, sourceLink.ownerClientId].sort().join(':')}`,
      now,
      actor: ACTOR,
    });
  }
  if (record.person.household_id) {
    linkCanonicalIdentifier(db, ingested.clientId, 'household', record.person.household_id);
    const others = householdClients.filter((id) => id !== ingested.clientId);
    if (others.length > 0) {
      flagCanonicalIdentity(db, {
        clientIds: [ingested.clientId, ...others],
        reason: 'Household id matches another client. The verified phone or email was kept. Nothing was merged.',
        dedupeKey: `household:${record.person.household_id}:${[ingested.clientId, ...others].sort().join(':')}`,
        now,
        actor: ACTOR,
      });
    }
  }
  flagNamedCandidates(db, ingested.clientId, record, now);
  flagSameName(db, ingested.clientId, record.person.display_name ?? null, record, now);

  const lock = claimWorkflowLock(db, {
    clientId: ingested.clientId,
    holder: ACTOR,
    purpose: 'agent_tools_ingest',
    opportunityId: ingested.opportunityId,
    now,
    actor: ACTOR,
  });
  if (!lock.acquired && lock.holder !== ACTOR) {
    return {
      recordId: record.record_id,
      sourceId: record.source.source_id,
      outcome: 'needs_review',
      clientId: ingested.clientId,
      opportunityId: ingested.opportunityId,
      eventId: ingested.eventId,
      flaggedClientIds: [ingested.clientId],
      crmNote: null,
      followUpTrigger: null,
      liveSend: false,
      message: lock.reason,
    };
  }

  openBuyerFile(db, { opportunityId: ingested.opportunityId, now });
  applyVerifiedState(db, ingested.opportunityId, facts, now);
  recordLeadSource(db, {
    clientId: ingested.clientId,
    opportunityId: ingested.opportunityId,
    sourceSystem: 'redfin_agent_tools',
    leadSource: verifiedValue(facts, 'lead_source'),
    sourceIdentifier: record.source.source_id,
    now,
  });
  const action = nextBestAction(db, ingested.opportunityId, now);
  const note = factualCrmNote(record, facts);
  recordCanonicalEvent(db, {
    idempotencyKey: `${key}:provenance`,
    clientId: ingested.clientId,
    opportunityId: ingested.opportunityId,
    kind: 'agent_tools_provenance',
    isDemo: dataset.synthetic === true,
    now,
    payload: {
      system: SOURCE,
      source_id: record.source.source_id,
      record_id: record.record_id,
      exported_at: record.source.exported_at,
      matchedClientId: ingested.clientId,
      live: false,
      writtenToAgentTools: false,
    },
  });
  recordCanonicalEvent(db, {
    idempotencyKey: `${key}:crm-note`,
    clientId: ingested.clientId,
    opportunityId: ingested.opportunityId,
    kind: 'crm_note_draft',
    isDemo: dataset.synthetic === true,
    now,
    payload: { note, live: false, writtenToAgentTools: false },
  });
  releaseWorkflowLock(db, {
    clientId: ingested.clientId,
    holder: ACTOR,
    purpose: 'agent_tools_ingest',
    now,
  });
  const opp = db.get(`SELECT follow_up_trigger, primary_stage, financing_state, search_state FROM opportunities WHERE id = ?`, ingested.opportunityId);
  publishExecution(db, { clientId: ingested.clientId, opportunityId: ingested.opportunityId, now });
  return {
    recordId: record.record_id,
    sourceId: record.source.source_id,
    outcome: ingested.status === 'attached' ? 'attached' : 'created',
    clientId: ingested.clientId,
    opportunityId: ingested.opportunityId,
    eventId: ingested.eventId,
    flaggedClientIds: [],
    crmNote: note,
    followUpTrigger: text(opp, 'follow_up_trigger') || action.follow_up_trigger,
    liveSend: false,
    message: 'Canonical client, opportunity, facts, stage, and a drafted CRM note are stored. Nothing was sent.',
  };
}

function holdRecord(
  db: SqlDb,
  dataset: AgentToolsDataset,
  record: AgentToolsRecord,
  status: 'pending_enrichment' | 'needs_review',
  facts: FactInput[],
  provenance: string,
  now: Date,
) {
  return openCanonicalShell(db, {
    idempotencyKey: `agent-tools:${record.record_id}`,
    source: SOURCE,
    rawText: provenance,
    displayName: record.person.display_name ?? null,
    status,
    isDemo: dataset.synthetic === true,
    facts,
    now,
    actor: ACTOR,
  });
}

function finishHeld(
  db: SqlDb,
  dataset: AgentToolsDataset,
  record: AgentToolsRecord,
  held: ReturnType<typeof openCanonicalShell>,
  outcome: 'pending_enrichment' | 'needs_review',
  now: Date,
): AgentToolsRecordResult {
  if (held.clientId) {
    linkCanonicalIdentifier(db, held.clientId, 'agent_tools_id', record.source.source_id);
    if (record.person.household_id) linkCanonicalIdentifier(db, held.clientId, 'household', record.person.household_id);
    db.run(
      `UPDATE opportunities
       SET primary_stage = 'NEW_INQUIRY', financing_state = 'UNKNOWN', search_state = 'UNKNOWN',
           next_action = ?, next_action_owner = 'Kyle Kleinman', follow_up_trigger = ?,
           no_action_reason = ?, updated_at = ?
       WHERE id = ?`,
      outcome === 'pending_enrichment'
        ? 'Enrich the record before any contact. No verified phone or email is on file.'
        : 'Review the flagged match before any contact.',
      outcome === 'pending_enrichment' ? 'pending_enrichment' : 'identity_review',
      outcome === 'pending_enrichment' ? 'PENDING_ENRICHMENT' : 'NEEDS_REVIEW',
      now.toISOString(),
      held.opportunityId,
    );
    recordCanonicalEvent(db, {
      idempotencyKey: `agent-tools:${record.record_id}:provenance`,
      clientId: held.clientId,
      opportunityId: held.opportunityId,
      kind: 'agent_tools_provenance',
      isDemo: dataset.synthetic === true,
      now,
      payload: {
        system: SOURCE,
        source_id: record.source.source_id,
        record_id: record.record_id,
        exported_at: record.source.exported_at,
        disposition: record.disposition,
        live: false,
        writtenToAgentTools: false,
      },
    });
    if (held.clientId && held.opportunityId) {
      publishExecution(db, { clientId: held.clientId, opportunityId: held.opportunityId, now });
    }
  }
  return {
    recordId: record.record_id,
    sourceId: record.source.source_id,
    outcome,
    clientId: held.clientId,
    opportunityId: held.opportunityId,
    eventId: held.eventId,
    flaggedClientIds: held.flaggedClientIds,
    crmNote: null,
    followUpTrigger: outcome === 'pending_enrichment' ? 'pending_enrichment' : 'identity_review',
    liveSend: false,
    message: held.message,
  };
}

function flagGroups(
  db: SqlDb,
  clientId: string | null,
  others: Array<string | null>,
  record: AgentToolsRecord,
  now: Date,
  reason: string,
): void {
  const ids = uniqueIds([clientId, ...others]);
  if (!clientId || ids.length < 2) return;
  flagCanonicalIdentity(db, {
    clientIds: ids,
    reason: `${reason} Nothing was merged or deleted.`,
    dedupeKey: `agent-tools-flag:${record.record_id}:${ids.sort().join(':')}`,
    now,
    actor: ACTOR,
  });
}

function flagSameName(db: SqlDb, clientId: string | null, displayName: string | null, record: AgentToolsRecord, now: Date): void {
  const needle = displayName?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
  if (!clientId || !needle) return;
  const others = db.all(`SELECT id, display_name FROM clients`).flatMap((row) => {
    const id = text(row, 'id');
    const name = text(row, 'display_name').trim().toLowerCase().replace(/\s+/g, ' ');
    return id !== clientId && name === needle ? [id] : [];
  });
  if (others.length === 0) return;
  flagCanonicalIdentity(db, {
    clientIds: [clientId, ...others],
    reason: 'Same display name. Name alone is not a merge.',
    dedupeKey: `agent-tools-name:${record.record_id}:${[clientId, ...others].sort().join(':')}`,
    now,
    actor: ACTOR,
  });
}

function flagNamedCandidates(db: SqlDb, clientId: string | null, record: AgentToolsRecord, now: Date): void {
  if (!clientId) return;
  for (const candidate of record.dedup_candidates ?? []) {
    const other = candidate.source_id ? findClientsByIdentifier(db, 'agent_tools_id', candidate.source_id)[0] : null;
    if (other && other !== clientId) {
      flagCanonicalIdentity(db, {
        clientIds: [clientId, other],
        reason: candidate.reason,
        dedupeKey: `agent-tools-candidate:${record.record_id}:${other}`,
        now,
        actor: ACTOR,
      });
    } else if (!other) {
      flagCanonicalIdentity(db, {
        clientIds: [clientId],
        reason: `${candidate.reason} Candidate source id ${candidate.source_id ?? 'unknown'} is not on a client yet.`,
        dedupeKey: `agent-tools-candidate-open:${record.record_id}:${candidate.source_id ?? candidate.reason}`,
        now,
        actor: ACTOR,
      });
    }
  }
}

function applyVerifiedState(db: SqlDb, opportunityId: string, facts: FactInput[], now: Date): void {
  const financing = verifiedValue(facts, 'financing_state');
  const search = verifiedValue(facts, 'search_state');
  const stage = verifiedValue(facts, 'primary_stage');
  const financingState = FINANCING_STATES.includes(financing as FinancingState) ? financing : null;
  const searchState = SEARCH_STATES.includes(search as SearchState) ? search : null;
  const primaryStage = stage && stage !== 'OFFER_SUBMITTED' && PRIMARY_STAGES.includes(stage as typeof PRIMARY_STAGES[number])
    ? stage
    : null;
  if (!financingState && !searchState && !primaryStage) return;
  db.run(
    `UPDATE opportunities
     SET financing_state = COALESCE(?, financing_state),
         search_state = COALESCE(?, search_state),
         primary_stage = COALESCE(?, primary_stage),
         updated_at = ?
     WHERE id = ?`,
    financingState,
    searchState,
    primaryStage,
    now.toISOString(),
    opportunityId,
  );
  if (searchState === 'CRITERIA_PARTIAL' || searchState === 'ACTIVE') {
    db.run(
      `INSERT INTO readiness_flags (opportunity_id, flag, state, evidence, updated_at)
       VALUES (?, 'search', 'ready', ?, ?)
       ON CONFLICT(opportunity_id, flag) DO UPDATE SET
         state = excluded.state, evidence = excluded.evidence, updated_at = excluded.updated_at`,
      opportunityId,
      `Verified search state ${searchState}. Criteria on file are not a confirmed tour.`,
      now.toISOString(),
    );
  }
}

function factualCrmNote(record: AgentToolsRecord, facts: FactInput[]): string {
  const verified = facts.filter((fact) => fact.kind === 'fact' && fact.verification === 'verified');
  const inferred = facts.filter((fact) => fact.kind === 'inference' || fact.verification !== 'verified');
  const lines = [
    'Agent Tools note (drafted, not saved to Agent Tools).',
    `Source: ${SOURCE} ${record.source.source_id}`,
    `Record: ${record.record_id}`,
    '',
    'Verified facts',
  ];
  if (verified.length === 0) lines.push('None');
  for (const fact of verified) lines.push(`${fact.fieldKey}: ${fact.value}`);
  lines.push('', 'Inferences (not verified)');
  if (inferred.length === 0) lines.push('None');
  for (const fact of inferred) lines.push(`${fact.fieldKey}: ${fact.value}`);
  lines.push('', 'Nothing was sent. Agent Tools was not written.');
  return lines.join('\n');
}

function recordFacts(record: AgentToolsRecord): FactInput[] {
  const source = `${SOURCE}:${record.source.source_id}`;
  const facts: FactInput[] = (record.facts ?? []).map((fact) => ({
    fieldKey: fact.field.trim(),
    value: fact.value.trim(),
    kind: fact.kind === 'inference' ? 'inference' : 'fact',
    verification: fact.verification === 'verified' ? 'verified' : 'unverified',
    source,
  }));
  for (const phone of record.person.phones ?? []) {
    if (phone.verification === 'inferred' && phone.value.trim()) {
      facts.push({ fieldKey: 'phone_inferred', value: phone.value.trim(), kind: 'inference', verification: 'unverified', source });
    }
  }
  for (const email of record.person.emails ?? []) {
    if (email.verification === 'inferred' && email.value.trim()) {
      facts.push({ fieldKey: 'email_inferred', value: email.value.trim(), kind: 'inference', verification: 'unverified', source });
    }
  }
  return facts.filter((fact) => fact.fieldKey && fact.value);
}

function verifiedValue(facts: FactInput[], field: string): string | null {
  const fact = facts.find((item) => item.fieldKey === field && item.kind === 'fact' && item.verification === 'verified');
  return fact?.value ?? null;
}

function firstVerified(values: Array<{ value: string; verification: string }> | undefined): string | null {
  const found = values?.find((item) => item.verification === 'verified' && item.value.trim());
  return found ? found.value.trim() : null;
}

function uniqueIds(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

function parseRecord(value: unknown): AgentToolsRecord {
  if (!value || typeof value !== 'object') throw new Error('Each record must be an object.');
  const row = value as Record<string, unknown>;
  if (typeof row.record_id !== 'string' || !row.record_id.trim()) throw new Error('record_id is required.');
  if (row.disposition !== 'lead' && row.disposition !== 'needs_review') {
    throw new Error(`Record ${row.record_id} disposition must be lead or needs_review.`);
  }
  const source = row.source;
  if (!source || typeof source !== 'object') throw new Error(`Record ${row.record_id} is missing source.`);
  const sourceRow = source as Record<string, unknown>;
  if (sourceRow.system !== SOURCE) throw new Error(`Record ${row.record_id} source.system must be redfin_agent_tools.`);
  if (typeof sourceRow.source_id !== 'string' || !sourceRow.source_id.trim()) {
    throw new Error(`Record ${row.record_id} source_id is required.`);
  }
  if (typeof sourceRow.exported_at !== 'string' || !sourceRow.exported_at.trim()) {
    throw new Error(`Record ${row.record_id} source.exported_at is required.`);
  }
  const person = row.person;
  if (!person || typeof person !== 'object') throw new Error(`Record ${row.record_id} is missing person.`);
  const personRow = person as Record<string, unknown>;
  return {
    record_id: row.record_id.trim(),
    disposition: row.disposition,
    source: {
      system: SOURCE,
      source_id: sourceRow.source_id.trim(),
      exported_at: sourceRow.exported_at,
    },
    person: {
      display_name: typeof personRow.display_name === 'string' ? personRow.display_name : null,
      phones: parseContacts(personRow.phones),
      emails: parseContacts(personRow.emails),
      household_id: typeof personRow.household_id === 'string' ? personRow.household_id : null,
    },
    facts: parseFacts(row.facts),
    dedup_candidates: parseCandidates(row.dedup_candidates),
  };
}

function parseContacts(value: unknown): Array<{ value: string; verification: 'verified' | 'inferred' }> {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('phones and emails must be arrays.');
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('A phone or email entry must be an object.');
    const row = item as Record<string, unknown>;
    if (typeof row.value !== 'string' || !row.value.trim()) throw new Error('A phone or email needs a value.');
    if (row.verification !== 'verified' && row.verification !== 'inferred') {
      throw new Error('Phone and email verification must be verified or inferred.');
    }
    return { value: row.value, verification: row.verification };
  });
}

function parseFacts(value: unknown): AgentToolsRecord['facts'] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('facts must be an array.');
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('A fact must be an object.');
    const row = item as Record<string, unknown>;
    if (typeof row.field !== 'string' || typeof row.value !== 'string') throw new Error('A fact needs field and value.');
    if (row.kind !== 'fact' && row.kind !== 'inference') throw new Error('Fact kind must be fact or inference.');
    if (row.verification !== 'verified' && row.verification !== 'unverified') {
      throw new Error('Fact verification must be verified or unverified.');
    }
    return {
      field: row.field,
      value: row.value,
      kind: row.kind,
      verification: row.verification,
      evidence: typeof row.evidence === 'string' ? row.evidence : undefined,
    };
  });
}

function parseCandidates(value: unknown): AgentToolsRecord['dedup_candidates'] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('dedup_candidates must be an array.');
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('A dedup candidate must be an object.');
    const row = item as Record<string, unknown>;
    if (typeof row.reason !== 'string' || !row.reason.trim()) throw new Error('A dedup candidate needs a reason.');
    return {
      source_id: typeof row.source_id === 'string' ? row.source_id : undefined,
      display_name: typeof row.display_name === 'string' ? row.display_name : undefined,
      reason: row.reason,
    };
  });
}
