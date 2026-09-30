import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { ingestCanonicalLead, writeClientFact } from '../src/canonical.ts';
import { openBuyerFile } from '../src/conversion/engine.ts';
import { buildMorningBrief, markManual, prepareExecution, productionClock } from '../src/conversion/execution.ts';
import { openDatabase } from '../src/db.ts';
import { loadAgentToolsDataset, readAgentToolsDataset } from '../src/ingest/agentTools.ts';
import { text } from '../src/sql.ts';

const NOW = new Date('2026-09-29T07:50:00.000Z');

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'kyleos-v5-'));
  return openDatabase(join(dir, 'desk.sqlite'));
}

function openLead(db: ReturnType<typeof openDatabase>, name: string, phone: string) {
  const created = ingestCanonicalLead(db, {
    idempotencyKey: `v5-${name}-${phone}`,
    source: 'webhook',
    rawText: name,
    displayName: name,
    phone,
    email: null,
    now: NOW,
  });
  assert.ok(created.clientId);
  assert.ok(created.opportunityId);
  openBuyerFile(db, { opportunityId: created.opportunityId, now: NOW });
  return { clientId: created.clientId, opportunityId: created.opportunityId };
}

test('the production brief uses the real clock, not the Hot 7 freeze', () => {
  const db = tempDb();
  const before = Date.now();
  const brief = buildMorningBrief(db, productionClock(), 'production');
  const after = Date.now();
  const stamped = new Date(brief.generatedAt).getTime();
  assert.equal(brief.clock, 'production');
  assert.ok(stamped >= before && stamped <= after);
  assert.match(brief.text, /Clock: production/);
  assert.match(brief.generatedAtEt, /ET|EDT|EST/);
  assert.doesNotMatch(brief.text, /3:50 AM/);
  assert.equal(brief.cards.length, 0);
  assert.match(brief.text, /Actionable clients: 0/);
  db.close();
});

test('a past tour stays T0 after its morning due time', () => {
  const db = tempDb();
  const morning = new Date('2026-09-29T07:50:00.000Z');
  const afternoon = new Date('2026-09-29T18:05:00.000Z');
  const dataset = readAgentToolsDataset(fileURLToPath(new URL('../fixtures/hot7-2026-09-29.json', import.meta.url)));
  loadAgentToolsDataset(db, dataset, { apply: true, now: morning });
  const brief = buildMorningBrief(db, afternoon, 'production');
  const echo = brief.cards[0];
  assert.equal(echo?.client_name, 'Echo Niu');
  assert.equal(echo?.priority_tier, 'T0');
  assert.equal(echo?.internal_action_type, 'tour_follow_up');
  assert.ok(echo?.summary_buckets.includes('overdue'));
  assert.ok(echo?.summary_buckets.includes('post_tour'));
  db.close();
});

test('mark sent reranks to waiting and stays unverified', () => {
  const db = tempDb();
  const lead = openLead(db, 'Echo Standin', '3055550141');
  const first = prepareExecution(db, lead.opportunityId, NOW);
  assert.match(first.human_headline, /TEXT/);
  assert.equal(first.evidence_label, 'NONE');
  const marked = markManual(db, lead.opportunityId, 'sent', NOW);
  assert.match(marked.message, /No provider confirmed delivery/);
  assert.match(marked.message, /MARKED BY KYLE/);
  assert.equal(marked.sent, false);
  assert.equal(marked.providerConfirmed, false);
  const next = prepareExecution(db, lead.opportunityId, NOW);
  assert.match(next.human_headline, /WAIT ON ECHO/);
  assert.equal(next.evidence_label, 'MARKED BY KYLE');
  assert.equal(next.waiting_on, 'CLIENT');
  assert.equal(next.client_draft, null);
  assert.equal(next.priority_tier, 'T3');
  assert.equal(next.provider_confirmed, false);
  assert.equal(Number(db.get(`SELECT COUNT(*) AS n FROM sent_messages`)?.n ?? 0), 0);
  const row = db.get(`SELECT payload_json FROM events WHERE kind = 'manual_mark'`);
  assert.match(text(row, 'payload_json'), /MARKED BY KYLE/);
  assert.doesNotMatch(text(row, 'payload_json'), /VERIFIED BY INTEGRATION/);
  db.close();
});

test('a Kyle promise outranks a passive intake question', () => {
  const db = tempDb();
  const quiet = openLead(db, 'Quiet Quin', '3055550142');
  const owed = openLead(db, 'Owed Owen', '3055550143');
  writeClientFact(db, {
    clientId: owed.clientId,
    opportunityId: owed.opportunityId,
    now: NOW,
    fact: { fieldKey: 'kyle_promise', value: "I'll send the comps tonight", kind: 'fact', verification: 'verified', source: 'test' },
  });
  const brief = buildMorningBrief(db, NOW, 'test');
  assert.equal(brief.cards[0]?.client_name, 'Owed Owen');
  assert.equal(brief.cards[0]?.priority_tier, 'T0');
  assert.match(brief.cards[0]?.human_headline ?? '', /KEEP THE PROMISE/);
  assert.match(brief.cards[0]?.client_draft ?? '', /I'll send the comps tonight/);
  assert.doesNotMatch(brief.cards[0]?.client_draft ?? '', /—/);
  assert.equal(brief.cards[1]?.client_name, 'Quiet Quin');
  assert.equal(brief.cards[1]?.priority_tier, 'T2');
  assert.equal(quiet.opportunityId.length > 0, true);
  db.close();
});

test('a call action exposes a tel link and a Kyle-reported showing is not verified', () => {
  const db = tempDb();
  const caller = openLead(db, 'Phone Phil', '3055550164');
  writeClientFact(db, {
    clientId: caller.clientId,
    opportunityId: caller.opportunityId,
    now: NOW,
    fact: { fieldKey: 'preferred_channel', value: 'phone', kind: 'fact', verification: 'verified', source: 'test' },
  });
  const call = prepareExecution(db, caller.opportunityId, NOW);
  assert.equal(call.action_channel, 'call');
  assert.equal(call.call_href, 'tel:+13055550164');
  assert.match(call.execution_steps, /Tap Call/);
  assert.equal(call.execution_adapter, 'tel_link');

  const shown = openLead(db, 'Shown Sue', '3055550144');
  prepareExecution(db, shown.opportunityId, NOW);
  markManual(db, shown.opportunityId, 'showing_occurred', NOW);
  const after = prepareExecution(db, shown.opportunityId, NOW);
  assert.match(after.client_draft ?? '', /what did you think once you got inside/i);
  assert.match(after.tour_confirmation_state, /NOT CONFIRMED/);
  assert.match(after.tour_confirmation_state, /KYLE REPORTED, NOT VERIFIED/);
  assert.equal(after.evidence_label, 'MARKED BY KYLE');
  assert.doesNotMatch(after.customer_property_state, /Confirmed|Completed/);
  db.close();
});
