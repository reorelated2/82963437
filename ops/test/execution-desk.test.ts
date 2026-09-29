import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { writeClientFact } from '../src/canonical.ts';
import { FINANCING_STATES, screenKyleVoice } from '../src/conversion/policy.ts';
import { nextBestAction, openBuyerFile } from '../src/conversion/engine.ts';
import { ingestCanonicalLead } from '../src/canonical.ts';
import { buildMorningBrief } from '../src/execution/brief.ts';
import { seedHot7 } from '../src/execution/hot7.ts';
import { applyManualMark } from '../src/execution/marks.ts';
import { planDesk, type DeskEvidence, type DeskFact } from '../src/execution/plan.ts';
import { recordLeadSource } from '../src/execution/source.ts';
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

test('section 49 situations do not collapse state', () => {
  const cases: Array<{ name: string; facts: DeskFact[]; phone?: string | null; dnc?: boolean; includes: RegExp; excludes?: RegExp }> = [
    { name: 'New Buyer', facts: [verified('property_address', '10 Fixture St')], includes: /checking on 10 Fixture St/ },
    { name: 'Repeat Buyer', facts: [verified('property_address', '10 Fixture St'), verified('repeat_property_request', 'prior request 2026-09-01')], includes: /checking on 10 Fixture St/ },
    { name: 'Requested Only', facts: [verified('showing_requested', 'yes'), verified('property_address', '10 Fixture St')], includes: /CUSTOMER_REQUESTED|checking on/ },
    { name: 'Past Tour', facts: [verified('scheduled_tour_note', '2026-09-27 6:00 PM upcoming tour agent scheduled'), verified('property_address', '90 SW 3rd St #308')], includes: /OUTCOME UNKNOWN/ },
    { name: 'Associate Tour', facts: [{ field: 'associate_tour', value: 'completed by associate agent German', kind: 'inference', verification: 'unverified' }], includes: /NOT CONFIRMED/ },
    { name: 'Call Me', facts: [verified('customer_asked', 'please call me')], includes: /CALL / },
    { name: 'Pending Home', facts: [verified('property_status', 'Pending'), verified('property_address', '10 Fixture St')], includes: /went pending/ },
    { name: 'Cash Buyer', facts: [verified('cash_vs_finance', 'cash'), verified('property_address', '10 Fixture St')], includes: /cash purchase/ },
    { name: 'Needs Lender', facts: [verified('financing_state', 'NEEDS_PREAPPROVAL')], includes: /finance it or buy cash/ },
    { name: 'Preapproved', facts: [verified('financing_state', 'PREAPPROVED'), verified('property_address', '10 Fixture St')], includes: /preapproval on file/ },
    { name: 'No Sale', facts: [verified('sale_dependency', 'homeowner_no_sale'), verified('property_address', '10 Fixture St')], includes: /checking on/ },
    { name: 'Must Sell', facts: [verified('sale_dependency', 'sale_required')], includes: /sell before you can buy/ },
    { name: 'Needs Proceeds', facts: [verified('sale_dependency', 'proceeds_required')], includes: /proceeds/ },
    { name: 'No Cell', facts: [], phone: null, includes: /GET .* CELL/ },
    { name: 'Opt Out', facts: [], dnc: true, includes: /DO NOT CONTACT/ },
    { name: 'Stop', facts: [verified('contact_preference', 'stop contacting me')], includes: /DO NOT CONTACT/ },
    { name: 'Offer Draft', facts: [verified('offer_state', 'draft')], includes: /has not been submitted|MISSING/ },
    { name: 'Offer Submitted', facts: [verified('offer_state', 'submitted')], includes: /SUBMITTED/ },
    { name: 'Open Nearby', facts: [verified('area_flexibility', 'nearby'), verified('property_address', '10 Fixture St')], includes: /nearby works/ },
    { name: 'Spouse', facts: [verified('decision_makers', 'spouse'), verified('property_address', '10 Fixture St')], includes: /Decision makers are already on file/ },
    { name: 'Listing Agent Missing', facts: [verified('listing_agent_contact', 'missing'), verified('property_address', '10 Fixture St')], includes: /LISTING AGENT CONTACT NEEDED/ },
    { name: 'Listing Agent Found', facts: [verified('listing_agent_name', 'Maria Rodriguez'), verified('listing_agent_phone', '3055550199'), verified('property_address', '10 Fixture St')], includes: /Do not contact them yet/ },
    { name: 'Unsent Gmail', facts: [{ field: 'gmail_draft', value: 'draft only', kind: 'inference', verification: 'unverified' }, verified('property_address', '10 Fixture St')], includes: /not prior contact/ },
    { name: 'Coordinator', facts: [{ field: 'coordinator_contact', value: 'coordinator texted the customer', kind: 'inference', verification: 'unverified' }], includes: /NOT CONFIRMED/ },
    { name: 'Next Question', facts: [verified('answered', 'motivation'), verified('property_address', '10 Fixture St')], includes: /open nearby/ },
    { name: 'Detailed Question', facts: [verified('detailed_question', 'taxes and HOA'), verified('property_address', '10 Fixture St')], includes: /facts on file/ },
    { name: 'Cash Flow', facts: [{ field: 'investor_strategy', value: 'cash flow', kind: 'inference', verification: 'unverified' }], includes: /won't guess the numbers/ },
    { name: 'Area Change', facts: [verified('area_change', 'Miami Shores')], includes: /Miami Shores/ },
    { name: 'Search Filters', facts: [verified('search_hard', 'North Miami, SFH, 3 bed'), verified('search_soft', 'pool')], includes: /DO NOT FILTER OUT YET/ },
    { name: 'Wants Offer', facts: [verified('wants_offer', 'yes')], includes: /MISSING/ },
    { name: 'Price Missing Terms', facts: [verified('offer_price', '500000'), verified('missing_terms', 'deposit')], includes: /Do not submit/ },
    { name: 'Offer Accepted', facts: [verified('offer_state', 'accepted')], includes: /not closed/ },
    { name: 'Effective Date', facts: [verified('effective_date', '2026-10-01')], includes: /EFFECTIVE DATE VERIFIED/ },
    { name: 'Inspection Deadline', facts: [verified('inspection_deadline', '2026-10-10')], includes: /Deadline verified/ },
    { name: 'Inspection Unknown', facts: [verified('inspection_status', 'unknown')], includes: /not scheduled/ },
    { name: 'Loan Not Clear', facts: [verified('loan_status', 'not_clear_to_close')], includes: /NOT CLEAR TO CLOSE/ },
    { name: 'Walkthrough', facts: [verified('walkthrough', 'scheduled')], includes: /not completed/ },
    { name: 'Closed', facts: [verified('transaction_status', 'closed')], includes: /TRANSACTION CLOSED/ },
    { name: 'Owns No Listing', facts: [verified('owns_home', 'yes'), verified('sale_dependency', 'homeowner_no_sale'), verified('property_address', '10 Fixture St')], includes: /checking on 10 Fixture St/ },
    { name: 'Referral Update', facts: [verified('referral_update', 'due')], includes: /Do not invent a conversation/ },
    { name: 'Calendar Conflict', facts: [verified('calendar_conflict', 'yes')], includes: /CALENDAR CONFLICT/ },
    { name: 'Compensation Unknown', facts: [verified('compensation', 'unknown')], includes: /COMPENSATION NEEDS VERIFICATION/ },
    { name: 'Compensation Known', facts: [verified('buyer_agreement_compensation', '2.5 percent buyer side')], includes: /2.5 percent/ },
    { name: 'Email Needs Approval', facts: [verified('email_send_capability', 'yes'), verified('property_address', '10 Fixture St')], includes: /was not sent/ },
    { name: 'Future Timeline', facts: [verified('timeline', 'future')], includes: /Not offer ready/ },
    { name: 'Property Conflict', facts: [verified('property_conflict', 'MLS Active, Redfin Pending')], includes: /DATA CONFLICT/ },
    { name: 'Stale Property', facts: [verified('property_stale', 'yes'), verified('property_status', 'Active')], includes: /OLD DATA/ },
    { name: 'Schools', facts: [verified('schools_question', 'good schools')], includes: /can't rank neighborhoods/ },
    { name: 'Investor', facts: [{ field: 'investor_strategy', value: 'STR', kind: 'inference', verification: 'unverified' }], includes: /won't guess the numbers/ },
    { name: 'Short Reply', facts: [verified('reply', 'ok')], includes: /Got it/ },
    { name: 'CMA', facts: [verified('cma_due', '2026-09-28')], includes: /CMA NEEDED/ },
    { name: 'Spanish', facts: [verified('language', 'es'), verified('property_address', '10 Fixture St')], includes: /soy Kyle con Redfin/ },
    { name: 'Phone Pref', facts: [verified('preferred_channel', 'phone')], includes: /CALL / },
  ];
  for (const item of cases) {
    const card = planDesk(evidence({ name: item.name, facts: item.facts, phone: item.phone, dnc: item.dnc }));
    const blob = `${card.humanAction}\n${card.clientDraft ?? ''}\n${card.callOpening ?? ''}\n${card.showingState}`;
    assert.match(blob, item.includes, item.name);
    assert.equal(card.live, false, item.name);
    assert.equal(card.manualActionRequired, true, item.name);
    if (card.clientDraft) assert.equal(screenKyleVoice(card.clientDraft).allowed, true, item.name);
    if (card.callOpening) assert.equal(screenKyleVoice(card.callOpening).allowed, true, item.name);
    assert.notEqual(card.showingState, 'SHOWING_COMPLETED', item.name);
    if (item.name === 'Past Tour') assert.doesNotMatch(card.humanAction, /confirm_tour_details/);
    if (item.name === 'Offer Draft') assert.match(card.humanAction, /MISSING|draft/i);
    if (item.name === 'Associate Tour' || item.name === 'Coordinator') assert.equal(card.showingState, 'OUTCOME_UNKNOWN');
    if (item.name === 'Requested Only') assert.equal(card.showingState, 'CUSTOMER_REQUESTED');
    if (item.name === 'Walkthrough') assert.notEqual(card.customerPropertyState, 'Completed');
    if (item.name === 'Unsent Gmail') assert.doesNotMatch(blob, /EMAIL SENT|as I emailed/);
    if (item.name === 'Owns No Listing') assert.doesNotMatch(card.humanAction, /LISTING OPPORTUNITY|CMA NEEDED/);
    if (item.name === 'Email Needs Approval') assert.equal(card.approvalRequired, true);
    assert.doesNotMatch(card.humanAction, /TEXT SENT|EMAIL SENT|CALL COMPLETED|AGENT TOOLS UPDATED/);
  }
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

test('hot 7 brief is generated with seven human cards and no sends', () => {
  const db = tempDb();
  const brief = seedHot7(db, NOW);
  assert.equal(brief.generated, true);
  assert.equal(brief.live, false);
  assert.equal(brief.cards.length, 7);
  const names = brief.cards.map((card) => card.clientName).sort();
  assert.deepEqual(names, ['Alberto Alonso', 'Claudia Pinheiro', 'Echo Niu', 'Erena Valle', 'Katherine De Armas', 'Mark Maccagno', 'Perry Crawford']);
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
  assert.equal(echo.askQualificationNow, false);
  const claudia = brief.cards.find((card) => card.clientName === 'Claudia Pinheiro');
  assert.match(claudia?.humanAction ?? '', /CALL/);
  assert.match(brief.text, /MORNING EXECUTION BRIEF/);
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

test('buildMorningBrief regenerates from the database', () => {
  const db = tempDb();
  seedHot7(db, NOW);
  const again = buildMorningBrief(db, NOW);
  assert.equal(again.generated, true);
  assert.match(again.text, /ECHO NIU/);
  assert.ok(again.text.indexOf('ECHO NIU') < again.text.indexOf('ERENA VALLE'));
  assert.equal(again.cards[0]?.clientName, 'Echo Niu');
  assert.equal(again.cards.length, 7);
  db.close();
});
