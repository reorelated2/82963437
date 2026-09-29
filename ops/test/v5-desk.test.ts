import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ingestCanonicalLead } from '../src/canonical.ts';
import { buildMorningBrief } from '../src/execution/brief.ts';
import { HOT7_FIXTURE_INSTANT, productionClock } from '../src/execution/clock.ts';
import { seedHot7 } from '../src/execution/hot7.ts';
import { applyManualMark } from '../src/execution/marks.ts';
import { easternDateKey, morningSections, planDesk, type DeskEvidence, type DeskFact } from '../src/execution/plan.ts';
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
  assert.equal(ava?.propertyAddress, '90 Sample St #308, Miami, FL');
  assert.equal(ava?.clientStage, 'TOURING');
  assert.equal(ava?.showingConflict, null);
  assert.equal(ava?.live, false);
  const noah = brief.cards.find((card) => card.clientName === 'Noah Fixture');
  assert.match(noah?.humanAction ?? '', /GET NOAH FIXTURE'S CELL/);
  assert.match(`${noah?.whyNow} ${noah?.agentToolsNote}`, /not verified CASH/);
  assert.equal(Number(db.get(`SELECT COUNT(*) AS n FROM sent_messages`)?.n), 0);
  db.close();
});

test('the active property is the latest tour, not the first discussed address', () => {
  const db = tempDb();
  const dir = mkdtempSync(join(tmpdir(), 'kyleos-live-'));
  const file = join(dir, 'master.json');
  writeFileSync(file, JSON.stringify({
    synthetic: true,
    leads: [{
      lead_id: 'echo-property',
      full_name: 'Echo Fixture',
      phone: '(305) 555-0142',
      email: 'echo.property@example.com',
      properties_discussed: [
        { address: '11 Sample St #2207, Miami, FL', status: 'Active' },
        { address: '90 Sample St #308, Miami', status: 'toured_or_scheduled', tour_id: 'tour-fixture-308' },
      ],
      appointments: [
        { date: '2026-09-20', time: '4:00 PM', status: 'scheduled', tour_id: 'tour-fixture-older', attending_agent: 'DATA NEEDED' },
        { date: '2026-09-27', time: '6:00 PM', status: 'scheduled_or_completed_Needs Verification', tour_id: 'tour-fixture-308', attending_agent: 'Larry Dix', type: 'tour' },
      ],
    }, {
      lead_id: 'two-properties',
      full_name: 'Two Property Fixture',
      phone: '(305) 555-0144',
      email: 'two.property@example.com',
      properties_discussed: [
        { address: '1 First St', status: 'Active' },
        { address: '2 Second St', status: 'Active' },
      ],
      appointments: [],
    }],
  }));
  const loaded = importLiveMaster(db, file, NOW);
  assert.equal(loaded.sent, false);
  const card = buildMorningBrief(db, NOW).cards.find((item) => item.clientName === 'Echo Fixture');
  assert.equal(card?.propertyAddress, '90 Sample St #308, Miami');
  assert.match(card?.clientDraft ?? '', /did you end up seeing 90 Sample St #308/);
  assert.equal(card?.showingLabel, 'POST TOUR VERIFICATION NEEDED');
  assert.doesNotMatch(`${card?.propertyAddress} ${card?.clientDraft}`, /11 Sample St/);
  assert.equal(card?.clientStage, 'TOURING');
  assert.match(card?.showingConflict ?? '', /SHOWING CONFLICT: 9\/20 and 9\/27/);
  const several = buildMorningBrief(db, NOW).cards.find((item) => item.clientName === 'Two Property Fixture');
  assert.equal(several?.propertyAddress, null);
  assert.match(several?.whyNow ?? '', /first one was not chosen/);
  assert.doesNotMatch(several?.clientDraft ?? '', /1 First St/);
  db.close();
});

test('the same calendar day written two ways is not a showing conflict', () => {
  const same = planDesk(evidence('Same Day', [
    verified('scheduled_tour_note', 'Scheduled tour 2026-09-27 6:00 PM with Larry Dix. Outcome not confirmed.'),
    verified('showing_detail_1', 'date=2026-09-27; time=6:00 PM; agent=Larry Dix; outcome=OUTCOME NOT CONFIRMED; class=THIRD PARTY REPORTED'),
    verified('showing_detail_slash', 'date=9/27; time=6 PM; agent=Larry Dix; outcome=OUTCOME NOT CONFIRMED; class=THIRD PARTY REPORTED'),
    verified('property_address', '90 Sample St #308'),
  ]));
  assert.equal(same.showingConflict, null);
  assert.doesNotMatch(same.whyNow, /SHOWING CONFLICT/);
  const different = planDesk(evidence('Two Days', [
    verified('showing_detail_a', 'date=9/20; time=4 PM; agent=DATA NEEDED; outcome=OUTCOME NOT CONFIRMED; class=THIRD PARTY REPORTED'),
    verified('showing_detail_b', 'date=2026-09-27; time=6:00 PM; agent=Larry Dix; outcome=OUTCOME NOT CONFIRMED; class=THIRD PARTY REPORTED'),
  ]));
  assert.match(different.showingConflict ?? '', /SHOWING CONFLICT: 9\/20 and 9\/27/);
  const times = planDesk(evidence('Two Times', [
    verified('showing_detail_a', 'date=2026-09-27; time=4:00 PM; agent=Larry Dix; outcome=OUTCOME NOT CONFIRMED; class=THIRD PARTY REPORTED'),
    verified('showing_detail_b', 'date=9/27; time=6:00 PM; agent=Larry Dix; outcome=OUTCOME NOT CONFIRMED; class=THIRD PARTY REPORTED'),
  ]));
  assert.match(times.showingConflict ?? '', /4 PM/);
  assert.match(times.showingConflict ?? '', /6 PM/);
});

test('needs verification is not a touring agent outcome', () => {
  const db = tempDb();
  const dir = mkdtempSync(join(tmpdir(), 'kyleos-live-'));
  const file = join(dir, 'master.json');
  writeFileSync(file, JSON.stringify({
    synthetic: true,
    leads: [{
      lead_id: 'needs-verify',
      full_name: 'Verify Fixture',
      phone: '(305) 555-0145',
      email: 'verify.fixture@example.com',
      properties_discussed: [
        { address: '11 Sample St #2207, Miami, FL', status: 'Active' },
        { address: '90 Sample St #308, Miami', status: 'toured_or_scheduled', tour_id: 'tour-fixture-308' },
      ],
      appointments: [{
        date: '2026-09-27',
        time: '6:00 PM',
        status: 'scheduled_or_completed_Needs Verification',
        tour_id: 'tour-fixture-308',
        attending_agent: 'Larry Dix',
        tour_outcome: '',
        type: 'tour',
      }],
    }],
  }));
  const loaded = importLiveMaster(db, file, NOW);
  assert.equal(loaded.sent, false);
  const card = buildMorningBrief(db, NOW).cards.find((item) => item.clientName === 'Verify Fixture');
  assert.ok(card);
  assert.equal(card.propertyAddress, '90 Sample St #308, Miami');
  assert.equal(card.showingState, 'OUTCOME_UNKNOWN');
  assert.equal(card.showingLabel, 'POST TOUR VERIFICATION NEEDED');
  assert.notEqual(card.internalCode, 'property_pivot');
  assert.match(card.clientDraft ?? '', /did you end up seeing 90 Sample St #308, Miami/);
  assert.doesNotMatch(card.clientDraft ?? '', /touring agent reported/);
  assert.equal(card.live, false);
  db.close();
});

test('a touring agent completion is a third party pivot, not an attendance question', () => {
  const db = tempDb();
  const dir = mkdtempSync(join(tmpdir(), 'kyleos-live-'));
  const file = join(dir, 'master.json');
  writeFileSync(file, JSON.stringify({
    synthetic: true,
    leads: [{
      lead_id: 'claudia-report',
      full_name: 'Claudia Fixture',
      phone: '(305) 555-0143',
      email: 'claudia.report@example.com',
      properties_discussed: [
        { address: '7207 Sample Dr #11, Miami Beach, FL', status: 'Active', tour_outcome: 'eliminated — CASH-ONLY' },
      ],
      appointments: [{
        date: '2026-09-28',
        time: '5:30 PM',
        status: 'completed',
        attending_agent: 'German Capodiferro',
        tour_outcome: 'Single Home — eliminated by client due to CASH-ONLY',
        follow_up_from_touring_agent: 'Send more homes',
        type: 'tour',
      }],
    }],
  }));
  const loaded = importLiveMaster(db, file, NOW);
  assert.equal(loaded.liveSend, false);
  assert.equal(loaded.sent, false);
  const card = buildMorningBrief(db, NOW).cards.find((item) => item.clientName === 'Claudia Fixture');
  assert.ok(card);
  assert.equal(card.showingState, 'OUTCOME_UNKNOWN');
  assert.notEqual(card.showingState, 'SHOWING_COMPLETED');
  assert.equal(card.showingLabel, 'THIRD PARTY REPORTED');
  assert.equal(card.clientStage, 'TOURING');
  assert.match(card.clientDraft ?? '', /passed on 7207 Sample Dr #11/);
  assert.match(card.clientDraft ?? '', /cash only/);
  assert.match(card.clientDraft ?? '', /financing/);
  assert.doesNotMatch(card.clientDraft ?? '', /did you end up seeing/);
  assert.equal(screenKyleVoice(card.clientDraft ?? '').allowed, true);
  assert.doesNotMatch(`${card.clientDraft} ${card.whyNow} ${card.agentToolsNote}`, /[—–]/);
  assert.match(card.whyNow, /third party/i);
  assert.match(card.showingLines.join('\n'), /THIRD PARTY REPORTED/);
  assert.equal(card.live, false);
  db.close();
});

test('a file with no tour stays NEW_INQUIRY', () => {
  const card = planDesk(evidence('New Buyer', [verified('property_address', '10 Sample St')]));
  assert.equal(card.clientStage, 'NEW_INQUIRY');
});

test('showings today is the clock date and later tours are upcoming', () => {
  const today = planDesk(evidence('Today Buyer', [
    verified('scheduled_tour_note', 'Scheduled tour 2026-09-29 6:00 PM with Kyle Kleinman'),
    verified('property_address', '10 Today St'),
  ]));
  const later = planDesk(evidence('Later Tour', [
    verified('scheduled_tour_note', 'Scheduled tour 2026-10-05 6:00 PM with Kyle Kleinman'),
    verified('property_address', '10 Later St'),
  ]));
  const past = planDesk(evidence('Past Tour', [
    verified('scheduled_tour_note', 'Scheduled tour 2026-09-20 4:00 PM with Larry Dix'),
    verified('property_address', '10 Past St'),
  ]));
  assert.equal(today.showingState, 'SHOWING_SCHEDULED');
  assert.equal(later.showingState, 'SHOWING_SCHEDULED');
  assert.equal(past.showingState, 'OUTCOME_UNKNOWN');
  assert.equal(easternDateKey(NOW), '2026-09-29');
  const sections = morningSections([today, later, past], NOW);
  const names = (label: string) => sections.header.find((bucket) => bucket.label === label)?.links.map((link) => link.name);
  assert.deepEqual(names('Showings today'), ['Today Buyer']);
  assert.deepEqual(names('Upcoming showings'), ['Later Tour']);
  assert.deepEqual(sections.summary.find((bucket) => bucket.label === 'SHOWINGS TODAY')?.links.map((link) => link.name), ['Today Buyer']);
  assert.deepEqual(sections.summary.find((bucket) => bucket.label === 'UPCOMING SHOWINGS')?.links.map((link) => link.name), ['Later Tour']);
});

test('tier 0 ranks above a higher score in tier 2', () => {
  const db = tempDb();
  ingestCanonicalLead(db, {
    idempotencyKey: 'tier-low',
    source: 'test',
    rawText: 'Future tour fixture.',
    now: NOW,
    displayName: 'Low Score Tier Zero',
    phone: '(305) 555-0161',
    email: 'low.tier@example.com',
    isDemo: true,
    facts: [
      { fieldKey: 'scheduled_tour_note', value: 'Scheduled tour 2026-10-05 6:00 PM with Kyle Kleinman', kind: 'fact', verification: 'verified', source: 'test' },
      { fieldKey: 'property_address', value: '10 Later St', kind: 'fact', verification: 'verified', source: 'test' },
    ],
  });
  ingestCanonicalLead(db, {
    idempotencyKey: 'tier-high',
    source: 'test',
    rawText: 'Saved search fixture.',
    now: NOW,
    displayName: 'High Score Tier Two',
    phone: '(305) 555-0162',
    email: 'high.tier@example.com',
    isDemo: true,
    facts: [
      { fieldKey: 'saved_search', value: 'Miami house', kind: 'fact', verification: 'verified', source: 'test' },
      { fieldKey: 'hot_score', value: '400', kind: 'fact', verification: 'verified', source: 'test' },
    ],
  });
  const brief = buildMorningBrief(db, NOW);
  const low = brief.cards.find((card) => card.clientName === 'Low Score Tier Zero');
  const high = brief.cards.find((card) => card.clientName === 'High Score Tier Two');
  assert.equal(low?.tier, 0);
  assert.equal(high?.tier, 2);
  assert.ok((low?.priority ?? 99) < (high?.priority ?? 0));
  assert.ok(brief.cards.findIndex((card) => card.clientName === 'Low Score Tier Zero') < brief.cards.findIndex((card) => card.clientName === 'High Score Tier Two'));
  ingestCanonicalLead(db, {
    idempotencyKey: 'tie-zed',
    source: 'test',
    rawText: 'Tied past tour.',
    now: NOW,
    displayName: 'Zed Tie',
    phone: '(305) 555-0163',
    email: 'zed.tie@example.com',
    isDemo: true,
    facts: [
      { fieldKey: 'scheduled_tour_note', value: 'Scheduled tour 2026-09-20 4:00 PM with Larry Dix', kind: 'fact', verification: 'verified', source: 'test' },
      { fieldKey: 'property_address', value: '10 Zed St', kind: 'fact', verification: 'verified', source: 'test' },
    ],
  });
  ingestCanonicalLead(db, {
    idempotencyKey: 'tie-amy',
    source: 'test',
    rawText: 'Tied past tour.',
    now: NOW,
    displayName: 'Amy Tie',
    phone: '(305) 555-0164',
    email: 'amy.tie@example.com',
    isDemo: true,
    facts: [
      { fieldKey: 'scheduled_tour_note', value: 'Scheduled tour 2026-09-20 4:00 PM with Larry Dix', kind: 'fact', verification: 'verified', source: 'test' },
      { fieldKey: 'property_address', value: '10 Amy St', kind: 'fact', verification: 'verified', source: 'test' },
    ],
  });
  const tied = buildMorningBrief(db, NOW);
  assert.ok(tied.cards.findIndex((card) => card.clientName === 'Amy Tie') < tied.cards.findIndex((card) => card.clientName === 'Zed Tie'));
  const hotDb = tempDb();
  const hot7 = seedHot7(hotDb, NOW);
  assert.deepEqual(hot7.cards.map((card) => card.clientName), [
    'Echo Niu',
    'Erena & Rick Valle',
    'Claudia Pinheiro',
    'Katherine De Armas',
    'Alberto Alonso',
    'Mark Maccagno',
    'Perry Crawford',
  ]);
  hotDb.close();
  db.close();
});
