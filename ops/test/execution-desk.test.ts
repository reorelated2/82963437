import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { writeClientFact } from '../src/canonical.ts';
import { FINANCING_STATES, screenKyleVoice } from '../src/conversion/policy.ts';
import { nextBestAction, openBuyerFile } from '../src/conversion/engine.ts';
import { ingestCanonicalLead } from '../src/canonical.ts';
import { buildMorningBrief } from '../src/execution/brief.ts';
import { seedHot7 } from '../src/execution/hot7.ts';
import { loadCanonicalStagingBuyer } from '../src/ingest/agentTools.ts';
import { applyManualMark } from '../src/execution/marks.ts';
import { EVAL_SCENARIOS } from '../src/execution/eval.ts';
import { planDesk, type DeskEvidence, type DeskFact } from '../src/execution/plan.ts';
import { PROMPT_MODULE_VERSION } from '../src/execution/prompts.ts';
import { easternClock } from '../src/time.ts';
import { recordLeadSource } from '../src/execution/source.ts';
import { recordShowingTransition, showingHistory, SHOWING_STATES } from '../src/execution/showing.ts';
import { openDatabase } from '../src/db.ts';
import { text } from '../src/sql.ts';

const NOW = new Date('2026-09-29T13:00:00.000Z');

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'kyleos-exec-'));
  return openDatabase(join(dir, 'desk.sqlite'));
}

function evidence(partial: Partial<DeskEvidence> & { name: string; facts?: DeskFact[] }): DeskEvidence {
  return {
    name: partial.name,
    stage: partial.stage ?? 'NEW_INQUIRY',
    phone: partial.phone === undefined ? '3055550100' : partial.phone,
    email: partial.email === undefined ? 'buyer.fixture@example.com' : partial.email,
    dnc: partial.dnc ?? false,
    facts: partial.facts ?? [],
    now: NOW,
  };
}

function verified(field: string, value: string): DeskFact {
  return { field, value, kind: 'fact', verification: 'verified' };
}

test('financing enum keeps the old states and adds the lender gap states', () => {
  for (const state of ['UNKNOWN', 'CASH', 'INTRODUCED', 'PREAPPROVED', 'FINANCING_READY', 'NEEDS_PREAPPROVAL', 'FINANCING_UNKNOWN_STATUS', 'LENDER_INTRO_OFFERED', 'LENDER_INTRO_ACCEPTED', 'PREAPPROVAL_IN_PROCESS', 'FINANCING_ISSUE']) {
    assert.ok(FINANCING_STATES.includes(state as typeof FINANCING_STATES[number]), state);
  }
});

test('Agent Tools month dates Sep 20 and Sep 15 are outcome unknown', () => {
  const db = tempDb();
  for (const [name, phone, note] of [
    ['Echo Niu', '3055552101', '0 tours Sep 20 - Upcoming tour agent scheduled with Kyle Kleinman'],
    ['Erena Valle', '3055552102', '1 tours Sep 15 - Tour agent scheduled with Marcos Peon'],
  ] as const) {
    const created = ingestCanonicalLead(db, {
      idempotencyKey: `month-${phone}`,
      source: 'webhook',
      rawText: `Name: ${name}\nPhone: ${phone}`,
      displayName: name,
      phone,
      now: NOW,
    });
    assert.ok(created.clientId);
    assert.ok(created.opportunityId);
    openBuyerFile(db, { opportunityId: created.opportunityId, now: NOW });
    writeClientFact(db, {
      clientId: created.clientId,
      opportunityId: created.opportunityId,
      now: NOW,
      fact: {
        fieldKey: 'buying_activity',
        value: note,
        kind: 'fact',
        verification: 'verified',
        source: 'synthetic',
      },
    });
    const action = nextBestAction(db, created.opportunityId, NOW);
    assert.equal(action.action_type, 'tour_follow_up', name);
    assert.equal(action.priority_score, 86, name);
    assert.notEqual(action.action_type, 'confirm_tour_details', name);
    assert.match(action.reason, /outcome is unknown/i, name);
    const tour = db.get(`SELECT state FROM readiness_flags WHERE opportunity_id = ? AND flag = 'tour'`, created.opportunityId);
    assert.equal(text(tour, 'state'), 'outcome_unknown', name);
  }
  db.close();
});

test('a past scheduled tour is outcome unknown and not a current upcoming tour', () => {
  const db = tempDb();
  const created = ingestCanonicalLead(db, {
    idempotencyKey: 'stale-tour',
    source: 'webhook',
    rawText: 'Name: Fixture Past\nPhone: 3055552199',
    displayName: 'Fixture Past',
    phone: '3055552199',
    now: NOW,
  });
  assert.ok(created.clientId);
  assert.ok(created.opportunityId);
  openBuyerFile(db, { opportunityId: created.opportunityId, now: NOW });
  writeClientFact(db, {
    clientId: created.clientId,
    opportunityId: created.opportunityId,
    now: NOW,
    fact: {
      fieldKey: 'scheduled_tour_note',
      value: '2026-09-20 upcoming tour agent scheduled. No completed tour is on file.',
      kind: 'fact',
      verification: 'verified',
      source: 'synthetic',
    },
  });
  const action = nextBestAction(db, created.opportunityId, NOW);
  assert.equal(action.action_type, 'tour_follow_up');
  assert.equal(action.live, false);
  assert.match(action.reason, /outcome is unknown/i);
  const tour = db.get(`SELECT state, evidence FROM readiness_flags WHERE opportunity_id = ? AND flag = 'tour'`, created.opportunityId);
  assert.equal(text(tour, 'state'), 'outcome_unknown');
  assert.match(text(tour, 'evidence'), /OUTCOME UNKNOWN/);
  assert.equal(text(db.get(`SELECT primary_stage FROM opportunities WHERE id = ?`, created.opportunityId), 'primary_stage'), 'NEW_INQUIRY');
  db.close();
});

test('lead source history keeps the original and records the ingest system', () => {
  const db = tempDb();
  const created = ingestCanonicalLead(db, {
    idempotencyKey: 'source-history',
    source: 'webhook',
    rawText: 'Name: Fixture Source\nPhone: 3055552198',
    displayName: 'Fixture Source',
    phone: '3055552198',
    now: NOW,
  });
  const first = recordLeadSource(db, {
    clientId: created.clientId ?? '',
    opportunityId: created.opportunityId ?? '',
    sourceSystem: 'gmail',
    leadSource: 'Redfin',
    sourceIdentifier: 'gmail-1',
    now: NOW,
  });
  assert.equal(first.originalLeadSource, 'Redfin');
  assert.equal(first.conflict, false);
  const second = recordLeadSource(db, {
    clientId: created.clientId ?? '',
    opportunityId: created.opportunityId ?? '',
    sourceSystem: 'redfin_agent_tools',
    leadSource: 'Rocket',
    sourceIdentifier: 'at-1',
    now: NOW,
  });
  assert.equal(second.conflict, true);
  assert.equal(second.originalLeadSource, 'Redfin');
  assert.equal(text(db.get(`SELECT source_system FROM opportunities WHERE id = ?`, created.opportunityId), 'source_system'), 'redfin_agent_tools');
  assert.equal(Number(db.get(`SELECT COUNT(*) AS n FROM lead_source_history`)?.n), 2);
  db.close();
});

test('kyle voice lint rejects banned phrases and em dashes', () => {
  assert.equal(screenKyleVoice('Echo, did you end up seeing the place?').allowed, true);
  assert.equal(screenKyleVoice('Just checking in on the tour.').allowed, false);
  assert.equal(screenKyleVoice('I wanted to follow up — does Monday work?').allowed, false);
  assert.match(screenKyleVoice('This is a unique opportunity.').reason, /unique opportunity/);
});

const section49: Array<{ name: string; facts: DeskFact[]; phone?: string | null; dnc?: boolean; includes: RegExp }> = [
    { name: 'new buyer requests one property', facts: [verified('property_address', '10 Fixture St')], includes: /checking on 10 Fixture St/ },
    { name: 'same property requested twice', facts: [verified('property_address', '10 Fixture St'), verified('repeat_property_request', 'prior request 2026-09-01')], includes: /checking on 10 Fixture St/ },
    { name: 'showing requested but listing side not confirmed', facts: [verified('showing_requested', 'yes'), verified('property_address', '10 Fixture St')], includes: /CUSTOMER_REQUESTED|checking on/ },
    { name: 'showing scheduled in past with unknown outcome', facts: [verified('scheduled_tour_note', '2026-09-27 6:00 PM upcoming tour agent scheduled'), verified('property_address', '90 SW 3rd St #308')], includes: /OUTCOME UNKNOWN/ },
    { name: 'showing completed by Associate Agent', facts: [{ field: 'associate_tour', value: 'completed by associate agent German', kind: 'inference', verification: 'unverified' }], includes: /NOT CONFIRMED/ },
    { name: 'buyer asks Kyle to call', facts: [verified('customer_asked', 'please call me')], includes: /CALL / },
    { name: 'property becomes pending', facts: [verified('property_status', 'Pending'), verified('property_address', '10 Fixture St')], includes: /went pending/ },
    { name: 'buyer says cash', facts: [verified('cash_vs_finance', 'cash'), verified('property_address', '10 Fixture St')], includes: /cash purchase/ },
    { name: 'financing without preapproval', facts: [verified('financing_state', 'NEEDS_PREAPPROVAL')], includes: /finance it or buy cash/ },
    { name: 'buyer has preapproval', facts: [verified('financing_state', 'PREAPPROVED'), verified('property_address', '10 Fixture St')], includes: /preapproval on file/ },
    { name: 'owns home but no need to sell', facts: [verified('owns_home', 'yes'), verified('sale_dependency', 'homeowner_no_sale'), verified('property_address', '10 Fixture St')], includes: /checking on 10 Fixture St/ },
    { name: 'must sell first', facts: [verified('sale_dependency', 'sale_required')], includes: /sell before you can buy/ },
    { name: 'needs sale proceeds', facts: [verified('sale_dependency', 'proceeds_required')], includes: /proceeds/ },
    { name: 'buyer and spouse are decision makers', facts: [verified('decision_makers', 'spouse'), verified('property_address', '10 Fixture St')], includes: /Decision makers are already on file/ },
    { name: 'buyer has no verified cell', facts: [], phone: null, includes: /GET .* CELL/ },
    { name: 'customer opted out', facts: [], dnc: true, includes: /DO NOT CONTACT/ },
    { name: 'customer says stop contacting', facts: [verified('contact_preference', 'stop contacting me')], includes: /DO NOT CONTACT/ },
    { name: 'offer drafted not submitted', facts: [verified('offer_state', 'draft')], includes: /has not been submitted|MISSING/ },
    { name: 'offer submitted with provider confirmation', facts: [verified('offer_state', 'submitted')], includes: /SUBMITTED/ },
    { name: 'buyer open to nearby properties', facts: [verified('area_flexibility', 'nearby'), verified('property_address', '10 Fixture St')], includes: /nearby works/ },
    { name: 'listing agent phone missing', facts: [verified('listing_agent_contact', 'missing'), verified('property_address', '10 Fixture St')], includes: /LISTING AGENT CONTACT NEEDED/ },
    { name: 'listing agent contact found', facts: [verified('listing_agent_name', 'Maria Rodriguez'), verified('listing_agent_phone', '3055550199'), verified('property_address', '10 Fixture St')], includes: /Do not contact them yet/ },
    { name: 'unsent Gmail draft exists', facts: [{ field: 'gmail_draft', value: 'draft only', kind: 'inference', verification: 'unverified' }, verified('property_address', '10 Fixture St')], includes: /not prior contact/ },
    { name: 'coordinator contacted customer but Kyle did not', facts: [{ field: 'coordinator_contact', value: 'coordinator texted the customer', kind: 'inference', verification: 'unverified' }], includes: /NOT CONFIRMED/ },
    { name: 'client reply changes next qualification question', facts: [verified('answered', 'motivation'), verified('property_address', '10 Fixture St')], includes: /open nearby/ },
    { name: 'detailed analytical question receives detailed answer', facts: [verified('detailed_question', 'taxes and HOA'), verified('property_address', '10 Fixture St')], includes: /facts on file/ },
    { name: 'investor asks for cash flow property', facts: [{ field: 'investor_strategy', value: 'cash flow', kind: 'inference', verification: 'unverified' }], includes: /won't guess the numbers/ },
    { name: 'buyer changes area criteria', facts: [verified('area_change', 'Miami Shores')], includes: /Miami Shores/ },
    { name: 'search criteria with hard and soft preferences', facts: [verified('search_hard', 'North Miami, SFH, 3 bed'), verified('search_soft', 'pool')], includes: /DO NOT FILTER OUT YET/ },
    { name: 'buyer wants to make an offer', facts: [verified('wants_offer', 'yes')], includes: /MISSING/ },
    { name: 'offer price known but material terms missing', facts: [verified('offer_price', '500000'), verified('missing_terms', 'deposit')], includes: /Do not submit/ },
    { name: 'offer accepted', facts: [verified('offer_state', 'accepted')], includes: /not closed/ },
    { name: 'effective date verified', facts: [verified('effective_date', '2026-10-01')], includes: /EFFECTIVE DATE VERIFIED/ },
    { name: 'inspection deadline verified', facts: [verified('inspection_deadline', '2026-10-10')], includes: /Deadline verified/ },
    { name: 'inspection status unknown', facts: [verified('inspection_status', 'unknown')], includes: /not scheduled/ },
    { name: 'loan not clear to close', facts: [verified('loan_status', 'not_clear_to_close')], includes: /NOT CLEAR TO CLOSE/ },
    { name: 'final walkthrough scheduled not completed', facts: [verified('walkthrough', 'scheduled')], includes: /not completed/ },
    { name: 'transaction closes', facts: [verified('transaction_status', 'closed')], includes: /TRANSACTION CLOSED/ },
    { name: 'buyer ownership creates potential listing opportunity', facts: [verified('owns_home', 'yes'), verified('property_address', '10 Fixture St')], includes: /LISTING OPPORTUNITY/ },
    { name: 'referral source requires status update', facts: [verified('referral_update', 'due')], includes: /Do not invent a conversation/ },
    { name: 'calendar conflict exists', facts: [verified('calendar_conflict', 'yes')], includes: /CALENDAR CONFLICT/ },
    { name: 'seller/listing side compensation unknown', facts: [verified('compensation', 'unknown')], includes: /COMPENSATION NEEDS VERIFICATION/ },
    { name: 'buyer agreement compensation known', facts: [verified('buyer_agreement_compensation', '2.5 percent buyer side')], includes: /2.5 percent/ },
    { name: 'system can send email but approval not given', facts: [verified('email_send_capability', 'yes'), verified('property_address', '10 Fixture St')], includes: /was not sent/ },
    { name: 'long-term lead with future timeline', facts: [verified('timeline', 'future')], includes: /Not offer ready/ },
    { name: 'property sources conflict', facts: [verified('property_conflict', 'MLS Active, Redfin Pending')], includes: /DATA CONFLICT/ },
    { name: 'property data is stale', facts: [verified('property_stale', 'yes'), verified('property_status', 'Active')], includes: /OLD DATA/ },
    { name: 'primary buyer asks for good schools', facts: [verified('schools_question', 'good schools')], includes: /can't rank neighborhoods/ },
    { name: 'investor requests STR and legality unknown', facts: [{ field: 'investor_strategy', value: 'STR', kind: 'inference', verification: 'unverified' }], includes: /won't guess the numbers/ },
    { name: 'short client reply receives short Kyle reply', facts: [verified('reply', 'ok')], includes: /Got it/ },
    { name: 'CMA reminder exists', facts: [verified('cma_due', '2026-09-28')], includes: /CMA NEEDED/ },
    { name: 'customer prefers Spanish', facts: [verified('language', 'es'), verified('property_address', '10 Fixture St')], includes: /soy Kyle con Redfin/ },
    { name: 'customer prefers phone', facts: [verified('preferred_channel', 'phone')], includes: /CALL / },
  ];
for (const item of section49) {
  test(`section 49: ${item.name}`, () => {
    const card = planDesk(evidence({ name: item.name, facts: item.facts, phone: item.phone, dnc: item.dnc }));
    const blob = `${card.humanAction}\n${card.clientDraft ?? ''}\n${card.callOpening ?? ''}\n${card.showingState}`;
    assert.match(blob, item.includes, item.name);
    assert.equal(card.live, false, item.name);
    assert.equal(card.manualActionRequired, true, item.name);
    if (card.clientDraft) assert.equal(screenKyleVoice(card.clientDraft).allowed, true, item.name);
    if (card.callOpening) assert.equal(screenKyleVoice(card.callOpening).allowed, true, item.name);
    assert.notEqual(card.showingState, 'SHOWING_COMPLETED', item.name);
    if (item.name === 'showing scheduled in past with unknown outcome') assert.doesNotMatch(card.humanAction, /confirm_tour_details/);
    if (item.name === 'offer drafted not submitted') assert.match(card.humanAction, /MISSING|draft/i);
    if (item.name === 'showing completed by Associate Agent' || item.name === 'coordinator contacted customer but Kyle did not') assert.equal(card.showingState, 'OUTCOME_UNKNOWN');
    if (item.name === 'showing requested but listing side not confirmed') assert.equal(card.showingState, 'CUSTOMER_REQUESTED');
    if (item.name === 'final walkthrough scheduled not completed') assert.notEqual(card.customerPropertyState, 'Completed');
    if (item.name === 'unsent Gmail draft exists') assert.doesNotMatch(blob, /EMAIL SENT|as I emailed/);
    if (item.name === 'owns home but no need to sell') assert.doesNotMatch(card.humanAction, /LISTING OPPORTUNITY|CMA NEEDED/);
    if (item.name === 'buyer ownership creates potential listing opportunity') assert.equal(card.internalCode, 'listing_opportunity');
    if (item.name === 'system can send email but approval not given') assert.equal(card.approvalRequired, true);
    if (item.name === 'search criteria with hard and soft preferences') {
      assert.match(card.humanAction, /REQUIRED: North Miami, SFH, 3 bed/);
      assert.match(card.humanAction, /PREFERRED: pool/);
      assert.equal(card.searchPlan.mode, 'create');
    }
    if (item.name === 'effective date verified') {
      const milestone = card.milestones.find((row) => row.name === 'EFFECTIVE DATE VERIFIED');
      assert.equal(milestone?.status, '2026-10-01');
      assert.equal(milestone?.deadline, '2026-10-01');
      assert.equal(milestone?.owner, 'Kyle');
      assert.equal(milestone?.source, 'effective_date');
      assert.match(milestone?.nextAction ?? '', /Do not compute/);
      assert.ok(card.milestones.filter((row) => row.name !== 'EFFECTIVE DATE VERIFIED').every((row) => row.deadline === 'HUMAN REVIEW REQUIRED'));
    }
    assert.doesNotMatch(card.humanAction, /TEXT SENT|EMAIL SENT|CALL COMPLETED|AGENT TOOLS UPDATED/);
    assert.equal(card.live, false);
  });
}

test('section 49: lead source conflicts between systems', () => {
  const conflict = planDesk(evidence({
    name: 'Source Conflict',
    facts: [
      verified('lead_source', 'Redfin'),
      { field: 'lead_source_conflict', value: 'later system said Rocket', kind: 'fact', verification: 'verified' },
    ],
  }));
  assert.equal(conflict.sourceConflict, true);
  assert.equal(conflict.leadSource, 'Redfin');
  assert.equal(conflict.live, false);
});

test('section 49: same customer via multiple sources', () => {
  const card = planDesk(evidence({
    name: 'Multi Source',
    facts: [
      verified('lead_source', 'Redfin'),
      { field: 'lead_source_history', value: 'gmail: Redfin', kind: 'fact', verification: 'verified' },
      { field: 'lead_source_conflict', value: 'later system said Rocket', kind: 'fact', verification: 'verified' },
    ],
  }));
  assert.equal(card.leadSource, 'Redfin');
  assert.equal(card.sourceConflict, true);
  assert.equal(card.live, false);
});

test('section 49: Agent Tools says upcoming but date passed', () => {
  const card = planDesk(evidence({
    name: 'Stale Upcoming',
    facts: [verified('buying_activity', '0 tours Sep 20 - Upcoming tour agent scheduled with Kyle Kleinman'), verified('property_address', '90 SW 3rd St #308')],
  }));
  assert.match(card.humanAction, /OUTCOME UNKNOWN/);
  assert.doesNotMatch(card.humanAction, /confirm_tour_details/);
  assert.equal(card.showingState, 'OUTCOME_UNKNOWN');
});

test('section 49: system can draft SMS but cannot send', () => {
  const card = planDesk(evidence({ name: 'Draft Only', facts: [verified('property_address', '10 Fixture St')] }));
  assert.ok(card.clientDraft);
  assert.equal(card.live, false);
  assert.equal(card.approvalRequired, true);
  assert.doesNotMatch(card.humanAction, /TEXT SENT/);
});

test('showing detail keeps every tour line and leaves a missing field as DATA NEEDED', () => {
  const card = planDesk(evidence({
    name: 'Two Tours',
    facts: [
      verified('buying_activity', '0 tours Sep 20 - Upcoming tour agent scheduled with Kyle Kleinman'),
      { field: 'showing_detail', value: 'date=9/27; time=6 PM; agent=Larry Dix; outcome=OUTCOME NOT CONFIRMED; class=THIRD PARTY REPORTED', kind: 'fact', verification: 'unverified' },
      { field: 'showing_detail', value: 'date=9/20; time=4 PM; agent=DATA NEEDED; outcome=OUTCOME NOT CONFIRMED; class=THIRD PARTY REPORTED', kind: 'fact', verification: 'unverified' },
    ],
  }));
  assert.ok(card.showingLines.some((line) => line.startsWith('9/27 6 PM Larry Dix showing, OUTCOME NOT CONFIRMED. Evidence: THIRD PARTY REPORTED.')));
  assert.ok(card.showingLines.some((line) => line.startsWith('9/20 DATA NEEDED Kyle Kleinman showing, OUTCOME NOT CONFIRMED. Evidence: THIRD PARTY REPORTED.')));
  assert.ok(card.showingLines.some((line) => line.startsWith('9/20 4 PM DATA NEEDED showing, OUTCOME NOT CONFIRMED. Evidence: THIRD PARTY REPORTED.')));
  assert.match(card.showingLines.join('\n'), /TOUR 9\/20, outcome not confirmed. Possible duplicate/);
  assert.match(card.showingLines.join('\n'), /TOUR 9\/27, outcome not confirmed/);
  assert.equal(card.showingConflict, null);
  assert.doesNotMatch(`${card.whyNow}\n${card.showingLines.join('\n')}`, /SHOWING CONFLICT|upcoming/i);
  assert.equal(card.showingState, 'OUTCOME_UNKNOWN');
  assert.doesNotMatch(`${card.clientDraft}`, /Larry Dix|9\/27/);
  const quiet = planDesk(evidence({ name: 'No Tour', facts: [verified('property_address', '10 Fixture St')] }));
  assert.deepEqual(quiet.showingLines, []);
  assert.equal(quiet.showingConflict, null);
});

test('showing state machine stores every section 13 state as its own transition', () => {
  const db = tempDb();
  const opportunityId = 'opp-showing-states';
  SHOWING_STATES.forEach((state, index) => {
    const stored = recordShowingTransition(db, {
      opportunityId,
      state,
      source: 'test',
      evidence: state,
      now: new Date(NOW.getTime() + index * 1000),
    });
    assert.equal(stored.stored, true, state);
  });
  assert.deepEqual(showingHistory(db, opportunityId), [...SHOWING_STATES]);
  const repeat = recordShowingTransition(db, {
    opportunityId,
    state: 'OUTCOME_UNKNOWN',
    source: 'test',
    evidence: 'same state again',
    now: new Date(NOW.getTime() + 60_000),
  });
  assert.equal(repeat.stored, false);
  assert.throws(() => recordShowingTransition(db, {
    opportunityId,
    state: 'CONFIRMED',
    source: 'test',
    evidence: 'not a state',
    now: NOW,
  }), /Unknown showing state/);
  db.close();
});

test('hot 7 brief is generated with seven human cards and no sends', () => {
  const db = tempDb();
  const brief = seedHot7(db, NOW);
  assert.equal(brief.generated, true);
  assert.equal(brief.live, false);
  assert.equal(brief.cards.length, 7);
  const names = brief.cards.map((card) => card.clientName).sort();
  assert.deepEqual(names, ['Alberto Alonso', 'Claudia Pinheiro', 'Echo Niu', 'Erena & Rick Valle', 'Katherine De Armas', 'Mark Maccagno', 'Perry Crawford']);
  for (const card of brief.cards) {
    assert.equal(card.live, false);
    assert.doesNotMatch(card.humanAction, /confirm_tour_details|ask_next_question|tour_follow_up/);
    assert.ok(card.links.every((link) => link.status === 'LINK NOT FOUND'));
    if (card.clientDraft) assert.equal(screenKyleVoice(card.clientDraft).allowed, true, card.clientName);
  }
  const echo = brief.cards.find((card) => card.clientName === 'Echo Niu');
  assert.ok(echo);
  assert.match(echo.humanAction, /OUTCOME UNKNOWN/);
  assert.match(echo.clientDraft ?? '', /did you end up seeing/);
  assert.doesNotMatch(`${echo.clientDraft} ${echo.humanAction}`, /already happened|SHOWING_COMPLETED|TEXT SENT/);
  assert.match(echo.agentToolsNote, /was not sent/);
  assert.match(echo.guardrail, /GUARDRAIL/);
  assert.match(echo.primaryAction, /TEXT ECHO NIU NOW/);
  assert.equal(echo.showingState, 'OUTCOME_UNKNOWN');
  assert.equal(echo.askQualificationNow, false);
  assert.ok(echo.showingLines.some((line) => line.startsWith('9/27 6 PM Larry Dix showing, OUTCOME NOT CONFIRMED')));
  assert.ok(echo.showingLines.some((line) => /9\/20 DATA NEEDED Kyle Kleinman showing, OUTCOME NOT CONFIRMED/.test(line)));
  assert.ok(echo.showingLines.some((line) => /9\/20 4 PM DATA NEEDED showing, OUTCOME NOT CONFIRMED/.test(line)));
  assert.equal(echo.showingConflict, null);
  assert.match(echo.showingLines.join('\n'), /TOUR 9\/20, outcome not confirmed. Possible duplicate/);
  assert.match(echo.showingLines.join('\n'), /TOUR 9\/27, outcome not confirmed/);
  assert.doesNotMatch(`${echo.whyNow}\n${echo.humanAction}\n${echo.showingLines.join('\n')}`, /SHOWING CONFLICT|upcoming/i);
  assert.equal(echo.tier, 'TIER 0');
  const tierNumber = (tier: string) => Number(tier.replace(/\D/g, ''));
  for (let index = 1; index < brief.cards.length; index += 1) {
    const previous = brief.cards[index - 1];
    const current = brief.cards[index];
    assert.ok(previous && current);
    assert.ok(tierNumber(previous.tier) <= tierNumber(current.tier), `${previous.clientName} ${previous.tier} before ${current.clientName} ${current.tier}`);
  }
  const markIndex = brief.cards.findIndex((card) => card.clientName === 'Mark Maccagno');
  const katherineIndex = brief.cards.findIndex((card) => card.clientName === 'Katherine De Armas');
  const albertoIndex = brief.cards.findIndex((card) => card.clientName === 'Alberto Alonso');
  assert.ok(markIndex >= 0 && markIndex < katherineIndex && markIndex < albertoIndex);
  assert.match(brief.cards[markIndex]?.primaryAction ?? '', /REVIEW THE OFFER REQUEST/);
  assert.match(brief.cards[markIndex]?.humanAction ?? '', /GET MARK MACCAGNO'S CELL/);
  assert.doesNotMatch(brief.cards[markIndex]?.primaryAction ?? '', /^GET /);
  assert.doesNotMatch(echo.showingLines.join('\n'), /SHOWING_COMPLETED/);
  const claudia = brief.cards.find((card) => card.clientName === 'Claudia Pinheiro');
  assert.match(claudia?.humanAction ?? '', /CALL/);
  const mark = brief.cards.find((card) => card.clientName === 'Mark Maccagno');
  assert.match(mark?.humanAction ?? '', /GET MARK MACCAGNO'S CELL/);
  assert.match(mark?.whyNow ?? '', /\$680K offer request on 1298 NE 199th St/);
  assert.equal(mark?.offerReadiness.readiness, 'MISSING');
  assert.match(mark?.offerReadiness.nextAction ?? '', /Not offer ready/);
  assert.match(mark?.agentToolsNote ?? '', /offer request/);
  assert.doesNotMatch(mark?.humanAction ?? '', /OFFER SUBMITTED/);
  assert.deepEqual(mark?.showingLines, []);
  const perry = brief.cards.find((card) => card.clientName === 'Perry Crawford');
  assert.match(perry?.humanAction ?? '', /GET PERRY CRAWFORD'S CELL/);
  assert.match(perry?.whyNow ?? '', /Two saved searches/);
  assert.match(perry?.whyNow ?? '', /Prefers text/);
  assert.equal(perry?.searchPlan.mode, 'conflict');
  assert.match(perry?.searchPlan.doNotFilter ?? '', /Coral Gables/);
  assert.match(perry?.agentToolsNote ?? '', /Saved searches on file/);
  assert.match(perry?.humanAction ?? '', /SEARCH CONFLICT/);
  assert.doesNotMatch(perry?.searchPlan.required ?? '', /Coral Gables/);
  const katherine = brief.cards.find((card) => card.clientName === 'Katherine De Armas');
  assert.match(katherine?.humanAction ?? '', /CMA NEEDED/);
  assert.match(katherine?.humanAction ?? '', /May 18/);
  assert.match(katherine?.whyNow ?? '', /Needs to sell first/);
  assert.match(katherine?.whyNow ?? '', /overdue/);
  assert.match(katherine?.primaryAction ?? '', /CMA NEEDED/);
  assert.match(katherine?.agentToolsNote ?? '', /needs to sell first/);
  assert.equal(katherine?.askQualificationNow, false);
  const alberto = brief.cards.find((card) => card.clientName === 'Alberto Alonso');
  assert.match(alberto?.humanAction ?? '', /CREATE SEARCH NOW/);
  assert.match(alberto?.humanAction ?? '', /33018/);
  assert.match(alberto?.humanAction ?? '', /DO NOT FILTER OUT YET/);
  const valleCard = brief.cards.find((card) => card.clientName === 'Erena & Rick Valle');
  assert.match(`${valleCard?.whyNow} ${valleCard?.agentToolsNote}`, /not verified CASH/);
  assert.doesNotMatch(valleCard?.humanAction ?? '', /verified CASH|cash purchase/);
  const echoAction = db.get(
    `SELECT action_type, priority_score FROM next_best_actions WHERE opportunity_id = ? AND is_primary = 1`,
    echo.opportunityId,
  );
  assert.equal(text(echoAction, 'action_type'), 'tour_follow_up');
  assert.equal(Number(echoAction?.priority_score), 86);
  const valle = brief.cards.find((card) => card.clientName === 'Erena & Rick Valle');
  assert.ok(valle?.opportunityId);
  const valleAction = db.get(
    `SELECT action_type, priority_score FROM next_best_actions WHERE opportunity_id = ? AND is_primary = 1`,
    valle.opportunityId,
  );
  assert.equal(text(valleAction, 'action_type'), 'tour_follow_up');
  assert.notEqual(text(valleAction, 'action_type'), 'confirm_tour_details');
  assert.notEqual(text(db.get(`SELECT financing_state FROM opportunities WHERE id = ?`, valle.opportunityId), 'financing_state'), 'CASH');
  assert.ok(katherine?.opportunityId);
  const seller = db.get(
    `SELECT o.next_action FROM opportunities o
     JOIN opportunity_links l ON l.seller_opportunity_id = o.id
     WHERE l.buyer_opportunity_id = ?`,
    katherine.opportunityId,
  );
  assert.match(text(seller, 'next_action'), /CMA NEEDED/);
  assert.ok(Number(db.get(`SELECT COUNT(*) AS n FROM approval_queue WHERE status = 'PENDING'`)?.n) > 0);
  assert.match(brief.text, /KYLEOS MORNING BRIEF/);
  const offerNames = brief.sections.header.find((bucket) => bucket.label === 'Offers or offer requests')?.links.map((link) => link.name);
  assert.deepEqual(offerNames, ['Mark Maccagno']);
  const summaryOffers = brief.sections.summary.find((bucket) => bucket.label === 'OFFERS AND OFFER REQUESTS')?.links.map((link) => link.name);
  assert.deepEqual(summaryOffers, ['Mark Maccagno']);
  assert.match(brief.text, /Date: Tuesday, September 29, 2026/);
  assert.match(brief.text, /Current ET: 9:00 AM EDT/);
  assert.equal(brief.clock.date, 'Tuesday, September 29, 2026');
  assert.equal(brief.clock.easternTime, '9:00 AM EDT');
  assert.equal(brief.capabilities.length, 13);
  assert.ok(brief.capabilities.every((row) => row.mode === 'HUMAN ACTION MODE' && row.send === 'NO' && row.read === 'NO'));
  assert.equal(brief.friday.live, false);
  assert.match(brief.friday.lines.join('\n'), /DATA NEEDED/);
  assert.ok(brief.friday.incompleteDenominators.length >= 4);
  assert.ok(echo.opportunityId);
  const echoStates = showingHistory(db, echo.opportunityId);
  assert.ok(echoStates.includes('OUTCOME_UNKNOWN'));
  assert.equal(echoStates.includes('SHOWING_COMPLETED'), false);
  assert.doesNotMatch(mark?.agentToolsNote ?? '', /Do not mark|Nothing was written/);
  assert.match(mark?.agentToolsUpdate.paste ?? '', /\$680K offer request/);
  assert.match(mark?.agentToolsUpdate.thenSet ?? '', /THEN SET|reminder|next action/i);
  for (const label of [
    'Actionable clients', 'Showings today', 'Showings requiring confirmation', 'Hot post-tour clients',
    'Offers or offer requests', 'Financing blockers', 'Buy after sell clients', 'Listing opportunities',
    'Listing agents needing contact', 'Agent Tools records needing updates', 'Missing contact info',
    'Overdue actions', 'Waiting on client', 'Waiting on listing side', 'CALLS TO MAKE', 'TEXTS TO SEND',
    'EMAILS TO SEND', 'LISTING AGENTS TO CONTACT', 'SHOWINGS TO CONFIRM', 'SHOWINGS TODAY',
    'POST TOUR FOLLOW UPS', 'FINANCING ITEMS', 'BUY AFTER SELL ITEMS', 'CMAS NEEDED',
    'OFFERS AND OFFER REQUESTS', 'UNDER CONTRACT ITEMS', 'CONTACT INFORMATION TO FIND',
    'AGENT TOOLS UPDATES', 'WAITING ON CLIENT', 'WAITING ON LISTING SIDE', 'OVERDUE ACTIONS',
  ]) {
    assert.match(brief.text, new RegExp(label), label);
  }
  assert.match(brief.text, /Nothing was sent/);
  assert.equal(Number(db.get(`SELECT COUNT(*) AS n FROM sent_messages`)?.n), 0);
  assert.equal(Number(db.get(`SELECT COUNT(*) AS n FROM communication_log`)?.n), 0);
  const approvals = Number(db.get(`SELECT COUNT(*) AS n FROM approval_queue WHERE status = 'EXECUTED'`)?.n);
  assert.equal(approvals, 0);
  db.close();
});

test('manual marks change KyleOS state only', () => {
  const db = tempDb();
  const brief = seedHot7(db, NOW);
  const echo = brief.cards.find((card) => card.clientName === 'Echo Niu');
  const marked = applyManualMark(db, { opportunityId: echo?.opportunityId ?? '', mark: 'sent_manually', now: NOW });
  assert.equal(marked.applied, true);
  assert.equal(marked.live, false);
  assert.equal(marked.sent, false);
  assert.equal(marked.writtenToAgentTools, false);
  assert.equal(Number(db.get(`SELECT COUNT(*) AS n FROM sent_messages`)?.n), 0);
  db.close();
});

test('contradictory times on one date stay side by side as DATA CONFLICT', () => {
  const card = planDesk(evidence({
    name: 'Conflicted Tour',
    facts: [
      { field: 'showing_detail', value: 'date=9/20; time=4 PM; agent=Kyle Kleinman; outcome=OUTCOME NOT CONFIRMED; class=THIRD PARTY REPORTED', kind: 'fact', verification: 'unverified' },
      { field: 'showing_detail_b', value: 'date=9/20; time=6 PM; agent=Larry Dix; outcome=OUTCOME NOT CONFIRMED; class=THIRD PARTY REPORTED', kind: 'fact', verification: 'unverified' },
    ],
  }));
  assert.match(card.showingConflict ?? '', /DATA CONFLICT on 9\/20/);
  assert.match(card.showingLines.join('\n'), /Do not pick one/);
  assert.ok(card.showingLines.some((line) => line.includes('4 PM Kyle Kleinman')));
  assert.ok(card.showingLines.some((line) => line.includes('6 PM Larry Dix')));
});

test('a promise outranks a passive property check', () => {
  const card = planDesk(evidence({
    name: 'Promised',
    facts: [
      verified('property_address', '10 Fixture St'),
      { field: 'kyle_promise', value: 'Send the plans today', kind: 'fact', verification: 'verified' },
    ],
  }));
  assert.equal(card.tier, 'TIER 0');
  assert.match(card.humanAction, /KEEP THE PROMISE/);
  assert.match(card.whyNow, /Send the plans today/);
});

test('mark sent manually waits, suppresses the draft, and reranks', () => {
  const db = tempDb();
  const before = seedHot7(db, NOW);
  const echo = before.cards.find((card) => card.clientName === 'Echo Niu');
  assert.ok(echo?.clientDraft);
  applyManualMark(db, { opportunityId: echo?.opportunityId ?? '', mark: 'sent_manually', now: NOW });
  const after = buildMorningBrief(db, NOW);
  const again = after.cards.find((card) => card.clientName === 'Echo Niu');
  assert.ok(again);
  assert.equal(again.clientDraft, null);
  assert.equal(again.waitingOn, 'WAITING_ON_CLIENT');
  assert.match(again.humanAction, /WAIT FOR ECHO NIU'S REPLY/);
  assert.match(again.humanAction, /Delivery is not verified/);
  assert.match(again.nextTrigger, /reply/i);
  assert.ok(after.cards.findIndex((card) => card.clientName === 'Echo Niu') > 0);
  assert.equal(Number(db.get(`SELECT COUNT(*) AS n FROM sent_messages`)?.n), 0);
  db.close();
});

test('prompt modules stay versioned and the voice screen rejects the banned commission line', () => {
  assert.equal(PROMPT_MODULE_VERSION, '2026-09-29.1');
  assert.equal(screenKyleVoice('The seller pays my commission.').allowed, false);
  assert.equal(screenKyleVoice('Echo, did you end up seeing the place?').allowed, true);
  assert.ok(EVAL_SCENARIOS.includes('past showing unknown outcome'));
  assert.ok(EVAL_SCENARIOS.includes('two tours are not a conflict'));
});

test('a stale snapshot is labeled and an old happened draft is not reused', () => {
  const card = planDesk(evidence({
    name: 'Snapshot',
    facts: [
      verified('property_address', '10 Fixture St'),
      { field: 'buying_activity', value: '0 tours Sep 20 - Upcoming tour agent scheduled with Kyle Kleinman', kind: 'fact', verification: 'unverified' },
      { field: 'showing_detail', value: 'date=9/20; time=4 PM; agent=DATA NEEDED; outcome=OUTCOME NOT CONFIRMED; class=THIRD PARTY REPORTED', kind: 'fact', verification: 'unverified' },
      { field: 'showing_detail_2', value: 'date=9/27; time=6 PM; agent=Larry Dix; outcome=OUTCOME NOT CONFIRMED; class=THIRD PARTY REPORTED', kind: 'fact', verification: 'unverified' },
      { field: 'agent_tools_snapshot', value: 'captured=2026-09-28; the export still describes the earlier tour as not yet held; later tour detail is on file; stale=yes', kind: 'fact', verification: 'unverified' },
      { field: 'sms_draft', value: 'Unsent draft claims the tour already happened.', kind: 'inference', verification: 'unverified' },
    ],
  }));
  assert.match(card.whyNow, /STALE SNAPSHOT/);
  assert.doesNotMatch(`${card.whyNow} ${card.humanAction} ${card.clientDraft ?? ''} ${card.showingLines.join(' ')}`, /upcoming/i);
  assert.match(card.agentToolsNote, /was not sent/);
  assert.doesNotMatch(card.clientDraft ?? '', /already happened/);
  assert.equal(card.showingState, 'OUTCOME_UNKNOWN');
  assert.ok(card.showingLines.some((line) => line.includes('9/27 6 PM Larry Dix')));
  assert.ok(card.showingLines.some((line) => line.includes('DATA NEEDED')));
});

test('one staging buyer is stored through the existing loader with the snapshot date', () => {
  const db = tempDb();
  const dir = mkdtempSync(join(tmpdir(), 'kyleos-staging-'));
  const file = join(dir, 'staging.json');
  writeFileSync(file, JSON.stringify({
    meta: { generated_at: '2026-09-29T03:05:24-04:00' },
    records: [{
      staging_id: 'AT-STG-TEST',
      identity: { full_name: 'Fixture Buyer', phones: [{ value: '3055550199', verified: true }], emails: [] },
      provenance: { sources: [
        { system: 'agent_tools', captured_at: '2026-09-28T16:19:39-04:00' },
        { system: 'gmail_redfin', captured_at: '2026-09-28T09:23:28-04:00' },
      ] },
      facts: [
        { field: 'appointment', value: { date: '2026-09-20', time: '4:00 PM EDT' } },
        { field: 'appointment', value: { date: '2026-09-27', time: '6:00 PM EDT', attending_agent: 'Larry Dix' } },
        { field: 'agent_tools.buying_activity', value: '0 tours Sep 20 - Upcoming tour agent scheduled with Kyle Kleinman' },
        { field: 'property_discussed', value: { address: '10 Fixture St', status: 'toured_or_scheduled' } },
        { field: 'redfin_customer_id', value: 'should-not-be-stored' },
      ],
      searches: [],
      inferences: [],
      mapping_issues: [
        'The export appears stale for this client.',
        "An unsent draft says the tour already happened.",
      ],
    }, {
      staging_id: 'AT-STG-OTHER',
      identity: { full_name: 'Other Buyer', phones: [{ value: '3055550188', verified: true }] },
      facts: [],
    }],
  }));
  const loaded = loadCanonicalStagingBuyer(db, file, 'AT-STG-TEST', { now: NOW });
  assert.equal(loaded.applied, true);
  assert.equal(loaded.liveSend, false);
  assert.equal(loaded.results.length, 1);
  const observed = db.get(`SELECT observed_at FROM client_facts WHERE field_key = 'buying_activity'`);
  assert.equal(text(observed, 'observed_at'), '2026-09-28T16:19:39-04:00');
  assert.equal(db.get(`SELECT value FROM client_facts WHERE field_key = 'redfin_customer_id'`), undefined);
  const brief = buildMorningBrief(db, NOW);
  assert.equal(brief.cards.length, 1);
  assert.equal(brief.cards[0]?.clientName, 'Fixture Buyer');
  assert.match(brief.cards[0]?.whyNow ?? '', /STALE SNAPSHOT/);
  assert.doesNotMatch(brief.cards[0]?.clientDraft ?? '', /already happened/);
  assert.equal(brief.live, false);
  db.close();
});

test('the production clock is America/New_York and tests inject the instant', () => {
  const clock = easternClock(new Date('2026-09-23T14:00:00.000Z'));
  assert.match(clock.date, /September 23, 2026/);
  assert.match(clock.easternTime, /10:00 AM/);
});

test('buildMorningBrief regenerates from the database', () => {
  const db = tempDb();
  seedHot7(db, NOW);
  const again = buildMorningBrief(db, NOW);
  assert.equal(again.generated, true);
  assert.match(again.text, /ECHO NIU/);
  assert.match(again.text, /GET MARK MACCAGNO'S CELL/);
  assert.match(again.text, /WHERE TO LOOK/);
  assert.match(again.text, /CREATE SEARCH NOW/);
  assert.match(again.text, /KYLEOS MORNING BRIEF/);
  assert.ok(again.text.indexOf('ECHO NIU') < again.text.indexOf('ERENA & RICK VALLE'));
  assert.equal(again.cards[0]?.clientName, 'Echo Niu');
  assert.equal(again.cards.length, 7);
  db.close();
});
