import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/db.ts';
import {
  loadAgentToolsDataset,
  parseAgentToolsDataset,
  readAgentToolsDataset,
  type AgentToolsDataset,
} from '../src/ingest/agentTools.ts';
import { text } from '../src/sql.ts';

const NOW = new Date('2026-09-29T15:00:00.000Z');
const FIXTURE = fileURLToPath(new URL('../fixtures/agent-tools-leads.sample.json', import.meta.url));

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'kyleos-agent-tools-'));
  return openDatabase(join(dir, 'desk.sqlite'));
}

function count(db: ReturnType<typeof openDatabase>, table: string): number {
  return Number(db.get(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0);
}

function envelope(records: AgentToolsDataset['records'], extra?: Partial<AgentToolsDataset>): AgentToolsDataset {
  return {
    dataset: 'redfin_agent_tools_leads',
    mode: 'DRY_RUN',
    exported_at: NOW.toISOString(),
    source_system: 'redfin_agent_tools',
    synthetic: true,
    records,
    ...extra,
  };
}

function lead(id: string, phone: string): AgentToolsDataset['records'][number] {
  return {
    record_id: id,
    disposition: 'lead',
    source: { system: 'redfin_agent_tools', source_id: `src-${id}`, exported_at: NOW.toISOString() },
    person: {
      display_name: `Person ${id}`,
      phones: [{ value: phone, verification: 'verified' }],
      emails: [],
    },
    facts: [],
    dedup_candidates: [],
  };
}

test('a preview does not write and a bulk file is refused', () => {
  const db = tempDb();
  const dataset = readAgentToolsDataset(FIXTURE);
  const preview = loadAgentToolsDataset(db, dataset, { now: NOW });
  assert.equal(preview.applied, false);
  assert.equal(preview.liveSend, false);
  assert.equal(count(db, 'clients'), 0);
  const bulk = envelope(Array.from({ length: 9 }, (_, index) => lead(`bulk-${index}`, `(305) 555-02${String(index).padStart(2, '0')}`)));
  const refused = loadAgentToolsDataset(db, bulk, { apply: true, now: NOW });
  assert.equal(refused.applied, false);
  assert.match(refused.message, /bulk import/);
  assert.equal(count(db, 'clients'), 0);
  const one = loadAgentToolsDataset(db, bulk, { apply: true, onlyRecordId: 'bulk-0', now: NOW });
  assert.equal(one.applied, true);
  assert.equal(one.recordCount, 1);
  assert.equal(one.results[0]?.outcome, 'created');
  assert.equal(count(db, 'clients'), 1);
  db.close();
});

test('the sample fixture keeps every record and does not merge on a name', () => {
  const db = tempDb();
  const dataset = readAgentToolsDataset(FIXTURE);
  assert.equal(dataset.records.length, 4);
  assert.equal(dataset.records.filter((record) => record.disposition === 'lead').length, 3);
  assert.equal(dataset.records.filter((record) => record.disposition === 'needs_review').length, 1);
  const loaded = loadAgentToolsDataset(db, dataset, { apply: true, now: NOW });
  assert.equal(loaded.applied, true);
  assert.equal(loaded.liveSend, false);
  assert.equal(loaded.results.length, 4);
  assert.equal(count(db, 'clients'), 4);
  assert.equal(count(db, 'sent_messages'), 0);

  const lane = loaded.results[0];
  assert.equal(lane?.outcome, 'created');
  assert.ok(lane?.clientId);
  assert.ok(lane?.opportunityId);
  const opp = db.get(`SELECT * FROM opportunities WHERE id = ?`, lane?.opportunityId);
  assert.equal(text(opp, 'primary_stage'), 'NEW_INQUIRY');
  assert.equal(text(opp, 'financing_state'), 'UNKNOWN');
  assert.equal(text(opp, 'search_state'), 'NOT_STARTED');
  assert.equal(text(opp, 'follow_up_trigger'), 'intake_answer');
  assert.equal(text(opp, 'source_label'), 'redfin_agent_tools');
  const budget = db.get(
    `SELECT * FROM client_facts WHERE client_id = ? AND field_key = 'budget'`,
    lane?.clientId,
  );
  assert.equal(text(budget, 'kind'), 'fact');
  assert.equal(text(budget, 'verification'), 'verified');
  assert.equal(text(budget, 'value'), '$650K');
  const timeline = db.get(
    `SELECT * FROM client_facts WHERE client_id = ? AND field_key = 'timeline'`,
    lane?.clientId,
  );
  assert.equal(text(timeline, 'kind'), 'inference');
  assert.equal(text(timeline, 'verification'), 'unverified');
  const nba = db.get(`SELECT * FROM next_best_actions WHERE opportunity_id = ? AND is_primary = 1`, lane?.opportunityId);
  assert.ok(nba);
  assert.equal(Number(nba?.live), 0);
  assert.match(lane?.crmNote ?? '', /not saved to Agent Tools/);
  assert.match(lane?.crmNote ?? '', /\$650K/);
  const provenance = db.get(
    `SELECT payload_json FROM events WHERE idempotency_key = ?`,
    'agent-tools:fixture-lane-001:provenance',
  );
  assert.match(text(provenance, 'payload_json'), /at-fixture-lane/);
  assert.match(text(provenance, 'payload_json'), /writtenToAgentTools":false/);

  const empty = db.get(`SELECT * FROM clients WHERE display_name = 'Fixture Nocontact'`);
  assert.equal(text(empty, 'status'), 'pending_enrichment');
  const emptyOpp = db.get(`SELECT * FROM opportunities WHERE client_id = ?`, text(empty, 'id'));
  assert.equal(text(emptyOpp, 'no_action_reason'), 'PENDING_ENRICHMENT');
  assert.equal(
    count(db, 'client_identifiers') > 0,
    true,
  );
  const inferredPhoneUsedAsKey = db.get(
    `SELECT id FROM client_identifiers WHERE kind = 'email' AND value_normalized = 'maybe.nocontact@example.com'`,
  );
  assert.equal(inferredPhoneUsedAsKey, undefined);

  const review = db.get(`SELECT * FROM clients WHERE display_name = 'Fixture Review'`);
  assert.equal(text(review, 'status'), 'needs_review');
  assert.notEqual(text(review, 'id'), lane?.clientId);
  const reviewFlag = db.get(`SELECT reason FROM identity_flags WHERE client_id = ? OR other_client_id = ?`, text(review, 'id'), text(review, 'id'));
  assert.match(text(reviewFlag, 'reason'), /not a merge/i);

  const twins = db.all(`SELECT id FROM clients WHERE display_name = 'Fixture Lane'`);
  assert.equal(twins.length, 2);
  const nameFlag = db.get(`SELECT reason FROM identity_flags WHERE reason LIKE 'Same display name%'`);
  assert.match(text(nameFlag, 'reason'), /Name alone is not a merge/);

  const again = loadAgentToolsDataset(db, dataset, { apply: true, onlyRecordId: 'fixture-lane-001', now: NOW });
  assert.equal(again.results[0]?.outcome, 'duplicate');
  assert.equal(count(db, 'clients'), 4);
  assert.equal(count(db, 'sent_messages'), 0);
  db.close();
});

test('a verified phone and email on different clients is flagged and not merged', () => {
  const db = tempDb();
  loadAgentToolsDataset(db, envelope([{
    ...lead('ada', '(305) 555-0171'),
    person: { display_name: 'Ada Fixture', phones: [{ value: '(305) 555-0171', verification: 'verified' }], emails: [] },
  }]), { apply: true, now: NOW });
  loadAgentToolsDataset(db, envelope([{
    ...lead('blake', '(305) 555-0172'),
    person: {
      display_name: 'Blake Fixture',
      phones: [],
      emails: [{ value: 'blake.fixture@example.com', verification: 'verified' }],
    },
  }]), { apply: true, now: NOW });
  const split = loadAgentToolsDataset(db, envelope([{
    record_id: 'split-1',
    disposition: 'lead',
    source: { system: 'redfin_agent_tools', source_id: 'at-split', exported_at: NOW.toISOString() },
    person: {
      display_name: 'Split Fixture',
      phones: [{ value: '(305) 555-0171', verification: 'verified' }],
      emails: [{ value: 'blake.fixture@example.com', verification: 'verified' }],
    },
    facts: [],
    dedup_candidates: [],
  }]), { apply: true, now: NOW });
  assert.equal(split.results[0]?.outcome, 'needs_review');
  assert.equal(count(db, 'clients'), 3);
  const ada = db.get(`SELECT display_name FROM clients WHERE display_name = 'Ada Fixture'`);
  const blake = db.get(`SELECT display_name FROM clients WHERE display_name = 'Blake Fixture'`);
  assert.equal(text(ada, 'display_name'), 'Ada Fixture');
  assert.equal(text(blake, 'display_name'), 'Blake Fixture');
  assert.equal(text(db.get(`SELECT duplicate_of_client_id FROM clients WHERE display_name = 'Ada Fixture'`), 'duplicate_of_client_id'), '');
  db.close();
});

test('household evidence does not merge two verified phones', () => {
  const db = tempDb();
  const dataset = readAgentToolsDataset(FIXTURE);
  loadAgentToolsDataset(db, dataset, { apply: true, onlyRecordId: 'fixture-lane-001', now: NOW });
  const other = loadAgentToolsDataset(db, envelope([{
    record_id: 'fixture-household-005',
    disposition: 'lead',
    source: { system: 'redfin_agent_tools', source_id: 'at-fixture-household', exported_at: NOW.toISOString() },
    person: {
      display_name: 'Fixture Housemate',
      phones: [{ value: '(305) 555-0103', verification: 'verified' }],
      emails: [{ value: 'fixture.housemate@example.com', verification: 'verified' }],
      household_id: 'hh-fixture-lane',
    },
    facts: [],
    dedup_candidates: [],
  }]), { apply: true, now: NOW });
  assert.equal(other.results[0]?.outcome, 'created');
  assert.equal(count(db, 'clients'), 2);
  const flag = db.get(`SELECT reason FROM identity_flags WHERE reason LIKE 'Household id%'`);
  assert.match(text(flag, 'reason'), /Nothing was merged/);
  db.close();
});

test('a file that is not DRY_RUN is rejected before any write', () => {
  assert.throws(() => parseAgentToolsDataset({
    dataset: 'redfin_agent_tools_leads',
    mode: 'LIVE',
    exported_at: NOW.toISOString(),
    source_system: 'redfin_agent_tools',
    records: [],
  }), /DRY_RUN/);
});
