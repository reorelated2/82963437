import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ingestCanonicalLead } from '../src/canonical.ts';
import { buildMorningBrief } from '../src/execution/brief.ts';
import { HOT7_FIXTURE_INSTANT, productionClock } from '../src/execution/clock.ts';
import { seedHot7 } from '../src/execution/hot7.ts';
import { applyManualMark } from '../src/execution/marks.ts';
import { planDesk, type DeskEvidence, type DeskFact } from '../src/execution/plan.ts';
import { SHOWING_STATES } from '../src/execution/showing.ts';
import { importLiveMaster } from '../src/ingest/liveMaster.ts';
import { openDatabase } from '../src/db.ts';
import { loadPromptPack } from '../src/prompts/registry.ts';
import { screenKyleVoice } from '../src/conversion/policy.ts';
import { text } from '../src/sql.ts';

const NOW = new Date(HOT7_FIXTURE_INSTANT);

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'kyleos-v5-'));
  return openDatabase(join(dir, 'desk.sqlite'));
}

function verified(field: string, value: string): DeskFact {
  return { field, value, kind: 'fact', verification: 'verified' };
}

function evidence(name: string, facts: DeskFact[], phone: string | null = '3055550100'): DeskEvidence {
  return {
    name,
    stage: 'NEW_INQUIRY',
    phone,
    email: 'buyer.fixture@example.com',
    dnc: false,
    facts,
    now: NOW,
  };
}

test('production clock is Eastern wall time and the Hot 7 clock stays injected', () => {
  const db = tempDb();
  const live = buildMorningBrief(db);
  assert.equal(live.clock.source, 'production');
  assert.equal(live.clock.zone, 'America/New_York');
  assert.ok(Math.abs(Date.now() - Date.parse(live.clock.instant)) < 5_000);
  assert.equal(productionClock().source, 'production');
  const fixture = seedHot7(db, NOW);
  assert.equal(fixture.clock.source, 'injected');
  assert.equal(fixture.clock.instant, HOT7_FIXTURE_INSTANT);
  assert.match(fixture.text, /Clock: injected \/ America\/New_York/);
  assert.equal(fixture.cards[0]?.clientName, 'Echo Niu');
  assert.equal(fixture.cards[0]?.tier, 0);
  assert.equal(fixture.cards[0]?.showingLabel, 'POST TOUR VERIFICATION NEEDED');
  assert.equal(fixture.cards[0]?.actionVerb, 'TEXT CLIENT');
  assert.match(fixture.cards[0]?.executionAdapter ?? '', /COPY → OPEN MESSAGES → PASTE → SEND/);
  assert.equal(fixture.cards[0]?.live, false);
  assert.doesNotMatch(fixture.cards[0]?.showingLines.join('\n') ?? '', /\bupcoming\b/i);
  db.close();
});

test('SHOWING_SCHEDULED is a real state and a future tour is not upcoming', () => {
  assert.ok(SHOWING_STATES.includes('SHOWING_SCHEDULED'));
  const card = planDesk(evidence('Future Buyer', [
    verified('scheduled_tour_note', 'Scheduled tour 2026-09-29 6:00 PM with Kyle Kleinman'),
    verified('property_address', '10 Sample St'),
  ]));
  assert.equal(card.showingState, 'SHOWING_SCHEDULED');
  assert.equal(card.showingLabel, 'SCHEDULED');
  assert.doesNotMatch(`${card.humanAction} ${card.showingLabel}`, /\bupcoming\b/i);
  assert.notEqual(card.showingState, 'SHOWING_COMPLETED');
});

test('a past scheduled tour is post tour verification and a two hour deadline outranks a later one', () => {
  const past = planDesk(evidence('Past Buyer', [
    verified('scheduled_tour_note', 'Upcoming tour agent scheduled Sep 20'),
    verified('property_address', '90 SW 3rd St #308'),
  ]));
  assert.equal(past.showingState, 'OUTCOME_UNKNOWN');
  assert.match(past.humanAction, /POST TOUR VERIFICATION NEEDED/);
  assert.doesNotMatch(past.showingLines.join('\n'), /\bupcoming\b/i);
  assert.notEqual(past.showingState, 'SHOWING_COMPLETED');
  const soon = planDesk(evidence('Soon Buyer', [
    verified('property_address', '1 Main St'),
    verified('action_due_at', new Date(NOW.getTime() + 60 * 60 * 1000).toISOString()),
  ]));
  const later = planDesk(evidence('Later Buyer', [
    verified('property_address', '1 Main St'),
    verified('action_due_at', new Date(NOW.getTime() + 96 * 60 * 60 * 1000).toISOString()),
  ]));
  assert.ok(soon.priority > later.priority);
});

test('a promise outranks a passive tour and waiting suppresses a second text', () => {
  const card = planDesk(evidence('Promise Buyer', [
    verified('promise_open', 'yes'),
    verified('kyle_promise', 'Send the Sunday access answer'),
    verified('scheduled_tour_note', 'Scheduled tour 2026-09-20 4:00 PM'),
  ]));
  assert.match(card.humanAction, /DO THE PROMISE/);
  assert.equal(card.tier, 0);
  assert.equal(card.clientDraft, null);
  const waiting = planDesk(evidence('Waiting Buyer', [
    verified('waiting_active', 'yes'),
    verified('waiting_party', 'CLIENT'),
    verified('waiting_end', 'They reply about Sunday'),
    verified('scheduled_tour_note', 'Scheduled tour 2026-09-20 4:00 PM'),
  ]));
  assert.match(waiting.humanAction, /WAITING ON CLIENT/);
  assert.equal(waiting.clientDraft, null);
  assert.equal(waiting.tier, 2);
});

test('mark sent is Kyle authority, not a provider send, and the desk reranks', () => {
  const db = tempDb();
  const first = seedHot7(db, NOW);
  const echo = first.cards.find((card) => card.clientName === 'Echo Niu');
  assert.ok(echo?.opportunityId);
  assert.equal(first.cards[0]?.clientName, 'Echo Niu');
  const marked = applyManualMark(db, { opportunityId: echo.opportunityId, mark: 'sent_manually', now: NOW });
  assert.equal(marked.applied, true);
  assert.equal(marked.sent, false);
  assert.equal(marked.live, false);
  assert.equal(marked.writtenToAgentTools, false);
  assert.equal(marked.executionAuthority, 'marked_by_kyle');
  assert.equal(marked.verifiedByIntegration, false);
  assert.equal(marked.rerank, true);
  const again = buildMorningBrief(db, NOW);
  const echoAgain = again.cards.find((card) => card.clientName === 'Echo Niu');
  assert.match(echoAgain?.humanAction ?? '', /WAITING ON CLIENT/);
  assert.notEqual(again.cards[0]?.clientName, 'Echo Niu');
  assert.equal(Number(db.get(`SELECT COUNT(*) AS n FROM sent_messages`)?.n), 0);
  const authority = text(db.get(`SELECT execution_authority FROM execution_marks LIMIT 1`), 'execution_authority');
  assert.equal(authority, 'marked_by_kyle');
  assert.equal(Number(db.get(`SELECT COUNT(*) AS n FROM execution_marks WHERE execution_authority = 'verified_by_integration'`)?.n), 0);
  const showed = applyManualMark(db, { opportunityId: echo.opportunityId, mark: 'showing_occurred', now: new Date(NOW.getTime() + 1000) });
  assert.equal(showed.verifiedByIntegration, false);
  const after = buildMorningBrief(db, new Date(NOW.getTime() + 2000));
  const echoAfter = after.cards.find((card) => card.clientName === 'Echo Niu');
  assert.equal(echoAfter?.showingState, 'SHOWING_COMPLETED');
  assert.doesNotMatch(echoAfter?.humanAction ?? '', /POST TOUR VERIFICATION NEEDED/);
  db.close();
});

test('a shell opportunity with no plan is workflow drift', () => {
  const db = tempDb();
  const ingested = ingestCanonicalLead(db, {
    idempotencyKey: 'drift-1',
    source: 'test',
    rawText: 'Ava Fixture asked about 10 Sample St.',
    now: NOW,
    displayName: 'Drift Fixture',
    phone: '3055550188',
    email: 'drift.fixture@example.com',
    isDemo: true,
  });
  assert.ok(ingested.opportunityId);
  const brief = buildMorningBrief(db, NOW);
  const card = brief.cards.find((item) => item.clientName === 'Drift Fixture');
  assert.equal(card?.workflowDrift, true);
  assert.match(card?.humanAction ?? '', /WORKFLOW DRIFT/);
  db.close();
});

test('prompt modules are versioned and Kyle voice still rejects an em dash', () => {
  const pack = loadPromptPack();
  assert.equal(pack.version, '2026-09-29.1');
  assert.equal(pack.modules.length, 16);
  const voice = pack.modules.find((item) => item.name === 'kyle-voice');
  assert.match(voice?.body ?? '', /No em dashes/);
  assert.match(voice?.body ?? '', /touching base/);
  const safety = pack.modules.find((item) => item.name === 'execution-safety');
  assert.match(safety?.body ?? '', /DRY_RUN/);
  assert.match(safety?.body ?? '', /MARKED BY KYLE/);
  assert.equal(screenKyleVoice('Echo, did you end up seeing it?').allowed, true);
  assert.equal(screenKyleVoice('Just checking in — Sunday?').allowed, false);
});

test('synthetic live master import does not send and ranks the past tour', () => {
  const db = tempDb();
  const file = join(import.meta.dirname, '../fixtures/live-master.sample.json');
  const loaded = importLiveMaster(db, file, NOW);
  assert.equal(loaded.applied, true);
  assert.equal(loaded.liveSend, false);
  assert.equal(loaded.sent, false);
  assert.equal(loaded.created, 2);
  const brief = buildMorningBrief(db, NOW);
  const ava = brief.cards.find((card) => card.clientName === 'Ava Fixture');
  assert.equal(ava?.showingState, 'OUTCOME_UNKNOWN');
  assert.match(ava?.humanAction ?? '', /POST TOUR VERIFICATION NEEDED/);
  assert.equal(ava?.live, false);
  const noah = brief.cards.find((card) => card.clientName === 'Noah Fixture');
  assert.match(noah?.humanAction ?? '', /GET NOAH FIXTURE'S CELL/);
  assert.match(`${noah?.whyNow} ${noah?.agentToolsNote}`, /not verified CASH/);
  assert.equal(Number(db.get(`SELECT COUNT(*) AS n FROM sent_messages`)?.n), 0);
  db.close();
});
