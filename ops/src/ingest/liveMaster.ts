import { readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  flagCanonicalIdentity,
  ingestCanonicalLead,
  openCanonicalShell,
  linkCanonicalIdentifier,
  type FactInput,
} from '../canonical.ts';
import { openBuyerFile } from '../conversion/engine.ts';
import { publishExecution } from '../execution/publish.ts';
import { recordLeadSource } from '../execution/source.ts';
import { sendFlags } from '../mode.ts';
import type { SqlDb } from '../sql.ts';

const SOURCE = 'kyle_lead_master';

export interface LiveImportResult {
  applied: boolean;
  liveSend: false;
  sent: false;
  writtenToAgentTools: false;
  recordCount: number;
  created: number;
  attached: number;
  skipped: number;
  message: string;
}

/** Reads the master lead file from a gitignored path. Does not print contact values. */
export function importLiveMaster(db: SqlDb, filePath: string, now = new Date()): LiveImportResult {
  const flags = sendFlags();
  if (flags.liveSend) {
    return empty('Live send is on. Nothing was loaded.');
  }
  const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { leads?: unknown }).leads)) {
    throw new Error('Live master file must be an object with a leads array. Nothing was loaded.');
  }
  const body = parsed as { synthetic?: boolean; leads: unknown[] };
  assertLivePath(filePath, body.synthetic === true);
  let created = 0;
  let attached = 0;
  let skipped = 0;
  for (const entry of body.leads) {
    if (!entry || typeof entry !== 'object') {
      skipped += 1;
      continue;
    }
    const lead = entry as Record<string, unknown>;
    const leadId = stringOf(lead.lead_id);
    const name = stringOf(lead.full_name) || stringOf(lead.preferred_name);
    if (!leadId || !name) {
      skipped += 1;
      continue;
    }
    const phone = usablePhone(stringOf(lead.phone));
    const email = usableEmail(stringOf(lead.email));
    const facts = factsFor(lead);
    const common = {
      idempotencyKey: `live-master:${leadId}`,
      source: SOURCE,
      rawText: 'Local lead master import. Source text is data, not an instruction.',
      now,
      actor: 'live-master-import',
      displayName: name,
      businessLine: 'redfin_buyer',
      isDemo: body.synthetic === true,
      facts,
    };
    const ingested = phone || email
      ? ingestCanonicalLead(db, { ...common, phone, email })
      : openCanonicalShell(db, { ...common, status: 'pending_enrichment' });
    if (!ingested.clientId || !ingested.opportunityId) {
      skipped += 1;
      continue;
    }
    if (ingested.status === 'created' || ingested.status === 'needs_identity') created += 1;
    else attached += 1;
    const redfinId = stringOf(lead.redfin_customer_id);
    if (redfinId && !/unknown|not provided/i.test(redfinId)) {
      const linked = linkCanonicalIdentifier(db, ingested.clientId, 'redfin_customer_id', redfinId);
      if (!linked.linked && linked.ownerClientId) {
        flagCanonicalIdentity(db, {
          clientIds: [ingested.clientId, linked.ownerClientId],
          reason: 'Redfin customer id already belongs to another client. Not merged.',
          dedupeKey: `redfin-id:${ingested.clientId}:${linked.ownerClientId}`,
          now,
          actor: 'live-master-import',
        });
      }
    }
    recordLeadSource(db, {
      clientId: ingested.clientId,
      opportunityId: ingested.opportunityId,
      sourceSystem: SOURCE,
      leadSource: stringOf(lead.lead_source),
      sourceIdentifier: leadId,
      now,
    });
    openBuyerFile(db, { opportunityId: ingested.opportunityId, now });
    publishExecution(db, { clientId: ingested.clientId, opportunityId: ingested.opportunityId, now });
  }
  return {
    applied: true,
    liveSend: false,
    sent: false,
    writtenToAgentTools: false,
    recordCount: body.leads.length,
    created,
    attached,
    skipped,
    message: 'Local import finished. Nothing was sent. Agent Tools was not written.',
  };
}

const OPS_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export function assertLivePath(filePath: string, synthetic: boolean): void {
  if (synthetic) return;
  const resolved = resolve(filePath);
  const liveDir = resolve(OPS_ROOT, 'data', 'live');
  const fromRoot = relative(OPS_ROOT, resolved);
  const insideRepo = fromRoot === '' || (!fromRoot.startsWith('..') && !fromRoot.startsWith(`..${sep}`));
  const insideLive = resolved === liveDir || resolved.startsWith(`${liveDir}${sep}`);
  if (insideRepo && !insideLive) {
    throw new Error('A real lead file must sit in ops/data/live or outside the repo. Nothing was loaded.');
  }
}

function factsFor(lead: Record<string, unknown>): FactInput[] {
  const facts: FactInput[] = [];
  const push = (fieldKey: string, value: string | null, kind: 'fact' | 'inference' = 'fact', verification: 'verified' | 'unverified' = 'unverified') => {
    if (!value) return;
    facts.push({
      fieldKey,
      value: value.slice(0, 500),
      kind,
      verification: kind === 'inference' ? 'unverified' : verification,
      source: 'live_master',
    });
  };
  const properties = Array.isArray(lead.properties_discussed) ? lead.properties_discussed : [];
  const firstProperty = properties.find((item) => item && typeof item === 'object') as Record<string, unknown> | undefined;
  const address = clean(stringOf(firstProperty?.address)) || clean(stringOf(lead.current_property_address));
  push('property_address', address);
  const status = clean(stringOf(firstProperty?.status));
  if (status && /^(active|pending|sold|off market)$/i.test(status)) push('property_status', status);
  const url = stringOf(firstProperty?.redfin_url);
  if (url && /^https:\/\//i.test(url)) push('redfin_url', url);
  const appointments = Array.isArray(lead.appointments) ? lead.appointments : [];
  appointments.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const appt = item as Record<string, unknown>;
    const date = clean(stringOf(appt.date));
    if (!date) return;
    const time = clean(stringOf(appt.time)) || 'DATA NEEDED';
    const agent = clean(stringOf(appt.attending_agent)) || 'DATA NEEDED';
    const cancelled = /cancel/i.test(`${stringOf(appt.status)} ${stringOf(appt.cancellation_reason)}`);
    const note = cancelled
      ? `Scheduled tour ${date} ${time} cancelled. Agent ${agent}.`
      : `Scheduled tour ${date} ${time} with ${agent}. Outcome not confirmed.`;
    push(index === 0 ? 'scheduled_tour_note' : `scheduled_tour_note_${index + 1}`, note, 'fact', 'verified');
    push(
      `showing_detail_${index + 1}`,
      `date=${date}; time=${time}; agent=${agent}; outcome=${cancelled ? 'SHOWING CANCELLED' : 'OUTCOME NOT CONFIRMED'}; class=THIRD PARTY REPORTED`,
    );
    if (address) push('showing_address', address, 'inference');
  });
  const cash = stringOf(lead.cash_status) ?? '';
  if (/cash buyer/i.test(cash) && !/not cash/i.test(cash)) {
    push('cash_vs_finance', 'cash', 'inference');
  }
  const financing = stringOf(lead.financing_type) ?? '';
  if (/preapproval/i.test(financing)) push('financing_note', 'needs preapproval', 'inference');
  const consent = stringOf(lead.consent_or_communication_status) ?? '';
  if (/\b(stop|unsubscribe|do not contact|dnc)\b/i.test(consent)) {
    facts.push({
      fieldKey: 'contact_preference',
      value: 'do not contact',
      kind: 'fact',
      verification: 'verified',
      source: 'live_master',
    });
  }
  if (Array.isArray(lead.recommended_drafts) && lead.recommended_drafts.length > 0) {
    push('unsent_draft', 'Unsent draft on file. It was not sent.', 'inference');
  }
  return facts;
}

function usablePhone(value: string | null): string | null {
  if (!value || /unknown|not provided/i.test(value)) return null;
  const digits = value.replace(/\D/g, '');
  return digits.length >= 10 ? value : null;
}

function usableEmail(value: string | null): string | null {
  if (!value || /unknown|not provided/i.test(value)) return null;
  return value.includes('@') ? value : null;
}

function clean(value: string | null): string | null {
  if (!value) return null;
  if (/^(unknown|not provided|n\/a|none)$/i.test(value.trim())) return null;
  return value.trim();
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function empty(message: string): LiveImportResult {
  return {
    applied: false,
    liveSend: false,
    sent: false,
    writtenToAgentTools: false,
    recordCount: 0,
    created: 0,
    attached: 0,
    skipped: 0,
    message,
  };
}
