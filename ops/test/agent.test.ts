import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AGENT_TOOLS, FORBIDDEN_TOOLS, getAgentRun, runInquiryAgent } from '../src/agent.ts';
import { openDatabase } from '../src/db.ts';
import { intakeLead } from '../src/workflow.ts';

const NOW = new Date('2026-09-24T15:00:00.000Z');

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'kleinman-agent-'));
  return openDatabase(join(dir, 'desk.sqlite'));
}

function count(db: ReturnType<typeof openDatabase>, table: string): number {
  return Number(db.get(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0);
}

test('the inquiry agent proposes SEND, NOTE, and NEXT and does not send', () => {
  const db = tempDb();
  const run = runInquiryAgent(db, {
    text: 'Name: Nate Alvarez\nPhone: (305) 555-0148\nProperty: North Miami property\nRequested showing: 5:30\nBudget: $650K',
    sourceKind: 'paste',
    now: NOW,
  });
  assert.equal(run.agentStatus, 'completed');
  assert.equal(run.status, 'created');
  assert.equal(run.send.sent, false);
  assert.deepEqual(run.steps.map((step) => step.tool), [...AGENT_TOOLS]);
  const extracted = run.steps[0].output as { forbiddenTools: string[]; financing: string; showingConfirmed: string };
  assert.deepEqual(extracted.forbiddenTools, [...FORBIDDEN_TOOLS]);
  assert.equal(extracted.financing, 'missing');
  assert.equal(extracted.showingConfirmed, 'missing');
  const pack = run.steps.find((step) => step.tool === 'read_package');
  const output = pack?.output as { send: string; next: string };
  assert.match(output.send, /Hey Nate, Kyle Kleinman with Redfin/);
  assert.equal(/showing is confirmed|you're confirmed|you are confirmed/i.test(output.send), false);
  assert.match(output.next, /not confirmed/i);
  assert.equal(count(db, 'sent_messages'), 0);
  const stored = getAgentRun(db, run.id);
  assert.equal(stored?.steps.length, AGENT_TOOLS.length);
  assert.equal(stored?.draftId, run.draftId);
  db.close();
});

test('a second identical inquiry does not create another contact', () => {
  const db = tempDb();
  const text = 'Name: Ada Lopez\nPhone: (305) 555-0177\nBudget: $500K';
  const first = runInquiryAgent(db, { text, sourceKind: 'paste', now: NOW });
  const second = runInquiryAgent(db, { text, sourceKind: 'paste', now: NOW });
  assert.equal(first.status, 'created');
  assert.equal(second.status, 'duplicate');
  assert.equal(second.agentStatus, 'completed');
  assert.equal(count(db, 'contacts'), 1);
  assert.equal(count(db, 'drafts'), 1);
  assert.equal(count(db, 'sent_messages'), 0);
  db.close();
});

test('ambiguous text is held and does not become a contact', () => {
  const db = tempDb();
  const run = runInquiryAgent(db, {
    text: 'Name: N?te [illegible]\nPhone: (305) 555-0100\nPhone: (305) 555-0199\nBudget: ???',
    sourceKind: 'paste',
    now: NOW,
  });
  assert.equal(run.agentStatus, 'held');
  assert.equal(run.contactId, null);
  assert.equal(count(db, 'contacts'), 0);
  assert.equal(count(db, 'drafts'), 0);
  assert.equal(run.send.sent, false);
  const match = run.steps.find((step) => step.tool === 'match_contact');
  assert.equal((match?.output as { decision: string }).decision, 'no_identity');
  db.close();
});

test('a similar name with a different phone is not matched', () => {
  const db = tempDb();
  const nate = runInquiryAgent(db, { text: 'Name: Nate Alvarez\nPhone: (305) 555-0148\nBudget: $650K', sourceKind: 'paste', now: NOW });
  const nathan = runInquiryAgent(db, { text: 'Name: Nathan Alvarez\nPhone: (305) 555-0190\nBudget: $700K', sourceKind: 'paste', now: NOW });
  assert.equal(nate.status, 'created');
  assert.equal(nathan.status, 'created');
  assert.notEqual(nate.contactId, nathan.contactId);
  const match = nathan.steps.find((step) => step.tool === 'match_contact');
  assert.equal((match?.output as { decision: string }).decision, 'create');
  assert.equal(count(db, 'contacts'), 2);
  db.close();
});

test('a name-only repeat is held and not merged', () => {
  const db = tempDb();
  intakeLead(db, { text: 'Name: Elena Cruz\nPhone: (305) 555-0133\nProperty: 10 Main St', sourceKind: 'paste', now: NOW });
  const run = runInquiryAgent(db, { text: 'Name: Elena Cruz\nProperty: a different house in Aventura', sourceKind: 'paste', now: NOW });
  assert.equal(run.status, 'possible_duplicate');
  assert.equal(run.agentStatus, 'held');
  assert.equal(run.contactId, null);
  assert.equal(count(db, 'contacts'), 1);
  const match = run.steps.find((step) => step.tool === 'match_contact');
  assert.equal((match?.output as { decision: string }).decision, 'hold_name_only');
  assert.match(run.steps.at(-1)?.decision ?? '', /Nothing was sent/);
  db.close();
});
