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
      value: plain(value).slice(0, 500),
      kind,
      verification: kind === 'inference' ? 'unverified' : verification,
      source: 'live_master',
    });
  };
  const properties = objectList(lead.properties_discussed);
  const appointments = objectList(lead.appointments)
    .filter((appt) => clean(stringOf(appt.date)))
    .sort((left, right) => tourSortKey(left) - tourSortKey(right));
  const active = selectActiveProperty(properties, appointments, lead);
  const address = clean(stringOf(active?.address));
  push('property_address', address);
  const status = clean(stringOf(active?.status));
  if (status && /^(active|pending|sold|off market)$/i.test(status)) push('property_status', status);
  const url = stringOf(active?.redfin_url);
  if (url && /^https:\/\//i.test(url)) push('redfin_url', url);
  if (!address) {
    const choices = properties.map((item) => clean(stringOf(item.address))).filter((item): item is string => Boolean(item));
    if (choices.length > 1) push('property_options', choices.join(' | '));
  }
  appointments.forEach((appt, index) => {
    const date = clean(stringOf(appt.date));
    if (!date) return;
    const time = clean(stringOf(appt.time)) || 'DATA NEEDED';
    const agent = clean(stringOf(appt.attending_agent)) || 'DATA NEEDED';
    const cancelled = /cancel/i.test(`${stringOf(appt.status) ?? ''} ${stringOf(appt.cancellation_reason) ?? ''}`);
    const report = tourReport(appt, propertyForAppointment(appt, properties) ?? address);
    const note = cancelled
      ? `Scheduled tour ${date} ${time} cancelled. Agent ${agent}.`
      : `Scheduled tour ${date} ${time} with ${agent}. ${report ? 'A touring agent reported an outcome.' : 'Outcome not confirmed.'}`;
    push(index === 0 ? 'scheduled_tour_note' : `scheduled_tour_note_${index + 1}`, note, 'fact', 'verified');
    const outcome = cancelled ? 'SHOWING CANCELLED' : report?.outcomeLabel ?? 'OUTCOME NOT CONFIRMED';
    const place = propertyForAppointment(appt, properties);
    push(
      `showing_detail_${index + 1}`,
      `date=${date}; time=${time}; agent=${agent}; outcome=${outcome}; class=THIRD PARTY REPORTED${place ? `; address=${place}` : ''}`,
    );
  });
  const latest = appointments[appointments.length - 1];
  if (latest) {
    const report = tourReport(latest, propertyForAppointment(latest, properties) ?? address);
    if (report) {
      push(
        'third_party_tour_report',
        `property=${report.property ?? ''}; agent=${report.agent}; outcome=${report.outcomeLabel}; cash_only=${report.cashOnly ? 'yes' : 'no'}; passed=${report.passed ? 'yes' : 'no'}; class=THIRD PARTY REPORTED`,
      );
    }
  }
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

function objectList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
}

function selectActiveProperty(
  properties: Record<string, unknown>[],
  appointments: Record<string, unknown>[],
  lead: Record<string, unknown>,
): Record<string, unknown> | null {
  const newestFirst = [...appointments].sort((left, right) => tourSortKey(right) - tourSortKey(left));
  for (const appt of newestFirst) {
    const match = propertyForAppointment(appt, properties);
    if (match) {
      return properties.find((item) => clean(stringOf(item.address)) === match) ?? { address: match };
    }
  }
  const withAddress = properties.filter((item) => clean(stringOf(item.address)));
  if (newestFirst.length > 0 && withAddress.length === 1) return withAddress[0] ?? null;
  if (newestFirst.length > 0) {
    const toured = withAddress.filter((item) => /tour/i.test(stringOf(item.status) ?? ''));
    if (toured.length === 1) return toured[0] ?? null;
  }
  if (newestFirst.length === 0 && withAddress.length === 1) return withAddress[0] ?? null;
  const current = clean(stringOf(lead.current_property_address));
  if (!newestFirst.length && current) return { address: current };
  return null;
}

function propertyForAppointment(appt: Record<string, unknown>, properties: Record<string, unknown>[]): string | null {
  const id = stringOf(appt.tour_id);
  if (!id) return null;
  const match = properties.find((item) => stringOf(item.tour_id) === id);
  return clean(stringOf(match?.address));
}

function tourReport(appt: Record<string, unknown>, property: string | null): { property: string | null; agent: string; outcomeLabel: string; cashOnly: boolean; passed: boolean } | null {
  const status = stringOf(appt.status) ?? '';
  const outcomeText = clean(stringOf(appt.tour_outcome));
  const outcome = `${outcomeText ?? ''} ${stringOf(appt.follow_up_from_touring_agent) ?? ''}`;
  const cancelled = /cancel/i.test(`${status} ${stringOf(appt.cancellation_reason) ?? ''}`);
  const needsVerification = /needs?\s*verification/i.test(status);
  const explicitlyCompleted = /\bcompleted\b/i.test(status.replace(/_/g, ' ')) && !needsVerification && !cancelled;
  // "scheduled_or_completed_Needs Verification" contains the word completed and is still unverified.
  if (!explicitlyCompleted && !outcomeText) return null;
  const cashOnly = /cash[\s-]*only/i.test(outcome);
  const passed = cashOnly || /eliminat|passed|did not like/i.test(outcome);
  const outcomeLabel = cashOnly ? 'PASSED, CASH ONLY' : passed ? 'PASSED' : 'REPORTED BY TOURING AGENT';
  return {
    property,
    agent: clean(stringOf(appt.attending_agent)) || 'DATA NEEDED',
    outcomeLabel,
    cashOnly,
    passed,
  };
}

function tourSortKey(appt: Record<string, unknown>): number {
  const date = stringOf(appt.date) ?? '';
  const iso = date.match(/20\d{2}-\d{2}-\d{2}/)?.[0] ?? '0000-00-00';
  const time = stringOf(appt.time) ?? '';
  const match = time.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  let minutes = 0;
  if (match?.[1]) {
    let hour = Number(match[1]);
    const minute = Number(match[2] ?? 0);
    const mer = (match[3] ?? '').toLowerCase();
    if (mer === 'pm' && hour < 12) hour += 12;
    if (mer === 'am' && hour === 12) hour = 0;
    minutes = hour * 60 + minute;
  }
  const day = Date.parse(`${iso}T00:00:00.000Z`);
  return (Number.isNaN(day) ? 0 : day) + minutes * 60_000;
}

function plain(value: string): string {
  return value.replace(/[—–]/g, ',').replace(/\s+/g, ' ').trim();
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
