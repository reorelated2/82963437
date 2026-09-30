import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ingestCanonicalLead, writeClientFact, type FactInput } from '../src/canonical.ts';
import { openBuyerFile } from '../src/conversion/engine.ts';
import { buildMorningBrief, prepareExecution } from '../src/conversion/execution.ts';
import { openDatabase } from '../src/db.ts';
import { loadAgentToolsDataset, type AgentToolsDataset } from '../src/ingest/agentTools.ts';
import { text } from '../src/sql.ts';

const VIEW = new Date('2026-09-29T18:00:00.000Z');

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'kyleos-bugs-'));
  return openDatabase(join(dir, 'desk.sqlite'));
}

function phoneLead(db: ReturnType<typeof openDatabase>, name: string, phone: string) {
  const created = ingestCanonicalLead(db, {
    idempotencyKey: `bug-${name}-${phone}`,
    source: 'webhook',
    rawText: name,
    displayName: name,
    phone,
    email: null,
    now: VIEW,
  });
  assert.ok(created.clientId);
  assert.ok(created.opportunityId);
  openBuyerFile(db, { opportunityId: created.opportunityId, now: VIEW });
  return { clientId: created.clientId!, opportunityId: created.opportunityId! };
}

function addFact(
  db: ReturnType<typeof openDatabase>,
  ids: { clientId: string; opportunityId: string },
  fact: FactInput,
) {
  writeClientFact(db, { clientId: ids.clientId, opportunityId: ids.opportunityId, fact, now: VIEW });
}

test('a tour older than six days uses the date, not the weekday', () => {
  const db = tempDb();
  const ids = phoneLead(db, 'Pat Weekday', '3055550101');
  addFact(db, ids, { fieldKey: 'property_address', value: '10 Oak St', kind: 'inference', verification: 'unverified', source: 'test' });
  addFact(db, ids, { fieldKey: 'tour_datetime', value: '2026-09-20 18:00', kind: 'inference', verification: 'unverified', source: 'test' });
  addFact(db, ids, { fieldKey: 'tour_outcome', value: 'unconfirmed', kind: 'inference', verification: 'unverified', source: 'test' });
  const card = prepareExecution(db, ids.opportunityId, VIEW);
  assert.equal(card.client_draft, 'Pat, did you end up seeing 10 Oak St on 9/20?');
  assert.doesNotMatch(card.client_draft ?? '', /on Sunday/);
  db.close();
});

test('a tour older than 21 days is past history, not an attendance text', () => {
  const db = tempDb();
  const ids = phoneLead(db, 'Pat History', '3055550102');
  addFact(db, ids, { fieldKey: 'property_address', value: '10 Oak St', kind: 'inference', verification: 'unverified', source: 'test' });
  addFact(db, ids, { fieldKey: 'tour_datetime', value: '2026-09-01 18:00', kind: 'inference', verification: 'unverified', source: 'test' });
  addFact(db, ids, { fieldKey: 'tour_outcome', value: 'unconfirmed', kind: 'inference', verification: 'unverified', source: 'test' });
  const card = prepareExecution(db, ids.opportunityId, VIEW);
  assert.doesNotMatch(card.client_draft ?? '', /did you end up seeing/i);
  assert.match(card.client_draft ?? '', /9\/1/);
  assert.match(card.client_draft ?? '', /behind us/);
  assert.equal(card.customer_property_state, 'Past history');
  db.close();
});

test('the loader keeps a per-fact source date instead of the import clock', () => {
  const db = tempDb();
  const dataset: AgentToolsDataset = {
    dataset: 'redfin_agent_tools_leads',
    mode: 'DRY_RUN',
    exported_at: VIEW.toISOString(),
    source_system: 'redfin_agent_tools',
    synthetic: true,
    records: [{
      record_id: 'bug-old-tour',
      disposition: 'lead',
      source: { system: 'redfin_agent_tools', source_id: 'bug-old-tour', exported_at: VIEW.toISOString() },
      person: {
        display_name: 'Old Tour',
        phones: [{ value: '(305) 555-0103', verification: 'verified' }],
        emails: [],
      },
      facts: [{
        field: 'tours_summary',
        value: 'Upcoming tour agent scheduled with the buyer',
        kind: 'fact',
        verification: 'verified',
        source_date: '2026-08-01',
      }],
    }],
  };
  const loaded = loadAgentToolsDataset(db, dataset, { apply: true, now: VIEW });
  assert.equal(loaded.applied, true);
  const row = db.get(`SELECT observed_at FROM client_facts WHERE field_key = 'tours_summary'`);
  const observed = text(row, 'observed_at');
  assert.ok(observed < '2026-08-03');
  assert.doesNotMatch(observed, /^2026-09-29/);
  const brief = buildMorningBrief(db, VIEW, 'test');
  const card = brief.cards.find((item) => item.client_name === 'Old Tour');
  assert.ok(card);
  assert.doesNotMatch(card.client_draft ?? '', /did you end up seeing/i);
  assert.match(card.client_draft ?? '', /behind us/);
  db.close();
});

test('an email card copies the subject and body when the email is verified', () => {
  const db = tempDb();
  const created = ingestCanonicalLead(db, {
    idempotencyKey: 'bug-ada-email',
    source: 'webhook',
    rawText: 'Ada Inbox',
    displayName: 'Ada Inbox',
    phone: null,
    email: 'ada.inbox@example.com',
    now: VIEW,
  });
  assert.ok(created.opportunityId);
  openBuyerFile(db, { opportunityId: created.opportunityId, now: VIEW });
  const brief = buildMorningBrief(db, VIEW, 'test');
  const card = brief.cards.find((item) => item.client_name === 'Ada Inbox');
  assert.ok(card);
  assert.equal(card.action_channel, 'email');
  assert.equal(card.verified_email, 'ada.inbox@example.com');
  assert.ok(card.email_subject);
  assert.ok(card.email_draft);
  const start = brief.text.indexOf('ADA INBOX');
  const block = brief.text.slice(start, brief.text.indexOf('ENGINE (internal', start));
  assert.match(block, /COPY: "Subject:/);
  assert.match(block, /ada.inbox@example.com/i);
  assert.doesNotMatch(block, /COPY: DATA NEEDED/);
  assert.doesNotMatch(card.email_draft ?? '', /—|–/);
  db.close();
});

test('a recorded pass does not ask what they thought of the house', () => {
  const db = tempDb();
  const ids = phoneLead(db, 'Ned Passed', '3055550104');
  addFact(db, ids, { fieldKey: 'property_address', value: '44 Pine Ave', kind: 'inference', verification: 'unverified', source: 'test' });
  addFact(db, ids, { fieldKey: 'tour_datetime', value: '2026-09-27 18:00', kind: 'inference', verification: 'unverified', source: 'test' });
  addFact(db, ids, { fieldKey: 'tour_outcome', value: 'unconfirmed', kind: 'inference', verification: 'unverified', source: 'test' });
  addFact(db, ids, {
    fieldKey: 'recent_tour_note',
    value: 'Client passed because the listing is cash-only.',
    kind: 'inference',
    verification: 'unverified',
    source: 'test',
  });
  const card = prepareExecution(db, ids.opportunityId, VIEW);
  assert.equal(card.client_draft, 'Ned, I have a note that you passed on 44 Pine Ave because it is cash only. Want me to send a couple that fit financing?');
  assert.doesNotMatch(card.client_draft ?? '', /what did you think|did you end up seeing/i);
  assert.doesNotMatch(card.customer_property_state, /outcome unknown/i);
  assert.doesNotMatch(card.tour_confirmation_state, /outcome unknown/i);
  assert.match(card.tour_confirmation_state, /INFERENCE SAYS PASSED/);
  assert.match(card.tour_confirmation_state, /NOT VERIFIED/);
  assert.match(card.why_now, /inference/i);
  assert.doesNotMatch(card.client_draft ?? '', /—|–/);
  db.close();
});

test('a saved-search draft asks one question and does not paste the list', () => {
  const db = tempDb();
  const dataset: AgentToolsDataset = {
    dataset: 'redfin_agent_tools_leads',
    mode: 'DRY_RUN',
    exported_at: VIEW.toISOString(),
    source_system: 'redfin_agent_tools',
    synthetic: true,
    records: [{
      record_id: 'bug-search',
      disposition: 'lead',
      source: { system: 'redfin_agent_tools', source_id: 'bug-search', exported_at: VIEW.toISOString() },
      person: { display_name: 'Sam Search', phones: [], emails: [] },
      facts: [{
        field: 'saved_search',
        value: [
          'Miami Beach condos, 2 bed, $400K to $600K',
          'Coral Gables houses, 3 bed, $700K to $900K',
          'Aventura waterfront, 2 bed, $500K to $800K',
        ].join('\n'),
        kind: 'fact',
        verification: 'verified',
      }],
    }],
  };
  const loaded = loadAgentToolsDataset(db, dataset, { apply: true, now: VIEW });
  assert.equal(loaded.applied, true);
  const brief = buildMorningBrief(db, VIEW, 'test');
  const card = brief.cards.find((item) => item.client_name === 'Sam Search');
  assert.ok(card);
  const draft = card.client_draft ?? '';
  assert.equal(draft, 'Sam, Kyle with Redfin. Miami Beach condos, 2 bed, $400K to $600K. Which area is the priority right now?');
  assert.doesNotMatch(draft, /Coral Gables|Aventura/);
  assert.equal(draft.match(/\?/g)?.length ?? 0, 1);
  assert.ok(draft.split(/[.!?]+/).filter((part) => part.trim()).length <= 3);
  assert.doesNotMatch(draft, /—|–/);
  db.close();
});
